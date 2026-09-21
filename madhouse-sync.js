"use strict";

// ============================================================
// Content script на https://cargohustle.online/*
// Собирает статы + ник + клан по запросу service worker.
// accessToken НЕ покидает origin.
// ============================================================

const MADHOUSE_API = "/api/players";

function readSession() {
  const raw = localStorage.getItem("cargo_auth_session");
  if (!raw) throw new Error("cargo_auth_session не найден — войди в Madhouse.");

  let s;
  try { s = JSON.parse(raw); }
  catch { throw new Error("cargo_auth_session повреждён (не JSON)."); }

  if (!s?.playerId || !s?.accessToken) {
    throw new Error("В сессии Madhouse нет playerId/accessToken.");
  }
  return s;
}

function toIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toStrOrNull(value, max = 255) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

async function collectStats() {
  const session = readSession();
  const { playerId, accessToken } = session;

  const r = await fetch(`${MADHOUSE_API}/${encodeURIComponent(playerId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (r.status === 401 || r.status === 403) {
    throw new Error("Madhouse API 401 — сессия истекла, перезайди в игру.");
  }
  if (!r.ok) throw new Error(`Madhouse API HTTP ${r.status}`);

  const p = await r.json();

  const telegramId = String(playerId);

  // stats: p.stats.aggression = { base, bonus, total }
  const stats = {
    aggression: toIntOrNull(p?.stats?.aggression?.total) ?? toIntOrNull(p?.stats?.aggression),
    madness:    toIntOrNull(p?.stats?.madness?.total)    ?? toIntOrNull(p?.stats?.madness),
    rage:       toIntOrNull(p?.stats?.rage?.total)       ?? toIntOrNull(p?.stats?.rage),
  };

  const nickname = toStrOrNull(p?.nickname, 100);
  const level = toIntOrNull(p?.level);

  // clan: { clanId, name, tag, role, level, members: {current, max}, emblem }
  let clan = null;
  if (p?.clan && p.clan.clanId) {
    clan = {
      id: String(p.clan.clanId),
      name: toStrOrNull(p.clan.name, 255),
      tag: toStrOrNull(p.clan.tag, 100),
      role: toStrOrNull(p.clan.role, 50),
      level: toIntOrNull(p.clan.level),
      membersCurrent: toIntOrNull(p.clan.members?.current),
      membersMax: toIntOrNull(p.clan.members?.max),
    };
  }

  return { telegramId, nickname, level, stats, clan };
}

async function collectFriends() {
  const session = readSession();
  const { accessToken } = session;

  const all = [];
  let cursor = null;
  let pages = 0;
  const MAX_PAGES = 10;

  while (pages < MAX_PAGES) {
    const url = cursor
      ? `/api/friends?limit=100&cursor=${encodeURIComponent(cursor)}`
      : `/api/friends?limit=100`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) break;

    const d = await r.json();
    const items = d.items || [];
    for (const item of items) {
      const p = item.player || item;
      if (!p?.playerId) continue;
      all.push({
        playerId: String(p.playerId),
        nickname: p.nickname || p.username || null,
        level: p.level ?? null,
        aggression: p.stats?.aggression ?? null,
        madness: p.stats?.madness ?? null,
        rage: p.stats?.rage ?? null,
      });
    }

    cursor = d.nextCursor || null;
    if (!cursor || items.length === 0) break;
    pages++;
    await new Promise((r) => setTimeout(r, 300));
  }

  return all;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "COLLECT_STATS") {
    (async () => {
      try {
        const data = await collectStats();
        sendResponse({ ok: true, ...data });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }
  if (msg?.type === "COLLECT_FRIENDS") {
    (async () => {
      try {
        const friends = await collectFriends();
        sendResponse({ ok: true, friends });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }
});
