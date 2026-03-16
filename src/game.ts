import redis from "./redis";
import {
  Match,
  MatchStatus,
  FeedItem,
  REDIS_KEYS,
  MATCH_TTL_SECONDS,
  FEED_CAP,
} from "./types";
import { CLASS_IDS, isValidClass } from "./config";

const DEFAULT_CHARACTER = CLASS_IDS[0];

function toValidCharacter(raw: string | undefined): string {
  const val = raw ?? "";
  return isValidClass(val) ? val : DEFAULT_CHARACTER;
}

// ─── Hash serialization ───────────────────────────────────────────────────────

function matchToHash(m: Partial<Match>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    if (v !== undefined) result[k] = String(v);
  }
  return result;
}

function matchFromHash(h: Record<string, string>): Match {
  return {
    id: h["id"] ?? "",
    status: (h["status"] ?? "waiting") as MatchStatus,
    agent_a_name: h["agent_a_name"] ?? "",
    agent_b_name: h["agent_b_name"] ?? "",
    agent_a_socket_id: h["agent_a_socket_id"] ?? "",
    agent_b_socket_id: h["agent_b_socket_id"] ?? "",
    character_a: toValidCharacter(h["character_a"]),
    character_b: toValidCharacter(h["character_b"]),
    current_turn: parseInt(h["current_turn"] ?? "0", 10),
    hp_a: parseInt(h["hp_a"] ?? "0", 10),
    hp_b: parseInt(h["hp_b"] ?? "0", 10),
    action_a: h["action_a"] ?? "",
    action_b: h["action_b"] ?? "",
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createMatch(
  agentAName: string,
  agentASocketId: string,
  characterA: string
): Promise<Match | null> {
  try {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const match: Match = {
      id,
      status: "waiting",
      agent_a_name: agentAName,
      agent_a_socket_id: agentASocketId,
      character_a: characterA,
      agent_b_name: "",
      agent_b_socket_id: "",
      character_b: DEFAULT_CHARACTER,
      current_turn: 0,
      hp_a: 0,
      hp_b: 0,
      action_a: "",
      action_b: "",
    };
    const key = REDIS_KEYS.match(id);
    await redis.hset(key, matchToHash(match));
    await redis.expire(key, MATCH_TTL_SECONDS);
    await redis.sadd(REDIS_KEYS.activeMatches, id);
    return match;
  } catch (err) {
    console.error("[game.createMatch] Error:", err);
    return null;
  }
}

export async function getMatch(matchId: string): Promise<Match | null> {
  try {
    const hash = await redis.hgetall(REDIS_KEYS.match(matchId));
    if (!hash || Object.keys(hash).length === 0) return null;
    return matchFromHash(hash);
  } catch (err) {
    console.error("[game.getMatch] Error:", err);
    return null;
  }
}

export async function updateMatch(
  matchId: string,
  updates: Partial<Match>
): Promise<boolean> {
  try {
    const key = REDIS_KEYS.match(matchId);
    await redis.hset(key, matchToHash(updates));
    await redis.expire(key, MATCH_TTL_SECONDS);
    return true;
  } catch (err) {
    console.error("[game.updateMatch] Error:", err);
    return false;
  }
}

export async function pushFeedItem(item: FeedItem): Promise<boolean> {
  try {
    const key = REDIS_KEYS.feed;
    await redis.rpush(key, JSON.stringify(item));
    await redis.ltrim(key, -FEED_CAP, -1);
    return true;
  } catch (err) {
    console.error("[game.pushFeedItem] Error:", err);
    return false;
  }
}

export async function removeActiveMatch(matchId: string): Promise<void> {
  try {
    await redis.srem(REDIS_KEYS.activeMatches, matchId);
  } catch (err) {
    console.error("[game.removeActiveMatch] Error:", err);
  }
}

export async function getFeedItems(count: number): Promise<FeedItem[]> {
  try {
    const raw = await redis.lrange(REDIS_KEYS.feed, -count, -1);
    return raw.map((s) => JSON.parse(s) as FeedItem);
  } catch (err) {
    console.error("[game.getFeedItems] Error:", err);
    return [];
  }
}
