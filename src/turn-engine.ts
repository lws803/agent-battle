import { Server as SocketIOServer } from "socket.io";

import { getClassHp } from "./config";
import {
  MAX_TURNS,
  DISCONNECT_GRACE_MS,
  YourTurnPayload,
  TurnResultPayload,
  MatchOverPayload,
  TurnRecord,
  FeedItem,
  Match,
  TURN_TIMEOUT_MS,
} from "./types";
import {
  getMatch,
  updateMatch,
  pushTurnRecord,
  pushFeedItem,
  removeActiveMatch,
} from "./game";
import { adjudicateTurn } from "./gm-service";

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

  const hpA = getClassHp(match.character_a);
  const hpB = getClassHp(match.character_b);

  await updateMatch(matchId, {
    status: "active",
    hp_a: hpA,
    hp_b: hpB,
    current_turn: 1,
    started_at: new Date().toISOString(),
  });

  const updated = await getMatch(matchId);
  if (!updated) return;

  _io.to(updated.agent_a_socket_id).emit("MATCH_START", {
    match_id: matchId,
    opponent_name: updated.agent_b_name,
    your_hp: hpA,
    opponent_hp: hpB,
    your_character: updated.character_a,
    opponent_character: updated.character_b,
  });
  _io.to(updated.agent_b_socket_id).emit("MATCH_START", {
    match_id: matchId,
    opponent_name: updated.agent_a_name,
    your_hp: hpB,
    opponent_hp: hpA,
    your_character: updated.character_b,
    opponent_character: updated.character_a,
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
  await updateMatch(matchId, { action_a: "", action_b: "" });

  const deadline = Date.now() + TURN_TIMEOUT_MS;

  console.log(
    `[Match ${matchId}] Turn ${match.current_turn} started — ` +
      `${match.agent_a_name} (${match.character_a}) vs ${match.agent_b_name} (${match.character_b})`
  );

  const payloadA: YourTurnPayload = {
    turn: match.current_turn,
    state: { hp_self: match.hp_a, hp_opponent: match.hp_b },
    deadline,
  };
  const payloadB: YourTurnPayload = {
    turn: match.current_turn,
    state: { hp_self: match.hp_b, hp_opponent: match.hp_a },
    deadline,
  };

  _io.to(match.agent_a_socket_id).emit("YOUR_TURN", payloadA);
  _io.to(match.agent_b_socket_id).emit("YOUR_TURN", payloadB);

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

  const isA = match.agent_a_socket_id === socketId;
  const isB = match.agent_b_socket_id === socketId;
  if (!isA && !isB) return;

  // Ignore double-submissions
  if (isA && match.action_a !== "") return;
  if (isB && match.action_b !== "") return;

  const truncated = action.slice(0, 500);

  if (isA) {
    await updateMatch(matchId, { action_a: truncated });
  } else {
    await updateMatch(matchId, { action_b: truncated });
  }

  // Re-fetch to check if both actions are now in
  const refreshed = await getMatch(matchId);
  if (refreshed && refreshed.action_a !== "" && refreshed.action_b !== "") {
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
    match.action_a || `${match.agent_a_name} hesitates, doing nothing.`;
  const actionB =
    match.action_b || `${match.agent_b_name} hesitates, doing nothing.`;

  const gm = await adjudicateTurn(
    match.agent_a_name,
    match.character_a,
    match.hp_a,
    actionA,
    match.agent_b_name,
    match.character_b,
    match.hp_b,
    actionB,
    match.current_turn
  );

  const newHpA = Math.max(0, match.hp_a - gm.damage_a);
  const newHpB = Math.max(0, match.hp_b - gm.damage_b);

  const turnRecord: TurnRecord = {
    turn_number: match.current_turn,
    action_a: actionA,
    action_b: actionB,
    narrative: gm.narrative,
    hp_a: newHpA,
    hp_b: newHpB,
    timestamp: new Date().toISOString(),
  };

  await pushTurnRecord(matchId, turnRecord);
  await updateMatch(matchId, {
    hp_a: newHpA,
    hp_b: newHpB,
    action_a: "",
    action_b: "",
  });

  console.log(
    `[Match ${matchId}] Turn ${match.current_turn} done | ` +
      `${match.agent_a_name}: ${newHpA} HP | ${match.agent_b_name}: ${newHpB} HP`
  );

  const resultPayload: TurnResultPayload = {
    turn: match.current_turn,
    narrative: gm.narrative,
    state: { hp_a: newHpA, hp_b: newHpB },
  };

  _io.to(match.agent_a_socket_id).emit("TURN_RESULT", resultPayload);
  _io.to(match.agent_b_socket_id).emit("TURN_RESULT", resultPayload);

  const feedItem: FeedItem = {
    title: `Turn ${match.current_turn}: ${match.agent_a_name} vs ${match.agent_b_name}`,
    description: gm.narrative,
    match_id: matchId,
    pub_date: new Date().toUTCString(),
  };
  await pushFeedItem(feedItem);

  const turnLimitReached = match.current_turn >= MAX_TURNS;
  const aDefeated = newHpA <= 0;
  const bDefeated = newHpB <= 0;

  if (aDefeated || bDefeated || turnLimitReached) {
    await endMatch(
      matchId,
      newHpA,
      newHpB,
      match.current_turn,
      turnLimitReached,
      gm.narrative
    );
  } else {
    await updateMatch(matchId, { current_turn: match.current_turn + 1 });
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
    winner = match.agent_b_name;
    status = "completed";
  } else {
    winner = match.agent_a_name;
    status = "completed";
  }

  await updateMatch(matchId, { status, ended_at: new Date().toISOString() });
  await removeActiveMatch(matchId);

  const state = activeTurns.get(matchId);
  if (state?.actionTimer) clearTimeout(state.actionTimer);
  activeTurns.delete(matchId);

  if (winner === "draw") {
    console.log(`[Match ${matchId}] Draw after turn ${turn}.`);
  } else {
    console.log(`[Match ${matchId}] ${winner} wins on turn ${turn}!`);
  }

  const overPayload: MatchOverPayload = {
    winner,
    final_narrative: finalNarrative,
  };
  _io.to(match.agent_a_socket_id).emit("MATCH_OVER", overPayload);
  _io.to(match.agent_b_socket_id).emit("MATCH_OVER", overPayload);

  await pushFeedItem({
    title: `Match Over: ${winner === "draw" ? "Draw" : `${winner} wins`} — ${
      match.agent_a_name
    } vs ${match.agent_b_name}`,
    description: finalNarrative,
    match_id: matchId,
    pub_date: new Date().toUTCString(),
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
    match.agent_a_socket_id === forfeitingSocketId
      ? match.agent_a_name
      : match.agent_b_name;
  const winner =
    match.agent_a_socket_id === forfeitingSocketId
      ? match.agent_b_name
      : match.agent_a_name;

  const narrative = `${forfeitingAgent} has disconnected and forfeits the match. ${winner} is victorious!`;

  await updateMatch(matchId, {
    status: "forfeited",
    ended_at: new Date().toISOString(),
  });
  await removeActiveMatch(matchId);

  const state = activeTurns.get(matchId);
  if (state?.actionTimer) clearTimeout(state.actionTimer);
  activeTurns.delete(matchId);

  console.log(
    `[Match ${matchId}] ${forfeitingAgent} forfeited. ${winner} wins!`
  );

  const overPayload: MatchOverPayload = { winner, final_narrative: narrative };
  _io.to(match.agent_a_socket_id).emit("MATCH_OVER", overPayload);
  _io.to(match.agent_b_socket_id).emit("MATCH_OVER", overPayload);

  await pushFeedItem({
    title: `Match Over: ${winner} wins by forfeit — ${match.agent_a_name} vs ${match.agent_b_name}`,
    description: narrative,
    match_id: matchId,
    pub_date: new Date().toUTCString(),
  });
}
