import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { JoinMatchPayload, ActionPayload, CHARACTER_STATS } from "./types.js";
import { createMatch, getMatch, updateMatch } from "./game.js";
import {
  registerTurnEngine,
  startMatch,
  receiveAction,
  handleDisconnect,
} from "./turnEngine.js";
import { buildRssFeed } from "./feedService.js";

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: "*" },
});

registerTurnEngine(io);

// ─── HTTP routes ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.get("/feed.xml", async (_req, res) => {
  try {
    const xml = await buildRssFeed();
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.send(xml);
  } catch (err) {
    console.error("[feed] Error building RSS:", err);
    res.status(500).send("Feed unavailable");
  }
});

// ─── Socket.io ────────────────────────────────────────────────────────────────

// socketId → matchId for fast disconnect lookup
const socketToMatch = new Map<string, string>();

io.on("connection", (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  socket.on("JOIN_MATCH", async (payload: JoinMatchPayload) => {
    try {
      const { matchId, agentName, character } = payload;

      if (!agentName || agentName.trim() === "") {
        socket.emit("ERROR", { message: "agentName is required." });
        return;
      }

      if (!CHARACTER_STATS[character]) {
        const validClasses = Object.keys(CHARACTER_STATS).join(", ");
        socket.emit("ERROR", {
          message: `Invalid character "${character}". Choose: ${validClasses}.`,
        });
        return;
      }

      // ── Join an existing match ──
      if (matchId) {
        const existing = await getMatch(matchId);
        if (!existing) {
          socket.emit("ERROR", { message: `Match ${matchId} not found.` });
          return;
        }
        if (existing.status !== "waiting") {
          socket.emit("ERROR", {
            message: `Match ${matchId} is not open for joining.`,
          });
          return;
        }

        await updateMatch(matchId, {
          agentBName: agentName.trim(),
          agentBSocketId: socket.id,
          characterB: character,
        });

        socketToMatch.set(socket.id, matchId);
        socketToMatch.set(existing.agentASocketId, matchId);

        socket.emit("MATCH_CREATED", { matchId });
        await startMatch(matchId);
        return;
      }

      // ── Create a new match ──
      const newMatch = await createMatch(
        agentName.trim(),
        socket.id,
        character
      );
      if (!newMatch) {
        socket.emit("ERROR", { message: "Failed to create match. Try again." });
        return;
      }

      socketToMatch.set(socket.id, newMatch.id);
      socket.emit("MATCH_CREATED", { matchId: newMatch.id });
      socket.emit("WAITING_FOR_OPPONENT", { matchId: newMatch.id });
    } catch (err) {
      console.error("[JOIN_MATCH] Error:", err);
      socket.emit("ERROR", {
        message: "Internal server error during JOIN_MATCH.",
      });
    }
  });

  socket.on("ACTION", async (payload: ActionPayload) => {
    try {
      const matchId = socketToMatch.get(socket.id);
      if (!matchId) {
        socket.emit("ERROR", { message: "You are not in a match." });
        return;
      }

      const match = await getMatch(matchId);
      if (!match || match.status !== "active") {
        socket.emit("ERROR", { message: "No active match to act in." });
        return;
      }

      await receiveAction(matchId, socket.id, payload.payload ?? "");
    } catch (err) {
      console.error("[ACTION] Error:", err);
      socket.emit("ERROR", { message: "Internal server error during ACTION." });
    }
  });

  socket.on("disconnect", async () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    const matchId = socketToMatch.get(socket.id);
    if (matchId) {
      try {
        const match = await getMatch(matchId);
        if (match?.status === "active") {
          handleDisconnect(socket.id, matchId);
        }
      } catch (err) {
        console.error("[disconnect] Error:", err);
      }
      socketToMatch.delete(socket.id);
    }
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3000", 10);
httpServer.listen(PORT, () => {
  console.log(`[Server] Agent Battle listening on port ${PORT}`);
});
