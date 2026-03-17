#!/usr/bin/env bun
/**
 * agent.ts — AI-powered battle agent
 *
 * Usage:
 *   bun client/agent.ts [options]
 *
 * Options:
 *   --name      <string>   Your agent name                        (default: "Agent")
 *   --class     <string>   warrior | mage | rogue                 (default: random)
 *   --persona   <string>   System prompt describing your AI's personality/strategy
 *   --match-id  <string>   Join an existing match (omit to create a new room)
 *   --url       <string>   Server URL                             (default: "http://localhost:3000")
 *   --help                 Show this help
 *
 * Examples:
 *   # Terminal 1 — creates a room
 *   bun client/agent.ts --name Gandalf --class mage \
 *     --persona "You are a wise and cunning archmage. Favour powerful spells and clever feints."
 *
 *   # Terminal 2 — joins the room (use match_id printed by terminal 1)
 *   bun client/agent.ts --name Sauron --class warrior --match-id <matchId> \
 *     --persona "You are a ruthless dark lord. Attack relentlessly, show no mercy."
 */

import { io, Socket } from "socket.io-client";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { parseArgs } from "util";

import { CLASS_IDS, isValidClass } from "@/shared/config";

// ─── CLI ──────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    name: { type: "string", default: "Agent" },
    class: { type: "string" },
    persona: {
      type: "string",
      default: "You are a fierce combatant. Fight with honour and cunning.",
    },
    "match-id": { type: "string" },
    url: { type: "string", default: "http://localhost:3000" },
    help: { type: "boolean", default: false },
  },
  strict: false,
});

if (values.help) {
  console.log(`
agent.ts — AI-powered battle agent

Usage:
  npx tsx scripts/agent.ts [options]

Options:
  --name      Your agent display name                      (default: Agent)
  --class     ${CLASS_IDS.join(" | ")}                       (default: random)
  --persona   System prompt for the AI's personality       (default: generic fighter)
  --match-id  Join an existing match ID (omit to create)
  --url       Server URL                                   (default: http://localhost:3000)
  --help      Show this help

Examples:
  # Create a room (Terminal 1)
  npx tsx scripts/agent.ts --name Gandalf --class mage \\
    --persona "You are a wise archmage who favours lightning spells and illusions."

  # Join that room (Terminal 2) — copy the match_id printed above
  npx tsx scripts/agent.ts --name Sauron --class warrior --match-id abc12345 \\
    --persona "You are a dark overlord. Crush your enemy with brute force and dark magic."
`);
  process.exit(0);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const AGENT_NAME = values.name as string;
const PERSONA = values.persona as string;
const MATCH_ID = values["match-id"] as string | undefined;
const SERVER_URL = values.url as string;

const classArg = typeof values.class === "string" ? values.class : undefined;
const AGENT_CLASS =
  classArg && isValidClass(classArg)
    ? classArg
    : CLASS_IDS[Math.floor(Math.random() * CLASS_IDS.length)];

// ─── Colours ──────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const label = `${C.blue}${C.bold}[${AGENT_NAME}]${C.reset}`;

// ─── AI action generation ─────────────────────────────────────────────────────

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
});

interface TurnState {
  turn: number;
  myHp: number;
  opponentHp: number;
  opponentName: string;
  myClass: string;
  opponentClass: string;
  lastNarrative: string;
}

async function decideAction(state: TurnState): Promise<string> {
  const systemPrompt =
    `${PERSONA}\n\n` +
    `You are playing as ${AGENT_NAME}, a ${state.myClass} in a turn-based fantasy battle.\n` +
    `Respond with a single short action in plain English (1-2 sentences max). ` +
    `Be creative and in-character. Do not include any explanation or meta-commentary — only the action itself.`;

  const userPrompt =
    `Turn ${state.turn}.\n` +
    `Your HP: ${state.myHp} | Opponent (${state.opponentName}, ${state.opponentClass}): ${state.opponentHp} HP\n` +
    (state.lastNarrative ? `Last turn: ${state.lastNarrative}\n` : "") +
    `What do you do this turn?`;

  try {
    const { text } = await generateText({
      model: openrouter.chat("anthropic/claude-sonnet-4-5"),
      maxOutputTokens: 100,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    return text.trim();
  } catch (err) {
    console.error(`${label} ${C.red}AI error, using fallback action${C.reset}`, err);
    return "I steel myself and strike at my opponent!";
  }
}

// ─── Agent ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${C.bold}Agent Battle — AI Agent${C.reset}`);
  console.log(
    `${C.dim}Name: ${AGENT_NAME} | Class: ${AGENT_CLASS} | Server: ${SERVER_URL}${C.reset}`
  );
  console.log(`${C.dim}Persona: ${PERSONA}${C.reset}\n`);

  let opponentName = "Opponent";
  let opponentClass: string = "unknown";
  let myClass: string = AGENT_CLASS;
  let lastNarrative = "";

  const socket: Socket = io(SERVER_URL, { reconnection: false });

  socket.on("connect", () => {
    console.log(`${label} Connected to ${SERVER_URL}`);
    socket.emit("JOIN_MATCH", {
      agent_name: AGENT_NAME,
      character: AGENT_CLASS,
      match_id: MATCH_ID,
    });
  });

  socket.on("MATCH_CREATED", (d: { match_id: string }) => {
    console.log(`${label} ${C.yellow}Match ID: ${C.bold}${d.match_id}${C.reset}`);
    if (!MATCH_ID) {
      console.log(
        `${label} ${C.dim}Share this match_id with your opponent: --match-id ${d.match_id}${C.reset}`
      );
    }
  });

  socket.on("WAITING_FOR_OPPONENT", () => {
    console.log(`${label} ${C.dim}Waiting for opponent to join…${C.reset}`);
  });

  socket.on(
    "MATCH_START",
    (d: {
      opponent_name: string;
      your_hp: number;
      opponent_hp: number;
      your_character: string;
      opponent_character: string;
    }) => {
      opponentName = d.opponent_name;
      opponentClass = d.opponent_character;
      myClass = d.your_character;
      console.log(
        `\n${label} ${C.bold}Fight!${C.reset} ` +
          `${C.green}${myClass}${C.reset} (${d.your_hp} HP) vs ` +
          `${C.red}${opponentName}${C.reset} the ${opponentClass} (${d.opponent_hp} HP)\n`
      );
    }
  );

  socket.on(
    "YOUR_TURN",
    async (d: {
      turn: number;
      state: { hp_self: number; hp_opponent: number };
      deadline: number;
    }) => {
      const timeLeft = Math.round((d.deadline - Date.now()) / 1000);
      console.log(
        `${label} Turn ${C.bold}${d.turn}${C.reset} | ` +
          `HP ${C.green}${d.state.hp_self}${C.reset} vs ${C.red}${d.state.hp_opponent}${C.reset} | ` +
          `${C.dim}${timeLeft}s remaining${C.reset}`
      );
      console.log(`${label} ${C.dim}Thinking…${C.reset}`);

      const action = await decideAction({
        turn: d.turn,
        myHp: d.state.hp_self,
        opponentHp: d.state.hp_opponent,
        opponentName,
        myClass,
        opponentClass,
        lastNarrative,
      });

      console.log(`${label} ${C.cyan}→ "${action}"${C.reset}`);
      socket.emit("ACTION", { payload: action });
    }
  );

  socket.on(
    "TURN_RESULT",
    (d: { turn: number; narrative: string; state: { hp_a: number; hp_b: number } }) => {
      lastNarrative = d.narrative;
      console.log(`\n  ${C.magenta}${C.bold}GM:${C.reset} ${C.magenta}${d.narrative}${C.reset}`);
      console.log(`  ${C.dim}HP — A: ${d.state.hp_a} | B: ${d.state.hp_b}${C.reset}\n`);
    }
  );

  socket.on("MATCH_OVER", (d: { winner: string; final_narrative: string }) => {
    const isWinner = d.winner === AGENT_NAME;
    const isDraw = d.winner === "draw";
    const color = isDraw ? C.yellow : isWinner ? C.green : C.red;
    console.log(`\n${C.bold}━━━ MATCH OVER ━━━${C.reset}`);
    console.log(`  ${C.magenta}${d.final_narrative}${C.reset}`);
    console.log(`  Winner: ${color}${C.bold}${d.winner}${C.reset}\n`);
    socket.disconnect();
    process.exit(0);
  });

  socket.on("ERROR", (d: { message: string }) => {
    console.error(`${label} ${C.red}Error: ${d.message}${C.reset}`);
  });

  socket.on("connect_error", (err: Error) => {
    console.error(`${C.red}Cannot connect to ${SERVER_URL}: ${err.message}${C.reset}`);
    console.error(`Is the server running? → bun run dev`);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
