import { Server as SocketIOServer } from "socket.io";
import {
  Match,
  CHARACTER_STATS,
  TURN_TIMEOUT_MS,
  MAX_TURNS,
  DISCONNECT_GRACE_MS,
  YourTurnPayload,
  TurnResultPayload,
  MatchOverPayload,
  TurnRecord,
  FeedItem,
} from "./types.js";
import {
  getMatch,
  updateMatch,
  pushTurnRecord,
  pushFeedItem,
  removeActiveMatch,
} from "./game.js";
import { adjudicateTurn } from "./gmService.js";

// ─── In-memory turn state ─────────────────────────────────────────────────────

interface TurnState {
  matchId: string;
  actionTimer: NodeJS.Timeout | null;
  disconnectTimers: Map<string, NodeJS.Timeout>;
}

const activeTurns = new Map<string, TurnState>();
let _io: SocketIOServer;

export function registerTurnEngine(io: SocketIOServer): void {
  _io = io;
}

// ─── Match lifecycle ──────────────────────────────────────────────────────────

export async function startMatch(matchId: string): Promise<void> {
  const match = await getMatch(matchId);
  if (!match) return;

  const hpA = CHARACTER_STATS[match.characterA].hp;
  const hpB = CHARACTER_STATS[match.characterB].hp;

  await updateMatch(matchId, {
    status: "active",
    hpA,
    hpB,
    currentTurn: 1,
    startedAt: new Date().toISOString(),
  });

  const updated = await getMatch(matchId);
  if (!updated) return;

  _io.to(updated.agentASocketId).emit("MATCH_START", {
    matchId,
    opponentName: updated.agentBName,
    yourHp: hpA,
    opponentHp: hpB,
    yourCharacter: updated.characterA,
    opponentCharacter: updated.characterB,
  });
  _io.to(updated.agentBSocketId).emit("MATCH_START", {
    matchId,
    opponentName: updated.agentAName,
    yourHp: hpB,
    opponentHp: hpA,
    yourCharacter: updated.characterB,
    opponentCharacter: updated.characterA,
  });

  activeTurns.set(matchId, {
    matchId,
    actionTimer: null,
    disconnectTimers: new Map(),
  });

  await beginTurn(matchId);
}

async function beginTurn(matchId: string): Promise<void> {
  const match = await getMatch(matchId);
  if (!match || match.status !== "active") return;

  // Clear actions for the new turn
  await updateMatch(matchId, { actionA: "", actionB: "" });

  const deadline = Date.now() + TURN_TIMEOUT_MS;

  console.log(
    `[Match ${matchId}] Turn ${match.currentTurn} started — ` +
      `${match.agentAName} (${match.characterA}) vs ${match.agentBName} (${match.characterB})`
  );

  const payloadA: YourTurnPayload = {
    turn: match.currentTurn,
    state: { hpSelf: match.hpA, hpOpponent: match.hpB },
    deadline,
  };
  const payloadB: YourTurnPayload = {
    turn: match.currentTurn,
    state: { hpSelf: match.hpB, hpOpponent: match.hpA },
    deadline,
  };

  _io.to(match.agentASocketId).emit("YOUR_TURN", payloadA);
  _io.to(match.agentBSocketId).emit("YOUR_TURN", payloadB);

  const state = activeTurns.get(matchId);
  if (!state) return;

  if (state.actionTimer) clearTimeout(state.actionTimer);
  state.actionTimer = setTimeout(() => {
    void resolveTurn(matchId);
  }, TURN_TIMEOUT_MS);
}

// ─── Action collection ────────────────────────────────────────────────────────

export async function receiveAction(
  matchId: string,
  socketId: string,
  action: string
): Promise<void> {
  const match = await getMatch(matchId);
  if (!match || match.status !== "active") return;

  const isA = match.agentASocketId === socketId;
  const isB = match.agentBSocketId === socketId;
  if (!isA && !isB) return;

  // Ignore double-submissions
  if (isA && match.actionA !== "") return;
  if (isB && match.actionB !== "") return;

  const truncated = action.slice(0, 500);

  if (isA) {
    await updateMatch(matchId, { actionA: truncated });
  } else {
    await updateMatch(matchId, { actionB: truncated });
  }

  // Re-fetch to check if both actions are now in
  const refreshed = await getMatch(matchId);
  if (refreshed && refreshed.actionA !== "" && refreshed.actionB !== "") {
    const state = activeTurns.get(matchId);
    if (state?.actionTimer) {
      clearTimeout(state.actionTimer);
      state.actionTimer = null;
    }
    void resolveTurn(matchId);
  }
}

// ─── Turn resolution ──────────────────────────────────────────────────────────

async function resolveTurn(matchId: string): Promise<void> {
  const match = await getMatch(matchId);
  if (!match || match.status !== "active") return;

  const actionA =
    match.actionA || `${match.agentAName} hesitates, doing nothing.`;
  const actionB =
    match.actionB || `${match.agentBName} hesitates, doing nothing.`;

  const gm = await adjudicateTurn(
    match.agentAName,
    match.characterA,
    match.hpA,
    actionA,
    match.agentBName,
    match.characterB,
    match.hpB,
    actionB,
    match.currentTurn
  );

  const newHpA = Math.max(0, match.hpA - gm.damageA);
  const newHpB = Math.max(0, match.hpB - gm.damageB);

  const turnRecord: TurnRecord = {
    turnNumber: match.currentTurn,
    actionA,
    actionB,
    narrative: gm.narrative,
    hpA: newHpA,
    hpB: newHpB,
    timestamp: new Date().toISOString(),
  };

  await pushTurnRecord(matchId, turnRecord);
  await updateMatch(matchId, {
    hpA: newHpA,
    hpB: newHpB,
    actionA: "",
    actionB: "",
  });

  console.log(
    `[Match ${matchId}] Turn ${match.currentTurn} done | ` +
      `${match.agentAName}: ${newHpA} HP | ${match.agentBName}: ${newHpB} HP`
  );

  const resultPayload: TurnResultPayload = {
    turn: match.currentTurn,
    narrative: gm.narrative,
    state: { hpA: newHpA, hpB: newHpB },
  };

  _io.to(match.agentASocketId).emit("TURN_RESULT", resultPayload);
  _io.to(match.agentBSocketId).emit("TURN_RESULT", resultPayload);

  const feedItem: FeedItem = {
    title: `Turn ${match.currentTurn}: ${match.agentAName} vs ${match.agentBName}`,
    description: gm.narrative,
    matchId,
    pubDate: new Date().toUTCString(),
  };
  await pushFeedItem(feedItem);

  const turnLimitReached = match.currentTurn >= MAX_TURNS;
  const aDefeated = newHpA <= 0;
  const bDefeated = newHpB <= 0;

  if (aDefeated || bDefeated || turnLimitReached) {
    await endMatch(
      matchId,
      newHpA,
      newHpB,
      match.currentTurn,
      turnLimitReached,
      gm.narrative
    );
  } else {
    await updateMatch(matchId, { currentTurn: match.currentTurn + 1 });
    await beginTurn(matchId);
  }
}

// ─── Match ending ─────────────────────────────────────────────────────────────

async function endMatch(
  matchId: string,
  hpA: number,
  hpB: number,
  turn: number,
  draw: boolean,
  finalNarrative: string
): Promise<void> {
  const match = await getMatch(matchId);
  if (!match) return;

  let winner: string;
  let status: Match["status"];

  if (draw || (hpA <= 0 && hpB <= 0)) {
    winner = "draw";
    status = "draw";
  } else if (hpA <= 0) {
    winner = match.agentBName;
    status = "completed";
  } else {
    winner = match.agentAName;
    status = "completed";
  }

  await updateMatch(matchId, { status, endedAt: new Date().toISOString() });
  await removeActiveMatch(matchId);

  const state = activeTurns.get(matchId);
  if (state?.actionTimer) clearTimeout(state.actionTimer);
  activeTurns.delete(matchId);

  if (winner === "draw") {
    console.log(`[Match ${matchId}] Draw after turn ${turn}.`);
  } else {
    console.log(`[Match ${matchId}] ${winner} wins on turn ${turn}!`);
  }

  const overPayload: MatchOverPayload = { winner, finalNarrative };
  _io.to(match.agentASocketId).emit("MATCH_OVER", overPayload);
  _io.to(match.agentBSocketId).emit("MATCH_OVER", overPayload);

  await pushFeedItem({
    title: `Match Over: ${winner === "draw" ? "Draw" : `${winner} wins`} — ${
      match.agentAName
    } vs ${match.agentBName}`,
    description: finalNarrative,
    matchId,
    pubDate: new Date().toUTCString(),
  });
}

// ─── Disconnect handling ──────────────────────────────────────────────────────

export function handleDisconnect(socketId: string, matchId: string): void {
  const state = activeTurns.get(matchId);
  if (!state) return;

  const timer = setTimeout(() => {
    void forfeitMatch(matchId, socketId);
  }, DISCONNECT_GRACE_MS);

  state.disconnectTimers.set(socketId, timer);
}

export function handleReconnect(socketId: string, matchId: string): void {
  const state = activeTurns.get(matchId);
  if (!state) return;
  const timer = state.disconnectTimers.get(socketId);
  if (timer) {
    clearTimeout(timer);
    state.disconnectTimers.delete(socketId);
  }
}

async function forfeitMatch(
  matchId: string,
  forfeitingSocketId: string
): Promise<void> {
  const match = await getMatch(matchId);
  if (!match || match.status !== "active") return;

  const forfeitingAgent =
    match.agentASocketId === forfeitingSocketId
      ? match.agentAName
      : match.agentBName;
  const winner =
    match.agentASocketId === forfeitingSocketId
      ? match.agentBName
      : match.agentAName;

  const narrative = `${forfeitingAgent} has disconnected and forfeits the match. ${winner} is victorious!`;

  await updateMatch(matchId, {
    status: "forfeited",
    endedAt: new Date().toISOString(),
  });
  await removeActiveMatch(matchId);

  const state = activeTurns.get(matchId);
  if (state?.actionTimer) clearTimeout(state.actionTimer);
  activeTurns.delete(matchId);

  console.log(
    `[Match ${matchId}] ${forfeitingAgent} forfeited. ${winner} wins!`
  );

  const overPayload: MatchOverPayload = { winner, finalNarrative: narrative };
  _io.to(match.agentASocketId).emit("MATCH_OVER", overPayload);
  _io.to(match.agentBSocketId).emit("MATCH_OVER", overPayload);

  await pushFeedItem({
    title: `Match Over: ${winner} wins by forfeit — ${match.agentAName} vs ${match.agentBName}`,
    description: narrative,
    matchId,
    pubDate: new Date().toUTCString(),
  });
}
