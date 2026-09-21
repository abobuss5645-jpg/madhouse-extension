"use strict";

const BOT_USERNAME = "psy1testbot";
const API = "https://glistening-determination-production-c2f5.up.railway.app";

const $ = (id) => document.getElementById(id);

const els = {
  status: $("status"),
  linkBox: $("linkBox"),
  code: $("code"),
  waiting: $("waiting"),
  openBotBtn: $("openBot"),
  linkBtn: $("link"),
  syncBtn: $("sync"),
  unlinkBtn: $("unlink"),
  out: $("out"),
  raidsList: $("raidsList"),
  refreshRaidsBtn: $("refreshRaids"),
};

let pollTimer = null;
let raidsTimer = null;

function sw(type) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "Пустой ответ от SW" });
    });
  });
}

function formatStats(stats) {
  if (!stats) return "—";
  return `⚔️ ${stats.aggression ?? "—"} | 🧠 ${stats.madness ?? "—"} | 🔥 ${stats.rage ?? "—"}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("ru-RU"); }
  catch { return iso; }
}

function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function stopRaidsTimer() { if (raidsTimer) { clearInterval(raidsTimer); raidsTimer = null; } }

async function pollStatus() {
  const r = await sw("CHECK_LINK_STATUS");
  if (r.ok && r.linked) {
    stopPoll();
    await refresh();
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(pollStatus, 2000);
}

function render(state) {
  const { installToken, telegramId, linkCode, linkExpiresAt, linkedAt, lastSync, lastError } = state || {};

  els.linkBox.classList.add("hide");
  els.linkBtn.style.display = "none";
  els.syncBtn.style.display = "none";
  els.unlinkBtn.style.display = "none";
  els.out.textContent = "";

  if (installToken && telegramId) {
    stopPoll();
    els.status.innerHTML = `✅ Привязан к <b>${telegramId}</b>`;
    els.syncBtn.style.display = "block";
    els.unlinkBtn.style.display = "block";
    if (linkedAt) els.out.textContent += `Привязан: ${formatDate(linkedAt)}\n`;
    if (lastSync?.time) {
      els.out.textContent += `Последний sync: ${formatDate(lastSync.time)}\n`;
      els.out.textContent += `${formatStats(lastSync.stats)}`;
    }
    if (lastError) els.out.textContent += `\n\n⚠️ ${lastError}`;
    return;
  }

  if (linkCode) {
    els.status.innerHTML = `🔗 Открой бота и нажми Start`;
    els.linkBox.classList.remove("hide");
    els.code.textContent = linkCode;
    startPoll();
    return;
  }

  stopPoll();
  els.status.textContent = "❌ Не привязан";
  els.linkBtn.style.display = "block";
  if (lastError) els.out.textContent = `Ошибка: ${lastError}`;
}

async function refresh() {
  const r = await sw("GET_STATE");
  if (!r.ok) {
    els.status.innerHTML = `<span class="err">Ошибка: ${r.error}</span>`;
    return;
  }
  render(r.state);
}

// ─── Вкладки ───

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const name = tab.dataset.tab;
    $("tab-profile").classList.toggle("hide", name !== "profile");
    $("tab-raids").classList.toggle("hide", name !== "raids");
    if (name === "raids") loadRaids();
  });
});

// ─── Рейды ───

function renderRaids(raids) {
  if (!raids.length) {
    els.raidsList.innerHTML = `<div class="muted">Рейдов нет.</div>`;
    return;
  }
  const html = raids.map((r) => {
    const dt = new Date(r.raidAt).toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const leader = r.leaderUsername
      ? `<a href="https://t.me/${encodeURIComponent(r.leaderUsername)}" target="_blank">@${r.leaderUsername}</a>`
      : "—";
    const clan = r.clanName ? `${r.clanName}${r.clanTag ? " [" + r.clanTag + "]" : ""}` : "—";
    return `<div class="raid">
      <div class="time">${dt} МСК</div>
      <div>🏢 Этаж: ${r.floor} | 👹 ${r.boss || "—"}</div>
      <div>👤 ${leader}</div>
      <div class="muted">🏰 ${clan}</div>
    </div>`;
  }).join("");
  els.raidsList.innerHTML = html;
}

async function loadRaids() {
  els.raidsList.innerHTML = `<div class="muted">Загрузка...</div>`;
  try {
    const r = await fetch(`${API}/api/public/raids`);
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Ошибка");
    renderRaids(d.raids || []);
  } catch (e) {
    els.raidsList.innerHTML = `<div class="err">Ошибка: ${e.message}</div>`;
  }
}

els.refreshRaidsBtn.addEventListener("click", loadRaids);

// ─── Handlers ───

els.linkBtn.addEventListener("click", async () => {
  els.linkBtn.disabled = true;
  els.status.textContent = "Читаю статы из Madhouse...";
  const r = await sw("LINK_START");
  els.linkBtn.disabled = false;
  if (!r.ok) {
    els.status.innerHTML = `<span class="err">${r.error}</span>`;
    return;
  }
  await refresh();
});

els.openBotBtn.addEventListener("click", async () => {
  const r = await sw("GET_STATE");
  if (!r.ok || !r.state.linkCode) return;
  const url = `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(r.state.linkCode)}`;
  chrome.tabs.create({ url });
});

els.syncBtn.addEventListener("click", async () => {
  els.syncBtn.disabled = true;
  els.status.textContent = "Синхронизация...";
  const r = await sw("SYNC_NOW");
  els.syncBtn.disabled = false;
  if (!r.ok) {
    els.status.innerHTML = `<span class="err">${r.error}</span>`;
    return;
  }
  render(r.state);
});

els.unlinkBtn.addEventListener("click", async () => {
  if (!confirm("Точно отвязать аккаунт?")) return;
  els.unlinkBtn.disabled = true;
  await sw("UNLINK");
  els.unlinkBtn.disabled = false;
  await refresh();
});

// ─── Старт ───

refresh();

window.addEventListener("unload", () => {
  stopPoll();
  stopRaidsTimer();
});