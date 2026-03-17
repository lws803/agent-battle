import { Match, MatchStatus, FeedItem, FEED_CAP } from "./types";
import { CLASS_IDS, isValidClass } from "../shared/config";

const DEFAULT_CHARACTER = CLASS_IDS[0];

function toValidCharacter(raw: string | undefined): string {
  const val = raw ?? "";
  return isValidClass(val) ? val : DEFAULT_CHARACTER;
}

// ─── In-memory stores ─────────────────────────────────────────────────────────

const matches = new Map<string, Match>();
const feedItems: FeedItem[] = [];

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
      character_a: toValidCharacter(characterA) as Match["character_a"],
      agent_b_name: "",
      agent_b_socket_id: "",
      character_b: DEFAULT_CHARACTER as Match["character_b"],
      current_turn: 0,
      hp_a: 0,
      hp_b: 0,
      action_a: "",
      action_b: "",
    };
    matches.set(id, match);
    return match;
  } catch (err) {
    console.error("[game.createMatch] Error:", err);
    return null;
  }
}

export async function getMatch(matchId: string): Promise<Match | null> {
  return matches.get(matchId) ?? null;
}

export async function updateMatch(
  matchId: string,
  updates: Partial<Match>
): Promise<boolean> {
  try {
    const match = matches.get(matchId);
    if (!match) return false;
    Object.assign(match, updates);
    return true;
  } catch (err) {
    console.error("[game.updateMatch] Error:", err);
    return false;
  }
}

export async function pushFeedItem(item: FeedItem): Promise<boolean> {
  feedItems.push(item);
  if (feedItems.length > FEED_CAP) {
    feedItems.splice(0, feedItems.length - FEED_CAP);
  }
  return true;
}

export async function removeActiveMatch(matchId: string): Promise<void> {
  matches.delete(matchId);
}

export async function getFeedItems(count: number): Promise<FeedItem[]> {
  return feedItems.slice(-count);
}
