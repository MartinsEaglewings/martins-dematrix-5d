const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const players = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    game: "Martins DeMatrix 5D Open World",
    multiplayer: true,
    online: players.size
  });
});

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(-10000, Math.min(10000, n)) : fallback;
}

io.on("connection", socket => {
  console.log("[DeMatrix] Browser connected:", socket.id);
  socket.on("player:join", payload => {
    if (socket.data.player) return;

    const username = String(payload?.username || "Player")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 20) || "Player";

    const player = {
      id: socket.id,
      username,
      x: 0,
      z: 3,
      heading: 0,
      driving: false
    };

    socket.data.player = player;
    players.set(socket.id, player);

    socket.emit("player:welcome", {
      self: player,
      players: [...players.values()].filter(p => p.id !== socket.id)
    });

    socket.broadcast.emit("player:joined", player);
    console.log(`${username} joined (${players.size} online)`);
  });

  socket.on("player:update", state => {
    const player = players.get(socket.id);
    if (!player || !state) return;

    player.x = safeNumber(state.x, player.x);
    player.z = safeNumber(state.z, player.z);
    player.heading = safeNumber(state.heading, player.heading);
    player.driving = Boolean(state.driving);

    socket.broadcast.emit("player:moved", player);
  });



  socket.on("player:punch", payload => {
    const attacker = players.get(socket.id);
    const targetId = String(payload?.targetId || "");
    const target = players.get(targetId);
    const now = Date.now();

    if (!attacker || !target || targetId === socket.id) return;
    if (now - (socket.data.lastPunchAt || 0) < 500) return;
    socket.data.lastPunchAt = now;

    if (attacker.driving || target.driving) {
      socket.emit("player:punch:result", {
        message: "Both players must be on foot."
      });
      return;
    }

    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001 || distance > 3.2) {
      socket.emit("player:punch:result", {
        message: "Move closer to the player."
      });
      return;
    }

    const facing = (dx * -Math.sin(attacker.heading) +
                    dz * -Math.cos(attacker.heading)) / distance;
    if (facing < 0.15) {
      socket.emit("player:punch:result", {
        message: "Face the player before punching."
      });
      return;
    }

    target.x = safeNumber(target.x + dx / distance * 0.8, target.x);
    target.z = safeNumber(target.z + dz / distance * 0.8, target.z);

    socket.emit("player:punch:result", {
      message: "You punched " + target.username + "!"
    });
    io.to(targetId).emit("player:hit", {
      username: attacker.username,
      x: target.x,
      z: target.z
    });
    io.emit("player:moved", target);
  });

  // Relay WebRTC setup messages; actual audio stays peer-to-peer.
  function relayVoice(eventName, payload, field) {
    const target = String(payload?.to || "");
    if (!target || target === socket.id ||
        !players.has(socket.id) || !players.has(target)) return;
    if (!payload?.[field]) return;
    socket.to(target).emit(eventName, {
      from: socket.id,
      [field]: payload[field]
    });
  }

  socket.on("voice:offer", payload =>
    relayVoice("voice:offer", payload, "sdp"));
  socket.on("voice:answer", payload =>
    relayVoice("voice:answer", payload, "sdp"));
  socket.on("voice:ice", payload =>
    relayVoice("voice:ice", payload, "candidate"));
  socket.on("voice:leave", payload => {
    const target = String(payload?.to || "");
    if (target && target !== socket.id) {
      socket.to(target).emit("voice:leave", { from: socket.id });
    }
  });

  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (!player) return;

    players.delete(socket.id);
    socket.broadcast.emit("player:left", socket.id);
    console.log(`${player.username} left (${players.size} online)`);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Martins DeMatrix running on port ${PORT}`);
  console.log("Multiplayer server ready");
});
