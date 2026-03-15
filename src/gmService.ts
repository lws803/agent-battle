import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { GmResult, CharacterClass, CHARACTER_STATS } from "./types.js";

const FALLBACK: GmResult = {
  damageA: 10,
  damageB: 10,
  narrative: "Both fighters exchange blows in the chaos.",
};

function buildSystemPrompt(): string {
  const damageGuidelines = Object.entries(CHARACTER_STATS)
    .map(([name, stats]) => {
      const base = `${name} ${stats.damageMin}-${stats.damageMax}`;
      return stats.specialAbility ? `${base} (${stats.specialAbility})` : base;
    })
    .join(", ");

  return (
    `You are the Game Master of a turn-based fantasy battle simulator. ` +
    `Two AI agents fight simultaneously each turn (sealed bid). ` +
    `Damage guidelines: ${damageGuidelines}. ` +
    `Nonsensical or overpowered actions should be reduced in effectiveness. ` +
    `Narrative: 2-3 vivid sentences, pure prose, no lists or headers. ` +
    `Respond ONLY with valid JSON: { "damageA": number, "damageB": number, "narrative": string }`
  );
}

const SYSTEM_PROMPT = buildSystemPrompt();

export async function adjudicateTurn(
  agentAName: string,
  characterA: CharacterClass,
  hpA: number,
  actionA: string,
  agentBName: string,
  characterB: CharacterClass,
  hpB: number,
  actionB: string,
  turnNumber: number
): Promise<GmResult> {
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
  });

  const userMessage =
    `Turn ${turnNumber}\n` +
    `Agent A: ${agentAName} (${characterA}, ${hpA} HP) — Action: "${actionA}"\n` +
    `Agent B: ${agentBName} (${characterB}, ${hpB} HP) — Action: "${actionB}"\n` +
    `Adjudicate this turn.`;

  try {
    const { text } = await generateText({
      model: openrouter.chat("anthropic/claude-sonnet-4-5"),
      maxOutputTokens: 400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    // Strip possible markdown fences: ```json ... ```
    const jsonStr = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsed = JSON.parse(jsonStr) as GmResult;

    if (
      typeof parsed.damageA !== "number" ||
      typeof parsed.damageB !== "number" ||
      typeof parsed.narrative !== "string"
    ) {
      throw new Error("Invalid GM response shape");
    }

    return parsed;
  } catch (err) {
    console.error("[gmService] Adjudication error, using fallback:", err);
    return FALLBACK;
  }
}
