const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const childProcess = require("child_process");

const pluginId = "com.local.openai.photoshop.generator";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    uninstall: false,
    quiet: false,
    target: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") args.dryRun = true;
    else if (value === "--uninstall") args.uninstall = true;
    else if (value === "--quiet" || value === "/quiet") args.quiet = true;
    else if (value === "--target") {
      index += 1;
      args.target = argv[index] || "";
    } else if (value === "--help" || value === "/?") {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log([
    "OpenAI Photoshop Generator Windows Installer",
    "",
    "Usage:",
    "  OpenAI-PS-Installer.exe",
    "  OpenAI-PS-Installer.exe --dry-run",
    "  OpenAI-PS-Installer.exe --uninstall",
    "  OpenAI-PS-Installer.exe --target C:\\\\path\\\\to\\\\plugin",
    "",
    "Options:",
    "  --dry-run    Show planned actions without writing files.",
    "  --uninstall  Remove the plugin entry and installed files.",
    "  --quiet      Do not wait for Enter before exit.",
  ].join("\n"));
}

function getAppData() {
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error("APPDATA is not set. This installer must run on Windows under a normal user account.");
  }
  return appData;
}

function getInstallPaths(args) {
  const appData = getAppData();
  const externalDir = args.target
    ? path.resolve(args.target)
    : path.join(appData, "Adobe", "UXP", "Plugins", "External", pluginId);
  const pluginInfoFile = path.join(appData, "Adobe", "UXP", "PluginsInfo", "v1", "PS.json");
  return { appData, externalDir, pluginInfoFile };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonIfExists(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value), "utf8");
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function backupExistingInstall(dir, version, dryRun) {
  if (!fs.existsSync(dir)) return "";
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const backupDir = `${dir}.backup-${version}-${stamp}`;
  if (dryRun) return backupDir;
  removeDir(backupDir);
  fs.renameSync(dir, backupDir);
  return backupDir;
}

function installPayload(payload, paths, args) {
  const backupDir = backupExistingInstall(paths.externalDir, payload.version, args.dryRun);
  if (backupDir) {
    console.log(`Backed up existing plugin to: ${backupDir}`);
  }
  if (!args.dryRun) {
    removeDir(paths.externalDir);
    ensureDir(paths.externalDir);
  }

  for (const file of payload.files) {
    const target = path.join(paths.externalDir, file.path);
    if (!args.dryRun) {
      ensureDir(path.dirname(target));
      fs.writeFileSync(target, Buffer.from(file.data, "base64"));
    }
  }

  updatePhotoshopPluginInfoCache(payload, paths.pluginInfoFile, args.dryRun);
}

function updatePhotoshopPluginInfoCache(payload, infoFile, dryRun) {
  const manifest = payload.manifest || {};
  const info = readJsonIfExists(infoFile, { plugins: [] });
  if (!Array.isArray(info.plugins)) info.plugins = [];

  let entry = info.plugins.find((plugin) => plugin && plugin.pluginId === pluginId);
  if (!entry) {
    entry = {
      hostMinVersion: manifest.host && manifest.host.minVersion ? manifest.host.minVersion : "24.0.0",
      name: manifest.name || "OpenAI Photoshop Generator",
      path: `$localPlugins/External/${pluginId}`,
      pluginId,
      status: "enabled",
      type: "uxp",
    };
    info.plugins.push(entry);
  }

  entry.hostMinVersion = entry.hostMinVersion || (manifest.host && manifest.host.minVersion) || "24.0.0";
  entry.name = manifest.name || entry.name || "OpenAI Photoshop Generator";
  entry.path = `$localPlugins/External/${pluginId}`;
  entry.pluginId = pluginId;
  entry.status = "enabled";
  entry.type = "uxp";
  entry.versionString = payload.version;

  if (!dryRun) writeJson(infoFile, info);
  console.log(`Updated Photoshop plugin cache: ${infoFile}`);
}

function uninstall(paths, dryRun) {
  if (!dryRun) removeDir(paths.externalDir);
  console.log(`Removed plugin files: ${paths.externalDir}`);

  const info = readJsonIfExists(paths.pluginInfoFile, null);
  if (!info || !Array.isArray(info.plugins)) return;
  const before = info.plugins.length;
  info.plugins = info.plugins.filter((plugin) => !plugin || plugin.pluginId !== pluginId);
  if (!dryRun && info.plugins.length !== before) writeJson(paths.pluginInfoFile, info);
  console.log(`Removed Photoshop plugin cache entry: ${paths.pluginInfoFile}`);
}

function detectPhotoshopRunning() {
  if (process.platform !== "win32") return false;
  try {
    const output = childProcess.execFileSync("tasklist.exe", ["/FI", "IMAGENAME eq Photoshop.exe"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return /Photoshop\.exe/i.test(output);
  } catch (error) {
    return false;
  }
}

function waitForEnterIfNeeded(args, exitCode) {
  if (args.quiet || !process.stdin.isTTY) {
    process.exitCode = exitCode;
    return Promise.resolve();
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("\nPress Enter to exit...", () => {
      rl.close();
      process.exitCode = exitCode;
      resolve();
    });
  });
}

async function run(payload) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    await waitForEnterIfNeeded(args, 0);
    return;
  }

  let exitCode = 0;
  try {
    if (process.platform !== "win32") {
      throw new Error("This generated installer is intended for Windows. Build the .exe and run it on your friend's Windows machine.");
    }
    if (!payload || payload.pluginId !== pluginId || !Array.isArray(payload.files)) {
      throw new Error("Installer payload is missing or invalid.");
    }

    const paths = getInstallPaths(args);
    console.log(`OpenAI Photoshop Generator Installer v${payload.version}`);
    console.log(`Install path: ${paths.externalDir}`);
    if (args.dryRun) console.log("Dry run: no files will be changed.");
    if (detectPhotoshopRunning()) {
      console.log("Photoshop appears to be running. Installation can continue, but restart Photoshop after this finishes.");
    }

    if (args.uninstall) {
      uninstall(paths, args.dryRun);
      console.log("Uninstall complete.");
    } else {
      installPayload(payload, paths, args);
      console.log(`Installed ${payload.files.length} files.`);
      console.log("Done. Restart Photoshop, then open Plugins > OpenAI Photoshop Generator > OpenAI 图片.");
    }
  } catch (error) {
    exitCode = 1;
    console.error(`ERROR: ${error.message || error}`);
  }
  await waitForEnterIfNeeded(args, exitCode);
}

module.exports = { run };
