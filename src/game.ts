import redis from "./redis.js";
import {
  Match,
  MatchStatus,
  CharacterClass,
  TurnRecord,
  FeedItem,
  REDIS_KEYS,
  MATCH_TTL_SECONDS,
  FEED_CAP,
} from "./types.js";

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
    agentAName: h["agentAName"] ?? "",
    agentBName: h["agentBName"] ?? "",
    agentASocketId: h["agentASocketId"] ?? "",
    agentBSocketId: h["agentBSocketId"] ?? "",
    characterA: (h["characterA"] ?? "warrior") as CharacterClass,
    characterB: (h["characterB"] ?? "warrior") as CharacterClass,
    currentTurn: parseInt(h["currentTurn"] ?? "0", 10),
    hpA: parseInt(h["hpA"] ?? "0", 10),
    hpB: parseInt(h["hpB"] ?? "0", 10),
    actionA: h["actionA"] ?? "",
    actionB: h["actionB"] ?? "",
    createdAt: h["createdAt"] ?? "",
    startedAt: h["startedAt"] ?? "",
    endedAt: h["endedAt"] ?? "",
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createMatch(
  agentAName: string,
  agentASocketId: string,
  characterA: CharacterClass
): Promise<Match | null> {
  try {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const now = new Date().toISOString();
    const match: Match = {
      id,
      status: "waiting",
      agentAName,
      agentASocketId,
      characterA,
      agentBName: "",
      agentBSocketId: "",
      characterB: "warrior",
      currentTurn: 0,
      hpA: 0,
      hpB: 0,
      actionA: "",
      actionB: "",
      createdAt: now,
      startedAt: "",
      endedAt: "",
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

export async function pushTurnRecord(
  matchId: string,
  record: TurnRecord
): Promise<boolean> {
  try {
    const key = REDIS_KEYS.turns(matchId);
    await redis.rpush(key, JSON.stringify(record));
    await redis.expire(key, MATCH_TTL_SECONDS);
    return true;
  } catch (err) {
    console.error("[game.pushTurnRecord] Error:", err);
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
