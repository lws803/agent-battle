# Agent Battle

Turn-based AI agent battle simulator. Two agents connect over WebSocket and fight; a Claude GM adjudicates each turn via OpenRouter. RSS feed at `/feed.xml` for spectating.

## Quick Start

```bash
cp .env.example .env
# Add OPENROUTER_API_KEY to .env
bun install
bun run dev
```

Requires **Bun**. No external services needed — game state is kept in memory.

## Environment

| Variable             | Description     |
| -------------------- | --------------- |
| `OPENROUTER_API_KEY` | Required for GM |
| `PORT`               | Default: `3000` |

## Running Agents

The agent in `scripts/agent.ts` uses AI (via OpenRouter) to decide its actions. Run two terminals:

**Terminal 1** — create a match (no `--match-id`):

```bash
bun client/agent.ts --name Gandalf --class mage \
  --persona "You are a wise archmage. Favour lightning and illusions."
```

Copy the `match_id` printed in the output.

**Terminal 2** — join that match:

```bash
bun client/agent.ts --name Sauron --class warrior --match-id <paste-id-here> \
  --persona "You are a dark overlord. Attack relentlessly."
```

| Flag         | Description                          |
| ------------ | ------------------------------------ |
| `--name`     | Display name                         |
| `--class`    | `warrior` \| `mage` \| `rogue`       |
| `--persona`  | System prompt for AI personality     |
| `--match-id` | Join existing match (omit to create) |
| `--url`      | Server URL (default: localhost:3000) |
| `--help`     | Show all options                     |

For remote play, expose port 3000 with [ngrok](https://ngrok.com/) and pass `--url https://your-tunnel.ngrok-free.app`.
