#!/usr/bin/env node

const fs = require("fs");
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
  assert(manifest.id === "com.local.openai.photoshop.generator", "Unexpected plugin id");
assert(manifest.version === "0.1.151", "Unexpected manifest version");
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

function checkUiBindings() {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const refs = [...appJs.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
  const missing = [...new Set(refs.filter((id) => !ids.includes(id)))];
  assert(!missing.length, `Missing HTML elements referenced by app.js: ${missing.join(", ")}`);
}

function checkPhotoshopMoveUnavailableGuard() {
  assert(!/_obj:\s*["']move["']/.test(appJs), "Do not call Photoshop move command; it can be unavailable in modal placement");
  assert(appJs.includes("selectFrontLayerForPlacementInModal"), "Inpaint placement should select the front layer before placeEvent");
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
  vm.runInContext(`${appJs}
    (async () => {
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const calls = [];
      const b64 = bytesToBase64(encodePngRgba(2, 2, new Uint8Array(16).fill(255)));

      for (const id of [
        "baseUrlInput", "apiKeyInput", "modelInput", "generationPathInput", "editPathInput",
        "sizeInput", "countInput", "formatInput", "qualityInput", "koukoutuApiKeyInput",
        "koukoutuFormatInput", "koukoutuBorderInput", "promptInput", "negativePromptInput",
        "comfyUrlInput"
      ]) {
        $(id).value = "";
      }

      $("baseUrlInput").value = "http://127.0.0.1:51866/v1";
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
        ]);
      };
      expandCanvasForOutpaint = async (padding, rect) => calls.push(["expand", padding && padding.left, rect && rect.width]);
      getSelectionInfo = async () => ({ left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 });
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
        image: b64,
        displaySize: "40x30",
        targetRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
        placementRect: { left: 10, top: 12, right: 50, bottom: 42, width: 40, height: 30 },
      });
      resolveSemanticInpaintSelection = async (settings, prompt, selection) => selection;
      resolveSemanticSplitTargets = async () => [{ label: "角色", target: "角色" }];
      compositeItemsWithOriginalMask = async (items) => items;
      requestGenerations = async () => { calls.push(["generate"]); return [{ b64, format: "png" }]; };
      requestEdits = async (settings, prompt, image, mask) => {
        calls.push(["edit", state.mode, Boolean(mask)]);
        return [{ b64, format: "png" }];
      };
      requestKoukoutuCutout = async () => { calls.push(["cutout"]); return { b64, format: "png" }; };
      requestSemanticSplitLayers = async () => {
        calls.push(["split"]);
        return [{
          b64,
          format: "png",
          splitIndex: 1,
          splitLabel: "角色",
          targetRect: { left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80 },
          placementRect: { left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80 },
        }];
      };

      const explicit = buildExplicitSemanticSplitTargets("角色");
      assert(explicit.length === 1 && explicit[0].target === "角色", "Single split target should be accepted");
      assert(DEFAULT_BASE_URL === "http://127.0.0.1:51866/v1", "Default Base URL should match Cockpit API service");
      assert(normalizeBaseUrl("http://127.0.0.1:49456/v1") === "http://127.0.0.1:51866/v1", "Legacy 49456 Base URL should migrate");
      assert(normalizeBaseUrl("http://localhost:9456/v1/images/edits") === "http://127.0.0.1:51866/v1", "Legacy 9456 image URL should migrate");
      assert(shouldUseSidecarImageEndpointsFirst(getSettings(), true), "Codex sidecar should prefer OpenAI-compatible image endpoints");
      assert(shouldPreserveUserInpaintSelection(getSettings()), "Sidecar inpaint should preserve the full user-drawn selection");
      assert(!shouldUseChatGptStyleResponsesEdit(getSettings(), true), "Codex sidecar masked edits should use /images/edits before direct Responses");
      assert(shouldUseChatGptStyleResponsesEdit({ ...getSettings(), baseUrl: "https://example.com/v1" }, true), "Non-sidecar masked edits should still allow direct Responses first");
      assert(shouldUseSemanticInpaintSelection("把嘴巴闭上，其他部分完全不动"), "Mouth inpaint should still be recognized as a semantic target");
      assert(shouldUseSemanticInpaintSelection("把这一缕头发改成黑色的"), "Hair strand inpaint should still be recognized as a semantic target");
      const responsesPrompt = buildResponsesImageEditPrompt("把嘴巴闭上", true, { size: "auto" });
      assert(/input_image_mask/.test(responsesPrompt) && /transparent pixels/.test(responsesPrompt), "Responses edit prompt should use ChatGPT-style mask semantics");
      assert(/non-transparent pixels are protected/.test(responsesPrompt), "Responses edit prompt should protect non-transparent mask pixels");
      let rejectedBadImport = false;
      try {
        await resultToArrayBuffer({ importB64: Promise.resolve(b64), b64 }, true);
      } catch (error) {
        rejectedBadImport = /base64/.test(String(error && error.message));
      }
      assert(rejectedBadImport, "Import base64 must reject non-string data before Photoshop placement");
      let rejectedBadPng = false;
      try {
        getValidatedImageSize(new Uint8Array([1, 2, 3, 4]).buffer, "png");
      } catch (error) {
        rejectedBadPng = /PNG/.test(String(error && error.message));
      }
      assert(rejectedBadPng, "PNG placement must validate image bytes before Photoshop placement");
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
      const savedDecompressionStream = globalThis.DecompressionStream;
      globalThis.DecompressionStream = undefined;
      const tinyRgba = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 128]);
      const tinyDecoded = await decodePngRgbaBase64(bytesToBase64(encodePngRgba(2, 1, tinyRgba)));
      globalThis.DecompressionStream = savedDecompressionStream;
      assert(tinyDecoded.width === 2 && tinyDecoded.height === 1, "JS PNG decoder should read generated PNG dimensions");
      assert(tinyDecoded.rgba[0] === 1 && tinyDecoded.rgba[7] === 128, "JS PNG decoder should preserve RGBA pixels");
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

      for (const mode of ["generate", "reference", "inpaint", "outpaint", "cutout", "split"]) {
        state.mode = mode;
        $("promptInput").value = mode === "cutout" || mode === "split" ? "" : "test prompt";
        await runGeneration();
        assert(state.results[0].mode === mode, mode + " stamped mode");
      }

      assert(calls.some((call) => call[0] === "generate"), "generate branch");
      assert(calls.some((call) => call[0] === "edit" && call[1] === "reference" && call[2] === false), "reference edit branch");
      assert(calls.some((call) => call[0] === "edit" && call[1] === "inpaint" && call[2] === true), "inpaint edit branch");
      assert(calls.some((call) => call[0] === "place" && call[1] === "inpaint" && call[3] === 60 && call[4] === "selection-mask-layer" && call[5] === null && call[6] === true && call[7] === false && call[8] === false && call[9] === false && call[10] === false && call[11] === true && call[12] === true && call[13] === true), "inpaint should place pre-clipped full context on top with visible-rect alignment and no Photoshop post-import mask action");
      assert(calls.some((call) => call[0] === "edit" && call[1] === "outpaint" && call[2] === true), "outpaint edit branch");
      assert(calls.some((call) => call[0] === "cutout"), "cutout branch");
      assert(calls.some((call) => call[0] === "split"), "split branch");
      assert(calls.some((call) => call[0] === "expand" && call[2] === 120), "outpaint expand");
      assert(calls.some((call) => call[0] === "place" && call[1] === "outpaint" && call[3] === 120), "outpaint place");
    })();
  `, context, { filename: "smoke-plugin.vm.js" });
}

async function main() {
  checkManifest();
  checkUiBindings();
  checkPhotoshopMoveUnavailableGuard();
  await runVmSmoke();
  console.log("PLUGIN_SMOKE_OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
