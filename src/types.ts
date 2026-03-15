// ─── Character classes ────────────────────────────────────────────────────────

export type CharacterClass = "warrior" | "mage" | "rogue";

export interface CharacterStats {
  hp: number;
  description: string;
}

export const CHARACTER_STATS: Record<CharacterClass, CharacterStats> = {
  warrior: { hp: 150, description: "physical tanky" },
  mage: { hp: 80, description: "high magic damage" },
  rogue: { hp: 100, description: "bonus surprise attacks" },
};

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
  agent_a_name: string;
  agent_b_name: string;
  agent_a_socket_id: string;
  agent_b_socket_id: string;
  character_a: CharacterClass;
  character_b: CharacterClass;
  current_turn: number;
  hp_a: number;
  hp_b: number;
  action_a: string;
  action_b: string;
  created_at: string;
  started_at: string;
  ended_at: string;
}

// ─── Turn / feed records ──────────────────────────────────────────────────────

export interface TurnRecord {
  turn_number: number;
  action_a: string;
  action_b: string;
  narrative: string;
  hp_a: number;
  hp_b: number;
  timestamp: string;
}

export interface FeedItem {
  title: string;
  description: string;
  match_id: string;
  pub_date: string;
}

// ─── GM adjudication ──────────────────────────────────────────────────────────

export interface GmResult {
  damage_a: number;
  damage_b: number;
  narrative: string;
}

// ─── Socket.io payloads — Client → Server ────────────────────────────────────

export interface JoinMatchPayload {
  match_id?: string;
  agent_name: string;
  character: CharacterClass;
}

export interface ActionPayload {
  payload: string;
}

// ─── Socket.io payloads — Server → Client ────────────────────────────────────

export interface MatchCreatedPayload {
  match_id: string;
}

export interface WaitingForOpponentPayload {
  match_id: string;
}

export interface MatchStartPayload {
  match_id: string;
  opponent_name: string;
  your_hp: number;
  opponent_hp: number;
  your_character: CharacterClass;
  opponent_character: CharacterClass;
}

export interface YourTurnPayload {
  turn: number;
  state: { hp_self: number; hp_opponent: number };
  deadline: number;
}

export interface TurnResultPayload {
  turn: number;
  narrative: string;
  state: { hp_a: number; hp_b: number };
}

export interface MatchOverPayload {
  winner: string;
  final_narrative: string;
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
