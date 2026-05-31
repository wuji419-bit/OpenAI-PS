#!/usr/bin/env node

const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const appName = process.env.PHOTOSHOP_APP_NAME || "Adobe Photoshop 2026";
const pluginId = "com.local.openai.photoshop.generator";
const expectedModes = ["generate", "reference", "inpaint", "outpaint", "cutout", "split"];
const expectedInvariants = ["noMaskReference", "noMaskInpaint", "directSelectionPatch", "directSelectionBounds", "maskedOutpaint", "outpaintCanvasExpand", "cutoutOriginalSize", "splitFullCanvas"];
const managedFiles = [
  "manifest.json",
  "index.html",
  "CHANGELOG.md",
  "README_CN.md",
  "src/app.js",
  "src/styles.css",
  "scripts/smoke-plugin.js",
  "scripts/audit-plugin-state.js",
  "scripts/reload-photoshop-plugin.js",
  "scripts/restart-photoshop-and-smoke.js",
  "scripts/run-photoshop-smoke.js",
  "scripts/sync-runtime-copies.js",
];
const strictRuntime = process.argv.includes("--strict-runtime");

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function runCapture(command, args, timeoutMs = 3000) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return {
    status: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    error: result.error?.message || null,
  };
}

function readSourceVersion() {
  const appJs = readText(path.join(root, "src/app.js"));
  const version = appJs.match(/const\s+PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1] || "";
  if (!version) throw new Error("Missing PLUGIN_VERSION in src/app.js");
  return version;
}

function readDiskVersions(dir) {
  const manifest = readJson(path.join(dir, "manifest.json"));
  const appJs = readText(path.join(dir, "src/app.js"));
  const html = readText(path.join(dir, "index.html"));
  return {
    manifest: manifest.version || "",
    app: appJs.match(/const\s+PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1] || "",
    html: html.match(/version-inline">v([^<]+)</)?.[1] || "",
    appCache: html.includes(`app.js?v=${manifest.version || ""}`),
    styleCache: html.includes(`styles.css?v=${manifest.version || ""}`),
  };
}

function auditManagedFiles(dir) {
  const mismatched = [];
  for (const file of managedFiles) {
    const source = path.join(root, file);
    const target = path.join(dir, file);
    if (!fs.existsSync(target)) {
      mismatched.push(`${file}:missing`);
      continue;
    }
    if (hashFile(source) !== hashFile(target)) {
      mismatched.push(`${file}:hash-mismatch`);
    }
  }
  return {
    managedFilesOk: mismatched.length === 0,
    managedFileCount: managedFiles.length,
    mismatchedManagedFiles: mismatched,
  };
}

function isPluginDir(dir) {
  try {
    return readJson(path.join(dir, "manifest.json")).id === pluginId;
  } catch (error) {
    return false;
  }
}

function walkDirs(rootDir, maxDepth, visitor, depth = 0) {
  if (depth > maxDepth) return;
  let entries = [];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (error) {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(rootDir, entry.name);
    visitor(dir);
    walkDirs(dir, maxDepth, visitor, depth + 1);
  }
}

function getAdobeUxpPluginDirs() {
  const dirs = [];
  const uxpRoot = path.join(os.homedir(), "Library/Application Support/Adobe/UXP");
  walkDirs(uxpRoot, 8, (dir) => {
    if (isPluginDir(dir)) dirs.push(dir);
  });
  return dirs;
}

function getWorkspaceDirs() {
  const workspaceFile = getWorkspaceFile();
  if (!fs.existsSync(workspaceFile)) return [];
  try {
    const workspace = readJson(workspaceFile);
    return (workspace.plugins || [])
      .map((plugin) => plugin?.manifestPath)
      .filter(Boolean)
      .map((manifestPath) => path.dirname(manifestPath))
      .filter(isPluginDir);
  } catch (error) {
    return [];
  }
}

function getWorkspaceFile() {
  return path.join(os.homedir(), "Library/Application Support/Adobe/Adobe UXP Developer Tool/plugins_workspace.json");
}

function readDevtoolsWorkspaceState(expectedVersion) {
  const file = getWorkspaceFile();
  if (!fs.existsSync(file)) {
    return { file, found: false, plugins: [], openAiPluginEntries: [], ok: null };
  }
  try {
    const workspace = readJson(file);
    const plugins = (workspace.plugins || []).map((plugin) => {
      const manifestPath = plugin?.manifestPath || "";
      const dir = manifestPath ? path.dirname(manifestPath) : "";
      const isOpenAiPlugin = Boolean(dir && isPluginDir(dir));
      const versions = isOpenAiPlugin ? readDiskVersions(dir) : null;
      const managed = isOpenAiPlugin ? auditManagedFiles(dir) : null;
      return {
        hostParam: plugin?.hostParam || "",
        manifestPath,
        dir,
        isOpenAiPlugin,
        versionOk: isOpenAiPlugin ? (
          versions.manifest === expectedVersion &&
          versions.app === expectedVersion &&
          versions.html === expectedVersion &&
          versions.appCache &&
          versions.styleCache
        ) : null,
        managedFilesOk: managed?.managedFilesOk ?? null,
        versions,
        mismatchedManagedFiles: managed?.mismatchedManagedFiles || [],
      };
    });
    const openAiPluginEntries = plugins.filter((plugin) => plugin.isOpenAiPlugin);
    const ok = openAiPluginEntries.length === 0 || openAiPluginEntries.every((plugin) => plugin.versionOk && plugin.managedFilesOk);
    return { file, found: true, plugins, openAiPluginEntries, ok };
  } catch (error) {
    return { file, found: true, error: error.message || String(error), plugins: [], openAiPluginEntries: [], ok: false };
  }
}

function getTempDevelopmentDirs() {
  const dirs = [];
  walkDirs("/private/tmp", 5, (dir) => {
    if (!/openai|OpenAI|photoshop-generator/i.test(dir)) return;
    if (isPluginDir(dir)) dirs.push(dir);
  });
  return dirs;
}

function collectPluginDirs() {
  return [...new Set([
    root,
    "/private/tmp/openai-photoshop-generator-dev",
    path.join(os.homedir(), "source/OpenAI-PS"),
    path.join(os.homedir(), "Library/Application Support/Adobe/UXP/Plugins/External/com.local.openai.photoshop.generator"),
    path.join(os.homedir(), "Library/Application Support/Adobe/UXP/PluginsStorage/PHSP/27/External/com.local.openai.photoshop.generator"),
    path.join(os.homedir(), "Library/Application Support/Adobe/UXP/PluginsStorage/PHSP/27/Developer/com.local.openai.photoshop.generator"),
    ...getAdobeUxpPluginDirs(),
    ...getWorkspaceDirs(),
    ...getTempDevelopmentDirs(),
  ].map((dir) => path.resolve(dir)))]
    .filter(isPluginDir);
}

function auditPluginDirs(expectedVersion) {
  const dirs = collectPluginDirs();
  return dirs.map((dir) => {
    const versions = readDiskVersions(dir);
    const managed = auditManagedFiles(dir);
    const ok = versions.manifest === expectedVersion &&
      versions.app === expectedVersion &&
      versions.html === expectedVersion &&
      versions.appCache &&
      versions.styleCache &&
      managed.managedFilesOk;
    return { dir, ok, ...versions, ...managed };
  });
}

function readPhotoshopPluginInfo() {
  const infoFile = path.join(os.homedir(), "Library/Application Support/Adobe/UXP/PluginsInfo/v1/PS.json");
  if (!fs.existsSync(infoFile)) return { file: infoFile, found: false };
  try {
    const info = readJson(infoFile);
    const entry = (info.plugins || []).find((plugin) => plugin?.pluginId === pluginId);
    return {
      file: infoFile,
      found: Boolean(entry),
      versionString: entry?.versionString || "",
      status: entry?.status || "",
      path: entry?.path || "",
    };
  } catch (error) {
    return { file: infoFile, found: false, error: error.message || String(error) };
  }
}

function readPhotoshopProcessState() {
  const appleScript = runCapture("/usr/bin/osascript", ["-e", `application "${appName}" is running`]);
  const appleScriptRunning = appleScript.status === 0 && appleScript.stdout.trim() === "true";
  const pgrep = runCapture("/usr/bin/pgrep", ["-f", `${appName}.app/Contents/MacOS/${appName}`]);
  const rawPids = pgrep.status === 0
    ? pgrep.stdout.split(/\s+/).map((pid) => pid.trim()).filter(Boolean)
    : [];
  let processes = [];
  if (rawPids.length) {
    const ps = runCapture("/bin/ps", ["-p", rawPids.join(","), "-o", "pid=,ppid=,stat=,command="]);
    if (ps.status === 0) {
      processes = ps.stdout.split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
          if (!match) return { raw: line };
          return {
            pid: match[1],
            ppid: match[2],
            state: match[3],
            command: match[4],
          };
        })
        .filter((processInfo) => String(processInfo.command || "").includes(`${appName}.app/Contents/MacOS/${appName}`));
    }
  }
  const pids = processes.map((processInfo) => processInfo.pid).filter(Boolean);
  return {
    appName,
    running: appleScriptRunning || processes.length > 0,
    appleScriptRunning,
    pids,
    rawPids,
    processes,
    osascriptError: appleScript.status === 0 ? null : (appleScript.stderr.trim() || appleScript.error),
  };
}

function collectUniqueMatches(text, pattern) {
  const values = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[1] || match[0];
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

function readLatestPhotoshopUxpLog() {
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
    return { found: false, error: error.message || String(error) };
  }
  const latest = entries[0];
  if (!latest) return { found: false };
  const stat = fs.statSync(latest.file);
  const fd = fs.openSync(latest.file, "r");
  const length = Math.min(stat.size, 1024 * 1024);
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
  fs.closeSync(fd);
  return {
    found: true,
    file: latest.file,
    mtime: new Date(latest.mtimeMs).toISOString(),
    text: buffer.toString("utf8"),
  };
}

function auditPhotoshopRuntime(expectedVersion) {
  const latest = readLatestPhotoshopUxpLog();
  const restartNextAction = "Save all PSD files, restart Photoshop, then run: node scripts/restart-photoshop-and-smoke.js --confirm-saved";
  if (!latest.found) {
    return {
      found: false,
      ok: false,
      reason: latest.error || "no UXP log found",
      diagnosis: "Could not verify the running Photoshop UXP plugin version from logs.",
      nextAction: restartNextAction,
    };
  }
  const text = latest.text || "";
  const initEntries = [...text.matchAll(/\[([0-9_-]+)\][^\n]*\[OpenAI Photoshop Generator\] init ([0-9.]+)/g)]
    .map((match) => ({ time: match[1], version: match[2] }));
  const lastInit = initEntries[initEntries.length - 1] || null;
  const initVersionsSeenInTail = collectUniqueMatches(text, /\[OpenAI Photoshop Generator\] init ([0-9.]+)/g);
  const expectedInitSeen = initVersionsSeenInTail.includes(expectedVersion);
  const modalIds = collectUniqueMatches(text, /Plugin:\s*(100\d+)\s+is running a modal command/g);
  const scriptIds = collectUniqueMatches(text, /Created ScriptPlugin manifest\s*=\s*\{[^\n]*"id":"(100\d+)"/g);
  const removeAttempts = (text.match(/Devtools: Removing existing plugin with id\s+com\.local\.openai\.photoshop\.generator/g) || []).length;
  const ok = Boolean(lastInit && lastInit.version === expectedVersion);
  const staleInMemoryVersion = lastInit && lastInit.version !== expectedVersion ? lastInit.version : null;
  const diagnosis = ok
    ? `Photoshop runtime initialized current plugin ${expectedVersion}.`
    : `Disk/cache can be current while Photoshop is still running stale in-memory plugin ${staleInMemoryVersion || "unknown"}; expected init ${expectedVersion} has ${expectedInitSeen ? "" : "not "}appeared in the latest UXP log tail.`;
  return {
    found: true,
    ok,
    file: latest.file,
    mtime: latest.mtime,
    lastInit,
    initVersionsSeenInTail,
    expectedInitSeen,
    staleInMemoryVersion,
    staleModalIds: modalIds,
    scriptPluginIds: scriptIds,
    removeAttempts,
    needsRestart: !ok && (Boolean(lastInit) || modalIds.length > 0 || removeAttempts > 0),
    diagnosis,
    nextAction: ok ? null : restartNextAction,
  };
}

function auditSmokeCoverageSource() {
  const smoke = readText(path.join(root, "scripts/smoke-plugin.js"));
  const app = readText(path.join(root, "src/app.js"));
  const psSmoke = readText(path.join(root, "scripts/run-photoshop-smoke.js"));
  const modePresent = (mode) => {
    const token = `"${mode}"`;
    return app.includes(token) && smoke.includes(token) && psSmoke.includes(token);
  };
  return {
    localMatrix: smoke.includes("PLUGIN_SMOKE_MATRIX"),
    photoshopMatrix: psSmoke.includes("PHOTOSHOP_SMOKE_MATRIX"),
    runtimeCoverageLog: app.includes("offline diagnostics coverage:"),
    modes: Object.fromEntries(expectedModes.map((mode) => [mode, modePresent(mode)])),
    invariants: Object.fromEntries(expectedInvariants.map((name) => [name, app.includes(`${name}=`) && smoke.includes(name) && psSmoke.includes(name)])),
  };
}

function main() {
  const expectedVersion = readSourceVersion();
  const photoshopProcess = readPhotoshopProcessState();
  const pluginDirs = auditPluginDirs(expectedVersion);
  const staleDirs = pluginDirs.filter((entry) => !entry.ok);
  const pluginInfo = readPhotoshopPluginInfo();
  const devtoolsWorkspace = readDevtoolsWorkspaceState(expectedVersion);
  const runtime = auditPhotoshopRuntime(expectedVersion);
  const coverage = auditSmokeCoverageSource();
  const cacheOk = pluginInfo.found && pluginInfo.versionString === expectedVersion;
  const coverageOk = coverage.localMatrix &&
    coverage.photoshopMatrix &&
    coverage.runtimeCoverageLog &&
    Object.values(coverage.modes).every(Boolean) &&
    Object.values(coverage.invariants).every(Boolean);
  const diskOk = staleDirs.length === 0 && cacheOk;
  const overall = diskOk && coverageOk && runtime.ok ? "complete" : (diskOk && coverageOk && runtime.needsRestart ? "needs_photoshop_restart" : "incomplete");
  const panelVersionState = runtime.ok
    ? "current"
    : (diskOk && runtime.staleInMemoryVersion ? "stale-in-memory" : (runtime.found ? "unverified" : "unknown"));

  const report = {
    pluginId,
    expectedVersion,
    overall,
    panelVersionState,
    versionEvidence: {
      sourceVersion: expectedVersion,
      photoshopInfoVersion: pluginInfo.versionString || null,
      runtimeLastInitVersion: runtime.lastInit?.version || null,
      expectedInitSeen: Boolean(runtime.expectedInitSeen),
    },
    diagnosis: runtime.diagnosis || "",
    nextAction: runtime.ok ? null : (runtime.nextAction || "Run: node scripts/audit-plugin-state.js"),
    diskOk,
    coverageOk,
    photoshopRuntimeOk: Boolean(runtime.ok),
    photoshopProcess,
    pluginInfo,
    devtoolsWorkspace,
    pluginDirs,
    staleDirs,
    coverage,
    photoshopRuntime: runtime,
  };

  const workspaceState = devtoolsWorkspace.ok === false ? "fail" : (devtoolsWorkspace.found ? "ok" : "none");
  console.log(`PLUGIN_STATE_AUDIT version=${expectedVersion} overall=${overall} disk=${diskOk ? "ok" : "fail"} coverage=${coverageOk ? "ok" : "fail"} photoshopProcess=${photoshopProcess.running ? "running" : "stopped"} workspace=${workspaceState} panelVersion=${panelVersionState} photoshopRuntime=${runtime.ok ? "ok" : "needs-restart"} runtimeLastInit=${runtime.lastInit?.version || "none"} expectedInitSeen=${runtime.expectedInitSeen ? "true" : "false"} strictRuntime=${strictRuntime ? "true" : "false"}`);
  console.log(JSON.stringify(report, null, 2));
  if (!diskOk || !coverageOk || (strictRuntime && !runtime.ok)) process.exitCode = 1;
}

main();
