const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = "adminwinner";
const ADMIN_PASSWORD = "Winner@123";
const USERNAME_REGEX = /^[A-Za-z0-9]{3,}$/;

const db = {
  users: new Map(),
  onlineUsers: new Set(),
  usedCodes: new Set(),
  pendingPresses: [],
  leaderboardToday: [],
  announcements: []
};

function makeUser({ username, email = "", password = "" }) {
  return {
    id: "u_" + Math.random().toString(36).slice(2, 10),
    username,
    email,
    password,
    coins: 50,
    gems: 0,
    winStreak: 0,
    totalWins: 0,
    todayWins: 0,
    isAdmin: false,
    createdAt: new Date().toISOString()
  };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    coins: user.coins,
    gems: user.gems,
    winStreak: user.winStreak,
    totalWins: user.totalWins,
    todayWins: user.todayWins,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt
  };
}

function getTop20() {
  return [...db.users.values()]
    .filter(u => !u.isAdmin)
    .sort((a, b) => b.todayWins - a.todayWins || b.coins - a.coins)
    .slice(0, 20)
    .map((u, idx) => ({
      rank: idx + 1,
      username: u.username,
      score: u.todayWins,
      coins: u.coins
    }));
}

function createCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  do {
    code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (db.usedCodes.has(code));
  return code;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, onlineUsers: db.onlineUsers.size, users: db.users.size });
});

app.post("/api/register", (req, res) => {
  const { username, email, password, verificationCode, acceptedTerms } = req.body || {};
  if (!USERNAME_REGEX.test(username || "")) {
    return res.status(400).json({ error: "Username must be at least 3 characters and contain only English letters or numbers with no spaces." });
  }
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  if (verificationCode !== "123456") {
    return res.status(400).json({ error: "Verification code is invalid." });
  }
  if (!acceptedTerms) {
    return res.status(400).json({ error: "You must accept the terms first." });
  }
  if (db.users.has(username.toLowerCase()) || username.toLowerCase() === ADMIN_USERNAME) {
    return res.status(400).json({ error: "Username is already taken." });
  }
  const user = makeUser({ username, email, password });
  db.users.set(username.toLowerCase(), user);
  res.json({ user: sanitizeUser(user) });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return res.json({
      user: {
        id: "admin_1",
        username: ADMIN_USERNAME,
        email: "admin@winner.app",
        coins: 10000,
        gems: 999,
        winStreak: 0,
        totalWins: 0,
        todayWins: 0,
        isAdmin: true,
        createdAt: new Date().toISOString()
      }
    });
  }
  const user = db.users.get((username || "").toLowerCase());
  if (!user || user.password !== password) {
    return res.status(400).json({ error: "Invalid username or password." });
  }
  res.json({ user: sanitizeUser(user) });
});

app.post("/api/redeem", (req, res) => {
  const { username, code } = req.body || {};
  const user = db.users.get((username || "").toLowerCase());
  if (!user) return res.status(404).json({ error: "User not found." });

  const normalized = (code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(normalized)) {
    return res.status(400).json({ error: "Code must be 8 English letters/numbers." });
  }
  if (db.usedCodes.has(normalized)) {
    return res.status(400).json({ error: "This code was already used." });
  }

  db.usedCodes.add(normalized);
  user.coins += 50;
  io.emit("coins:update", { username: user.username, coins: user.coins });
  res.json({ ok: true, coins: user.coins, added: 50 });
});

app.post("/api/send-coins", (req, res) => {
  const { fromUsername, toUsername, amount } = req.body || {};
  const from = db.users.get((fromUsername || "").toLowerCase());
  const to = db.users.get((toUsername || "").toLowerCase());
  const parsedAmount = Number(amount);

  if (!from || !to) return res.status(404).json({ error: "User not found." });
  if (from.coins < 1000) return res.status(400).json({ error: "You need at least 1000 coins to unlock gifting." });
  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ error: "Invalid amount." });
  if (from.coins < parsedAmount) return res.status(400).json({ error: "Not enough coins." });

  from.coins -= parsedAmount;
  to.coins += parsedAmount;

  io.emit("coins:update", { username: from.username, coins: from.coins });
  io.emit("coins:update", { username: to.username, coins: to.coins });

  res.json({ ok: true, fromCoins: from.coins, toCoins: to.coins });
});

app.post("/api/admin/generate-codes", (req, res) => {
  const { adminUsername, adminPassword, count = 10 } = req.body || {};
  if (adminUsername !== ADMIN_USERNAME || adminPassword !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  const codes = [];
  for (let i = 0; i < Math.min(Number(count) || 10, 50); i++) {
    codes.push(createCode());
  }
  res.json({ codes });
});

app.get("/api/leaderboard", (_req, res) => {
  res.json({ leaderboard: getTop20() });
});

io.on("connection", (socket) => {
  socket.on("presence:online", ({ username }) => {
    if (!username) return;
    socket.data.username = username;
    db.onlineUsers.add(username);
    io.emit("presence:update", { onlineUsers: db.onlineUsers.size });
  });

  socket.on("disconnect", () => {
    if (socket.data.username) {
      db.onlineUsers.delete(socket.data.username);
      io.emit("presence:update", { onlineUsers: db.onlineUsers.size });
    }
  });

  socket.on("announcement", ({ username }) => {
    io.emit("announcement", { username, at: new Date().toISOString() });
  });

  socket.on("play:press", ({ username }) => {
    const user = db.users.get((username || "").toLowerCase());
    if (!user) return;
    db.pendingPresses.push({ socketId: socket.id, username, at: Date.now() });
  });
});

setInterval(() => {
  if (!db.pendingPresses.length) return;

  const batch = [...db.pendingPresses];
  db.pendingPresses = [];

  if (batch.length === 1) {
    const event = batch[0];
    const user = db.users.get(event.username.toLowerCase());
    if (!user) return;

    user.winStreak += 1;
    user.totalWins += 1;
    user.todayWins += 1;

    let delta = 1;
    let message = "You won +1 coin.";
    let awardedX10 = false;

    if (user.winStreak >= 5) {
      delta = 10;
      message = `🔥 ${user.username} won x10!`;
      user.winStreak = 0;
      awardedX10 = true;
    }

    user.coins += delta;
    io.to(event.socketId).emit("play:result", {
      message,
      delta,
      isWin: true,
      coins: user.coins,
      streak: user.winStreak,
      awardedX10
    });
    io.emit("leaderboard:update", { leaderboard: getTop20() });
    return;
  }

  batch.forEach((event) => {
    const user = db.users.get(event.username.toLowerCase());
    if (!user) return;
    user.coins = Math.max(0, user.coins - 1);
    user.winStreak = 0;
    io.to(event.socketId).emit("play:result", {
      message: "Another player pressed at the same time. You lost 1 coin.",
      delta: -1,
      isWin: false,
      coins: user.coins,
      streak: user.winStreak,
      awardedX10: false
    });
  });
  io.emit("leaderboard:update", { leaderboard: getTop20() });
}, 700);

server.listen(PORT, () => {
  console.log(`Winner server running on http://localhost:${PORT}`);
});
