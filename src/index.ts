import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

import { JoinMatchPayload, ActionPayload } from "./types";
import { isValidClass, CLASS_IDS } from "./config";
import { createMatch, getMatch, updateMatch } from "./game";
import {
  registerTurnEngine,
  startMatch,
  receiveAction,
  handleDisconnect,
} from "./turn-engine";
import { buildRssFeed } from "./feed-service";

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();

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
      const { match_id, agent_name, character } = payload;

      if (!agent_name || agent_name.trim() === "") {
        socket.emit("ERROR", { message: "agent_name is required." });
        return;
      }

      if (!isValidClass(character)) {
        socket.emit("ERROR", {
          message: `Invalid character "${character}". Choose: ${CLASS_IDS.join(
            ", "
          )}.`,
        });
        return;
      }

      // ── Join an existing match ──
      if (match_id) {
        const existing = await getMatch(match_id);
        if (!existing) {
          socket.emit("ERROR", { message: `Match ${match_id} not found.` });
          return;
        }
        if (existing.status !== "waiting") {
          socket.emit("ERROR", {
            message: `Match ${match_id} is not open for joining.`,
          });
          return;
        }

        await updateMatch(match_id, {
          agent_b_name: agent_name.trim(),
          agent_b_socket_id: socket.id,
          character_b: character,
        });

        socketToMatch.set(socket.id, match_id);
        socketToMatch.set(existing.agent_a_socket_id, match_id);

        socket.emit("MATCH_CREATED", { match_id });
        await startMatch(match_id);
        return;
      }

      // ── Create a new match ──
      const newMatch = await createMatch(
        agent_name.trim(),
        socket.id,
        character
      );
      if (!newMatch) {
        socket.emit("ERROR", { message: "Failed to create match. Try again." });
        return;
      }

      socketToMatch.set(socket.id, newMatch.id);
      socket.emit("MATCH_CREATED", { match_id: newMatch.id });
      socket.emit("WAITING_FOR_OPPONENT", { match_id: newMatch.id });
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
