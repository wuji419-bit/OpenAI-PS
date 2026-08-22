#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const pluginId = "com.local.openai.photoshop.generator";
const pkgVersion = "6.20.0";

const payloadRoots = [
  "manifest.json",
  "index.html",
  "CHANGELOG.md",
  "README.md",
  "README_CN.md",
  "LICENSE",
  "assets",
  "src",
  "scripts",
  "comfyui-workflows",
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function walkFiles(relativePath, output = []) {
  const absolutePath = path.join(root, relativePath);
  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absolutePath).sort()) {
      if (entry === ".DS_Store" || entry === "Thumbs.db") continue;
      walkFiles(path.join(relativePath, entry), output);
    }
    return output;
  }
  if (!stat.isFile()) return output;
  output.push(relativePath.split(path.sep).join("/"));
  return output;
}

function collectPayloadFiles() {
  const files = [];
  for (const item of payloadRoots) {
    const absolutePath = path.join(root, item);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Missing installer payload path: ${item}`);
    }
    walkFiles(item, files);
  }
  return [...new Set(files)].sort();
}

function makePayload(manifest, files) {
  return {
    pluginId,
    name: manifest.name || "OpenAI Photoshop Generator",
    version: manifest.version,
    builtAt: new Date().toISOString(),
    manifest,
    files: files.map((file) => ({
      path: file,
      data: fs.readFileSync(path.join(root, file)).toString("base64"),
    })),
  };
}

function writeGeneratedInstaller(buildDir, payload) {
  fs.mkdirSync(buildDir, { recursive: true });
  const runtimeSource = path.join(root, "installer", "windows-installer-runtime.cjs");
  const runtimeTarget = path.join(buildDir, "windows-installer-runtime.cjs");
  fs.copyFileSync(runtimeSource, runtimeTarget);
  fs.writeFileSync(
    path.join(buildDir, "payload.cjs"),
    `module.exports = ${JSON.stringify(payload)};\n`,
    "utf8"
  );
  const entryFile = path.join(buildDir, "windows-installer-entry.cjs");
  fs.writeFileSync(
    entryFile,
    [
      "const payload = require('./payload.cjs');",
      "const installer = require('./windows-installer-runtime.cjs');",
      "installer.run(payload);",
      "",
    ].join("\n"),
    "utf8"
  );
  return entryFile;
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function main() {
  const manifest = readJson(path.join(root, "manifest.json"));
  if (manifest.id !== pluginId) {
    throw new Error(`Unexpected plugin id: ${manifest.id}`);
  }
  const appJs = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
  const appVersion = appJs.match(/const\s+PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1] || "";
  if (appVersion !== manifest.version) {
    throw new Error(`Version mismatch: manifest=${manifest.version}, app=${appVersion}`);
  }

  const files = collectPayloadFiles();
  const payload = makePayload(manifest, files);
  const buildDir = path.join(root, "dist", "windows-installer-build");
  const entryFile = writeGeneratedInstaller(buildDir, payload);
  const exeName = `OpenAI-PS-Installer-${manifest.version}-win-x64.exe`;
  const output = path.join(root, "dist", exeName);

  run("npx", [
    "--yes",
    `@yao-pkg/pkg@${pkgVersion}`,
    entryFile,
    "--targets",
    "node22-win-x64",
    "--output",
    output,
    "--compress",
    "GZip",
    "--public",
  ]);

  const size = fs.statSync(output).size;
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex");
  const shaFile = `${output}.sha256`;
  fs.writeFileSync(shaFile, `${sha256}  ${exeName}\n`, "utf8");
  console.log(`WINDOWS_INSTALLER_OK ${output} bytes=${size} files=${files.length} version=${manifest.version}`);
  console.log(`WINDOWS_INSTALLER_SHA256 ${sha256} ${shaFile}`);
}

main();
