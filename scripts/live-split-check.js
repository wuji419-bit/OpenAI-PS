#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pluginPath = process.env.OPENAI_PS_PLUGIN_PATH || "/private/tmp/openai-photoshop-generator-dev";
const host = process.env.UXP_DEVTOOLS_HOST || "127.0.0.1";
const port = Number(process.env.UXP_DEVTOOLS_PORT || 14001);
const timeoutMs = Number(process.env.PHOTOSHOP_LIVE_TIMEOUT_MS || 900000);
const prompt = getArg("--prompt") || "招财猫, 宝箱, 开始挑战按钮";
const negative = getArg("--negative") || "不要合并相邻元素，保持原始位置和比例";
const preflightOnly = process.argv.includes("--preflight");
const existingSessionId = getArg("--session") || process.env.OPENAI_PS_PLUGIN_SESSION_ID || "";

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function readPluginVersion() {
  const appJs = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const version = appJs.match(/const\s+PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1];
  if (!version) throw new Error("Could not read PLUGIN_VERSION from src/app.js");
  return version;
}

function makeClientFrame(text) {
  const payload = Buffer.from(text, "utf8");
  let headerLength = 2;
  if (payload.length >= 126 && payload.length < 65536) headerLength = 4;
  if (payload.length >= 65536) headerLength = 10;
  const mask = crypto.randomBytes(4);
  const frame = Buffer.alloc(headerLength + 4 + payload.length);
  frame[0] = 0x81;
  if (payload.length < 126) {
    frame[1] = 0x80 | payload.length;
  } else if (payload.length < 65536) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(payload.length, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  mask.copy(frame, headerLength);
  for (let index = 0; index < payload.length; index += 1) {
    frame[headerLength + 4 + index] = payload[index] ^ mask[index % 4];
  }
  return frame;
}

function parseFrames(buffer, onText) {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const masked = Boolean(second & 0x80);
    let mask = null;
    if (masked) {
      if (buffer.length - cursor < 4) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (buffer.length - cursor < length) break;
    let payload = buffer.subarray(cursor, cursor + length);
    if (masked) {
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }
    if (opcode === 1) onText(payload.toString("utf8"));
    offset = cursor + length;
  }
  return buffer.subarray(offset);
}

function withTimeout(promise, label, ms = timeoutMs) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function connectUxpCli() {
  const socket = net.connect(port, host);
  const key = crypto.randomBytes(16).toString("base64");
  let handshake = "";
  let handshaken = false;
  let buffer = Buffer.alloc(0);
  let photoshopClientId = null;
  let requestId = 0;
  const pending = new Map();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  function send(message) {
    socket.write(makeClientFrame(JSON.stringify(message)));
  }

  function proxy(message) {
    if (!photoshopClientId) {
      return Promise.reject(new Error("Photoshop is not connected to UXP Developer Service"));
    }
    const id = ++requestId;
    send({ command: "proxy", clientId: photoshopClientId, requestId: id, message });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`UXP proxy request ${id} timed out`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
  }

  function handleText(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.command === "didAddRuntimeClient" && message.app?.appId === "PS") {
      photoshopClientId = message.id;
    }
    if (message.command === "didCompleteConnection") {
      readyResolve();
    }
    if (message.command === "reply" && message.requestId && pending.has(message.requestId)) {
      const callbacks = pending.get(message.requestId);
      pending.delete(message.requestId);
      clearTimeout(callbacks.timer);
      if (message.error || message.success === false) {
        callbacks.reject(new Error(message.error || message.errorMessage || "UXP proxy request failed"));
      } else {
        callbacks.resolve(message);
      }
    }
  }

  socket.on("connect", () => {
    socket.write(
      `GET /socket/cli HTTP/1.1\r\n` +
        `Host: ${host}:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Key: ${key}\r\n` +
        "Sec-WebSocket-Version: 13\r\n\r\n"
    );
  });
  socket.on("data", (data) => {
    if (!handshaken) {
      handshake += data.toString("binary");
      const headerEnd = handshake.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const status = handshake.slice(0, headerEnd).split("\r\n")[0] || "";
      if (!status.includes("101")) {
        readyReject(new Error(`Unexpected websocket handshake response: ${status}`));
        socket.destroy();
        return;
      }
      handshaken = true;
      buffer = Buffer.concat([buffer, Buffer.from(handshake.slice(headerEnd + 4), "binary")]);
      buffer = parseFrames(buffer, handleText);
      return;
    }
    buffer = Buffer.concat([buffer, data]);
    buffer = parseFrames(buffer, handleText);
  });
  socket.on("error", readyReject);

  return { ready, proxy, close: () => socket.end() };
}

async function loadAndDebugPlugin(version) {
  const cli = connectUxpCli();
  await withTimeout(cli.ready, "UXP cli connection", 15000);
  try {
    const loadReply = await cli.proxy({
      command: "Plugin",
      action: "load",
      params: { provider: { type: "disk", path: pluginPath } },
      breakOnStart: false,
      isPlaygroundPlugin: false,
    });
    const pluginSessionId = loadReply.pluginSessionId;
    if (!pluginSessionId) throw new Error("Photoshop loaded the plugin but did not return a pluginSessionId");
    await new Promise((resolve) => setTimeout(resolve, 750));
    const debugReply = await cli.proxy({ command: "Plugin", action: "debug", pluginSessionId });
    const wsdebugUrl = debugReply.wsdebugUrl;
    if (!wsdebugUrl) throw new Error("Photoshop did not return a CDP debug websocket URL");
    return {
      pluginSessionId,
      version,
      cdpUrl: wsdebugUrl.startsWith("ws=") ? `ws://${wsdebugUrl.slice(3)}` : wsdebugUrl,
    };
  } finally {
    cli.close();
  }
}

async function debugExistingPluginSession(version, pluginSessionId) {
  const cli = connectUxpCli();
  await withTimeout(cli.ready, "UXP cli connection", 15000);
  try {
    const debugReply = await cli.proxy({ command: "Plugin", action: "debug", pluginSessionId });
    const wsdebugUrl = debugReply.wsdebugUrl;
    if (!wsdebugUrl) throw new Error("Photoshop did not return a CDP debug websocket URL");
    return {
      pluginSessionId,
      version,
      cdpUrl: wsdebugUrl.startsWith("ws=") ? `ws://${wsdebugUrl.slice(3)}` : wsdebugUrl,
    };
  } finally {
    cli.close();
  }
}

function getEvaluateValue(result) {
  let current = result;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!current || typeof current !== "object") return current;
    if ("result" in current && current.result && typeof current.result === "object") {
      current = current.result;
      continue;
    }
    if ("value" in current) return current.value;
    if ("description" in current) return current.description;
    return current;
  }
  return current;
}

function connectCdp(cdpUrl) {
  const ws = new WebSocket(cdpUrl);
  let id = 0;
  let contextId = null;
  const contextIds = [];
  const pending = new Map();
  const consoleLines = [];

  function send(method, params = {}) {
    const messageId = ++id;
    ws.send(JSON.stringify({ id: messageId, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(messageId)) return;
        pending.delete(messageId);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      pending.set(messageId, { resolve, reject, timer });
    });
  }

  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (event) => reject(new Error(event.message || event.type || "CDP websocket error"));
  });

  ws.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.method === "Runtime.executionContextCreated") {
      const createdContextId = message.params?.context?.id || null;
      if (createdContextId && !contextIds.includes(createdContextId)) contextIds.push(createdContextId);
      if (!contextId) contextId = createdContextId;
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const line = (message.params?.args || []).map((arg) => arg.value || arg.description || "").join(" ");
      if (line) consoleLines.push(line);
      if (/OpenAI Photoshop Generator|split|koukoutu|抠抠图|完成|失败/i.test(line)) console.log(line);
    }
    if (message.id && pending.has(message.id)) {
      const callbacks = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(callbacks.timer);
      if (message.error) callbacks.reject(new Error(message.error.message || "CDP request failed"));
      else callbacks.resolve(message.result);
    }
  };

  async function enableRuntime() {
    await opened;
    await send("Runtime.enable");
    const start = Date.now();
    while (!contextIds.length && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    for (const candidateContextId of contextIds) {
      const result = await send("Runtime.evaluate", {
        expression: 'typeof document !== "undefined" && !!document.querySelector("#versionText")',
        contextId: candidateContextId,
        returnByValue: true,
        awaitPromise: true,
      });
      if (getEvaluateValue(result) === true) {
        contextId = candidateContextId;
        return;
      }
    }
    throw new Error(`Could not find a UXP panel DOM execution context among ${contextIds.length} contexts`);
  }

  async function evaluateJson(expression, awaitPromise = true) {
    const result = await send("Runtime.evaluate", {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise,
    });
    if (result?.exceptionDetails) {
      const exception = result.exceptionDetails.exception;
      throw new Error(exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    const value = getEvaluateValue(result);
    return typeof value === "string" ? JSON.parse(value) : value;
  }

  async function evaluateRaw(expression, awaitPromise = true) {
    const result = await send("Runtime.evaluate", {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise,
    });
    if (result?.exceptionDetails) {
      const exception = result.exceptionDetails.exception;
      throw new Error(exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    return getEvaluateValue(result);
  }

  return { consoleLines, enableRuntime, evaluateJson, evaluateRaw, close: () => ws.close() };
}

function panelSnapshotExpression() {
  return `JSON.stringify((()=> {
    const s = typeof getSettings === "function" ? getSettings() : {};
    const doc = app.activeDocument;
    const rect = (bounds) => {
      if (!bounds) return null;
      const n = (value) => typeof toNumber === "function" ? toNumber(value) : Number(value?._value ?? value?.value ?? value ?? 0);
      const left = n(bounds.left ?? bounds._left);
      const top = n(bounds.top ?? bounds._top);
      const right = n(bounds.right ?? bounds._right);
      const bottom = n(bounds.bottom ?? bounds._bottom);
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    const layers = doc ? Array.from(doc.layers || []).map((layer) => ({
      name: layer.name,
      id: layer.id,
      visible: layer.visible,
      bounds: rect(layer.boundsNoEffects || layer.bounds),
    })) : [];
    return {
      panelVersion: document.querySelector("#versionText")?.textContent || "",
      pluginVersion: typeof PLUGIN_VERSION !== "undefined" ? PLUGIN_VERSION : "",
      busy: !!state?.busy,
      status: document.querySelector("#statusBar")?.textContent || "",
      hasApiKey: !!s.apiKey,
      hasKoukoutuApiKey: !!s.koukoutuApiKey,
      model: s.model || "",
      baseUrl: s.baseUrl || "",
      doc: doc ? { title: doc.title || doc.name || "", width: Number(doc.width), height: Number(doc.height), layers: layers.length } : null,
      splitLayers: layers.filter((layer) => /^Split /.test(layer.name || "")).slice(0, 20),
    };
  })())`;
}

function startLiveSplitExpression(promptText, negativeText) {
  return `(() => {
    window.__liveSplitCheck = {
      done: false,
      error: null,
      status: "starting",
      results: [],
      layers: [],
      startedAt: new Date().toISOString()
    };
    const rect = (bounds) => {
      if (!bounds) return null;
      const n = (value) => typeof toNumber === "function" ? toNumber(value) : Number(value?._value ?? value?.value ?? value ?? 0);
      const left = n(bounds.left ?? bounds._left);
      const top = n(bounds.top ?? bounds._top);
      const right = n(bounds.right ?? bounds._right);
      const bottom = n(bounds.bottom ?? bounds._bottom);
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    const collectLayers = () => Array.from(app.activeDocument?.layers || [])
      .filter((layer) => /^Split /.test(layer.name || ""))
      .map((layer) => ({
        name: layer.name,
        id: layer.id,
        visible: layer.visible,
        bounds: rect(layer.boundsNoEffects || layer.bounds),
      }));
    window.__liveSplitPromise = (async () => {
      try {
        if (state.busy) throw new Error("插件当前仍在忙，请等当前任务结束后再跑 live split");
        state.mode = "split";
        if (typeof updateModeUI === "function") updateModeUI();
        document.querySelector("#promptInput").value = ${JSON.stringify(promptText)};
        document.querySelector("#negativePromptInput").value = ${JSON.stringify(negativeText)};
        window.__liveSplitCheck.beforeLayers = collectLayers();
        await runGeneration();
        window.__liveSplitCheck.status = document.querySelector("#statusBar")?.textContent || "";
        window.__liveSplitCheck.results = (state.results || []).slice(0, 12).map((item) => ({
          id: item.id,
          mode: item.mode,
          splitIndex: item.splitIndex,
          splitLabel: item.splitLabel,
          splitBounds: item.splitBounds,
          importVisibleRect: item.importVisibleRect,
          targetRect: item.targetRect,
          placementRect: item.placementRect,
          koukoutuMatte: !!item.koukoutuMatte,
          hasImportB64: !!item.importB64,
        }));
        window.__liveSplitCheck.layers = collectLayers();
      } catch (error) {
        window.__liveSplitCheck.error = String(error?.message || error);
        window.__liveSplitCheck.status = document.querySelector("#statusBar")?.textContent || "";
      } finally {
        window.__liveSplitCheck.done = true;
        window.__liveSplitCheck.busy = !!state.busy;
        window.__liveSplitCheck.finishedAt = new Date().toISOString();
      }
    })();
    return JSON.stringify({ started: true });
  })()`;
}

function liveStateExpression() {
  return `JSON.stringify((() => {
    const state = window.__liveSplitCheck || {};
    return {
      done: !!state.done,
      busy: !!window.state?.busy || !!state.busy,
      error: state.error || null,
      status: state.status || document.querySelector("#statusBar")?.textContent || "",
      results: state.results || [],
      layers: state.layers || [],
      beforeLayers: state.beforeLayers || [],
      startedAt: state.startedAt || null,
      finishedAt: state.finishedAt || null,
    };
  })())`;
}

function assertLiveResult(snapshot, version) {
  if (snapshot.panelVersion !== `v${version}` || snapshot.pluginVersion !== version) {
    throw new Error(`Panel version mismatch: expected ${version}, got ${snapshot.panelVersion}/${snapshot.pluginVersion}`);
  }
  if (!snapshot.doc) throw new Error("No active Photoshop document");
  if (!snapshot.hasApiKey) throw new Error("Missing OpenAI API Key");
  if (!snapshot.hasKoukoutuApiKey) throw new Error("Missing Koukoutu API Key");
}

function rectDelta(bounds, rect) {
  if (!bounds || !rect) return Infinity;
  return Math.max(
    Math.abs(Number(bounds.left) - Number(rect.left)),
    Math.abs(Number(bounds.top) - Number(rect.top)),
    Math.abs(Number(bounds.right) - Number(rect.right)),
    Math.abs(Number(bounds.bottom) - Number(rect.bottom))
  );
}

function summarizePlacement(state) {
  const byName = new Map((state.layers || []).map((layer) => [layer.name, layer]));
  return (state.results || []).map((item, index) => {
    const label = item.splitLabel ? `Split ${item.splitIndex} ${item.splitLabel}` : `Split Element ${item.splitIndex || index + 1}`;
    const layer = byName.get(label) || (state.layers || []).find((candidate) => candidate.name?.startsWith(`Split ${item.splitIndex} `));
    const target = item.importVisibleRect || item.splitBounds;
    return {
      label,
      layerBounds: layer?.bounds || null,
      expectedBounds: target || null,
      maxDelta: rectDelta(layer?.bounds, target),
      koukoutuMatte: !!item.koukoutuMatte,
      hasImportB64: !!item.hasImportB64,
    };
  });
}

async function main() {
  const version = readPluginVersion();
  const debug = existingSessionId
    ? await debugExistingPluginSession(version, existingSessionId)
    : await loadAndDebugPlugin(version);
  const cdp = connectCdp(debug.cdpUrl);
  try {
    await cdp.enableRuntime();
    const snapshot = await cdp.evaluateJson(panelSnapshotExpression());
    assertLiveResult(snapshot, version);
    console.log(`LIVE_SPLIT_PREFLIGHT ${JSON.stringify({ ...snapshot, session: debug.pluginSessionId })}`);
    if (preflightOnly) return;

    await cdp.evaluateJson(startLiveSplitExpression(prompt, negative), false);
    let state = null;
    const start = Date.now();
    let lastStatus = "";
    while (Date.now() - start < timeoutMs) {
      state = await cdp.evaluateJson(liveStateExpression(), false);
      if (state.status && state.status !== lastStatus) {
        lastStatus = state.status;
        console.log(`LIVE_SPLIT_STATUS ${lastStatus}`);
      }
      if (state.done) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (!state?.done) throw new Error(`Timed out waiting for live split; last status=${lastStatus || "(empty)"}`);
    if (state.error) throw new Error(`Live split failed: ${state.error}; status=${state.status || ""}`);
    if (!/完成：已用 gpt-image-2 拆出/.test(state.status || "")) {
      throw new Error(`Unexpected live split status: ${state.status || "(empty)"}`);
    }
    const placement = summarizePlacement(state);
    const bad = placement.filter((item) => !(item.maxDelta <= 4) || !item.koukoutuMatte || !item.hasImportB64);
    console.log(`LIVE_SPLIT_RESULT ${JSON.stringify({ status: state.status, resultCount: state.results.length, layerCount: state.layers.length, placement })}`);
    if (bad.length) {
      throw new Error(`Live split placement/matte check failed: ${JSON.stringify(bad)}`);
    }
    console.log(`LIVE_SPLIT_OK version=${version} prompt=${JSON.stringify(prompt)}`);
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  console.error(`LIVE_SPLIT_FAILED ${error.message || error}`);
  process.exitCode = 1;
});
