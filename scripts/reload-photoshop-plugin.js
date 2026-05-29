#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const defaultPluginPath = "/private/tmp/openai-photoshop-generator-dev";
const pluginPath = path.resolve(process.argv[2] || defaultPluginPath);
const port = Number(process.env.UXP_DEVTOOLS_PORT || 14001);
const host = process.env.UXP_DEVTOOLS_HOST || "127.0.0.1";
const timeoutMs = Number(process.env.UXP_RELOAD_TIMEOUT_MS || 15000);

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

function getPhotoshopPluginInfoHint() {
  const infoFile = path.join(os.homedir(), "Library/Application Support/Adobe/UXP/PluginsInfo/v1/PS.json");
  try {
    const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
    const entry = (info.plugins || []).find((plugin) => plugin?.pluginId === "com.local.openai.photoshop.generator");
    if (!entry) return `Photoshop plugin info cache has no com.local.openai.photoshop.generator entry at ${infoFile}`;
    return `Photoshop plugin info cache version=${entry.versionString || "?"} status=${entry.status || "?"}`;
  } catch (error) {
    return `could not inspect Photoshop plugin info cache: ${error.message || error}`;
  }
}

function getDevtoolsServiceHint(error) {
  const message = error?.message || String(error || "");
  if (/ECONNREFUSED/.test(message)) {
    return `UXP Developer Service is not reachable at ${host}:${port}; open Adobe UXP Developer Tool, make sure Photoshop is connected, then rerun reload`;
  }
  if (/ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/.test(message)) {
    return `UXP Developer Service connection to ${host}:${port} failed; verify Adobe UXP Developer Tool is running and listening on UXP_DEVTOOLS_PORT`;
  }
  return "";
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
  const logDir = path.join(os.homedir(), "Library/Logs/Adobe/Adobe Photoshop 2026");
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
  const expectedVersion = readPluginVersion();
  const initEntries = [...text.matchAll(/\[([0-9_-]+)\][^\n]*\[OpenAI Photoshop Generator\] init ([0-9.]+)/g)]
    .map((match) => ({ time: match[1], version: match[2] }));
  const lastInit = initEntries[initEntries.length - 1] || null;
  const removeAttempts = (text.match(/Devtools: Removing existing plugin with id\s+com\.local\.openai\.photoshop\.generator/g) || []).length;
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
  return `latest Photoshop UXP log ${latestLog}: ${[...new Set(hints)].join("; ")}. Restart Photoshop to clear this host-side UXP state before rerunning reload.`;
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

function parseServerFrames(buffer, onText) {
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

function send(socket, message) {
  socket.write(makeClientFrame(JSON.stringify(message)));
}

function main() {
  const version = readPluginVersion();
  const socket = net.connect(port, host);
  const key = crypto.randomBytes(16).toString("base64");
  let handshake = "";
  let handshaken = false;
  let frameBuffer = Buffer.alloc(0);
  let photoshopClientId = null;
  let sentLoad = false;
  let loadReply = null;
  let sawVersionInit = false;
  let settled = false;

  function finish(error) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) {
      const details = [getDevtoolsServiceHint(error), getDiskVersionHint(), getPhotoshopPluginInfoHint(), getRecentPhotoshopUxpLogHint()].filter(Boolean).join("; ");
      console.error(`UXP_RELOAD_FAILED ${error.message || error}${details ? `; ${details}` : ""}`);
      socket.destroy();
      process.exitCode = 1;
      return;
    }
    console.log(`UXP_RELOAD_OK version=${version} session=${loadReply?.pluginSessionId || "unknown"}`);
    socket.end();
  }

  function maybeSendLoad() {
    if (sentLoad || !photoshopClientId) return;
    sentLoad = true;
    send(socket, {
      command: "proxy",
      clientId: photoshopClientId,
      requestId: 1,
      message: {
        command: "Plugin",
        action: "load",
        params: {
          provider: {
            type: "disk",
            path: pluginPath,
          },
        },
        breakOnStart: false,
        isPlaygroundPlugin: false,
      },
    });
  }

  function handleMessage(text) {
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
      maybeSendLoad();
    }

    if (message.command === "reply" && message.requestId === 1) {
      if (message.error || message.success === false) {
        finish(new Error(message.error || message.errorMessage || "Photoshop rejected plugin load"));
        return;
      }
      loadReply = message;
      if (sawVersionInit) finish();
    }

    if (message.command === "hostAppLog") {
      const logMessage = message.details?.message || "";
      if (logMessage.includes(`[OpenAI Photoshop Generator] init ${version}`)) {
        sawVersionInit = true;
        if (loadReply) finish();
      }
    }

    if (message.command === "socketClose" && !settled) {
      finish(new Error("UXP Developer Service closed the websocket before reload completed"));
    }
  }

  const timer = setTimeout(() => {
    finish(new Error(`Timed out waiting for Photoshop to reload plugin version ${version}`));
  }, timeoutMs);

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
        finish(new Error(`Unexpected websocket handshake response: ${status}`));
        return;
      }
      handshaken = true;
      frameBuffer = Buffer.concat([frameBuffer, Buffer.from(handshake.slice(headerEnd + 4), "binary")]);
      frameBuffer = parseServerFrames(frameBuffer, handleMessage);
      return;
    }
    frameBuffer = Buffer.concat([frameBuffer, data]);
    frameBuffer = parseServerFrames(frameBuffer, handleMessage);
  });

  socket.on("error", (error) => {
    finish(error);
  });
}

main();
