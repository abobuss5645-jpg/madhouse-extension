"use strict";

(() => {
  const API = "https://glistening-determination-production-c2f5.up.railway.app";

  const CACHE_TTL_MS = 5 * 60 * 1000;
  const NEGATIVE_TTL_MS = 5 * 60 * 1000;
  const DEBOUNCE_MS = 500;

  let lastPeerId = null;
  let lastRenderedPeerId = null;
  let debounceTimer = null;

  const cache = new Map();

  function visible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.display !== "none" &&
      s.visibility !== "hidden"
    );
  }

  function findProfilePeerId() {
    const map = new Map();
    for (const el of document.querySelectorAll("[data-peer-id]")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.left < innerWidth * 0.55) continue;
      const id = el.getAttribute("data-peer-id");
      if (id) map.set(id, (map.get(id) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  function findPane() {
    const profileContent = document.querySelector(".profile-content");
    if (profileContent) {
      const r = profileContent.getBoundingClientRect();
      if (r.width > 250 && r.height > 200) return profileContent;
    }
    return null;
  }
  function esc(v) {
    return String(v ?? "—").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function removeCard() {
    document.getElementById("madhouse-profile-card")?.remove();
    lastRenderedPeerId = null;
  }

  async function fetchPlayer(peerId) {
    const now = Date.now();
    const cached = cache.get(peerId);
    if (cached) {
      const ttl = cached.notFound ? NEGATIVE_TTL_MS : CACHE_TTL_MS;
      if (now - cached.ts < ttl) return cached;
    }
    try {
      const r = await fetch(`${API}/api/public/player/${encodeURIComponent(peerId)}`);
      if (r.status === 404) {
        const entry = { data: null, ts: now, notFound: true };
        cache.set(peerId, entry);
        return entry;
      }
      if (!r.ok) return { data: null, ts: now, notFound: false };
      const d = await r.json();
      if (!d?.ok || !d?.found || !d?.player) {
        const entry = { data: null, ts: now, notFound: true };
        cache.set(peerId, entry);
        return entry;
      }
      if (!d.player.clan) {
        return { data: d.player, ts: now, notFound: false };
      }
      const entry = { data: d.player, ts: now, notFound: false };
      cache.set(peerId, entry);
      return entry;
    } catch {
      return { data: null, ts: now, notFound: false };
    }
  }

  function renderCard(peerId, player) {
    removeCard();

    const clan = player.clan
      ? `<div style="margin-top:6px;opacity:.85">🏰 ${esc(player.clan.name)}${player.clan.tag ? " [" + esc(player.clan.tag) + "]" : ""}${player.clan.role ? " (" + esc(player.clan.role) + ")" : ""}</div>`
      : "";
    const nickname = player.nickname
      ? `<div style="margin-top:4px;font-weight:600">${esc(player.nickname)}</div>`
      : "";

    const card = document.createElement("div");
    card.id = "madhouse-profile-card";
    card.innerHTML = `
      <div style="font-weight:700;margin-bottom:8px">🎮 Madhouse</div>
      ${nickname}
      <div>⭐ Level: <b>${esc(player.level)}</b></div>
      <div>⚔️ Aggression: <b>${esc(player.stats?.aggression)}</b></div>
      <div>🧠 Madness: <b>${esc(player.stats?.madness)}</b></div>
      <div>🔥 Rage: <b>${esc(player.stats?.rage)}</b></div>
      ${clan}
    `;
    card.style.cssText =
      "margin:12px;padding:12px;border-radius:12px;" +
      "background:var(--surface-color,#2a2a2a);" +
      "color:var(--primary-text-color,#eee);" +
      "font:14px/1.5 Arial,sans-serif;" +
      "box-shadow:0 1px 5px rgba(0,0,0,.15);" +
      "border:1px solid rgba(79,70,229,.4);";

        const pane = findPane();
    if (!pane) return;
    pane.appendChild(card);
    setTimeout(() => {
      try { card.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch {}
    }, 100);
    lastRenderedPeerId = peerId;

  async function render() {
    const peerId = findProfilePeerId();
    if (!peerId) {
      removeCard();
      lastPeerId = null;
      return;
    }
    if (peerId === lastPeerId && lastRenderedPeerId === peerId) return;
    lastPeerId = peerId;
    if (peerId === lastRenderedPeerId) return;

    const entry = await fetchPlayer(peerId);
    if (findProfilePeerId() !== peerId) return;
    if (entry.notFound || !entry.data) {
      removeCard();
      return;
    }
    renderCard(peerId, entry.data);
  }

  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      render().catch(() => {});
    }, DEBOUNCE_MS);
  }

  const observer = new MutationObserver(scheduleRender);
  observer.observe(document.documentElement, { subtree: true, childList: true });

  scheduleRender();
})();