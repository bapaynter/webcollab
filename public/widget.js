(function () {
  "use strict";

  const FAB_ID = "canvas-fab";
  const PANEL_ID = "canvas-panel";
  const STYLE_ID = "canvas-style";
  const LOG_ID = "canvas-log";
  const FORM_ID = "canvas-form";
  const INPUT_ID = "canvas-input";
  const SUBMIT_ID = "canvas-submit";
  const WS_PATH = "/ws";
  const SUGGEST_PATH = "/api/suggest";
  const RECONNECT_DELAY_MS = 2000;
  const MAX_MESSAGE_LENGTH = 500;
  const INPUT_MIN_ROWS = 1;
  const INPUT_MAX_ROWS = 8;

  function currentPath() {
    return window.location.pathname || "/";
  }

  function appendLog(status, text) {
    const log = document.getElementById(LOG_ID);
    if (log === null) return;
    const entry = document.createElement("div");
    entry.className = "canvas-log-entry canvas-log-" + status;
    entry.textContent = text;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID) !== null) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "@keyframes canvas-spin{to{transform:rotate(360deg)}}",
      "#canvas-fab{position:fixed;right:1rem;bottom:1rem;width:3rem;height:3rem;border-radius:50%;border:0;background:#41403e;color:#fff;font-size:1.25rem;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);z-index:2147483600;font-family:system-ui,sans-serif;transition:transform 0.15s ease,background 0.15s ease}",
      "#canvas-fab:hover{background:#5a5854;transform:scale(1.05)}",
      "#canvas-fab:focus-visible{outline:2px solid #7a99c7;outline-offset:2px}",
      "#canvas-panel{position:fixed;right:1rem;bottom:5rem;width:22rem;max-width:90vw;max-height:75vh;background:#fffbf2;border:1px solid #cdcccb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.18);display:none;flex-direction:column;z-index:2147483600;font-family:system-ui,sans-serif;font-size:0.875rem;color:#272625;overflow:hidden}",
      "#canvas-panel.open{display:flex}",
      "#canvas-panel header{padding:0.625rem 0.875rem;border-bottom:1px solid #e3e1de;background:#f2f0ea;font-weight:600;font-size:0.8125rem;letter-spacing:0.02em;text-transform:uppercase;color:#5a5854;border-radius:10px 10px 0 0}",
      "#canvas-log{flex:1;overflow-y:auto;padding:0.625rem 0.875rem;display:flex;flex-direction:column;gap:0.375rem;min-height:3rem}",
      "#canvas-log:empty::before{content:\"no suggestions yet\";color:#a09d97;font-style:italic;font-size:0.8125rem}",
      ".canvas-log-entry{padding:0.4rem 0.625rem;border-radius:6px;line-height:1.35;font-size:0.8125rem;border-left:3px solid transparent}",
      ".canvas-log-accepted{background:#e8efd9;color:#3a4a25;border-left-color:#7a9a4a}",
      ".canvas-log-rejected{background:#f3dad7;color:#7f2722;border-left-color:#c2544a}",
      ".canvas-log-info{background:#ece9e2;color:#6c757d;border-left-color:#a09d97}",
      "#canvas-form{display:flex;gap:0.5rem;padding:0.625rem 0.75rem;border-top:1px solid #e3e1de;background:#fbf9f4;align-items:flex-end}",
      "#canvas-input{flex:1;padding:0.5rem 0.625rem;border:1px solid #cdcccb;border-radius:6px;font:inherit;background:#fff;color:inherit;resize:none;min-height:1.75rem;max-height:12rem;line-height:1.4;box-sizing:border-box;transition:border-color 0.15s ease,box-shadow 0.15s ease;overflow-y:auto}",
      "#canvas-input:focus{outline:0;border-color:#7a99c7;box-shadow:0 0 0 2px rgba(122,153,199,0.18)}",
      "#canvas-input:disabled{opacity:0.6;cursor:not-allowed}",
      "#canvas-submit{padding:0.5rem 0.875rem;border:0;background:#41403e;color:#fff;border-radius:6px;cursor:pointer;font:inherit;font-weight:500;height:2.25rem;position:relative;transition:background 0.15s ease,transform 0.05s ease;min-width:4.5rem}",
      "#canvas-submit:hover:not(:disabled){background:#5a5854}",
      "#canvas-submit:active:not(:disabled){transform:scale(0.97)}",
      "#canvas-submit:focus-visible{outline:2px solid #7a99c7;outline-offset:2px}",
      "#canvas-submit:disabled{cursor:wait;opacity:0.85}",
      "#canvas-submit::after{content:\"\";display:none;position:absolute;top:50%;left:50%;width:0.875rem;height:0.875rem;margin:-0.4375rem 0 0 -0.4375rem;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:canvas-spin 0.7s linear infinite}",
      "#canvas-form.canvas-pending #canvas-submit::after{display:block}",
      "#canvas-form.canvas-pending #canvas-submit #canvas-submit-label{display:none}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function autoSizeInput() {
    const input = document.getElementById(INPUT_ID);
    if (input === null) return;
    input.style.height = "auto";
    const lineHeight = 1.4;
    const padding = 1;
    const maxHeight = INPUT_MAX_ROWS * lineHeight + padding;
    input.style.height = Math.min(input.scrollHeight, maxHeight) + "px";
  }

  function resetInput() {
    const input = document.getElementById(INPUT_ID);
    if (input === null) return;
    input.value = "";
    autoSizeInput();
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel !== null) return panel;
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = [
      "<header>canvas · suggest a change</header>",
      '<div id="canvas-log"></div>',
      '<form id="canvas-form">',
      '<textarea id="canvas-input" rows="' + INPUT_MIN_ROWS + '" maxlength="' + MAX_MESSAGE_LENGTH + '" placeholder="suggest a change…" autocomplete="off"></textarea>',
      '<button id="canvas-submit" type="submit"><span id="canvas-submit-label">send</span></button>',
      "</form>",
    ].join("");
    (document.body || document.documentElement).appendChild(panel);
    const form = panel.querySelector("#" + FORM_ID);
    const input = panel.querySelector("#" + INPUT_ID);
    form.addEventListener("submit", onSubmit);
    input.addEventListener("input", onInputChange);
    input.addEventListener("keydown", onInputKeydown);
    return panel;
  }

  function onInputChange() {
    autoSizeInput();
  }

  function onInputKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      const form = document.getElementById(FORM_ID);
      if (form !== null) {
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          form.dispatchEvent(new Event("submit", { cancelable: true }));
        }
      }
    }
  }

  function togglePanel() {
    const panel = ensurePanel();
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      const input = document.getElementById(INPUT_ID);
      if (input !== null) input.focus();
    }
  }

  function setPending(pending) {
    const form = document.getElementById(FORM_ID);
    const input = document.getElementById(INPUT_ID);
    const button = document.getElementById(SUBMIT_ID);
    const label = document.getElementById("canvas-submit-label");
    if (form === null || input === null || button === null || label === null) return;
    if (pending) {
      form.classList.add("canvas-pending");
      input.disabled = true;
      button.disabled = true;
      label.textContent = "sending";
    } else {
      form.classList.remove("canvas-pending");
      input.disabled = false;
      button.disabled = false;
      label.textContent = "send";
    }
  }

  function parseSuggestError(body, status) {
    const userMessage = body && typeof body.user_message === "string" ? body.user_message : fallbackErrorMessage(status);
    const hint = body && typeof body.hint === "string" ? body.hint : fallbackErrorHint(status);
    return { userMessage: userMessage, hint: hint };
  }

  function fallbackErrorMessage(status) {
    if (status === 400) return "request is invalid";
    if (status === 422) return "request was rejected";
    if (status === 429) return "too many requests right now";
    if (status === 504) return "edit timed out before completion";
    if (status >= 500) return "server error";
    return "request failed";
  }

  function fallbackErrorHint(status) {
    if (status === 504) return "try a smaller edit request";
    if (status >= 500) return "please retry in a moment";
    return "";
  }

  async function onSubmit(event) {
    event.preventDefault();
    const input = document.getElementById(INPUT_ID);
    if (input === null) return;
    const message = input.value.trim();
    if (message.length === 0) return;
    setPending(true);
    try {
      const response = await fetch(SUGGEST_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message, path: currentPath() }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 200 && body.status === "accepted") {
        appendLog("accepted", "✓ v" + body.version + ": " + (body.summary || "(no summary)"));
        resetInput();
      } else {
        const parsedError = parseSuggestError(body, response.status);
        appendLog("rejected", "✗ " + parsedError.userMessage);
        if (parsedError.hint !== "") {
          appendLog("info", parsedError.hint);
        }
        if (response.status === 429 && typeof body.until === "string") {
          showCooldownUntil(body.until);
        }
      }
    } catch (err) {
      console.error("canvas widget: suggest failed", err);
      appendLog("rejected", "✗ network error while sending request");
      appendLog("info", "check connection and retry");
    } finally {
      setPending(false);
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
    fab.setAttribute("aria-label", "toggle canvas chat");
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
    const input = document.getElementById(INPUT_ID);
    if (input !== null) {
      input.addEventListener("input", onInputChange);
      input.addEventListener("keydown", onInputKeydown);
      autoSizeInput();
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
    const panel = ensurePanel();
    ensureFab();
    panel.classList.add("open");
    autoSizeInput();
    connect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
