#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const appName = process.env.PHOTOSHOP_APP_NAME || "Adobe Photoshop 2026";
const appPath = process.env.PHOTOSHOP_APP_PATH || "/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app";
const confirmSaved = process.argv.includes("--confirm-saved");
const skipSmoke = process.argv.includes("--skip-smoke");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
    timeout: options.timeoutMs || 0,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}${output ? `\n${output}` : ""}`);
  }
  return String(result.stdout || "").trim();
}

function runNodeScript(script, args = [], options = {}) {
  run(process.execPath, [script, ...args], { stdio: "inherit", timeoutMs: options.timeoutMs || 0 });
}

function readPluginVersion() {
  const appJs = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const version = appJs.match(/const\s+PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1];
  if (!version) throw new Error("Could not read PLUGIN_VERSION from src/app.js");
  return version;
}

function isPhotoshopRunning() {
  const result = spawnSync("/usr/bin/osascript", ["-e", `application "${appName}" is running`], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (result.status === 0) return String(result.stdout || "").trim() === "true";
  const fallback = spawnSync("/usr/bin/pgrep", ["-f", `${appName}.app/Contents/MacOS/${appName}`], {
    encoding: "utf8",
    timeout: 3000,
  });
  return fallback.status === 0;
}

function waitForRunningState(expected, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isPhotoshopRunning() === expected) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}

function quitPhotoshop() {
  if (!isPhotoshopRunning()) {
    console.log("PHOTOSHOP_RESTART_STEP already-stopped");
    return;
  }
  const script = `tell application "${appName}" to quit saving no`;
  const result = spawnSync("/usr/bin/osascript", ["-e", script], {
    encoding: "utf8",
    timeout: 15000,
  });
  if (result.error || result.status !== 0) {
    const detail = [
      result.error?.message || "",
      result.stdout || "",
      result.stderr || "",
    ].filter(Boolean).join("\n").trim();
    throw new Error(`Photoshop quit request did not complete. Close Photoshop manually after saving PSD, then rerun this script.\n${detail}`);
  }
  waitForRunningState(false, 45000, "Waiting for Photoshop to quit");
  console.log("PHOTOSHOP_RESTART_STEP stopped");
}

function startPhotoshop() {
  if (isPhotoshopRunning()) {
    console.log("PHOTOSHOP_RESTART_STEP already-running");
    return;
  }
  if (fs.existsSync(appPath)) {
    run("/usr/bin/open", [appPath]);
  } else {
    run("/usr/bin/open", ["-a", appName]);
  }
  waitForRunningState(true, 60000, "Waiting for Photoshop to start");
  console.log("PHOTOSHOP_RESTART_STEP started");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 12000);
}

function printDryRun(version) {
  console.log(`PHOTOSHOP_RESTART_DRY_RUN version=${version}`);
  console.log("This script will not quit Photoshop unless --confirm-saved is provided.");
  console.log("After saving PSD files, run: node scripts/restart-photoshop-and-smoke.js --confirm-saved");
}

function main() {
  const version = readPluginVersion();
  if (!confirmSaved) {
    printDryRun(version);
    return;
  }
  console.log(`PHOTOSHOP_RESTART_BEGIN version=${version}`);
  runNodeScript("scripts/sync-runtime-copies.js");
  quitPhotoshop();
  startPhotoshop();
  runNodeScript("scripts/reload-photoshop-plugin.js", [], { timeoutMs: 60000 });
  if (!skipSmoke) {
    runNodeScript("scripts/run-photoshop-smoke.js", [], { timeoutMs: 180000 });
  }
  runNodeScript("scripts/audit-plugin-state.js", ["--strict-runtime"]);
  console.log(`PHOTOSHOP_RESTART_AND_SMOKE_OK version=${version}`);
}

try {
  main();
} catch (error) {
  const message = error?.message || String(error);
  console.error(`PHOTOSHOP_RESTART_FAILED ${message}`);
  if (/quit request did not complete|Waiting for Photoshop to quit/i.test(message)) {
    console.error("PHOTOSHOP_RESTART_NEXT_ACTION Save all PSD files, close Photoshop manually, then rerun: node scripts/restart-photoshop-and-smoke.js --confirm-saved");
  } else if (/ECONNREFUSED|UXP Developer Service is not reachable/i.test(message)) {
    console.error("PHOTOSHOP_RESTART_NEXT_ACTION Open Adobe UXP Developer Tool, make sure Photoshop is connected, then rerun: node scripts/restart-photoshop-and-smoke.js --confirm-saved");
  } else if (/reload|UXP_RELOAD_FAILED|plugin load|init/i.test(message)) {
    console.error("PHOTOSHOP_RESTART_NEXT_ACTION Reopen Photoshop fully, ensure UXP Developer Tool is connected, then rerun: node scripts/restart-photoshop-and-smoke.js --confirm-saved");
  } else if (/PHOTOSHOP_SMOKE_FAILED|runtime smoke|offline diagnostics/i.test(message)) {
    console.error("PHOTOSHOP_RESTART_NEXT_ACTION Keep Photoshop open and rerun: node scripts/run-photoshop-smoke.js");
  } else {
    console.error("PHOTOSHOP_RESTART_NEXT_ACTION Run: node scripts/audit-plugin-state.js");
  }
  process.exitCode = 1;
}
