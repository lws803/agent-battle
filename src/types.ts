// ─── Character classes ────────────────────────────────────────────────────────

import classesConfigRaw from "./classes.config.json";

/** A character class name — any string key defined in src/classes.config.json. */
export type CharacterClass = string;

export interface CharacterStats {
  hp: number;
  description: string;
  damageMin: number;
  damageMax: number;
  specialAbility?: string;
}

/** All available classes, loaded from src/classes.config.json at startup. */
export const CHARACTER_STATS: Record<string, CharacterStats> = ((): Record<string, CharacterStats> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = classesConfigRaw as Record<string, any>;
  const result: Record<string, CharacterStats> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (key === "_comment") continue;
    if (
      typeof val === "object" &&
      val !== null &&
      typeof val.hp === "number" &&
      typeof val.description === "string" &&
      typeof val.damageMin === "number" &&
      typeof val.damageMax === "number"
    ) {
      result[key] = {
        hp: val.hp,
        description: val.description,
        damageMin: val.damageMin,
        damageMax: val.damageMax,
        specialAbility: typeof val.specialAbility === "string" ? val.specialAbility : undefined,
      };
    }
  }
  return result;
})();

// ─── Match state ──────────────────────────────────────────────────────────────

export type MatchStatus =
  | "waiting"
  | "active"
  | "completed"
  | "forfeited"
  | "draw";

export interface Match {
  id: string;
  status: MatchStatus;
  agentAName: string;
  agentBName: string;
  agentASocketId: string;
  agentBSocketId: string;
  characterA: CharacterClass;
  characterB: CharacterClass;
  currentTurn: number;
  hpA: number;
  hpB: number;
  actionA: string;
  actionB: string;
  createdAt: string;
  startedAt: string;
  endedAt: string;
}

// ─── Turn / feed records ──────────────────────────────────────────────────────

export interface TurnRecord {
  turnNumber: number;
  actionA: string;
  actionB: string;
  narrative: string;
  hpA: number;
  hpB: number;
  timestamp: string;
}

export interface FeedItem {
  title: string;
  description: string;
  matchId: string;
  pubDate: string;
}

// ─── GM adjudication ──────────────────────────────────────────────────────────

export interface GmResult {
  damageA: number;
  damageB: number;
  narrative: string;
}

// ─── Socket.io payloads — Client → Server ────────────────────────────────────

export interface JoinMatchPayload {
  matchId?: string;
  agentName: string;
  character: CharacterClass;
}

export interface ActionPayload {
  payload: string;
}

// ─── Socket.io payloads — Server → Client ────────────────────────────────────

export interface MatchCreatedPayload {
  matchId: string;
}

export interface WaitingForOpponentPayload {
  matchId: string;
}

export interface MatchStartPayload {
  matchId: string;
  opponentName: string;
  yourHp: number;
  opponentHp: number;
  yourCharacter: CharacterClass;
  opponentCharacter: CharacterClass;
}

export interface YourTurnPayload {
  turn: number;
  state: { hpSelf: number; hpOpponent: number };
  deadline: number;
}

export interface TurnResultPayload {
  turn: number;
  narrative: string;
  state: { hpA: number; hpB: number };
}

export interface MatchOverPayload {
  winner: string;
  finalNarrative: string;
}

export interface ErrorPayload {
  message: string;
}

// ─── Redis key helpers ────────────────────────────────────────────────────────

export const REDIS_KEYS = {
  match: (id: string) => `battle:match:${id}`,
  turns: (id: string) => `battle:match:${id}:turns`,
  activeMatches: "battle:matches:active",
  feed: "battle:feed",
} as const;

// ─── Game constants ───────────────────────────────────────────────────────────

export const MATCH_TTL_SECONDS = 3 * 60 * 60; // 3 hours
export const TURN_TIMEOUT_MS = parseInt(
  process.env.MATCH_TURN_TIMEOUT_MS ?? "30000",
  10
);
export const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? "50", 10);
export const FEED_CAP = 200;
export const DISCONNECT_GRACE_MS = 10_000;
