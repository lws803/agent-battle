// ─── Character classes ────────────────────────────────────────────────────────

import { z } from "zod";
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

const characterStatsSchema = z.object({
  hp: z.number(),
  description: z.string(),
  damageMin: z.number(),
  damageMax: z.number(),
  specialAbility: z.string().optional(),
});

const classesConfigSchema = z
  .record(z.string(), z.unknown())
  .transform((obj) => {
    const result: Record<string, CharacterStats> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key === "_comment") continue;
      const parsed = characterStatsSchema.safeParse(val);
      if (parsed.success) {
        result[key] = parsed.data;
      }
      // Silently skip invalid entries; use .parse() instead of .safeParse()
      // and handle ZodError if you want to throw on malformed config
    }
    return result;
  });

/** All available classes, loaded from src/classes.config.json at startup. */
export const CHARACTER_STATS: Record<string, CharacterStats> =
  classesConfigSchema.parse(classesConfigRaw);

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
