#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const pluginId = "com.local.openai.photoshop.generator";
const files = [
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readPluginAppVersion(dir) {
  const appJs = readText(path.join(dir, "src/app.js"));
  return appJs.match(/const\s+PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1] || "";
}

function verifyTargetVersion(targetDir, expectedVersion) {
  const manifest = readJson(path.join(targetDir, "manifest.json"));
  const appVersion = readPluginAppVersion(targetDir);
  const html = readText(path.join(targetDir, "index.html"));
  const missing = [];
  if (manifest.version !== expectedVersion) missing.push(`manifest=${manifest.version || "missing"}`);
  if (appVersion !== expectedVersion) missing.push(`app=${appVersion || "missing"}`);
  if (!html.includes(`app.js?v=${expectedVersion}`)) missing.push("app cache-buster");
  if (!html.includes(`styles.css?v=${expectedVersion}`)) missing.push("style cache-buster");
  if (!html.includes(`v${expectedVersion}`)) missing.push("visible label");
  if (missing.length) {
    throw new Error(`Version verification failed for ${targetDir}: ${missing.join(", ")}`);
  }
}

function verifyManagedFilesMatchSource(targetDir) {
  const mismatched = [];
  for (const file of files) {
    const source = path.join(root, file);
    const target = path.join(targetDir, file);
    if (!fs.existsSync(target)) {
      mismatched.push(`${file}: missing`);
      continue;
    }
    if (hashFile(source) !== hashFile(target)) {
      mismatched.push(`${file}: hash mismatch`);
    }
  }
  if (mismatched.length) {
    throw new Error(`Managed file verification failed for ${targetDir}: ${mismatched.join(", ")}`);
  }
}

function isPluginDir(dir) {
  try {
    return readJson(path.join(dir, "manifest.json")).id === pluginId;
  } catch (error) {
    return false;
  }
}

function getWorkspaceDirs() {
  const workspaceFile = path.join(os.homedir(), "Library/Application Support/Adobe/Adobe UXP Developer Tool/plugins_workspace.json");
  if (!fs.existsSync(workspaceFile)) return [];
  try {
    const workspace = readJson(workspaceFile);
    return (workspace.plugins || [])
      .map((plugin) => plugin?.manifestPath)
      .filter(Boolean)
      .map((manifestPath) => path.dirname(manifestPath))
      .filter(isPluginDir);
  } catch (error) {
    console.warn(`WARN could not inspect UXP Developer Tool workspace: ${error.message || error}`);
    return [];
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

function getTempDevelopmentDirs() {
  const dirs = [];
  walkDirs("/private/tmp", 5, (dir) => {
    if (!/openai|OpenAI|photoshop-generator/i.test(dir)) return;
    if (isPluginDir(dir)) dirs.push(dir);
  });
  return dirs;
}

function collectTargets() {
  return [...new Set([
    "/private/tmp/openai-photoshop-generator-dev",
    path.join(os.homedir(), "source/OpenAI-PS"),
    path.join(os.homedir(), "Library/Application Support/Adobe/UXP/Plugins/External/com.local.openai.photoshop.generator"),
    path.join(os.homedir(), "Library/Application Support/Adobe/UXP/PluginsStorage/PHSP/27/External/com.local.openai.photoshop.generator"),
    path.join(os.homedir(), "Library/Application Support/Adobe/UXP/PluginsStorage/PHSP/27/Developer/com.local.openai.photoshop.generator"),
    ...getAdobeUxpPluginDirs(),
    ...getWorkspaceDirs(),
    ...getTempDevelopmentDirs(),
  ].map((dir) => path.resolve(dir)))]
    .filter((dir) => dir !== root)
    .filter(isPluginDir);
}

function collectLocalPluginDirsForAudit(targets) {
  return [...new Set([
    root,
    ...targets,
    ...getAdobeUxpPluginDirs(),
    ...getWorkspaceDirs(),
    ...getTempDevelopmentDirs(),
  ].map((dir) => path.resolve(dir)))]
    .filter(isPluginDir);
}

function verifyNoStaleLocalPluginDirs(expectedVersion, targets) {
  const dirs = collectLocalPluginDirsForAudit(targets);
  const stale = [];
  for (const dir of dirs) {
    try {
      verifyTargetVersion(dir, expectedVersion);
    } catch (error) {
      stale.push(error.message || String(error));
    }
  }
  if (stale.length) {
    throw new Error(`Stale local plugin copies remain:\n${stale.join("\n")}`);
  }
  console.log(`VERSION_AUDIT_OK ${dirs.length}`);
}

function syncFile(targetDir, file) {
  const source = path.join(root, file);
  const target = path.join(targetDir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function updatePhotoshopPluginInfoCache(manifest) {
  const infoFile = path.join(os.homedir(), "Library/Application Support/Adobe/UXP/PluginsInfo/v1/PS.json");
  let info = { plugins: [] };
  if (fs.existsSync(infoFile)) {
    try {
      info = readJson(infoFile);
    } catch (error) {
      console.warn(`WARN could not inspect Photoshop plugin info cache: ${error.message || error}`);
      return;
    }
  }

  if (!Array.isArray(info.plugins)) info.plugins = [];
  let entry = info.plugins.find((plugin) => plugin?.pluginId === pluginId);
  if (!entry) {
    entry = {
      hostMinVersion: manifest.host?.minVersion || "24.0.0",
      name: manifest.name || "OpenAI Photoshop Generator",
      path: "$localPlugins/External/com.local.openai.photoshop.generator",
      pluginId,
      status: "enabled",
      type: "uxp",
    };
    info.plugins.push(entry);
  }

  entry.name = manifest.name || entry.name;
  entry.versionString = manifest.version;
  entry.status = entry.status || "enabled";
  entry.type = entry.type || "uxp";
  entry.path = entry.path || "$localPlugins/External/com.local.openai.photoshop.generator";
  fs.mkdirSync(path.dirname(infoFile), { recursive: true });
  fs.writeFileSync(infoFile, JSON.stringify(info), "utf8");
  console.log(`UPDATED ${infoFile} version=${manifest.version}`);
}

function main() {
  const manifest = readJson(path.join(root, "manifest.json"));
  if (manifest.id !== pluginId) {
    throw new Error(`Unexpected plugin id in source manifest: ${manifest.id}`);
  }
  const expectedVersion = manifest.version;

  const targets = collectTargets();
  for (const target of targets) {
    for (const file of files) {
      syncFile(target, file);
    }
    verifyTargetVersion(target, expectedVersion);
    verifyManagedFilesMatchSource(target);
    console.log(`SYNCED ${target} version=${expectedVersion}`);
  }
  updatePhotoshopPluginInfoCache(manifest);
  verifyNoStaleLocalPluginDirs(expectedVersion, targets);
  console.log(`SYNC_RUNTIME_COPIES_OK ${targets.length}`);
}

main();
