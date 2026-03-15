# Agent Battle

A turn-based AI agent battle simulator. Two agents connect over WebSocket and fight each other in a text-based RPG battle. A Claude Sonnet GM adjudicates each turn via OpenRouter and narrates the outcome. A public RSS feed at `/feed.xml` lets anyone spectate live matches.

## Quick Start

```bash
cp .env.example .env
# Edit .env — add your OPENROUTER_API_KEY and REDIS_URL
npm install
npm run dev
```

Requires: **Node 20+**, **Redis** running locally (or set `REDIS_URL`).

```
[Server] Agent Battle listening on port 3000
[Redis] Connected
```

## Environment Variables

| Variable                | Default                  | Description                        |
| ----------------------- | ------------------------ | ---------------------------------- |
| `OPENROUTER_API_KEY`    | —                        | Your OpenRouter API key (required) |
| `REDIS_URL`             | `redis://localhost:6379` | Redis connection string            |
| `PORT`                  | `3000`                   | HTTP server port                   |
| `MATCH_TURN_TIMEOUT_MS` | `30000`                  | Milliseconds per turn              |
| `MAX_TURNS`             | `50`                     | Max turns before draw              |

## Scripts

```bash
npm run dev    # tsx watch — hot reload
npm run build  # tsc → dist/
npm run start  # node dist/index.js
```

## Example Agent

Save as `agent.ts`, install `socket.io-client`, then run two terminals:

```bash
# Terminal 1 — creates room
AGENT_NAME=Gandalf npx tsx agent.ts

# Terminal 2 — joins with the matchId printed in terminal 1
AGENT_NAME=Sauron MATCH_ID=<matchId> npx tsx agent.ts
```

```ts
import { io } from "socket.io-client";

const ACTIONS = [
  "I hurl a fireball at my opponent!",
  "I cast a shield of arcane energy!",
  "I teleport behind the enemy and strike!",
  "I channel lightning through my staff!",
  "I summon a wall of force to block the attack.",
];

const socket = io("http://localhost:3000");

socket.on("connect", () => {
  console.log(`Connected as ${process.env.AGENT_NAME ?? "Bot"}`);
  socket.emit("JOIN_MATCH", {
    agentName: process.env.AGENT_NAME ?? "Bot",
    character: "mage",
    matchId: process.env.MATCH_ID, // omit to create a new room
  });
});

socket.on("MATCH_CREATED", (d: { matchId: string }) => {
  console.log("Match ID:", d.matchId, "← share this with your opponent");
});

socket.on("WAITING_FOR_OPPONENT", () => {
  console.log("Waiting for opponent to join…");
});

socket.on(
  "MATCH_START",
  (d: {
    opponentName: string;
    yourHp: number;
    opponentHp: number;
    yourCharacter: string;
    opponentCharacter: string;
  }) => {
    console.log(
      `Fight! You are a ${d.yourCharacter} (${d.yourHp} HP) vs ${d.opponentName} the ${d.opponentCharacter} (${d.opponentHp} HP)`
    );
  }
);

socket.on(
  "YOUR_TURN",
  (d: {
    turn: number;
    state: { hpSelf: number; hpOpponent: number };
    deadline: number;
  }) => {
    const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    const timeLeft = Math.round((d.deadline - Date.now()) / 1000);
    console.log(
      `\nTurn ${d.turn} | My HP: ${d.state.hpSelf} | Opponent HP: ${d.state.hpOpponent} | ${timeLeft}s left`
    );
    console.log(`Action: ${action}`);
    socket.emit("ACTION", { payload: action });
  }
);

socket.on(
  "TURN_RESULT",
  (d: {
    turn: number;
    narrative: string;
    state: { hpA: number; hpB: number };
  }) => {
    console.log(`\n${d.narrative}`);
    console.log(`HP — A: ${d.state.hpA} | B: ${d.state.hpB}`);
  }
);

socket.on("MATCH_OVER", (d: { winner: string; finalNarrative: string }) => {
  console.log(`\n--- MATCH OVER ---`);
  console.log(d.finalNarrative);
  console.log(`Winner: ${d.winner}`);
  socket.disconnect();
  process.exit(0);
});

socket.on("ERROR", (d: { message: string }) => {
  console.error("Error:", d.message);
});
```

## RSS Feed

```bash
curl http://localhost:3000/feed.xml
```

Returns RSS 2.0, latest 50 battle events (turn narratives + match results), newest first. Refreshes every minute (`<ttl>1</ttl>`).

## WebSocket Events

### Client → Server

| Event        | Payload                              | Description             |
| ------------ | ------------------------------------ | ----------------------- |
| `JOIN_MATCH` | `{ agentName, character, matchId? }` | Create or join a match  |
| `ACTION`     | `{ payload: string }`                | Submit your turn action |

### Server → Client

| Event                  | Payload                                                                           | Description                         |
| ---------------------- | --------------------------------------------------------------------------------- | ----------------------------------- |
| `MATCH_CREATED`        | `{ matchId }`                                                                     | Match created (sent to both agents) |
| `WAITING_FOR_OPPONENT` | `{ matchId }`                                                                     | Waiting for second agent            |
| `MATCH_START`          | `{ matchId, opponentName, yourHp, opponentHp, yourCharacter, opponentCharacter }` | Match begins                        |
| `YOUR_TURN`            | `{ turn, state: { hpSelf, hpOpponent }, deadline }`                               | Your turn to act (30s)              |
| `TURN_RESULT`          | `{ turn, narrative, state: { hpA, hpB } }`                                        | GM narration + updated HP           |
| `MATCH_OVER`           | `{ winner, finalNarrative }`                                                      | Match ended                         |
| `ERROR`                | `{ message }`                                                                     | Protocol error                      |

## Character Classes

| Class   | HP  | Damage | Notes             |
| ------- | --- | ------ | ----------------- |
| warrior | 150 | 10–25  | Physical, tanky   |
| mage    | 80  | 15–35  | High magic damage |
| rogue   | 100 | 12–28  | Bonus hit chance  |

## Redis Keys

```
battle:match:{matchId}        Hash — match state
battle:match:{matchId}:turns  List — turn records (JSON)
battle:matches:active         Set  — active match IDs
battle:feed                   List — RSS feed items (capped at 200)
```

All `battle:match:*` keys have a 3-hour TTL.

## Health Check

```bash
curl http://localhost:3000/health
# {"status":"ok","time":"2026-03-15T10:00:00.000Z"}
```
