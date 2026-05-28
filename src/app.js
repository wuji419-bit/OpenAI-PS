const photoshop = require("photoshop");
const { entrypoints, pluginManager, storage } = require("uxp");

const app = photoshop.app;
const action = photoshop.action;
const core = photoshop.core;
const imaging = photoshop.imaging;
const constants = photoshop.constants || {};
const fs = storage.localFileSystem;
const PLUGIN_ID = "com.local.openai.photoshop.generator";
const PLUGIN_VERSION = "0.1.152";

entrypoints.setup({
  panels: {
    openaiPanel: {
      show() {
        console.log("[OpenAI Photoshop Generator] openaiPanel show");
      },
      hide() {
        console.log("[OpenAI Photoshop Generator] openaiPanel hide");
      },
    },
  },
  commands: {
    openaiOpenPanel: {
      async run() {
        console.log("[OpenAI Photoshop Generator] openaiOpenPanel command");
        await showOpenAiPanel();
      },
    },
    openaiRunSmoke: {
      async run() {
        console.log("[OpenAI Photoshop Generator] openaiRunSmoke command");
        await runSixModeSmoke();
      },
    },
    openaiRunSplitSmoke: {
      async run() {
        console.log("[OpenAI Photoshop Generator] openaiRunSplitSmoke command");
        await runModeSmoke("split", "头发");
      },
    },
    openaiRunMouthInpaintSmoke: {
      async run() {
        console.log("[OpenAI Photoshop Generator] openaiRunMouthInpaintSmoke command");
        await runMouthInpaintSmoke();
      },
    },
    openaiImportApiKeyFromClipboard: {
      async run() {
        console.log("[OpenAI Photoshop Generator] openaiImportApiKeyFromClipboard command");
        await importApiKeyFromClipboard();
      },
    },
  },
});

async function showOpenAiPanel() {
  const panelId = "openaiPanel";
  try {
    const plugins = [];
    const directPlugin = pluginManager?.getPlugin?.(PLUGIN_ID);
    if (directPlugin) plugins.push(directPlugin);
    if (pluginManager?.plugins) {
      plugins.push(...Array.from(pluginManager.plugins).filter((plugin) => plugin?.id === PLUGIN_ID));
    }

    for (const plugin of plugins) {
      if (plugin && typeof plugin.showPanel === "function") {
        await plugin.showPanel(panelId);
        console.log("[OpenAI Photoshop Generator] showPanel via plugin object");
        return true;
      }
    }

    if (pluginManager && typeof pluginManager.showPanel === "function") {
      await pluginManager.showPanel(panelId);
      console.log("[OpenAI Photoshop Generator] showPanel via pluginManager");
      return true;
    }
  } catch (error) {
    console.warn("[OpenAI Photoshop Generator] show panel failed", error);
  }

  return false;
}

const HISTORY_KEY = "openaiPhotoshop.history.v1";
const SETTINGS_KEY = "openaiPhotoshop.settings.v1";
const PROMPT_DRAFT_KEY = "openaiPhotoshop.promptDrafts.v1";
const DEFAULT_BASE_URL = "http://127.0.0.1:51866/v1";
const DEFAULT_COMFY_URL = "http://192.168.1.128:8188";
const KOUKOUTU_SYNC_URL = "https://sync.koukoutu.com/v1/create";
const DEFAULT_CUTOUT_ANALYSIS_MODEL = "gpt-5.4-mini";
const DEFAULT_SEMANTIC_EDIT_MODEL = "gpt-5.4-mini";
const COMFY_INPAINT_MAX_PIXELS = 1600 * 1600;
const COMFY_INPAINT_MAX_EDGE = 1600;
const OPENAI_INPAINT_FULL_CANVAS_MAX_PIXELS = 3840 * 2160;
const TEMP_SELECTION_CHANNEL_PREFIX = "__openai_inpaint_selection_";
const MAX_BATCH_COUNT = 10;
const MAX_SPLIT_LAYERS = 40;
const SPLIT_ALPHA_THRESHOLD = 18;
const MAX_SEMANTIC_SPLIT_TARGETS = 10;
const SMOKE_REQUEST_TIMEOUT_MS = 180000;
const DEFAULT_SEMANTIC_SPLIT_TARGETS = [
  { label: "底框/背景", target: "the complete clean base frame, outer border, panel shell, and background surface only; remove foreground icons/text/buttons and reconstruct the covered surface texture with no holes" },
  { label: "填充条", target: "the inner colored progress fill bar only, such as the red health/energy fill, including its highlights but excluding the frame" },
  { label: "顶部徽章", target: "the top badge, plate, icon, bone label, decorative emblem, or attached label shape only, excluding any text on it" },
  { label: "文字数字", target: "all visible text, numbers, letters, counters, labels, and glyphs only, excluding the plate or badge behind them" },
  { label: "装饰高光", target: "small decorative highlights, sparkles, shine strokes, glows, and accents only if they are visually separate from the main frame and fill" },
];
const COMFY_WORKFLOWS = {
  "comfy:basic-inpaint": {
    label: "ComfyUI Basic Inpaint",
    file: "codex_basic_inpaint_masklock_api.json",
    prefix: "codex_ps_basic_inpaint_masklock",
  },
  "comfy:sdxl-inpaint": {
    label: "ComfyUI SDXL Inpaint",
    file: "codex_sdxl_inpaint_masklock_api.json",
    prefix: "codex_ps_sdxl_inpaint_masklock",
  },
  "comfy:flux-fill": {
    label: "ComfyUI FLUX Fill",
    file: "codex_flux_fill_inpaint_masklock_api.json",
    prefix: "codex_ps_flux_fill_masklock",
  },
};
const PROMPT_PRESETS = [
  {
    label: "局部角色替换",
    prompt: "只把选区内被点名的角色替换为目标角色；保留椅子、底座、边框、背景、文字、数字、道具、阴影和UI图标结构完全不变；保持原来的2D卡通游戏图标风格。",
    negative: "改变椅子，改变边框，改变文字，改变数字，新增装饰，重画整个模块，改变构图，改变颜色风格。",
  },
  {
    label: "产品质感",
    prompt: "高级产品摄影，工作室布光，材质细节清晰，边缘干净，真实阴影。",
    negative: "模糊，重复结构，脏污背景，低清晰度，畸变。",
  },
  {
    label: "电影海报",
    prompt: "电影感海报构图，主体明确，层次丰富，戏剧性光影，色彩统一。",
    negative: "水印，过曝，构图松散，五官错乱，低分辨率。",
  },
  {
    label: "材质细化",
    prompt: "保留主体结构，加强材质纹理、边缘细节和光照层次，整体更干净。",
    negative: "结构改动过大，局部融化，重复纹理，脏边。",
  },
  {
    label: "电商白底",
    prompt: "纯净白底，主体居中，阴影克制，适合电商展示，细节真实。",
    negative: "杂色背景，灰底，变形，过度锐化，裁切不完整。",
  },
];

const MODE_META = {
  generate: { hint: "直接生成新图", label: "文生图" },
  reference: { hint: "使用当前画布作为参考图编辑", label: "参考图" },
  inpaint: { hint: "按当前选区进行局部重绘", label: "选区重绘" },
  outpaint: { hint: "向画布四周扩展内容", label: "扩图" },
  cutout: { hint: "把当前画布或选区抠成透明 PNG", label: "抠图" },
  split: { hint: "用 gpt-image-2 识别元素并拆成独立图层", label: "拆图" },
};

const state = {
  mode: "generate",
  outputView: "results",
  results: [],
  history: [],
  selectedId: null,
  busy: false,
  progress: 0,
  progressVisible: false,
  requestTimeoutMs: 0,
  activeRequestController: null,
  activeXhrs: new Set(),
  cancelRequested: false,
  promptDrafts: {},
  promptDraftSaveSuspended: false,
  promptDraftAutosaveTimer: null,
  unsupportedGenerationEndpoints: new Set(),
  unsupportedEditEndpoints: new Set(),
  unsupportedResponsesEditEndpoints: new Set(),
};

const CRC32_TABLE = createCrc32Table();

// Tolerant DOM lookup. Some UI elements (e.g. negative prompt input, preset
// menu, several quick-action buttons) were removed during the v0.1.57 cleanup,
// but the rest of the code still references them. To avoid a wave of null-checks
// across the file, return a passive stub element when the id no longer exists —
// reads return safe defaults, writes are no-ops, addEventListener is silent.
const __stubElement = (() => {
  const noop = () => {};
  const noopList = Object.assign([], { item: () => null });
  const stub = {
    value: "",
    textContent: "",
    innerHTML: "",
    innerText: "",
    placeholder: "",
    disabled: false,
    checked: false,
    hidden: true,
    tagName: "STUB",
    id: "",
    className: "",
    classList: {
      add: noop,
      remove: noop,
      toggle: noop,
      replace: noop,
      contains: () => false,
    },
    style: new Proxy({}, { set: () => true, get: () => "" }),
    dataset: {},
    children: noopList,
    childNodes: noopList,
    firstChild: null,
    firstElementChild: null,
    lastChild: null,
    lastElementChild: null,
    parentNode: null,
    parentElement: null,
    nextSibling: null,
    nextElementSibling: null,
    previousSibling: null,
    previousElementSibling: null,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    appendChild: (n) => n,
    append: noop,
    prepend: noop,
    insertBefore: (n) => n,
    removeChild: (n) => n,
    replaceChild: (n) => n,
    remove: noop,
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    hasAttribute: () => false,
    focus: noop,
    blur: noop,
    click: noop,
    contains: () => false,
    closest: () => null,
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => noopList,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }),
    scrollIntoView: noop,
  };
  // Catch-all proxy: any unknown property read returns the stub (chainable),
  // any unknown function call is a noop. Prevents crashes when the codebase
  // touches a property we didn't enumerate above.
  return new Proxy(stub, {
    get(target, prop) {
      if (prop in target) return target[prop];
      // Common pattern: el.someProp.foo — return a chainable callable.
      const fn = function () { return undefined; };
      fn.add = noop;
      fn.remove = noop;
      return fn;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
})();

const $ = (id) => {
  const element = document.getElementById(id);
  if (!element && typeof console !== "undefined") {
    console.warn("[OpenAI-PS] Missing UI element:", id);
  }
  return element || __stubElement;
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  console.log(`[OpenAI Photoshop Generator] init ${PLUGIN_VERSION}`);
  loadSettings();
  loadPromptDrafts();
  renderPromptPresets();
  bindEvents();
  updateModeUI();
  restorePromptDraftForMode(state.mode, { preserveNonEmptyCurrent: false });
  updateKeyBadge();
  syncCountUI();
  renderResults();
  renderHistory();
  renderOutputView();
  setStatus("就绪");
}

function bindEvents() {
  $("modeGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    switchMode(button.dataset.mode);
  });

  $("outputTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-output]");
    if (!button) return;
    state.outputView = button.dataset.output;
    renderOutputView();
  });

  $("settingsToggleBtn").addEventListener("click", openSettingsView);
  $("settingsBackBtn").addEventListener("click", closeSettingsView);
  $("quickSaveApiKeyBtn").addEventListener("click", saveQuickApiKey);
  $("quickApiKeyInput").addEventListener("input", () => {
    $("apiKeyInput").value = $("quickApiKeyInput").value;
    updateKeyBadge();
  });

  $("saveSettingsBtn").addEventListener("click", () => {
    saveSettings();
    closeSettingsView();
    setStatus("配置已保存");
  });
  $("testConnectionBtn").addEventListener("click", testConnection);
  $("testKoukoutuBtn").addEventListener("click", testKoukoutuConnection);
  $("apiKeyVisibilityBtn").addEventListener("click", toggleApiKeyVisibility);
  $("applyAuthJsonBtn").addEventListener("click", applyAuthJson);

  $("generateBtn").addEventListener("click", runGeneration);
  $("cancelRequestBtn").addEventListener("click", cancelCurrentGeneration);
  const rememberPromptDraft = () => savePromptDraftForMode();
  ["beforeinput", "input", "change", "keyup", "blur", "focusout", "compositionend"].forEach((eventName) => {
    $("promptInput").addEventListener(eventName, rememberPromptDraft);
    $("negativePromptInput").addEventListener(eventName, rememberPromptDraft);
  });
  ["pointerdown", "mousedown"].forEach((eventName) => {
    document.addEventListener(eventName, rememberPromptDraft, true);
  });
  if (!state.promptDraftAutosaveTimer && window?.setInterval) {
    state.promptDraftAutosaveTimer = window.setInterval(() => {
      if (hasPromptDraftText(getPromptDraftFromInputs())) {
        savePromptDraftForMode();
      }
    }, 700);
  }
  $("importSelectedBtn").addEventListener("click", importSelected);
  $("clearResultsBtn").addEventListener("click", () => {
    state.results = [];
    state.selectedId = null;
    renderResults();
    setStatus("结果已清空");
  });

  $("useSelectionSizeBtn").addEventListener("click", applySelectionRatioToSize);
  $("matchDocumentBtn").addEventListener("click", applyDocumentPaddingPreset);
  $("clearPromptBtn").addEventListener("click", clearPrompts);
  $("promptPresetBtn").addEventListener("click", togglePresetMenu);
  $("loadHistoryBtn").addEventListener("click", loadHistory);
  $("clearHistoryBtn").addEventListener("click", clearHistory);
  $("countInput").addEventListener("input", syncCountUI);
  $("apiKeyInput").addEventListener("input", updateKeyBadge);

  document.addEventListener("click", (event) => {
    const menu = $("promptPresetMenu");
    const presetBtn = $("promptPresetBtn");
    if (
      menu.classList.contains("hidden") ||
      presetBtn.contains(event.target) ||
      menu.contains(event.target)
    ) {
      return;
    }
    menu.classList.add("hidden");
  });
}

function loadSettings() {
  const defaults = {
    baseUrl: DEFAULT_BASE_URL,
    comfyUrl: DEFAULT_COMFY_URL,
    apiKey: "",
    model: "gpt-image-2",
    generationPath: "/images/generations",
    editPath: "/images/edits",
    size: "auto",
    quality: "auto",
    count: 1,
    format: "png",
    koukoutuApiKey: "",
    koukoutuFormat: "png",
    koukoutuCrop: 0,
    koukoutuBorder: 0,
  };

  const stored = readJsonLocal(SETTINGS_KEY, {});
  const settings = { ...defaults, ...stored };
  settings.baseUrl = normalizeBaseUrl(settings.baseUrl);
  settings.comfyUrl = normalizeComfyUrl(settings.comfyUrl);
  $("baseUrlInput").value = settings.baseUrl;
  $("comfyUrlInput").value = settings.comfyUrl;
  $("apiKeyInput").value = settings.apiKey;
  $("quickApiKeyInput").value = settings.apiKey;
  $("modelInput").value = settings.model;
  $("generationPathInput").value = settings.generationPath;
  $("editPathInput").value = settings.editPath;
  $("koukoutuApiKeyInput").value = settings.koukoutuApiKey || "";
  $("koukoutuFormatInput").value = settings.koukoutuFormat || "png";
  $("koukoutuBorderInput").value = String(clampInteger(settings.koukoutuBorder, 0, 2, 0));
  $("sizeInput").value = settings.size;
  $("qualityInput").value = "auto";
  $("countInput").value = clampInteger(settings.count, 1, MAX_BATCH_COUNT, 1);
  $("formatInput").value = "png";
}

function saveSettings() {
  const settings = getSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  $("baseUrlInput").value = settings.baseUrl;
  updateKeyBadge();
}

function saveQuickApiKey() {
  const value = $("quickApiKeyInput").value.trim();
  $("apiKeyInput").value = value;
  if (!value) {
    setStatus("请先填写 OpenAI API Key");
    updateKeyBadge();
    return;
  }
  saveSettings();
  setStatus("API Key 已保存");
}

function applyAuthJson() {
  const raw = $("authJsonInput").value.trim();
  const apiKey = extractOpenAIApiKey(raw);
  if (!apiKey) {
    if (/refresh_token|id_token|access_token/i.test(raw)) {
      setStatus("不能用账号 token 直连 OpenAI API，请粘贴 sk- 开头的 API Key");
      return;
    }
    setStatus("没有识别到 OpenAI API Key");
    return;
  }

  $("baseUrlInput").value = "https://api.openai.com/v1";
  $("apiKeyInput").value = apiKey;
  $("quickApiKeyInput").value = apiKey;
  $("modelInput").value = "gpt-image-2";
  $("generationPathInput").value = "/images/generations";
  $("editPathInput").value = "/images/edits";
  $("authJsonInput").value = "";
  saveSettings();
  updateKeyBadge();
  setStatus("已切换为官方 OpenAI API 直连");
}

function extractOpenAIApiKey(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  const direct = value.match(/sk-[A-Za-z0-9_-]{20,}/);
  if (direct) return direct[0];

  try {
    const parsed = JSON.parse(value);
    return findApiKeyInObject(parsed) || "";
  } catch (error) {
    return "";
  }
}

function findApiKeyInObject(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/sk-[A-Za-z0-9_-]{20,}/);
    return match ? match[0] : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findApiKeyInObject(item);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    const preferredKeys = ["api_key", "apiKey", "OPENAI_API_KEY", "openai_api_key", "key"];
    for (const key of preferredKeys) {
      const found = findApiKeyInObject(value[key]);
      if (found) return found;
    }
    for (const item of Object.values(value)) {
      const found = findApiKeyInObject(item);
      if (found) return found;
    }
  }
  return "";
}

function getSettings() {
  const baseUrl = normalizeBaseUrl($("baseUrlInput").value.trim() || DEFAULT_BASE_URL);
  const comfyUrl = normalizeComfyUrl($("comfyUrlInput").value.trim() || DEFAULT_COMFY_URL);
  return {
    baseUrl,
    comfyUrl,
    apiKey: $("apiKeyInput").value.trim(),
    model: $("modelInput").value.trim() || "gpt-image-2",
    generationPath: normalizePath($("generationPathInput").value.trim() || "/images/generations"),
    editPath: normalizePath($("editPathInput").value.trim() || "/images/edits"),
    size: $("sizeInput").value,
    quality: "auto",
    count: clampInteger($("countInput").value, 1, MAX_BATCH_COUNT, 1),
    format: "png",
    koukoutuApiKey: $("koukoutuApiKeyInput").value.trim(),
    koukoutuFormat: $("koukoutuFormatInput").value || "png",
    koukoutuCrop: 0,
    koukoutuBorder: clampInteger($("koukoutuBorderInput").value, 0, 2, 0),
  };
}

function loadPromptDrafts() {
  const stored = readJsonLocal(PROMPT_DRAFT_KEY, {});
  state.promptDrafts = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

function getPromptDraftFromInputs() {
  return {
    prompt: $("promptInput").value || "",
    negative: $("negativePromptInput").value || "",
  };
}

function hasPromptDraftText(draft) {
  return Boolean(String(draft?.prompt || "").trim() || String(draft?.negative || "").trim());
}

function savePromptDraftForMode(mode = state.mode, options = {}) {
  if (state.promptDraftSaveSuspended) return;
  if (!mode) return;
  state.promptDrafts = state.promptDrafts && typeof state.promptDrafts === "object" ? state.promptDrafts : {};
  const previous = state.promptDrafts[mode] || {};
  const current = getPromptDraftFromInputs();
  const promptText = String(current.prompt || "");
  const negativeText = String(current.negative || "");
  const hasCurrentPrompt = Boolean(promptText.trim());
  const draft = {
    ...current,
    explicitEmpty: Boolean(options.explicitEmpty) && !hasPromptDraftText(current),
    lastPrompt: hasCurrentPrompt ? promptText : (options.explicitEmpty ? "" : previous.lastPrompt || previous.prompt || ""),
    lastNegative: negativeText.trim() ? negativeText : (options.explicitEmpty ? "" : previous.lastNegative || previous.negative || ""),
  };
  const previousStable = JSON.stringify({
    prompt: previous.prompt || "",
    negative: previous.negative || "",
    explicitEmpty: Boolean(previous.explicitEmpty),
    lastPrompt: previous.lastPrompt || "",
    lastNegative: previous.lastNegative || "",
  });
  const draftStable = JSON.stringify(draft);
  if (previousStable === draftStable) return;
  draft.savedAt = new Date().toISOString();
  state.promptDrafts[mode] = draft;
  try {
    localStorage.setItem(PROMPT_DRAFT_KEY, JSON.stringify(state.promptDrafts));
  } catch (error) {
    console.warn("save prompt draft failed", error);
  }
}

function restorePromptDraftForMode(mode = state.mode, options = {}) {
  const draft = state.promptDrafts?.[mode];
  if (!draft) return;
  const current = getPromptDraftFromInputs();
  const preserveNonEmptyCurrent = options.preserveNonEmptyCurrent !== false;
  const hasCurrent = hasPromptDraftText(current);
  const respectExplicitEmpty = draft.explicitEmpty && !hasCurrent;
  const promptFallback = draft.lastPrompt || (preserveNonEmptyCurrent ? current.prompt : "");
  const negativeFallback = draft.lastNegative || (preserveNonEmptyCurrent ? current.negative : "");
  $("promptInput").value = respectExplicitEmpty ? "" : (draft.prompt || promptFallback);
  $("negativePromptInput").value = respectExplicitEmpty ? "" : (draft.negative || negativeFallback);
  if (preserveNonEmptyCurrent && !hasPromptDraftText(draft) && hasPromptDraftText(current)) {
    savePromptDraftForMode(mode);
  }
}

function switchMode(mode) {
  if (!mode) return;
  if (mode === state.mode) {
    savePromptDraftForMode(mode);
    restorePromptDraftForMode(mode);
    return;
  }
  savePromptDraftForMode(state.mode);
  state.mode = mode;
  updateModeUI();
  restorePromptDraftForMode(mode);
}

function updateKeyBadge() {
  const dot = $("connectionBadge");
  const hasKey = Boolean($("apiKeyInput").value.trim());
  dot.classList.toggle("is-ok", hasKey);
  dot.classList.toggle("is-off", !hasKey);
  dot.title = hasKey ? "已配置 API Key" : "未配置 API Key";
  $("quickApiPanel").classList.toggle("hidden", hasKey);
  $("quickApiKeyInput").value = $("apiKeyInput").value;
}

function updateModeUI() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === state.mode);
  });

  $("outpaintControls").classList.toggle("hidden", state.mode !== "outpaint");
  $("sizeField").classList.toggle("hidden", state.mode === "inpaint" || state.mode === "cutout" || state.mode === "split");
  $("modeContextPanel").classList.add("hidden");
  $("referenceContext").classList.toggle("hidden", state.mode !== "reference");
  $("selectionContext").classList.toggle(
    "hidden",
    state.mode !== "inpaint" && state.mode !== "outpaint" && state.mode !== "cutout" && state.mode !== "split"
  );

  const modeLabels = {
    generate: {
      icon: "✦",
      title: "文生图",
      text: "直接调用图片生成接口，结果会显示在下方结果区。",
      prompt: "提示词 (Prompt)",
      negative: "反向提示词 (Negative Prompt)",
      placeholder: "描述您想要生成的画面...",
      negativePlaceholder: "不希望出现的内容...",
    },
    reference: {
      icon: "▧",
      title: "参考图模式",
      text: "使用当前 Photoshop 文档作为参考图，再按提示词进行变化。",
      prompt: "修改提示词 (Prompt Modification)",
      negative: "反向提示词 (Negative Prompt)",
      placeholder: "描述如何修改或延展当前参考图...",
      negativePlaceholder: "不希望改变或出现的内容...",
    },
    inpaint: {
      icon: "□",
      title: "选区重绘",
      text: "基于当前 Photoshop 选区生成像素蒙版，只重绘真正选中的区域。",
      prompt: "重绘提示词 (Prompt)",
      negative: "反向提示词 (Negative Prompt)",
      placeholder: "描述选区内需要替换成什么内容...",
      negativePlaceholder: "不希望在选区里出现的内容...",
    },
    outpaint: {
      icon: "↔",
      title: "扩图模式",
      text: "按九宫格边距扩展画布，并用编辑蒙版补全新增区域。",
      prompt: "扩图提示词 (Prompt)",
      negative: "反向提示词 (Negative Prompt)",
      placeholder: "描述扩展区域应该补出的画面...",
      negativePlaceholder: "不希望在扩展区域出现的内容...",
    },
    cutout: {
      icon: "◌",
      title: "特效抠图",
      text: "上传当前画布或选区到抠抠图同步接口，输出透明 PNG 并放回原位置。",
      prompt: "抠图类型 (可选，留空自动)",
      negative: "辅助说明 (可选)",
      placeholder: "auto / 白底主体 / 黑底光效 / 火焰 / 蓝色电光 / alpha...",
      negativePlaceholder: "例如：更透明、保留亮部、边缘柔和...",
    },
  };

  modeLabels.split = {
    icon: "S",
    title: "拆图",
    text: "使用 gpt-image-2 先识别画面元素并输出白底完整画布，再自动拆成单独图层放回 Photoshop。",
    prompt: "拆图目标/说明 (可选)",
    negative: "辅助说明 (可选)",
    placeholder: "留空自动识别；手动指定可用逗号或换行分隔，例如：角色，头发，尾巴，武器...",
    negativePlaceholder: "例如：不要合并相邻道具、保留原始位置和比例...",
  };

  const meta = modeLabels[state.mode] || modeLabels.generate;
  $("modeContextIcon").textContent = meta.icon;
  $("modeContextTitle").textContent = meta.title;
  $("modeContextText").textContent = meta.text;
  $("promptLabel").textContent = meta.prompt;
  $("negativePromptLabel").textContent = meta.negative;
  $("promptInput").placeholder = meta.placeholder;
  $("negativePromptInput").placeholder = meta.negativePlaceholder;

  const hint = $("modeHint");
  if (hint) {
    hint.textContent = MODE_META[state.mode]?.hint || "直接生成新图";
  }
}

function applyDocumentPaddingPreset() {
  $("padTopInput").value = 0;
  $("padRightInput").value = 256;
  $("padBottomInput").value = 0;
  $("padLeftInput").value = 256;
  setStatus("已按横向扩图预设设置边距");
}

function openSettingsView() {
  $("workspaceView").classList.add("hidden");
  $("settingsView").classList.remove("hidden");
}

function closeSettingsView() {
  $("settingsView").classList.add("hidden");
  $("workspaceView").classList.remove("hidden");
}

function toggleApiKeyVisibility() {
  const input = $("apiKeyInput");
  const button = $("apiKeyVisibilityBtn");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  button.title = visible ? "显示 API Key" : "隐藏 API Key";
  button.setAttribute("aria-label", button.title);
}

function syncCountUI() {
  const count = clampInteger($("countInput").value, 1, MAX_BATCH_COUNT, 1);
  $("countInput").value = count;
  $("countValue").textContent = String(count);
}

function clearPrompts() {
  $("promptInput").value = "";
  $("negativePromptInput").value = "";
  savePromptDraftForMode(state.mode, { explicitEmpty: true });
  $("promptPresetMenu").classList.add("hidden");
  setStatus("提示词已清空");
}

function renderPromptPresets() {
  const menu = $("promptPresetMenu");
  menu.innerHTML = "";
  PROMPT_PRESETS.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = preset.label;
    button.addEventListener("click", () => applyPromptPreset(preset));
    menu.append(button);
  });
}

function togglePresetMenu() {
  $("promptPresetMenu").classList.toggle("hidden");
}

function applyPromptPreset(preset) {
  $("promptInput").value = preset.prompt;
  if (!$("negativePromptInput").value.trim()) {
    $("negativePromptInput").value = preset.negative || "";
  }
  savePromptDraftForMode();
  $("promptPresetMenu").classList.add("hidden");
  setStatus(`已应用模板：${preset.label}`);
}

async function testConnection() {
  const settings = getSettings();
  $("baseUrlInput").value = settings.baseUrl;
  $("comfyUrlInput").value = settings.comfyUrl;

  if (isComfyModel(settings.model)) {
    if (!settings.comfyUrl) {
      setStatus("请先填写 ComfyUI URL");
      return;
    }
    await testComfyConnection(settings);
    return;
  }

  if (!settings.baseUrl) {
    setStatus("请先填写 Base URL");
    return;
  }
  if (!settings.apiKey) {
    setStatus("请先填写 API Key");
    return;
  }

  $("testConnectionBtn").disabled = true;
  $("saveSettingsBtn").disabled = true;
  setStatus("正在测试连接...");

  try {
    const response = await sendRequest(buildApiUrl(settings.baseUrl, "/models"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
      },
    }, "测试连接");

    if (response.ok) {
      setStatus(shouldUseSidecarImageEndpointsFirst(settings, true)
        ? "连接正常；Codex sidecar 将优先使用 /images/generations 和 /images/edits"
        : "连接正常；文生图可用不代表选区重绘可用，重绘还需要服务支持 /images/edits");
    } else if (response.status === 401 || response.status === 403) {
      setStatus("服务可达，但 API Key 无效");
    } else if (response.status === 404) {
      setStatus("服务可达，但 /models 不可用");
    } else {
      setStatus(`服务有响应：HTTP ${response.status}`);
    }
  } catch (error) {
    setStatus(`连接失败：${error.message || error}`);
  } finally {
    $("testConnectionBtn").disabled = false;
    $("saveSettingsBtn").disabled = false;
  }
}

async function testComfyConnection(settings) {
  $("testConnectionBtn").disabled = true;
  $("saveSettingsBtn").disabled = true;
  setStatus("正在测试 ComfyUI...");

  try {
    const statsResponse = await sendRequest(buildComfyUrl(settings.comfyUrl, "/system_stats"), {
      method: "GET",
    }, "测试 ComfyUI");
    if (!statsResponse.ok) {
      setStatus(`ComfyUI 有响应：HTTP ${statsResponse.status}`);
      return;
    }

    const checkpointsResponse = await sendRequest(buildComfyUrl(settings.comfyUrl, "/models/checkpoints"), {
      method: "GET",
    }, "读取 ComfyUI 模型");
    const checkpointsText = checkpointsResponse.ok ? await checkpointsResponse.text() : "[]";
    let checkpoints = [];
    try {
      checkpoints = JSON.parse(checkpointsText);
    } catch (error) {
      checkpoints = [];
    }
    const modelList = Array.isArray(checkpoints) ? checkpoints : checkpoints?.value || [];
    const modelHint = modelList.length ? `模型：${modelList.slice(0, 3).join(" / ")}` : "未读取到 checkpoint";
    setStatus(`ComfyUI 已连接：${modelHint}`);
  } catch (error) {
    setStatus(`ComfyUI 连接失败：${error.message || error}`);
  } finally {
    $("testConnectionBtn").disabled = false;
    $("saveSettingsBtn").disabled = false;
  }
}

async function testKoukoutuConnection() {
  const settings = getSettings();
  if (!settings.koukoutuApiKey) {
    setStatus("请先填写抠抠图 API Key");
    return;
  }
  saveSettings();
  setStatus("抠抠图 API Key 已保存；首次抠图时会验证额度和权限");
}

async function runGeneration() {
  if (state.busy) return;

  const settings = getSettings();
  $("baseUrlInput").value = settings.baseUrl;
  $("comfyUrlInput").value = settings.comfyUrl;
  if (state.mode !== "cutout" && state.mode !== "inpaint" && isComfyModel(settings.model)) {
    settings.model = "gpt-image-2";
    $("modelInput").value = settings.model;
  }
  if (state.mode === "cutout" && !settings.koukoutuApiKey) {
    setStatus("请先在设置里填写抠抠图 API Key");
    return;
  }
  if (!settings.apiKey && !isComfyModel(settings.model) && state.mode !== "cutout") {
    setStatus("请先填写 OpenAI API Key");
    return;
  }

  const rawPrompt = $("promptInput").value.trim();
  if (!rawPrompt && state.mode !== "cutout" && state.mode !== "split") {
    setStatus("请先输入提示词");
    return;
  }

  savePromptDraftForMode();
  const prompt = buildPrompt(rawPrompt || "auto", $("negativePromptInput").value.trim());
  saveSettings();
  const runController = createAbortController();
  state.activeRequestController = runController;
  state.cancelRequested = false;
  setBusy(true);
  setProgress(8, true);

  try {
    throwIfCancelled();
    setStatus("正在准备请求...");
    let items = [];
    let outputSize = settings.size;
    let targetRect = null;
    let placementRect = null;
    let placementWarning = "";

    if (state.mode === "generate") {
      setProgress(20, true);
      items = await requestGenerations(settings, prompt);
    } else if (state.mode === "reference") {
      setProgress(18, true);
      const selection = await getSelectionInfo();
      if (isSelectionValid(selection)) {
        setStatus("正在导出选区上下文作为无 Mask 参考图...");
        const reference = await createReferenceRegionInputs(selection, getDocumentSize(), settings.model);
        outputSize = reference.displaySize;
        targetRect = reference.targetRect;
        placementRect = reference.placementRect;
        setProgress(40, true);
        items = await requestEdits(
          settings,
          buildImageEditPrompt(prompt, "referenceNoMask"),
          reference.image,
          null,
          { size: reference.apiSize }
        );
      } else {
        const image = await exportActiveDocumentAsBase64();
        setProgress(36, true);
        items = await requestEdits(settings, buildImageEditPrompt(prompt, "reference"), image, null);
      }
    } else if (state.mode === "inpaint") {
      setProgress(15, true);
      const selection = await getSelectionInfo();
      if (!isSelectionValid(selection)) {
        throw new Error("请先用选区工具选中要重绘的区域");
      }
      const docSize = getDocumentSize();
      setProgress(34, true);
      setStatus("正在读取当前 Photoshop 选区...");
      const inpaintSettings = getInpaintSettings(settings);
      const editSelection = selection;
      setProgress(40, true);
      setStatus("正在按你画的完整选区导出重绘 Mask...");
      // Photoshop 2026 can surface a program-error dialog when restoring a
      // temporary alpha channel into a layer mask. Keep the edit bounded with
      // a local layer clip instead of saving/restoring selection channels.
      const selectionChannelName = null;
      const inpaint = await createInpaintInputs(editSelection, docSize, settings.model);
      inpaint.selectionChannelName = selectionChannelName;
      inpaint.forceClosedMouthFallback = false;
      outputSize = inpaint.displaySize;
      targetRect = inpaint.targetRect;
      placementRect = inpaint.placementRect;
      setProgress(58, true);
      setStatus(`正在重绘选区，接口尺寸 ${inpaint.apiSize}，只导回 ${inpaint.displaySize}`);
      items = await requestEdits(inpaintSettings, buildImageEditPrompt(prompt, "inpaint"), inpaint.image, inpaint.mask, {
        size: inpaint.apiSize,
      });
      setProgress(88, true);
      setProgress(84, true);
      setStatus("模型已返回，正在准备选区保护图层...");
      items = await prepareMaskedInpaintLayers(items, inpaint);
    } else if (state.mode === "outpaint") {
      setProgress(18, true);
      const image = await exportActiveDocumentAsBase64();
      const docSize = getDocumentSize();
      setProgress(36, true);
      const outpaint = await createOutpaintInputs(image, docSize, getPadding());
      outputSize = outpaint.displaySize;
      targetRect = outpaint.targetRect;
      placementRect = outpaint.placementRect;
      setProgress(58, true);
      items = await requestEdits(settings, buildImageEditPrompt(prompt, "outpaint"), outpaint.image, outpaint.mask);
      items = items.map((item) => ({
        ...item,
        outpaintPadding: outpaint.padding,
        outpaintBaseSize: outpaint.baseSize,
        targetRect: outpaint.targetRect,
        placementRect: outpaint.placementRect,
      }));
    } else if (state.mode === "cutout") {
      setProgress(18, true);
      const cutout = await createCutoutInputs();
      outputSize = cutout.displaySize;
      targetRect = cutout.targetRect;
      placementRect = cutout.placementRect;
      setProgress(52, true);
      setStatus("正在调用抠抠图同步抠图 API...");
      items = [await requestKoukoutuCutout(settings, cutout.image)];
    } else if (state.mode === "split") {
      setProgress(18, true);
      const docSize = getDocumentSize();
      const fullRect = { left: 0, top: 0, right: docSize.width, bottom: docSize.height, width: docSize.width, height: docSize.height };
      setStatus("正在导出当前画布给 gpt-image-2 拆图...");
      const splitInput = await exportActiveDocumentForSplit(docSize);
      const image = splitInput.image;
      const splitSettings = {
        ...settings,
        model: "gpt-image-2",
        count: 1,
        format: "png",
        quality: "auto",
      };
      outputSize = `${docSize.width} x ${docSize.height}`;
      targetRect = fullRect;
      placementRect = fullRect;
      setProgress(34, true);
      const splitTargets = await resolveSemanticSplitTargets(settings, image, splitInput.docSize, rawPrompt);
      items = (await requestSemanticSplitLayers(splitSettings, image, splitInput.docSize, splitTargets)).map((item) => ({
        ...item,
        targetRect: fullRect,
        placementRect: fullRect,
      }));
    }

    throwIfCancelled();
    const stamped = (items || []).map((item, index) => ({
      id: `${Date.now()}-${index}`,
      b64: item.b64,
      importB64: item.importB64 || null,
      url: item.url || null,
      prompt,
      mode: state.mode,
      model: settings.model,
      size: outputSize,
      quality: settings.quality,
      format: item.format || settings.format,
      placementMode: item.placementMode || null,
      skipPreviewCrop: Boolean(item.skipPreviewCrop),
      selectionChannelName: item.selectionChannelName || null,
      targetRect: item.targetRect || targetRect,
      placementRect: item.placementRect || placementRect,
      cropRect: state.mode === "split" ? null : (item.placementMode === "direct-selection-patch" ? null : (item.cropRect || targetRect)),
      outpaintPadding: item.outpaintPadding || null,
      outpaintBaseSize: item.outpaintBaseSize || null,
      splitIndex: item.splitIndex || null,
      splitLabel: item.splitLabel || null,
      splitBounds: item.splitBounds || null,
      whiteMatteMask: Boolean(item.whiteMatteMask),
      preclippedImport: Boolean(item.preclippedImport),
      createdAt: new Date().toISOString(),
    }));

    if (!stamped.length) {
      throw new Error("接口请求成功，但响应里没有可显示的图片数据");
    }

    state.results = [...stamped, ...state.results];
    state.selectedId = stamped[0]?.id || state.selectedId;
    setProgress(86, true);
    throwIfCancelled();
    await prepareCroppedPreviews(stamped);
    setProgress(88, true);
    throwIfCancelled();
    renderResults();
    await Promise.all(stamped.map(saveHistoryItem));
    throwIfCancelled();
    if (state.mode === "cutout" && stamped[0]) {
      setProgress(92, true);
      setStatus("正在把抠图结果放回原位置...");
      await placeResultAsLayer(stamped[0], stamped[0].placementRect || stamped[0].targetRect, "Koukoutu Cutout", null, { preserveImageAspect: true });
    } else if (state.mode === "inpaint" && stamped[0]) {
      setProgress(92, true);
      setStatus("正在把重绘结果按 Photoshop 选区保护图层放回...");
      try {
        const shouldMaskInpaint = isMaskedInpaintLayerResult(stamped[0]);
        const needsPostImportMask = shouldMaskInpaint && !stamped[0].preclippedImport;
        const placementRect = stamped[0].placementRect || stamped[0].targetRect;
        await placeResultAsLayer(stamped[0], placementRect, "OpenAI Inpaint", needsPostImportMask ? (stamped[0].cropRect || stamped[0].targetRect) : null, {
          fitByImageSize: shouldMaskInpaint,
          alignVisibleRect: shouldMaskInpaint,
          preserveImageAspect: false,
          rasterizeBeforeMask: needsPostImportMask,
          useCurrentSelectionMask: false,
          selectionChannelName: needsPostImportMask ? (stamped[0].selectionChannelName || null) : null,
          useSavedSelectionMask: false,
          requireMask: needsPostImportMask,
          moveToFront: true,
        });
      } catch (error) {
        console.error("[inpaint] auto place failed", error);
        placementWarning = `已生成，但自动放回图层失败：${error.message || error}。请点击下方"导入"`;
        setStatus(placementWarning);
      }
    } else if (state.mode === "outpaint" && stamped[0]) {
      setProgress(92, true);
      setStatus("正在扩展 Photoshop 画布并放回扩图结果...");
      try {
        await expandCanvasForOutpaint(stamped[0].outpaintPadding, stamped[0].targetRect, stamped[0].outpaintBaseSize);
        await placeResultAsLayer(stamped[0], stamped[0].placementRect || stamped[0].targetRect, "OpenAI Outpaint", null, {
          preserveImageAspect: true,
        });
      } catch (error) {
        console.error("[outpaint] auto place failed", error);
        placementWarning = `已生成，但自动扩展画布失败：${error.message || error}。请点击下方"导入"`;
        setStatus(placementWarning);
      }
    } else if (state.mode === "split" && stamped.length) {
      setProgress(92, true);
      setStatus(`正在把 ${stamped.length} 个拆图元素放回 Photoshop 图层...`);
      for (let index = 0; index < stamped.length; index += 1) {
        const item = stamped[index];
        await placeResultAsLayer(item, item.placementRect || item.targetRect, buildSplitLayerName(item, index + 1), null, { preserveImageAspect: true });
        setProgress(92 + Math.round(((index + 1) / stamped.length) * 7), true);
      }
    }
    setProgress(100, true);
    setStatus(placementWarning || (state.mode === "cutout"
      ? "完成：已创建抠图图层并放回原位置"
      : state.mode === "inpaint"
      ? "完成：已作为选区保护新图层放回，原图未变"
      : state.mode === "outpaint"
      ? "完成：已扩展画布并放回扩图结果"
      : state.mode === "split"
      ? `完成：已用 gpt-image-2 拆出 ${stamped.length} 个独立图层`
      : `完成：生成 ${stamped.length} 张`));
  } catch (error) {
    if (isCancelError(error)) {
      console.warn("[OpenAI Photoshop Generator] generation cancelled");
      setStatus("已停止");
    } else {
      console.error(error);
      setStatus(`失败：${error.message || error}`);
    }
  } finally {
    if (state.activeRequestController === runController) {
      state.activeRequestController = null;
    }
    state.cancelRequested = false;
    setBusy(false);
    window.setTimeout(() => setProgress(0, false), 700);
  }
}

async function runSixModeSmoke() {
  if (state.busy) {
    console.warn("[OpenAI Photoshop Generator] smoke skipped: plugin is busy");
    return;
  }
  if (!app.activeDocument) {
    console.warn("[OpenAI Photoshop Generator] smoke skipped: no active document");
    setStatus("烟测失败：当前没有打开的 Photoshop 文档");
    return;
  }

  const modes = [
    ["generate", "small cute game icon sticker, orange hero cat, plain white background"],
    ["reference", "保持当前悟空猫角色风格，微调高光，让边缘更干净"],
    ["inpaint", "只把选区里的局部毛发高光变得更清晰，其他像素保持不变"],
    ["cutout", "抠出当前角色，保留原始边缘"],
    ["split", "头发"],
    ["outpaint", "自然扩展画布边缘，保持原始卡通游戏图标风格"],
  ];

  const originalMode = state.mode;
  const originalPrompt = $("promptInput").value;
  const originalNegativePrompt = $("negativePromptInput").value;
  const originalRequestTimeoutMs = state.requestTimeoutMs;
  const originalPromptDraftSaveSuspended = state.promptDraftSaveSuspended;
  state.requestTimeoutMs = SMOKE_REQUEST_TIMEOUT_MS;
  state.promptDraftSaveSuspended = true;
  console.log("[OpenAI Photoshop Generator] smoke start");

  try {
    for (const [mode, prompt] of modes) {
      try {
        console.log(`[OpenAI Photoshop Generator] smoke mode start: ${mode}`);
        state.mode = mode;
        updateModeUI();
        $("promptInput").value = prompt;
        if (mode === "inpaint") {
          await selectSmokeRect();
        }
        await runGeneration();
        if ((mode === "generate" || mode === "reference") && state.selectedId) {
          await importSelected();
        }
        const status = $("statusBar").textContent || "";
        if (/^失败/.test(status)) {
          console.warn(`[OpenAI Photoshop Generator] smoke mode failed status: ${mode}; status=${status}`);
        } else {
          console.log(`[OpenAI Photoshop Generator] smoke mode done: ${mode}; status=${status}`);
        }
      } catch (error) {
        console.error(`[OpenAI Photoshop Generator] smoke mode failed: ${mode}`, error);
        setStatus(`烟测 ${mode} 失败：${error.message || error}`);
      }
    }
  } finally {
    state.requestTimeoutMs = originalRequestTimeoutMs;
    state.promptDraftSaveSuspended = originalPromptDraftSaveSuspended;
    state.mode = originalMode;
    $("promptInput").value = originalPrompt;
    $("negativePromptInput").value = originalNegativePrompt;
    updateModeUI();
    console.log("[OpenAI Photoshop Generator] smoke finished");
  }
}

async function runModeSmoke(mode, prompt) {
  if (state.busy) {
    console.warn("[OpenAI Photoshop Generator] smoke skipped: plugin is busy");
    return;
  }
  if (!app.activeDocument) {
    console.warn("[OpenAI Photoshop Generator] smoke skipped: no active document");
    setStatus("烟测失败：当前没有打开的 Photoshop 文档");
    return;
  }

  const originalMode = state.mode;
  const originalPrompt = $("promptInput").value;
  const originalNegativePrompt = $("negativePromptInput").value;
  const originalRequestTimeoutMs = state.requestTimeoutMs;
  const originalPromptDraftSaveSuspended = state.promptDraftSaveSuspended;
  state.requestTimeoutMs = SMOKE_REQUEST_TIMEOUT_MS;
  state.promptDraftSaveSuspended = true;
  try {
    console.log(`[OpenAI Photoshop Generator] smoke mode start: ${mode}`);
    state.mode = mode;
    updateModeUI();
    $("promptInput").value = prompt || "auto";
    if (mode === "inpaint") {
      await selectSmokeRect();
    }
    await runGeneration();
    const status = $("statusBar").textContent || "";
    if (/^失败/.test(status)) {
      console.warn(`[OpenAI Photoshop Generator] smoke mode failed status: ${mode}; status=${status}`);
    } else {
      console.log(`[OpenAI Photoshop Generator] smoke mode done: ${mode}; status=${status}`);
    }
  } catch (error) {
    console.error(`[OpenAI Photoshop Generator] smoke mode failed: ${mode}`, error);
    setStatus(`烟测 ${mode} 失败：${error.message || error}`);
  } finally {
    state.requestTimeoutMs = originalRequestTimeoutMs;
    state.promptDraftSaveSuspended = originalPromptDraftSaveSuspended;
    state.mode = originalMode;
    $("promptInput").value = originalPrompt;
    $("negativePromptInput").value = originalNegativePrompt;
    updateModeUI();
  }
}

async function runMouthInpaintSmoke() {
  if (state.busy) {
    console.warn("[OpenAI Photoshop Generator] mouth smoke skipped: plugin is busy");
    return;
  }
  if (!app.activeDocument) {
    console.warn("[OpenAI Photoshop Generator] mouth smoke skipped: no active document");
    setStatus("嘴巴选区烟测失败：当前没有打开的 Photoshop 文档");
    return;
  }

  const originalMode = state.mode;
  const originalPrompt = $("promptInput").value;
  const originalNegativePrompt = $("negativePromptInput").value;
  const originalRequestTimeoutMs = state.requestTimeoutMs;
  const originalPromptDraftSaveSuspended = state.promptDraftSaveSuspended;
  state.requestTimeoutMs = SMOKE_REQUEST_TIMEOUT_MS;
  state.promptDraftSaveSuspended = true;
  try {
    await selectMouthSmokeRect();
    console.log("[OpenAI Photoshop Generator] mouth smoke reset fallback selection");
    state.mode = "inpaint";
    updateModeUI();
    $("promptInput").value = "把嘴巴闭上，其他部分完全不动";
    console.log("[OpenAI Photoshop Generator] mouth inpaint smoke start");
    await runGeneration();
    const status = $("statusBar").textContent || "";
    if (/^失败/.test(status)) {
      console.warn(`[OpenAI Photoshop Generator] mouth inpaint smoke failed status: ${status}`);
    } else {
      console.log(`[OpenAI Photoshop Generator] mouth inpaint smoke done; status=${status}`);
    }
  } catch (error) {
    console.error("[OpenAI Photoshop Generator] mouth inpaint smoke failed", error);
    setStatus(`嘴巴选区烟测失败：${error.message || error}`);
  } finally {
    state.requestTimeoutMs = originalRequestTimeoutMs;
    state.promptDraftSaveSuspended = originalPromptDraftSaveSuspended;
    state.mode = originalMode;
    $("promptInput").value = originalPrompt;
    $("negativePromptInput").value = originalNegativePrompt;
    updateModeUI();
  }
}

async function importApiKeyFromClipboard() {
  try {
    const text = await readClipboardText();
    const apiKey = extractOpenAIApiKey(text) || extractLocalRelayApiKey(text);
    if (!apiKey) {
      setStatus("剪贴板里没有识别到 API Key");
      console.warn("[OpenAI Photoshop Generator] clipboard did not contain an API key");
      return;
    }
    $("apiKeyInput").value = apiKey;
    $("quickApiKeyInput").value = apiKey;
    if (/^agt_codex_/i.test(apiKey)) {
      $("baseUrlInput").value = DEFAULT_BASE_URL;
    }
    saveSettings();
    setStatus("已从剪贴板导入 API Key");
    console.log("[OpenAI Photoshop Generator] API key imported from clipboard");
  } catch (error) {
    console.error("[OpenAI Photoshop Generator] clipboard API key import failed", error);
    setStatus(`导入剪贴板 API Key 失败：${error.message || error}`);
  }
}

async function readClipboardText() {
  if (navigator?.clipboard?.getContent) {
    const content = await navigator.clipboard.getContent();
    if (content && typeof content === "object") {
      const text = content["text/plain"] || content.text || content.plainText || "";
      if (typeof text === "string" && text.trim()) return text;
    }
  }
  if (navigator?.clipboard?.readText) {
    const text = await navigator.clipboard.readText();
    if (typeof text === "string" && text.trim()) return text;
  }
  try {
    const { clipboard } = require("uxp");
    if (clipboard?.readText) {
      const text = await clipboard.readText();
      if (typeof text === "string" && text.trim()) return text;
    }
    if (clipboard?.getContent) {
      const content = await clipboard.getContent();
      const text = content?.["text/plain"] || content?.text || content?.plainText || "";
      if (typeof text === "string" && text.trim()) return text;
    }
  } catch (error) {
    // Fall through to a clear user-facing error.
  }
  throw new Error("当前 UXP 环境没有可用的剪贴板读取 API");
}

function extractLocalRelayApiKey(raw) {
  const value = String(raw || "");
  const match = value.match(/agt_codex_[A-Za-z0-9_-]{16,}/);
  return match ? match[0] : "";
}

async function selectSmokeRect() {
  const docSize = getDocumentSize();
  const width = Math.max(64, Math.round(docSize.width * 0.22));
  const height = Math.max(64, Math.round(docSize.height * 0.18));
  const centerX = Math.round(docSize.width * 0.52);
  const centerY = Math.round(docSize.height * 0.36);
  const rect = clampRectToDocument({
    left: centerX - Math.round(width / 2),
    top: centerY - Math.round(height / 2),
    right: centerX + Math.round(width / 2),
    bottom: centerY + Math.round(height / 2),
  }, docSize);
  await core.executeAsModal(async () => {
    await action.batchPlay([rectSelectionCommand(rect)], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName: "OpenAI smoke selection" });
}

async function selectMouthSmokeRect() {
  const docSize = getDocumentSize();
  const width = Math.max(180, Math.round(docSize.width * 0.34));
  const height = Math.max(150, Math.round(docSize.height * 0.38));
  const centerX = Math.round(docSize.width * 0.44);
  const centerY = Math.round(docSize.height * 0.39);
  const rect = clampRectToDocument({
    left: centerX - Math.round(width / 2),
    top: centerY - Math.round(height / 2),
    right: centerX + Math.round(width / 2),
    bottom: centerY + Math.round(height / 2),
  }, docSize);
  await core.executeAsModal(async () => {
    await action.batchPlay([rectSelectionCommand(rect)], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName: "OpenAI mouth smoke selection" });
}

function buildPrompt(prompt, negative) {
  if (!negative) return prompt;
  return `${prompt}\n\nAvoid: ${negative}`;
}

function getInpaintSettings(settings) {
  return {
    ...settings,
    count: 1,
  };
}

function buildImageEditPrompt(prompt, mode) {
  const constrainedPrompt = buildConstrainedImageEditPrompt(prompt, mode);
  if (constrainedPrompt !== null) return constrainedPrompt;

  const modeGuidance = {
    reference: [
      "Use the provided Photoshop image as the primary visual reference.",
      "Preserve the original composition, style, lighting, perspective, color palette, and texture unless the user prompt explicitly asks to change them.",
      "Make the requested change while keeping unrelated areas as close to the source image as possible.",
    ],
    referenceNoMask: [
      "Use the provided Photoshop crop as an image-to-image reference edit without a mask.",
      "Follow the user's requested change directly on the provided crop.",
      "Preserve the original character, pose, style, lighting, line art, color palette, and unrelated details as much as possible.",
      "When the request asks to remove an object, erase that object and fill the area naturally with the requested background or nearby visual context.",
    ],
    inpaint: [
      "Surgical edit task. Make the smallest change possible to the provided source image.",
      "Apply ONLY the change the user explicitly requests. Do not redesign, reinterpret, or reimagine the scene.",
      "Every visual element the user does not explicitly tell you to change MUST stay pixel-identical: existing characters, props, furniture, decorations, backgrounds, frames, panels, text, numbers, icons, particles, lighting, shadows, color palette, line work, perspective, scale, and pixel-art / vector / illustration style.",
      "Match the original art style and rendering exactly. Do not switch styles, do not upgrade resolution, do not change the brushwork or shading approach.",
      "If the user names elements to preserve (e.g. \"don't change the throne\", \"keep the text\"), treat that as a hard constraint even if those elements sit inside the editable region.",
      "If the user asks to replace one specific subject (e.g. \"replace the hero with a cat\"), only replace that one subject; leave every other element exactly as it was.",
      "If the user asks to remove an element, erase only that element and fill its footprint with a faithful continuation of the surrounding original pixels.",
      "Do not introduce new objects, text, or decorations the user did not request.",
    ],
    outpaint: [
      "Use the provided Photoshop image as the source image.",
      "Only fill the newly expanded canvas area. Preserve the original content, style, lighting, perspective, color palette, and texture.",
      "Extend the scene naturally from the existing image instead of replacing it.",
    ],
  };

  // Pass the user's prompt through verbatim. Empirically, prepending engineering
  // guidance ("preserve the rest", "only edit the masked region", etc.) hurts
  // gpt-image-2's edit fidelity — the model latches onto the long English
  // preamble and re-interprets the scene. The user's plain natural-language
  // request alone produces much closer-to-intent results.
  return prompt;
}

function buildConstrainedImageEditPrompt(prompt, mode) {
  const userPrompt = String(prompt || "").trim();
  if (!userPrompt) return "";
  const ambiguityGuidance = getImageEditAmbiguityGuidance(userPrompt, mode);

  if (mode === "inpaint") {
    const surgicalHint = getSurgicalInpaintPromptHint(userPrompt);
    if (surgicalHint) {
      return [
        surgicalHint,
        "",
        ...ambiguityGuidance,
        ...(ambiguityGuidance.length ? [""] : []),
        "Use the provided transparent mask as the editable brush area. Generate a natural replacement inside that brush area only, aligned to the original face and art style.",
      ].join("\n");
    }
    return [
      userPrompt,
      "",
      ...ambiguityGuidance,
      ...(ambiguityGuidance.length ? [""] : []),
      "Use the provided transparent mask as the editable brush area. Make only the requested local change and keep the replacement aligned to the original image.",
    ].join("\n");
  }

  if (mode === "referenceNoMask" || mode === "reference") {
    return [
      userPrompt,
      "",
      ...ambiguityGuidance,
      ...(ambiguityGuidance.length ? [""] : []),
      "Preserve the source image composition, style, line art, color palette, lighting, scale, and all unrelated details. Make only the requested change.",
    ].join("\n");
  }

  if (mode === "outpaint") {
    return [
      userPrompt,
      "",
      "Only extend the newly expanded canvas area. Preserve all original pixels and continue the same style naturally.",
    ].join("\n");
  }

  return null;
}

function getImageEditAmbiguityGuidance(prompt, mode) {
  const value = String(prompt || "").trim();
  if (!value || (mode !== "inpaint" && mode !== "referenceNoMask" && mode !== "reference")) return [];

  const lower = value.toLowerCase();
  const mentionsRibbonBow = /蝴蝶结|蝴蝶結|丝带结|絲帶結|发结|髮結|bow\s*tie|ribbon\s*bow|hair\s*bow|decorative\s*bow/.test(lower);
  const mentionsArcheryBowCn = /弓箭|武器弓|长弓|長弓|反曲弓|复合弓|複合弓|弓身|弓弦|箭弓|射箭/.test(value);
  const mentionsBareBowCn = /弓/.test(value) && !mentionsRibbonBow;
  const mentionsArcheryBowEn = /\b(archery|weapon|recurve|longbow|compound|arrow|bowstring)\b/.test(lower) ||
    (/\bbow\b/.test(lower) && /\b(hand|hands|finger|fingers|arrow|string|weapon|archery|remove|erase|delete)\b/.test(lower) && !mentionsRibbonBow);

  if (!mentionsArcheryBowCn && !mentionsBareBowCn && !mentionsArcheryBowEn) return [];

  return [
    "消歧：这里的“弓”指弓箭/武器弓，不是蝴蝶结、发结、领结、丝带结或装饰结。",
    "保留原来的弓身、弓弦、材质和造型；只做用户要求的局部修改，不要新增蝴蝶结、丝带、领结或装饰结。",
  ];
}

async function requestGenerations(settings, prompt) {
  const total = Math.max(1, settings.count);
  const results = [];

  for (let index = 0; index < total; index += 1) {
    throwIfCancelled();
    setStatus(total > 1
      ? `正在调用 OpenAI 文生图 ${index + 1}/${total}...`
      : "正在调用 OpenAI 文生图...");
    setProgress(64 + Math.round((index / total) * 18), true);
    const batch = await requestSingleGeneration(settings, prompt);
    throwIfCancelled();
    results.push(...batch);
  }

  return results.slice(0, total);
}

async function requestSingleGeneration(settings, prompt) {
  if (shouldUseResponsesTextImageGenerationDirectly(settings)) {
    setStatus("当前 relay 不支持 /images/generations，直接改用 Responses 图像工具生图...");
    return requestResponsesTextImageGeneration(settings, prompt);
  }

  const payload = cleanObject({
    model: settings.model,
    prompt,
    n: 1,
    size: settings.size,
    quality: settings.quality,
    output_format: settings.format,
  });

  const generationUrl = buildApiUrl(settings.baseUrl, settings.generationPath);
  const response = await sendRequest(generationUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    timeoutMs: state.requestTimeoutMs || 180000,
  }, "文生图请求");

  if (shouldUseResponsesGenerationFallback(response, settings)) {
    const detail = await readResponseTextSafe(response);
    console.warn("[image-generation] /images/generations unavailable; falling back to /responses image_generation", detail);
    markGenerationEndpointUnsupported(settings);
    setStatus("当前服务没有 /images/generations，正在改用 Responses 图像工具生图...");
    return requestResponsesTextImageGeneration(settings, prompt);
  }

  return parseOpenAIImageResponse(response, {
    kind: "文生图",
    endpointPath: settings.generationPath,
    endpointUrl: generationUrl,
  });
}

function shouldUseResponsesTextImageGenerationDirectly(settings) {
  if (!settings?.apiKey || !settings?.baseUrl) return false;
  if (state.unsupportedGenerationEndpoints?.has?.(getGenerationEndpointKey(settings))) return true;
  return false;
}

function shouldUseResponsesGenerationFallback(response, settings) {
  return Boolean(
    response &&
    response.status === 404 &&
    /\/images\/generations$/i.test(normalizePath(settings.generationPath || "/images/generations")) &&
    settings.apiKey &&
    settings.baseUrl
  );
}

function markGenerationEndpointUnsupported(settings) {
  state.unsupportedGenerationEndpoints?.add?.(getGenerationEndpointKey(settings));
}

function getGenerationEndpointKey(settings) {
  return `${normalizeBaseUrl(settings?.baseUrl || "")}${normalizePath(settings?.generationPath || "/images/generations")}`;
}

async function requestResponsesTextImageGeneration(settings, prompt) {
  const payload = {
    model: DEFAULT_SEMANTIC_EDIT_MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildResponsesTextImagePrompt(prompt),
          },
        ],
      },
    ],
    tools: [
      {
        type: "image_generation",
        size: settings.size || "auto",
        quality: normalizeResponsesImageQuality(settings.quality),
        output_format: normalizeImageOutputFormat(settings.format),
      },
    ],
    tool_choice: { type: "image_generation" },
  };

  const response = await sendRequest(buildApiUrl(settings.baseUrl, "/responses"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    timeoutMs: state.requestTimeoutMs || 180000,
  }, "Responses 文生图");

  const text = await response.text();
  const json = parseResponsesJsonText(text);
  if (!json) {
    throw new Error(`Responses 文生图返回异常：${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(formatOpenAIResponseError(response, formatOpenAIError(json, response.statusText), {
      kind: "Responses 文生图",
      endpointPath: "/responses",
      endpointUrl: buildApiUrl(settings.baseUrl, "/responses"),
    }));
  }

  const items = parseResponsesImageGenerationItems(json, settings.format);
  if (!items.length) {
    throw new Error("Responses 文生图成功，但没有返回 image_generation_call 图片");
  }
  return items;
}

function buildResponsesTextImagePrompt(prompt) {
  return [
    "Create one image from this Photoshop plugin prompt.",
    "Return only the generated image through the image_generation tool.",
    "",
    String(prompt || "").trim(),
  ].filter(Boolean).join("\n");
}

function buildSplitImagePrompt(userPrompt) {
  const extra = String(userPrompt || "").trim();
  return [
    "Analyze the input Photoshop image and identify every distinct visible element/object.",
    "Create a clean full-canvas image on a plain white matte background.",
    "Keep each element at its original position, original scale, and original visual style.",
    "Remove only the background or empty canvas. Do not add labels, numbers, grids, shadows, outlines, or new objects.",
    "Do not merge separate props, body parts, accessories, weapons, tails, hair pieces, or UI sprites if they are visually distinct.",
    "The returned image should preserve the same overall canvas composition so a script can remove the matte and split separate Photoshop layers.",
    extra ? `User split notes: ${extra}` : "",
  ].filter(Boolean).join("\n");
}

async function resolveSemanticSplitTargets(settings, imageB64, docSize, userPrompt) {
  const explicit = buildExplicitSemanticSplitTargets(userPrompt);
  if (explicit.length >= 1) {
    return explicit;
  }

  const autoTargets = await requestGptSplitTargets(settings, imageB64, docSize, userPrompt);
  if (autoTargets.length >= 2) {
    return autoTargets;
  }

  return DEFAULT_SEMANTIC_SPLIT_TARGETS;
}

function buildExplicitSemanticSplitTargets(userPrompt) {
  const text = String(userPrompt || "").trim();
  if (!text) return [];

  const explicit = text
    .split(/[\n,，、;；|/]+/g)
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
    .slice(0, MAX_SEMANTIC_SPLIT_TARGETS);

  return explicit.map((target, index) => ({
    label: target.slice(0, 24) || `元素${index + 1}`,
    target,
  }));
}

async function requestGptSplitTargets(settings, imageB64, docSize, userPrompt) {
  if (!settings.apiKey || !settings.baseUrl) {
    return [];
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      elements: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            target: { type: "string" },
            reason: { type: "string" },
          },
          required: ["label", "target", "reason"],
        },
      },
      confidence: { type: "number" },
    },
    required: ["elements", "confidence"],
  };

  const payload = {
    model: DEFAULT_SEMANTIC_EDIT_MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Return JSON only. Identify Photoshop layers for semantic image splitting.",
              "The user wants automatic asset decomposition, not connected-component splitting.",
              "Find separate UI/art elements that a designer would expect as independent layers, even when the pixels touch.",
              "For a game health bar, split the base frame, inner colored fill bar, top badge/plate, and text/numbers into separate elements.",
              "Always separate visible text/numbers from the badge, plate, button, panel, or icon behind them.",
              "Always separate progress/health/energy fill from the outer frame/container.",
              "When the image has a panel, card, parchment, frame, slot background, or other base surface, include a clean base/background layer that removes foreground elements and reconstructs the covered surface so it has no holes.",
              "Do not include the plain matte/background as an element.",
              "Order elements from back to front when possible.",
              `Document size: ${docSize?.width || "unknown"} x ${docSize?.height || "unknown"}.`,
              `Optional user hint: ${String(userPrompt || "").trim() || "(none)"}`,
            ].join("\n"),
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${stripDataUrl(imageB64)}`,
            detail: "low",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "semantic_split_targets",
        strict: true,
        schema,
      },
    },
  };

  try {
    setStatus("正在自动识别画面里应该拆开的元素...");
    const response = await sendRequest(buildApiUrl(settings.baseUrl, "/responses"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, "GPT 自动拆图元素识别");
    if (!response.ok) return [];
    const plan = parseJsonFromResponseOutput(parseResponsesJsonText(await response.text()));
    return normalizeSemanticSplitTargets(plan?.elements || []);
  } catch (error) {
    console.warn("GPT split target analysis failed", error);
    return [];
  }
}

function normalizeSemanticSplitTargets(elements) {
  if (!Array.isArray(elements)) return [];

  const seen = new Set();
  return elements
    .map((item, index) => {
      const label = String(item?.label || "").trim().slice(0, 24) || `元素${index + 1}`;
      const target = String(item?.target || item?.label || "").trim();
      return { label, target };
    })
    .filter((item) => item.target.length >= 2)
    .filter((item) => {
      const key = item.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SEMANTIC_SPLIT_TARGETS);
}

async function requestSemanticSplitLayers(settings, imageB64, docSize, targets) {
  const results = [];
  const total = Math.max(1, targets.length);

  for (let index = 0; index < total; index += 1) {
    const target = targets[index];
    setProgress(45 + Math.round((index / total) * 36), true);
    setStatus(`正在用 gpt-image-2 抽取拆图层 ${index + 1}/${total}：${target.label}`);
    const prompt = buildSemanticSplitLayerPrompt(target, index, total, docSize);
    const batch = await requestEdits(settings, prompt, imageB64, null, { size: "auto" });
    const item = await normalizeSemanticSplitLayerItem(batch[0], docSize, target.label, index + 1);
    if (item) {
      results.push(item);
    }
  }

  if (!results.length) {
    setStatus("语义拆图没有得到有效图层，正在尝试整体白底拆分...");
    const fallbackPrompt = buildSplitImagePrompt(targets.map((target) => target.label).join("，"));
    const fallback = await requestEdits(settings, fallbackPrompt, imageB64, null, { size: "auto" });
    return splitGeneratedImageIntoElementItems(fallback[0], docSize);
  }

  return results;
}

function buildSemanticSplitLayerPrompt(target, index, total, docSize = null) {
  const isBaseLayer = isSemanticBaseLayer(target);
  const width = Math.max(1, Math.round(docSize?.width || 0));
  const height = Math.max(1, Math.round(docSize?.height || 0));
  return [
    "You are extracting one semantic Photoshop layer from the input image.",
    `Layer ${index + 1} of ${total}: ${target.label}.`,
    `Extract ONLY this target: ${target.target}.`,
    width && height
      ? `Return a full-canvas PNG exactly ${width}x${height} pixels, matching the input canvas size.`
      : "Return a full-canvas PNG with the exact same pixel size as the input image.",
    "Keep the extracted target at the original Photoshop canvas coordinates, with a plain white matte everywhere else.",
    "Keep the extracted target at its original position, original scale, original shape, original colors, and original style.",
    isBaseLayer
      ? "This is a base/background/frame layer: remove foreground icons, text, buttons, badges, and labels from this layer, then reconstruct the hidden surface/texture underneath so the panel is continuous and has no holes."
      : "",
    "Everything that is not this target must be plain white matte.",
    "Do not crop, trim empty matte pixels, recenter, enlarge, move, relabel, add guides, add boxes, add text, or create a contact sheet.",
    isBaseLayer
      ? "Only redraw/inpaint the covered base surface where foreground elements were removed; do not invent new decorations."
      : "Do not redraw the target; preserve it exactly from the source image.",
    "If this target is not present in the image, return a blank plain white canvas.",
  ].filter(Boolean).join("\n");
}

function isSemanticBaseLayer(target) {
  const label = String(target?.label || "").toLowerCase();
  const description = String(target?.target || "").toLowerCase();
  const nonBasePattern = /fill|progress|health|energy|bar only|text|number|glyph|badge|plate|icon|button|填充|进度|血条|红色条|文字|数字|徽章|图标|按钮|牌/;

  if (/底框|外框|底板|背景|面板|边框|纸面|画板|base|background|frame|panel|container|surface|card|parchment|shell/.test(label)) {
    return true;
  }

  if (nonBasePattern.test(description)) {
    return false;
  }

  return /complete clean|base frame|outer border|panel shell|background surface|base surface|parchment surface|container only/.test(description);
}

async function requestEdits(settings, prompt, imageB64, maskB64, options = {}) {
  const total = Math.max(1, settings.count);
  const results = [];

  for (let index = 0; index < total; index += 1) {
    throwIfCancelled();
    const routeLabel = isComfyModel(settings.model)
      ? `${getComfyPresetLabel(settings.model)}`
      : maskB64 ? "OpenAI 局部编辑" : "OpenAI 参考图编辑";
    setStatus(`正在调用 ${routeLabel} ${index + 1}/${total}...`);
    setProgress(68 + Math.round((index / total) * 14), true);
    const batch = await requestSingleEdit(settings, prompt, imageB64, maskB64, options);
    throwIfCancelled();
    results.push(...batch);
  }

  return results.slice(0, total);
}

async function requestSingleEdit(settings, prompt, imageB64, maskB64, options = {}) {
  if (isComfyModel(settings.model)) {
    return requestSingleComfyEdit(settings, prompt, imageB64, maskB64, options);
  }

  if (shouldUseChatGptStyleResponsesEdit(settings, Boolean(maskB64))) {
    try {
      setStatus(maskB64
        ? "正在用 ChatGPT 风格 Responses 图像工具重绘选区..."
        : "正在用 ChatGPT 风格 Responses 图像工具编辑参考图...");
      return await requestResponsesImageEditFallback(settings, prompt, imageB64, maskB64, options);
    } catch (error) {
      if (!isResponsesEditEndpointUnsupported(error)) {
        throw error;
      }
      console.warn("[image-edit] Responses image_generation unavailable; falling back to /images/edits", error?.message || error);
      markResponsesEditEndpointUnsupported(settings);
      setStatus("Responses 图像工具不可用，降级为 /images/edits 编辑...");
    }
  }

  const form = new FormData();
  const requestSize = options.size || settings.size;
  const imageBytes = estimateBase64Bytes(imageB64);
  const maskBytes = maskB64 ? estimateBase64Bytes(maskB64) : 0;
  const uploadBytes = imageBytes + maskBytes;
  if (uploadBytes > 75 * 1024 * 1024) {
    throw new Error(`上传图片过大：${formatBytes(uploadBytes)}。请缩小选区或画布后重试`);
  }

  form.append("model", settings.model);
  form.append("prompt", prompt);
  form.append("n", "1");
  if (requestSize) {
    form.append("size", requestSize);
  }
  form.append("quality", settings.quality);
  form.append("output_format", settings.format);
  const inputFidelity = getImageEditInputFidelity(settings.model, Boolean(maskB64));
  if (inputFidelity) {
    form.append("input_fidelity", inputFidelity);
  }
  form.append("image", base64ToBlob(imageB64, "image/png"), "input.png");
  if (maskB64) {
    form.append("mask", base64ToBlob(maskB64, "image/png"), "mask.png");
  }

  setStatus(maskB64
    ? `正在上传局部编辑：图像 ${formatBytes(imageBytes)}，Mask ${formatBytes(maskBytes)}`
    : `正在上传参考图：${formatBytes(imageBytes)}`);

  const waitLabel = maskB64 ? "OpenAI 局部编辑" : "OpenAI 参考图编辑";
  const waitStartedAt = Date.now();
  const waitTimer = window.setInterval(() => {
    const seconds = Math.max(1, Math.round((Date.now() - waitStartedAt) / 1000));
    setStatus(`已提交 ${waitLabel}，正在等待模型返回... ${seconds}s`);
  }, 3000);

  try {
    const editUrl = buildApiUrl(settings.baseUrl, settings.editPath);
    const response = await sendRequest(editUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: form,
      timeoutMs: options.timeoutMs || state.requestTimeoutMs || 12 * 60 * 1000,
      forceXhr: true,
    }, maskB64 ? "局部编辑请求" : "参考图编辑请求");
    setStatus(`模型已返回，正在读取 ${waitLabel} 图片数据...`);
    if (shouldUseResponsesImageFallback(response, settings, maskB64)) {
      const detail = await readResponseTextSafe(response);
      console.warn("[image-edit] /images/edits unavailable; falling back to /responses image_generation", detail);
      markEditEndpointUnsupported(settings);
      setStatus("当前服务没有 /images/edits，正在改用 Responses 图像工具重绘选区...");
      return await requestResponsesImageEditFallback(settings, prompt, imageB64, maskB64, options);
    }
    return await parseOpenAIImageResponse(response, {
      kind: maskB64 ? "局部编辑" : "参考图编辑",
      endpointPath: settings.editPath,
      endpointUrl: editUrl,
    });
  } finally {
    window.clearInterval(waitTimer);
  }
}

function shouldUseChatGptStyleResponsesEdit(settings, hasMask = false) {
  if (!settings?.apiKey || !settings?.baseUrl) return false;
  if (state.unsupportedResponsesEditEndpoints?.has?.(getResponsesEditEndpointKey(settings))) return false;
  // Codex sidecar now exposes OpenAI-compatible /images/edits and internally
  // forwards multipart mask edits through the Responses image toolchain. Prefer
  // that compatibility endpoint first so response conversion, streaming, usage
  // capture, and multipart handling stay inside the sidecar.
  if (shouldUseSidecarImageEndpointsFirst(settings, hasMask)) return false;
  // Other relays may not expose /images/edits, so keep the direct Responses
  // image_generation path as a ChatGPT-style fallback for masked edits.
  if (hasMask) return true;
  return true;
}

function shouldUseSidecarImageEndpointsFirst(settings, hasMask = false) {
  if (!settings?.apiKey || !settings?.baseUrl) return false;
  if (!isCodexSidecarBaseUrl(settings.baseUrl)) return false;
  if (hasMask && state.unsupportedEditEndpoints?.has?.(getEditEndpointKey(settings))) return false;
  return true;
}

function isCodexSidecarBaseUrl(baseUrl) {
  const value = normalizeBaseUrl(baseUrl).toLowerCase();
  return value === "http://127.0.0.1:51866/v1" || value === "http://localhost:51866/v1";
}

function shouldUseResponsesImageGenerationDirectly(settings, maskB64) {
  if (!maskB64 || !settings?.apiKey || !settings?.baseUrl) return false;
  if (state.unsupportedEditEndpoints?.has?.(getEditEndpointKey(settings))) return true;
  return false;
}

function shouldUseResponsesImageFallback(response, settings, maskB64) {
  return Boolean(
    response &&
    response.status === 404 &&
    maskB64 &&
    /\/images\/edits$/i.test(normalizePath(settings.editPath || "/images/edits")) &&
    !state.unsupportedResponsesEditEndpoints?.has?.(getResponsesEditEndpointKey(settings)) &&
    settings.apiKey &&
    settings.baseUrl
  );
}

function getImageEditInputFidelity(model, hasMask = false) {
  const value = String(model || "").toLowerCase();
  if (!hasMask) return "";
  if (/gpt-image-1|chatgpt-image-latest/.test(value)) return "high";
  return "";
}

function markEditEndpointUnsupported(settings) {
  state.unsupportedEditEndpoints?.add?.(getEditEndpointKey(settings));
}

function getEditEndpointKey(settings) {
  return `${normalizeBaseUrl(settings?.baseUrl || "")}${normalizePath(settings?.editPath || "/images/edits")}`;
}

function markResponsesEditEndpointUnsupported(settings) {
  state.unsupportedResponsesEditEndpoints?.add?.(getResponsesEditEndpointKey(settings));
}

function getResponsesEditEndpointKey(settings) {
  return `${normalizeBaseUrl(settings?.baseUrl || "")}/responses`;
}

function isResponsesEditEndpointUnsupported(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  const message = String(error?.message || error?.responseText || "").toLowerCase();
  if (error?.noImageGenerationCall) return true;
  return status === 404 ||
    /endpoint not supported|not_found|not found|unsupported|unknown endpoint|invalid_request_error|没有返回 image_generation_call|no image_generation_call/.test(message);
}


async function requestResponsesImageEditFallback(settings, prompt, imageB64, maskB64, options = {}) {
  const imageBytes = estimateBase64Bytes(imageB64);
  const maskBytes = maskB64 ? estimateBase64Bytes(maskB64) : 0;
  const payload = {
    model: DEFAULT_SEMANTIC_EDIT_MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildResponsesImageEditPrompt(prompt, Boolean(maskB64), options),
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${stripDataUrl(imageB64)}`,
            detail: "high",
          },
        ].filter(Boolean),
      },
    ],
    tools: [
      {
        type: "image_generation",
        ...(getResponsesImageEditModel(settings.model) ? { model: getResponsesImageEditModel(settings.model) } : {}),
        size: options.size || settings.size || "auto",
        quality: normalizeResponsesImageQuality(settings.quality),
        output_format: normalizeImageOutputFormat(settings.format),
        action: "edit",
        ...(maskB64 ? { input_image_mask: { image_url: `data:image/png;base64,${stripDataUrl(maskB64)}` } } : {}),
        ...(getImageEditInputFidelity(settings.model, Boolean(maskB64))
          ? { input_fidelity: getImageEditInputFidelity(settings.model, Boolean(maskB64)) }
          : {}),
      },
    ],
    tool_choice: { type: "image_generation" },
  };

  setStatus(`正在用 Responses 图像工具重绘：图像 ${formatBytes(imageBytes)}，Mask ${formatBytes(maskBytes)}`);
  const response = await sendRequest(buildApiUrl(settings.baseUrl, "/responses"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    timeoutMs: options.timeoutMs || state.requestTimeoutMs || 12 * 60 * 1000,
  }, "Responses 图像重绘");

  const text = await response.text();
  let json = parseResponsesJsonText(text);
  if (!json) {
    const error = new Error(`Responses 图像重绘返回异常：${text.slice(0, 300)}`);
    error.status = response.status;
    error.responseText = text;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(formatOpenAIResponseError(response, formatOpenAIError(json, response.statusText), {
      kind: "Responses 图像重绘",
      endpointPath: "/responses",
      endpointUrl: buildApiUrl(settings.baseUrl, "/responses"),
    }));
    error.status = response.status;
    error.responseText = text;
    throw error;
  }

  const items = parseResponsesImageGenerationItems(json, settings.format, {
    skipPreviewCrop: true,
  });
  if (!items.length) {
    const outputText = extractResponsesOutputText(json);
    const outputTypes = extractResponsesOutputTypes(json);
    console.warn("[responses-edit] no image_generation_call; falling back when possible", {
      outputTypes,
      outputText: outputText.slice(0, 240),
    });
    const error = new Error(outputText
      ? `Responses 图像重绘没有返回图片：${outputText.slice(0, 180)}`
      : "Responses 图像重绘成功，但没有返回 image_generation_call 图片");
    error.noImageGenerationCall = true;
    error.status = response.status;
    error.responseText = text;
    error.responseJson = json;
    error.responsesOutputTypes = outputTypes;
    throw error;
  }
  return items;
}

function getResponsesImageEditModel(model) {
  const value = String(model || "").trim();
  if (/^(?:gpt-image|chatgpt-image)/i.test(value)) return value;
  return "";
}

function buildResponsesImageEditPrompt(prompt, hasMask, options = {}) {
  const size = options.size ? `Requested output size: ${options.size}.` : "";
  return [
    "Edit the provided Photoshop image as a local inpaint task.",
    hasMask
      ? "Use the input_image_mask exactly like ChatGPT image editing: transparent pixels are the editable brush area; non-transparent pixels are protected context. Change only the transparent masked area."
      : "Use the whole provided crop as context and make only the requested change.",
    hasMask
      ? "Do not draw masks, rectangles, black boxes, guides, borders, or overlays. Keep every unmasked detail visually identical, including edges that touch the brush boundary."
      : "",
    "Return one PNG image. Preserve the same composition, identity, line art, colors, lighting, shading, scale, and 2D game-icon style.",
    "Do not redesign the character, head, eyes, nose, ears, hair, scarf, props, background, or any unrelated details.",
    "The result will be composited back into the original Photoshop document, so keep the requested change aligned to the original image and make boundary transitions natural.",
    size,
    "",
    String(prompt || "").trim(),
  ].filter(Boolean).join("\n");
}

function parseResponsesImageGenerationItems(json, fallbackFormat = "png", options = {}) {
  const output = Array.isArray(json?.output) ? json.output : [];
  return output
    .filter((item) => item?.type === "image_generation_call" && typeof item.result === "string" && item.result.length)
    .map((item) => ({
      b64: item.result,
      format: item.output_format || normalizeImageOutputFormat(fallbackFormat),
      skipMaskComposite: Boolean(options.skipMaskComposite),
      skipPreviewCrop: Boolean(options.skipPreviewCrop),
    }));
}

function extractResponsesOutputText(json) {
  if (!json || typeof json !== "object") return "";
  if (typeof json.output_text === "string") return json.output_text.trim();

  const chunks = [];
  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    if (typeof item?.text === "string") {
      chunks.push(item.text);
    }
    if (Array.isArray(item?.content)) {
      for (const content of item.content) {
        if (typeof content?.text === "string") {
          chunks.push(content.text);
        } else if (typeof content?.content === "string") {
          chunks.push(content.content);
        }
      }
    }
  }
  return chunks.join("\n").trim();
}

function extractResponsesOutputTypes(json) {
  const output = Array.isArray(json?.output) ? json.output : [];
  return output.map((item) => item?.type).filter(Boolean).join(", ");
}

function normalizeResponsesImageQuality(quality) {
  const value = String(quality || "").toLowerCase();
  if (["low", "medium", "high"].includes(value)) return value;
  return "low";
}

function normalizeImageOutputFormat(format) {
  const value = String(format || "").toLowerCase();
  if (value === "jpg") return "jpeg";
  if (["png", "jpeg", "webp"].includes(value)) return value;
  return "png";
}

async function requestKoukoutuCutout(settings, imageB64) {
  const imageBytes = estimateBase64Bytes(imageB64);
  if (imageBytes > 40 * 1024 * 1024) {
    throw new Error(`抠抠图上传图片过大：${formatBytes(imageBytes)}，请缩小选区或画布后重试`);
  }

  const outputFormat = settings.koukoutuFormat === "webp" ? "webp" : "png";
  const form = new FormData();
  form.append("model_key", "background-removal");
  form.append("image_file", base64ToBlob(imageB64, "image/png"), "photoshop-input.png");
  form.append("output_format", outputFormat);
  // Keep the returned PNG the same size as the exported Photoshop region.
  // If the API crops to the subject bbox, it does not return the crop offset,
  // so the layer cannot be placed back at the original canvas coordinates.
  form.append("crop", "0");
  form.append("border", String(settings.koukoutuBorder || 0));
  form.append("stamp_crop", "0");
  form.append("response", "bytes");

  setProgress(64, true);
  setStatus(`正在上传到抠抠图：${formatBytes(imageBytes)}，输出 ${outputFormat.toUpperCase()}，保持原图尺寸`);
  const response = await sendRequest(KOUKOUTU_SYNC_URL, {
    method: "POST",
    headers: {
      "X-API-Key": settings.koukoutuApiKey,
    },
    body: form,
    responseType: "arraybuffer",
    timeoutMs: 180000,
  }, "抠抠图抠图");

  if (!response.ok) {
    const detail = await readResponseTextSafe(response);
    throw new Error(`抠抠图失败：HTTP ${response.status} ${formatKoukoutuError(detail)}`);
  }

  setProgress(82, true);
  setStatus("抠抠图已返回透明图，正在准备导入...");
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) {
    throw new Error("抠抠图返回为空");
  }
  const outputB64 = arrayBufferToBase64(buffer);
  await saveDebugBase64Image(`cutout-last-koukoutu-output.${outputFormat}`, outputB64);
  return {
    b64: outputB64,
    importB64: outputB64,
    format: outputFormat,
  };
}

async function requestSingleComfyEdit(settings, prompt, imageB64, maskB64, options = {}) {
  if (!imageB64 || !maskB64) {
    throw new Error("ComfyUI 预设目前只接局部重绘/局部补丁流程，请先选择需要编辑的区域。");
  }

  const preset = getComfyWorkflowPreset(settings.model);
  if (!preset) {
    throw new Error(`${getComfyPresetLabel(settings.model)} 还没有绑定 workflow JSON。`);
  }

  const statsResponse = await sendRequest(buildComfyUrl(settings.comfyUrl, "/system_stats"), {
    method: "GET",
  }, "ComfyUI 状态检查");
  if (!statsResponse.ok) {
    throw new Error(`ComfyUI 不可用：HTTP ${statsResponse.status}`);
  }

  const workflow = await loadComfyWorkflow(preset);
  setProgress(60, true);
  setStatus(`正在准备 ${preset.label} 输入图和编辑 mask...`);
  const maskedInputB64 = await createComfyMaskInputBase64(imageB64, maskB64);
  await saveDebugBase64Image("comfy-last-mask-input.png", maskedInputB64);

  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  setProgress(62, true);
  setStatus(`正在上传 ${preset.label} 输入到 ComfyUI...`);
  const uploadName = await uploadComfyImage(
    settings,
    maskedInputB64,
    `${preset.prefix}_${runId}_input.png`,
  );
  const preparedWorkflow = prepareComfyWorkflow(workflow, {
    imageName: uploadName,
    prompt,
    seed: createRandomSeed(),
    prefix: `${preset.prefix}_${runId}`,
  });

  setProgress(64, true);
  setStatus(`正在提交 ${preset.label} workflow...`);
  const promptId = await queueComfyWorkflow(settings, preparedWorkflow);
  setProgress(72, true);
  setStatus(`正在等待 ${preset.label} 输出...`);
  const imageRef = await waitForComfyOutput(settings, promptId);
  setProgress(84, true);
  setStatus("正在下载 ComfyUI 输出图...");
  const outputB64 = await downloadComfyImage(settings, imageRef);
  return [{ b64: outputB64, format: "png" }];
}

async function requestComfyCutout(settings, prompt, imageB64) {
  const statsResponse = await sendRequest(buildComfyUrl(settings.comfyUrl, "/system_stats"), {
    method: "GET",
  }, "ComfyUI 状态检查");
  if (!statsResponse.ok) {
    throw new Error(`ComfyUI 不可用：HTTP ${statsResponse.status}`);
  }

  setProgress(62, true);
  setStatus("正在上传抠图输入到 ComfyUI...");
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const uploadName = await uploadComfyImage(
    settings,
    imageB64,
    `codex_ps_cutout_${runId}_input.png`,
  );
  const prefix = `codex_ps_cutout_${runId}`;
  const workflow = buildComfyCutoutWorkflow(uploadName, prompt, prefix);

  setProgress(68, true);
  setStatus("正在提交 ComfyUI 抠图 workflow...");
  const promptId = await queueComfyWorkflow(settings, workflow);
  setProgress(74, true);
  setStatus("正在等待 ComfyUI 抠图输出...");
  const imageRef = await waitForComfyOutput(settings, promptId);
  setProgress(84, true);
  setStatus("正在下载 ComfyUI 抠图 PNG...");
  const outputB64 = await downloadComfyImage(settings, imageRef);
  await saveDebugBase64Image("cutout-last-comfy-output.png", outputB64);
  return {
    b64: outputB64,
    importB64: outputB64,
    format: "png",
  };
}

async function resolveCutoutPrompt(settings, prompt, imageB64) {
  const profile = await analyzeCutoutImageProfile(imageB64);
  const manualPrompt = hasManualCutoutPrompt(prompt);

  if (manualPrompt) {
    return prompt;
  }

  if (profile.hasUsefulAlpha) {
    setStatus("已识别到透明通道：使用原始 alpha 抠图...");
    return "alpha 透明通道，直接保留原图已有透明边缘";
  }

  const gptPlan = await requestGptCutoutPlan(settings, imageB64, profile);
  if (gptPlan?.prompt) {
    setStatus(`GPT 抠图策略：${gptPlan.prompt}`);
    return gptPlan.prompt;
  }

  const fallbackPrompt = getFallbackCutoutPrompt(profile);
  setStatus(`自动抠图策略：${fallbackPrompt}`);
  return fallbackPrompt;
}

function hasManualCutoutPrompt(prompt) {
  const firstLine = String(prompt || "").trim().split(/\n/)[0].trim().toLowerCase();
  return Boolean(firstLine && firstLine !== "auto" && firstLine !== "自动");
}

async function analyzeCutoutImageProfile(imageB64) {
  const source = await loadImage(`data:image/png;base64,${stripDataUrl(imageB64)}`);
  const sourceWidth = source.naturalWidth || source.width;
  const sourceHeight = source.naturalHeight || source.height;
  const maxSide = 512;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let transparent = 0;
  let semitransparent = 0;
  let edgeCount = 0;
  let edgeR = 0;
  let edgeG = 0;
  let edgeB = 0;
  const edgeBand = Math.max(2, Math.round(Math.min(width, height) * 0.04));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = pixels[index + 3];
      if (alpha < 8) transparent += 1;
      if (alpha > 8 && alpha < 245) semitransparent += 1;
      if (x < edgeBand || y < edgeBand || x >= width - edgeBand || y >= height - edgeBand) {
        edgeR += pixels[index];
        edgeG += pixels[index + 1];
        edgeB += pixels[index + 2];
        edgeCount += 1;
      }
    }
  }

  const total = Math.max(1, width * height);
  const avgR = edgeCount ? edgeR / edgeCount : 255;
  const avgG = edgeCount ? edgeG / edgeCount : 255;
  const avgB = edgeCount ? edgeB / edgeCount : 255;
  const brightness = (avgR + avgG + avgB) / 3;
  const spread = Math.max(avgR, avgG, avgB) - Math.min(avgR, avgG, avgB);

  return {
    width: sourceWidth,
    height: sourceHeight,
    transparentRatio: transparent / total,
    semitransparentRatio: semitransparent / total,
    hasUsefulAlpha: transparent / total > 0.005 || semitransparent / total > 0.005,
    edgeBrightness: brightness,
    edgeColorSpread: spread,
    edgeIsWhite: brightness > 232 && spread < 28,
    edgeIsBlack: brightness < 42 && spread < 42,
  };
}

async function requestGptCutoutPlan(settings, imageB64, profile) {
  if (!settings.apiKey || !settings.baseUrl) {
    return null;
  }

  setProgress(48, true);
  setStatus("正在用 GPT 识别抠图策略...");
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      strategy: {
        type: "string",
        enum: [
          "source_alpha",
          "rmbg_subject",
          "white_background_subject",
          "black_background_effect",
          "blue_effect",
          "red_or_fire_effect",
          "green_effect",
        ],
      },
      prompt: { type: "string" },
      confidence: { type: "number" },
      reason: { type: "string" },
    },
    required: ["strategy", "prompt", "confidence", "reason"],
  };
  const payload = {
    model: DEFAULT_CUTOUT_ANALYSIS_MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Analyze this Photoshop cutout input and return JSON only.",
              "Choose the best transparent PNG extraction strategy for ComfyUI.",
              "Use source_alpha only if the image already contains meaningful transparency.",
              "Use rmbg/subject strategies for opaque white or clean studio backgrounds with characters, props, monsters, weapons, or objects.",
              "Use color/effect strategies only for glow, fire, lightning, smoke, or magic effects on a dark background.",
              `Local pixel hints: ${JSON.stringify(profile)}`,
            ].join("\n"),
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${stripDataUrl(imageB64)}`,
            detail: "low",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "cutout_strategy",
        strict: true,
        schema,
      },
    },
  };

  try {
    const response = await sendRequest(buildApiUrl(settings.baseUrl, "/responses"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, "GPT 抠图策略识别");
    if (!response.ok) return null;
    const json = parseResponsesJsonText(await response.text());
    const plan = parseGptCutoutPlan(json);
    return plan ? normalizeGptCutoutPlan(plan, profile) : null;
  } catch (error) {
    console.warn("GPT cutout analysis failed", error);
    return null;
  }
}

function parseGptCutoutPlan(json) {
  if (json?.output_text) {
    try {
      return JSON.parse(json.output_text);
    } catch (error) {
      return null;
    }
  }

  const message = (json?.output || []).find((item) => item?.type === "message");
  const text = (message?.content || []).find((item) => item?.type === "output_text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function parseResponsesJsonText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (error) {
    // Some OpenAI-compatible local relays return SSE-style `data:` lines even
    // for non-streaming /responses calls. Prefer the final JSON payload and
    // ignore [DONE] markers so semantic helpers do not silently disable.
    const dataLines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]");

    for (let index = dataLines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(dataLines[index]);
      } catch (lineError) {
        // Keep scanning older data lines.
      }
    }
  }

  return null;
}

function normalizeGptCutoutPlan(plan, profile) {
  if (!plan || typeof plan !== "object") return null;
  if (plan.strategy === "source_alpha" && !profile.hasUsefulAlpha) {
    return { ...plan, prompt: getFallbackCutoutPrompt(profile) };
  }
  const map = {
    source_alpha: "alpha 透明通道，直接保留原图已有透明边缘",
    rmbg_subject: "rmbg 主体抠图，保留角色/物体，移除背景",
    white_background_subject: "rmbg 白底主体抠图，保留角色/物体，移除白色背景",
    black_background_effect: "黑底光效抠图，保留亮部和半透明边缘",
    blue_effect: "蓝色电光/冰晶特效抠图，保留蓝色亮部和半透明边缘",
    red_or_fire_effect: "火焰/红色光效抠图，保留暖色亮部和半透明边缘",
    green_effect: "绿色光效抠图，保留绿色亮部和半透明边缘",
  };
  return { ...plan, prompt: map[plan.strategy] || plan.prompt || getFallbackCutoutPrompt(profile) };
}

function getFallbackCutoutPrompt(profile) {
  if (profile.hasUsefulAlpha) return "alpha 透明通道，直接保留原图已有透明边缘";
  if (profile.edgeIsBlack) return "黑底光效抠图，保留亮部和半透明边缘";
  return "rmbg 主体抠图，保留角色/物体，移除背景";
}

function buildComfyCutoutWorkflow(imageName, prompt, prefix) {
  if (shouldUseRmbgCutout(prompt)) {
    return {
      "1": {
        class_type: "LoadImage",
        inputs: {
          image: imageName,
        },
      },
      "2": {
        class_type: "RMBG",
        inputs: {
          image: ["1", 0],
          model: "RMBG-2.0",
          sensitivity: 0.9,
          process_res: 1536,
          mask_blur: 1,
          mask_offset: 0,
          invert_output: false,
          refine_foreground: true,
          background: "Alpha",
          background_color: "#00000000",
        },
      },
      "3": {
        class_type: "SaveImageWithAlpha",
        inputs: {
          images: ["2", 0],
          mask: ["2", 1],
          filename_prefix: prefix,
        },
      },
    };
  }

  const channel = getComfyCutoutChannel(prompt);
  const invert = shouldInvertComfyCutoutMask(prompt);
  const useSourceAlpha = channel === "source_alpha";
  const saveMaskInput = useSourceAlpha ? ["1", 1] : invert ? ["3", 0] : ["2", 0];
  const workflow = {
    "1": {
      class_type: "LoadImage",
      inputs: {
        image: imageName,
      },
    },
    "4": {
      class_type: "SaveImageWithAlpha",
      inputs: {
        images: ["1", 0],
        mask: saveMaskInput,
        filename_prefix: prefix,
      },
    },
  };

  if (!useSourceAlpha) {
    workflow["2"] = {
      class_type: "ImageToMask",
      inputs: {
        image: ["1", 0],
        channel,
      },
    };
  }

  if (!useSourceAlpha && invert) {
    workflow["3"] = {
      class_type: "InvertMask",
      inputs: {
        mask: ["2", 0],
      },
    };
  }

  return workflow;
}

function shouldUseRmbgCutout(prompt) {
  const value = String(prompt || "").toLowerCase();
  if (/黑底|black|光效|glow|火|flame|fire|电|雷|lightning|electric|magic/.test(value)) {
    return false;
  }
  return /rmbg|remove background|主体|角色|物体|怪物|武器|白底|white|background removal|subject|character|object/.test(value);
}

function getComfyCutoutChannel(prompt) {
  const value = String(prompt || "").toLowerCase();
  if (/透明通道|alpha|source_alpha/.test(value)) return "source_alpha";
  if (/红|red/.test(value)) return "red";
  if (/蓝|电|雷|lightning|electric|blue|cyan/.test(value)) return "blue";
  if (/绿|green/.test(value)) return "green";
  if (/黑底|black|光效|glow|火|flame|fire|magic/.test(value)) return "red";
  return "red";
}

function shouldInvertComfyCutoutMask(prompt) {
  const value = String(prompt || "").toLowerCase();
  if (/黑底|black|光效|glow|火|flame|fire|电|lightning|magic|透明通道|alpha/.test(value)) {
    return false;
  }
  if (/白底|white|背景白|remove white/.test(value)) {
    return true;
  }
  return false;
}

async function loadComfyWorkflow(preset) {
  const pluginFolder = await fs.getPluginFolder();
  const workflowFolder = await pluginFolder.getEntry("comfyui-workflows");
  const workflowFile = await workflowFolder.getEntry(preset.file);
  const text = await workflowFile.read();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`workflow JSON 解析失败：${preset.file}`);
  }
}

async function uploadComfyImage(settings, b64, fileName) {
  const form = new FormData();
  form.append("image", base64ToBlob(b64, "image/png"), fileName);
  form.append("type", "input");
  form.append("overwrite", "true");

  const response = await sendRequest(buildComfyUrl(settings.comfyUrl, "/upload/image"), {
    method: "POST",
    body: form,
  }, "上传 ComfyUI 输入图");
  const text = await response.text();
  let json = {};
  try {
    json = JSON.parse(text || "{}");
  } catch (error) {
    throw new Error(`ComfyUI 上传返回异常：${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`ComfyUI 上传失败：HTTP ${response.status} ${json?.error || text}`);
  }
  const name = json.name || fileName;
  return json.subfolder ? `${json.subfolder}/${name}` : name;
}

function prepareComfyWorkflow(workflow, { imageName, prompt, seed, prefix }) {
  const next = JSON.parse(JSON.stringify(workflow));
  const clipTextNodes = [];

  Object.entries(next).forEach(([nodeId, node]) => {
    const inputs = node.inputs || {};
    if (node.class_type === "LoadImage" && Object.prototype.hasOwnProperty.call(inputs, "image")) {
      inputs.image = imageName;
    }
    if (node.class_type === "CLIPTextEncode") {
      clipTextNodes.push([nodeId, node]);
    }
    if (node.class_type === "KSampler" && Object.prototype.hasOwnProperty.call(inputs, "seed")) {
      inputs.seed = seed;
    }
    if (node.class_type === "SaveImage" && Object.prototype.hasOwnProperty.call(inputs, "filename_prefix")) {
      inputs.filename_prefix = prefix;
    }
  });

  clipTextNodes.sort(([left], [right]) => Number(left) - Number(right));
  if (clipTextNodes[0]) {
    clipTextNodes[0][1].inputs.text = prompt;
  }
  if (clipTextNodes[1] && !String(clipTextNodes[1][1].inputs.text || "").trim()) {
    clipTextNodes[1][1].inputs.text = "";
  }

  return next;
}

async function queueComfyWorkflow(settings, workflow) {
  const body = JSON.stringify({
    client_id: createComfyClientId(),
    prompt: workflow,
  });
  const response = await sendRequest(buildComfyUrl(settings.comfyUrl, "/prompt"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }, "提交 ComfyUI workflow");
  const text = await response.text();
  let json = {};
  try {
    json = JSON.parse(text || "{}");
  } catch (error) {
    throw new Error(`ComfyUI 提交返回异常：${text.slice(0, 300)}`);
  }
  const nodeErrors = json.node_errors && Object.keys(json.node_errors).length
    ? json.node_errors
    : null;
  if (!response.ok || json.error || nodeErrors) {
    throw new Error(`ComfyUI workflow 提交失败：${json?.error?.message || JSON.stringify(nodeErrors || json).slice(0, 500)}`);
  }
  if (!json.prompt_id) {
    throw new Error(`ComfyUI 未返回 prompt_id：${text.slice(0, 300)}`);
  }
  return json.prompt_id;
}

async function waitForComfyOutput(settings, promptId) {
  const startedAt = Date.now();
  const timeoutMs = 12 * 60 * 1000;
  while (Date.now() - startedAt < timeoutMs) {
    const elapsedRatio = Math.max(0, Math.min(1, (Date.now() - startedAt) / timeoutMs));
    setProgress(72 + Math.round(elapsedRatio * 10), true);
    const response = await sendRequest(buildComfyUrl(settings.comfyUrl, `/history/${encodeURIComponent(promptId)}`), {
      method: "GET",
    }, "读取 ComfyUI history");
    const text = await response.text();
    if (response.ok && text) {
      let json = {};
      try {
        json = JSON.parse(text);
      } catch (error) {
        json = {};
      }
      const record = json[promptId] || json;
      const imageRef = findComfyOutputImage(record?.outputs);
      if (imageRef) {
        return imageRef;
      }
      if (record?.status?.status_str === "error") {
        throw new Error(`ComfyUI 生成失败：${record?.status?.messages?.slice?.(-1)?.[0] || "unknown error"}`);
      }
    }
    await sleep(1200);
  }
  throw new Error("等待 ComfyUI 输出超时");
}

function findComfyOutputImage(outputs) {
  if (!outputs || typeof outputs !== "object") return null;
  for (const output of Object.values(outputs)) {
    const images = output?.images || [];
    if (images.length) {
      return images[0];
    }
  }
  return null;
}

async function downloadComfyImage(settings, imageRef) {
  const params = new URLSearchParams();
  params.set("filename", imageRef.filename || "");
  params.set("subfolder", imageRef.subfolder || "");
  params.set("type", imageRef.type || "output");
  const response = await sendRequest(buildComfyUrl(settings.comfyUrl, `/view?${params.toString()}`), {
    method: "GET",
    responseType: "arraybuffer",
  }, "下载 ComfyUI 输出图");
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`下载 ComfyUI 输出图失败：HTTP ${response.status} ${detail.slice(0, 200)}`);
  }
  return arrayBufferToBase64(await response.arrayBuffer());
}

async function createComfyMaskInputBase64(originalB64, maskB64) {
  const original = await loadImage(`data:image/png;base64,${stripDataUrl(originalB64)}`);
  const mask = await loadImage(`data:image/png;base64,${stripDataUrl(maskB64)}`);
  const width = original.naturalWidth || original.width;
  const height = original.naturalHeight || original.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(original, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d");
  maskCtx.drawImage(mask, 0, 0, width, height);
  const maskData = maskCtx.getImageData(0, 0, width, height).data;

  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index + 3] = maskData[index + 3];
  }

  ctx.putImageData(imageData, 0, 0);
  return canvasToBase64(canvas);
}

async function createCutoutInputs() {
  if (!app.activeDocument) {
    throw new Error("当前没有打开的 Photoshop 文档");
  }

  const selection = await getSelectionInfo();
  const docSize = getDocumentSize();
  const placementRect = isSelectionValid(selection)
    ? roundRectToPixels(clampRectToDocument(cloneRect(selection), docSize))
    : { left: 0, top: 0, right: docSize.width, bottom: docSize.height, width: docSize.width, height: docSize.height };
  const image = isSelectionValid(selection)
    ? await exportDocumentRegionAsBase64(placementRect)
    : await exportActiveDocumentAsBase64();
  await saveDebugBase64Image("cutout-last-input.png", image);

  return {
    image,
    placementRect,
    targetRect: placementRect,
    displaySize: `${placementRect.width}x${placementRect.height}`,
  };
}

async function createEffectCutoutItem(imageB64, prompt) {
  const cutoutB64 = await createEffectCutoutBase64(imageB64, prompt);
  await saveDebugBase64Image("cutout-last-output.png", cutoutB64);
  return {
    b64: cutoutB64,
    importB64: cutoutB64,
    format: "png",
  };
}

async function createEffectCutoutBase64(imageB64, prompt) {
  setProgress(60, true);
  setStatus("正在读取像素...");
  const source = await loadImage(`data:image/png;base64,${stripDataUrl(imageB64)}`);
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const mode = getCutoutMode(prompt);
  setProgress(66, true);
  setStatus("正在分析背景和抠图类型...");
  const profile = getCutoutBackgroundProfile(data, width, height);
  const alphaScale = getCutoutAlphaScale(prompt);

  setProgress(70, true);
  setStatus("正在计算透明通道...");
  for (let index = 0; index < data.length; index += 4) {
    const sourceAlpha = data[index + 3];
    const extractedAlpha = calculateEffectAlpha(
      data[index],
      data[index + 1],
      data[index + 2],
      sourceAlpha,
      mode,
      profile,
      alphaScale,
    );
    data[index + 3] = extractedAlpha;
  }

  setProgress(80, true);
  setStatus("正在编码透明 PNG...");
  return bytesToBase64(encodePngRgba(width, height, data));
}

function getCutoutMode(prompt) {
  const value = String(prompt || "").toLowerCase();
  if (/火|flame|fire|warm|orange|yellow|red/.test(value)) return "fire";
  if (/蓝|电|雷|lightning|electric|blue|cyan/.test(value)) return "blue";
  if (/紫|magic|purple|violet/.test(value)) return "purple";
  if (/烟|雾|smoke|fog|mist|gray|grey/.test(value)) return "smoke";
  if (/黑底|black/.test(value)) return "black";
  if (/白底|white/.test(value)) return "white";
  return "auto";
}

function getCutoutAlphaScale(prompt) {
  const value = String(prompt || "").toLowerCase();
  if (/半透|透明|translucent|transparent|soft/.test(value)) return 0.62;
  if (/更透|lighter|thin/.test(value)) return 0.45;
  if (/实|solid|opaque/.test(value)) return 1.15;
  return 0.9;
}

function getCutoutBackgroundProfile(data, width, height) {
  const samples = [];
  const sampleSize = Math.max(4, Math.min(24, Math.floor(Math.min(width, height) * 0.08)));
  const corners = [
    [0, 0],
    [width - sampleSize, 0],
    [0, height - sampleSize],
    [width - sampleSize, height - sampleSize],
  ];
  for (const [startX, startY] of corners) {
    for (let y = 0; y < sampleSize; y += 1) {
      for (let x = 0; x < sampleSize; x += 1) {
        const px = Math.max(0, Math.min(width - 1, startX + x));
        const py = Math.max(0, Math.min(height - 1, startY + y));
        const offset = (py * width + px) * 4;
        samples.push((data[offset] + data[offset + 1] + data[offset + 2]) / 3);
      }
    }
  }
  const average = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
  return {
    brightness: average,
    mode: average < 72 ? "black" : average > 184 ? "white" : "mixed",
  };
}

function calculateEffectAlpha(r, g, b, sourceAlpha, mode, profile, alphaScale) {
  if (sourceAlpha <= 0) return 0;
  const brightness = Math.max(r, g, b);
  const darkness = 255 - Math.min(r, g, b);
  const chroma = brightness - Math.min(r, g, b);
  let score = 0;
  const resolvedMode = mode === "auto" ? profile.mode : mode;

  if (resolvedMode === "black") {
    score = Math.max(0, brightness - 8) + Math.max(0, chroma - 18) * 0.45;
  } else if (resolvedMode === "white") {
    score = Math.max(0, darkness - 8) + Math.max(0, chroma - 18) * 0.35;
  } else if (resolvedMode === "fire") {
    const warmth = r * 1.15 + g * 0.58 - b * 1.7;
    score = Math.max(0, warmth - 55) * 0.9 + Math.max(0, chroma - 22) * 0.55 + Math.max(0, r - 115) * 0.25;
    if (brightness < 70 || r < 65 || b > r * 0.86) score = 0;
  } else if (resolvedMode === "blue") {
    const blueScore = b * 1.15 + g * 0.55 - r * 1.2;
    score = Math.max(0, blueScore - 45) + Math.max(0, chroma - 20) * 0.7;
  } else if (resolvedMode === "purple") {
    const purpleScore = r * 0.65 + b * 1.05 - g * 0.8;
    score = Math.max(0, purpleScore - 55) + Math.max(0, chroma - 22) * 0.6;
  } else if (resolvedMode === "smoke") {
    score = profile.mode === "white"
      ? Math.max(0, 240 - ((r + g + b) / 3))
      : Math.max(0, ((r + g + b) / 3) - 18);
    score *= 0.72;
  } else {
    score = Math.max(0, Math.abs(((r + g + b) / 3) - profile.brightness) - 12) * 1.4;
  }

  const extracted = Math.max(0, Math.min(255, score * alphaScale));
  if (sourceAlpha < 245) {
    return Math.round(Math.max(extracted, sourceAlpha * alphaScale));
  }
  return Math.round(extracted);
}

async function compositeItemsWithOriginalMask(items, originalB64, maskB64) {
  if (!maskB64) return items;
  const composited = [];
  const total = Math.max(1, (items || []).length);
  let position = 0;
  for (const item of items || []) {
    position += 1;
    if (!item?.b64) {
      composited.push(item);
      continue;
    }
    if (item.skipMaskComposite) {
      composited.push({
        ...item,
        importB64: item.importB64 || item.b64,
        format: item.format || "png",
      });
      continue;
    }
    setStatus(`正在合成选区结果 ${position}/${total}，非选区保持原图...`);
    await yieldToUi();
    try {
      const composite = await createInpaintCompositeImages(item.b64, originalB64, maskB64);
      composited.push({
        ...item,
        b64: composite.previewB64,
        importB64: composite.importB64,
        format: "png",
        placementMode: "full-region-patch",
      });
    } catch (error) {
      console.warn("[inpaint] composite step skipped, using raw model output:", error?.message || error);
      throw new Error(`模型返回图无法和选区 Mask 合成，已阻止自动导入，避免黑块污染图层：${error?.message || error}`);
    }
  }
  return composited;
}

async function createInpaintCompositeImages(generatedB64, originalB64, maskB64) {
  setStatus("正在载入返回图(1/3 原图)...");
  await yieldToUi();
  const original = await loadImage(`data:image/png;base64,${stripDataUrl(originalB64)}`);
  setStatus("正在载入返回图(2/3 模型输出)...");
  await yieldToUi();
  const generated = await loadImage(`data:image/png;base64,${stripDataUrl(generatedB64)}`);
  setStatus("正在载入返回图(3/3 蒙版)...");
  await yieldToUi();
  const mask = await loadImage(`data:image/png;base64,${stripDataUrl(maskB64)}`);
  const width = original.naturalWidth || original.width;
  const height = original.naturalHeight || original.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(original, 0, 0, width, height);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d");
  maskCtx.drawImage(mask, 0, 0, width, height);
  const maskPixels = maskCtx.getImageData(0, 0, width, height).data;

  const editCanvas = document.createElement("canvas");
  editCanvas.width = width;
  editCanvas.height = height;
  const editCtx = editCanvas.getContext("2d");
  editCtx.drawImage(generated, 0, 0, width, height);
  const editImage = editCtx.getImageData(0, 0, width, height);
  const outputImage = ctx.getImageData(0, 0, width, height);
  const patchImage = ctx.createImageData(width, height);

  setStatus(`正在合成 ${width} x ${height} 选区图层...`);
  for (let index = 0; index < outputImage.data.length; index += 4) {
    const editStrength = (255 - maskPixels[index + 3]) / 255;
    if (editStrength > 0) {
      const patchAlpha = Math.round(editImage.data[index + 3] * editStrength);
      outputImage.data[index] = Math.round((editImage.data[index] * editStrength) + (outputImage.data[index] * (1 - editStrength)));
      outputImage.data[index + 1] = Math.round((editImage.data[index + 1] * editStrength) + (outputImage.data[index + 1] * (1 - editStrength)));
      outputImage.data[index + 2] = Math.round((editImage.data[index + 2] * editStrength) + (outputImage.data[index + 2] * (1 - editStrength)));
      outputImage.data[index + 3] = Math.max(outputImage.data[index + 3], patchAlpha);
      patchImage.data[index] = editImage.data[index];
      patchImage.data[index + 1] = editImage.data[index + 1];
      patchImage.data[index + 2] = editImage.data[index + 2];
      patchImage.data[index + 3] = patchAlpha;
    }
    if (index > 0 && index % 1048576 === 0) {
      await yieldToUi();
    }
  }

  ctx.putImageData(outputImage, 0, 0);
  const patchCanvas = document.createElement("canvas");
  patchCanvas.width = width;
  patchCanvas.height = height;
  patchCanvas.getContext("2d").putImageData(patchImage, 0, 0);

  return {
    previewB64: await canvasToBase64(canvas),
    importB64: await canvasToBase64(patchCanvas),
  };
}

async function createRectClippedImportBase64(imageB64, clipRect, placementRect) {
  if (!imageB64) {
    throw new Error("没有可裁剪的返回图");
  }
  setStatus("正在生成选区保护透明图层...");
  await yieldToUi();
  let decoded;
  try {
    decoded = await decodePngRgbaBase64(imageB64);
  } catch (error) {
    console.warn("[inpaint] direct PNG decode failed; trying UXP image decode", error);
    const source = await loadImage(`data:image/png;base64,${stripDataUrl(imageB64)}`);
    const width = Math.max(1, Math.round(source.naturalWidth || source.width || 1));
    const height = Math.max(1, Math.round(source.naturalHeight || source.height || 1));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    decoded = { width, height, rgba: image.data };
  }
  const { width, height, rgba } = decoded;
  const rect = mapDocumentRectToImageRect(clipRect, placementRect, width, height);
  const left = Math.max(0, Math.min(width, Math.floor(rect.left)));
  const top = Math.max(0, Math.min(height, Math.floor(rect.top)));
  const right = Math.max(left, Math.min(width, Math.ceil(rect.right)));
  const bottom = Math.max(top, Math.min(height, Math.ceil(rect.bottom)));
  const featherPx = getMaskFeatherPixels(width, height, clipRect);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    const clearWholeRow = y < top || y >= bottom;
    for (let x = 0; x < width; x += 1) {
      const alphaOffset = rowOffset + x * 4 + 3;
      if (clearWholeRow || x < left || x >= right) {
        rgba[alphaOffset] = 0;
      } else {
        rgba[alphaOffset] = Math.round(rgba[alphaOffset] * getRectFeatherStrength(x, y, left, top, right, bottom, featherPx));
      }
    }
    if (y > 0 && y % 128 === 0) {
      await yieldToUi();
    }
  }

  return encodeRgbaPngBase64(width, height, rgba);
}

async function createMaskClippedImportBase64(imageB64, maskB64, clipRect, placementRect) {
  if (!imageB64) {
    throw new Error("没有可裁剪的返回图");
  }
  if (!maskB64) {
    return createRectClippedImportBase64(imageB64, clipRect, placementRect);
  }
  setStatus("正在按 Photoshop 选区 Mask 生成透明保护图层...");
  await yieldToUi();
  const image = await decodePngRgbaBase64(imageB64);
  const mask = await decodePngRgbaBase64(maskB64);
  const { width, height, rgba } = image;
  const rect = isSelectionValid(clipRect) && isSelectionValid(placementRect)
    ? mapDocumentRectToImageRect(clipRect, placementRect, width, height)
    : { left: 0, top: 0, right: width, bottom: height };
  const left = Math.max(0, Math.min(width, Math.floor(rect.left)));
  const top = Math.max(0, Math.min(height, Math.floor(rect.top)));
  const right = Math.max(left, Math.min(width, Math.ceil(rect.right)));
  const bottom = Math.max(top, Math.min(height, Math.ceil(rect.bottom)));
  const featherPx = getMaskFeatherPixels(width, height, clipRect);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    const clearWholeRow = y < top || y >= bottom;
    const maskY = Math.min(mask.height - 1, Math.floor((y / Math.max(1, height)) * mask.height));
    for (let x = 0; x < width; x += 1) {
      const alphaOffset = rowOffset + x * 4 + 3;
      if (clearWholeRow || x < left || x >= right) {
        rgba[alphaOffset] = 0;
        continue;
      }
      const maskX = Math.min(mask.width - 1, Math.floor((x / Math.max(1, width)) * mask.width));
      const maskAlpha = mask.rgba[(maskY * mask.width + maskX) * 4 + 3];
      const editStrength = (255 - maskAlpha) / 255;
      const featherStrength = getRectFeatherStrength(x, y, left, top, right, bottom, featherPx);
      rgba[alphaOffset] = Math.round(rgba[alphaOffset] * editStrength * featherStrength);
    }
    if (y > 0 && y % 128 === 0) {
      await yieldToUi();
    }
  }

  return encodeRgbaPngBase64(width, height, rgba);
}

function getMaskFeatherPixels(imageWidth, imageHeight, rect = null) {
  const rectMinSide = isSelectionValid(rect) ? Math.min(rect.width, rect.height) : Math.min(imageWidth, imageHeight);
  const imageMinSide = Math.min(imageWidth, imageHeight);
  return Math.max(2, Math.min(18, Math.round(Math.min(rectMinSide, imageMinSide) * 0.08)));
}

function getRectFeatherStrength(x, y, left, top, right, bottom, featherPx) {
  if (!featherPx || featherPx <= 0) return 1;
  const distance = Math.min(x - left + 1, right - x, y - top + 1, bottom - y);
  return smoothStep01(distance / Math.max(1, featherPx));
}

function smoothStep01(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

async function imageHasOpenMouthPixels(imageB64, maskB64, clipRect, placementRect) {
  try {
    const image = await decodePngRgbaBase64(imageB64);
    const mask = await decodePngRgbaBase64(maskB64);
    const mouth = findOpenMouthBounds(image, mask, clipRect, placementRect);
    return Boolean(mouth && mouth.area >= 18);
  } catch (error) {
    console.warn("[inpaint] open mouth detection skipped", error);
    return false;
  }
}

async function createClosedMouthFallbackImportBase64(originalB64, maskB64, clipRect, placementRect) {
  const original = await decodePngRgbaBase64(originalB64);
  const mask = await decodePngRgbaBase64(maskB64);
  const mouth = findOpenMouthBounds(original, mask, clipRect, placementRect);
  if (!mouth) return null;

  const { width, height, rgba: source } = original;
  const targetImageRect = mapDocumentRectToImageRect(clipRect, placementRect, width, height);
  const targetLeft = Math.max(0, Math.min(width, Math.floor(targetImageRect.left)));
  const targetTop = Math.max(0, Math.min(height, Math.floor(targetImageRect.top)));
  const targetRight = Math.max(targetLeft, Math.min(width, Math.ceil(targetImageRect.right)));
  const targetBottom = Math.max(targetTop, Math.min(height, Math.ceil(targetImageRect.bottom)));
  const outputWidth = Math.max(1, targetRight - targetLeft);
  const outputHeight = Math.max(1, targetBottom - targetTop);
  const output = new Uint8Array(outputWidth * outputHeight * 4);

  const setOutputPixel = (x, y, r, g, b, a) => {
    const localX = x - targetLeft;
    const localY = y - targetTop;
    if (localX < 0 || localX >= outputWidth || localY < 0 || localY >= outputHeight) return;
    const offset = (localY * outputWidth + localX) * 4;
    output[offset] = r;
    output[offset + 1] = g;
    output[offset + 2] = b;
    output[offset + 3] = a;
  };

  const anchorPoints = [
    [targetLeft, targetTop],
    [Math.max(targetLeft, targetRight - 1), targetTop],
    [targetLeft, Math.max(targetTop, targetBottom - 1)],
    [Math.max(targetLeft, targetRight - 1), Math.max(targetTop, targetBottom - 1)],
  ];
  for (const [x, y] of anchorPoints) {
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const offset = (y * width + x) * 4;
    setOutputPixel(x, y, source[offset], source[offset + 1], source[offset + 2], 1);
  }

  const padX = Math.max(5, Math.round(mouth.width * 0.35));
  const padY = Math.max(4, Math.round(mouth.height * 0.45));
  const left = Math.max(0, mouth.left - padX);
  const top = Math.max(0, mouth.top - padY);
  const right = Math.min(width, mouth.right + padX);
  const bottom = Math.min(height, mouth.bottom + padY);
  const fur = sampleSurroundingFurColor(source, width, height, left, top, right, bottom);
  const lineColor = [
    Math.max(20, Math.round(fur[0] * 0.32)),
    Math.max(10, Math.round(fur[1] * 0.22)),
    Math.max(8, Math.round(fur[2] * 0.18)),
  ];

  for (let y = top; y < bottom; y += 1) {
    const ny = (y - top) / Math.max(1, bottom - top - 1);
    for (let x = left; x < right; x += 1) {
      const nx = (x - left) / Math.max(1, right - left - 1);
      const oval = Math.pow((nx - 0.5) / 0.54, 2) + Math.pow((ny - 0.48) / 0.62, 2);
      if (oval > 1.05) continue;
      const shade = 0.9 + 0.16 * (1 - ny) + 0.05 * Math.cos((nx - 0.5) * Math.PI);
      setOutputPixel(x, y, clampByte(fur[0] * shade), clampByte(fur[1] * shade), clampByte(fur[2] * shade), 255);
    }
  }

  const centerY = Math.round(top + (bottom - top) * 0.53);
  const lineLeft = Math.round(left + (right - left) * 0.25);
  const lineRight = Math.round(left + (right - left) * 0.76);
  for (let x = lineLeft; x <= lineRight; x += 1) {
    const t = (x - lineLeft) / Math.max(1, lineRight - lineLeft);
    const y = Math.round(centerY + Math.sin((t - 0.5) * Math.PI) * 1.5);
    for (let dy = -1; dy <= 1; dy += 1) {
      const yy = Math.max(0, Math.min(height - 1, y + dy));
      setOutputPixel(x, yy, lineColor[0], lineColor[1], lineColor[2], 255);
    }
  }

  return {
    b64: await encodeRgbaPngBase64(outputWidth, outputHeight, output),
    placementRect: cloneRect(clipRect),
  };
}

function findOpenMouthBounds(image, mask, clipRect, placementRect) {
  const { width, height, rgba } = image;
  const rect = isSelectionValid(clipRect) && isSelectionValid(placementRect)
    ? mapDocumentRectToImageRect(clipRect, placementRect, width, height)
    : { left: 0, top: 0, right: width, bottom: height };
  const left = Math.max(0, Math.min(width, Math.floor(rect.left)));
  const top = Math.max(0, Math.min(height, Math.floor(rect.top)));
  const right = Math.max(left, Math.min(width, Math.ceil(rect.right)));
  const bottom = Math.max(top, Math.min(height, Math.ceil(rect.bottom)));
  let foundLeft = width;
  let foundTop = height;
  let foundRight = 0;
  let foundBottom = 0;
  let area = 0;

  for (let y = top; y < bottom; y += 1) {
    const ny = (y - top) / Math.max(1, bottom - top);
    if (ny < 0.30) continue;
    const maskY = Math.min(mask.height - 1, Math.floor((y / Math.max(1, height)) * mask.height));
    for (let x = left; x < right; x += 1) {
      const maskX = Math.min(mask.width - 1, Math.floor((x / Math.max(1, width)) * mask.width));
      const maskAlpha = mask.rgba[(maskY * mask.width + maskX) * 4 + 3];
      if (maskAlpha > 230) continue;
      const offset = (y * width + x) * 4;
      const r = rgba[offset];
      const g = rgba[offset + 1];
      const b = rgba[offset + 2];
      const a = rgba[offset + 3];
      if (a < 24) continue;
      const redMouth = r > 75 && g < 135 && b < 120 && r > g * 1.18 && r > b * 1.12;
      const darkMouth = r < 82 && g < 70 && b < 68;
      if (!redMouth && !darkMouth) continue;
      area += 1;
      foundLeft = Math.min(foundLeft, x);
      foundTop = Math.min(foundTop, y);
      foundRight = Math.max(foundRight, x + 1);
      foundBottom = Math.max(foundBottom, y + 1);
    }
  }

  if (area < 10 || foundRight <= foundLeft || foundBottom <= foundTop) return null;
  return {
    left: foundLeft,
    top: foundTop,
    right: foundRight,
    bottom: foundBottom,
    width: foundRight - foundLeft,
    height: foundBottom - foundTop,
    area,
  };
}

function sampleSurroundingFurColor(rgba, width, height, left, top, right, bottom) {
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let count = 0;
  const ring = Math.max(6, Math.round(Math.max(right - left, bottom - top) * 0.35));
  const sampleLeft = Math.max(0, left - ring);
  const sampleTop = Math.max(0, top - ring);
  const sampleRight = Math.min(width, right + ring);
  const sampleBottom = Math.min(height, bottom + ring);
  for (let y = sampleTop; y < sampleBottom; y += 1) {
    for (let x = sampleLeft; x < sampleRight; x += 1) {
      if (x >= left && x < right && y >= top && y < bottom) continue;
      const offset = (y * width + x) * 4;
      const r = rgba[offset];
      const g = rgba[offset + 1];
      const b = rgba[offset + 2];
      const a = rgba[offset + 3];
      if (a < 128) continue;
      const likelyFur = r > 145 && g > 80 && b < 95 && r > g * 1.15;
      if (!likelyFur) continue;
      totalR += r;
      totalG += g;
      totalB += b;
      count += 1;
    }
  }
  if (!count) return [236, 157, 62];
  return [totalR / count, totalG / count, totalB / count];
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mapDocumentRectToImageRect(rect, placementRect, imageWidth, imageHeight) {
  const placement = isSelectionValid(placementRect)
    ? placementRect
    : { left: 0, top: 0, right: imageWidth, bottom: imageHeight, width: imageWidth, height: imageHeight };
  const scaleX = imageWidth / Math.max(1, placement.width);
  const scaleY = imageHeight / Math.max(1, placement.height);
  return {
    left: (rect.left - placement.left) * scaleX,
    top: (rect.top - placement.top) * scaleY,
    right: (rect.right - placement.left) * scaleX,
    bottom: (rect.bottom - placement.top) * scaleY,
  };
}

async function getImportVisibleDocumentRect(importB64, placementRect) {
  if (!importB64 || !isSelectionValid(placementRect)) return null;
  try {
    const image = await decodePngRgbaBase64(importB64);
    const bounds = getAlphaBounds(image.rgba, image.width, image.height, 2);
    if (!bounds) return null;
    return roundRectToPixels(mapImageRectToDocumentRect(bounds, placementRect, image.width, image.height));
  } catch (error) {
    console.warn("[inpaint] visible import rect detection skipped", error);
    return null;
  }
}

function mapImageRectToDocumentRect(rect, placementRect, imageWidth, imageHeight) {
  const placement = isSelectionValid(placementRect)
    ? placementRect
    : { left: 0, top: 0, right: imageWidth, bottom: imageHeight, width: imageWidth, height: imageHeight };
  const scaleX = placement.width / Math.max(1, imageWidth);
  const scaleY = placement.height / Math.max(1, imageHeight);
  return {
    left: placement.left + rect.left * scaleX,
    top: placement.top + rect.top * scaleY,
    right: placement.left + rect.right * scaleX,
    bottom: placement.top + rect.bottom * scaleY,
    width: (rect.right - rect.left) * scaleX,
    height: (rect.bottom - rect.top) * scaleY,
  };
}

function shouldAlignByVisibleBounds(layer, imageSize, visibleRect) {
  const bounds = normalizeBounds(layer?.boundsNoEffects || layer?.bounds);
  if (!bounds || !isSelectionValid(visibleRect)) return false;
  const sourceWidth = Math.max(1, Number(imageSize?.width) || 1);
  const sourceHeight = Math.max(1, Number(imageSize?.height) || 1);
  const boundsLooksCropped = bounds.width < sourceWidth * 0.92 || bounds.height < sourceHeight * 0.92;
  if (!boundsLooksCropped) return false;
  const boundsRatio = bounds.width / Math.max(1, bounds.height);
  const visibleRatio = visibleRect.width / Math.max(1, visibleRect.height);
  const imageRatio = sourceWidth / Math.max(1, sourceHeight);
  return Math.abs(boundsRatio - visibleRatio) <= Math.abs(boundsRatio - imageRatio) + 0.08;
}

async function parseOpenAIImageResponse(response, context = {}) {
  setStatus("正在读取 OpenAI 图片响应...");
  const text = await response.text();
  let json;

  try {
    setStatus("正在解析 OpenAI 返回图片...");
    json = JSON.parse(text);
  } catch (error) {
    const detail = text ? text.slice(0, 300) : response.statusText;
    throw new Error(formatOpenAIResponseError(response, detail, context));
  }

  if (!response.ok) {
    throw new Error(formatOpenAIResponseError(response, formatOpenAIError(json, response.statusText), context));
  }

  const data = json.data || [];
  setStatus(`已解析 ${data.length} 张返回图，正在准备预览...`);
  return data.map((item) => ({
    b64: item.b64_json || item.b64 || null,
    url: item.url || null,
    format: item.output_format || item.format || null,
  }));
}

function formatOpenAIError(json, fallback = "Request failed") {
  const error = json?.error;
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const parts = [error.message, error.code || error.error_code, error.type].filter(Boolean);
    return parts.length ? parts.join(" | ") : JSON.stringify(error).slice(0, 300);
  }
  if (json?.message) {
    return String(json.message);
  }
  return fallback || "Request failed";
}

function formatOpenAIResponseError(response, detail, context = {}) {
  const message = String(detail || response.statusText || "Request failed");
  const base = `HTTP ${response.status}: ${message}`;
  const path = context.endpointPath || "";
  const kind = context.kind || "图片请求";

  if (response.status === 404 && /\/images\/edits$/i.test(path)) {
    return `${base}。${kind}需要图片编辑接口 ${path}，文生图可用不等于选区重绘可用；请把 Base URL 指向支持 OpenAI /v1/images/edits 的服务，或在设置里改成该服务真实的编辑路径。`;
  }

  if (response.status === 404 && /\/images\/generations$/i.test(path)) {
    return `${base}。当前服务没有找到文生图接口 ${path}，请检查 Base URL 和 Image Gen Path。`;
  }

  return base;
}

async function readResponseTextSafe(response) {
  try {
    return await response.text();
  } catch (error) {
    return response.statusText || "";
  }
}

function formatKoukoutuError(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  try {
    const json = JSON.parse(raw);
    const message = json.message || json.msg || json.error || json.detail || raw;
    return typeof message === "string" ? message : JSON.stringify(message).slice(0, 300);
  } catch (error) {
    return raw.slice(0, 300);
  }
}

async function sendRequest(url, options = {}, label = "请求") {
  throwIfCancelled();
  const { responseType, timeoutMs = 180000, forceXhr = false, signal: explicitSignal, ...fetchOptions } = options;
  const signal = explicitSignal || getActiveAbortSignal();
  if (signal && !fetchOptions.signal) {
    fetchOptions.signal = signal;
  }
  if (forceXhr && typeof XMLHttpRequest !== "undefined") {
    try {
      return await sendXhrRequest(url, { responseType, timeoutMs, signal, ...fetchOptions });
    } catch (xhrError) {
      if (isCancelError(xhrError)) throw xhrError;
      console.warn(`[request] XHR failed for ${label}; retrying with fetch`, xhrError);
      try {
        return await fetchWithTimeout(url, fetchOptions, timeoutMs);
      } catch (fetchError) {
        if (isCancelError(fetchError)) throw fetchError;
        throw makeNetworkError(fetchError, url, label);
      }
    }
  }

  try {
    return await fetchWithTimeout(url, fetchOptions, timeoutMs);
  } catch (fetchError) {
    if (isCancelError(fetchError)) throw fetchError;
    if (fetchError?.name === "RequestTimeoutError") {
      throw makeNetworkError(fetchError, url, label);
    }
    if (typeof XMLHttpRequest === "undefined") {
      throw makeNetworkError(fetchError, url, label);
    }

    try {
      return await sendXhrRequest(url, { responseType, timeoutMs, signal, ...fetchOptions });
    } catch (xhrError) {
      if (isCancelError(xhrError)) throw xhrError;
      throw makeNetworkError(xhrError, url, label);
    }
  }
}

function fetchWithTimeout(url, options, timeoutMs) {
  const signal = options?.signal;
  if (signal?.aborted) {
    return Promise.reject(makeCancelError());
  }
  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(url, options);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      const error = new Error(`request timeout after ${Math.round(timeoutMs / 1000)}s`);
      error.name = "RequestTimeoutError";
      reject(error);
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      try {
        signal?.removeEventListener?.("abort", onAbort);
      } catch (error) {
        // ignore cleanup failure
      }
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(makeCancelError());
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });

    fetch(url, options).then(
      (response) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(response);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(isCancelError(error) ? makeCancelError() : error);
      },
    );
  });
}

function sendXhrRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) {
      reject(makeCancelError());
      return;
    }
    const xhr = new XMLHttpRequest();
    state.activeXhrs?.add?.(xhr);
    let settled = false;
    const cleanup = () => {
      state.activeXhrs?.delete?.(xhr);
      try {
        signal?.removeEventListener?.("abort", onAbort);
      } catch (error) {
        // ignore cleanup failure
      }
    };
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      try {
        xhr.abort();
      } catch (error) {
        // ignore abort failure
      }
      rejectOnce(makeCancelError());
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
    xhr.open(options.method || "GET", url, true);
    xhr.timeout = options.timeoutMs || 180000;
    if (options.responseType) {
      xhr.responseType = options.responseType;
    }

    Object.entries(options.headers || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        xhr.setRequestHeader(key, String(value));
      }
    });

    xhr.onload = () => {
      const getText = () => {
        try {
          return xhr.responseText || "";
        } catch (error) {
          return "";
        }
      };
      resolveOnce({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText,
        text: () => Promise.resolve(getText()),
        arrayBuffer: () => Promise.resolve(xhr.response instanceof ArrayBuffer ? xhr.response : new ArrayBuffer(0)),
      });
    };
    xhr.onerror = () => rejectOnce(new Error("Network request failed"));
    xhr.ontimeout = () => rejectOnce(new Error("request timeout"));
    xhr.onabort = () => rejectOnce(makeCancelError());
    xhr.send(options.body || null);
  });
}

function makeNetworkError(error, url, label) {
  const detail = error?.message || String(error || "Network request failed");
  return new Error(`${label}网络失败：${detail}。地址：${safeUrlForMessage(url)}`);
}

function safeUrlForMessage(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch (error) {
    return String(value || "").slice(0, 160);
  }
}

async function exportActiveDocumentAsBase64() {
  if (!app.activeDocument) {
    throw new Error("当前没有打开的 Photoshop 文档");
  }

  const folder = await fs.getTemporaryFolder();
  const file = await folder.createFile("openai_reference.png", { overwrite: true });
  await core.executeAsModal(async () => {
    await app.activeDocument.saveAs.png(file, null, true);
  }, { commandName: "Export OpenAI reference" });

  const buffer = await file.read({ format: storage.formats.binary });
  return arrayBufferToBase64(buffer);
}

async function exportActiveDocumentForSplit(docSize) {
  const maxEdge = 1024;
  const sourceWidth = Math.max(1, Math.round(docSize?.width || toNumber(app.activeDocument?.width) || 1));
  const sourceHeight = Math.max(1, Math.round(docSize?.height || toNumber(app.activeDocument?.height) || 1));
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  if (scale >= 1) {
    return {
      image: await exportActiveDocumentAsBase64(),
      docSize: { width: sourceWidth, height: sourceHeight },
    };
  }

  const folder = await fs.getTemporaryFolder();
  const file = await folder.createFile("openai_split_reference.png", { overwrite: true });
  let duplicateDoc = null;
  await core.executeAsModal(async () => {
    duplicateDoc = await app.activeDocument.duplicate("OpenAI split reference", true);
    try {
      await duplicateDoc.resizeImage(width, height);
      await duplicateDoc.saveAs.png(file, null, true);
    } finally {
      if (duplicateDoc) {
        await duplicateDoc.closeWithoutSaving();
      }
    }
  }, { commandName: "Export OpenAI split reference" });

  const buffer = await file.read({ format: storage.formats.binary });
  return {
    image: arrayBufferToBase64(buffer),
    docSize: { width, height },
  };
}

async function exportDocumentRegionAsBase64(rect, outputSize) {
  if (!app.activeDocument) {
    throw new Error("当前没有打开的 Photoshop 文档");
  }

  const folder = await fs.getTemporaryFolder();
  const file = await folder.createFile("openai_inpaint_region.png", { overwrite: true });
  const cropRect = roundRectToPixels(rect);
  let duplicateDoc = null;

  await core.executeAsModal(async () => {
    const sourceDoc = app.activeDocument;
    duplicateDoc = await sourceDoc.duplicate("OpenAI inpaint region", false);
    try {
      try {
        await duplicateDoc.flatten();
      } catch (error) {
        console.warn("[export] flatten duplicated region document failed", error);
      }
      await cropDocumentToRect(duplicateDoc, cropRect);
      if (outputSize?.width && outputSize?.height) {
        const currentWidth = Math.round(toNumber(duplicateDoc.width));
        const currentHeight = Math.round(toNumber(duplicateDoc.height));
        if (currentWidth !== outputSize.width || currentHeight !== outputSize.height) {
          await duplicateDoc.resizeImage(outputSize.width, outputSize.height);
        }
      }
      await duplicateDoc.saveAs.png(file, null, true);
    } finally {
      if (duplicateDoc) {
        await duplicateDoc.closeWithoutSaving();
      }
    }
  }, { commandName: "Export OpenAI inpaint region" });

  const buffer = await file.read({ format: storage.formats.binary });
  return arrayBufferToBase64(buffer);
}

async function splitGeneratedImageIntoElementItems(sourceItem, docSize) {
  if (!sourceItem) {
    throw new Error("gpt-image-2 没有返回可拆分的图片");
  }

  let source;
  try {
    source = await imageItemToRgba(sourceItem, docSize);
  } catch (error) {
    console.warn("[split] PNG pixel decode failed; placing full-canvas model output", error);
    return [createFullCanvasSplitItem(sourceItem, docSize, "整体拆图结果", 1)];
  }
  const { width, height, rgba } = source;
  const { mask, workingRgba } = createSplitForegroundMask(rgba, width, height);
  const minArea = Math.max(80, Math.floor(width * height * 0.00008));
  const components = findSplitComponents(mask, width, height, minArea).slice(0, MAX_SPLIT_LAYERS);

  if (!components.length) {
    throw new Error("gpt-image-2 返回了图片，但没有检测到可拆分的独立元素");
  }

  const fullRect = {
    left: 0,
    top: 0,
    right: docSize?.width || width,
    bottom: docSize?.height || height,
    width: docSize?.width || width,
    height: docSize?.height || height,
  };

  return components.map((component, index) => {
    const layerRgba = new Uint8Array(width * height * 4);
    for (const pixelIndex of component.pixels) {
      const offset = pixelIndex * 4;
      layerRgba[offset] = workingRgba[offset];
      layerRgba[offset + 1] = workingRgba[offset + 1];
      layerRgba[offset + 2] = workingRgba[offset + 2];
      layerRgba[offset + 3] = workingRgba[offset + 3];
    }

    return {
      b64: bytesToBase64(encodePngRgba(width, height, layerRgba)),
      format: "png",
      splitIndex: index + 1,
      splitBounds: component.bounds,
      targetRect: fullRect,
      placementRect: fullRect,
    };
  });
}

async function normalizeSemanticSplitLayerItem(sourceItem, docSize, label, splitIndex) {
  if (!sourceItem) return null;

  let source;
  try {
    source = await imageItemToRgba(sourceItem, docSize);
  } catch (error) {
    console.warn(`[split] PNG pixel decode failed for ${label}; placing full-canvas model output`, error);
    return createFullCanvasSplitItem(sourceItem, docSize, label, splitIndex);
  }
  const { width, height, rgba } = source;
  const { mask, workingRgba } = createSplitForegroundMask(rgba, width, height);
  const bounds = getMaskBounds(mask, width, height);
  if (!bounds) return null;

  const minArea = Math.max(80, Math.floor(width * height * 0.00008));
  if (bounds.area < minArea) return null;

  const fullRect = {
    left: 0,
    top: 0,
    right: docSize?.width || width,
    bottom: docSize?.height || height,
    width: docSize?.width || width,
    height: docSize?.height || height,
  };
  const layerRgba = new Uint8Array(width * height * 4);

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const offset = index * 4;
    layerRgba[offset] = workingRgba[offset];
    layerRgba[offset + 1] = workingRgba[offset + 1];
    layerRgba[offset + 2] = workingRgba[offset + 2];
    layerRgba[offset + 3] = workingRgba[offset + 3] || 255;
  }

  return {
    b64: bytesToBase64(encodePngRgba(width, height, layerRgba)),
    format: "png",
    splitIndex,
    splitLabel: label,
    splitBounds: {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.width,
      height: bounds.height,
    },
    targetRect: fullRect,
    placementRect: fullRect,
  };
}

function createFullCanvasSplitItem(sourceItem, docSize, label, splitIndex) {
  const width = Math.max(1, Math.round(docSize?.width || 1));
  const height = Math.max(1, Math.round(docSize?.height || 1));
  const b64 = stripDataUrl(sourceItem.importB64 || sourceItem.b64 || "");
  const fullRect = {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
  };
  return {
    ...sourceItem,
    b64,
    importB64: sourceItem.importB64 || sourceItem.b64 || null,
    previewB64: b64,
    previewBounds: fullRect,
    format: sourceItem.format || "png",
    splitIndex,
    splitLabel: label,
    splitBounds: fullRect,
    targetRect: fullRect,
    placementRect: fullRect,
    whiteMatteMask: true,
  };
}

async function imageItemToRgba(item, targetSize = null) {
  const b64 = item.importB64 || item.b64;
  if (!b64) {
    throw new Error("拆图结果缺少图片数据");
  }

  const image = await loadImage(`data:image/png;base64,${stripDataUrl(b64)}`);
  const sourceWidth = Math.max(1, Math.round(image.width || image.naturalWidth || 1));
  const sourceHeight = Math.max(1, Math.round(image.height || image.naturalHeight || 1));
  const width = Math.max(1, Math.round(targetSize?.width || sourceWidth));
  const height = Math.max(1, Math.round(targetSize?.height || sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { width, height, rgba: new Uint8Array(imageData.data) };
}

function createSplitForegroundMask(sourceRgba, width, height) {
  const total = width * height;
  const workingRgba = new Uint8Array(sourceRgba);
  const mask = new Uint8Array(total);
  let visible = 0;
  let transparent = 0;

  for (let index = 0; index < total; index += 1) {
    const alpha = workingRgba[index * 4 + 3];
    if (alpha > SPLIT_ALPHA_THRESHOLD) visible += 1;
    if (alpha < 240) transparent += 1;
  }

  const hasUsefulAlpha = visible > 0 && visible < total * 0.98 && transparent > total * 0.02;
  if (hasUsefulAlpha) {
    for (let index = 0; index < total; index += 1) {
      mask[index] = workingRgba[index * 4 + 3] > SPLIT_ALPHA_THRESHOLD ? 1 : 0;
    }
    return { mask, workingRgba };
  }

  const bg = estimateCornerBackgroundColor(workingRgba, width, height);
  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    const distance = colorDistance(workingRgba[offset], workingRgba[offset + 1], workingRgba[offset + 2], bg.r, bg.g, bg.b);
    const isForeground = workingRgba[offset + 3] > SPLIT_ALPHA_THRESHOLD && distance > 42;
    mask[index] = isForeground ? 1 : 0;
    workingRgba[offset + 3] = isForeground ? 255 : 0;
  }
  return { mask, workingRgba };
}

function estimateCornerBackgroundColor(rgba, width, height) {
  const sample = Math.max(4, Math.min(24, Math.floor(Math.min(width, height) / 12)));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const addSample = (x, y) => {
    const offset = (y * width + x) * 4;
    r += rgba[offset];
    g += rgba[offset + 1];
    b += rgba[offset + 2];
    count += 1;
  };

  for (let y = 0; y < sample; y += 1) {
    for (let x = 0; x < sample; x += 1) {
      addSample(x, y);
      addSample(width - 1 - x, y);
      addSample(x, height - 1 - y);
      addSample(width - 1 - x, height - 1 - y);
    }
  }

  return {
    r: Math.round(r / Math.max(1, count)),
    g: Math.round(g / Math.max(1, count)),
    b: Math.round(b / Math.max(1, count)),
  };
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function findSplitComponents(mask, width, height, minArea) {
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const components = [];

  for (let start = 0; start < total; start += 1) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    const pixels = [];
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const current = queue[head++];
      pixels.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }

    if (pixels.length >= minArea) {
      components.push({
        pixels,
        area: pixels.length,
        bounds: {
          left: minX,
          top: minY,
          right: maxX + 1,
          bottom: maxY + 1,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        },
      });
    }
  }

  return components
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_SPLIT_LAYERS)
    .sort((a, b) => (a.bounds.top - b.bounds.top) || (a.bounds.left - b.bounds.left));
}

async function prepareCroppedPreviews(items) {
  for (const item of items || []) {
    if (!item || item.previewB64 || item.url || !item.b64 || item.skipPreviewCrop) continue;
    try {
      const preview = await createVisiblePixelPreview(item);
      if (preview) {
        item.previewB64 = preview.b64;
        item.previewBounds = preview.bounds;
      }
    } catch (error) {
      console.warn("cropped preview failed", error);
    }
  }
}

async function createVisiblePixelPreview(item) {
  const source = await imageItemToRgba(item);
  const { width, height, rgba } = source;
  const bounds = getAlphaBounds(rgba, width, height, SPLIT_ALPHA_THRESHOLD);
  if (!bounds) return null;

  const totalArea = width * height;
  const visibleArea = bounds.width * bounds.height;
  if (visibleArea > totalArea * 0.86) return null;

  const pad = Math.max(8, Math.round(Math.max(bounds.width, bounds.height) * 0.08));
  const crop = {
    left: Math.max(0, bounds.left - pad),
    top: Math.max(0, bounds.top - pad),
    right: Math.min(width, bounds.right + pad),
    bottom: Math.min(height, bounds.bottom + pad),
  };
  crop.width = Math.max(1, crop.right - crop.left);
  crop.height = Math.max(1, crop.bottom - crop.top);

  const cropped = new Uint8Array(crop.width * crop.height * 4);
  for (let y = 0; y < crop.height; y += 1) {
    const sourceStart = ((crop.top + y) * width + crop.left) * 4;
    const sourceEnd = sourceStart + crop.width * 4;
    cropped.set(rgba.subarray(sourceStart, sourceEnd), y * crop.width * 4);
  }

  return {
    b64: bytesToBase64(encodePngRgba(crop.width, crop.height, cropped)),
    bounds: crop,
  };
}

function getAlphaBounds(rgba, width, height, threshold) {
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  let found = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(y * width + x) * 4 + 3];
      if (alpha <= threshold) continue;
      found = true;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x + 1 > right) right = x + 1;
      if (y + 1 > bottom) bottom = y + 1;
    }
  }

  if (!found) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function getMaskBounds(mask, width, height) {
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  let area = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      area += 1;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x + 1 > right) right = x + 1;
      if (y + 1 > bottom) bottom = y + 1;
    }
  }

  if (!area) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top, area };
}

async function cropDocumentToRect(documentRef, rect) {
  const bounds = {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };

  try {
    await documentRef.crop(bounds);
  } catch (error) {
    await documentRef.crop([bounds.left, bounds.top, bounds.right, bounds.bottom]);
  }
}

async function importSelected() {
  const item = getSelectedResult();
  if (!item) return;

  try {
    setBusy(true);
    const isSplitElement = item.mode === "split";
    const shouldForceCapturedSelection = isCapturedRegionResult(item);
    const shouldFit = isSplitElement || shouldForceCapturedSelection || $("fitSelectionInput").checked;
    const liveSelection = shouldFit && !shouldForceCapturedSelection && !item.placementRect && !item.targetRect
      ? await getSelectionInfo()
      : null;
    const placementRect = isSplitElement
      ? (item.placementRect || item.targetRect)
      : shouldForceCapturedSelection
      ? (item.placementRect || item.targetRect)
      : shouldFit
      ? (item.placementRect || item.targetRect || liveSelection)
      : null;
    const shouldMaskCapturedSelection = shouldForceCapturedSelection && item.placementMode !== "direct-selection-patch";
    const cropRect = isSplitElement
      ? null
      : item.mode === "outpaint"
      ? null
      : shouldMaskCapturedSelection
      ? item.mode === "reference" ? null : (item.cropRect || item.targetRect)
      : shouldFit ? item.cropRect : null;
    const layerName = item.mode === "cutout"
      ? "Koukoutu Cutout"
      : item.mode === "outpaint"
      ? "OpenAI Outpaint"
      : isSplitElement
      ? buildSplitLayerName(item, item.splitIndex)
      : item.mode === "reference" && shouldForceCapturedSelection
      ? "OpenAI Reference"
      : shouldForceCapturedSelection
      ? "OpenAI Inpaint"
      : "OpenAI Image";
    let itemToPlace = item;
    let cropRectToPlace = cropRect;
    if (isMaskedInpaintLayerResult(item) && !item.preclippedImport && isSelectionValid(cropRect) && isSelectionValid(placementRect)) {
      setStatus("正在准备选区保护透明图层...");
      const clippedImport = await createRectClippedImportBase64(item.importB64 || item.b64, cropRect, placementRect);
      itemToPlace = {
        ...item,
        importB64: clippedImport,
        format: "png",
        preclippedImport: true,
      };
      cropRectToPlace = null;
    }
    const needsPostImportMask = isMaskedInpaintLayerResult(itemToPlace) && !itemToPlace.preclippedImport;
    if (item.mode === "outpaint") {
      await expandCanvasForOutpaint(item.outpaintPadding, item.targetRect || item.placementRect, item.outpaintBaseSize);
    }
    await placeResultAsLayer(itemToPlace, placementRect, layerName, needsPostImportMask ? cropRectToPlace : null, {
      fitByImageSize: isMaskedInpaintLayerResult(itemToPlace),
      alignVisibleRect: isMaskedInpaintLayerResult(itemToPlace),
      preserveImageAspect: item.mode === "cutout" || item.mode === "outpaint" || isSplitElement || item.placementMode === "full-region-patch",
      rasterizeBeforeMask: needsPostImportMask,
      useCurrentSelectionMask: false,
      selectionChannelName: needsPostImportMask ? (item.selectionChannelName || null) : null,
      useSavedSelectionMask: false,
      requireMask: needsPostImportMask,
      moveToFront: item.mode === "inpaint",
    });
    setStatus(shouldForceCapturedSelection ? "已按生成时选区裁切导入" : "已导入到当前文档");
  } catch (error) {
    console.error(error);
    setStatus(`导入失败：${error.message || error}`);
  } finally {
    setBusy(false);
  }
}

function isCapturedRegionResult(item) {
  return (item?.mode === "inpaint" || item?.mode === "cutout" || item?.mode === "reference" || item?.mode === "outpaint") &&
    (isSelectionValid(item.placementRect) || isSelectionValid(item.targetRect));
}

function buildSplitLayerName(item, fallbackIndex) {
  const index = item?.splitIndex || fallbackIndex || "";
  const label = String(item?.splitLabel || "").trim();
  return label ? `Split ${index} ${label}` : `Split Element ${index}`.trim();
}

async function placeResultAsLayer(item, selectionInfo, layerName, cropRect = null, opts = {}) {
  const binary = await resultToArrayBuffer(item, true);
  const format = item.format || detectFormatFromResult(item) || "png";
  const imageSize = getValidatedImageSize(binary, format);

  if (!app.activeDocument) {
    await core.executeAsModal(async () => {
      await app.documents.add({
        width: imageSize.width,
        height: imageSize.height,
        resolution: 72,
        mode: "RGBColorMode",
        fill: "transparent",
      });
    }, { commandName: "Create OpenAI document" });
  }

  const folder = await fs.getTemporaryFolder();
  const extension = ["png", "jpeg", "jpg", "webp"].includes(format) ? format : "png";
  const file = await folder.createFile(`openai_result.${extension}`, { overwrite: true });
  await file.write(binary, { format: storage.formats.binary });
  const token = await fs.createSessionToken(file);

  let importedLayer;
  await core.executeAsModal(async () => {
    if (opts.moveToFront) {
      try {
        await selectFrontLayerForPlacementInModal();
      } catch (error) {
        console.warn("[place] select front layer before placement failed; placing above current layer", error);
      }
    }
    await action.batchPlay([
      {
        _obj: "placeEvent",
        null: { _path: token, _kind: "local" },
        freeTransformCenterState: {
          _enum: "quadCenterState",
          _value: "QCSCorner0",
        },
        offset: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: 0 },
          vertical: { _unit: "pixelsUnit", _value: 0 },
        },
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { modalBehavior: "execute" });
    importedLayer = app.activeDocument.activeLayers[0];
    importedLayer.name = layerName;
  }, { commandName: "Place OpenAI image" });

  if (isSelectionValid(selectionInfo) && importedLayer) {
    if (opts.fitByImageSize) {
      if (opts.alignVisibleRect && isSelectionValid(item.importVisibleRect) && shouldAlignByVisibleBounds(importedLayer, imageSize, item.importVisibleRect)) {
        await transformLayerToRect(importedLayer, item.importVisibleRect);
      } else {
        await transformLayerByImageRect(importedLayer, imageSize, selectionInfo);
      }
    } else if (opts.preserveImageAspect) {
      // For cutout-style placement: the returned PNG often has transparent
      // padding around the subject. Using layer.bounds (tight visible bbox)
      // for scaling would stretch the subject because the bbox aspect ≠ the
      // full PNG aspect. Scale by the *full* PNG dimensions instead and let
      // the transparent margins land where they belong.
      await transformLayerByImageAspect(importedLayer, imageSize, selectionInfo);
    } else {
      await transformLayerToRect(importedLayer, selectionInfo);
    }
  }

  if (opts.rasterizeBeforeMask && importedLayer) {
    try {
      await rasterizeLayerForMask(importedLayer);
    } catch (error) {
      console.warn("[inpaint] rasterize before mask failed; trying mask on placed layer", error);
    }
  }

  const selectionChannelName = opts.selectionChannelName || null;
  const allowSavedSelectionMask = Boolean(opts.useSavedSelectionMask && selectionChannelName);
  let maskApplied = false;

  if (opts.useCurrentSelectionMask && importedLayer) {
    try {
      const activeSelection = await getSelectionInfo();
      if (!isSelectionValid(activeSelection)) {
        throw new Error("当前 Photoshop 选区为空");
      }
      await applyCurrentSelectionMaskToLayer(importedLayer);
      maskApplied = true;
    } catch (error) {
      console.warn("[inpaint] current selection mask failed; falling back to rectangular mask", error);
    }
  }

  if (!maskApplied && allowSavedSelectionMask && importedLayer) {
    try {
      await applySavedSelectionMaskToLayer(importedLayer, selectionChannelName);
      maskApplied = true;
    } catch (error) {
      console.warn("[inpaint] saved selection mask failed; falling back to rectangular mask", error);
    }
  }

  if (!maskApplied && isSelectionValid(cropRect) && importedLayer) {
    try {
      await applyRectMaskToLayer(importedLayer, cropRect);
      maskApplied = true;
    } catch (error) {
      console.warn("[inpaint] rectangular mask failed", error);
      if (opts.requireMask) {
        await removeImportedLayerSafely(importedLayer);
        throw new Error(`选区 Mask 创建失败，已撤销导入以避免改到选区外：${error.message || error}`);
      }
    }
  }

  if (selectionChannelName) {
    await removeSelectionChannelByName(selectionChannelName);
  }

  if (opts.requireMask && !maskApplied && importedLayer) {
    await removeImportedLayerSafely(importedLayer);
    throw new Error("选区 Mask 创建失败，已撤销导入以避免改到选区外");
  }

  if ((opts.removeWhiteMatte || item.whiteMatteMask) && importedLayer) {
    try {
      await applyWhiteMatteMaskToLayer(importedLayer);
    } catch (error) {
      console.warn("[split] white matte mask failed", error);
    }
  }
}

async function applyCurrentSelectionMaskToLayer(layer) {
  if (!app.activeDocument) {
    throw new Error("当前没有打开的 Photoshop 文档");
  }
  await core.executeAsModal(async () => {
    await action.batchPlay([
      {
        _obj: "select",
        _target: [{ _id: layer.id, _ref: "layer" }],
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      },
      {
        _obj: "make",
        new: { _class: "channel" },
        at: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        using: { _enum: "userMaskEnabled", _value: "revealSelection" },
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName: "Mask OpenAI image to current selection" });
}

async function saveActiveSelectionSnapshot(selection) {
  if (!app.activeDocument || !isSelectionValid(selection)) return null;
  const channelName = `${TEMP_SELECTION_CHANNEL_PREFIX}${Date.now().toString(36)}`;
  let savedName = channelName;

  try {
    await core.executeAsModal(async () => {
      const doc = app.activeDocument;
      if (!doc?.selection || typeof doc.selection.save !== "function") {
        throw new Error("Photoshop selection.save is unavailable");
      }
      const savedChannel = await doc.selection.save(channelName);
      if (savedChannel?.name) {
        savedName = savedChannel.name;
      }
    }, { commandName: "Save OpenAI inpaint selection" });
    console.log("[inpaint] saved selection snapshot", savedName);
    return savedName;
  } catch (error) {
    console.warn("[inpaint] exact selection snapshot failed; rectangular mask fallback will be used", error);
    return null;
  }
}

async function applySavedSelectionMaskToLayer(layer, channelName) {
  if (!app.activeDocument) {
    throw new Error("当前没有打开的 Photoshop 文档");
  }
  if (!channelName) {
    throw new Error("没有可用的临时选区通道");
  }

  console.log("[inpaint] applying saved selection layer mask", channelName);
  await core.executeAsModal(async () => {
    await restoreSelectionFromChannel(channelName);
    await action.batchPlay([
      {
        _obj: "select",
        _target: [{ _id: layer.id, _ref: "layer" }],
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      },
      {
        _obj: "make",
        new: { _class: "channel" },
        at: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        using: { _enum: "userMaskEnabled", _value: "revealSelection" },
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName: "Mask OpenAI image to saved selection" });
  console.log("[inpaint] saved selection layer mask applied");
}

async function restoreSelectionFromChannel(channelName) {
  try {
    await action.batchPlay([
      {
        _obj: "set",
        _target: [{ _ref: "channel", _property: "selection" }],
        to: { _ref: "channel", _name: channelName },
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" });
    return;
  } catch (error) {
    console.warn("[inpaint] batchPlay selection restore failed; trying DOM selection.load", error);
  }

  const doc = app.activeDocument;
  const channel = findDocumentChannelByName(doc, channelName);
  if (!channel || !doc?.selection || typeof doc.selection.load !== "function") {
    throw new Error(`无法恢复临时选区通道：${channelName}`);
  }
  await doc.selection.load(channel);
}

async function removeSelectionChannelByName(channelName) {
  if (!app.activeDocument || !channelName) return;
  try {
    await core.executeAsModal(async () => {
      const channel = findDocumentChannelByName(app.activeDocument, channelName);
      if (channel && typeof channel.delete === "function") {
        await channel.delete();
        return;
      }
      if (channel && typeof channel.remove === "function") {
        await channel.remove();
        return;
      }
      await action.batchPlay([
        {
          _obj: "delete",
          _target: [{ _ref: "channel", _name: channelName }],
          _options: { dialogOptions: "dontDisplay" },
        },
      ], { synchronousExecution: true, modalBehavior: "execute" });
    }, { commandName: "Remove OpenAI inpaint selection" });
  } catch (error) {
    console.warn("[inpaint] temporary selection channel cleanup failed", error);
  }
}

function findDocumentChannelByName(doc, channelName) {
  if (!doc || !channelName) return null;
  for (const collection of [doc.channels, doc.alphaChannels]) {
    for (const channel of collectionToArray(collection)) {
      if (channel?.name === channelName) return channel;
    }
  }
  return null;
}

function collectionToArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  try {
    if (typeof collection[Symbol.iterator] === "function") {
      return Array.from(collection);
    }
  } catch (error) {
    // Fall through to index-based access below.
  }
  const length = Number(collection.length);
  if (!Number.isFinite(length) || length <= 0) return [];
  const items = [];
  for (let index = 0; index < length; index += 1) {
    try {
      const item = collection[index] || (typeof collection.item === "function" ? collection.item(index) : null);
      if (item) items.push(item);
    } catch (error) {
      // Ignore sparse or inaccessible collection entries.
    }
  }
  return items;
}

async function prepareMaskedInpaintLayers(items, inpaint) {
  const prepared = [];
  const total = Math.max(1, (items || []).length);
  let index = 0;
  for (const item of items || []) {
    index += 1;
    setStatus(`正在准备选区保护图层 ${index}/${total}...`);
    const sourceImportB64 = item?.importB64 || item?.b64 || null;
    const canPreclipImport = Boolean(sourceImportB64 && isSelectionValid(inpaint.targetRect) && isSelectionValid(inpaint.placementRect));
    let importB64 = sourceImportB64;
    let placementRect = inpaint.placementRect;
    if (canPreclipImport) {
      try {
        importB64 = await createMaskClippedImportBase64(sourceImportB64, inpaint.mask, inpaint.targetRect, inpaint.placementRect);
      } catch (error) {
        console.warn("[inpaint] mask alpha clip failed; falling back to rectangular clip", error);
        importB64 = await createRectClippedImportBase64(sourceImportB64, inpaint.targetRect, inpaint.placementRect);
      }
    }
    prepared.push({
      ...item,
      importB64,
      previewB64: importB64,
      format: item?.format || "png",
      placementMode: "selection-mask-layer",
      targetRect: inpaint.targetRect,
      placementRect,
      importVisibleRect: await getImportVisibleDocumentRect(importB64, placementRect),
      cropRect: null,
      selectionChannelName: null,
      preclippedImport: canPreclipImport,
      skipPreviewCrop: true,
    });
    await yieldToUi();
  }
  return prepared;
}

function isMaskedInpaintLayerResult(item) {
  return item?.mode === "inpaint" && item?.placementMode === "selection-mask-layer";
}

async function transformLayerByImageRect(layer, imageSize, targetRect) {
  const sourceWidth = Math.max(1, Number(imageSize?.width) || 1);
  const sourceHeight = Math.max(1, Number(imageSize?.height) || 1);
  const docSize = getDocumentSize();
  const currentLeft = docSize.width / 2 - sourceWidth / 2;
  const currentTop = docSize.height / 2 - sourceHeight / 2;
  const dx = targetRect.left - currentLeft;
  const dy = targetRect.top - currentTop;
  const scaleX = (targetRect.width / sourceWidth) * 100;
  const scaleY = (targetRect.height / sourceHeight) * 100;

  if (
    Math.abs(dx) < 0.5 &&
    Math.abs(dy) < 0.5 &&
    Math.abs(scaleX - 100) < 0.5 &&
    Math.abs(scaleY - 100) < 0.5
  ) {
    return;
  }

  await core.executeAsModal(async () => {
    await action.batchPlay([
      {
        _obj: "select",
        _target: [{ _id: layer.id, _ref: "layer" }],
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      },
      {
        _obj: "transform",
        _target: [{ _id: layer.id, _ref: "layer" }],
        freeTransformCenterState: {
          _enum: "quadCenterState",
          _value: "QCSIndependent",
        },
        position: {
          _obj: "paint",
          horizontal: { _unit: "pixelsUnit", _value: currentLeft },
          vertical: { _unit: "pixelsUnit", _value: currentTop },
        },
        offset: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: dx },
          vertical: { _unit: "pixelsUnit", _value: dy },
        },
        width: { _unit: "percentUnit", _value: scaleX },
        height: { _unit: "percentUnit", _value: scaleY },
        linked: false,
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName: "Fit OpenAI image by full image bounds" });
}

async function transformLayerByImageAspect(layer, imageSize, targetRect) {
  // Cutout (and similar) results: the API was given an exported region of the
  // user's selection and returns a PNG at exactly the same pixel dimensions,
  // with the subject at the same pixel positions and the rest made transparent.
  // So we should place the layer 1:1 — NO scaling, just translate it so the
  // full image rectangle lines up with the original selection rect. Doing any
  // bounds-based or image-size-based scaling here would distort the subject.
  const bounds = normalizeBounds(layer.boundsNoEffects || layer.bounds);
  if (!bounds) return;

  // placeEvent centers the image on the canvas (image center = canvas center).
  // So the image's top-left is currently at (docWidth/2 - imageSize.width/2, docHeight/2 - imageSize.height/2).
  // We want the image's top-left at (targetRect.left, targetRect.top).
  const docSize = getDocumentSize();
  const currentLeft = docSize.width / 2 - imageSize.width / 2;
  const currentTop = docSize.height / 2 - imageSize.height / 2;
  const dx = targetRect.left - currentLeft;
  const dy = targetRect.top - currentTop;

  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

  await core.executeAsModal(async () => {
    await action.batchPlay([
      {
        _obj: "select",
        _target: [{ _id: layer.id, _ref: "layer" }],
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      },
      {
        _obj: "transform",
        _target: [{ _id: layer.id, _ref: "layer" }],
        freeTransformCenterState: {
          _enum: "quadCenterState",
          _value: "QCSIndependent",
        },
        position: {
          _obj: "paint",
          horizontal: { _unit: "pixelsUnit", _value: currentLeft },
          vertical: { _unit: "pixelsUnit", _value: currentTop },
        },
        offset: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: dx },
          vertical: { _unit: "pixelsUnit", _value: dy },
        },
        width: { _unit: "percentUnit", _value: 100 },
        height: { _unit: "percentUnit", _value: 100 },
        linked: false,
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName: "Place OpenAI cutout 1:1" });
}

async function resultToArrayBuffer(item, preferImport = false) {
  const itemB64 = preferImport && item.importB64 ? item.importB64 : item.b64;
  if (itemB64) {
    if (typeof itemB64 !== "string") {
      throw new Error("结果图片数据格式不正确：base64 必须是字符串");
    }
    return base64ToArrayBuffer(stripDataUrl(itemB64));
  }

  if (item.url) {
    const response = await sendRequest(item.url, { responseType: "arraybuffer" }, "下载结果");
    if (!response.ok) {
      throw new Error(`下载结果失败：HTTP ${response.status}`);
    }
    return await response.arrayBuffer();
  }

  throw new Error("结果中没有可用的图片数据");
}

function resultToPreviewSrc(item) {
  if (item.url) return item.url;
  if (item.previewUrl) return item.previewUrl;
  if (item.previewB64) {
    return toDataUrl(item.previewB64, "png");
  }
  if (item.b64) {
    const format = item.format || "png";
    try {
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        item.previewUrl = URL.createObjectURL(base64ToBlob(item.b64, mimeTypeForFormat(format)));
        return item.previewUrl;
      }
    } catch (error) {
      console.warn("Blob preview failed, falling back to data URL", error);
    }
    return toDataUrl(item.b64, format);
  }
  return "";
}

function detectFormatFromResult(item) {
  if (item.format) return item.format;
  if (item.url && item.url.includes(".webp")) return "webp";
  if (item.url && (item.url.includes(".jpg") || item.url.includes(".jpeg"))) return "jpeg";
  return "png";
}

async function transformLayerToRect(layer, targetRect) {
  const bounds = normalizeBounds(layer.boundsNoEffects || layer.bounds);
  if (!bounds || !bounds.width || !bounds.height) return;

  const scaleX = (targetRect.width / bounds.width) * 100;
  const scaleY = (targetRect.height / bounds.height) * 100;

  await core.executeAsModal(async () => {
    await action.batchPlay([
      {
        _obj: "transform",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        freeTransformCenterState: {
          _enum: "quadCenterState",
          _value: "QCSIndependent",
        },
        position: {
          _obj: "paint",
          horizontal: { _unit: "pixelsUnit", _value: bounds.left },
          vertical: { _unit: "pixelsUnit", _value: bounds.top },
        },
        offset: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: targetRect.left - bounds.left },
          vertical: { _unit: "pixelsUnit", _value: targetRect.top - bounds.top },
        },
        width: { _unit: "percentUnit", _value: scaleX },
        height: { _unit: "percentUnit", _value: scaleY },
        linked: false,
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName: "Fit OpenAI image" });
}

async function selectFrontLayerForPlacementInModal() {
  await action.batchPlay([
    {
      _obj: "select",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "front" }],
      makeVisible: false,
      _options: { dialogOptions: "dontDisplay" },
    },
  ], { synchronousExecution: true, modalBehavior: "execute" });
}

async function rasterizeLayerForMask(layer) {
  console.log("[inpaint] rasterizing placed result before mask");
  await core.executeAsModal(async () => {
    await action.batchPlay([
      {
        _obj: "select",
        _target: [{ _id: layer.id, _ref: "layer" }],
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      },
      {
        _obj: "rasterizeLayer",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName: "Rasterize OpenAI inpaint layer" });
}

async function applyRectMaskToLayer(layer, rect) {
  throw new Error("Photoshop 选区后处理不可用；应在导入前生成透明保护图层");
}

async function applyWhiteMatteMaskToLayer(layer) {
  await core.executeAsModal(async () => {
    await action.batchPlay([
      {
        _obj: "select",
        _target: [{ _id: layer.id, _ref: "layer" }],
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      },
      {
        _obj: "colorRange",
        fuzziness: 40,
        invert: false,
        colorModel: 0,
        minimum: { _obj: "labColor", luminance: 100, a: 0, b: 0 },
        maximum: { _obj: "labColor", luminance: 100, a: 0, b: 0 },
        _options: { dialogOptions: "dontDisplay" },
      },
      {
        _obj: "make",
        new: { _class: "channel" },
        at: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        using: { _enum: "userMaskEnabled", _value: "hideSelection" },
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName: "Mask OpenAI split white matte" });
}

async function removeImportedLayerSafely(layer) {
  if (!layer) return;
  try {
    await core.executeAsModal(async () => {
      await action.batchPlay([
        {
          _obj: "delete",
          _target: [{ _id: layer.id, _ref: "layer" }],
          _options: { dialogOptions: "dontDisplay" },
        },
      ], { synchronousExecution: true, modalBehavior: "execute" });
    }, { commandName: "Remove unsafe OpenAI layer" });
  } catch (error) {
    console.warn("[place] failed to remove unmasked layer", error);
  }
}

function rectSelectionCommand(rect) {
  return {
    _obj: "set",
    _target: [{ _ref: "channel", _property: "selection" }],
    to: {
      _obj: "rectangle",
      top: { _unit: "pixelsUnit", _value: rect.top },
      left: { _unit: "pixelsUnit", _value: rect.left },
      bottom: { _unit: "pixelsUnit", _value: rect.bottom },
      right: { _unit: "pixelsUnit", _value: rect.right },
    },
    _options: { dialogOptions: "dontDisplay" },
  };
}

async function getSelectionInfo() {
  try {
    const result = await core.executeAsModal(async () => action.batchPlay([
      {
        _obj: "get",
        _target: [
          { _property: "selection" },
          { _ref: "document", _id: app.activeDocument._id },
        ],
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" }), {
      commandName: "Read selection",
    });

    const selection = result[0]?.selection;
    if (!selection) return null;
    return {
      left: toNumber(selection.left),
      right: toNumber(selection.right),
      top: toNumber(selection.top),
      bottom: toNumber(selection.bottom),
      width: toNumber(selection.right) - toNumber(selection.left),
      height: toNumber(selection.bottom) - toNumber(selection.top),
    };
  } catch (error) {
    return null;
  }
}

function isSelectionValid(selection) {
  return selection &&
    Number.isFinite(selection.left) &&
    Number.isFinite(selection.right) &&
    Number.isFinite(selection.top) &&
    Number.isFinite(selection.bottom) &&
    selection.width > 0 &&
    selection.height > 0;
}

function getDocumentSize() {
  if (!app.activeDocument) return { width: 1024, height: 1024 };
  return {
    width: Math.round(toNumber(app.activeDocument.width)),
    height: Math.round(toNumber(app.activeDocument.height)),
  };
}

async function createRectMaskBase64(width, height, selection) {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = 255;
    rgba[index + 1] = 255;
    rgba[index + 2] = 255;
    rgba[index + 3] = 255;
  }

  const left = Math.max(0, Math.floor(selection.left));
  const top = Math.max(0, Math.floor(selection.top));
  const right = Math.min(width, Math.ceil(selection.right));
  const bottom = Math.min(height, Math.ceil(selection.bottom));

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = 255;
      rgba[offset + 1] = 255;
      rgba[offset + 2] = 255;
      rgba[offset + 3] = 0;
    }
  }

  return bytesToBase64(encodePngRgba(width, height, rgba));
}

async function createCanvasRectMaskBase64(width, height, selection) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.fillRect(0, 0, width, height);

    const left = Math.max(0, Math.floor(selection.left));
    const top = Math.max(0, Math.floor(selection.top));
    const right = Math.min(width, Math.ceil(selection.right));
    const bottom = Math.min(height, Math.ceil(selection.bottom));
    ctx.clearRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));

    return await canvasToBase64(canvas);
  } catch (error) {
    console.warn("[mask] canvas rect mask failed; falling back to stored PNG", error);
    return null;
  }
}

async function createInpaintInputs(selection, docSize, model) {
  const targetRect = clampRectToDocument(cloneRect(selection), docSize);
  const placementRect = getInpaintPlacementRect(targetRect, docSize, model);
  const apiSize = getImageEditSizeForSelection(placementRect.width, placementRect.height, model);
  const outputSize = getInpaintOutputSize(placementRect, apiSize, model);
  if (rectsNearlyEqual(placementRect, getFullDocumentRect(docSize))) {
    setStatus(`正在导出整张画布上下文：${placementRect.width}x${placementRect.height}，只允许改选区 ${targetRect.width}x${targetRect.height}`);
  } else if (outputSize) {
    setStatus(`正在导出选区上下文：原区域 ${placementRect.width}x${placementRect.height}，压缩到 ${outputSize.width}x${outputSize.height}`);
  } else {
    setStatus(`正在导出选区上下文：${placementRect.width}x${placementRect.height}，只允许改选区 ${targetRect.width}x${targetRect.height}`);
  }
  const image = await exportDocumentRegionAsBase64(placementRect, outputSize);
  const exportedSize = getPngDimensionsFromBase64(image);
  const mask = await createSelectionMaskBase64(placementRect, targetRect, exportedSize || outputSize);
  await saveDebugBase64Image("openai-last-inpaint-input.png", image);
  await saveDebugBase64Image("openai-last-inpaint-mask.png", mask);

  return {
    image,
    mask,
    apiSize,
    displaySize: `${targetRect.width}x${targetRect.height}`,
    targetRect,
    placementRect,
  };
}

async function resolveSemanticInpaintSelection(settings, prompt, selection, docSize) {
  if (shouldPreserveUserInpaintSelection(settings)) {
    console.log("[inpaint] preserving user selection for sidecar/OpenAI-compatible image edit", JSON.stringify(selection));
    setStatus("使用你画的完整选区作为重绘 Mask");
    return selection;
  }

  const surgicalFeature = isSurgicalFeaturePrompt(prompt);
  const fineFeature = surgicalFeature || isFineLocalFeaturePrompt(prompt);
  if (fineFeature && !isBroadSelectionForSurgicalFeature(selection, docSize)) {
    console.log("[inpaint] using direct user selection for fine feature", JSON.stringify(selection));
    setStatus("使用你画的选区作为唯一可重绘区域");
    return selection;
  }
  const surgicalFallback = surgicalFeature ? getSurgicalFeatureFallbackRect(prompt, selection, docSize) : null;
  if (surgicalFeature) {
    let detectedSurgical = null;
    if (surgicalFallback) {
      try {
        const analysisSize = getSemanticSelectionAnalysisSize(selection);
        const image = await exportDocumentRegionAsBase64(selection, analysisSize);
        await saveDebugBase64Image("openai-last-surgical-selection.png", image);
        detectedSurgical = await detectSurgicalFeatureRectFromImage(prompt, image, selection, docSize);
      } catch (error) {
        console.warn("local surgical feature detection failed", error);
      }
    }
    if (detectedSurgical) {
      console.log("[inpaint] local surgical feature selected", JSON.stringify({ detectedSurgical }));
      setStatus("已按源图像像素定位嘴巴区域，避免重绘整张脸");
      return detectedSurgical;
    }
    if (surgicalFallback) {
      console.log("[inpaint] surgical feature fallback selected", JSON.stringify({ surgicalFallback }));
      setStatus("已将可编辑区域自动收缩到嘴巴附近，避免重绘整张脸");
      return surgicalFallback;
    }
  }

  if (!shouldUseSemanticInpaintSelection(prompt) || !settings.apiKey || !settings.baseUrl) {
    return selection;
  }

  try {
    const analysisSize = getSemanticSelectionAnalysisSize(selection);
    const image = await exportDocumentRegionAsBase64(selection, analysisSize);
    await saveDebugBase64Image("openai-last-semantic-selection.png", image);
    const plan = await requestSemanticInpaintTargetPlan(settings, prompt, image);
    let semanticRect = rectFromSemanticInpaintPlan(plan, prompt, selection, docSize);
    if (!semanticRect && surgicalFeature) {
      semanticRect = await detectSurgicalFeatureRectFromImage(prompt, image, selection, docSize);
    }
    if (!semanticRect && surgicalFeature) {
      semanticRect = getSurgicalFeatureFallbackRect(prompt, selection, docSize);
    }
    if (!semanticRect) return selection;

    const selectionArea = Math.max(1, selection.width * selection.height);
    const semanticArea = Math.max(1, semanticRect.width * semanticRect.height);
    const maxAreaRatio = fineFeature ? 0.42 : 0.92;
    if (semanticArea >= selectionArea * maxAreaRatio) {
      if (surgicalFallback) {
        console.log("[inpaint] semantic feature box too large; using surgical fallback", JSON.stringify({ plan, surgicalFallback }));
        return surgicalFallback;
      }
      return selection;
    }

    console.log("[inpaint] semantic selection resolved", JSON.stringify({ plan, semanticRect }));
    setStatus(`已将可编辑区域收缩到：${plan?.target_description || "局部特征"}`);
    return semanticRect;
  } catch (error) {
    console.warn("semantic inpaint selection failed", error);
    return surgicalFallback || selection;
  }
}

function shouldPreserveUserInpaintSelection(settings) {
  // The ChatGPT-style image editor respects the user's brushed/selected area.
  // Do not rewrite a broad user selection into a smaller semantic rectangle.
  return shouldUseSidecarImageEndpointsFirst(settings, true);
}

function shouldUseSemanticInpaintSelection(prompt) {
  const value = String(prompt || "").toLowerCase();
  if (isSurgicalFeaturePrompt(value) || isFineLocalFeaturePrompt(value)) return true;
  return /替换|换成|改成|变成|人物|角色|小人|国王|英雄|主角|头像|主体|猫|狗|replace|change into|turn into|character|person|subject|cat|dog/.test(value);
}

function isSurgicalFeaturePrompt(value) {
  return /嘴|嘴巴|口|闭嘴|张嘴|表情|眼|眼睛|眉|眉毛|鼻|鼻子|耳|耳朵|胡须|mouth|lips|closed mouth|open mouth|expression|eye|eyes|brow|eyebrow|nose|ear|ears|whisker/.test(String(value || "").toLowerCase());
}

function isFineLocalFeaturePrompt(value) {
  return /头发|发丝|发束|一缕|这一缕|刘海|鬃毛|hair|strand|lock of hair|hair lock|bangs|mane/.test(String(value || "").toLowerCase());
}

function getSurgicalInpaintPromptHint(prompt) {
  const value = String(prompt || "").toLowerCase();
  if (isClosedMouthPrompt(value)) {
    return [
      "把当前张开的红色嘴巴彻底改成闭合嘴。",
      "用周围脸部毛色自然填掉嘴洞、舌头、牙齿和口腔阴影，只保留一条小而自然的闭嘴线。",
      "结果必须是闭嘴表情，不要保留红色开口、舌头、牙齿、黑色嘴洞或圆形张嘴轮廓。",
      "Replace the current open red mouth with a small natural closed mouth line. Fill the mouth cavity with matching surrounding face fur. No open mouth, no tongue, no teeth, no visible mouth cavity.",
    ].join("\n");
  }
  return "";
}

function isClosedMouthPrompt(value) {
  return /闭嘴|嘴巴闭|闭合.*嘴|嘴.*闭合|closed mouth|close.*mouth/.test(String(value || "").toLowerCase());
}

async function detectSurgicalFeatureRectFromImage(prompt, imageB64, selection, docSize) {
  const value = String(prompt || "").toLowerCase();
  if (!/嘴|嘴巴|口|闭嘴|张嘴|mouth|lips/.test(value)) return null;
  if (!isBroadSelectionForSurgicalFeature(selection, docSize)) return null;

  try {
    const image = await decodePngRgbaBase64(imageB64);
    const { width, height, rgba: pixels } = image;
    if (!width || !height) return null;

    const candidate = new Uint8Array(width * height);

    const minMouthY = isClosedMouthPrompt(value) ? 0.70 : 0.55;

    for (let y = 0; y < height; y += 1) {
      const ny = y / Math.max(1, height - 1);
      if (ny < minMouthY || ny > 0.995) continue;
      for (let x = 0; x < width; x += 1) {
        const nx = x / Math.max(1, width - 1);
        if (nx < 0.24 || nx > 0.78) continue;
        const offset = (y * width + x) * 4;
        const r = pixels[offset];
        const g = pixels[offset + 1];
        const b = pixels[offset + 2];
        const a = pixels[offset + 3];
        if (a < 32) continue;

        const redMouth = r > 65 && g < 120 && b < 105 && r > g * 1.22 && r > b * 1.18;
        const darkMouth = ny > 0.42 && r < 95 && g < 80 && b < 70;
        if (redMouth || darkMouth) {
          candidate[y * width + x] = 1;
        }
      }
    }

    const component = findBestMouthComponent(candidate, width, height);
    if (!component) return null;
    const padX = Math.max(8, Math.round(component.width * 0.55));
    const padY = Math.max(8, Math.round(component.height * 0.7));
    const left = Math.max(0, component.left - padX);
    const top = Math.max(0, component.top - padY);
    const right = Math.min(width, component.right + padX);
    const bottom = Math.min(height, component.bottom + padY);
    const rect = {
      left: selection.left + (left / width) * selection.width,
      top: selection.top + (top / height) * selection.height,
      right: selection.left + (right / width) * selection.width,
      bottom: selection.top + (bottom / height) * selection.height,
    };
    rect.width = rect.right - rect.left;
    rect.height = rect.bottom - rect.top;
    const detected = clampRectToDocument(roundRectToPixels(rect), docSize);
    console.log("[inpaint] detected mouth feature box", JSON.stringify({ component, detected }));
    return detected;
  } catch (error) {
    console.warn("mouth feature detection failed", error);
    return null;
  }
}

function findBestMouthComponent(candidate, width, height) {
  const visited = new Uint8Array(candidate.length);
  let best = null;
  const queue = [];

  for (let index = 0; index < candidate.length; index += 1) {
    if (!candidate[index] || visited[index]) continue;
    let head = 0;
    queue.length = 0;
    queue.push(index);
    visited[index] = 1;

    let area = 0;
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    let sumY = 0;

    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;
      sumY += y;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x + 1 > right) right = x + 1;
      if (y + 1 > bottom) bottom = y + 1;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (!candidate[next] || visited[next]) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
    }

    const componentWidth = right - left;
    const componentHeight = bottom - top;
    if (area < 10 || componentWidth < 4 || componentHeight < 4) continue;
    if (componentWidth > width * 0.32 || componentHeight > height * 0.32) continue;

    const centerY = sumY / Math.max(1, area) / Math.max(1, height - 1);
    const centerX = ((left + right) / 2) / Math.max(1, width - 1);
    if (centerX < 0.18 || centerX > 0.78 || centerY < 0.42) continue;

    const score = area * (1 + centerY * 2.2);
    if (!best || score > best.score) {
      best = { left, top, right, bottom, width: componentWidth, height: componentHeight, area, centerX, centerY, score };
    }
  }

  return best;
}

function getSurgicalFeatureFallbackRect(prompt, selection, docSize) {
  const value = String(prompt || "").toLowerCase();
  if (!isBroadSelectionForSurgicalFeature(selection, docSize)) return null;
  if (!/嘴|嘴巴|口|闭嘴|张嘴|mouth|lips/.test(value)) return null;

  const width = Math.max(132, Math.round(selection.width * 0.22));
  const height = Math.max(150, Math.round(selection.height * 0.32));
  const centerX = selection.left + selection.width * 0.60;
  const centerY = selection.top + selection.height * 0.95;
  return clampRectToDocument(roundRectToPixels({
    left: centerX - width / 2,
    top: centerY - height / 2,
    right: centerX + width / 2,
    bottom: centerY + height / 2,
    width,
    height,
  }), docSize);
}

function isBroadSelectionForSurgicalFeature(selection, docSize) {
  if (!isSelectionValid(selection)) return false;
  const docArea = Math.max(1, (docSize?.width || 1) * (docSize?.height || 1));
  const selectionArea = Math.max(1, selection.width * selection.height);
  // Direct user masks should win. Only auto-shrink when the user selected a
  // broad face/head area; otherwise a carefully drawn mouth mask gets clipped.
  return selection.width >= 260 && selection.height >= 180 && selectionArea >= Math.max(120000, docArea * 0.055);
}

function rectsNearlyEqual(a, b, tolerance = 2) {
  if (!isSelectionValid(a) || !isSelectionValid(b)) return false;
  return Math.abs(a.left - b.left) <= tolerance &&
    Math.abs(a.top - b.top) <= tolerance &&
    Math.abs(a.right - b.right) <= tolerance &&
    Math.abs(a.bottom - b.bottom) <= tolerance;
}

async function setActiveRectSelection(rect, commandName = "OpenAI set narrowed selection") {
  if (!isSelectionValid(rect)) return;
  await core.executeAsModal(async () => {
    await action.batchPlay([rectSelectionCommand(rect)], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName });
}

function getSemanticSelectionAnalysisSize(selection) {
  const sourceWidth = Math.max(1, Math.round(selection.width));
  const sourceHeight = Math.max(1, Math.round(selection.height));
  const maxEdge = 768;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const size = normalizeFlexibleImageSize(sourceWidth * scale, sourceHeight * scale, {
    multiple: 16,
    minPixels: 128 * 128,
    maxPixels: 768 * 768,
    maxEdge: 768,
    maxRatio: 8,
  });
  return parseImageSize(size);
}

async function requestSemanticInpaintTargetPlan(settings, prompt, imageB64) {
  setStatus("正在用 GPT 识别选区里真正要改的局部...");
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      edit_mode: {
        type: "string",
        enum: ["subject_box", "use_user_selection"],
      },
      target_description: { type: "string" },
      normalized_box: {
        type: "object",
        additionalProperties: false,
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["x", "y", "width", "height"],
      },
      confidence: { type: "number" },
      reason: { type: "string" },
    },
    required: ["edit_mode", "target_description", "normalized_box", "confidence", "reason"],
  };

  const payload = {
    model: DEFAULT_SEMANTIC_EDIT_MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Return JSON only. Analyze this Photoshop selected region for a surgical image edit.",
              `User request: ${String(prompt || "").trim()}`,
              "Return the smallest exact editable feature/object in the CURRENT source image, not the final generated result.",
              "If the request names one subject, object, or facial feature to replace/transform, return edit_mode=subject_box and a tight bounding box around only that current source target.",
              "For mouth requests such as close mouth, open mouth, change expression, or lips, box only the current mouth/lips/mouth-cavity area. Do not box the whole face, head, eyes, nose, ears, hair, body, or weapon.",
              "For eye, eyebrow, nose, ear, whisker, or expression requests, box only that specific feature unless the user explicitly asks to redraw the full face.",
              "For hair requests such as one strand, bang, lock of hair, hair tuft, mane, or recolor one visible hair piece, box only that exact current strand/tuft/piece. Do not box the whole hair mass, head, face, ears, body, clothing, weapon, or background.",
              "Do not box preserved UI or scene elements such as chair/throne, cushions, frame, base, bowl, text, numbers, icons, background, props, shadows, or decorative borders unless the user explicitly asks to edit them.",
              "If the user selected a broad region but asks to modify one feature, still return subject_box around only that feature.",
              "Only return edit_mode=use_user_selection when the whole selected region truly must be edited.",
              "Coordinates must be normalized 0..1 relative to this image: x, y, width, height.",
            ].join("\n"),
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${stripDataUrl(imageB64)}`,
            detail: "low",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "semantic_inpaint_target",
        strict: true,
        schema,
      },
    },
  };

  const response = await sendRequest(buildApiUrl(settings.baseUrl, "/responses"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, "GPT 选区主体识别");
  if (!response.ok) return null;
  return parseJsonFromResponseOutput(parseResponsesJsonText(await response.text()));
}

function parseJsonFromResponseOutput(json) {
  if (json?.output_text) {
    try {
      return JSON.parse(json.output_text);
    } catch (error) {
      return null;
    }
  }

  const message = (json?.output || []).find((item) => item?.type === "message");
  const text = (message?.content || []).find((item) => item?.type === "output_text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function rectFromSemanticInpaintPlan(plan, prompt, selection, docSize) {
  const fineFeature = isSurgicalFeaturePrompt(prompt) || isFineLocalFeaturePrompt(prompt);
  const minConfidence = fineFeature ? 0.42 : 0.55;
  if (!plan || plan.edit_mode !== "subject_box" || plan.confidence < minConfidence) {
    return null;
  }

  const box = plan.normalized_box || {};
  const x = clampNumber(box.x, 0, 1, 0);
  const y = clampNumber(box.y, 0, 1, 0);
  const width = clampNumber(box.width, 0, 1, 0);
  const height = clampNumber(box.height, 0, 1, 0);
  if (width <= 0.03 || height <= 0.03) return null;

  const padRatio = fineFeature ? 0.18 : 0.08;
  const padX = Math.max(6, selection.width * width * padRatio);
  const padY = Math.max(6, selection.height * height * padRatio);
  const rect = {
    left: selection.left + selection.width * x - padX,
    top: selection.top + selection.height * y - padY,
    right: selection.left + selection.width * (x + width) + padX,
    bottom: selection.top + selection.height * (y + height) + padY,
  };
  rect.width = rect.right - rect.left;
  rect.height = rect.bottom - rect.top;
  return clampRectToDocument(roundRectToPixels(rect), docSize);
}

async function createReferenceRegionInputs(selection, docSize, model) {
  const targetRect = clampRectToDocument(cloneRect(selection), docSize);
  const placementRect = getInpaintPlacementRect(targetRect, docSize, model);
  const apiSize = getImageEditSizeForSelection(placementRect.width, placementRect.height, model);
  const image = await exportDocumentRegionAsBase64(placementRect, null);
  await saveDebugBase64Image("openai-last-reference-region.png", image);

  return {
    image,
    apiSize,
    displaySize: `${placementRect.width}x${placementRect.height}`,
    targetRect,
    placementRect,
  };
}

function getInpaintOutputSize(placementRect, apiSize, model) {
  if (!isComfyModel(model)) {
    return null;
  }

  const sourceWidth = Math.max(1, Math.round(placementRect.width));
  const sourceHeight = Math.max(1, Math.round(placementRect.height));
  const pixels = sourceWidth * sourceHeight;
  const edge = Math.max(sourceWidth, sourceHeight);
  if (pixels <= COMFY_INPAINT_MAX_PIXELS && edge <= COMFY_INPAINT_MAX_EDGE) {
    return null;
  }

  const scale = Math.min(
    COMFY_INPAINT_MAX_EDGE / edge,
    Math.sqrt(COMFY_INPAINT_MAX_PIXELS / pixels),
  );
  return normalizeFlexibleImageSize(sourceWidth * scale, sourceHeight * scale, {
    multiple: 16,
    minPixels: 256 * 256,
    maxPixels: COMFY_INPAINT_MAX_PIXELS,
    maxEdge: COMFY_INPAINT_MAX_EDGE,
    maxRatio: 8,
  });
}

function getInpaintPlacementRect(targetRect, docSize, model) {
  if (shouldUseFullCanvasInpaintContext(model, docSize)) {
    return getFullDocumentRect(docSize);
  }

  const contextualRect = expandRectForInpaintContext(targetRect, docSize);
  if (supportsFlexibleImageSize(model)) {
    return roundRectToPixels(contextualRect);
  }

  const apiSize = getImageEditSizeForSelection(contextualRect.width, contextualRect.height, model);
  return roundRectToPixels(clampRectToDocument(getPaddedPlacementRect(contextualRect, apiSize), docSize));
}

function shouldUseFullCanvasInpaintContext(model, docSize) {
  if (isComfyModel(model) || /dall-e-2/i.test(String(model || ""))) return false;
  const width = Math.max(1, Math.round(toNumber(docSize?.width) || 1));
  const height = Math.max(1, Math.round(toNumber(docSize?.height) || 1));
  return width * height <= OPENAI_INPAINT_FULL_CANVAS_MAX_PIXELS;
}

function getFullDocumentRect(docSize) {
  const width = Math.max(1, Math.round(toNumber(docSize?.width) || 1));
  const height = Math.max(1, Math.round(toNumber(docSize?.height) || 1));
  return { left: 0, top: 0, right: width, bottom: height, width, height };
}

function expandRectForInpaintContext(targetRect, docSize) {
  const horizontalPadding = getInpaintContextPadding(targetRect.width, 0.18);
  const verticalPadding = getInpaintContextPadding(targetRect.height, 0.25);
  return clampRectToDocument({
    left: targetRect.left - horizontalPadding,
    top: targetRect.top - verticalPadding,
    right: targetRect.right + horizontalPadding,
    bottom: targetRect.bottom + verticalPadding,
  }, docSize);
}

function getInpaintContextPadding(value, ratio) {
  return Math.round(Math.max(64, Math.min(384, value * ratio)));
}

async function createRelativeRectMaskBase64(width, height, sourceRect, targetRect) {
  const scaleX = width / Math.max(1, sourceRect.width);
  const scaleY = height / Math.max(1, sourceRect.height);
  const relative = {
    left: (targetRect.left - sourceRect.left) * scaleX,
    top: (targetRect.top - sourceRect.top) * scaleY,
    right: (targetRect.right - sourceRect.left) * scaleX,
    bottom: (targetRect.bottom - sourceRect.top) * scaleY,
  };
  relative.width = relative.right - relative.left;
  relative.height = relative.bottom - relative.top;
  return createRectMaskBase64(width, height, relative);
}

async function createSelectionMaskBase64(sourceRect, fallbackRect, outputSize = null) {
  // Keep the API mask exactly the same pixel size as the exported image.
  // Prefer the user's actual Photoshop selection shape. If UXP cannot read it
  // reliably, fall back to the rectangular selection bounds instead.
  const expectedWidth = Math.max(1, Math.round(toNumber(outputSize?.width) || sourceRect.width));
  const expectedHeight = Math.max(1, Math.round(toNumber(outputSize?.height) || sourceRect.height));
  if (!imaging?.getSelection || !app.activeDocument) {
    return createRelativeRectMaskBase64(expectedWidth, expectedHeight, sourceRect, fallbackRect);
  }

  let selectionImage = null;
  try {
    selectionImage = await core.executeAsModal(async () => imaging.getSelection({
      documentID: app.activeDocument._id,
      sourceBounds: {
        left: sourceRect.left,
        top: sourceRect.top,
        right: sourceRect.right,
        bottom: sourceRect.bottom,
      },
    }), { commandName: "Read OpenAI inpaint selection mask" });

    const imageData = selectionImage?.imageData;
    const sourceWidth = Math.round(toNumber(imageData?.width) || sourceRect.width);
    const sourceHeight = Math.round(toNumber(imageData?.height) || sourceRect.height);
    const width = expectedWidth;
    const height = expectedHeight;
    const pixels = await imageData.getData({ chunky: true });
    const pixelCount = Math.max(1, sourceWidth * sourceHeight);
    const inferredComponents = Math.floor((pixels?.length || pixelCount) / pixelCount);
    const components = Math.max(1, imageData.components || inferredComponents || 1);

    if (sourceWidth !== width || sourceHeight !== height) {
      console.log("[inpaint] embedding cropped Photoshop selection mask into exported image mask", JSON.stringify({
        selectionMask: `${sourceWidth}x${sourceHeight}`,
        exportedImage: `${width}x${height}`,
        fallbackRect,
      }));
      return createEmbeddedSelectionMaskBase64(width, height, sourceRect, fallbackRect, sourceWidth, sourceHeight, pixels, components);
    }

    const rgba = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(sourceHeight - 1, Math.floor((y / Math.max(1, height)) * sourceHeight));
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(sourceWidth - 1, Math.floor((x / Math.max(1, width)) * sourceWidth));
        const sourceIndex = (sourceY * sourceWidth + sourceX) * components;
        const selected = Math.max(0, Math.min(255, pixels[sourceIndex] || 0));
        const offset = (y * width + x) * 4;
        rgba[offset] = 255;
        rgba[offset + 1] = 255;
        rgba[offset + 2] = 255;
        rgba[offset + 3] = 255 - selected;
      }
    }

    return bytesToBase64(encodePngRgba(width, height, rgba));
  } catch (error) {
    console.warn("createSelectionMaskBase64 failed, using rectangular mask", error);
    return createRelativeRectMaskBase64(expectedWidth, expectedHeight, sourceRect, fallbackRect);
  } finally {
    try {
      selectionImage?.imageData?.dispose?.();
    } catch (error) {
      console.warn("selection image dispose failed", error);
    }
  }
}

function createEmbeddedSelectionMaskBase64(width, height, sourceRect, fallbackRect, selectionWidth, selectionHeight, pixels, components) {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = 255;
    rgba[index + 1] = 255;
    rgba[index + 2] = 255;
    rgba[index + 3] = 255;
  }

  const relative = mapDocumentRectToImageRect(fallbackRect, sourceRect, width, height);
  const left = Math.max(0, Math.min(width, Math.floor(relative.left)));
  const top = Math.max(0, Math.min(height, Math.floor(relative.top)));
  const right = Math.max(left, Math.min(width, Math.ceil(relative.right)));
  const bottom = Math.max(top, Math.min(height, Math.ceil(relative.bottom)));
  const destWidth = Math.max(1, right - left);
  const destHeight = Math.max(1, bottom - top);

  for (let y = top; y < bottom; y += 1) {
    const sourceY = Math.min(selectionHeight - 1, Math.floor(((y - top) / destHeight) * selectionHeight));
    for (let x = left; x < right; x += 1) {
      const sourceX = Math.min(selectionWidth - 1, Math.floor(((x - left) / destWidth) * selectionWidth));
      const sourceIndex = (sourceY * selectionWidth + sourceX) * components;
      const selected = Math.max(0, Math.min(255, pixels[sourceIndex] || 0));
      const offset = (y * width + x) * 4;
      rgba[offset] = 255;
      rgba[offset + 1] = 255;
      rgba[offset + 2] = 255;
      rgba[offset + 3] = 255 - selected;
    }
  }

  return bytesToBase64(encodePngRgba(width, height, rgba));
}

function getPngDimensionsFromBase64(b64) {
  try {
    const bytes = new Uint8Array(base64ToArrayBuffer(stripDataUrl(b64)));
    if (
      bytes.length < 24 ||
      bytes[0] !== 0x89 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x4e ||
      bytes[3] !== 0x47 ||
      bytes[12] !== 0x49 ||
      bytes[13] !== 0x48 ||
      bytes[14] !== 0x44 ||
      bytes[15] !== 0x52
    ) {
      return null;
    }
    const width = readUint32BE(bytes, 16);
    const height = readUint32BE(bytes, 20);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } catch (error) {
    return null;
  }
}

function readUint32BE(bytes, offset) {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function getPaddedPlacementRect(targetRect, apiSize) {
  const apiDimensions = parseImageSize(apiSize);
  if (!apiDimensions || !isSelectionValid(targetRect)) {
    return targetRect;
  }

  const apiRatio = apiDimensions.width / apiDimensions.height;
  const targetRatio = targetRect.width / targetRect.height;
  let width = targetRect.width;
  let height = targetRect.height;

  if (targetRatio > apiRatio) {
    height = width / apiRatio;
  } else {
    width = height * apiRatio;
  }

  const centerX = targetRect.left + targetRect.width / 2;
  const centerY = targetRect.top + targetRect.height / 2;
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    right: centerX + width / 2,
    bottom: centerY + height / 2,
    width,
    height,
  };
}

function parseImageSize(size) {
  const match = String(size || "").match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function getImageEditSizeForSelection(width, height, model) {
  if (!supportsFlexibleImageSize(model)) {
    return nearestStandardImageSize(width, height);
  }

  return constrainFlexibleImageSize(width, height);
}

function supportsFlexibleImageSize(model) {
  return /gpt-image-2/i.test(String(model || "")) || isComfyModel(model);
}

function nearestStandardImageSize(width, height) {
  const ratio = Math.max(0.01, width / Math.max(1, height));
  if (ratio > 1.25) return "1536x1024";
  if (ratio < 0.8) return "1024x1536";
  return "1024x1024";
}

function constrainFlexibleImageSize(width, height) {
  const rules = {
    multiple: 16,
    minPixels: 655360,
    maxPixels: 8294400,
    maxEdge: 3840,
    maxRatio: 3,
  };
  const sourceWidth = Math.max(1, Number(width) || 1);
  const sourceHeight = Math.max(1, Number(height) || 1);
  const ratio = Math.min(
    rules.maxRatio,
    Math.max(1 / rules.maxRatio, sourceWidth / sourceHeight)
  );
  const sourcePixels = sourceWidth * sourceHeight;
  const targetPixels = Math.min(rules.maxPixels, Math.max(rules.minPixels, sourcePixels));

  let outputWidth = Math.sqrt(targetPixels * ratio);
  let outputHeight = outputWidth / ratio;
  const edgeScale = Math.min(1, rules.maxEdge / Math.max(outputWidth, outputHeight));
  outputWidth *= edgeScale;
  outputHeight *= edgeScale;

  return normalizeFlexibleImageSize(outputWidth, outputHeight, rules);
}

function normalizeFlexibleImageSize(width, height, rules) {
  let outputWidth = roundToMultiple(width, rules.multiple);
  let outputHeight = roundToMultiple(height, rules.multiple);

  for (let index = 0; index < 16; index += 1) {
    outputWidth = Math.max(rules.multiple, Math.min(rules.maxEdge, outputWidth));
    outputHeight = Math.max(rules.multiple, Math.min(rules.maxEdge, outputHeight));

    if (outputWidth / outputHeight > rules.maxRatio) {
      outputHeight = ceilToMultiple(outputWidth / rules.maxRatio, rules.multiple);
      continue;
    }

    if (outputHeight / outputWidth > rules.maxRatio) {
      outputWidth = ceilToMultiple(outputHeight / rules.maxRatio, rules.multiple);
      continue;
    }

    const pixels = outputWidth * outputHeight;
    if (pixels < rules.minPixels) {
      const scale = Math.sqrt(rules.minPixels / pixels);
      outputWidth = ceilToMultiple(outputWidth * scale, rules.multiple);
      outputHeight = ceilToMultiple(outputHeight * scale, rules.multiple);
      continue;
    }

    if (pixels > rules.maxPixels || outputWidth > rules.maxEdge || outputHeight > rules.maxEdge) {
      const scale = Math.min(
        rules.maxEdge / outputWidth,
        rules.maxEdge / outputHeight,
        Math.sqrt(rules.maxPixels / pixels)
      );
      outputWidth = floorToMultiple(outputWidth * scale, rules.multiple);
      outputHeight = floorToMultiple(outputHeight * scale, rules.multiple);
      continue;
    }

    break;
  }

  return `${outputWidth}x${outputHeight}`;
}

function roundToMultiple(value, multiple) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function ceilToMultiple(value, multiple) {
  return Math.max(multiple, Math.ceil(value / multiple) * multiple);
}

function floorToMultiple(value, multiple) {
  return Math.max(multiple, Math.floor(value / multiple) * multiple);
}

function cloneRect(rect) {
  return {
    left: toNumber(rect.left),
    top: toNumber(rect.top),
    right: toNumber(rect.right),
    bottom: toNumber(rect.bottom),
    width: toNumber(rect.width),
    height: toNumber(rect.height),
  };
}

function roundRectToPixels(rect) {
  const left = Math.floor(toNumber(rect.left));
  const top = Math.floor(toNumber(rect.top));
  const right = Math.ceil(toNumber(rect.right));
  const bottom = Math.ceil(toNumber(rect.bottom));
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function clampRectToDocument(rect, docSize) {
  const width = Math.max(1, Math.round(toNumber(docSize?.width) || 1));
  const height = Math.max(1, Math.round(toNumber(docSize?.height) || 1));
  const left = Math.max(0, Math.min(width - 1, Math.floor(toNumber(rect.left))));
  const top = Math.max(0, Math.min(height - 1, Math.floor(toNumber(rect.top))));
  const right = Math.max(left + 1, Math.min(width, Math.ceil(toNumber(rect.right))));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil(toNumber(rect.bottom))));
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

async function createOutpaintInputs(imageB64, docSize, padding) {
  const width = docSize.width + padding.left + padding.right;
  const height = docSize.height + padding.top + padding.bottom;

  return {
    image: await exportOutpaintCanvasAsBase64(docSize, padding),
    mask: createOutpaintMaskBase64(width, height, docSize, padding),
    displaySize: `${width}x${height}`,
    baseSize: { width: docSize.width, height: docSize.height },
    padding: { ...padding },
    targetRect: { left: 0, top: 0, right: width, bottom: height, width, height },
    placementRect: { left: 0, top: 0, right: width, bottom: height, width, height },
  };
}

async function exportOutpaintCanvasAsBase64(docSize, padding) {
  if (!app.activeDocument) {
    throw new Error("当前没有打开的 Photoshop 文档");
  }

  const folder = await fs.getTemporaryFolder();
  const file = await folder.createFile("openai_outpaint_input.png", { overwrite: true });
  let duplicateDoc = null;
  const anchor = constants.AnchorPosition || {};
  const topLeft = anchor.TOPLEFT || anchor.TOP_LEFT;
  const bottomRight = anchor.BOTTOMRIGHT || anchor.BOTTOM_RIGHT;
  if (!topLeft || !bottomRight) {
    throw new Error("当前 Photoshop UXP 环境缺少 resizeCanvas anchor 常量，无法准备扩图输入");
  }

  await core.executeAsModal(async () => {
    const sourceDoc = app.activeDocument;
    duplicateDoc = await sourceDoc.duplicate("OpenAI outpaint input", true);
    try {
      const baseWidth = Math.round(docSize.width);
      const baseHeight = Math.round(docSize.height);
      const left = Math.round(padding.left || 0);
      const top = Math.round(padding.top || 0);
      const right = Math.round(padding.right || 0);
      const bottom = Math.round(padding.bottom || 0);
      if (left || top) {
        await duplicateDoc.resizeCanvas(baseWidth + left, baseHeight + top, bottomRight);
      }
      const afterLeftTopWidth = Math.round(toNumber(duplicateDoc.width));
      const afterLeftTopHeight = Math.round(toNumber(duplicateDoc.height));
      if (right || bottom) {
        await duplicateDoc.resizeCanvas(afterLeftTopWidth + right, afterLeftTopHeight + bottom, topLeft);
      }
      await duplicateDoc.saveAs.png(file, null, true);
    } finally {
      if (duplicateDoc) {
        await duplicateDoc.closeWithoutSaving();
      }
    }
  }, { commandName: "Export OpenAI outpaint input" });

  const buffer = await file.read({ format: storage.formats.binary });
  return arrayBufferToBase64(buffer);
}

function createOutpaintMaskBase64(width, height, docSize, padding) {
  const rgba = new Uint8Array(width * height * 4);
  const left = Math.max(0, Math.round(padding.left || 0));
  const top = Math.max(0, Math.round(padding.top || 0));
  const right = Math.min(width, left + Math.round(docSize.width));
  const bottom = Math.min(height, top + Math.round(docSize.height));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = 255;
      rgba[offset + 1] = 255;
      rgba[offset + 2] = 255;
      rgba[offset + 3] = 255;
    }
  }
  return bytesToBase64(encodePngRgba(width, height, rgba));
}

async function expandCanvasForOutpaint(padding, targetRect, baseSize = null) {
  if (!app.activeDocument || !padding || !isSelectionValid(targetRect)) return;

  const left = clampInteger(padding.left, 0, 1600, 0);
  const top = clampInteger(padding.top, 0, 1600, 0);
  const right = clampInteger(padding.right, 0, 1600, 0);
  const bottom = clampInteger(padding.bottom, 0, 1600, 0);
  if (!left && !top && !right && !bottom) return;

  const expectedWidth = Math.round(targetRect.width);
  const expectedHeight = Math.round(targetRect.height);
  const baseWidth = Math.max(1, Math.round(toNumber(baseSize?.width) || (expectedWidth - left - right)));
  const baseHeight = Math.max(1, Math.round(toNumber(baseSize?.height) || (expectedHeight - top - bottom)));
  const current = getDocumentSize();
  if (current.width === expectedWidth && current.height === expectedHeight) return;

  const anchor = constants.AnchorPosition || {};
  const topLeft = anchor.TOPLEFT || anchor.TOP_LEFT;
  const bottomRight = anchor.BOTTOMRIGHT || anchor.BOTTOM_RIGHT;
  if (!topLeft || !bottomRight) {
    throw new Error("当前 Photoshop UXP 环境缺少 resizeCanvas anchor 常量，无法安全扩展画布");
  }

  await core.executeAsModal(async () => {
    const doc = app.activeDocument;
    const startWidth = Math.round(toNumber(doc.width));
    const startHeight = Math.round(toNumber(doc.height));
    const hasLeftTopPaddingApplied = startWidth === baseWidth + left && startHeight === baseHeight + top;
    const isOriginalCanvas = startWidth === baseWidth && startHeight === baseHeight;
    if (!isOriginalCanvas && !hasLeftTopPaddingApplied) {
      throw new Error(`当前文档尺寸 ${startWidth}x${startHeight} 与扩图原始尺寸 ${baseWidth}x${baseHeight} 不匹配`);
    }

    if ((left || top) && isOriginalCanvas) {
      await doc.resizeCanvas(startWidth + left, startHeight + top, bottomRight);
    }

    const afterLeftTopWidth = Math.round(toNumber(doc.width));
    const afterLeftTopHeight = Math.round(toNumber(doc.height));
    const finalWidth = Math.max(afterLeftTopWidth + right, expectedWidth);
    const finalHeight = Math.max(afterLeftTopHeight + bottom, expectedHeight);

    if (finalWidth !== afterLeftTopWidth || finalHeight !== afterLeftTopHeight) {
      await doc.resizeCanvas(finalWidth, finalHeight, topLeft);
    }
  }, { commandName: "Expand canvas for OpenAI outpaint" });
}

function getPadding() {
  return {
    left: clampNumber($("padLeftInput").value, 0, 1600, 0),
    right: clampNumber($("padRightInput").value, 0, 1600, 0),
    top: clampNumber($("padTopInput").value, 0, 1600, 0),
    bottom: clampNumber($("padBottomInput").value, 0, 1600, 0),
  };
}

async function applySelectionRatioToSize() {
  const selection = await getSelectionInfo();
  if (!isSelectionValid(selection)) {
    setStatus("没有读取到有效选区");
    return;
  }

  const ratio = selection.width / selection.height;
  if (ratio > 1.25) {
    $("sizeInput").value = "1536x1024";
  } else if (ratio < 0.8) {
    $("sizeInput").value = "1024x1536";
  } else {
    $("sizeInput").value = "1024x1024";
  }

  setStatus(`已按选区比例设置尺寸：${$("sizeInput").value}`);
}

function renderResults() {
  $("resultCount").textContent = `${state.results.length}`;
  $("importSelectedBtn").disabled = !state.selectedId || state.busy;
  renderSelectedPreview();
  renderGrid($("resultGrid"), state.results, true);
  renderOutputView();
}

function renderHistory() {
  renderGrid($("historyGrid"), state.history, false);
  renderOutputView();
}

function renderOutputView() {
  $("selectedPreview").classList.toggle(
    "hidden",
    state.outputView !== "results" || !getSelectedResult()
  );
  $("resultGrid").classList.toggle("hidden", state.outputView !== "results");
  $("historyGrid").classList.toggle("hidden", state.outputView !== "history");
  $("historyActions").classList.toggle("hidden", state.outputView !== "history");

  document.querySelectorAll("[data-output]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.output === state.outputView);
  });
}

function renderGrid(container, items, isCurrent) {
  container.innerHTML = "";

  items.forEach((item) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "thumb-tile";
    tile.classList.toggle("is-active", item.id === state.selectedId);
    tile.title = describeItem(item);

    const image = document.createElement("img");
    image.src = resultToPreviewSrc(item);
    image.alt = item.prompt || describeItem(item);
    image.onerror = () => {
      tile.classList.add("is-error");
      tile.title = "图片预览失败，但结果数据已返回";
      setStatus("图片预览失败：请尝试导入或重新生成");
    };
    image.addEventListener("click", () => selectResult(item, isCurrent));
    image.addEventListener("dblclick", () => {
      selectResult(item, isCurrent);
      importSelected();
    });

    tile.append(image);
    tile.addEventListener("click", () => selectResult(item, isCurrent));
    tile.addEventListener("dblclick", () => {
      selectResult(item, isCurrent);
      importSelected();
    });
    container.append(tile);
  });

  fillGridPlaceholders(container, Math.max(0, 6 - items.length), isCurrent ? "results" : "history");
}

function renderSelectedPreview() {
  const preview = $("selectedPreview");
  const item = getSelectedResult();
  preview.innerHTML = "";

  if (!item) {
    preview.classList.add("hidden");
    return;
  }

  const image = document.createElement("img");
  image.src = resultToPreviewSrc(item);
  image.alt = item.prompt || describeItem(item);
  image.onerror = () => {
    preview.classList.add("is-error");
    setStatus("图片预览失败：接口返回了结果，但 UXP 没能显示缩略图");
  };
  image.addEventListener("dblclick", importSelected);

  const meta = document.createElement("div");
  meta.className = "selected-preview-meta";
  meta.textContent = `${MODE_META[item.mode]?.label || "结果"} · ${item.size || "auto"}`;

  preview.append(image, meta);
  preview.title = "双击导入当前结果";
  preview.classList.remove("hidden", "is-error");
}

function fillGridPlaceholders(container, count, type) {
  for (let index = 0; index < count; index += 1) {
    const placeholder = document.createElement("div");
    placeholder.className = "thumb-placeholder";
    if (type === "history") {
      placeholder.classList.add("is-history");
    }
    container.append(placeholder);
  }
}

function selectResult(item, isCurrent) {
  state.selectedId = item.id;
  if (!isCurrent && !state.results.find((entry) => entry.id === item.id)) {
    state.results.unshift(item);
  }
  renderResults();
  renderHistory();
}

function getSelectedResult() {
  return state.results.find((item) => item.id === state.selectedId) ||
    state.history.find((item) => item.id === state.selectedId);
}

function describeItem(item) {
  const label = MODE_META[item.mode]?.label || "结果";
  const stamp = item.createdAt
    ? new Date(item.createdAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  return stamp ? `${label} · ${stamp}` : label;
}

async function saveHistoryItem(item) {
  try {
    const binary = await resultToArrayBuffer(item);
    const folder = await getHistoryFolder();
    const format = detectFormatFromResult(item);
    const fileName = `${item.id}.${format}`;
    const file = await folder.createFile(fileName, { overwrite: true });
    await file.write(binary, { format: storage.formats.binary });

    const record = {
      id: item.id,
      fileName,
      prompt: item.prompt,
      mode: item.mode,
      model: item.model,
      size: item.size,
      quality: item.quality,
      format,
      targetRect: item.targetRect || null,
      placementRect: item.placementRect || null,
      cropRect: item.cropRect || null,
      outpaintPadding: item.outpaintPadding || null,
      outpaintBaseSize: item.outpaintBaseSize || null,
      splitIndex: item.splitIndex || null,
      splitLabel: item.splitLabel || null,
      splitBounds: item.splitBounds || null,
      whiteMatteMask: Boolean(item.whiteMatteMask),
      previewB64: item.previewB64 || null,
      previewBounds: item.previewBounds || null,
      createdAt: item.createdAt,
    };
    const index = readJsonLocal(HISTORY_KEY, []);
    localStorage.setItem(HISTORY_KEY, JSON.stringify([record, ...index].slice(0, 40)));
  } catch (error) {
    console.warn("saveHistoryItem failed", error);
  }
}

async function loadHistory() {
  try {
    const index = readJsonLocal(HISTORY_KEY, []);
    const folder = await getHistoryFolder();
    const loaded = [];

    for (const record of index.slice(0, 20)) {
      try {
        const file = await folder.getEntry(record.fileName);
        const buffer = await file.read({ format: storage.formats.binary });
        loaded.push({
          ...record,
          b64: arrayBufferToBase64(buffer),
          previewB64: record.previewB64 || null,
          previewBounds: record.previewBounds || null,
        });
      } catch (error) {
        console.warn("history entry missing", record.fileName);
      }
    }

    state.history = loaded;
    state.outputView = "history";
    renderHistory();
    setStatus(`已加载历史：${loaded.length} 张`);
  } catch (error) {
    setStatus(`加载历史失败：${error.message || error}`);
  }
}

async function clearHistory() {
  localStorage.setItem(HISTORY_KEY, "[]");
  state.history = [];
  renderHistory();
  setStatus("历史已清空");
}

async function getHistoryFolder() {
  const dataFolder = await fs.getDataFolder();
  try {
    return await dataFolder.getEntry("history");
  } catch (error) {
    return await dataFolder.createFolder("history");
  }
}

async function saveDebugBase64Image(fileName, b64) {
  try {
    const dataFolder = await fs.getDataFolder();
    let debugFolder;
    try {
      debugFolder = await dataFolder.getEntry("debug");
    } catch (error) {
      debugFolder = await dataFolder.createFolder("debug");
    }
    const file = await debugFolder.createFile(fileName, { overwrite: true });
    await file.write(base64ToArrayBuffer(stripDataUrl(b64)), { format: storage.formats.binary });
  } catch (error) {
    console.warn("saveDebugBase64Image failed", error);
  }
}

function setBusy(busy) {
  state.busy = busy;
  $("generateBtn").disabled = busy;
  $("cancelRequestBtn").disabled = !busy;
  $("cancelRequestBtn").classList.toggle("hidden", !busy);
  $("importSelectedBtn").disabled = busy || !state.selectedId;
  $("clearResultsBtn").disabled = busy;
  $("saveSettingsBtn").disabled = busy;
  $("testConnectionBtn").disabled = busy;
  $("testKoukoutuBtn").disabled = busy;
  $("generateBtnLabel").textContent = busy ? "生成中..." : "生成";
}

function cancelCurrentGeneration() {
  if (!state.busy) {
    setStatus("当前没有正在运行的任务");
    return;
  }
  state.cancelRequested = true;
  setStatus("正在停止当前任务...");
  setProgress(state.progress || 1, true);
  try {
    state.activeRequestController?.abort?.();
  } catch (error) {
    console.warn("[OpenAI Photoshop Generator] abort failed", error);
  }
  for (const xhr of Array.from(state.activeXhrs || [])) {
    try {
      xhr.abort();
    } catch (error) {
      console.warn("[OpenAI Photoshop Generator] xhr abort failed", error);
    }
  }
}

function createAbortController() {
  if (typeof AbortController === "undefined") {
    return null;
  }
  try {
    return new AbortController();
  } catch (error) {
    console.warn("[OpenAI Photoshop Generator] AbortController unavailable", error);
    return null;
  }
}

function getActiveAbortSignal() {
  return state.activeRequestController?.signal || null;
}

function makeCancelError() {
  const error = new Error("已停止");
  error.name = "AbortError";
  error.isUserCancelled = true;
  return error;
}

function throwIfCancelled() {
  if (state.cancelRequested || getActiveAbortSignal()?.aborted) {
    throw makeCancelError();
  }
}

function isCancelError(error) {
  const message = String(error?.message || error || "");
  return Boolean(
    state.cancelRequested ||
    error?.isUserCancelled ||
    error?.name === "AbortError" ||
    /已停止|aborted|abort|cancelled|canceled/i.test(message)
  );
}

function setProgress(value, visible) {
  const track = $("progressTrack");
  const fill = $("progressFill");
  if (!track || !fill) return;
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  state.progress = percent;
  state.progressVisible = Boolean(visible);
  track.classList.toggle("hidden", !visible);
  fill.style.width = `${percent}%`;
}

function yieldToUi() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function setStatus(message) {
  const text = formatStatusMessage(message);
  $("statusBar").textContent = text;
  $("statusBar").title = text;
  const settingsStatus = $("settingsStatusBar");
  if (settingsStatus) {
    settingsStatus.textContent = text;
    settingsStatus.title = text;
  }
  updateStatusTone(message);
  const settingsDot = $("settingsStatusDot");
  if (settingsDot) {
    settingsDot.className = $("statusDot").className;
  }
}

function formatStatusMessage(message) {
  if (!state.busy || !state.progressVisible || state.progress <= 0 || state.progress >= 100) {
    return message;
  }
  if (/^\d{1,3}%\s/.test(String(message || ""))) {
    return message;
  }
  return `${Math.round(state.progress)}% ${message}`;
}

function updateStatusTone(message) {
  const dot = $("statusDot");
  dot.classList.remove("is-busy", "is-error", "is-warn");
  const settingsDot = $("settingsStatusDot");
  if (settingsDot) {
    settingsDot.className = dot.className;
  }

  if (/失败|无效|错误|不可用|下载结果失败/i.test(message)) {
    dot.classList.add("is-error");
    return;
  }

  if (/请先|未配置|没有|未读取/i.test(message)) {
    dot.classList.add("is-warn");
    return;
  }

  if (state.busy || /^正在/.test(message)) {
    dot.classList.add("is-busy");
  }
}

function base64ToBlob(b64, mimeType) {
  return new Blob([base64ToArrayBuffer(stripDataUrl(b64))], { type: mimeType });
}

function estimateBase64Bytes(value) {
  const b64 = stripDataUrl(value).replace(/\s/g, "");
  if (!b64) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function stripDataUrl(value) {
  return String(value || "").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

function mimeTypeForFormat(format) {
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

async function canvasToBase64(canvas) {
  if (canvas && typeof canvas.toBlob === "function") {
    const blob = await new Promise((resolve, reject) => {
      try {
        canvas.toBlob((value) => {
          if (value) {
            resolve(value);
          } else {
            reject(new Error("Canvas 导出 PNG 失败"));
          }
        }, "image/png");
      } catch (error) {
        reject(error);
      }
    });
    return arrayBufferToBase64(await blobToArrayBuffer(blob));
  }

  if (canvas && typeof canvas.toDataURL === "function") {
    return canvas.toDataURL("image/png").split(",")[1];
  }

  const ctx = canvas?.getContext?.("2d");
  if (ctx && typeof ctx.getImageData === "function") {
    const width = Math.max(1, Math.round(canvas.width));
    const height = Math.max(1, Math.round(canvas.height));
    const imageData = ctx.getImageData(0, 0, width, height);
    return bytesToBase64(encodePngRgba(width, height, imageData.data));
  }

  throw new Error("当前 Photoshop UXP Canvas 不支持导出 PNG");
}

async function encodeRgbaPngBase64(width, height, rgba) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    let imageData = null;
    if (typeof ctx.createImageData === "function") {
      imageData = ctx.createImageData(width, height);
    } else if (typeof ctx.getImageData === "function") {
      imageData = ctx.getImageData(0, 0, width, height);
    }
    if (!imageData || typeof ctx.putImageData !== "function") {
      throw new Error("Canvas ImageData API unavailable");
    }
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);
    return await canvasToBase64(canvas);
  } catch (error) {
    console.warn("[png] canvas PNG encode failed; falling back to stored PNG", error);
    return bytesToBase64(encodePngRgba(width, height, rgba));
  }
}

function blobToArrayBuffer(blob) {
  if (blob && typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("读取 Blob 失败"));
    reader.readAsArrayBuffer(blob);
  });
}

function createSolidMaskBase64(width, height) {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = 255;
    rgba[index + 1] = 255;
    rgba[index + 2] = 255;
    rgba[index + 3] = 255;
  }
  return bytesToBase64(encodePngRgba(width, height, rgba));
}

function encodePngBinaryRectMask(width, height, selection) {
  const rowBytes = Math.ceil(width / 8);
  const raw = createProtectedBinaryMaskRows(width, height, rowBytes);
  const left = Math.max(0, Math.floor(selection.left));
  const top = Math.max(0, Math.floor(selection.top));
  const right = Math.min(width, Math.ceil(selection.right));
  const bottom = Math.min(height, Math.ceil(selection.bottom));

  for (let y = top; y < bottom; y += 1) {
    const rowOffset = y * (rowBytes + 1) + 1;
    for (let x = left; x < right; x += 1) {
      raw[rowOffset + Math.floor(x / 8)] &= ~(1 << (7 - (x % 8)));
    }
  }

  return encodePngBinaryMaskRows(width, height, raw);
}

function encodePngBinarySelectionMask(width, height, pixels, components) {
  const rowBytes = Math.ceil(width / 8);
  const raw = createProtectedBinaryMaskRows(width, height, rowBytes);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (rowBytes + 1) + 1;
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (y * width + x) * components;
      const selected = Math.max(0, Math.min(255, pixels[sourceIndex] || 0));
      if (selected > 127) {
        raw[rowOffset + Math.floor(x / 8)] &= ~(1 << (7 - (x % 8)));
      }
    }
  }
  return encodePngBinaryMaskRows(width, height, raw);
}

function createProtectedBinaryMaskRows(width, height, rowBytes) {
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (rowBytes + 1);
    raw[rowOffset] = 0;
    raw.fill(0xff, rowOffset + 1, rowOffset + 1 + rowBytes);
    const paddingBits = (8 - (width % 8)) % 8;
    if (paddingBits) {
      raw[rowOffset + rowBytes] &= 0xff << paddingBits;
    }
  }
  return raw;
}

function encodePngBinaryMaskRows(width, height, raw) {
  return concatBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", createIhdr(width, height, 1, 3)),
    pngChunk("PLTE", new Uint8Array([0, 0, 0, 255, 255, 255])),
    pngChunk("tRNS", new Uint8Array([0, 255])),
    pngChunk("IDAT", zlibStore(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function encodePngRgba(width, height, rgba) {
  const rowLength = width * 4;
  const raw = new Uint8Array((rowLength + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (rowLength + 1);
    const rgbaOffset = y * rowLength;
    raw[rawOffset] = 0;
    raw.set(rgba.subarray(rgbaOffset, rgbaOffset + rowLength), rawOffset + 1);
  }

  return concatBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", createIhdr(width, height)),
    pngChunk("IDAT", zlibDeflateRle(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

async function decodePngRgbaBase64(b64) {
  const bytes = new Uint8Array(base64ToArrayBuffer(stripDataUrl(b64)));
  return decodePngRgbaBytes(bytes);
}

async function decodePngRgbaBytes(bytes) {
  if (
    bytes.length < 33 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    throw new Error("不是 PNG 数据");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts = [];

  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;

    if (type === "IHDR") {
      width = readUint32BE(bytes, dataStart);
      height = readUint32BE(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === "IDAT") {
      idatParts.push(bytes.slice(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0 || !idatParts.length) {
    throw new Error("暂不支持该 PNG 编码");
  }

  const channels = getPngColorChannels(colorType);
  const inflated = await inflateZlibBytes(concatBytes(idatParts));
  const rowLength = width * channels;
  const expected = (rowLength + 1) * height;
  if (inflated.length < expected) {
    throw new Error("PNG 像素数据不完整");
  }

  const rgba = new Uint8Array(width * height * 4);
  let inputOffset = 0;
  let previous = new Uint8Array(rowLength);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset++];
    const row = inflated.slice(inputOffset, inputOffset + rowLength);
    inputOffset += rowLength;
    unfilterPngRow(row, previous, channels, filter);
    copyPngRowToRgba(row, rgba, y * width * 4, colorType);
    previous = row;
  }

  return { width, height, rgba };
}

function getPngColorChannels(colorType) {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`暂不支持 PNG color type ${colorType}`);
}

async function inflateZlibBytes(bytes) {
  if (typeof DecompressionStream === "function") {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      console.warn("[png] DecompressionStream inflate failed; using JS inflate", error);
    }
  }
  return inflateZlibBytesSync(bytes);
}

function inflateZlibBytesSync(bytes) {
  if (bytes.length < 6 || (bytes[0] & 0x0f) !== 8 || (((bytes[0] << 8) + bytes[1]) % 31) !== 0) {
    throw new Error("无效 zlib 数据");
  }
  const reader = createInflateBitReader(bytes.subarray(2, bytes.length - 4));
  const output = [];
  let finalBlock = false;
  while (!finalBlock) {
    finalBlock = Boolean(reader.readBits(1));
    const blockType = reader.readBits(2);
    if (blockType === 0) {
      inflateStoredBlock(reader, output);
    } else if (blockType === 1) {
      inflateCompressedBlock(reader, getFixedLiteralTree(), getFixedDistanceTree(), output);
    } else if (blockType === 2) {
      const trees = readDynamicHuffmanTrees(reader);
      inflateCompressedBlock(reader, trees.literalTree, trees.distanceTree, output);
    } else {
      throw new Error("无效 deflate block");
    }
  }
  return new Uint8Array(output);
}

function createInflateBitReader(bytes) {
  let byteOffset = 0;
  let bitBuffer = 0;
  let bitCount = 0;
  return {
    readBits(count) {
      let value = 0;
      let written = 0;
      while (written < count) {
        if (bitCount === 0) {
          if (byteOffset >= bytes.length) throw new Error("deflate 数据提前结束");
          bitBuffer = bytes[byteOffset++];
          bitCount = 8;
        }
        const take = Math.min(bitCount, count - written);
        value |= (bitBuffer & ((1 << take) - 1)) << written;
        bitBuffer >>= take;
        bitCount -= take;
        written += take;
      }
      return value >>> 0;
    },
    alignByte() {
      bitBuffer = 0;
      bitCount = 0;
    },
    readByte() {
      if (byteOffset >= bytes.length) throw new Error("deflate 数据提前结束");
      return bytes[byteOffset++];
    },
  };
}

function inflateStoredBlock(reader, output) {
  reader.alignByte();
  const len = reader.readByte() | (reader.readByte() << 8);
  const nlen = reader.readByte() | (reader.readByte() << 8);
  if (((len ^ 0xffff) & 0xffff) !== nlen) {
    throw new Error("deflate stored block 校验失败");
  }
  for (let index = 0; index < len; index += 1) {
    output.push(reader.readByte());
  }
}

const INFLATE_LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const INFLATE_LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const INFLATE_DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const INFLATE_DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

let fixedLiteralTree = null;
let fixedDistanceTree = null;

function getFixedLiteralTree() {
  if (!fixedLiteralTree) {
    const lengths = new Array(288);
    for (let index = 0; index <= 143; index += 1) lengths[index] = 8;
    for (let index = 144; index <= 255; index += 1) lengths[index] = 9;
    for (let index = 256; index <= 279; index += 1) lengths[index] = 7;
    for (let index = 280; index <= 287; index += 1) lengths[index] = 8;
    fixedLiteralTree = buildInflateHuffmanTree(lengths);
  }
  return fixedLiteralTree;
}

function getFixedDistanceTree() {
  if (!fixedDistanceTree) {
    fixedDistanceTree = buildInflateHuffmanTree(new Array(32).fill(5));
  }
  return fixedDistanceTree;
}

function readDynamicHuffmanTrees(reader) {
  const literalCount = reader.readBits(5) + 257;
  const distanceCount = reader.readBits(5) + 1;
  const codeLengthCount = reader.readBits(4) + 4;
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const codeLengthLengths = new Array(19).fill(0);
  for (let index = 0; index < codeLengthCount; index += 1) {
    codeLengthLengths[order[index]] = reader.readBits(3);
  }
  const codeLengthTree = buildInflateHuffmanTree(codeLengthLengths);
  const lengths = [];
  while (lengths.length < literalCount + distanceCount) {
    const symbol = decodeInflateHuffman(reader, codeLengthTree);
    if (symbol <= 15) {
      lengths.push(symbol);
    } else if (symbol === 16) {
      const repeat = reader.readBits(2) + 3;
      const value = lengths[lengths.length - 1] || 0;
      for (let index = 0; index < repeat; index += 1) lengths.push(value);
    } else if (symbol === 17) {
      const repeat = reader.readBits(3) + 3;
      for (let index = 0; index < repeat; index += 1) lengths.push(0);
    } else if (symbol === 18) {
      const repeat = reader.readBits(7) + 11;
      for (let index = 0; index < repeat; index += 1) lengths.push(0);
    }
  }
  return {
    literalTree: buildInflateHuffmanTree(lengths.slice(0, literalCount)),
    distanceTree: buildInflateHuffmanTree(lengths.slice(literalCount, literalCount + distanceCount)),
  };
}

function inflateCompressedBlock(reader, literalTree, distanceTree, output) {
  while (true) {
    const symbol = decodeInflateHuffman(reader, literalTree);
    if (symbol < 256) {
      output.push(symbol);
    } else if (symbol === 256) {
      return;
    } else {
      const lengthIndex = symbol - 257;
      if (lengthIndex < 0 || lengthIndex >= INFLATE_LENGTH_BASE.length) {
        throw new Error("无效 deflate length code");
      }
      const length = INFLATE_LENGTH_BASE[lengthIndex] + reader.readBits(INFLATE_LENGTH_EXTRA[lengthIndex]);
      const distanceSymbol = decodeInflateHuffman(reader, distanceTree);
      if (distanceSymbol < 0 || distanceSymbol >= INFLATE_DISTANCE_BASE.length) {
        throw new Error("无效 deflate distance code");
      }
      const distance = INFLATE_DISTANCE_BASE[distanceSymbol] + reader.readBits(INFLATE_DISTANCE_EXTRA[distanceSymbol]);
      const start = output.length - distance;
      if (start < 0) throw new Error("deflate distance 越界");
      for (let index = 0; index < length; index += 1) {
        output.push(output[start + index]);
      }
    }
  }
}

function buildInflateHuffmanTree(lengths) {
  const maxLen = Math.max(...lengths, 0);
  const counts = new Array(maxLen + 1).fill(0);
  for (const length of lengths) {
    if (length > 0) counts[length] += 1;
  }
  const nextCode = new Array(maxLen + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maxLen; bits += 1) {
    code = (code + (counts[bits - 1] || 0)) << 1;
    nextCode[bits] = code;
  }
  const table = Array.from({ length: maxLen + 1 }, () => Object.create(null));
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol];
    if (!length) continue;
    const canonical = nextCode[length]++;
    table[length][reverseBits(canonical, length)] = symbol;
  }
  return { maxLen, table };
}

function decodeInflateHuffman(reader, tree) {
  let code = 0;
  for (let length = 1; length <= tree.maxLen; length += 1) {
    code |= reader.readBits(1) << (length - 1);
    const symbol = tree.table[length][code];
    if (symbol !== undefined) return symbol;
  }
  throw new Error("无法解码 deflate Huffman symbol");
}

function reverseBits(value, length) {
  let reversed = 0;
  for (let index = 0; index < length; index += 1) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
}

function unfilterPngRow(row, previous, bpp, filter) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bpp ? row[index - bpp] : 0;
    const up = previous[index] || 0;
    const upLeft = index >= bpp ? (previous[index - bpp] || 0) : 0;
    if (filter === 1) {
      row[index] = (row[index] + left) & 0xff;
    } else if (filter === 2) {
      row[index] = (row[index] + up) & 0xff;
    } else if (filter === 3) {
      row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
    } else if (filter === 4) {
      row[index] = (row[index] + paethPredictor(left, up, upLeft)) & 0xff;
    } else if (filter !== 0) {
      throw new Error(`未知 PNG filter ${filter}`);
    }
  }
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function copyPngRowToRgba(row, rgba, outOffset, colorType) {
  for (let input = 0, output = outOffset; input < row.length; output += 4) {
    if (colorType === 0) {
      const gray = row[input++];
      rgba[output] = gray;
      rgba[output + 1] = gray;
      rgba[output + 2] = gray;
      rgba[output + 3] = 255;
    } else if (colorType === 2) {
      rgba[output] = row[input++];
      rgba[output + 1] = row[input++];
      rgba[output + 2] = row[input++];
      rgba[output + 3] = 255;
    } else if (colorType === 4) {
      const gray = row[input++];
      rgba[output] = gray;
      rgba[output + 1] = gray;
      rgba[output + 2] = gray;
      rgba[output + 3] = row[input++];
    } else {
      rgba[output] = row[input++];
      rgba[output + 1] = row[input++];
      rgba[output + 2] = row[input++];
      rgba[output + 3] = row[input++];
    }
  }
}

function zlibDeflateRle(data) {
  try {
    const writer = createDeflateBitWriter();
    writer.writeBits(1, 1);
    writer.writeBits(1, 2);

    let index = 0;
    while (index < data.length) {
      let runLength = 1;
      while (
        index + runLength < data.length &&
        runLength < 258 &&
        data[index + runLength] === data[index]
      ) {
        runLength += 1;
      }

      if (runLength >= 4) {
        writeFixedHuffmanSymbol(writer, data[index]);
        index += 1;
        runLength -= 1;
        while (runLength > 0) {
          const length = Math.min(258, runLength);
          writeFixedLengthDistance(writer, length, 1);
          index += length;
          runLength -= length;
        }
      } else {
        writeFixedHuffmanSymbol(writer, data[index]);
        index += 1;
      }
    }

    writeFixedHuffmanSymbol(writer, 256);
    return concatBytes([
      new Uint8Array([0x78, 0x01]),
      writer.finish(),
      adlerBytes(data),
    ]);
  } catch (error) {
    console.warn("[png] RLE deflate failed; falling back to stored PNG", error);
    return zlibStore(data);
  }
}

function createDeflateBitWriter() {
  const bytes = [];
  let bitBuffer = 0;
  let bitCount = 0;
  return {
    writeBits(value, count) {
      bitBuffer |= (value & ((1 << count) - 1)) << bitCount;
      bitCount += count;
      while (bitCount >= 8) {
        bytes.push(bitBuffer & 0xff);
        bitBuffer >>= 8;
        bitCount -= 8;
      }
    },
    finish() {
      if (bitCount > 0) {
        bytes.push(bitBuffer & 0xff);
      }
      return new Uint8Array(bytes);
    },
  };
}

function writeFixedHuffmanSymbol(writer, symbol) {
  let code;
  let length;
  if (symbol <= 143) {
    code = 0x30 + symbol;
    length = 8;
  } else if (symbol <= 255) {
    code = 0x190 + (symbol - 144);
    length = 9;
  } else if (symbol <= 279) {
    code = symbol - 256;
    length = 7;
  } else {
    code = 0xc0 + (symbol - 280);
    length = 8;
  }
  writer.writeBits(reverseBits(code, length), length);
}

function writeFixedLengthDistance(writer, length, distance) {
  const lengthCode = getDeflateLengthCode(length);
  writeFixedHuffmanSymbol(writer, lengthCode.code);
  if (lengthCode.extraBits) {
    writer.writeBits(length - lengthCode.base, lengthCode.extraBits);
  }

  const distanceCode = getDeflateDistanceCode(distance);
  writer.writeBits(reverseBits(distanceCode.code, 5), 5);
  if (distanceCode.extraBits) {
    writer.writeBits(distance - distanceCode.base, distanceCode.extraBits);
  }
}

function getDeflateLengthCode(length) {
  const bases = [
    3, 4, 5, 6, 7, 8, 9, 10,
    11, 13, 15, 17,
    19, 23, 27, 31,
    35, 43, 51, 59,
    67, 83, 99, 115,
    131, 163, 195, 227,
    258,
  ];
  const extras = [
    0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1,
    2, 2, 2, 2,
    3, 3, 3, 3,
    4, 4, 4, 4,
    5, 5, 5, 5,
    0,
  ];
  for (let index = bases.length - 1; index >= 0; index -= 1) {
    if (length >= bases[index]) {
      return { code: 257 + index, base: bases[index], extraBits: extras[index] };
    }
  }
  return { code: 257, base: 3, extraBits: 0 };
}

function getDeflateDistanceCode(distance) {
  return { code: 0, base: 1, extraBits: 0 };
}

function reverseBits(value, length) {
  let reversed = 0;
  for (let index = 0; index < length; index += 1) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
}

function adlerBytes(data) {
  const value = adler32(data);
  const bytes = new Uint8Array(4);
  writeUint32(bytes, 0, value);
  return bytes;
}

function createIhdr(width, height, bitDepth = 8, colorType = 6) {
  const data = new Uint8Array(13);
  writeUint32(data, 0, width);
  writeUint32(data, 4, height);
  data[8] = bitDepth;
  data[9] = colorType;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function pngChunk(type, data) {
  const typeBytes = asciiBytes(type);
  const out = new Uint8Array(12 + data.length);
  writeUint32(out, 0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  writeUint32(out, 8 + data.length, crc32(concatBytes([typeBytes, data])));
  return out;
}

function zlibStore(data) {
  const blockCount = Math.ceil(data.length / 65535) || 1;
  const out = new Uint8Array(2 + blockCount * 5 + data.length + 4);
  let outOffset = 0;
  let dataOffset = 0;
  out[outOffset++] = 0x78;
  out[outOffset++] = 0x01;

  for (let block = 0; block < blockCount; block += 1) {
    const remaining = data.length - dataOffset;
    const length = Math.min(65535, remaining);
    out[outOffset++] = block === blockCount - 1 ? 1 : 0;
    out[outOffset++] = length & 0xff;
    out[outOffset++] = (length >> 8) & 0xff;
    const nlen = (~length) & 0xffff;
    out[outOffset++] = nlen & 0xff;
    out[outOffset++] = (nlen >> 8) & 0xff;
    out.set(data.subarray(dataOffset, dataOffset + length), outOffset);
    outOffset += length;
    dataOffset += length;
  }

  writeUint32(out, outOffset, adler32(data));
  return out;
}

function asciiBytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }
  return bytes;
}

function concatBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function adler32(data) {
  let a = 1;
  let b = 0;
  for (let index = 0; index < data.length; index += 1) {
    a = (a + data[index]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let c = index;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[index] = c >>> 0;
  }
  return table;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function toDataUrl(b64, format) {
  if (String(b64).startsWith("data:")) return b64;
  return `data:${mimeTypeForFormat(format)};base64,${stripDataUrl(b64)}`;
}

function base64ToArrayBuffer(base64) {
  const binary = atob(stripDataUrl(base64));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function getPngSize(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const view = new DataView(buffer);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

function getValidatedImageSize(buffer, format = "png") {
  const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
  if (!bytes.length) {
    throw new Error("结果图片数据为空，无法导入 Photoshop");
  }

  const normalizedFormat = String(format || "png").toLowerCase();
  if (normalizedFormat === "png") {
    const pngSize = getPngSize(buffer);
    if (!pngSize) {
      throw new Error("结果图片不是有效 PNG，已停止导入以避免 Photoshop 弹窗");
    }
    return pngSize;
  }

  return getPngSize(buffer) || { width: 1024, height: 1024 };
}

function normalizeBounds(bounds) {
  if (!bounds) return null;
  const left = toNumber(bounds.left ?? bounds._left);
  const top = toNumber(bounds.top ?? bounds._top);
  const right = toNumber(bounds.right ?? bounds._right);
  const bottom = toNumber(bounds.bottom ?? bounds._bottom);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function cleanObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== "" && value !== undefined && value !== null)
  );
}

function normalizeBaseUrl(value) {
  let url = String(value || "").trim().replace(/\/+$/, "");
  url = url.replace(/^(https?:\/\/)(?:localhost|127\.0\.0\.1):(9456|49456)(\/|$)/i, `http://127.0.0.1:51866$3`);
  url = url.replace(/\/(?:chat\/completions|images\/generations|images\/edits|models)$/i, "");
  return url.replace(/\/+$/, "");
}

function normalizeComfyUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "") || DEFAULT_COMFY_URL;
}

function normalizePath(value) {
  const path = String(value || "");
  return path.startsWith("/") ? path : `/${path}`;
}

function buildApiUrl(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}${normalizePath(path)}`;
}

function buildComfyUrl(baseUrl, path) {
  return `${normalizeComfyUrl(baseUrl)}${normalizePath(path)}`;
}

function isComfyModel(model) {
  return /^comfy:/i.test(String(model || ""));
}

function getComfyPresetLabel(model) {
  const value = String(model || "").toLowerCase();
  const preset = COMFY_WORKFLOWS[value];
  if (preset) return preset.label;
  if (value === "comfy:transparent-effect") return "ComfyUI Transparent Effect";
  return "ComfyUI";
}

function getComfyWorkflowPreset(model) {
  return COMFY_WORKFLOWS[String(model || "").toLowerCase()] || null;
}

function createRandomSeed() {
  return Math.floor(Math.random() * 2147483647);
}

function createComfyClientId() {
  return `photoshop-plugin-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readJsonLocal(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (error) {
    return fallback;
  }
}

function loadImage(src) {
  return loadImageRobust(src);
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timeout after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function loadImageRobust(src) {
  const blob = await imageSourceToBlob(src);

  if (typeof createImageBitmap === "function" && blob) {
    try {
      return await withTimeout(createImageBitmap(blob), 8000, "createImageBitmap");
    } catch (error) {
      console.warn("[loadImage] createImageBitmap failed:", error?.message || error);
    }
  } else {
    console.warn("[loadImage] createImageBitmap unavailable", { hasBlob: Boolean(blob) });
  }

  if (blob && typeof URL !== "undefined" && URL.createObjectURL) {
    try {
      return await withTimeout(loadImageViaTag(blob, null, true), 8000, "<img> blob-url");
    } catch (error) {
      console.warn("[loadImage] <img> + blob URL failed:", error?.message || error);
    }
  }

  try {
    return await withTimeout(loadImageViaTag(null, src, false), 8000, "<img> data-url");
  } catch (error) {
    console.warn("[loadImage] <img> + data URL failed:", error?.message || error);
    throw new Error(`无法解码 PNG（${error?.message || error}）。请把 UXP DevTools console 的 [loadImage] 日志贴给开发者。`);
  }
}

async function imageSourceToBlob(src) {
  if (!src || typeof src !== "string") return null;
  if (src.startsWith("data:")) {
    const match = src.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
    if (!match) return null;
    const mime = match[1] || "image/png";
    const isBase64 = Boolean(match[2]);
    const payload = match[3] || "";
    if (isBase64) {
      try { return base64ToBlob(payload, mime); }
      catch (error) { console.warn("[loadImage] base64ToBlob failed", error); return null; }
    }
    return new Blob([decodeURIComponent(payload)], { type: mime });
  }
  try {
    const response = await fetch(src);
    return await response.blob();
  } catch (error) {
    console.warn("[loadImage] fetch->blob failed", error);
    return null;
  }
}

function loadImageViaTag(blob, originalSrc, useBlobUrl) {
  return new Promise((resolve, reject) => {
    let url = null;
    let settled = false;
    const cleanup = () => {
      if (url) { try { URL.revokeObjectURL(url); } catch (error) { /* ignore */ } }
    };
    const image = new Image();
    image.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(image);
    };
    image.onerror = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error("image load failed"));
    };
    try {
      if (useBlobUrl && blob) {
        url = URL.createObjectURL(blob);
        image.src = url;
      } else if (originalSrc) {
        image.src = originalSrc;
      } else {
        cleanup();
        reject(new Error("no source for <img>"));
      }
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
