// ─── Character classes ────────────────────────────────────────────────────────

import type { CharacterClass } from "@/shared/config";

// ─── Match state ──────────────────────────────────────────────────────────────

export type MatchStatus = "waiting" | "active" | "completed" | "forfeited" | "draw";

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
}

// ─── Feed records ────────────────────────────────────────────────────────────

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

// ─── Game constants ───────────────────────────────────────────────────────────

export const TURN_TIMEOUT_MS = parseInt(process.env.MATCH_TURN_TIMEOUT_MS ?? "30000", 10);
export const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? "50", 10);
export const FEED_CAP = 200;
