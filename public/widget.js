(function () {
  "use strict";

  const FAB_ID = "canvas-fab";
  const PANEL_ID = "canvas-panel";
  const STYLE_ID = "canvas-style";
  const LOG_ID = "canvas-log";
  const FORM_ID = "canvas-form";
  const INPUT_ID = "canvas-input";
  const WS_PATH = "/ws";
  const SUGGEST_PATH = "/api/suggest";
  const RECONNECT_DELAY_MS = 2000;
  const LOG_KEY_PREFIX = "canvas-log:";

  function currentPath() {
    return window.location.pathname || "/";
  }

  function loadLog() {
    try {
      const raw = window.localStorage.getItem(LOG_KEY_PREFIX + currentPath());
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.warn("canvas widget: failed to read localStorage log", err);
      return [];
    }
  }

  function saveLog(entries) {
    try {
      window.localStorage.setItem(LOG_KEY_PREFIX + currentPath(), JSON.stringify(entries));
    } catch (err) {
      console.warn("canvas widget: failed to write localStorage log", err);
    }
  }

  function appendLog(status, text) {
    const log = document.getElementById(LOG_ID);
    if (log === null) return;
    const entry = document.createElement("div");
    entry.className = "canvas-log-entry canvas-log-" + status;
    entry.textContent = text;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    const entries = loadLog();
    entries.push({ status: status, text: text, t: Date.now() });
    saveLog(entries.slice(-50));
  }

  function restoreLog() {
    const entries = loadLog();
    if (entries.length === 0) return;
    for (const e of entries) {
      const log = document.getElementById(LOG_ID);
      if (log === null) break;
      const div = document.createElement("div");
      div.className = "canvas-log-entry canvas-log-" + e.status;
      div.textContent = e.text;
      log.appendChild(div);
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID) !== null) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#canvas-fab{position:fixed;right:1rem;bottom:1rem;width:3rem;height:3rem;border-radius:50%;border:0;background:#41403e;color:#fff;font-size:1.25rem;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);z-index:2147483600;font-family:system-ui,sans-serif}",
      "#canvas-panel{position:fixed;right:1rem;bottom:5rem;width:20rem;max-width:90vw;max-height:70vh;background:#fff;border:1px solid #cdcccb;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.2);display:none;flex-direction:column;z-index:2147483600;font-family:system-ui,sans-serif;font-size:0.875rem;color:#272625}",
      "#canvas-panel.open{display:flex}",
      "#canvas-panel header{padding:0.5rem 0.75rem;border-bottom:1px solid #cdcccb;background:#f2f2f2;font-weight:600;border-radius:6px 6px 0 0}",
      "#canvas-log{flex:1;overflow-y:auto;padding:0.5rem 0.75rem;display:flex;flex-direction:column;gap:0.25rem}",
      ".canvas-log-entry{padding:0.25rem 0.5rem;border-radius:4px;line-height:1.3}",
      ".canvas-log-accepted{background:#d5dfc8;color:#4a5a35}",
      ".canvas-log-rejected{background:#f0cbc9;color:#7f2722}",
      ".canvas-log-info{background:#e6e7e9;color:#6c757d}",
      "#canvas-form{display:flex;gap:0.25rem;padding:0.5rem;border-top:1px solid #cdcccb}",
      "#canvas-input{flex:1;padding:0.4rem 0.5rem;border:1px solid #cdcccb;border-radius:4px;font:inherit}",
      "#canvas-form button{padding:0.4rem 0.75rem;border:0;background:#41403e;color:#fff;border-radius:4px;cursor:pointer;font:inherit}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel !== null) return panel;
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = [
      "<header>canvas</header>",
      '<div id="canvas-log"></div>',
      '<form id="canvas-form">',
      '<input id="canvas-input" type="text" maxlength="500" placeholder="suggest a change…" autocomplete="off">',
      "<button type=\"submit\">send</button>",
      "</form>",
    ].join("");
    (document.body || document.documentElement).appendChild(panel);
    restoreLog();
    panel.querySelector("#" + FORM_ID).addEventListener("submit", onSubmit);
    return panel;
  }

  function togglePanel() {
    const panel = ensurePanel();
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      const input = document.getElementById(INPUT_ID);
      if (input !== null) input.focus();
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    const input = document.getElementById(INPUT_ID);
    if (input === null) return;
    const message = input.value.trim();
    if (message.length === 0) return;
    input.disabled = true;
    try {
      const response = await fetch(SUGGEST_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message, path: currentPath() }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 200 && body.status === "accepted") {
        appendLog("accepted", "✓ v" + body.version + ": " + (body.summary || "(no summary)"));
        input.value = "";
      } else {
        const reason = body.reason || ("error " + response.status);
        appendLog("rejected", "✗ " + reason);
        if (response.status === 429 && typeof body.until === "string") {
          showCooldownUntil(body.until);
        }
      }
    } catch (err) {
      console.error("canvas widget: suggest failed", err);
      appendLog("rejected", "✗ network error");
    } finally {
      input.disabled = false;
    }
  }

  function showCooldownUntil(isoUntil) {
    const until = Date.parse(isoUntil);
    if (Number.isNaN(until)) return;
    const remainingMs = until - Date.now();
    if (remainingMs <= 0) return;
    const minutes = Math.ceil(remainingMs / 60000);
    appendLog("info", "cooldown: " + minutes + " min");
  }

  function ensureFab() {
    let fab = document.getElementById(FAB_ID);
    if (fab !== null) return fab;
    fab = document.createElement("button");
    fab.id = FAB_ID;
    fab.type = "button";
    fab.setAttribute("aria-label", "open canvas chat");
    fab.textContent = "✎";
    fab.addEventListener("click", togglePanel);
    (document.body || document.documentElement).appendChild(fab);
    return fab;
  }

  function persistentNodes() {
    return [STYLE_ID, FAB_ID, PANEL_ID].map((id) => document.getElementById(id)).filter(function (n) {
      return n !== null;
    });
  }

  function reattachPersistentNodes(targetDoc) {
    const nodes = persistentNodes();
    for (const node of nodes) {
      if (targetDoc.getElementById(node.id) === null) {
        (targetDoc.body || targetDoc.documentElement).appendChild(node);
      }
    }
  }

  function applySwappedDocument(newHtml) {
    const parser = new DOMParser();
    const newDoc = parser.parseFromString(newHtml, "text/html");
    reattachPersistentNodes(newDoc);
    document.documentElement.innerHTML = newDoc.documentElement.innerHTML;
    rebindWidget();
  }

  function rebindWidget() {
    const fab = document.getElementById(FAB_ID);
    if (fab !== null) {
      fab.onclick = togglePanel;
    }
    const form = document.getElementById(FORM_ID);
    if (form !== null) {
      form.addEventListener("submit", onSubmit);
    }
  }

  async function swapFromApi(path) {
    const response = await fetch("/api/page?path=" + encodeURIComponent(path), { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (typeof data.html !== "string") return;
    applySwappedDocument(data.html);
  }

  async function refetchState() {
    try {
      await fetch("/api/state", { cache: "no-store" });
    } catch (err) {
      console.warn("canvas widget: state refetch failed", err);
    }
  }

  let socket = null;
  let reconnectTimer = null;

  function handleEditEvent(event) {
    if (event.path === currentPath()) {
      swapFromApi(event.path).catch(function (err) {
        console.error("canvas widget: swap failed", err);
      });
      return;
    }
    refetchState();
  }

  function connect() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = proto + "//" + window.location.host + WS_PATH;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      console.warn("canvas widget: WebSocket construction failed", err);
      scheduleReconnect();
      return;
    }
    socket.addEventListener("message", function (event) {
      let parsed;
      try {
        parsed = JSON.parse(event.data);
      } catch (err) {
        console.warn("canvas widget: ws message not JSON", err);
        return;
      }
      if (parsed && parsed.type === "edit") {
        handleEditEvent(parsed);
      }
    });
    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", function () {
      if (socket !== null) socket.close();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer !== null) return;
    reconnectTimer = window.setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  function mount() {
    injectStyle();
    ensureFab();
    ensurePanel();
    connect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
