"use strict";

const API = "https://glistening-determination-production-c2f5.up.railway.app";
const TG_WEB_URL = "https://web.telegram.org/*";
const MADHOUSE_ORIGIN = "https://cargohustle.online";
const SYNC_PERIOD_MIN = 180;
const SYNC_ALARM = "madhouseSync";

async function getState() {
  return chrome.storage.local.get([
    "installToken", "telegramId", "linkCode", "linkExpiresAt",
    "linkedAt", "lastSync", "lastError",
  ]);
}

async function setState(patch) {
  return chrome.storage.local.set(patch);
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MIN });
  runSync().catch((e) => console.error("[SW] initial sync failed:", e));
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MIN });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) {
    runSync().catch((e) => console.error("[SW] alarm sync failed:", e));
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "GET_STATE":
          sendResponse({ ok: true, state: await getState() });
          break;
        case "LINK_START":
          sendResponse(await linkStart());
          break;
        case "CHECK_LINK_STATUS":
          sendResponse(await checkLinkStatus());
          break;
        case "SYNC_NOW":
          await runSync();
          sendResponse({ ok: true, state: await getState() });
          break;
        case "UNLINK":
          await unlink();
          sendResponse({ ok: true, state: await getState() });
          break;
        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (err) {
      console.error("[SW] message error:", err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});

async function findMadhouseFrame() {
  const tabs = await chrome.tabs.query({ url: TG_WEB_URL });
  if (!tabs.length) return null;
  for (const tab of tabs) {
    let frames;
    try {
      frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    } catch { continue; }
    if (!frames) continue;
    const mh = frames.find((f) => f.url && f.url.startsWith(MADHOUSE_ORIGIN));
    if (mh) return { tabId: tab.id, frameId: mh.frameId, url: mh.url };
  }
  return null;
}

function sendToFrame(tabId, frameId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message || "content script не отвечает" });
        return;
      }
      resolve(response || { ok: false, error: "Пустой ответ" });
    });
  });
}

async function collectFromMadhouse() {
  const frame = await findMadhouseFrame();
  if (!frame) throw new Error("Открой Madhouse в Telegram Web (нажми Play в чате бота).");
  const result = await sendToFrame(frame.tabId, frame.frameId, { type: "COLLECT_STATS" });
  if (!result.ok) throw new Error(result.error || "Не удалось собрать статы");
  return result;
}

async function linkStart() {
  const collected = await collectFromMadhouse();
  const { telegramId, level, stats, nickname, clan } = collected;

  const r = await fetch(`${API}/api/sync/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegramId, level, stats }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(`init failed: HTTP ${r.status} ${JSON.stringify(d)}`);

  await setState({
    telegramId: String(telegramId),
    linkCode: d.code,
    linkExpiresAt: d.expiresAt,
    lastError: null,
  });

  return { ok: true, code: d.code, expiresAt: d.expiresAt };
}

async function checkLinkStatus() {
  const { linkCode, installToken } = await getState();
  if (installToken) return { ok: true, linked: true };
  if (!linkCode) return { ok: true, linked: false };

  const r = await fetch(`${API}/api/sync/status?code=${encodeURIComponent(linkCode)}`);
  if (!r.ok) return { ok: true, linked: false };
  const d = await r.json().catch(() => ({}));
  if (!d.ok || !d.found) return { ok: true, linked: false };

  if (d.confirmed && d.installToken) {
    await setState({
      installToken: d.installToken,
      telegramId: String(d.telegramId),
      linkCode: null,
      linkExpiresAt: null,
      linkedAt: new Date().toISOString(),
      lastError: null,
    });
    runSync().catch((e) => console.error("[SW] sync after link failed:", e));
    return { ok: true, linked: true };
  }

  if (d.expired) {
    await setState({ linkCode: null, linkExpiresAt: null, lastError: "Код привязки истёк" });
  }
  return { ok: true, linked: false };
}

let syncBusy = false;

async function runSync() {
  if (syncBusy) return;
  syncBusy = true;
  try {
    const { installToken } = await getState();
    if (!installToken) return;

    let collected;
    try {
      collected = await collectFromMadhouse();
    } catch (e) {
      await setState({ lastError: String(e?.message || e) });
      return;
    }

    const { level, stats, nickname, clan } = collected;

    const r = await fetch(`${API}/api/sync/madhouse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${installToken}`,
      },
      body: JSON.stringify({ level, stats, nickname, clan }),
    });
    const d = await r.json().catch(() => ({}));

    if (r.status === 401) {
      await setState({ installToken: null, lastError: "Токен истёк. Привяжи заново." });
      return;
    }
    if (!r.ok || !d.ok) {
      await setState({ lastError: `HTTP ${r.status}: ${JSON.stringify(d)}` });
      return;
    }
        // ─── Сбор друзей ───
    try {
      const frame = await findMadhouseFrame();
      if (frame) {
        const fr = await sendToFrame(frame.tabId, frame.frameId, { type: "COLLECT_FRIENDS" });
        if (fr.ok && fr.friends?.length) {
          const r2 = await fetch(`${API}/api/sync/friends`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${installToken}`,
            },
            body: JSON.stringify({ friends: fr.friends }),
          });
          const d2 = await r2.json().catch(() => ({}));
          console.log("[SW] friends synced:", d2.imported, "/", fr.friends.length);
        }
      }
    } catch (e) {
      console.warn("[SW] friends failed:", e.message);
    }

    await setState({
      lastSync: { ok: true, time: new Date().toISOString(), level, stats },
      lastError: null,
    });
  } catch (err) {
    console.error("[SW] runSync error:", err);
    await setState({ lastError: String(err?.message || err) });
  } finally {
    syncBusy = false;
  }
}

async function unlink() {
  await setState({
    installToken: null, telegramId: null, linkCode: null,
    linkExpiresAt: null, linkedAt: null, lastSync: null, lastError: null,
  });
}