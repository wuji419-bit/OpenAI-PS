#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = `${__dirname}/..`;
const html = fs.readFileSync(`${root}/index.html`, "utf8");
const appJs = fs.readFileSync(`${root}/src/app.js`, "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function checkManifest() {
  const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, "utf8"));
  const appVersion = appJs.match(/const\s+PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1];
  assert(manifest.id === "com.local.openai.photoshop.generator", "Unexpected plugin id");
  assert(appVersion, "Missing PLUGIN_VERSION in app.js");
  assert(manifest.version === appVersion, "Manifest version must match PLUGIN_VERSION");
  assert(html.includes(`app.js?v=${appVersion}`), "app.js cache-buster must match PLUGIN_VERSION");
  assert(html.includes(`styles.css?v=${appVersion}`), "styles.css cache-buster must match PLUGIN_VERSION");
  assert(html.includes(`v${appVersion}`), "Visible version labels must match PLUGIN_VERSION");
  assert(appJs.includes("syncVersionLabels();"), "Startup must refresh visible version labels");
  assert(manifest.main === "index.html", "Unexpected manifest entrypoint");
  assert(manifest.entrypoints?.[0]?.id === "openaiPanel", "Missing openaiPanel entrypoint");
  assert(manifest.entrypoints?.[0]?.icons?.[0]?.path === "assets/panel.png", "Panel icon path must be scale-base path");
  assert(manifest.entrypoints?.some((entry) => entry.id === "openaiOpenPanel" && entry.type === "command"), "Missing open panel command");
  assert(manifest.entrypoints?.some((entry) => entry.id === "openaiRunSmoke" && entry.type === "command"), "Missing six-mode smoke command");
  assert(manifest.entrypoints?.some((entry) => entry.id === "openaiRunSplitSmoke" && entry.type === "command"), "Missing split smoke command");
  assert(manifest.entrypoints?.some((entry) => entry.id === "openaiRunMouthInpaintSmoke" && entry.type === "command"), "Missing mouth inpaint smoke command");
  assert(manifest.entrypoints?.some((entry) => entry.id === "openaiImportApiKeyFromClipboard" && entry.type === "command"), "Missing clipboard API key import command");
  assert(manifest.requiredPermissions?.ipc?.enablePluginCommunication === true, "Panel command needs ipc plugin communication permission");
  assert(manifest.icons?.[0]?.path === "assets/plugin.png", "Plugin icon path must be scale-base path");
  for (const file of ["panel@1x.png", "panel@2x.png", "plugin@1x.png", "plugin@2x.png"]) {
    assert(fs.existsSync(`${root}/assets/${file}`), `Missing icon asset: ${file}`);
  }
}

function checkRuntimeCopiesSynced() {
  const rootDir = path.resolve(root);
  const appVersion = appJs.match(/const\s+PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1];
  const copyDirs = new Set([
    rootDir,
    "/private/tmp/openai-photoshop-generator-dev",
    path.join(os.homedir(), "source/OpenAI-PS"),
    path.join(os.homedir(), "Library/Application Support/Adobe/UXP/Plugins/External/com.local.openai.photoshop.generator"),
    path.join(os.homedir(), "Library/Application Support/Adobe/UXP/PluginsStorage/PHSP/27/External/com.local.openai.photoshop.generator"),
    path.join(os.homedir(), "Library/Application Support/Adobe/UXP/PluginsStorage/PHSP/27/Developer/com.local.openai.photoshop.generator"),
  ]);

  for (const adobeDir of getAdobeUxpPluginDirs()) {
    copyDirs.add(adobeDir);
  }
  for (const workspaceDir of getDevtoolsWorkspacePluginDirs()) {
    copyDirs.add(workspaceDir);
  }
  for (const tempDir of getTempDevelopmentPluginDirs()) {
    copyDirs.add(tempDir);
  }

  for (const copyDir of copyDirs) {
    if (!isPluginDir(copyDir) || path.resolve(copyDir) === rootDir) continue;
    for (const file of ["manifest.json", "index.html", "CHANGELOG.md", "README_CN.md", "src/app.js", "src/styles.css", "scripts/smoke-plugin.js", "scripts/audit-plugin-state.js", "scripts/reload-photoshop-plugin.js", "scripts/restart-photoshop-and-smoke.js", "scripts/run-photoshop-smoke.js", "scripts/sync-runtime-copies.js"]) {
      const sourceText = fs.readFileSync(path.join(rootDir, file), "utf8");
      const copyPath = path.join(copyDir, file);
      assert(fs.existsSync(copyPath), `Missing runtime copy file: ${copyPath}`);
      assert(fs.readFileSync(copyPath, "utf8") === sourceText, `Runtime copy is out of sync: ${copyPath}`);
    }
  }

  const photoshopInfoFile = path.join(os.homedir(), "Library/Application Support/Adobe/UXP/PluginsInfo/v1/PS.json");
  if (fs.existsSync(photoshopInfoFile)) {
    const info = JSON.parse(fs.readFileSync(photoshopInfoFile, "utf8"));
    const entry = (info.plugins || []).find((plugin) => plugin?.pluginId === "com.local.openai.photoshop.generator");
    assert(entry?.versionString === appVersion, `Photoshop plugin info cache is stale: ${photoshopInfoFile}`);
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

function getDevtoolsWorkspacePluginDirs() {
  const workspaceFile = path.join(os.homedir(), "Library/Application Support/Adobe/Adobe UXP Developer Tool/plugins_workspace.json");
  if (!fs.existsSync(workspaceFile)) return [];
  try {
    const workspace = JSON.parse(fs.readFileSync(workspaceFile, "utf8"));
    return (workspace.plugins || [])
      .filter((plugin) => plugin?.hostParam === "PS")
      .map((plugin) => plugin?.manifestPath)
      .filter(Boolean)
      .map((manifestPath) => path.dirname(manifestPath))
      .filter(isPluginDir);
  } catch (error) {
    console.warn("Could not inspect UXP Developer Tool workspace", error);
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

function getTempDevelopmentPluginDirs() {
  const dirs = [];
  walkDirs("/private/tmp", 5, (dir) => {
    if (!/openai|OpenAI|photoshop-generator/i.test(dir)) return;
    if (isPluginDir(dir)) dirs.push(dir);
  });
  return dirs;
}

function isPluginDir(dir) {
  try {
    const manifestPath = path.join(dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) return false;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return manifest.id === "com.local.openai.photoshop.generator";
  } catch (error) {
    return false;
  }
}

function checkUiBindings() {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const refs = [...appJs.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
  const missing = [...new Set(refs.filter((id) => !ids.includes(id)))];
  assert(!missing.length, `Missing HTML elements referenced by app.js: ${missing.join(", ")}`);
}

function checkSmokeCommandCompatibility() {
  assert(!appJs.includes("openaiRunOfflineDiagnostics:"), "Do not register new diagnostics command; cached Photoshop manifests reject it");
  assert(
    /openaiRunSmoke:\s*{[\s\S]*?runOfflineSixModeDiagnostics\(\)/.test(appJs),
    "Existing smoke command should invoke offline diagnostics for cached-manifest compatibility"
  );
}

function checkRuntimeReloadScript() {
  const syncScript = fs.readFileSync(`${root}/scripts/sync-runtime-copies.js`, "utf8");
  assert(syncScript.includes("verifyTargetVersion"), "Runtime sync script must verify copied manifest/app/html versions");
  assert(syncScript.includes("verifyManagedFilesMatchSource"), "Runtime sync script must verify managed support scripts by content hash");
  assert(syncScript.includes("getAdobeUxpPluginDirs"), "Runtime sync script must scan Adobe UXP for hidden same-id plugin copies");
  assert(syncScript.includes("VERSION_AUDIT_OK"), "Runtime sync script must report a local version audit");
  assert(syncScript.includes("version=${expectedVersion}"), "Runtime sync script should print the synced version for each target");
  const reloadScript = fs.readFileSync(`${root}/scripts/reload-photoshop-plugin.js`, "utf8");
  const auditScript = fs.readFileSync(`${root}/scripts/audit-plugin-state.js`, "utf8");
  const restartScript = fs.readFileSync(`${root}/scripts/restart-photoshop-and-smoke.js`, "utf8");
  assert(auditScript.includes("PLUGIN_STATE_AUDIT"), "State audit script must report a clear audit marker");
  assert(auditScript.includes("needs_photoshop_restart"), "State audit should distinguish synced disk files from a stale Photoshop UXP process");
  assert(auditScript.includes("--strict-runtime"), "State audit must support a strict runtime validation mode");
  assert(auditScript.includes("managedFilesOk"), "State audit should report managed support-script hash parity for every plugin copy");
  assert(auditScript.includes("mismatchedManagedFiles"), "State audit should list any synced support files whose content drifts");
  assert(auditScript.includes("photoshopProcess"), "State audit should report whether the Photoshop process is still running");
  assert(auditScript.includes("devtoolsWorkspace"), "State audit should report the UXP Developer Tool workspace plugin path");
  assert(auditScript.includes("workspace="), "State audit marker should summarize whether the UXP workspace points at a synced plugin copy");
  assert(auditScript.includes("initVersionsSeenInTail"), "State audit should list OpenAI plugin init versions seen in the latest Photoshop UXP log tail");
  assert(auditScript.includes("expectedInitSeen"), "State audit should explicitly report whether Photoshop has initialized the expected plugin version");
  assert(auditScript.includes("staleInMemoryVersion"), "State audit should expose the stale in-memory version when disk/cache are newer");
  assert(auditScript.includes("panelVersionState"), "State audit should expose whether the visible panel is current or stale in memory");
  assert(auditScript.includes("versionEvidence"), "State audit should summarize source/cache/runtime version evidence");
  assert(auditScript.includes("panelVersion="), "State audit marker should include a one-word panel version state");
  assert(auditScript.includes("nextAction"), "State audit should include the concrete restart/smoke command needed to clear a stale Photoshop runtime");
  assert(auditScript.includes("offline diagnostics coverage:"), "State audit should verify runtime smoke coverage hooks");
  assert(restartScript.includes("PHOTOSHOP_RESTART_DRY_RUN"), "Restart helper must default to a dry-run marker");
  assert(restartScript.includes("--confirm-saved"), "Restart helper must require explicit saved-file confirmation");
  assert(restartScript.includes('"--strict-runtime"'), "Restart helper must finish with strict runtime state audit");
  assert(restartScript.includes("PHOTOSHOP_RESTART_FAILED"), "Restart helper must print a clear failure marker");
  assert(restartScript.includes("PHOTOSHOP_RESTART_NEXT_ACTION"), "Restart helper failures should include next-action guidance");
  assert(restartScript.includes("UXP Developer Service is not reachable"), "Restart helper should point ECONNREFUSED reload failures at UXP Developer Tool");
  assert(restartScript.includes("PHOTOSHOP_RESTART_AND_SMOKE_OK"), "Restart helper must report a clear final success marker");
  assert(reloadScript.includes("GET /socket/cli HTTP/1.1"), "Reload script must use the UXP Developer Service cli websocket");
  assert(reloadScript.includes('action: "load"'), "Reload script must force Photoshop to load the synced plugin folder");
  assert(reloadScript.includes("[OpenAI Photoshop Generator] init ${version}"), "Reload script must wait for the expected plugin init version");
  assert(reloadScript.includes("getDiskVersionHint"), "Reload failures must report the disk plugin version");
  assert(reloadScript.includes("getPhotoshopPluginInfoHint"), "Reload failures must report the Photoshop plugin info cache version");
  assert(reloadScript.includes("getRecentPhotoshopUxpLogHint"), "Reload failures must report stale Photoshop UXP session hints");
  assert(reloadScript.includes("UXP Developer Service is not reachable"), "Reload failures should explain ECONNREFUSED from the UXP Developer Tool service");
  assert(reloadScript.includes("last OpenAI plugin init in latest log"), "Reload failures must report the last loaded plugin version from Photoshop logs");
  assert(reloadScript.includes("older in-memory plugin"), "Reload failures must distinguish stale in-memory panels from synced disk files");
  assert(reloadScript.includes("temporary ScriptPlugin modal command(s)"), "Reload failures should report stale ScriptPlugin ids");
  assert(reloadScript.includes("remove attempt(s) but no init"), "Reload failures should report missing expected init after remove attempts");
  const photoshopSmokeScript = fs.readFileSync(`${root}/scripts/run-photoshop-smoke.js`, "utf8");
  assert(!photoshopSmokeScript.includes('action: "runScript"'), "Photoshop smoke script must not use a transient ScriptPlugin; it can leave Photoshop in a modal command");
  assert(!photoshopSmokeScript.includes("writeShowPanelScript"), "Photoshop smoke script should not create a modal show-panel ScriptPlugin");
  assert(photoshopSmokeScript.includes('action: "debug"'), "Photoshop smoke script must attach to the UXP panel debug websocket");
  assert(photoshopSmokeScript.includes("runOfflineSixModeDiagnostics"), "Photoshop smoke script must run the real panel diagnostics function");
  assert(photoshopSmokeScript.includes("clearTimeout(callbacks.timer)"), "Photoshop smoke script must clear successful websocket request timers");
  assert(photoshopSmokeScript.includes("getDiskVersionHint"), "Photoshop smoke failures must report the disk plugin version");
  assert(photoshopSmokeScript.includes("getPhotoshopPluginInfoHint"), "Photoshop smoke failures must report the Photoshop plugin info cache version");
  assert(photoshopSmokeScript.includes("last OpenAI plugin init in latest log"), "Photoshop smoke failures must report the last loaded plugin version from Photoshop logs");
  assert(photoshopSmokeScript.includes("older in-memory plugin"), "Photoshop smoke failures must distinguish stale in-memory panels from synced disk files");
  assert(photoshopSmokeScript.includes("temporary ScriptPlugin modal command(s)"), "Photoshop smoke failures should report stale ScriptPlugin ids");
  assert(photoshopSmokeScript.includes("PHOTOSHOP_SMOKE_MATRIX"), "Photoshop smoke script should print a runtime coverage matrix");
  assert(photoshopSmokeScript.includes("runtimePluginVersion="), "Photoshop smoke matrix should include the evaluated runtime PLUGIN_VERSION");
  assert(photoshopSmokeScript.includes("panelVersion="), "Photoshop smoke matrix should include the visible panel version label");
  assert(photoshopSmokeScript.includes("directSelectionPatch=ok"), "Photoshop smoke matrix should verify direct selection repaint placement");
  assert(photoshopSmokeScript.includes("directSelectionBounds=ok"), "Photoshop smoke matrix should verify direct selection repaint real layer bounds");
  assert(photoshopSmokeScript.includes("outpaintCanvasExpand=ok"), "Photoshop smoke matrix should verify outpaint canvas expansion");
  assert(photoshopSmokeScript.includes("PHOTOSHOP_SMOKE_OK"), "Photoshop smoke script must report a clear pass marker");
  assert(appJs.includes("offline diagnostics coverage:"), "Runtime offline diagnostics should log a six-mode coverage matrix");
  assert(appJs.includes("directSelectionPatch="), "Runtime offline diagnostics should log direct selection repaint placement coverage");
  assert(appJs.includes("directSelectionBounds="), "Runtime offline diagnostics should log direct selection repaint real layer bounds");
  assert(appJs.includes("outpaintCanvasExpand="), "Runtime offline diagnostics should log outpaint canvas expansion coverage");
  assert(appJs.includes("cutoutOriginalSize="), "Runtime offline diagnostics should log cutout original-size preservation coverage");
  assert(appJs.includes("splitFullCanvas="), "Runtime offline diagnostics should log semantic split full-canvas coverage");
  assert(appJs.includes("loadImage(toDataUrl(generatedB64"), "Inpaint composite should load model output with inferred image format");
  assert(!appJs.includes("loadImage(`data:image/png;base64,${stripDataUrl(generatedB64)}`)"), "Inpaint composite must not force model output through PNG data URLs");
  assert(appJs.includes("loadImage(toDataUrl(imageB64, inferImageFormatFromValue(imageB64)"), "Inpaint clip fallback should load model output with inferred image format");
  assert(appJs.includes("image_url: toDataUrl(imageB64, imageFormat)"), "Responses edit input image should use inferred image MIME instead of forcing PNG");
  assert(!appJs.includes("image_url: `data:image/png;base64,${stripDataUrl(imageB64)}`"), "Responses edit input image must not force PNG data URLs");
  assert(appJs.includes("base64ToBlob(imageB64, mimeTypeForFormat(imageFormat))"), "/images/edits upload should use inferred image MIME instead of forcing PNG");
  assert(appJs.includes("base64ToBlob(imageB64, mimeTypeForFormat(inputFormat))"), "Koukoutu upload should use inferred image MIME instead of forcing PNG");
  assert(appJs.includes("base64ToBlob(b64, mimeTypeForFormat(imageFormat))"), "ComfyUI upload should use inferred image MIME instead of forcing PNG");
  assert(appJs.includes("withImageFileExtension(fileName, imageFormat)"), "ComfyUI upload filename should match inferred image format");
}

function checkPhotoshopMoveUnavailableGuard() {
  assert(!/_obj:\s*["']move["']/.test(appJs), "Do not call Photoshop move command; it can be unavailable in modal placement");
  assert(appJs.includes("selectFrontLayerForPlacementInModal"), "Inpaint placement should select the front layer before placeEvent");
}

function checkSelectionRepaintCopy() {
  assert(appJs.includes("按普通上传图片编辑；不发送 API Mask"), "Inpaint mode copy must describe the current no-mask uploaded-screenshot workflow");
  assert(html.includes("选区重绘会按白底截图普通上传，不发送 API Mask"), "Selection context copy must not describe inpaint as API mask upload");
  assert(!appJs.includes("基于当前 Photoshop 选区生成像素蒙版"), "Inpaint mode copy must not use the old pixel-mask wording");
  assert(!appJs.includes("使用你画的完整选区作为重绘 Mask"), "Inpaint status must not call screenshot repaint a mask");
  assert(!appJs.includes("选区保护图层"), "Inpaint status text must not use ambiguous legacy selection-protection wording");
  assert(!appJs.includes("正在把重绘结果按 Photoshop 选区保护图层放回"), "Current screenshot repaint placement status must not imply legacy post-import mask placement");
  assert(appJs.includes("正在把截图重绘结果按原选区位置放回"), "Current screenshot repaint placement status should describe direct placement at the original selection");
  assert(appJs.includes("const uploadStatus = maskB64"), "Responses edit status must branch between mask and no-mask uploads");
  assert(appJs.includes("setStatus(uploadStatus)"), "Responses edit status should use the branched upload status text");
  assert(appJs.includes("正在用 Responses 图像工具按普通上传截图编辑"), "Screenshot repaint status should describe ordinary uploaded-screenshot editing");
  assert(appJs.includes("无 API Mask"), "No-mask edit status should say that no API mask is sent");
  assert(appJs.includes("openai-last-responses-edit-request.json"), "Responses edit should save a sanitized request debug record for route verification");
  assert(appJs.includes("openai-last-images-edit-request.json"), "/images/edits compatibility route should save a sanitized request debug record for route verification");
  assert(appJs.includes("openai-last-inpaint-input.json"), "Screenshot repaint should save sanitized input metadata proving no-mask normal-image upload");
  assert(appJs.includes("sanitizeDebugEndpointUrl"), "Debug request records should sanitize endpoint URLs before writing them to disk");
  assert(appJs.includes("选区截图重绘请求意外包含 API Mask"), "Screenshot repaint should stop if a future regression tries to attach an API mask");
  assert(appJs.includes("getImageEditInputFidelity(settings.model, true)"), "Image edit requests should enable high input fidelity for GPT Image reference preservation");
  assert(!appJs.includes("重绘还需要服务支持 /images/edits"), "Connection status must not say selection repaint depends on /images/edits");
  assert(appJs.includes("选区重绘需要 /responses 图像工具"), "Connection status should name the Responses image tool for selection repaint");
}

function makeElement(id = "") {
  return {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    checked: true,
    hidden: false,
    className: "",
    dataset: {},
    style: {},
    children: [],
    type: "password",
    title: "",
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
    addEventListener() {},
    setAttribute() {},
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    contains() { return false; },
    closest() { return null; },
    remove() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function createContext() {
  const elements = new Map();
  for (const id of [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])) {
    elements.set(id, makeElement(id));
  }

  const makeFile = (name) => ({
    name,
    data: new ArrayBuffer(0),
    async write(value) {
      if (value instanceof ArrayBuffer) {
        this.data = value.slice(0);
        return;
      }
      if (ArrayBuffer.isView(value)) {
        this.data = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        return;
      }
      this.data = Buffer.from(String(value || "")).buffer;
    },
    async read() {
      return this.data;
    },
  });
  const makeFolder = () => {
    const entries = new Map();
    return {
      async createFile(name) {
        const file = makeFile(name);
        entries.set(name, file);
        return file;
      },
      async getEntry(name) {
        if (!entries.has(name)) throw new Error(`Missing mock entry: ${name}`);
        return entries.get(name);
      },
      async createFolder(name) {
        const folder = makeFolder();
        entries.set(name, folder);
        return folder;
      },
    };
  };
  const tempFolder = makeFolder();
  const dataFolder = makeFolder();
  const appMock = {
    activeDocument: { width: 100, height: 80 },
    documents: { async add() {} },
    async open(inputFile) {
      return {
        width: 2,
        height: 2,
        saveAs: {
          async png(outputFile) {
            await outputFile.write(await inputFile.read());
          },
        },
        async crop() {},
        async closeWithoutSaving() {},
      };
    },
  };
  const localFileSystem = {
    async getTemporaryFolder() { return tempFolder; },
    async getDataFolder() { return dataFolder; },
    async getPluginFolder() { return dataFolder; },
    async createSessionToken(file) { return `mock-token:${file.name || "file"}`; },
  };

  return {
    console,
    require(name) {
      if (name === "photoshop") {
        return {
          app: appMock,
          action: {},
          core: { executeAsModal: async (fn) => fn() },
          imaging: {},
          constants: { AnchorPosition: { TOPLEFT: "TOPLEFT", BOTTOMRIGHT: "BOTTOMRIGHT" } },
        };
      }
      if (name === "uxp") {
        return {
          entrypoints: { setup() {} },
          pluginManager: { showPanel() {}, getPlugin() { return { showPanel() {} }; } },
          storage: { localFileSystem, formats: { binary: "binary" } },
        };
      }
      return require(name);
    },
    document: {
      addEventListener() {},
      getElementById(id) { return elements.get(id) || null; },
      querySelectorAll() { return []; },
      createElement(tag) {
        const element = makeElement();
        element.tagName = tag.toUpperCase();
        return element;
      },
    },
    window: { setTimeout, clearTimeout, setInterval, clearInterval },
    localStorage: {
      data: new Map(),
      getItem(key) { return this.data.get(key) || null; },
      setItem(key, value) { this.data.set(key, String(value)); },
    },
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    Blob,
    FormData,
    URL,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Error,
    Date,
    Math,
    Number,
    String,
    Boolean,
    JSON,
    RegExp,
    Promise,
    Set,
    Map,
    Object,
    Array,
  };
}

async function runVmSmoke() {
  const context = createContext();
  vm.createContext(context);
  const smokePromise = vm.runInContext(`${appJs}
    (async () => {
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const calls = [];
      action.batchPlay = async (commands) => {
        const command = commands?.[0] || {};
        calls.push(["batchPlay", command._obj, command._target?.[0]?._id || null, command.saving?._value || null]);
        return [{}];
      };
      const b64 = bytesToBase64(encodePngRgba(2, 2, new Uint8Array(16).fill(255)));
      const realSaveHistoryItem = saveHistoryItem;
      const realLoadHistory = loadHistory;
      const realPlaceResultAsLayer = placeResultAsLayer;
      const realCreateInpaintScreenshotInputs = createInpaintScreenshotInputs;
      const realCreateReferenceRegionInputs = createReferenceRegionInputs;
      const realExportDocumentRegionAsBase64 = exportDocumentRegionAsBase64;

      for (const id of [
        "baseUrlInput", "apiKeyInput", "modelInput", "generationPathInput", "editPathInput",
        "sizeInput", "countInput", "formatInput", "qualityInput", "koukoutuApiKeyInput",
        "koukoutuFormatInput", "koukoutuBorderInput", "promptInput", "negativePromptInput",
        "comfyUrlInput"
      ]) {
        $(id).value = "";
      }

      $("baseUrlInput").value = "http://127.0.0.1:49456/v1";
      $("apiKeyInput").value = "sk-test-key-abcdefghijklmnop";
      $("modelInput").value = "gpt-image-2";
      $("generationPathInput").value = "/images/generations";
      $("editPathInput").value = "/images/edits";
      $("sizeInput").value = "auto";
      $("countInput").value = "1";
      $("koukoutuApiKeyInput").value = "kou-test";
      $("koukoutuFormatInput").value = "png";
      $("koukoutuBorderInput").value = "0";

      renderResults = () => {};
      renderHistory = () => {};
      renderOutputView = () => {};
      prepareCroppedPreviews = async () => {};
      saveHistoryItem = async () => {};
      placeResultAsLayer = async (item, rect, name, cropRect, opts = {}) => {
        let placedSize = null;
        try {
          const placedB64 = item?.importB64 || item?.b64;
          placedSize = placedB64 ? await decodePngRgbaBase64(placedB64) : null;
        } catch (error) {
          placedSize = null;
        }
        calls.push([
          "place",
          state.mode,
          name,
          rect && rect.width,
          item.placementMode || null,
          cropRect && cropRect.width,
          Boolean(opts.fitByImageSize),
          Boolean(opts.requireMask),
          Boolean(opts.rasterizeBeforeMask),
          Boolean(opts.selectionChannelName),
          Boolean(opts.useSavedSelectionMask),
          Boolean(item.preclippedImport),
          Boolean(opts.moveToFront),
          Boolean(opts.alignVisibleRect),
          placedSize?.width || null,
          placedSize?.height || null,
          Boolean(item.normalizedPlacementSize),
        ]);
      };
      expandCanvasForOutpaint = async (padding, rect) => calls.push(["expand", padding && padding.left, rect && rect.width]);
      let currentSelection = { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 };
      getSelectionInfo = async () => currentSelection;
      getDocumentSize = () => ({ width: 100, height: 80 });
      exportActiveDocumentAsBase64 = async () => b64;
      createReferenceRegionInputs = async () => ({
        image: b64,
        apiSize: "auto",
        displaySize: "40x30",
        targetRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        placementRect: { left: 0, top: 0, right: 60, bottom: 60, width: 60, height: 60 },
      });
      createInpaintInputs = async () => ({
        image: b64,
        mask: b64,
        apiSize: "auto",
        displaySize: "40x30",
        targetRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        placementRect: { left: 0, top: 0, right: 60, bottom: 60, width: 60, height: 60 },
      });
      createInpaintScreenshotInputs = async () => ({
        image: b64,
        mask: null,
        apiSize: "auto",
        displaySize: "40x30",
        targetRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        placementRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        referenceCrop: { canvasWidth: 512, canvasHeight: 512, left: 236, top: 241, width: 40, height: 30 },
      });
      saveActiveSelectionSnapshot = async () => "mock-selection-channel";
      createRectClippedImportBase64 = async () => b64;
      createMaskClippedImportBase64 = async () => b64;
      createOutpaintInputs = async () => ({
        image: b64,
        mask: b64,
        displaySize: "120x100",
        padding: { left: 10, top: 10, right: 10, bottom: 10 },
        baseSize: { width: 100, height: 80 },
        targetRect: { left: 0, top: 0, right: 120, bottom: 100, width: 120, height: 100 },
        placementRect: { left: 0, top: 0, right: 120, bottom: 100, width: 120, height: 100 },
      });
      createCutoutInputs = async () => ({
        image: createOfflineDiagnosticPngBase64(40, 30, "cutout-input"),
        displaySize: "40x30",
        targetRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        placementRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
      });
      resolveSemanticInpaintSelection = async (settings, prompt, selection) => selection;
      resolveSemanticSplitTargets = async () => [{ label: "角色", target: "角色" }];
      compositeItemsWithOriginalMask = async (items) => items;
      requestGenerations = async () => { calls.push(["generate"]); return [{ b64, format: "png" }]; };
      requestEdits = async (settings, prompt, image, mask, options = {}) => {
        calls.push(["edit", state.mode, Boolean(mask), Boolean(options.screenshotReferenceEdit), prompt]);
        if (state.mode === "outpaint") {
          return [{ b64: createOfflineDiagnosticPngBase64(12, 10, "outpaint-smoke"), format: "png" }];
        }
        if (state.mode === "reference" && !isSelectionValid(currentSelection)) {
          return [{ b64: createOfflineDiagnosticPngBase64(10, 8, "reference-full-smoke"), format: "png" }];
        }
        if (state.mode === "inpaint" && options.screenshotReferenceEdit) {
          return [{ b64: createOfflineDiagnosticPngBase64(40, 30, "inpaint-screenshot-smoke"), format: "png" }];
        }
        return [{ b64, format: "png" }];
      };
      const realRequestKoukoutuCutout = requestKoukoutuCutout;
      requestKoukoutuCutout = async (settings, imageB64) => {
        const inputSize = getPngDimensionsFromBase64(imageB64) || { width: 0, height: 0 };
        const outputB64 = createOfflineDiagnosticPngBase64(inputSize.width || 40, inputSize.height || 30, "cutout-smoke");
        const outputSize = getPngDimensionsFromBase64(outputB64) || { width: 0, height: 0 };
        calls.push(["cutout", inputSize.width, inputSize.height, outputSize.width, outputSize.height]);
        return { b64: outputB64, format: "png" };
      };
      requestSemanticSplitLayers = async (settings, imageB64, docSize) => {
        const width = Math.round(docSize?.width || 100);
        const height = Math.round(docSize?.height || 80);
        calls.push(["split", width, height, width, height]);
        return [{
          b64: createOfflineDiagnosticPngBase64(width, height, "split-smoke"),
          format: "png",
          splitIndex: 1,
          splitLabel: "角色",
          targetRect: { left: 0, top: 0, right: width, bottom: height, width, height },
          placementRect: { left: 0, top: 0, right: width, bottom: height, width, height },
        }];
      };

      const explicit = buildExplicitSemanticSplitTargets("角色");
      assert(explicit.length === 1 && explicit[0].target === "角色", "Single split target should be accepted");
      const explicitList = buildExplicitSemanticSplitTargets("角色，武器，道具");
      assert(explicitList.length === 3 && explicitList[1].target === "武器", "Comma-separated split targets should be accepted");
      const splitInstruction = buildExplicitSemanticSplitTargets("请自动仔细拆出所有元素，像后面的参考图那样分层");
      assert(splitInstruction.length === 0, "General split instructions should be treated as auto-detection hints, not one explicit target");
      assert(MAX_SEMANTIC_SPLIT_TARGETS >= 24, "Semantic split should allow detailed all-element target plans");
      assert(DEFAULT_BASE_URL === "http://127.0.0.1:49456/v1", "Default Base URL should match the active Cockpit API service");
      assert(DEFAULT_SEMANTIC_EDIT_MODEL === "gpt-5.5", "Responses image tool requests should default to the expected mainline model");
      assert(DEFAULT_CUTOUT_ANALYSIS_MODEL === "gpt-5.5", "Semantic analysis requests should default to the expected mainline model");
      assert(getResponsesMainModelCandidates()[0] === "gpt-5.5" && getResponsesMainModelCandidates().includes("gpt-5"), "Responses main model fallback list should try gpt-5.5 before compatibility fallbacks");
      assert(getResponsesImageToolModel("gpt-image-2") === "gpt-image-2", "Responses image tool model helper should preserve GPT Image models");
      assert(getResponsesImageToolModel("not-an-image-model") === "", "Responses image tool model helper should omit non-image models");
      assert(getImageEditInputFidelity("gpt-image-2", true) === "", "GPT Image 2 should omit explicit input_fidelity because it is automatically high fidelity");
      assert(getImageEditInputFidelityDebugMode("gpt-image-2", "") === "automatic-high", "GPT Image 2 debug records should identify automatic high-fidelity input handling");
      assert(getImageEditInputFidelity("gpt-image-1.5", true) === "high", "Earlier GPT Image edits should request explicit high input fidelity to preserve uploaded references");
      assert(getImageEditInputFidelity("gpt-image-2", false) === "", "Input fidelity should only be sent for actual image edit requests");
      assert(getImageEditInputFidelity("gpt-image-1-mini", true) === "", "GPT Image mini variants should not receive unsupported input_fidelity");
      assert(getImageEditInputFidelity("dall-e-2", true) === "", "Unsupported image models should not receive input_fidelity");
      assert(sanitizeDebugEndpointUrl("https://user:secret@example.com/v1/images/edits?api_key=sk-secret#frag") === "https://example.com/v1/images/edits", "Debug endpoint URLs must remove credentials, query strings, and fragments");
      assert(normalizeResponsesImageQuality("auto") === "auto", "Responses image tool quality should preserve auto instead of downgrading to low");
      assert(normalizeResponsesImageQuality("weird") === "auto", "Unknown Responses image tool quality should fall back to auto");
      assert(normalizeImageOutputFormat("image/webp") === "webp", "Image output format should accept MIME-style relay values");
      assert(normalizeBaseUrl("http://127.0.0.1:49456/v1") === "http://127.0.0.1:49456/v1", "Active 49456 Base URL should be preserved");
      assert(normalizeBaseUrl("http://localhost:9456/v1/images/edits") === "http://127.0.0.1:49456/v1", "Legacy 9456 image URL should migrate to active 49456");
      assert(shouldUseSidecarImageEndpointsFirst(getSettings(), true), "Codex sidecar should prefer OpenAI-compatible image endpoints");
      assert(shouldPreserveUserInpaintSelection(getSettings()), "Sidecar inpaint should preserve the full user-drawn selection");
      assert(!shouldUseChatGptStyleResponsesEdit(getSettings(), true), "Codex sidecar masked edits should use /images/edits before direct Responses");
      assert(shouldUseChatGptStyleResponsesEdit(getSettings(), false, { screenshotReferenceEdit: true }), "Selection screenshot repaint should prefer direct Responses even with the Codex sidecar");
      assert(shouldUseChatGptStyleResponsesEdit({ ...getSettings(), baseUrl: "https://example.com/v1" }, true), "Non-sidecar masked edits should still allow direct Responses first");
      assert(shouldUseSemanticInpaintSelection("把嘴巴闭上，其他部分完全不动"), "Mouth inpaint should still be recognized as a semantic target");
      assert(shouldUseSemanticInpaintSelection("把这一缕头发改成黑色的"), "Hair strand inpaint should still be recognized as a semantic target");
      const protectedNegativePrompt = buildPrompt("把头发改成黑色", "不要改变眼睛、鼻子、脸型、头发以外的部分");
      assert(!protectedNegativePrompt.includes("Avoid:"), "Negative prompt builder must not invert Chinese preservation constraints with Avoid");
      assert(protectedNegativePrompt.includes("Preservation constraints") && !protectedNegativePrompt.includes("Negative constraints:"), "Negative prompt builder should label preservation wording as protected constraints, not generic negatives");
      assert(protectedNegativePrompt.includes("不是要避免生成的对象") && protectedNegativePrompt.includes("硬性保护参考"), "Negative prompt builder should tell the model preservation constraints are protected references");
      const avoidNegativePrompt = buildPrompt("把背景换成蓝色", "不要出现文字和水印");
      assert(avoidNegativePrompt.includes("Negative constraints:"), "Negative prompt builder should keep true avoid constraints labeled as negative constraints");
      const responsesPrompt = buildResponsesImageEditPrompt("把嘴巴闭上", true, { size: "auto" });
      assert(/input_image_mask/.test(responsesPrompt) && /transparent pixels/.test(responsesPrompt), "Responses edit prompt should use ChatGPT-style mask semantics");
      assert(/non-transparent pixels are protected/.test(responsesPrompt), "Responses edit prompt should protect non-transparent mask pixels");
      const screenshotResponsesPrompt = buildResponsesImageEditPrompt("把中间的手去掉，弓不要变", false, {
        size: "auto",
        screenshotReferenceEdit: true,
        referenceSize: "320x240",
        referenceCanvasSize: "420x340",
        referenceCropBox: "50,50,320x240",
      });
      assert(/normal uploaded image/.test(screenshotResponsesPrompt) && /NOT a mask/.test(screenshotResponsesPrompt), "Screenshot reference edit prompt must not use mask semantics");
      assert(screenshotResponsesPrompt.includes("按普通上传图片编辑") && screenshotResponsesPrompt.includes("不按蒙版理解"), "Screenshot reference edit prompt should include Chinese no-mask guidance");
      assert(screenshotResponsesPrompt.includes("用户文字是唯一编辑规格") && screenshotResponsesPrompt.includes("受保护参考"), "Screenshot reference edit prompt should make the user's text the only edit specification");
      assert(screenshotResponsesPrompt.includes("only edit specification") && screenshotResponsesPrompt.includes("protected reference content"), "Screenshot reference edit prompt should protect objects the user says must stay unchanged");
      assert(screenshotResponsesPrompt.includes("Selected Photoshop crop size: 320x240") && screenshotResponsesPrompt.includes("Uploaded white reference canvas size: 420x340"), "Screenshot reference edit prompt should distinguish the selected crop from the uploaded white canvas");
      assert(screenshotResponsesPrompt.includes("Selected crop box inside uploaded canvas: 50,50,320x240"), "Screenshot reference edit prompt should tell the model where the selected crop sits inside the uploaded canvas");
      assert(screenshotResponsesPrompt.includes("Do not invent an unrelated square canvas"), "Screenshot reference edit prompt should reject unrelated square outputs");
      assert(screenshotResponsesPrompt.includes("不要把长方形参考图变成无关方图"), "Screenshot reference edit prompt should include Chinese no-unrelated-square-canvas guidance");
      assert(screenshotResponsesPrompt.startsWith("把中间的手去掉，弓不要变"), "Screenshot reference edit should send the user's instruction first");
      assert(!/2D game-icon style/.test(screenshotResponsesPrompt), "Screenshot reference edit prompt should not force a game-icon style");
      assert(/Do not crop, zoom, resize, shrink, recenter, or rotate/.test(screenshotResponsesPrompt), "Screenshot reference edit prompt should protect framing and margins");
      assert(screenshotResponsesPrompt.includes("visible footprint and bounding box") && screenshotResponsesPrompt.includes("do not make it occupy less of the crop"), "Screenshot reference edit prompt should forbid protected object shrinkage");
      assert(screenshotResponsesPrompt.includes("没有被点名要改的可见线条") && screenshotResponsesPrompt.includes("Do not redraw visible protected pixels"), "Screenshot reference edit prompt should explicitly protect visible unchanged pixels");
      assert(screenshotResponsesPrompt.includes("只补全遮挡物下面缺失的部分"), "Screenshot reference edit prompt should only reconstruct hidden pixels under the removed occluder");
      assert(screenshotResponsesPrompt.includes("完整可见形状"), "Screenshot reference edit prompt should use generic complete-target guidance");
      assert(screenshotResponsesPrompt.includes("complete visible shape"), "Screenshot reference edit prompt should include generic complete-target guidance in English");
      assert(!screenshotResponsesPrompt.includes("手、爪子、胳膊或手指"), "Screenshot reference edit prompt should not depend on hand/paw-specific wording");
      assert(!screenshotResponsesPrompt.includes("弓、道具、主体或背景的一部分"), "Screenshot reference edit prompt should not bake in bow-specific wording");
      const genericObjectResponsesPrompt = buildResponsesImageEditPrompt("把中间的红色贴纸去掉，水杯保持不变", false, {
        size: "auto",
        screenshotReferenceEdit: true,
        referenceSize: "240x160",
        referenceCanvasSize: "320x220",
        referenceCropBox: "40,30,240x160",
      });
      assert(genericObjectResponsesPrompt.startsWith("把中间的红色贴纸去掉，水杯保持不变"), "Generic screenshot edit prompt should preserve non-hand/non-bow user instructions verbatim");
      assert(genericObjectResponsesPrompt.includes("完整可见形状") && genericObjectResponsesPrompt.includes("complete visible shape"), "Generic screenshot edit prompt should use the same complete-target rules for arbitrary objects");
      assert(genericObjectResponsesPrompt.includes("受保护参考") && genericObjectResponsesPrompt.includes("protected reference content"), "Generic screenshot edit prompt should protect arbitrary objects the user says stay unchanged");
      assert(!genericObjectResponsesPrompt.includes("把中间的手去掉") && !genericObjectResponsesPrompt.includes("弓不要变"), "Generic screenshot edit prompt must not reuse the bow/hand test instruction");
      const savedSendRequest = sendRequest;
      const savedDebugJsonFileForResponses = saveDebugJsonFile;
      let capturedResponsesUrl = "";
      let capturedResponsesPayload = null;
      let capturedResponsesDebug = null;
      saveDebugJsonFile = async (name, data) => {
        if (name === "openai-last-responses-edit-request.json") capturedResponsesDebug = data;
      };
      sendRequest = async (url, requestOptions) => {
        capturedResponsesUrl = url;
        capturedResponsesPayload = JSON.parse(String(requestOptions.body || "{}"));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({
            output: [{ type: "image_generation_call", result: b64, output_format: "png" }],
          }),
        };
      };
      const screenshotEditItems = await requestSingleEdit(getSettings(), "把中间的手去掉，弓不要变", b64, null, {
        size: "auto",
        screenshotReferenceEdit: true,
      });
      sendRequest = savedSendRequest;
      saveDebugJsonFile = savedDebugJsonFileForResponses;
      assert(capturedResponsesUrl.endsWith("/responses"), "Selection screenshot repaint should call /responses directly");
      assert(screenshotEditItems.length === 1 && screenshotEditItems[0].b64 === b64, "Selection screenshot repaint should parse Responses image_generation results");
      const capturedPayloadText = JSON.stringify(capturedResponsesPayload);
      assert(!capturedPayloadText.includes("input_image_mask"), "Selection screenshot repaint payload must not include input_image_mask");
      assert(capturedPayloadText.includes("把中间的手去掉，弓不要变"), "Selection screenshot repaint payload should include the user's exact instruction");
      assert(capturedResponsesPayload?.model === "gpt-5.5", "Selection screenshot repaint should use the expected Responses mainline model");
      assert(capturedResponsesPayload?.tools?.[0]?.model === "gpt-image-2", "Selection screenshot repaint should keep the configured GPT Image model on the image_generation tool");
      assert(capturedResponsesPayload?.tools?.[0]?.action === "edit", "Selection screenshot repaint should use the Responses image edit action");
      assert(capturedResponsesPayload?.tools?.[0]?.quality === "auto", "Selection screenshot repaint should keep auto quality for Responses image edits");
      assert(capturedResponsesPayload?.tools?.[0]?.input_fidelity === undefined, "Selection screenshot repaint with GPT Image 2 should omit explicit input_fidelity");
      const screenshotContent = capturedResponsesPayload?.input?.[0]?.content || [];
      assert(screenshotContent[0]?.type === "input_image" && screenshotContent[1]?.type === "input_text", "Selection screenshot repaint should send the uploaded image before instruction text, matching ChatGPT web-style editing");
      assert(capturedResponsesDebug?.route === "screenshot-reference-edit", "Selection screenshot repaint should write a route-specific debug record");
      assert(capturedResponsesDebug?.hasMask === false && capturedResponsesDebug?.payloadHasInputImageMask === false, "Selection screenshot repaint debug record must prove no API mask was sent");
      assert(capturedResponsesDebug?.screenshotReferenceEdit === true, "Selection screenshot repaint debug record should mark screenshotReferenceEdit");
      assert(capturedResponsesDebug?.inputContentOrder === "image-first", "Selection screenshot repaint debug record should expose image-first uploaded-reference content order");
      assert(capturedResponsesDebug?.imageToolInputFidelity === null && capturedResponsesDebug?.imageToolInputFidelityMode === "automatic-high", "Selection screenshot repaint debug record should expose GPT Image 2 automatic high-fidelity handling");
      assert(Array.isArray(capturedResponsesDebug?.mainModelFallbacks) && capturedResponsesDebug.mainModelFallbacks.includes("gpt-5"), "Selection screenshot repaint debug record should expose Responses main-model fallbacks");
      assert(capturedResponsesDebug?.prompt?.includes("普通上传图片") && capturedResponsesDebug?.prompt?.includes("NOT a mask"), "Selection screenshot repaint debug record should include the exact no-mask prompt");
      assert(capturedResponsesDebug?.imageBytes > 0 && capturedResponsesDebug?.imageFormat === "png", "Selection screenshot repaint debug record should expose image size and format metadata");
      assert(capturedResponsesDebug?.referenceSize === null && capturedResponsesDebug?.referenceCanvasSize === null, "Selection screenshot repaint debug record should keep absent geometry fields explicit");
      assert(!JSON.stringify(capturedResponsesDebug).includes("sk-test-key"), "Selection screenshot repaint debug record must not include API keys");
      assert(!JSON.stringify(capturedResponsesDebug).includes(stripDataUrl(b64).slice(0, 24)), "Selection screenshot repaint debug record must not include image base64 bytes");
      const fallbackAttemptedModels = [];
      sendRequest = async (url, requestOptions) => {
        assert(String(url).endsWith("/responses"), "Unavailable main-model retry should stay on /responses");
        const payload = JSON.parse(String(requestOptions.body || "{}"));
        fallbackAttemptedModels.push(payload.model);
        if (fallbackAttemptedModels.length === 1) {
          return {
            ok: false,
            status: 400,
            statusText: "Bad Request",
            text: async () => JSON.stringify({
              error: {
                code: "model_not_available",
                message: "The requested main model is not available.",
                type: "invalid_request_error",
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({
            output: [{ type: "image_generation_call", result: b64, output_format: "png" }],
          }),
        };
      };
      const fallbackScreenshotItems = await requestSingleEdit(getSettings(), "把中间的手去掉，弓不要变", b64, null, {
        size: "auto",
        screenshotReferenceEdit: true,
      });
      sendRequest = savedSendRequest;
      assert(fallbackScreenshotItems.length === 1, "Selection screenshot repaint should retry successfully when the first Responses main model is unavailable");
      assert(fallbackAttemptedModels[0] === "gpt-5.5" && fallbackAttemptedModels[1] === "gpt-5", "Selection screenshot repaint should retry gpt-5 after gpt-5.5 model_not_available");
      let capturedJpegResponsesPayload = null;
      sendRequest = async (url, requestOptions) => {
        assert(String(url).endsWith("/responses"), "JPEG screenshot edit should still call /responses");
        capturedJpegResponsesPayload = JSON.parse(String(requestOptions.body || "{}"));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({
            output: [{ type: "image_generation_call", result: b64, output_format: "png" }],
          }),
        };
      };
      await requestSingleEdit(getSettings(), "按参考图局部修改", "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==", null, {
        size: "auto",
        screenshotReferenceEdit: true,
      });
      sendRequest = savedSendRequest;
      const jpegInput = capturedJpegResponsesPayload?.input?.[0]?.content?.find((part) => part?.type === "input_image")?.image_url || "";
      assert(String(jpegInput).startsWith("data:image/jpeg;base64,"), "Responses edit should preserve JPEG input MIME when the uploaded reference bytes are JPEG");
      let selectedReferenceImagesEditCalled = false;
      let capturedSelectedReferencePayload = null;
      sendRequest = async (url, requestOptions) => {
        if (String(url).endsWith("/images/edits")) selectedReferenceImagesEditCalled = true;
        assert(String(url).endsWith("/responses"), "Selected reference edit should call /responses directly");
        capturedSelectedReferencePayload = JSON.parse(String(requestOptions.body || "{}"));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({
            output: [{ type: "image_generation_call", result: b64, output_format: "png" }],
          }),
        };
      };
      const selectedReferenceEditItems = await requestSingleEdit(getSettings(), buildImageEditPrompt("把这张图调亮一点", "referenceNoMask"), b64, null, {
        size: "auto",
        screenshotReferenceEdit: true,
      });
      sendRequest = savedSendRequest;
      assert(!selectedReferenceImagesEditCalled, "Selected reference edit should not try the old /images/edits route first");
      assert(selectedReferenceEditItems.length === 1 && selectedReferenceEditItems[0].b64 === b64, "Selected reference edit should parse direct Responses image results");
      assert(!JSON.stringify(capturedSelectedReferencePayload).includes("input_image_mask"), "Selected reference edit must not send input_image_mask");
      assert(capturedSelectedReferencePayload?.tools?.[0]?.input_fidelity === undefined, "Selected no-mask reference edits with GPT Image 2 should omit explicit input_fidelity");
      assert(capturedSelectedReferencePayload?.input?.[0]?.content?.[0]?.type === "input_image", "Selected no-mask reference edits should also send the uploaded image before the instruction text");
      assert(JSON.stringify(capturedSelectedReferencePayload).includes("按普通上传图片编辑"), "Selected reference edit prompt should use normal uploaded-image semantics");
      let capturedGenerationPayload = null;
      sendRequest = async (url, requestOptions) => {
        assert(String(url).endsWith("/responses"), "Responses text generation fallback should call /responses");
        capturedGenerationPayload = JSON.parse(String(requestOptions.body || "{}"));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({
            output: [{ type: "image_generation_call", result: b64, output_format: "png" }],
          }),
        };
      };
      const generatedViaResponses = await requestResponsesTextImageGeneration(getSettings(), "一把木弓，白底");
      sendRequest = savedSendRequest;
      assert(generatedViaResponses.length === 1 && generatedViaResponses[0].b64 === b64, "Responses text generation fallback should parse image_generation results");
      assert(capturedGenerationPayload?.model === "gpt-5.5", "Responses text generation fallback should use the expected mainline model");
      assert(capturedGenerationPayload?.tools?.[0]?.model === "gpt-image-2", "Responses text generation fallback should keep the configured GPT Image model on the tool");
      assert(capturedGenerationPayload?.tools?.[0]?.action === undefined, "Responses text generation fallback should not send edit action");
      assert(capturedGenerationPayload?.tools?.[0]?.quality === "auto", "Responses text generation fallback should keep auto quality");
      const parsedResponsesVariants = parseResponsesImageGenerationItems({
        output: [
          { type: "image_generation_call", result: b64, output_format: "png" },
          { type: "image_generation_call", b64_json: b64, output_format: "jpg" },
          { type: "image_generation_call", result: { data: [{ b64_json: b64, output_format: "webp" }] } },
          { type: "image_generation_call", result: { url: "https://example.com/response-image.png" } },
          { type: "image_generation_call", result: "data:image/webp;base64," + b64 },
          { type: "image_generation_call", data_url: "data:image/png;base64," + b64, output_format: "webp" },
          { type: "image_generation_call", image_url: { url: "https://example.com/response-image-object.webp" }, output_format: "png" },
          { type: "image_generation_call", result: { data: [{ data_url: "data:image/png;base64," + b64, output_format: "jpeg" }] } },
          { type: "message", content: [{ type: "output_text", text: "not an image" }] },
        ],
      }, "png");
      assert(parsedResponsesVariants.length === 8, "Responses parser should keep supported official and relay image_generation variants");
      assert(parsedResponsesVariants[0].b64 === b64, "Responses parser should read official result base64");
      assert(parsedResponsesVariants[1].b64 === b64 && parsedResponsesVariants[1].format === "png", "Responses parser should prefer actual b64 bytes over stale jpg metadata");
      assert(parsedResponsesVariants[2].b64 === b64 && parsedResponsesVariants[2].format === "png", "Responses parser should prefer nested relay image bytes over stale output_format metadata");
      assert(parsedResponsesVariants[3].url === "https://example.com/response-image.png", "Responses parser should read relay image URLs");
      assert(parsedResponsesVariants[4].b64.startsWith("data:image/webp") && parsedResponsesVariants[4].format === "png", "Responses parser should prefer data URL byte signatures over stale MIME labels");
      assert(parsedResponsesVariants[5].b64.startsWith("data:image/png") && parsedResponsesVariants[5].format === "png", "Responses parser should parse relay data_url fields");
      assert(parsedResponsesVariants[6].url === "https://example.com/response-image-object.webp" && parsedResponsesVariants[6].format === "webp", "Responses parser should parse relay image_url object fields and infer URL formats");
      assert(parsedResponsesVariants[7].b64.startsWith("data:image/png") && parsedResponsesVariants[7].format === "png", "Responses parser should parse nested data_url payloads and prefer actual data URL MIME");
      const noImageResponsesError = createNoResponsesImageError("Responses 图像重绘", {
        output: [{ type: "message", content: [{ type: "output_text", text: "I returned text instead of an image." }] }],
      }, "{}", { status: 200 });
      assert(noImageResponsesError.noImageGenerationCall === true, "Responses no-image errors should carry a noImageGenerationCall marker");
      assert(/output 类型：message/.test(noImageResponsesError.message), "Responses no-image errors should report returned output types");
      assert(/I returned text/.test(noImageResponsesError.message), "Responses no-image errors should include the returned text summary");
      const parsedNestedResponseImages = parseResponsesImageGenerationItems({
        response: {
          output: [{ type: "image_generation_call", result: b64, output_format: "png" }],
        },
      }, "png");
      assert(parsedNestedResponseImages.length === 1 && parsedNestedResponseImages[0].b64 === b64, "Responses parser should read image_generation output from nested response envelopes");
      const parsedNestedResponseText = parseJsonFromResponseOutput({
        response: {
          output_text: '{"elements":[{"label":"弓","target":"弓","reason":"prop"}],"confidence":0.91}',
        },
      });
      assert(parsedNestedResponseText?.elements?.[0]?.target === "弓" && parsedNestedResponseText.confidence === 0.91, "Responses JSON helpers should read output_text from nested response envelopes");
      const parsedSseText = parseJsonFromResponseOutput(parseResponsesJsonText([
        { type: "response.output_text.delta", delta: '{"elements":[{"label":"弓","target":"弓","reason":"prop"}],' },
        { type: "response.output_text.delta", delta: '"confidence":0.92}' },
        { type: "response.completed", response: { id: "resp_test" } },
      ].map((event) => "data: " + JSON.stringify(event)).concat("data: [DONE]").join("\\n")));
      assert(parsedSseText?.elements?.[0]?.label === "弓" && parsedSseText.confidence === 0.92, "SSE output_text.delta Responses should be stitched into JSON for semantic helpers");
      const parsedSseImageJson = parseResponsesJsonText([
        { type: "response.output_text.delta", delta: "done" },
        { type: "response.output_item.done", item: { id: "ig_sse_1", type: "image_generation_call", result: b64, output_format: "png" } },
        { type: "response.completed", response: { id: "resp_img", output: [] } },
      ].map((event) => "data: " + JSON.stringify(event)).concat("data: [DONE]").join("\\n"));
      const parsedSseImages = parseResponsesImageGenerationItems(parsedSseImageJson, "png");
      assert(parsedSseImages.length === 1 && parsedSseImages[0].b64 === b64, "SSE image_generation_call output items should survive parsing instead of being discarded by output_text deltas");
      const parsedSseCompletedImageJson = parseResponsesJsonText([
        { type: "response.image_generation_call.completed", item_id: "ig_sse_2", result: b64, output_format: "png" },
        { type: "response.completed", response: { id: "resp_img2", output: [] } },
      ].map((event) => "data: " + JSON.stringify(event)).concat("data: [DONE]").join("\\n"));
      const parsedSseCompletedImages = parseResponsesImageGenerationItems(parsedSseCompletedImageJson, "png");
      assert(parsedSseCompletedImages.length === 1 && parsedSseCompletedImages[0].b64 === b64, "SSE image_generation_call completion events should be normalized into output items");
      const parsedSsePartialThenFinalJson = parseResponsesJsonText([
        { type: "response.image_generation_call.partial_image", item_id: "ig_sse_3", b64_json: "partial-preview", output_format: "png" },
        { type: "response.output_item.done", item: { id: "ig_sse_3", type: "image_generation_call", result: b64, output_format: "png" } },
        { type: "response.completed", response: { id: "resp_img3", output: [] } },
      ].map((event) => "data: " + JSON.stringify(event)).concat("data: [DONE]").join("\\n"));
      const parsedSsePartialThenFinalImages = parseResponsesImageGenerationItems(parsedSsePartialThenFinalJson, "png");
      assert(parsedSsePartialThenFinalImages.length === 1 && parsedSsePartialThenFinalImages[0].b64 === b64, "SSE partial image previews must not replace the final image_generation_call result");
      const parsedSsePlaceholderThenFinalJson = parseResponsesJsonText([
        { type: "response.output_item.added", item: { id: "ig_sse_4", type: "image_generation_call", status: "in_progress" } },
        { type: "response.output_item.done", item: { id: "ig_sse_4", type: "image_generation_call", status: "completed", result: b64, output_format: "png" } },
        { type: "response.completed", response: { id: "resp_img4", output: [] } },
      ].map((event) => "data: " + JSON.stringify(event)).concat("data: [DONE]").join("\\n"));
      const parsedSsePlaceholderThenFinalImages = parseResponsesImageGenerationItems(parsedSsePlaceholderThenFinalJson, "png");
      assert(parsedSsePlaceholderThenFinalImages.length === 1 && parsedSsePlaceholderThenFinalImages[0].b64 === b64, "SSE image_generation_call placeholders should be replaced by the completed image item with the same id");
      const parsedStandardImages = await parseOpenAIImageResponse({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({
          data: [
            { b64_json: b64, output_format: "png" },
            { revised_prompt: "no image here" },
            { url: "https://example.com/result.png", format: "png" },
            { b64_json: "data:image/webp;base64," + b64, output_format: "png" },
            { image_base64: b64, output_format: "jpeg" },
            { image_url: "https://example.com/relay-image.webp", output_format: "png" },
            { data_url: "data:image/png;base64," + b64, output_format: "webp" },
            { result: { b64_json: b64, output_format: "png" } },
          ],
        }),
      }, { kind: "文生图", endpointPath: "/images/generations" });
      assert(parsedStandardImages.length === 7, "Standard image responses should keep common relay b64/url/data-url image fields");
      assert(parsedStandardImages[2].format === "png", "Standard image responses should prefer actual data URL bytes over stale MIME/output metadata");
      assert(parsedStandardImages[3].b64 === b64 && parsedStandardImages[3].format === "png", "Standard image responses should parse relay image_base64 fields and prefer actual bytes over stale output metadata");
      assert(parsedStandardImages[4].url === "https://example.com/relay-image.webp" && parsedStandardImages[4].format === "webp", "Standard image responses should parse relay image_url fields and infer URL formats");
      assert(parsedStandardImages[5].b64.startsWith("data:image/png;base64,") && parsedStandardImages[5].format === "png", "Standard image responses should parse relay data_url fields and prefer actual data URL MIME");
      assert(parsedStandardImages[6].b64 === b64 && parsedStandardImages[6].format === "png", "Standard image responses should parse nested result image payloads");
      let rejectedEmptyStandardImageResponse = false;
      try {
        await parseOpenAIImageResponse({
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ data: [{ revised_prompt: "no image" }] }),
        }, { kind: "参考图编辑", endpointPath: "/images/edits" });
      } catch (error) {
        rejectedEmptyStandardImageResponse = /没有可显示的图片数据/.test(String(error?.message || error));
      }
      assert(rejectedEmptyStandardImageResponse, "Standard image responses with no usable image data should fail before preview/import");
      assert(shouldUseResponsesImageFallback({ status: 404 }, getSettings(), null), "No-mask reference edits should fall back when /images/edits is unavailable");
      assert(shouldUseResponsesImageFallback({ status: 405 }, getSettings(), null), "No-mask reference edits should fall back when /images/edits is not allowed by a relay");
      assert(shouldUseResponsesImageFallback({ status: 501 }, getSettings(), null), "No-mask reference edits should fall back when /images/edits is not implemented by a relay");
      assert(!shouldUseResponsesImageFallback({ status: 401 }, getSettings(), null), "Image edit fallback must not hide auth failures");
      assert(shouldUseResponsesGenerationFallback({ status: 405 }, getSettings()), "Text-to-image should fall back when /images/generations is not allowed by a relay");
      assert(shouldUseResponsesGenerationFallback({ status: 501 }, getSettings()), "Text-to-image should fall back when /images/generations is not implemented by a relay");
      assert(!shouldUseResponsesGenerationFallback({ status: 429 }, getSettings()), "Text-to-image fallback must not hide rate-limit failures");
      let referenceFallbackImagesEditCalled = false;
      let capturedReferenceFallbackPayload = null;
      sendRequest = async (url, requestOptions) => {
        if (String(url).endsWith("/images/edits")) {
          referenceFallbackImagesEditCalled = true;
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            text: async () => JSON.stringify({ error: { message: "edits not found" } }),
          };
        }
        assert(String(url).endsWith("/responses"), "No-mask reference edit fallback should call /responses after /images/edits 404");
        capturedReferenceFallbackPayload = JSON.parse(String(requestOptions.body || "{}"));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({
            output: [{ type: "image_generation_call", result: b64, output_format: "png" }],
          }),
        };
      };
      const referenceFallbackItems = await requestSingleEdit(getSettings(), "把亮度调清楚一点", b64, null, { size: "auto" });
      sendRequest = savedSendRequest;
      assert(referenceFallbackImagesEditCalled, "No-mask reference edit should try the sidecar /images/edits endpoint first");
      assert(referenceFallbackItems.length === 1 && referenceFallbackItems[0].b64 === b64, "No-mask reference edit should recover through Responses image_generation");
      assert(!JSON.stringify(capturedReferenceFallbackPayload).includes("input_image_mask"), "No-mask reference edit fallback must not send input_image_mask");
      assert(capturedReferenceFallbackPayload?.tools?.[0]?.action === "edit", "No-mask reference edit fallback should use Responses edit action");
      assert(capturedReferenceFallbackPayload?.tools?.[0]?.input_fidelity === undefined, "No-mask reference edit fallback with GPT Image 2 should omit explicit input_fidelity");
      assert(state.unsupportedEditEndpoints.has(getEditEndpointKey(getSettings())), "No-mask /images/edits 404 should mark the edit endpoint unsupported");
      assert(shouldUseChatGptStyleResponsesEdit(getSettings(), false), "Future no-mask sidecar reference edits should use Responses after /images/edits is marked unsupported");
      state.unsupportedEditEndpoints.clear();
      state.unsupportedResponsesEditEndpoints.clear();
      let capturedImagesEditForm = null;
      let capturedImagesEditDebug = null;
      let capturedLegacyImagesEditDebug = null;
      const savedDebugJsonFileForImagesEdit = saveDebugJsonFile;
      saveDebugJsonFile = async (name, data) => {
        if (name !== "openai-last-images-edit-request.json") return;
        if (data?.model === "gpt-image-1.5") {
          capturedLegacyImagesEditDebug = data;
        } else {
          capturedImagesEditDebug = data;
        }
      };
      sendRequest = async (url, requestOptions) => {
        assert(String(url).endsWith("/images/edits"), "Sidecar /images/edits compatibility route should send multipart edits");
        capturedImagesEditForm = requestOptions.body;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ data: [{ b64_json: b64, output_format: "png" }] }),
        };
      };
      await requestSingleEdit(getSettings(), "普通参考图兼容路径", b64, null, { size: "auto" });
      sendRequest = savedSendRequest;
      const gptImage2FormEntries = {};
      for (const [key, value] of capturedImagesEditForm.entries()) {
        gptImage2FormEntries[key] = typeof value === "string" ? value : (value?.name || "[blob]");
      }
      assert(gptImage2FormEntries.model === "gpt-image-2", "/images/edits compatibility route should keep the configured GPT Image 2 model");
      assert(!("input_fidelity" in gptImage2FormEntries), "/images/edits compatibility route must omit explicit input_fidelity for GPT Image 2");
      assert(capturedImagesEditDebug?.route === "reference-edit", "/images/edits debug record should identify no-mask reference edits");
      assert(capturedImagesEditDebug?.hasMask === false && capturedImagesEditDebug?.maskFileName === null, "/images/edits debug record should prove no mask was attached for no-mask reference edits");
      assert(capturedImagesEditDebug?.inputFidelity === null && capturedImagesEditDebug?.inputFidelityMode === "automatic-high", "/images/edits debug record should expose GPT Image 2 automatic high-fidelity handling");
      assert(!/[?#]/.test(capturedImagesEditDebug?.endpointUrl || ""), "/images/edits debug record must not persist endpoint URL query strings or fragments");
      assert(!JSON.stringify(capturedImagesEditDebug).includes("sk-test-key"), "/images/edits debug record must not include API keys");
      assert(!JSON.stringify(capturedImagesEditDebug).includes(stripDataUrl(b64).slice(0, 24)), "/images/edits debug record must not include image base64 bytes");
      let capturedLegacyImagesEditForm = null;
      sendRequest = async (url, requestOptions) => {
        assert(String(url).endsWith("/images/edits"), "Legacy GPT Image edit compatibility route should still use /images/edits");
        capturedLegacyImagesEditForm = requestOptions.body;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ data: [{ b64_json: b64, output_format: "png" }] }),
        };
      };
      await requestSingleEdit({ ...getSettings(), model: "gpt-image-1.5" }, "普通参考图高保真兼容路径", b64, null, { size: "auto" });
      sendRequest = savedSendRequest;
      saveDebugJsonFile = savedDebugJsonFileForImagesEdit;
      const legacyImageFormEntries = {};
      for (const [key, value] of capturedLegacyImagesEditForm.entries()) {
        legacyImageFormEntries[key] = typeof value === "string" ? value : (value?.name || "[blob]");
      }
      assert(legacyImageFormEntries.model === "gpt-image-1.5", "/images/edits compatibility route should keep legacy GPT Image model ids");
      assert(legacyImageFormEntries.input_fidelity === "high", "/images/edits compatibility route should request high input fidelity only for models that support it");
      assert(capturedLegacyImagesEditDebug?.inputFidelity === "high" && capturedLegacyImagesEditDebug?.inputFidelityMode === "explicit-high", "/images/edits debug record should show explicit high fidelity for supported legacy GPT Image models");
      let unsafeFallbackCalled = false;
      let refusedUnsafeFallback = false;
      sendRequest = async (url) => {
        if (String(url).endsWith("/responses")) {
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            text: async () => JSON.stringify({ error: { message: "not found" } }),
          };
        }
        unsafeFallbackCalled = true;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify({ data: [{ b64_json: b64 }] }),
        };
      };
      try {
        await requestSingleEdit(getSettings(), "把中间的手去掉，弓不要变", b64, null, {
          size: "auto",
          screenshotReferenceEdit: true,
        });
      } catch (error) {
        refusedUnsafeFallback = /避免退回旧的 Mask/.test(String(error?.message || error));
      }
      sendRequest = savedSendRequest;
      assert(refusedUnsafeFallback, "Selection screenshot repaint should fail safely when /responses is unavailable");
      assert(!unsafeFallbackCalled, "Selection screenshot repaint must not silently fall back to /images/edits");
      state.unsupportedResponsesEditEndpoints.add(getResponsesEditEndpointKey(getSettings()));
      assert(shouldUseChatGptStyleResponsesEdit(getSettings(), false, { screenshotReferenceEdit: true }), "Selection screenshot repaint must bypass stale unsupported /responses cache");
      state.unsupportedResponsesEditEndpoints.clear();
      let capturedKoukoutuUrl = "";
      let capturedKoukoutuForm = null;
      let capturedKoukoutuDebug = null;
      const savedDebugBase64Image = saveDebugBase64Image;
      const savedDebugJsonFileForKoukoutu = saveDebugJsonFile;
      saveDebugBase64Image = async () => {};
      saveDebugJsonFile = async (name, data) => {
        if (name === "cutout-last-koukoutu-request.json") capturedKoukoutuDebug = data;
      };
      sendRequest = async (url, requestOptions) => {
        capturedKoukoutuUrl = url;
        capturedKoukoutuForm = requestOptions.body;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => base64ToArrayBuffer(b64),
        };
      };
      const koukoutuResult = await realRequestKoukoutuCutout({
        ...getSettings(),
        koukoutuFormat: "webp",
        koukoutuBorder: 3,
      }, b64);
      sendRequest = savedSendRequest;
      saveDebugBase64Image = savedDebugBase64Image;
      saveDebugJsonFile = savedDebugJsonFileForKoukoutu;
      const koukoutuEntries = {};
      for (const [key, value] of capturedKoukoutuForm.entries()) {
        koukoutuEntries[key] = typeof value === "string" ? value : (value?.name || "[blob]");
      }
      assert(capturedKoukoutuUrl === KOUKOUTU_SYNC_URL, "Koukoutu cutout should call the sync background-removal endpoint");
      assert(koukoutuEntries.model_key === "background-removal", "Koukoutu cutout should request background removal");
      assert(koukoutuEntries.crop === "0" && koukoutuEntries.stamp_crop === "0", "Koukoutu cutout must keep original image dimensions for Photoshop placement");
      assert(koukoutuEntries.response === "bytes", "Koukoutu cutout should request raw bytes for direct PNG import");
      assert(koukoutuEntries.output_format === "webp" && koukoutuEntries.border === "3", "Koukoutu cutout should preserve configured output format and border");
      assert(capturedKoukoutuDebug?.route === "koukoutu-cutout" && capturedKoukoutuDebug?.endpointUrl === KOUKOUTU_SYNC_URL, "Koukoutu debug request should record the sanitized cutout route");
      assert(capturedKoukoutuDebug?.crop === 0 && capturedKoukoutuDebug?.stampCrop === 0, "Koukoutu debug request should prove cropped API output is disabled");
      assert(capturedKoukoutuDebug?.response === "bytes" && capturedKoukoutuDebug?.outputFormat === "webp", "Koukoutu debug request should expose raw byte response mode and output format");
      assert(capturedKoukoutuDebug?.inputBytes > 0 && capturedKoukoutuDebug?.inputFormat === "png", "Koukoutu debug request should expose input byte count and inferred input format");
      assert(!JSON.stringify(capturedKoukoutuDebug).includes("kou-test"), "Koukoutu debug request must not persist API keys");
      assert(!JSON.stringify(capturedKoukoutuDebug).includes(stripDataUrl(b64).slice(0, 24)), "Koukoutu debug request must not include image base64 bytes");
      assert(koukoutuResult.b64 === b64 && koukoutuResult.importB64 === b64, "Koukoutu cutout should return the same full-size bytes for preview and import");
      assert(koukoutuResult.format === "png", "Koukoutu cutout should record the actual returned byte format instead of stale requested metadata");
      const smallCutoutPixels = new Uint8Array(2 * 2 * 4).fill(255);
      const normalizedCutout = await normalizeCutoutResultItem({
        b64: bytesToBase64(encodePngRgba(2, 2, smallCutoutPixels)),
        format: "png",
      }, { placementRect: { width: 4, height: 4 } });
      const normalizedCutoutDecoded = await decodePngRgbaBase64(normalizedCutout.b64);
      assert(normalizedCutoutDecoded.width === 4 && normalizedCutoutDecoded.height === 4, "Koukoutu cutout results should be resized to the captured Photoshop region when aspect ratio matches");
      let rejectedCutoutMismatch = false;
      try {
        await normalizeCutoutResultItem({
          b64: bytesToBase64(encodePngRgba(2, 3, new Uint8Array(2 * 3 * 4).fill(255))),
          format: "png",
        }, { placementRect: { width: 4, height: 4 } });
      } catch (error) {
        rejectedCutoutMismatch = /比例不一致/.test(String(error?.message || error));
      }
      assert(rejectedCutoutMismatch, "Koukoutu cutout results should fail safely when cropped dimensions cannot map back to the captured region");
      let rejectedBadImport = false;
      try {
        await resultToArrayBuffer({ importB64: Promise.resolve(b64), b64 }, true);
      } catch (error) {
        rejectedBadImport = /base64/.test(String(error && error.message));
      }
      assert(rejectedBadImport, "Import base64 must reject non-string data before Photoshop placement");
      const previewImportB64 = bytesToBase64(encodePngRgba(3, 1, new Uint8Array(12).fill(128)));
      const savedCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = null;
      const previewOverride = resultToPreviewSrc({
        url: "https://example.com/stale-full-result.png",
        previewB64: b64,
        format: "png",
      });
      assert(previewOverride.startsWith("data:image/png;base64,"), "Processed preview bytes should display before stale remote result URLs");
      const correctedPreviewB64Mime = resultToPreviewSrc({
        previewB64: "data:image/webp;base64," + b64,
        format: "webp",
      });
      assert(correctedPreviewB64Mime.startsWith("data:image/png;base64,"), "PreviewB64 should be rebuilt with the actual byte format instead of stale MIME labels");
      const importPreview = resultToPreviewSrc({
        url: "https://example.com/stale-url-result.png",
        importB64: b64,
        format: "png",
      });
      assert(importPreview !== "https://example.com/stale-url-result.png", "Import bytes should display before remote URLs when no explicit preview is available");
      const correctedDataUrlPreview = resultToPreviewSrc({
        importB64: "data:image/webp;base64," + b64,
        format: "webp",
      });
      assert(correctedDataUrlPreview.startsWith("data:image/png;base64,"), "Preview data URLs should be rebuilt with the actual byte format instead of stale MIME labels");
      const importPreferredPreview = resultToPreviewSrc({
        b64,
        importB64: previewImportB64,
        format: "png",
      });
      URL.createObjectURL = savedCreateObjectURL;
      assert(importPreferredPreview.includes(stripDataUrl(previewImportB64)), "Preview should prefer the actual import bytes over stale display bytes when both exist");
      assertDirectSelectionPatchPlacementRatio(
        { mode: "inpaint", placementMode: "direct-selection-patch" },
        { width: 80, height: 60 },
        { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 }
      );
      assertDirectSelectionPatchPlacementRatio(
        { mode: "inpaint", placementMode: "direct-selection-patch" },
        { width: 1024, height: 1024 },
        { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 }
      );
      const savedCreateSessionToken = fs.createSessionToken;
      let placedTempFileName = "";
      fs.createSessionToken = async (file) => {
        placedTempFileName = file.name || "";
        return "mock-token:" + placedTempFileName;
      };
      app.activeDocument = {
        width: 100,
        height: 80,
        activeLayers: [{}],
      };
      await realPlaceResultAsLayer({ b64, format: "webp" }, null, "Stale Format Placement", null);
      fs.createSessionToken = savedCreateSessionToken;
      assert(placedTempFileName.endsWith(".png"), "Photoshop placement should infer the temp file extension from actual bytes when format metadata is stale");
      let rejectedBadPng = false;
      try {
        getValidatedImageSize(new Uint8Array([1, 2, 3, 4]).buffer, "png");
      } catch (error) {
        rejectedBadPng = /PNG/.test(String(error && error.message));
      }
      assert(rejectedBadPng, "PNG placement must validate image bytes before Photoshop placement");
      const jpegBytes = new Uint8Array([
        0xff, 0xd8,
        0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
        0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x21, 0x00, 0x45, 0x01, 0x11, 0x00,
        0xff, 0xd9,
      ]);
      const plainJpegB64 = bytesToBase64(jpegBytes);
      const jpegSize = getValidatedImageSize(jpegBytes.buffer, "jpeg");
      assert(jpegSize.width === 69 && jpegSize.height === 33, "JPEG placement should read real image dimensions instead of assuming 1024");
      assert(detectFormatFromResult({ b64: "data:image/webp;base64," + b64, format: "webp" }) === "png", "Data URL byte signatures should override stale MIME and format metadata");
      assert(detectFormatFromResult({ b64: "data:image/webp;base64," + b64 }) === "png", "Placement should prefer data URL bytes over MIME labels");
      assert(detectFormatFromResult({ url: "https://example.com/result.JPG?download=1" }) === "jpeg", "Placement should infer JPEG format from URL paths before query strings");
      assert(detectFormatFromResult({ b64: plainJpegB64 }) === "jpeg", "Placement should infer JPEG format from plain base64 magic bytes");
      assert(detectFormatFromResult({ b64: plainJpegB64, format: "png" }) === "jpeg", "Plain base64 file signatures should override stale format metadata");
      const webpBytes = new Uint8Array(30);
      "RIFF".split("").forEach((char, index) => { webpBytes[index] = char.charCodeAt(0); });
      webpBytes[4] = 22;
      "WEBP".split("").forEach((char, index) => { webpBytes[8 + index] = char.charCodeAt(0); });
      "VP8X".split("").forEach((char, index) => { webpBytes[12 + index] = char.charCodeAt(0); });
      webpBytes[16] = 10;
      const webpWidthMinusOne = 120;
      const webpHeightMinusOne = 44;
      webpBytes[24] = webpWidthMinusOne & 255;
      webpBytes[25] = (webpWidthMinusOne >> 8) & 255;
      webpBytes[26] = (webpWidthMinusOne >> 16) & 255;
      webpBytes[27] = webpHeightMinusOne & 255;
      webpBytes[28] = (webpHeightMinusOne >> 8) & 255;
      webpBytes[29] = (webpHeightMinusOne >> 16) & 255;
      const plainWebpB64 = bytesToBase64(webpBytes);
      const webpSize = getValidatedImageSize(webpBytes.buffer, "webp");
      assert(webpSize.width === 121 && webpSize.height === 45, "WebP placement should read real image dimensions instead of assuming 1024");
      assert(detectFormatFromResult({ b64: plainWebpB64 }) === "webp", "Placement should infer WebP format from plain base64 magic bytes");
      assert(detectFormatFromResult({ b64: "data:image/webp;base64," + plainWebpB64 }) === "webp", "Placement should keep WebP data URLs when the bytes are actually WebP");
      assert(resolveImageValueFormat({ b64: plainJpegB64, format: "png" }, plainJpegB64, "png") === "jpeg", "Pixel processing should prefer plain base64 JPEG signatures over stale PNG metadata");
      assert(resolveImageValueFormat({ b64: "data:image/webp;base64," + b64, format: "webp" }, "data:image/webp;base64," + b64, "png") === "png", "Pixel processing should prefer data URL bytes over stale MIME metadata");
      assert(resolveImageValueFormat({ b64: "data:image/webp;base64," + plainWebpB64, format: "png" }, "data:image/webp;base64," + plainWebpB64, "png") === "webp", "Pixel processing should infer WebP from data URL bytes when they are actually WebP");
      assert(resolveImageBytesFormat({ url: "https://example.com/result" }, jpegBytes, "png") === "jpeg", "Downloaded extensionless URL images should infer JPEG from bytes before pixel processing");
      assert(resolveImageBytesFormat({ url: "https://example.com/result.png", format: "png" }, webpBytes, "png") === "webp", "Downloaded image bytes should override stale URL/metadata formats for pixel processing");
      let rejectedBadWebp = false;
      try {
        getValidatedImageSize(new Uint8Array([82, 73, 70, 70]).buffer, "webp");
      } catch (error) {
        rejectedBadWebp = /WebP/.test(String(error && error.message));
      }
      assert(rejectedBadWebp, "Invalid WebP placement bytes should fail before Photoshop placement");
      const savedWhiteMatteConverter = createWhiteMatteTransparentBase64;
      let rejectedWhiteMattePlacement = false;
      const placeEventsBeforeWhiteMatte = calls.filter((call) => call[0] === "batchPlay" && call[1] === "placeEvent").length;
      createWhiteMatteTransparentBase64 = async () => {
        throw new Error("decode failed");
      };
      try {
        await realPlaceResultAsLayer({
          b64,
          format: "png",
          whiteMatteMask: true,
        }, { left: 0, top: 0, right: 2, bottom: 2, width: 2, height: 2 }, "Split Unsafe White Matte", null, { preserveImageAspect: true });
      } catch (error) {
        rejectedWhiteMattePlacement = /白底透明化失败/.test(String(error && error.message));
      }
      createWhiteMatteTransparentBase64 = savedWhiteMatteConverter;
      const placeEventsAfterWhiteMatte = calls.filter((call) => call[0] === "batchPlay" && call[1] === "placeEvent").length;
      assert(rejectedWhiteMattePlacement, "Split placement should fail safely if white-matte transparency conversion fails");
      assert(placeEventsAfterWhiteMatte === placeEventsBeforeWhiteMatte, "Split placement must not place an unsafe white-matte layer after transparency conversion fails");
      assert(getRectFeatherStrength(5, 5, 0, 0, 10, 10, 3) === 1, "Mask feather should keep the center opaque");
      assert(getRectFeatherStrength(0, 5, 0, 0, 10, 10, 3) < 0.5, "Mask feather should soften clipped edges");
      const savedMaskClipper = createMaskClippedImportBase64;
      const savedClosedFallbackCreator = createClosedMouthFallbackImportBase64;
      const savedRectClipper = createRectClippedImportBase64;
      let closedFallbackCalled = false;
      createMaskClippedImportBase64 = async () => "clipped-import";
      createClosedMouthFallbackImportBase64 = async () => {
        closedFallbackCalled = true;
        return { b64: "closed-fallback", placementRect: { left: 1, top: 1, right: 2, bottom: 2, width: 1, height: 1 } };
      };
      createRectClippedImportBase64 = async () => "rect-fallback";
      const preparedInpaint = await prepareMaskedInpaintLayers([{ b64, format: "png" }], {
        image: b64,
        mask: b64,
        targetRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        placementRect: { left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80 },
        forceClosedMouthFallback: true,
      });
      createMaskClippedImportBase64 = savedMaskClipper;
      createClosedMouthFallbackImportBase64 = savedClosedFallbackCreator;
      createRectClippedImportBase64 = savedRectClipper;
      assert(!closedFallbackCalled, "Inpaint import must not replace model output with local closed-mouth fallback");
      assert(preparedInpaint[0].importB64 === "clipped-import", "Inpaint import should use the same model result after mask clipping");
      assert(preparedInpaint[0].previewB64 === "clipped-import", "Inpaint preview must match the actual Photoshop import image");
      const historyImportB64 = bytesToBase64(encodePngRgba(3, 1, new Uint8Array(12).fill(128)));
      await realSaveHistoryItem({
        id: "history-import-fidelity",
        b64,
        importB64: historyImportB64,
        format: "webp",
        prompt: "history import test",
        mode: "inpaint",
        model: "gpt-image-2",
        size: "40x30",
        quality: "low",
        placementMode: "selection-mask-layer",
        skipPreviewCrop: true,
        preclippedImport: true,
        normalizedPlacementSize: true,
        targetRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        placementRect: { left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80 },
        cropRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        importVisibleRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        previewB64: b64,
        createdAt: "2026-05-29T00:00:00.000Z",
      });
      const staleHistoryIndex = JSON.parse(localStorage.getItem(HISTORY_KEY));
      staleHistoryIndex[0].format = "webp";
      localStorage.setItem(HISTORY_KEY, JSON.stringify(staleHistoryIndex));
      await realLoadHistory();
      const loadedHistoryItem = state.history.find((item) => item.id === "history-import-fidelity");
      assert(loadedHistoryItem, "History should reload saved generated items");
      assert(loadedHistoryItem.placementMode === "selection-mask-layer", "History should preserve placement mode for future imports");
      assert(loadedHistoryItem.preclippedImport === true, "History should preserve preclipped import state");
      assert(loadedHistoryItem.normalizedPlacementSize === true, "History should preserve placement size normalization metadata");
      assert(loadedHistoryItem.skipPreviewCrop === true, "History should preserve preview crop flags");
      assert(loadedHistoryItem.importVisibleRect.width === 40, "History should preserve import visible rect metadata");
      assert(loadedHistoryItem.fileName.endsWith(".png") && loadedHistoryItem.format === "png", "History should infer file format from actual saved import bytes instead of stale item.format or older record metadata");
      assert(loadedHistoryItem.importB64 === loadedHistoryItem.b64, "History should restore saved import bytes for Photoshop placement");
      const loadedHistoryBytes = await resultToArrayBuffer(loadedHistoryItem, true);
      const loadedHistoryImage = await decodePngRgbaBase64(arrayBufferToBase64(loadedHistoryBytes));
      assert(loadedHistoryImage.width === 3 && loadedHistoryImage.height === 1, "History should save the actual import image bytes, not stale preview bytes");
      await realSaveHistoryItem({
        id: "history-direct-selection-patch",
        b64,
        importB64: b64,
        format: "png",
        prompt: "history direct selection patch",
        mode: "inpaint",
        model: "gpt-image-2",
        size: "40x30",
        quality: "auto",
        placementMode: "direct-selection-patch",
        skipPreviewCrop: true,
        preclippedImport: false,
        normalizedPlacementSize: true,
        targetRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        placementRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        cropRect: null,
        createdAt: "2026-05-29T00:00:01.000Z",
      });
      await realLoadHistory();
      const loadedDirectPatchHistoryItem = state.history.find((item) => item.id === "history-direct-selection-patch");
      assert(loadedDirectPatchHistoryItem, "History should reload direct selection patch results");
      assert(loadedDirectPatchHistoryItem.placementMode === "direct-selection-patch", "History should preserve direct selection patch placement mode");
      assert(loadedDirectPatchHistoryItem.skipPreviewCrop === true, "History should preserve skipPreviewCrop for direct selection patches");
      assert(loadedDirectPatchHistoryItem.normalizedPlacementSize === true, "History should preserve full-image-size placement for direct selection patches");
      assert(loadedDirectPatchHistoryItem.cropRect === null, "History should not resurrect a cropRect for direct selection patches");
      assert(loadedDirectPatchHistoryItem.preclippedImport === false, "History should not mark direct selection patches as preclipped mask imports");
      assert(loadedDirectPatchHistoryItem.importB64 === loadedDirectPatchHistoryItem.b64, "History should restore direct selection patch import bytes for Photoshop placement");
      const savedHistorySendRequest = sendRequest;
      let historyUrlDownloads = 0;
      const urlOnlyHistoryItem = {
        id: "history-url-materialize",
        url: "https://example.com/short-lived-result.png",
        format: "webp",
        prompt: "history url materialize test",
        mode: "generate",
        model: "gpt-image-2",
        size: "auto",
        quality: "auto",
        createdAt: "2026-05-29T00:00:01.000Z",
      };
      sendRequest = async (url, requestOptions) => {
        historyUrlDownloads += 1;
        assert(url === "https://example.com/short-lived-result.png", "History save should download the returned short-lived result URL");
        assert(requestOptions?.responseType === "arraybuffer", "History save should download URL results as raw bytes");
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => base64ToArrayBuffer(b64),
        };
      };
      const urlOnlyHistoryChanged = await realSaveHistoryItem(urlOnlyHistoryItem);
      sendRequest = savedHistorySendRequest;
      assert(historyUrlDownloads === 1, "History save should download a URL-only result exactly once");
      assert(urlOnlyHistoryChanged === true, "History save should report URL-only result materialization so result cards can be re-rendered");
      assert(urlOnlyHistoryItem.b64 === b64 && urlOnlyHistoryItem.url === null, "History save should materialize URL-only current results into local base64 bytes");
      assert(urlOnlyHistoryItem.format === "png", "History save should update URL-only current result format from downloaded bytes");
      state.mode = "inpaint";
      calls.length = 0;
      state.results = [{
        id: "manual-direct-selection-patch",
        b64,
        importB64: b64,
        format: "png",
        prompt: "manual direct patch import",
        mode: "inpaint",
        placementMode: "direct-selection-patch",
        targetRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        placementRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        cropRect: null,
      }];
      state.history = [];
      state.selectedId = "manual-direct-selection-patch";
      await importSelected();
      assert(calls.some((call) => call[0] === "place" && call[1] === "inpaint" && call[4] === "direct-selection-patch" && call[5] === null && call[6] === true && call[7] === false), "Manual/history direct-selection patch import should fit by full image size and avoid post-import masks");

      state.mode = "reference";
      calls.length = 0;
      const oldHistoryReferenceB64 = bytesToBase64(encodePngRgba(2, 2, new Uint8Array(16).fill(180)));
      state.results = [{
        id: "manual-full-region-patch",
        b64: oldHistoryReferenceB64,
        importB64: oldHistoryReferenceB64,
        format: "png",
        prompt: "manual full-region patch import",
        mode: "reference",
        placementMode: "full-region-patch",
        targetRect: { left: 10, top: 12, right: 14, bottom: 16, width: 4, height: 4 },
        placementRect: { left: 10, top: 12, right: 14, bottom: 16, width: 4, height: 4 },
        cropRect: null,
      }];
      state.history = [];
      state.selectedId = "manual-full-region-patch";
      await importSelected();
      assert(calls.some((call) => call[0] === "place" && call[1] === "reference" && call[4] === "full-region-patch" && call[14] === 4 && call[15] === 4 && call[16] === true), "Manual/history full-region patch import should normalize old result bytes to the saved Photoshop placement rectangle");

      calls.length = 0;
      const mismatchedHistoryReferenceB64 = bytesToBase64(encodePngRgba(3, 1, new Uint8Array(12).fill(200)));
      state.results = [{
        id: "manual-full-region-mismatch",
        b64: mismatchedHistoryReferenceB64,
        importB64: mismatchedHistoryReferenceB64,
        format: "png",
        prompt: "manual full-region mismatch import",
        mode: "reference",
        placementMode: "full-region-patch",
        targetRect: { left: 10, top: 12, right: 14, bottom: 16, width: 4, height: 4 },
        placementRect: { left: 10, top: 12, right: 14, bottom: 16, width: 4, height: 4 },
        cropRect: null,
      }];
      state.selectedId = "manual-full-region-mismatch";
      await importSelected();
      assert(!calls.some((call) => call[0] === "place"), "Manual/history full-region patch import should refuse mismatched ratios instead of placing a distorted layer");

      state.mode = "inpaint";
      $("promptInput").value = "把嘴巴闭上";
      $("negativePromptInput").value = "其他地方不要动";
      savePromptDraftForMode();
      $("promptInput").value = "";
      $("negativePromptInput").value = "";
      restorePromptDraftForMode("inpaint");
      assert($("promptInput").value === "把嘴巴闭上", "Prompt draft should restore");
      assert($("negativePromptInput").value === "其他地方不要动", "Negative prompt draft should restore");
      $("promptInput").value = "";
      $("negativePromptInput").value = "除了嘴巴以外不要改变";
      savePromptDraftForMode();
      $("promptInput").value = "";
      $("negativePromptInput").value = "";
      restorePromptDraftForMode("inpaint");
      assert($("promptInput").value === "把嘴巴闭上", "Blank prompt save should keep last non-empty prompt");
      assert($("negativePromptInput").value === "除了嘴巴以外不要改变", "Blank prompt save should restore latest negative prompt");
      state.promptDrafts.inpaint = { prompt: "", negative: "除了嘴巴以外不要改变" };
      $("promptInput").value = "把嘴巴闭上，其他部分完全不动";
      $("negativePromptInput").value = "";
      restorePromptDraftForMode("inpaint");
      assert($("promptInput").value === "把嘴巴闭上，其他部分完全不动", "Blank draft prompt should not clear current prompt");
      assert($("negativePromptInput").value === "除了嘴巴以外不要改变", "Nonblank draft negative prompt should still restore");
      state.promptDrafts.inpaint = { prompt: "", negative: "", explicitEmpty: true };
      $("promptInput").value = "把嘴巴闭上，其他部分完全不动";
      $("negativePromptInput").value = "其他地方不要动";
      restorePromptDraftForMode("inpaint");
      assert($("promptInput").value === "把嘴巴闭上，其他部分完全不动", "Explicit empty draft should not erase a typed prompt");
      assert($("negativePromptInput").value === "其他地方不要动", "Explicit empty draft should not erase a typed negative prompt");

      const fallbackRect = getSurgicalFeatureFallbackRect(
        "把嘴巴闭上",
        { left: 10, top: 10, right: 510, bottom: 360, width: 500, height: 350 },
        { width: 1024, height: 1024 }
      );
      assert(fallbackRect && fallbackRect.width <= 140 && fallbackRect.height <= 162, "Mouth fallback should shrink broad selection tightly");
      assert(fallbackRect.top > 240, "Mouth fallback should land on the lower mouth area");
      const mouthPixels = new Uint8Array(500 * 350 * 4);
      for (let i = 0; i < mouthPixels.length; i += 4) {
        mouthPixels[i] = 245;
        mouthPixels[i + 1] = 160;
        mouthPixels[i + 2] = 60;
        mouthPixels[i + 3] = 255;
      }
      for (let y = 166; y < 202; y += 1) {
        for (let x = 168; x < 236; x += 1) {
          const offset = (y * 500 + x) * 4;
          mouthPixels[offset] = 20;
          mouthPixels[offset + 1] = 18;
          mouthPixels[offset + 2] = 14;
          mouthPixels[offset + 3] = 255;
        }
      }
      for (let y = 260; y < 292; y += 1) {
        for (let x = 280; x < 336; x += 1) {
          const dx = (x - 308) / 28;
          const dy = (y - 276) / 16;
          if ((dx * dx) + (dy * dy) > 1) continue;
          const offset = (y * 500 + x) * 4;
          mouthPixels[offset] = 190;
          mouthPixels[offset + 1] = 35;
          mouthPixels[offset + 2] = 35;
          mouthPixels[offset + 3] = 255;
        }
      }
      const detectedMouth = await detectSurgicalFeatureRectFromImage(
        "把嘴巴闭上",
        bytesToBase64(encodePngRgba(500, 350, mouthPixels)),
        { left: 10, top: 10, right: 510, bottom: 360, width: 500, height: 350 },
        { width: 1024, height: 1024 }
      );
      assert(detectedMouth && detectedMouth.left > 250 && detectedMouth.right < 385, "Mouth detector should use PNG pixels without <img> decoding");
      assert(detectedMouth.top > 240 && detectedMouth.bottom < 330, "Mouth detector should box the actual mouth pixels");
      const fallbackSourcePixels = new Uint8Array(100 * 80 * 4);
      for (let i = 0; i < fallbackSourcePixels.length; i += 4) {
        fallbackSourcePixels[i] = 238;
        fallbackSourcePixels[i + 1] = 142;
        fallbackSourcePixels[i + 2] = 34;
        fallbackSourcePixels[i + 3] = 255;
      }
      for (let y = 50; y < 62; y += 1) {
        for (let x = 52; x < 68; x += 1) {
          const offset = (y * 100 + x) * 4;
          fallbackSourcePixels[offset] = 175;
          fallbackSourcePixels[offset + 1] = 28;
          fallbackSourcePixels[offset + 2] = 32;
        }
      }
      const closedFallback = await createClosedMouthFallbackImportBase64(
        bytesToBase64(encodePngRgba(100, 80, fallbackSourcePixels)),
        await createRelativeRectMaskBase64(100, 80, { left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80 }, { left: 40, top: 40, right: 76, bottom: 70, width: 36, height: 30 }),
        { left: 40, top: 40, right: 76, bottom: 70, width: 36, height: 30 },
        { left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80 }
      );
      assert(closedFallback && closedFallback.placementRect.width === 36 && closedFallback.placementRect.height === 30, "Closed-mouth fallback should place only the edited mouth rect");
      const closedDecoded = await decodePngRgbaBase64(closedFallback.b64);
      assert(closedDecoded.width === 36 && closedDecoded.height === 30, "Closed-mouth fallback should encode a small patch, not a full-canvas PNG");
      assert(closedDecoded.rgba[3] <= 2, "Closed-mouth fallback should keep corner anchors nearly transparent");
      const fullCanvasInpaintRect = getInpaintPlacementRect(
        { left: 220, top: 180, right: 280, bottom: 240, width: 60, height: 60 },
        { width: 1000, height: 800 },
        "gpt-image-2"
      );
      assert(fullCanvasInpaintRect.left === 0 && fullCanvasInpaintRect.top === 0, "GPT image inpaint should use full-canvas context");
      assert(fullCanvasInpaintRect.width === 1000 && fullCanvasInpaintRect.height === 800, "Full-canvas inpaint context should keep document bounds");
      const comfyInpaintRect = getInpaintPlacementRect(
        { left: 220, top: 180, right: 280, bottom: 240, width: 60, height: 60 },
        { width: 1000, height: 800 },
        "comfy:basic-inpaint"
      );
      assert(comfyInpaintRect.width < 1000 && comfyInpaintRect.height < 800, "Comfy inpaint should keep bounded context");
      const fullCanvasMask = await createRectMaskBase64(1766, 1254, { left: 732, top: 555, right: 810, bottom: 652, width: 78, height: 97 });
      const fullCanvasMaskSize = getPngDimensionsFromBase64(fullCanvasMask);
      assert(fullCanvasMaskSize.width === 1766 && fullCanvasMaskSize.height === 1254, "Full-canvas mask should keep document dimensions");
      assert(estimateBase64Bytes(fullCanvasMask) < 512 * 1024, "Full-canvas mask should be compact enough for image edits");
      const outpaintMask = createOutpaintMaskBase64(5, 4, { width: 3, height: 2 }, { left: 1, top: 1, right: 1, bottom: 1 });
      const outpaintMaskDecoded = await decodePngRgbaBase64(outpaintMask);
      const outpaintAlphaAt = (x, y) => outpaintMaskDecoded.rgba[(y * outpaintMaskDecoded.width + x) * 4 + 3];
      assert(outpaintMaskDecoded.width === 5 && outpaintMaskDecoded.height === 4, "Outpaint mask should match the expanded canvas size");
      assert(outpaintAlphaAt(1, 1) === 255 && outpaintAlphaAt(3, 2) === 255, "Outpaint mask should protect the original canvas area");
      assert(outpaintAlphaAt(0, 0) === 0 && outpaintAlphaAt(4, 3) === 0, "Outpaint mask should make only the newly expanded border editable");
      const smallOutpaintPixels = new Uint8Array(4 * 2 * 4);
      for (let i = 0; i < smallOutpaintPixels.length; i += 4) {
        smallOutpaintPixels[i] = 30;
        smallOutpaintPixels[i + 1] = 60;
        smallOutpaintPixels[i + 2] = 90;
        smallOutpaintPixels[i + 3] = 255;
      }
      const normalizedOutpaint = await normalizeOutpaintResultItems([
        { b64: bytesToBase64(encodePngRgba(4, 2, smallOutpaintPixels)), format: "png" },
      ], { targetRect: { width: 8, height: 4 } });
      const normalizedOutpaintDecoded = await decodePngRgbaBase64(normalizedOutpaint[0].b64);
      assert(normalizedOutpaintDecoded.width === 8 && normalizedOutpaintDecoded.height === 4, "Outpaint result should be resized to the expanded canvas when aspect ratio matches");
      const normalizedReferenceRegion = await normalizeReferenceRegionResultItems([
        { b64: bytesToBase64(encodePngRgba(4, 2, smallOutpaintPixels)), format: "png" },
      ], { placementRect: { width: 8, height: 4 } });
      const normalizedReferenceRegionDecoded = await decodePngRgbaBase64(normalizedReferenceRegion[0].b64);
      assert(normalizedReferenceRegionDecoded.width === 8 && normalizedReferenceRegionDecoded.height === 4, "Selected reference edit results should be resized to the captured Photoshop context when aspect ratio matches");
      let rejectedOutpaintMismatch = false;
      const mismatchOutpaintPixels = new Uint8Array(4 * 3 * 4).fill(255);
      try {
        await normalizeOutpaintResultItems([
          { b64: bytesToBase64(encodePngRgba(4, 3, mismatchOutpaintPixels)), format: "png" },
        ], { targetRect: { width: 8, height: 4 } });
      } catch (error) {
        rejectedOutpaintMismatch = /比例不一致/.test(String(error?.message || error));
      }
      assert(rejectedOutpaintMismatch, "Outpaint result should fail safely when returned image aspect ratio does not match the expanded canvas");
      let rejectedReferenceMismatch = false;
      try {
        await normalizeReferenceRegionResultItems([
          { b64: bytesToBase64(encodePngRgba(4, 3, mismatchOutpaintPixels)), format: "png" },
        ], { placementRect: { width: 8, height: 4 } });
      } catch (error) {
        rejectedReferenceMismatch = /比例不一致/.test(String(error?.message || error));
      }
      assert(rejectedReferenceMismatch, "Selected reference edit results should fail safely when returned image aspect ratio cannot map back to the captured context");
      assert(!isCancelError(new Error("扩图结果尺寸 4x3 与目标画布 8x4 比例不一致，已停止导入以避免错位")), "Safety-stop placement errors must not be misclassified as user cancellation");
      const realImageItemToCanvasRgba = imageItemToCanvasRgba;
      imageItemToCanvasRgba = async () => { throw new Error("decode failed"); };
      let rejectedSplitDecodeFailure = false;
      try {
        await normalizeSemanticSplitLayerItem({ b64, format: "png" }, { width: 20, height: 20 }, "坏拆图层", 1);
      } catch (error) {
        rejectedSplitDecodeFailure = /未透明化的整张结果/.test(String(error?.message || error));
      }
      let rejectedFallbackSplitDecodeFailure = false;
      try {
        await splitGeneratedImageIntoElementItems({ b64, format: "png" }, { width: 20, height: 20 });
      } catch (error) {
        rejectedFallbackSplitDecodeFailure = /未透明化的整张结果/.test(String(error?.message || error));
      }
      imageItemToCanvasRgba = realImageItemToCanvasRgba;
      assert(rejectedSplitDecodeFailure, "Semantic split layer decode failures should fail safely instead of creating a full-canvas white-matte fallback");
      assert(rejectedFallbackSplitDecodeFailure, "Fallback split decode failures should fail safely instead of creating a full-canvas white-matte fallback");
      const splitPixels = new Uint8Array(20 * 20 * 4);
      for (let i = 0; i < splitPixels.length; i += 4) {
        splitPixels[i] = 255;
        splitPixels[i + 1] = 255;
        splitPixels[i + 2] = 255;
        splitPixels[i + 3] = 255;
      }
      for (let y = 4; y < 14; y += 1) {
        for (let x = 5; x < 16; x += 1) {
          const offset = (y * 20 + x) * 4;
          splitPixels[offset] = 120;
          splitPixels[offset + 1] = 70;
          splitPixels[offset + 2] = 24;
          splitPixels[offset + 3] = 255;
        }
      }
      const splitLayer = await normalizeSemanticSplitLayerItem({
        b64: bytesToBase64(encodePngRgba(20, 20, splitPixels)),
        format: "png",
      }, { width: 20, height: 20 }, "弓身", 1);
      assert(splitLayer && splitLayer.targetRect.width === 20 && splitLayer.placementRect.height === 20, "Semantic split layers should keep full-canvas placement bounds");
      assert(splitLayer.splitBounds.left === 5 && splitLayer.splitBounds.top === 4 && splitLayer.splitBounds.width === 11 && splitLayer.splitBounds.height === 10, "Semantic split should detect the visible element bounds without moving the layer");
      const splitLayerDecoded = await decodePngRgbaBase64(splitLayer.b64);
      assert(splitLayerDecoded.width === 20 && splitLayerDecoded.height === 20, "Semantic split output should remain full-canvas, not cropped to the element bounds");
      assert(splitLayerDecoded.rgba[3] === 0, "Semantic split white matte should become transparent before Photoshop placement");
      assert(splitLayerDecoded.rgba[((4 * 20 + 5) * 4) + 3] === 255, "Semantic split target pixels should remain opaque");
      const savedKoukoutuForSplit = requestKoukoutuCutout;
      let splitKoukoutuCalled = 0;
      requestKoukoutuCutout = async (settings, imageB64) => {
        splitKoukoutuCalled += 1;
        const decoded = await decodePngRgbaBase64(imageB64);
        const cutoutPixels = new Uint8Array(decoded.rgba);
        for (let i = 0; i < cutoutPixels.length; i += 4) {
          const white = cutoutPixels[i] > 245 && cutoutPixels[i + 1] > 245 && cutoutPixels[i + 2] > 245;
          cutoutPixels[i + 3] = white ? 0 : 255;
        }
        return {
          b64: bytesToBase64(encodePngRgba(decoded.width, decoded.height, cutoutPixels)),
          format: "png",
        };
      };
      const koukoutuSplitLayer = await normalizeSemanticSplitLayerItem({
        b64: bytesToBase64(encodePngRgba(20, 20, splitPixels)),
        format: "png",
      }, { width: 20, height: 20 }, "抠抠图弓身", 5, { koukoutuApiKey: "test-key", koukoutuFormat: "png" });
      requestKoukoutuCutout = savedKoukoutuForSplit;
      assert(splitKoukoutuCalled === 1 && koukoutuSplitLayer.koukoutuMatte, "Semantic split should use Koukoutu for white-matte transparency when configured");
      assert(koukoutuSplitLayer.importVisibleRect.left === 5 && koukoutuSplitLayer.importVisibleRect.top === 4, "Koukoutu split layers should preserve visible bounds for original-position import");
      const savedSplitUrlSendRequest = sendRequest;
      sendRequest = async () => ({
        ok: true,
        arrayBuffer: async () => base64ToArrayBuffer(bytesToBase64(encodePngRgba(20, 20, splitPixels))),
      });
      const splitUrlLayer = await normalizeSemanticSplitLayerItem({
        url: "https://example.com/split-layer.png",
        format: "png",
      }, { width: 20, height: 20 }, "URL 弓身", 2);
      sendRequest = savedSplitUrlSendRequest;
      const splitUrlLayerDecoded = await decodePngRgbaBase64(splitUrlLayer.b64);
      assert(splitUrlLayerDecoded.rgba[3] === 0 && splitUrlLayerDecoded.rgba[((4 * 20 + 5) * 4) + 3] === 255, "Semantic split URL image results should be downloaded and white-matte processed before placement");
      const sameRatioSplitPixels = new Uint8Array(10 * 5 * 4);
      for (let i = 0; i < sameRatioSplitPixels.length; i += 4) {
        sameRatioSplitPixels[i] = 255;
        sameRatioSplitPixels[i + 1] = 255;
        sameRatioSplitPixels[i + 2] = 255;
        sameRatioSplitPixels[i + 3] = 255;
      }
      for (let y = 1; y < 4; y += 1) {
        for (let x = 1; x < 9; x += 1) {
          const offset = (y * 10 + x) * 4;
          sameRatioSplitPixels[offset] = 80;
          sameRatioSplitPixels[offset + 1] = 120;
          sameRatioSplitPixels[offset + 2] = 190;
          sameRatioSplitPixels[offset + 3] = 255;
        }
      }
      const resizedSameRatioSplitLayer = await normalizeSemanticSplitLayerItem({
        b64: bytesToBase64(encodePngRgba(10, 5, sameRatioSplitPixels)),
        format: "png",
      }, { width: 20, height: 10 }, "等比例拆图", 3);
      const resizedSameRatioSplitDecoded = await decodePngRgbaBase64(resizedSameRatioSplitLayer.b64);
      assert(resizedSameRatioSplitDecoded.width === 20 && resizedSameRatioSplitDecoded.height === 10, "Semantic split may resize same-ratio full-canvas layer outputs back to Photoshop canvas size");
      let rejectedSplitCanvasMismatch = false;
      try {
        await normalizeSemanticSplitLayerItem({
          b64: bytesToBase64(encodePngRgba(10, 10, splitPixels.slice(0, 10 * 10 * 4))),
          format: "png",
        }, { width: 20, height: 10 }, "裁切错误拆图", 4);
      } catch (error) {
        rejectedSplitCanvasMismatch = /比例不一致/.test(String(error?.message || error));
      }
      assert(rejectedSplitCanvasMismatch, "Semantic split should fail safely when a cropped or square model output cannot map back to the Photoshop canvas");
      const splitLayerPrompt = buildSemanticSplitLayerPrompt({ label: "弓身", target: "弓身" }, 0, 2, { width: 20, height: 20 });
      assert(splitLayerPrompt.includes("full-canvas PNG exactly 20x20 pixels"), "Semantic split prompt should demand exact full-canvas dimensions");
      assert(splitLayerPrompt.includes("Do not crop") && splitLayerPrompt.includes("recenter"), "Semantic split prompt should forbid crop and recenter drift");
      assert(splitLayerPrompt.includes("manual PSD layer separation"), "Semantic split prompt should request careful manual-style layer separation");
      assert(splitLayerPrompt.includes("Do not include neighboring touching elements"), "Semantic split prompt should prevent merged neighboring elements");
      assert(splitLayerPrompt.includes("Koukoutu background-removal"), "Semantic split prompt should ask for white matte before Koukoutu cutout");
      assert(isTransientSemanticSplitLayerError(new Error('HTTP 502: Post "https://chatgpt.com/backend-api/codex/responses": EOF | upstream_error | invalid_request_error')), "Semantic split should retry Codex upstream 502 EOF failures");
      assert(!isTransientSemanticSplitLayerError(new Error("尺寸 10x10 与 Photoshop 画布 20x10 比例不一致")), "Semantic split should not retry deterministic canvas mismatch errors");
      const savedDecompressionStream = globalThis.DecompressionStream;
      globalThis.DecompressionStream = undefined;
      const tinyRgba = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 128]);
      const tinyDecoded = await decodePngRgbaBase64(bytesToBase64(encodePngRgba(2, 1, tinyRgba)));
      globalThis.DecompressionStream = savedDecompressionStream;
      assert(tinyDecoded.width === 2 && tinyDecoded.height === 1, "JS PNG decoder should read generated PNG dimensions");
      assert(tinyDecoded.rgba[0] === 1 && tinyDecoded.rgba[7] === 128, "JS PNG decoder should preserve RGBA pixels");
      const matteInput = new Uint8Array([
        10, 20, 30, 0,
        100, 50, 0, 128,
        2, 4, 6, 255,
        90, 80, 70, 64,
      ]);
      const matted = await matteTransparentPngBase64(bytesToBase64(encodePngRgba(2, 2, matteInput)), { r: 255, g: 255, b: 255 });
      const mattedDecoded = await decodePngRgbaBase64(matted);
      assert(mattedDecoded.rgba[0] === 255 && mattedDecoded.rgba[1] === 255 && mattedDecoded.rgba[2] === 255 && mattedDecoded.rgba[3] === 255, "Transparent screenshot pixels should be composited onto white");
      assert(mattedDecoded.rgba[4] > 175 && mattedDecoded.rgba[5] > 145 && mattedDecoded.rgba[7] === 255, "Semi-transparent screenshot pixels should be white-matted and opaque");
      const padded = await createPaddedScreenshotReferenceBase64(bytesToBase64(encodePngRgba(2, 2, mattedDecoded.rgba)));
      const paddedDecoded = await decodePngRgbaBase64(padded.b64);
      assert(paddedDecoded.width === 2 && paddedDecoded.height === 2, "Small screenshot repaint inputs should upload the selected crop itself without adding shrink-inducing white padding");
      assert(padded.crop.left === 0 && padded.crop.top === 0 && padded.crop.width === 2 && padded.crop.height === 2, "Screenshot crop metadata should map directly to the original selection");
      const tinyWidePixels = new Uint8Array(40 * 30 * 4).fill(255);
      const tinyWidePadded = await createPaddedScreenshotReferenceBase64(bytesToBase64(encodePngRgba(40, 30, tinyWidePixels)));
      const tinyWideCropped = await cropPaddedScreenshotResultBase64(tinyWidePadded.b64, tinyWidePadded.crop);
      const tinyWideCroppedDecoded = await decodePngRgbaBase64(tinyWideCropped);
      assert(tinyWideCroppedDecoded.width === 40 && tinyWideCroppedDecoded.height === 30, "Small non-square padded screenshot results should crop back only when the returned image still looks like the padded white canvas");
      const solidSquareWrongCropPixels = new Uint8Array(512 * 512 * 4);
      for (let index = 0; index < solidSquareWrongCropPixels.length; index += 4) {
        solidSquareWrongCropPixels[index] = 82;
        solidSquareWrongCropPixels[index + 1] = 120;
        solidSquareWrongCropPixels[index + 2] = 166;
        solidSquareWrongCropPixels[index + 3] = 255;
      }
      const fittedUnverifiedPaddedCrop = await cropPaddedScreenshotResultBase64(bytesToBase64(encodePngRgba(512, 512, solidSquareWrongCropPixels)), tinyWidePadded.crop);
      const fittedUnverifiedPaddedCropDecoded = await decodePngRgbaBase64(fittedUnverifiedPaddedCrop);
      assert(fittedUnverifiedPaddedCropDecoded.width === 40 && fittedUnverifiedPaddedCropDecoded.height === 30, "Small screenshot crop-back should fit square outputs to the selected crop instead of rejecting them");
      const largeScreenshotPixels = new Uint8Array(320 * 240 * 4).fill(255);
      const directReference = await createPaddedScreenshotReferenceBase64(bytesToBase64(encodePngRgba(320, 240, largeScreenshotPixels)));
      const directReferenceDecoded = await decodePngRgbaBase64(directReference.b64);
      assert(directReferenceDecoded.width === 320 && directReferenceDecoded.height === 240, "Normal-sized screenshot repaint inputs should upload the selected crop itself without white context margin");
      assert(directReferenceDecoded.width !== directReferenceDecoded.height, "Normal-sized screenshot repaint inputs should not be forced into an unrelated square canvas");
      assert(directReference.crop.left === 0 && directReference.crop.top === 0 && directReference.crop.width === 320 && directReference.crop.height === 240, "Normal screenshot reference crop metadata should record a direct selected-crop upload");
      const fittedWrongRatioDirectScreenshot = await cropPaddedScreenshotResultBase64(bytesToBase64(encodePngRgba(1024, 1024, new Uint8Array(1024 * 1024 * 4).fill(255))), directReference.crop);
      const fittedWrongRatioDirectScreenshotDecoded = await decodePngRgbaBase64(fittedWrongRatioDirectScreenshot);
      assert(fittedWrongRatioDirectScreenshotDecoded.width === 320 && fittedWrongRatioDirectScreenshotDecoded.height === 240, "Normal screenshot repaint should fit square or wrong-ratio model outputs to the selected crop instead of rejecting them");
      const wideSelectionReference = {
        canvasWidth: 1075,
        canvasHeight: 261,
        left: 0,
        top: 0,
        width: 1075,
        height: 261,
      };
      const tallReturnedPixels = new Uint8Array(1801 * 873 * 4).fill(255);
      const fittedWideSelection = await cropPaddedScreenshotResultBase64(bytesToBase64(encodePngRgba(1801, 873, tallReturnedPixels)), wideSelectionReference);
      const fittedWideSelectionDecoded = await decodePngRgbaBase64(fittedWideSelection);
      assert(fittedWideSelectionDecoded.width === 1075 && fittedWideSelectionDecoded.height === 261, "Wide selection repaint should fit mismatched returned dimensions back to the exact Photoshop selection size");
      const croppedPadded = await cropPaddedScreenshotResultBase64(padded.b64, padded.crop);
      const croppedPaddedDecoded = await decodePngRgbaBase64(croppedPadded);
      assert(croppedPaddedDecoded.width === 2 && croppedPaddedDecoded.height === 2, "Padded screenshot results should crop back to the original selection ratio");
      const alreadyCroppedScreenshotResult = bytesToBase64(encodePngRgba(2, 2, mattedDecoded.rgba));
      const keptAlreadyCropped = await cropPaddedScreenshotResultBase64(alreadyCroppedScreenshotResult, padded.crop);
      const keptAlreadyCroppedDecoded = await decodePngRgbaBase64(keptAlreadyCropped);
      assert(keptAlreadyCroppedDecoded.width === 2 && keptAlreadyCroppedDecoded.height === 2, "Already selection-sized screenshot edit results should not be cropped again");
      assert(keptAlreadyCropped === alreadyCroppedScreenshotResult, "Already-cropped screenshot edit bytes should be preserved exactly");
      const scaledAlreadyCropped = bytesToBase64(encodePngRgba(3, 3, new Uint8Array(3 * 3 * 4).fill(255)));
      const keptScaledAlreadyCropped = await cropPaddedScreenshotResultBase64(scaledAlreadyCropped, padded.crop);
      const keptScaledAlreadyCroppedDecoded = await decodePngRgbaBase64(keptScaledAlreadyCropped);
      assert(keptScaledAlreadyCroppedDecoded.width === 3 && keptScaledAlreadyCroppedDecoded.height === 3, "Near selection-sized screenshot edit results should not be cropped with padded-canvas coordinates");
      const squareSelectionOnly = new Uint8Array(640 * 640 * 4);
      for (let index = 0; index < squareSelectionOnly.length; index += 4) {
        squareSelectionOnly[index] = 72;
        squareSelectionOnly[index + 1] = 112;
        squareSelectionOnly[index + 2] = 168;
        squareSelectionOnly[index + 3] = 255;
      }
      const squareSelectionOnlyB64 = bytesToBase64(encodePngRgba(640, 640, squareSelectionOnly));
      const keptSquareSelectionOnly = await cropPaddedScreenshotResultBase64(squareSelectionOnlyB64, padded.crop);
      const keptSquareSelectionOnlyDecoded = await decodePngRgbaBase64(keptSquareSelectionOnly);
      assert(keptSquareSelectionOnlyDecoded.width === 640 && keptSquareSelectionOnlyDecoded.height === 640, "Upscaled square selection-only screenshot results should not be mistaken for a padded square canvas");
      const bowHandPixels = new Uint8Array(4 * 3 * 4);
      for (let i = 0; i < bowHandPixels.length; i += 4) {
        bowHandPixels[i] = 0;
        bowHandPixels[i + 1] = 0;
        bowHandPixels[i + 2] = 0;
        bowHandPixels[i + 3] = 0;
      }
      const paintPixel = (x, y, r, g, b, a = 255) => {
        const offset = (y * 4 + x) * 4;
        bowHandPixels[offset] = r;
        bowHandPixels[offset + 1] = g;
        bowHandPixels[offset + 2] = b;
        bowHandPixels[offset + 3] = a;
      };
      paintPixel(1, 1, 122, 75, 36, 255); // bow body
      paintPixel(2, 1, 86, 54, 27, 255); // bow string/shadow
      paintPixel(2, 2, 226, 172, 126, 220); // unwanted hand over the bow
      const savedDebugJsonFileForInpaintInput = saveDebugJsonFile;
      let debugInpaintInput = "";
      let debugInpaintMeta = null;
      exportDocumentRegionAsBase64 = async (rect, outputSize) => {
        assert(rect.left === 3 && rect.top === 4 && rect.width === 4 && rect.height === 3, "Screenshot repaint should export exactly the selected Photoshop rectangle");
        assert(outputSize === null, "Screenshot repaint should export native selection pixels before padding");
        return bytesToBase64(encodePngRgba(4, 3, bowHandPixels));
      };
      saveDebugBase64Image = async (name, image) => {
        if (name === "openai-last-inpaint-input.png") debugInpaintInput = image;
      };
      saveDebugJsonFile = async (name, data) => {
        if (name === "openai-last-inpaint-input.json") debugInpaintMeta = data;
      };
      createInpaintScreenshotInputs = realCreateInpaintScreenshotInputs;
      const bowHandInpaint = await createInpaintScreenshotInputs(
        { left: 3, top: 4, right: 7, bottom: 7, width: 4, height: 3 },
        { width: 10, height: 10 },
        "gpt-image-2"
      );
      exportDocumentRegionAsBase64 = realExportDocumentRegionAsBase64;
      saveDebugBase64Image = savedDebugBase64Image;
      saveDebugJsonFile = savedDebugJsonFileForInpaintInput;
      const bowHandReference = await decodePngRgbaBase64(bowHandInpaint.image);
      const cropOffset = (bowHandInpaint.referenceCrop.top * bowHandReference.width + bowHandInpaint.referenceCrop.left) * 4;
      const bowOffset = ((bowHandInpaint.referenceCrop.top + 1) * bowHandReference.width + bowHandInpaint.referenceCrop.left + 1) * 4;
      const handOffset = ((bowHandInpaint.referenceCrop.top + 2) * bowHandReference.width + bowHandInpaint.referenceCrop.left + 2) * 4;
      assert(bowHandInpaint.mask === null && bowHandInpaint.screenshotReferenceEdit === true, "Screenshot repaint workflow should produce a normal image reference and no API mask");
      assert(debugInpaintMeta?.workflow === "screenshot-reference-edit", "Screenshot repaint debug metadata should identify the screenshot-reference edit workflow");
      assert(debugInpaintMeta?.hasMask === false && debugInpaintMeta?.maskBytes === 0 && debugInpaintMeta?.maskFormat === null, "Screenshot repaint debug metadata should prove no API mask was attached");
      assert(debugInpaintMeta?.uploadIsNormalImage === true && debugInpaintMeta?.whiteMatted === true, "Screenshot repaint debug metadata should mark the upload as a white-matted normal image");
      assert(debugInpaintMeta?.referenceCanvasSize === "4x3", "Screenshot repaint debug metadata should record the selected crop as the uploaded white reference canvas size");
      assert(String(debugInpaintMeta?.referenceCropBox || "").includes("4x3"), "Screenshot repaint debug metadata should record the selected Photoshop crop box");
      assert(debugInpaintMeta?.sourceNonWhiteRatio > 0.1, "Screenshot repaint debug metadata should expose the original selection non-white content ratio");
      assert(debugInpaintMeta?.protectedBlankResultSafety?.enabledWhenPromptHasPreservationConstraint === true, "Screenshot repaint debug metadata should document when blank-result protection is enabled");
      assert(debugInpaintMeta?.protectedBlankResultSafety?.minimumSourceNonWhiteRatio === PROTECTED_REPAINT_MIN_SOURCE_NON_WHITE_RATIO, "Screenshot repaint debug metadata should expose the source non-white safety threshold");
      assert(debugInpaintMeta?.protectedBlankResultSafety?.minimumResultNonWhiteRatio === PROTECTED_REPAINT_MIN_RESULT_NON_WHITE_RATIO, "Screenshot repaint debug metadata should expose the result non-white safety threshold");
      assert(!JSON.stringify(debugInpaintMeta).includes(stripDataUrl(bowHandInpaint.image).slice(0, 24)), "Screenshot repaint debug metadata must not include image base64 bytes");
      assert(bowHandInpaint.referenceCrop.sourceNonWhiteRatio > 0.1, "Screenshot repaint crop metadata should record that the original protected selection has visible non-white content");
      assert(bowHandInpaint.targetRect.left === 3 && bowHandInpaint.placementRect.width === 4, "Screenshot repaint should place the result back on the exact Photoshop selection");
      assert(bowHandReference.width === 4 && bowHandReference.height === 3, "Bow/hand screenshot reference should upload the exact selected crop instead of a shrink-inducing padded square");
      assert(bowHandReference.rgba[3] === 255 && bowHandReference.rgba[0] === 255 && bowHandReference.rgba[1] === 255 && bowHandReference.rgba[2] === 255, "Transparent screenshot background should become opaque white before upload");
      assert(bowHandReference.rgba[cropOffset + 3] === 255 && bowHandReference.rgba[cropOffset] === 255, "Original transparent selection pixels should be white-matted inside the crop");
      assert(bowHandReference.rgba[bowOffset] === 122 && bowHandReference.rgba[bowOffset + 1] === 75 && bowHandReference.rgba[bowOffset + 3] === 255, "Protected bow pixels should be preserved in the uploaded screenshot reference");
      assert(bowHandReference.rgba[handOffset] > 224 && bowHandReference.rgba[handOffset + 3] === 255, "Semi-transparent hand pixels should be composited into the screenshot reference instead of becoming mask alpha");
      assert(debugInpaintInput === bowHandInpaint.image, "Screenshot repaint debug input should save the actual padded image sent to the model");
      const cupStickerPixels = new Uint8Array(5 * 4 * 4);
      for (let i = 0; i < cupStickerPixels.length; i += 4) {
        cupStickerPixels[i] = 0;
        cupStickerPixels[i + 1] = 0;
        cupStickerPixels[i + 2] = 0;
        cupStickerPixels[i + 3] = 0;
      }
      const paintCupStickerPixel = (x, y, r, g, b, a = 255) => {
        const offset = (y * 5 + x) * 4;
        cupStickerPixels[offset] = r;
        cupStickerPixels[offset + 1] = g;
        cupStickerPixels[offset + 2] = b;
        cupStickerPixels[offset + 3] = a;
      };
      paintCupStickerPixel(1, 1, 68, 148, 220, 255); // protected cup body
      paintCupStickerPixel(2, 1, 120, 190, 238, 255); // protected cup highlight
      paintCupStickerPixel(3, 2, 245, 20, 30, 230); // removable red sticker over the cup
      let genericDebugMeta = null;
      exportDocumentRegionAsBase64 = async (rect, outputSize) => {
        assert(rect.left === 20 && rect.top === 30 && rect.width === 5 && rect.height === 4, "Generic screenshot repaint should export exactly the arbitrary selected rectangle");
        assert(outputSize === null, "Generic screenshot repaint should export native selection pixels before padding");
        return bytesToBase64(encodePngRgba(5, 4, cupStickerPixels));
      };
      saveDebugBase64Image = async () => {};
      saveDebugJsonFile = async (name, data) => {
        if (name === "openai-last-inpaint-input.json") genericDebugMeta = data;
      };
      const genericStickerInpaint = await realCreateInpaintScreenshotInputs(
        { left: 20, top: 30, right: 25, bottom: 34, width: 5, height: 4 },
        { width: 48, height: 48 },
        "gpt-image-2"
      );
      exportDocumentRegionAsBase64 = realExportDocumentRegionAsBase64;
      saveDebugBase64Image = savedDebugBase64Image;
      saveDebugJsonFile = savedDebugJsonFileForInpaintInput;
      const genericStickerReference = await decodePngRgbaBase64(genericStickerInpaint.image);
      const genericCupOffset = ((genericStickerInpaint.referenceCrop.top + 1) * genericStickerReference.width + genericStickerInpaint.referenceCrop.left + 1) * 4;
      const genericStickerOffset = ((genericStickerInpaint.referenceCrop.top + 2) * genericStickerReference.width + genericStickerInpaint.referenceCrop.left + 3) * 4;
      assert(genericStickerInpaint.mask === null && genericStickerInpaint.screenshotReferenceEdit === true, "Generic sticker/cup repaint should produce a normal image reference and no API mask");
      assert(genericDebugMeta?.workflow === "screenshot-reference-edit" && genericDebugMeta?.hasMask === false, "Generic sticker/cup repaint debug metadata should prove the no-mask workflow");
      assert(genericDebugMeta?.displaySize === "5x4" && String(genericDebugMeta?.referenceCropBox || "").includes("5x4"), "Generic sticker/cup repaint debug metadata should keep arbitrary crop geometry");
      assert(genericStickerInpaint.referenceCrop.sourceNonWhiteRatio > 0.1, "Generic sticker/cup repaint should record visible protected content in the source crop");
      assert(genericStickerReference.rgba[genericCupOffset] === 68 && genericStickerReference.rgba[genericCupOffset + 1] === 148 && genericStickerReference.rgba[genericCupOffset + 3] === 255, "Generic protected cup pixels should be preserved in the uploaded screenshot reference");
      assert(genericStickerReference.rgba[genericStickerOffset] > 235 && genericStickerReference.rgba[genericStickerOffset + 1] < 90 && genericStickerReference.rgba[genericStickerOffset + 3] === 255, "Generic semi-transparent sticker pixels should upload as ordinary white-matted pixels, not mask alpha");
      assert(!JSON.stringify(genericDebugMeta).includes(stripDataUrl(genericStickerInpaint.image).slice(0, 24)), "Generic screenshot repaint debug metadata must not include image base64 bytes");
      const blankProtectedResult = bytesToBase64(encodePngRgba(4, 3, new Uint8Array(4 * 3 * 4).fill(255)));
      let refusedBlankProtectedCrop = false;
      try {
        await cropScreenshotReferenceEditItems([{ b64: blankProtectedResult, format: "png" }], bowHandInpaint.referenceCrop, { requireProtectedContent: true });
      } catch (error) {
        refusedBlankProtectedCrop = /几乎为空白/.test(String(error?.message || error));
      }
      assert(refusedBlankProtectedCrop, "Protected screenshot repaint should refuse an almost blank crop that would erase preserved content");
      const allowedBlankUnprotectedItems = await cropScreenshotReferenceEditItems([{ b64: blankProtectedResult, format: "png" }], bowHandInpaint.referenceCrop, { requireProtectedContent: false });
      const allowedBlankUnprotected = await decodePngRgbaBase64(allowedBlankUnprotectedItems[0].b64);
      assert(allowedBlankUnprotected.width === 4 && allowedBlankUnprotected.height === 3, "Unprotected screenshot repaint removals may still crop an all-white returned reference canvas");
      const normalSelectionPixels = new Uint8Array(320 * 180 * 4).fill(255);
      const normalSelectionReference = await createPaddedScreenshotReferenceBase64(bytesToBase64(encodePngRgba(320, 180, normalSelectionPixels)));
      const normalSelectionDecoded = await decodePngRgbaBase64(normalSelectionReference.b64);
      assert(normalSelectionDecoded.width === 320 && normalSelectionDecoded.height === 180, "Normal-sized screenshot repaint references should stay as a tight selected crop to avoid shrinking the subject");
      assert(normalSelectionDecoded.width !== normalSelectionDecoded.height, "Normal-sized screenshot repaint context margin must not force an unrelated square canvas");
      assert(normalSelectionReference.crop.left === 0 && normalSelectionReference.crop.top === 0, "Normal-sized screenshot repaint should not add an offset inside a larger white canvas");
      const croppedNormalSelection = await cropScreenshotReferenceEditItems([{ b64: normalSelectionReference.b64, format: "png" }], normalSelectionReference.crop);
      const croppedNormalDecoded = await decodePngRgbaBase64(croppedNormalSelection[0].b64);
      assert(croppedNormalDecoded.width === 320 && croppedNormalDecoded.height === 180, "Normal-sized screenshot repaint canvas results should crop back to the selected Photoshop rectangle");
      const footprintSourcePixels = new Uint8Array(120 * 80 * 4).fill(255);
      const fillRect = (pixels, canvasWidth, left, top, width, height, color) => {
        for (let y = top; y < top + height; y += 1) {
          for (let x = left; x < left + width; x += 1) {
            const offset = (y * canvasWidth + x) * 4;
            pixels[offset] = color[0];
            pixels[offset + 1] = color[1];
            pixels[offset + 2] = color[2];
            pixels[offset + 3] = color[3];
          }
        }
      };
      fillRect(footprintSourcePixels, 120, 20, 12, 80, 55, [88, 54, 28, 255]);
      const footprintReference = await createPaddedScreenshotReferenceBase64(bytesToBase64(encodePngRgba(120, 80, footprintSourcePixels)));
      const shiftedFootprintPixels = new Uint8Array(120 * 80 * 4).fill(255);
      fillRect(shiftedFootprintPixels, 120, 35, 20, 80, 55, [88, 54, 28, 255]);
      const shiftedFootprintItems = await cropScreenshotReferenceEditItems([
        { b64: bytesToBase64(encodePngRgba(120, 80, shiftedFootprintPixels)), format: "png" },
      ], footprintReference.crop);
      const restoredFootprint = await decodePngRgbaBase64(shiftedFootprintItems[0].b64);
      const restoredBounds = findNonWhiteRgbaBounds(restoredFootprint.rgba, restoredFootprint.width, restoredFootprint.height);
      assert(shiftedFootprintItems[0].normalizedReferenceFootprint === false, "Selection-sized repaint returns should not be source-aligned inside the PNG");
      assert(Math.abs(restoredBounds.left - 35) <= 1 && Math.abs(restoredBounds.top - 20) <= 1, "Selection-sized repaint returns should keep the model-returned internal position; Photoshop placement handles the full crop bounds");
      assert(Math.abs(restoredBounds.width - 80) <= 1 && Math.abs(restoredBounds.height - 55) <= 1, "Selection-sized repaint returns should preserve the returned subject size before Photoshop placement");
      const highResShiftedPixels = new Uint8Array(240 * 160 * 4).fill(255);
      fillRect(highResShiftedPixels, 240, 70, 40, 160, 110, [88, 54, 28, 255]);
      const normalizedHighResItems = await cropScreenshotReferenceEditItems([
        { b64: bytesToBase64(encodePngRgba(240, 160, highResShiftedPixels)), format: "png" },
      ], footprintReference.crop);
      const normalizedHighRes = await decodePngRgbaBase64(normalizedHighResItems[0].b64);
      const normalizedHighResBounds = findNonWhiteRgbaBounds(normalizedHighRes.rgba, normalizedHighRes.width, normalizedHighRes.height);
      assert(normalizedHighRes.width === 120 && normalizedHighRes.height === 80, "High-resolution same-ratio screenshot returns should be normalized back to the Photoshop selection dimensions before placement");
      assert(Math.abs(normalizedHighResBounds.left - 35) <= 1 && Math.abs(normalizedHighResBounds.top - 20) <= 1, "High-resolution same-ratio screenshot returns should only be resized, not source-aligned inside the PNG");
      assert(Math.abs(normalizedHighResBounds.width - 80) <= 1 && Math.abs(normalizedHighResBounds.height - 55) <= 1, "High-resolution same-ratio resize should preserve the returned subject size ratio");
      const grayMarginPixels = new Uint8Array(normalSelectionDecoded.rgba);
      for (let y = 0; y < normalSelectionDecoded.height; y += 1) {
        for (let x = 0; x < normalSelectionDecoded.width; x += 1) {
          if (
            x >= normalSelectionReference.crop.left &&
            x < normalSelectionReference.crop.left + normalSelectionReference.crop.width &&
            y >= normalSelectionReference.crop.top &&
            y < normalSelectionReference.crop.top + normalSelectionReference.crop.height
          ) {
            continue;
          }
          const offset = (y * normalSelectionDecoded.width + x) * 4;
          grayMarginPixels[offset] = 238;
          grayMarginPixels[offset + 1] = 238;
          grayMarginPixels[offset + 2] = 238;
          grayMarginPixels[offset + 3] = 255;
        }
      }
      const grayMarginCropped = await cropScreenshotReferenceEditItems([
        { b64: bytesToBase64(encodePngRgba(normalSelectionDecoded.width, normalSelectionDecoded.height, grayMarginPixels)), format: "png" },
      ], normalSelectionReference.crop);
      const grayMarginDecoded = await decodePngRgbaBase64(grayMarginCropped[0].b64);
      assert(grayMarginDecoded.width === 320 && grayMarginDecoded.height === 180, "Same-geometry screenshot repaint results should crop back even when the model slightly changes the white margin");
      const croppedBowHandItems = await cropScreenshotReferenceEditItems([{ b64: bowHandInpaint.image, format: "png" }], bowHandInpaint.referenceCrop);
      const croppedBowHand = await decodePngRgbaBase64(croppedBowHandItems[0].b64);
      assert(croppedBowHand.width === 4 && croppedBowHand.height === 3, "Screenshot repaint result should crop back to the selected Photoshop rectangle before placement");
      assert(croppedBowHandItems[0].importB64 === croppedBowHandItems[0].b64, "Cropped screenshot repaint import should match the preview bytes");
      const alreadySelectionSizedBowResult = bytesToBase64(encodePngRgba(4, 3, bowHandPixels));
      const keptBowHandItems = await cropScreenshotReferenceEditItems([{ b64: alreadySelectionSizedBowResult, format: "png" }], bowHandInpaint.referenceCrop);
      const keptBowHand = await decodePngRgbaBase64(keptBowHandItems[0].b64);
      assert(keptBowHand.width === 4 && keptBowHand.height === 3, "Selection-sized model screenshot results should import at the exact selected rectangle size");
      assert(keptBowHand.rgba[3] === 255 && keptBowHand.rgba[0] === 255, "Selection-sized model screenshot results should be white-matted so Photoshop keeps the full selected canvas bounds");
      const upscaledSelectionPixels = new Uint8Array(8 * 6 * 4).fill(255);
      const upscaledSelectionSizedBowResult = bytesToBase64(encodePngRgba(8, 6, upscaledSelectionPixels));
      const keptUpscaledBowItems = await cropScreenshotReferenceEditItems([{ b64: upscaledSelectionSizedBowResult, format: "png" }], bowHandInpaint.referenceCrop);
      const keptUpscaledBow = await decodePngRgbaBase64(keptUpscaledBowItems[0].b64);
      assert(keptUpscaledBow.width === 4 && keptUpscaledBow.height === 3, "Upscaled selection-only screenshot results should be resized to the selected rectangle before Photoshop placement");
      assert(keptUpscaledBowItems[0].normalizedReferenceFootprint === true, "Upscaled selection-only screenshot results should mark size normalization for auditability");
      const savedScreenshotUrlSendRequest = sendRequest;
      let downloadedScreenshotUrl = "";
      sendRequest = async (url, requestOptions) => {
        downloadedScreenshotUrl = String(url);
        assert(requestOptions?.responseType === "arraybuffer", "Screenshot repaint URL crop-back should download result bytes instead of loading the remote URL directly");
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => base64ToArrayBuffer(bowHandInpaint.image),
        };
      };
      const downloadedUrlScreenshotItems = await cropScreenshotReferenceEditItems([{ url: "https://example.com/padded-result.png", format: "webp" }], bowHandInpaint.referenceCrop);
      sendRequest = savedScreenshotUrlSendRequest;
      const downloadedUrlScreenshot = await decodePngRgbaBase64(downloadedUrlScreenshotItems[0].b64);
      assert(downloadedScreenshotUrl === "https://example.com/padded-result.png", "Screenshot repaint URL crop-back should request the returned image URL");
      assert(downloadedUrlScreenshot.width === 4 && downloadedUrlScreenshot.height === 3, "Downloaded screenshot repaint URL results should crop back to the Photoshop selection");
      assert(downloadedUrlScreenshotItems[0].url === null && downloadedUrlScreenshotItems[0].format === "png", "Downloaded screenshot repaint URL results should become PNG import bytes after crop-back");
      const realNormalizeImageItemToPngBase64 = normalizeImageItemToPngBase64;
      normalizeImageItemToPngBase64 = async (item) => {
        assert(item.url === "https://example.com/padded-result.webp", "URL screenshot repaint results should be normalized before crop-back");
        return bowHandInpaint.image;
      };
      const croppedUrlScreenshotItems = await cropScreenshotReferenceEditItems([{ url: "https://example.com/padded-result.webp", format: "webp" }], bowHandInpaint.referenceCrop);
      normalizeImageItemToPngBase64 = realNormalizeImageItemToPngBase64;
      const croppedUrlScreenshot = await decodePngRgbaBase64(croppedUrlScreenshotItems[0].b64);
      assert(croppedUrlScreenshot.width === 4 && croppedUrlScreenshot.height === 3, "URL/WebP screenshot repaint results should crop back before Photoshop placement");
      assert(croppedUrlScreenshotItems[0].url === null && croppedUrlScreenshotItems[0].format === "png", "Cropped URL screenshot repaint results should import as PNG bytes, not as the full remote image");
      normalizeImageItemToPngBase64 = async () => { throw new Error("decode failed"); };
      let refusedUnsafeScreenshotPlacement = false;
      try {
        await cropScreenshotReferenceEditItems([{ url: "https://example.com/bad-result.webp", format: "webp" }], bowHandInpaint.referenceCrop);
      } catch (error) {
        refusedUnsafeScreenshotPlacement = /避免把整张未裁切图片错误放回/.test(String(error?.message || error));
      }
      normalizeImageItemToPngBase64 = realNormalizeImageItemToPngBase64;
      assert(refusedUnsafeScreenshotPlacement, "Screenshot repaint should fail safely when crop-back cannot produce a selection-sized PNG");
      const mockedCreateReferenceRegionInputs = createReferenceRegionInputs;
      let debugReferenceRegion = "";
      exportDocumentRegionAsBase64 = async (rect, outputSize) => {
        assert(rect.left === 3 && rect.top === 4 && rect.right === 7 && rect.bottom === 7 && rect.width === 4 && rect.height === 3, "Reference edit should export exactly the selected crop, not the full document context");
        assert(outputSize === null, "Reference edit should export native pixels before white-matting");
        return bytesToBase64(encodePngRgba(4, 3, bowHandPixels));
      };
      saveDebugBase64Image = async (name, image) => {
        if (name === "openai-last-reference-region.png") debugReferenceRegion = image;
      };
      createReferenceRegionInputs = realCreateReferenceRegionInputs;
      const bowHandReferenceEdit = await createReferenceRegionInputs(
        { left: 3, top: 4, right: 7, bottom: 7, width: 4, height: 3 },
        { width: 10, height: 10 },
        "gpt-image-2"
      );
      createReferenceRegionInputs = mockedCreateReferenceRegionInputs;
      exportDocumentRegionAsBase64 = realExportDocumentRegionAsBase64;
      saveDebugBase64Image = savedDebugBase64Image;
      const selectedReferenceEdit = await decodePngRgbaBase64(bowHandReferenceEdit.image);
      const selectedTransparentOffset = 0;
      const selectedBowOffset = (1 * 4 + 1) * 4;
      const selectedHandOffset = (2 * 4 + 2) * 4;
      assert(selectedReferenceEdit.width === 4 && selectedReferenceEdit.height === 3, "Reference edit upload should keep the selected region dimensions");
      assert(selectedReferenceEdit.rgba[selectedTransparentOffset] === 255 && selectedReferenceEdit.rgba[selectedTransparentOffset + 3] === 255, "Reference edit transparent pixels should upload as opaque white, not mask-like alpha");
      assert(selectedReferenceEdit.rgba[selectedBowOffset] === 122 && selectedReferenceEdit.rgba[selectedBowOffset + 3] === 255, "Reference edit should preserve opaque subject pixels after white-matting");
      assert(selectedReferenceEdit.rgba[selectedHandOffset] > 224 && selectedReferenceEdit.rgba[selectedHandOffset + 3] === 255, "Reference edit semi-transparent occluders should upload as normal composited pixels");
      assert(debugReferenceRegion === bowHandReferenceEdit.image, "Reference edit debug input should save the actual white-matted image sent to the model");
      createInpaintScreenshotInputs = async () => ({
        image: b64,
        mask: null,
        apiSize: "auto",
        displaySize: "40x30",
        targetRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        placementRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        referenceCrop: { canvasWidth: 512, canvasHeight: 512, left: 236, top: 241, width: 40, height: 30 },
      });
      await closeDiagnosticDocument({ _id: 98765 });
      assert(calls.some((call) => call[0] === "batchPlay" && call[1] === "close" && call[2] === 98765 && call[3] === "no"), "Offline diagnostics should close temporary docs by document id when closeWithoutSaving is unavailable");
      const visiblePixels = new Uint8Array(10 * 8 * 4);
      for (let y = 3; y < 6; y += 1) {
        for (let x = 2; x < 7; x += 1) {
          visiblePixels[(y * 10 + x) * 4 + 3] = 255;
        }
      }
      const visibleRect = await getImportVisibleDocumentRect(
        bytesToBase64(encodePngRgba(10, 8, visiblePixels)),
        { left: 100, top: 200, right: 1100, bottom: 1000, width: 1000, height: 800 }
      );
      assert(visibleRect.left === 300 && visibleRect.top === 500, "Visible import rect should preserve document-space position");
      assert(visibleRect.width === 500 && visibleRect.height === 300, "Visible import rect should preserve document-space size");
      const embeddedMask = createEmbeddedSelectionMaskBase64(
        6,
        5,
        { left: 0, top: 0, right: 6, bottom: 5, width: 6, height: 5 },
        { left: 2, top: 1, right: 5, bottom: 3, width: 3, height: 2 },
        3,
        2,
        new Uint8Array([255, 0, 255, 0, 0, 255]),
        1
      );
      const embeddedDecoded = await decodePngRgbaBase64(embeddedMask);
      assert(embeddedDecoded.rgba[((1 * 6 + 2) * 4) + 3] === 0, "Embedded selection mask should make selected pixel editable");
      assert(embeddedDecoded.rgba[((1 * 6 + 3) * 4) + 3] === 255, "Embedded selection mask should keep unselected in-bounds pixel protected");
      assert(embeddedDecoded.rgba[((0 * 6 + 2) * 4) + 3] === 255, "Embedded selection mask should keep outside bbox protected");
      const offlineStubDiagnostics = await withOfflineDiagnosticStubs(async (diagnostics) => {
        state.mode = "reference";
        await requestEdits(getSettings(), "reference smoke", b64, null, { size: "auto", screenshotReferenceEdit: true });
        state.mode = "inpaint";
        await requestEdits(getSettings(), "inpaint smoke", b64, null, { size: "auto", screenshotReferenceEdit: true });
        state.mode = "outpaint";
        await requestEdits(getSettings(), "outpaint smoke", b64, b64, { size: "auto" });
        return diagnostics;
      });
      assert(offlineStubDiagnostics.editCalls.some((call) => call.mode === "reference" && !call.hasMask && call.screenshotReferenceEdit), "Offline diagnostics should record selected reference as no-mask normal-upload edit");
      assert(offlineStubDiagnostics.editCalls.some((call) => call.mode === "inpaint" && !call.hasMask && call.screenshotReferenceEdit), "Offline diagnostics should record screenshot repaint as no-mask normal-upload edit");
      assert(offlineStubDiagnostics.editCalls.some((call) => call.mode === "outpaint" && call.hasMask && !call.screenshotReferenceEdit), "Offline diagnostics should still distinguish masked outpaint edits");

      const screenshotPrompt = buildImageEditPrompt("把弓上面的手去掉，其他不要变", "inpaintScreenshot");
      assert(screenshotPrompt.includes("普通上传图片"), "Selection repaint should describe a normal uploaded image reference");
      assert(screenshotPrompt.includes("不按蒙版理解"), "Selection repaint prompt should not use mask semantics");
      assert(screenshotPrompt.includes("不要裁切、放大、缩小、旋转或重新居中主体"), "Selection repaint prompt should protect crop framing");
      assert(screenshotPrompt.includes("完整可见形状"), "Selection repaint should use generic complete-target removal guidance");
      assert(screenshotPrompt.includes("complete visible shape"), "Selection repaint should include generic English complete-target guidance");
      assert(screenshotPrompt.includes("把弓上面的手去掉，其他不要变"), "Selection repaint should preserve the user's prompt verbatim");
      assert(!screenshotPrompt.includes("手、爪子、胳膊或手指"), "Selection repaint guidance must not depend on hand/paw-specific prompt hacks");
      assert(!screenshotPrompt.includes("弓、道具、主体或背景的一部分"), "Selection repaint guidance must not bake in bow-specific protection wording");
      assert(!screenshotPrompt.includes("弓箭/武器弓"), "Selection repaint should not silently rewrite ambiguous user wording");
      assert(!screenshotPrompt.includes("2D game-icon style"), "Selection repaint prompt should not force a fixed art style");
      const genericScreenshotPrompt = buildImageEditPrompt("把中间的红色贴纸去掉，水杯保持不变", "inpaintScreenshot");
      assert(genericScreenshotPrompt.includes("把中间的红色贴纸去掉，水杯保持不变"), "Generic selection repaint should preserve non-hand/non-bow user prompts verbatim");
      assert(genericScreenshotPrompt.includes("完整可见形状") && genericScreenshotPrompt.includes("complete visible shape"), "Generic selection repaint should use complete-target rules for arbitrary objects");
      assert(genericScreenshotPrompt.includes("保护参考") && genericScreenshotPrompt.includes("protected reference content"), "Generic selection repaint should protect arbitrary unchanged objects");
      assert(!genericScreenshotPrompt.includes("把弓上面的手去掉"), "Generic selection repaint prompt must not reuse the bow/hand regression prompt");

      const savedRenderResultsForMaterializedUrl = renderResults;
      const savedPrepareCroppedPreviewsForMaterializedUrl = prepareCroppedPreviews;
      const savedSaveHistoryItemForMaterializedUrl = saveHistoryItem;
      const savedRequestGenerationsForMaterializedUrl = requestGenerations;
      let materializedPreviewPasses = 0;
      let materializedRenderPasses = 0;
      renderResults = () => { materializedRenderPasses += 1; };
      prepareCroppedPreviews = async (items) => {
        materializedPreviewPasses += 1;
        if (materializedPreviewPasses === 2) {
          assert(items?.[0]?.b64 === b64 && !items?.[0]?.url, "Second preview preparation should see the materialized local bytes, not the stale URL");
        }
      };
      saveHistoryItem = async (item) => {
        item.b64 = b64;
        item.url = null;
        item.format = "png";
        return true;
      };
      requestGenerations = async () => [{ url: "https://example.com/short-lived-preview.png", format: "png" }];
      state.mode = "generate";
      $("promptInput").value = "url-only preview materialization";
      $("negativePromptInput").value = "";
      await runGeneration();
      renderResults = savedRenderResultsForMaterializedUrl;
      prepareCroppedPreviews = savedPrepareCroppedPreviewsForMaterializedUrl;
      saveHistoryItem = savedSaveHistoryItemForMaterializedUrl;
      requestGenerations = savedRequestGenerationsForMaterializedUrl;
      assert(materializedPreviewPasses === 2, "URL-only result materialization should run cropped-preview preparation again after history save");
      assert(materializedRenderPasses >= 2, "URL-only result materialization should re-render result cards after local bytes are available");

      const importBytesB64 = bytesToBase64(encodePngRgba(3, 3, new Uint8Array(36).fill(128)));
      const stalePreviewItem = {
        id: "history-stale-preview",
        b64,
        importB64: importBytesB64,
        prompt: "stale preview cache",
        mode: "generate",
        model: "gpt-image-2",
        size: "auto",
        quality: "auto",
        format: "png",
        previewB64: b64,
        previewBounds: { left: 0, top: 0, right: 2, bottom: 2, width: 2, height: 2 },
        previewUrl: "blob:stale-preview",
        previewUrlKey: "old-source",
        createdAt: new Date().toISOString(),
      };
      const stalePreviewMaterialized = await realSaveHistoryItem(stalePreviewItem);
      assert(stalePreviewMaterialized, "History save should report materialization when import bytes replace preview bytes");
      assert(stalePreviewItem.b64 === importBytesB64 && stalePreviewItem.importB64 === importBytesB64, "History materialization should align current result bytes with saved import bytes");
      assert(stalePreviewItem.previewB64 === null && stalePreviewItem.previewBounds === null, "History materialization should drop stale cropped preview data");
      assert(stalePreviewItem.previewUrl === null && stalePreviewItem.previewUrlKey === null, "History materialization should drop stale Blob preview cache");

      for (const mode of ["generate", "reference", "inpaint", "outpaint", "cutout", "split"]) {
        state.mode = mode;
        $("promptInput").value = mode === "cutout" || mode === "split" ? "" : "test prompt";
        $("negativePromptInput").value = "";
        await runGeneration();
        assert(state.results[0].mode === mode, mode + " stamped mode");
        if (mode === "reference") {
          const referenceResult = await decodePngRgbaBase64(state.results[0].b64);
          assert(referenceResult.width === 60 && referenceResult.height === 60, "Selected reference run should normalize returned image bytes to the captured placement context");
          assert(state.results[0].placementMode === "full-region-patch", "Selected reference run should mark results as full-region placement patches");
          assert(state.results[0].normalizedPlacementSize === true, "Selected reference run should preserve placement normalization metadata on the result card");
        }
        if (mode === "outpaint") {
          assert(state.results[0].normalizedPlacementSize === true, "Outpaint run should preserve placement normalization metadata on the result card");
        }
      }
      currentSelection = null;
      state.mode = "reference";
      $("promptInput").value = "full canvas reference prompt";
      $("negativePromptInput").value = "";
      await runGeneration();
      const fullReferenceResult = await decodePngRgbaBase64(state.results[0].b64);
      assert(fullReferenceResult.width === 100 && fullReferenceResult.height === 80, "Full-canvas reference run should normalize returned image bytes to the current document size");
      assert(state.results[0].placementMode === "full-region-patch", "Full-canvas reference run should mark results as full-region placement patches");
      assert(state.results[0].placementRect.width === 100 && state.results[0].placementRect.height === 80, "Full-canvas reference run should preserve the original document placement rect");
      assert(state.results[0].normalizedPlacementSize === true, "Full-canvas reference run should preserve placement normalization metadata on the result card");
      currentSelection = { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 };

      assert(calls.some((call) => call[0] === "generate"), "generate branch");
      assert(calls.some((call) => call[0] === "edit" && call[1] === "reference" && call[2] === false && call[3] === true), "selected reference edit branch should use the no-mask normal-upload Responses path");
      assert(calls.some((call) => call[0] === "edit" && call[1] === "inpaint" && call[2] === false && call[3] === true), "inpaint screenshot-reference branch should call image edits without a mask");
      assert(calls.some((call) => call[0] === "edit" && call[1] === "inpaint" && call[4] === "test prompt"), "inpaint screenshot-reference branch should pass the user's prompt directly");
      assert(calls.some((call) => call[0] === "place" && call[1] === "inpaint" && call[3] === 40 && call[4] === "direct-selection-patch" && call[5] === null && call[6] === true && call[7] === false && call[8] === false && call[9] === false && call[10] === false && call[11] === false && call[12] === true && call[13] === false), "inpaint should place the screenshot result by full image size over the selected rectangle without Photoshop post-import mask action");
      assert(calls.some((call) => call[0] === "edit" && call[1] === "outpaint" && call[2] === true), "outpaint edit branch");
      assert(calls.some((call) => call[0] === "cutout"), "cutout branch");
      assert(calls.some((call) => call[0] === "split"), "split branch");
      assert(calls.some((call) => call[0] === "expand" && call[2] === 120), "outpaint expand");
      assert(calls.some((call) => call[0] === "place" && call[1] === "outpaint" && call[3] === 120), "outpaint place");
      return {
        version: PLUGIN_VERSION,
        modes: {
          generate: calls.some((call) => call[0] === "generate"),
          reference: calls.some((call) => call[0] === "edit" && call[1] === "reference"),
          inpaint: calls.some((call) => call[0] === "edit" && call[1] === "inpaint"),
          outpaint: calls.some((call) => call[0] === "edit" && call[1] === "outpaint"),
          cutout: calls.some((call) => call[0] === "cutout"),
          split: calls.some((call) => call[0] === "split"),
        },
        invariants: {
          noMaskReference: calls.some((call) => call[0] === "edit" && call[1] === "reference" && call[2] === false && call[3] === true),
          noMaskInpaint: calls.some((call) => call[0] === "edit" && call[1] === "inpaint" && call[2] === false && call[3] === true),
          directSelectionPatch: calls.some((call) => call[0] === "place" && call[1] === "inpaint" && call[4] === "direct-selection-patch"),
          maskedOutpaint: calls.some((call) => call[0] === "edit" && call[1] === "outpaint" && call[2] === true),
          outpaintCanvasExpand: calls.some((call) => call[0] === "expand" && call[2] === 120),
          cutoutOriginalSize: calls.some((call) => call[0] === "cutout" && call[1] === call[3] && call[2] === call[4] && call[3] > 0 && call[4] > 0),
          splitFullCanvas: calls.some((call) => call[0] === "split" && call[1] === call[3] && call[2] === call[4] && call[3] === 100 && call[4] === 80),
        },
      };
    })();
  `, context, { filename: "smoke-plugin.vm.js" });
  if (smokePromise && typeof smokePromise.then === "function") {
    return await smokePromise;
  }
  return null;
}

async function main() {
  checkManifest();
  checkRuntimeCopiesSynced();
  checkUiBindings();
  checkSmokeCommandCompatibility();
  checkRuntimeReloadScript();
  checkPhotoshopMoveUnavailableGuard();
  checkSelectionRepaintCopy();
  const coverage = await runVmSmoke();
  const modeNames = ["generate", "reference", "inpaint", "outpaint", "cutout", "split"];
  assert(coverage && modeNames.every((mode) => coverage.modes?.[mode]), "Smoke coverage matrix is missing one or more major modes");
  assert(Object.values(coverage.invariants || {}).every(Boolean), "Smoke coverage matrix is missing a critical placement or routing invariant");
  const modes = modeNames.map((mode) => `${mode}=ok`).join(" ");
  const invariants = Object.entries(coverage.invariants).map(([key]) => `${key}=ok`).join(" ");
  console.log(`PLUGIN_SMOKE_MATRIX version=${coverage.version} ${modes} ${invariants}`);
  console.log("PLUGIN_SMOKE_OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
