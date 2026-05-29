#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pluginPath = path.resolve(process.argv[2] || "/private/tmp/openai-photoshop-generator-dev");
const host = process.env.UXP_DEVTOOLS_HOST || "127.0.0.1";
const port = Number(process.env.UXP_DEVTOOLS_PORT || 14001);
const timeoutMs = Number(process.env.PHOTOSHOP_SMOKE_TIMEOUT_MS || 120000);
const modes = ["generate", "reference", "inpaint", "cutout", "split", "outpaint"];

function readPluginVersion() {
  const appJs = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const version = appJs.match(/const\s+PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1];
  if (!version) throw new Error("Could not read PLUGIN_VERSION from src/app.js");
  return version;
}

function readDiskVersions(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const appJs = fs.readFileSync(path.join(dir, "src/app.js"), "utf8");
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  return {
    manifest: manifest.version || "",
    app: appJs.match(/const\s+PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1] || "",
    html: html.match(/version-inline">v([^<]+)</)?.[1] || "",
  };
}

function getDiskVersionHint() {
  try {
    const versions = readDiskVersions(pluginPath);
    return `disk versions at ${pluginPath}: manifest=${versions.manifest || "?"}, app=${versions.app || "?"}, html=${versions.html || "?"}`;
  } catch (error) {
    return `could not inspect disk plugin at ${pluginPath}: ${error.message || error}`;
  }
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
    if (opcode === 8) onText(JSON.stringify({ command: "socketClose" }));
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
    } catch (error) {
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

  return {
    ready,
    proxy,
    close() {
      socket.end();
    },
  };
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
    const debugReply = await cli.proxy({
      command: "Plugin",
      action: "debug",
      pluginSessionId,
    });
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

function connectCdp(cdpUrl) {
  if (typeof WebSocket === "undefined") {
    throw new Error("This Node.js runtime does not expose global WebSocket");
  }
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
    } catch (error) {
      return;
    }
    if (message.method === "Runtime.executionContextCreated") {
      const createdContextId = message.params?.context?.id || null;
      if (createdContextId && !contextIds.includes(createdContextId)) {
        contextIds.push(createdContextId);
      }
      if (!contextId) {
        contextId = createdContextId;
      }
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const line = (message.params?.args || []).map((arg) => arg.value || arg.description || "").join(" ");
      if (line) consoleLines.push(line);
      if (/OpenAI Photoshop Generator|offline diagnostics|split|inpaint/i.test(line)) {
        console.log(line);
      }
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
    if (!contextIds.length) throw new Error("Could not find the UXP panel Runtime execution context");
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

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result?.exceptionDetails) {
      const exception = result.exceptionDetails.exception;
      throw new Error(exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    return result;
  }

  return {
    consoleLines,
    enableRuntime,
    evaluate,
    close() {
      ws.close();
    },
  };
}

function assertSmokeLogs(consoleLines) {
  const joined = consoleLines.join("\n");
  for (const mode of modes) {
    if (!joined.includes(`offline diagnostics mode start: ${mode}`)) {
      throw new Error(`Missing Photoshop smoke start log for mode: ${mode}`);
    }
    if (!joined.includes(`offline diagnostics mode done: ${mode}`)) {
      throw new Error(`Missing Photoshop smoke done log for mode: ${mode}`);
    }
  }
  if (/offline diagnostics mode failed|offline diagnostics failed status|离线诊断失败/.test(joined)) {
    throw new Error("Photoshop smoke reported an offline diagnostics failure");
  }
  if (!joined.includes("offline diagnostics coverage:")) {
    throw new Error("Missing Photoshop smoke coverage matrix log");
  }
  for (const invariant of ["noMaskReference=ok", "noMaskInpaint=ok", "directSelectionPatch=ok", "directSelectionBounds=ok", "maskedOutpaint=ok", "outpaintCanvasExpand=ok", "cutoutOriginalSize=ok", "splitFullCanvas=ok"]) {
    if (!joined.includes(invariant)) {
      throw new Error(`Missing Photoshop smoke invariant: ${invariant}`);
    }
  }
}

function hasAllSmokeLogs(consoleLines) {
  const joined = consoleLines.join("\n");
  return modes.every(
    (mode) => joined.includes(`offline diagnostics mode start: ${mode}`) && joined.includes(`offline diagnostics mode done: ${mode}`)
  );
}

function assertNoSmokeFailures(consoleLines) {
  const joined = consoleLines.join("\n");
  if (/offline diagnostics mode failed|offline diagnostics failed status|离线诊断失败/.test(joined)) {
    throw new Error("Photoshop smoke reported an offline diagnostics failure");
  }
}

async function waitForSmokeCompletion(cdp) {
  const start = Date.now();
  let lastStatus = "";
  while (Date.now() - start < timeoutMs) {
    assertNoSmokeFailures(cdp.consoleLines);
    if (hasAllSmokeLogs(cdp.consoleLines)) return;
    const statusResult = await cdp.evaluate('document.querySelector("#statusBar")?.textContent || ""');
    lastStatus = getEvaluateValue(statusResult) || "";
    if (/离线诊断失败|离线诊断完成但有|失败：/.test(lastStatus)) {
      throw new Error(`Photoshop smoke failed with status: ${lastStatus}`);
    }
    if (lastStatus.includes("离线诊断通过") && hasAllSmokeLogs(cdp.consoleLines)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for Photoshop smoke logs; last status=${lastStatus || "(empty)"}`);
}

function getEvaluateValue(result) {
  let current = result;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!current || typeof current !== "object") return current;
    if ("result" in current && current.result && typeof current.result === "object") {
      current = current.result;
      continue;
    }
    if ("value" in current) {
      const value = current.value;
      if (value && typeof value === "object") {
        current = value;
        continue;
      }
      return value;
    }
    if ("description" in current) return current.description;
    return current;
  }
  return current;
}

function describeEvaluateResult(result) {
  try {
    return JSON.stringify(result);
  } catch (error) {
    return String(result);
  }
}

function getPhotoshopPluginInfoHint() {
  const infoFile = path.join(osHomedir(), "Library/Application Support/Adobe/UXP/PluginsInfo/v1/PS.json");
  try {
    const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
    const entry = (info.plugins || []).find((plugin) => plugin?.pluginId === "com.local.openai.photoshop.generator");
    if (!entry) return `Photoshop plugin info cache has no com.local.openai.photoshop.generator entry at ${infoFile}`;
    return `Photoshop plugin info cache version=${entry.versionString || "?"} status=${entry.status || "?"}`;
  } catch (error) {
    return `could not inspect Photoshop plugin info cache: ${error.message || error}`;
  }
}

function collectUniqueMatches(text, pattern) {
  const values = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[1] || match[0];
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

function getRecentPhotoshopUxpLogHint() {
  const logDir = path.join(osHomedir(), "Library/Logs/Adobe/Adobe Photoshop 2026");
  let entries = [];
  try {
    entries = fs.readdirSync(logDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^UXPLogs_.*\.log$/.test(entry.name))
      .map((entry) => {
        const file = path.join(logDir, entry.name);
        return { file, mtimeMs: fs.statSync(file).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch (error) {
    return "";
  }

  const latestEntry = entries[0];
  const latest = latestEntry?.file;
  if (!latest || !latestEntry) return "";
  let text = "";
  try {
    const stat = fs.statSync(latest);
    const fd = fs.openSync(latest, "r");
    const length = Math.min(stat.size, 1024 * 1024);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
    fs.closeSync(fd);
    text = buffer.toString("utf8");
  } catch (error) {
    return "";
  }

  const hints = [];
  const modalIds = collectUniqueMatches(text, /Plugin:\s*(100\d+)\s+is running a modal command/g);
  const scriptIds = collectUniqueMatches(text, /Created ScriptPlugin manifest\s*=\s*\{[^\n]*"id":"(100\d+)"/g);
  const initVersions = collectUniqueMatches(text, /\[OpenAI Photoshop Generator\] init ([0-9.]+)/g);
  const initEntries = [...text.matchAll(/\[([0-9_-]+)\][^\n]*\[OpenAI Photoshop Generator\] init ([0-9.]+)/g)]
    .map((match) => ({ time: match[1], version: match[2] }));
  const lastInit = initEntries[initEntries.length - 1] || null;
  const removeAttempts = (text.match(/Devtools: Removing existing plugin with id\s+com\.local\.openai\.photoshop\.generator/g) || []).length;
  const expectedVersion = readPluginVersion();
  const latestLog = `${path.basename(latest)} mtime=${new Date(latestEntry.mtimeMs).toISOString()}`;

  if (lastInit) {
    hints.push(`last OpenAI plugin init in latest log: ${lastInit.version} at ${lastInit.time}`);
    if (lastInit.version !== expectedVersion) {
      hints.push(`Photoshop is still showing/running an older in-memory plugin (${lastInit.version}); expected disk version is ${expectedVersion}`);
    }
  }
  if (modalIds.length) {
    hints.push(`Photoshop UXP has stale temporary ScriptPlugin modal command(s): ${modalIds.join(", ")}`);
  }
  if (/Waiting for the debugger to attach/.test(text) && scriptIds.length) {
    hints.push(`previous smoke helper ScriptPlugin id(s) waiting for debugger attach: ${scriptIds.join(", ")}`);
  }
  if (/Can't remove plugin as it either doesn't exist, or it's in a state where it cannot be removed/.test(text)) {
    hints.push("Photoshop cannot remove the existing plugin session");
  }
  if (removeAttempts && !initVersions.includes(expectedVersion)) {
    hints.push(`latest UXP log shows ${removeAttempts} remove attempt(s) but no init ${expectedVersion} line`);
  }
  if (initVersions.length) {
    hints.push(`OpenAI init versions seen in latest log tail: ${initVersions.slice(-5).join(", ")}`);
  }
  if (!hints.length) return "";
  return `latest Photoshop UXP log ${latestLog}: ${[...new Set(hints)].join("; ")}. Restart Photoshop to clear this host-side UXP state before rerunning the smoke.`;
}

function osHomedir() {
  return process.env.HOME || process.env.USERPROFILE || "";
}

async function main() {
  const version = readPluginVersion();
  const debug = await loadAndDebugPlugin(version);
  const cdp = connectCdp(debug.cdpUrl);
  try {
    await cdp.enableRuntime();
    const versionResult = await cdp.evaluate('document.querySelector("#versionText")?.textContent');
    const runtimeVersion = getEvaluateValue(versionResult);
    if (runtimeVersion !== `v${version}`) {
      throw new Error(
        `Photoshop panel version mismatch: expected v${version}, got ${String(runtimeVersion)}; raw=${describeEvaluateResult(versionResult)}`
      );
    }
    const runtimePluginVersionResult = await cdp.evaluate('typeof PLUGIN_VERSION !== "undefined" ? PLUGIN_VERSION : ""');
    const runtimePluginVersion = getEvaluateValue(runtimePluginVersionResult) || "";
    if (runtimePluginVersion !== version) {
      throw new Error(
        `Photoshop runtime PLUGIN_VERSION mismatch: expected ${version}, got ${String(runtimePluginVersion)}; raw=${describeEvaluateResult(runtimePluginVersionResult)}`
      );
    }
    const functionResult = await cdp.evaluate("typeof runOfflineSixModeDiagnostics");
    if (getEvaluateValue(functionResult) !== "function") {
      throw new Error("runOfflineSixModeDiagnostics is not available in the panel runtime");
    }
    await cdp.evaluate(
      'window.__openAiSmokePromise = (async () => { await runOfflineSixModeDiagnostics(); return document.querySelector("#statusBar")?.textContent || ""; })(); "started";'
    );
    await waitForSmokeCompletion(cdp);
    assertSmokeLogs(cdp.consoleLines);
    const statusResult = await cdp.evaluate('document.querySelector("#statusBar")?.textContent || ""');
    const statusText = getEvaluateValue(statusResult) || "";
    if (!statusText.includes("离线诊断通过")) {
      throw new Error(`Unexpected final Photoshop smoke status: ${statusText}`);
    }
    const matrix = modes.map((mode) => `${mode}=ok`).join(" ");
    console.log(`PHOTOSHOP_SMOKE_MATRIX version=${version} runtimePluginVersion=${runtimePluginVersion} panelVersion=${runtimeVersion} ${matrix} noMaskReference=ok noMaskInpaint=ok directSelectionPatch=ok directSelectionBounds=ok maskedOutpaint=ok outpaintCanvasExpand=ok cutoutOriginalSize=ok splitFullCanvas=ok`);
    console.log(`PHOTOSHOP_SMOKE_OK version=${version} session=${debug.pluginSessionId}`);
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  const details = [getDiskVersionHint(), getPhotoshopPluginInfoHint(), getRecentPhotoshopUxpLogHint()].filter(Boolean).join("; ");
  console.error(`PHOTOSHOP_SMOKE_FAILED ${error.message || error}${details ? `; ${details}` : ""}`);
  process.exitCode = 1;
});
