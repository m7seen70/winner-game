const socket = io();

const state = {
  user: null,
  isAdmin: false,
  onlineUsers: 0,
  activities: [],
  leaderboard: [],
  adminGeneratedCodes: [],
  playLocked: false
};

const el = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  el(id).classList.add('active');
}

function setMsg(id, text, success = false) {
  const node = el(id);
  node.textContent = text || "";
  node.classList.toggle('success', !!success);
}

function validUsername(v) {
  return /^[A-Za-z0-9]{3,}$/.test(v || "");
}

function api(path, method = "GET", body) {
  return fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  }).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Request failed");
    return data;
  });
}

function saveSession() {
  localStorage.setItem("winner_session", JSON.stringify({
    user: state.user,
    isAdmin: state.isAdmin
  }));
}

function loadSession() {
  const raw = localStorage.getItem("winner_session");
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data.user) {
      state.user = data.user;
      state.isAdmin = !!data.isAdmin;
      openApp();
    }
  } catch {}
}

function clearSession() {
  localStorage.removeItem("winner_session");
}

function addActivity(text, delta = 0) {
  state.activities.unshift({ text, delta, at: new Date().toLocaleTimeString() });
  state.activities = state.activities.slice(0, 8);
  renderActivities();
}

function renderActivities() {
  const root = el("activityList");
  if (!state.activities.length) {
    root.innerHTML = `<div class="card small muted">No activity yet.</div>`;
    return;
  }

  root.innerHTML = state.activities.map(item => `
    <div class="list-item activity-item">
      <div>
        <div>${item.text}</div>
        <small>${item.at}</small>
      </div>
      <strong class="delta ${item.delta >= 0 ? 'plus' : 'minus'}">${item.delta >= 0 ? '+' : ''}${item.delta}</strong>
    </div>
  `).join("");
}

function renderUser() {
  if (!state.user) return;
  el("coinsValue").textContent = state.user.coins;
  el("streakValue").textContent = state.user.winStreak;
  el("usernameValue").textContent = state.user.username;
  el("onlineUsersValue").textContent = state.onlineUsers;
  el("adminOnlineUsers").textContent = state.onlineUsers;
  el("adminTotalCoins").textContent = state.user.isAdmin ? "Realtime demo" : state.user.coins;
  el("openSendCoinsBtn").classList.toggle("hidden", state.user.coins < 1000);
  el("adminTabBtn").classList.toggle("hidden", !state.user.isAdmin);
}

function renderLeaderboard() {
  const root = el("leaderboardList");
  if (!state.leaderboard.length) {
    root.innerHTML = `<div class="card small muted">No leaderboard data yet.</div>`;
    return;
  }
  root.innerHTML = state.leaderboard.map(item => `
    <div class="list-item">
      <span>#${item.rank} ${item.username}</span>
      <strong>${item.score} wins</strong>
    </div>
  `).join("");
}

function renderCodes() {
  const root = el("generatedCodes");
  root.innerHTML = state.adminGeneratedCodes.map(code => `
    <div class="list-item code-item">
      <span>${code}</span>
      <strong>50 coins</strong>
    </div>
  `).join("");
}

function openTab(tab) {
  const views = {
    home: "homeView",
    board: "leaderboardView",
    store: "storeView",
    admin: "adminView"
  };
  Object.values(views).forEach(id => el(id).classList.add("hidden"));
  el(views[tab]).classList.remove("hidden");

  document.querySelectorAll(".nav [data-tab]").forEach(b => b.classList.remove("active"));
  const active = document.querySelector(`.nav [data-tab="${tab}"]`);
  if (active) active.classList.add("active");
}

async function openApp() {
  showScreen("app");
  renderUser();
  renderActivities();
  const data = await api("/api/leaderboard");
  state.leaderboard = data.leaderboard;
  renderLeaderboard();
  socket.emit("presence:online", { username: state.user.username });
  openTab("home");
}

function flashAnnouncement() {
  el("flash").classList.remove("hidden");
  setTimeout(() => el("flash").classList.add("hidden"), 850);
}

el("goLogin").addEventListener("click", () => showScreen("login"));
el("goRegister").addEventListener("click", () => showScreen("register"));
document.querySelectorAll("[data-back]").forEach(btn => btn.addEventListener("click", () => showScreen("landing")));

el("sendCodeBtn").addEventListener("click", () => {
  setMsg("regMsg", "Verification code sent. Demo code is 123456", true);
});

el("registerBtn").addEventListener("click", async () => {
  const username = el("regUsername").value.trim();
  const email = el("regEmail").value.trim();
  const password = el("regPassword").value.trim();
  const verificationCode = el("regCode").value.trim();
  const acceptedTerms = el("regTerms").checked;

  try {
    const data = await api("/api/register", "POST", {
      username, email, password, verificationCode, acceptedTerms
    });
    state.user = data.user;
    state.isAdmin = false;
    saveSession();
    addActivity("Account created", 0);
    await openApp();
  } catch (err) {
    setMsg("regMsg", err.message);
  }
});

el("loginBtn").addEventListener("click", async () => {
  const username = el("loginUsername").value.trim();
  const password = el("loginPassword").value.trim();
  try {
    const data = await api("/api/login", "POST", { username, password });
    state.user = data.user;
    state.isAdmin = !!data.user.isAdmin;
    saveSession();
    addActivity("Logged in", 0);
    await openApp();
  } catch (err) {
    setMsg("loginMsg", err.message);
  }
});

el("coinsCard").addEventListener("click", () => el("rechargeBox").classList.toggle("hidden"));

el("redeemBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/redeem", "POST", {
      username: state.user.username,
      code: el("redeemCode").value.trim()
    });
    state.user.coins = data.coins;
    addActivity(`Redeemed code +${data.added}`, data.added);
    renderUser();
    setMsg("redeemMsg", "Code accepted.", true);
  } catch (err) {
    setMsg("redeemMsg", err.message);
  }
});

el("openSendCoinsBtn").addEventListener("click", () => el("sendCoinsBox").classList.toggle("hidden"));

el("sendCoinsBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/send-coins", "POST", {
      fromUsername: state.user.username,
      toUsername: el("sendToUsername").value.trim(),
      amount: Number(el("sendAmount").value)
    });
    state.user.coins = data.fromCoins;
    addActivity(`Sent ${el("sendAmount").value} coins to ${el("sendToUsername").value.trim()}`, -Number(el("sendAmount").value));
    renderUser();
    setMsg("sendCoinsMsg", "Coins sent.", true);
  } catch (err) {
    setMsg("sendCoinsMsg", err.message);
  }
});

el("announcementBtn").addEventListener("click", () => {
  if ((state.user?.coins || 0) < 5) {
    el("resultText").textContent = "Not enough coins for announcement.";
    return;
  }
  state.user.coins -= 5;
  renderUser();
  addActivity("Sent global announcement", -5);
  socket.emit("announcement", { username: state.user.username });
});

el("playBtn").addEventListener("click", () => {
  if (state.playLocked || !state.user || state.user.isAdmin) return;
  state.playLocked = true;
  el("playBtn").classList.add("red");
  socket.emit("play:press", { username: state.user.username });

  setTimeout(() => {
    state.playLocked = false;
    el("playBtn").classList.remove("red");
  }, 3000);
});

el("generateCodesBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/admin/generate-codes", "POST", {
      adminUsername: state.user.username,
      adminPassword: "Winner@123",
      count: Number(el("generateCount").value)
    });
    state.adminGeneratedCodes = data.codes;
    renderCodes();
  } catch (err) {
    alert(err.message);
  }
});

document.querySelectorAll(".nav [data-tab]").forEach(btn => {
  btn.addEventListener("click", () => openTab(btn.dataset.tab));
});

el("logoutBtn").addEventListener("click", () => {
  clearSession();
  state.user = null;
  state.isAdmin = false;
  state.activities = [];
  showScreen("landing");
});

socket.on("presence:update", ({ onlineUsers }) => {
  state.onlineUsers = onlineUsers;
  renderUser();
});

socket.on("announcement", ({ username }) => {
  flashAnnouncement();
  addActivity(`Announcement by ${username}`, 0);
});

socket.on("coins:update", ({ username, coins }) => {
  if (state.user && state.user.username === username) {
    state.user.coins = coins;
    renderUser();
  }
});

socket.on("play:result", ({ message, delta, coins, streak }) => {
  el("resultText").textContent = message;
  state.user.coins = coins;
  state.user.winStreak = streak;
  addActivity(message, delta);
  renderUser();
});

socket.on("leaderboard:update", ({ leaderboard }) => {
  state.leaderboard = leaderboard;
  renderLeaderboard();
});

loadSession();
