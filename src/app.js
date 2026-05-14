const photoshop = require("photoshop");
const { entrypoints, storage } = require("uxp");

const app = photoshop.app;
const action = photoshop.action;
const core = photoshop.core;
const imaging = photoshop.imaging;
const fs = storage.localFileSystem;

entrypoints.setup({
  panels: {
    openaiPanel: {
      show() {},
      hide() {},
    },
  },
});

const HISTORY_KEY = "openaiPhotoshop.history.v1";
const SETTINGS_KEY = "openaiPhotoshop.settings.v1";
const DEFAULT_BASE_URL = "http://127.0.0.1:49456/v1";
const DEFAULT_COMFY_URL = "http://192.168.1.128:8188";
const DEFAULT_CUTOUT_ANALYSIS_MODEL = "gpt-5.4-mini";
const DEFAULT_INPAINT_COMFY_MODEL = "comfy:flux-fill";
const MAX_BATCH_COUNT = 10;
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
};

const CRC32_TABLE = createCrc32Table();

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", init);

function init() {
  loadSettings();
  renderPromptPresets();
  bindEvents();
  updateModeUI();
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
    state.mode = button.dataset.mode;
    updateModeUI();
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
  $("apiKeyVisibilityBtn").addEventListener("click", toggleApiKeyVisibility);

  $("generateBtn").addEventListener("click", runGeneration);
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
  $("sizeInput").value = settings.size;
  $("qualityInput").value = settings.quality;
  $("countInput").value = clampInteger(settings.count, 1, MAX_BATCH_COUNT, 1);
  $("formatInput").value = settings.format;
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
    quality: $("qualityInput").value,
    count: clampInteger($("countInput").value, 1, MAX_BATCH_COUNT, 1),
    format: $("formatInput").value,
  };
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
  $("sizeField").classList.toggle("hidden", state.mode === "inpaint" || state.mode === "cutout");
  $("modeContextPanel").classList.toggle("hidden", state.mode === "generate");
  $("referenceContext").classList.toggle("hidden", state.mode !== "reference");
  $("selectionContext").classList.toggle(
    "hidden",
    state.mode !== "inpaint" && state.mode !== "outpaint" && state.mode !== "cutout"
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
      text: "按九宫格边距扩展画布，并用透明蒙版补全新增区域。",
      prompt: "扩图提示词 (Prompt)",
      negative: "反向提示词 (Negative Prompt)",
      placeholder: "描述扩展区域应该补出的画面...",
      negativePlaceholder: "不希望在扩展区域出现的内容...",
    },
    cutout: {
      icon: "◌",
      title: "特效抠图",
      text: "自动识别透明通道/主体/特效类型，再上传到 ComfyUI 输出透明 PNG。",
      prompt: "抠图类型 (可选，留空自动)",
      negative: "辅助说明 (可选)",
      placeholder: "auto / 白底主体 / 黑底光效 / 火焰 / 蓝色电光 / alpha...",
      negativePlaceholder: "例如：更透明、保留亮部、边缘柔和...",
    },
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
      setStatus("连接正常，服务可用");
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

async function runGeneration() {
  if (state.busy) return;

  const settings = getSettings();
  $("baseUrlInput").value = settings.baseUrl;
  $("comfyUrlInput").value = settings.comfyUrl;
  if (!settings.apiKey && !isComfyModel(settings.model) && state.mode !== "cutout") {
    setStatus("请先填写 OpenAI API Key");
    return;
  }

  const rawPrompt = $("promptInput").value.trim();
  if (!rawPrompt && state.mode !== "cutout") {
    setStatus("请先输入提示词");
    return;
  }

  const prompt = buildPrompt(rawPrompt || "auto", $("negativePromptInput").value.trim());
  saveSettings();
  setBusy(true);
  setProgress(8, true);

  try {
    setStatus("正在准备请求...");
    let items = [];
    let outputSize = settings.size;
    let targetRect = null;
    let placementRect = null;

    if (state.mode === "generate") {
      setProgress(20, true);
      items = await requestGenerations(settings, prompt);
    } else if (state.mode === "reference") {
      setProgress(18, true);
      const image = await exportActiveDocumentAsBase64();
      setProgress(36, true);
      items = await requestEdits(settings, buildImageEditPrompt(prompt, "reference"), image, null);
    } else if (state.mode === "inpaint") {
      setProgress(15, true);
      const selection = await getSelectionInfo();
      if (!isSelectionValid(selection)) {
        throw new Error("请先用选区工具选中要重绘的区域");
      }
      setProgress(34, true);
      setStatus("正在导出选区上下文...");
      const inpaint = await createInpaintInputs(selection, getDocumentSize(), settings.model);
      outputSize = inpaint.displaySize;
      targetRect = inpaint.targetRect;
      placementRect = inpaint.placementRect;
      setProgress(58, true);
      setStatus(`正在重绘选区，接口尺寸 ${inpaint.apiSize}，只导回 ${inpaint.displaySize}`);
      const inpaintSettings = getInpaintSettings(settings);
      items = await requestEdits(inpaintSettings, buildImageEditPrompt(prompt, "inpaint"), inpaint.image, inpaint.mask, { size: inpaint.apiSize });
      items = await compositeItemsWithOriginalMask(items, inpaint.image, inpaint.mask);
    } else if (state.mode === "outpaint") {
      setProgress(18, true);
      const image = await exportActiveDocumentAsBase64();
      const docSize = getDocumentSize();
      setProgress(36, true);
      const outpaint = await createOutpaintInputs(image, docSize, getPadding());
      setProgress(58, true);
      items = await requestEdits(settings, buildImageEditPrompt(prompt, "outpaint"), outpaint.image, outpaint.mask);
    } else if (state.mode === "cutout") {
      setProgress(18, true);
      const cutout = await createCutoutInputs();
      outputSize = cutout.displaySize;
      targetRect = cutout.targetRect;
      placementRect = cutout.placementRect;
      setProgress(42, true);
      const cutoutPrompt = await resolveCutoutPrompt(settings, prompt, cutout.image);
      setProgress(58, true);
      setStatus("正在提交 ComfyUI 抠图 workflow...");
      items = [await requestComfyCutout(settings, cutoutPrompt, cutout.image)];
    }

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
      targetRect,
      placementRect,
      cropRect: targetRect,
      createdAt: new Date().toISOString(),
    }));

    if (!stamped.length) {
      throw new Error("接口请求成功，但响应里没有可显示的图片数据");
    }

    state.results = [...stamped, ...state.results];
    state.selectedId = stamped[0]?.id || state.selectedId;
    setProgress(88, true);
    renderResults();
    await Promise.all(stamped.map(saveHistoryItem));
    if (state.mode === "cutout" && stamped[0]) {
      setProgress(92, true);
      setStatus("正在把抠图结果放回原位置...");
      await placeResultAsLayer(stamped[0], stamped[0].placementRect || stamped[0].targetRect, "OpenAI Cutout", null);
    }
    setProgress(100, true);
    setStatus(state.mode === "cutout"
      ? "完成：已创建抠图图层并放回原位置"
      : `完成：生成 ${stamped.length} 张`);
  } catch (error) {
    console.error(error);
    setStatus(`失败：${error.message || error}`);
  } finally {
    setBusy(false);
    window.setTimeout(() => setProgress(0, false), 700);
  }
}

function buildPrompt(prompt, negative) {
  if (!negative) return prompt;
  return `${prompt}\n\nAvoid: ${negative}`;
}

function getInpaintSettings(settings) {
  if (isComfyModel(settings.model)) {
    return settings;
  }
  setStatus("选区重绘已切到 AI 电脑 ComfyUI FLUX Fill...");
  return {
    ...settings,
    model: DEFAULT_INPAINT_COMFY_MODEL,
  };
}

function buildImageEditPrompt(prompt, mode) {
  const modeGuidance = {
    reference: [
      "Use the provided Photoshop image as the primary visual reference.",
      "Preserve the original composition, style, lighting, perspective, color palette, and texture unless the user prompt explicitly asks to change them.",
      "Make the requested change while keeping unrelated areas as close to the source image as possible.",
    ],
    inpaint: [
      "Use the provided Photoshop crop as the source image.",
      "This is a local inpainting task, not a full-image redraw.",
      "Only pixels inside the transparent mask may change. Treat every unmasked pixel as locked source material.",
      "Keep the original background, scenery, composition, lighting, perspective, color palette, texture, and edges unchanged outside the mask.",
      "If the request asks to remove UI, text, buttons, borders, panels, labels, icons, overlays, or other interface elements, remove only those foreground interface elements and reconstruct the hidden background from the surrounding original image.",
      "Do not repaint, redesign, restyle, or reinterpret visible background areas. Blend the filled area into the original image context.",
    ],
    outpaint: [
      "Use the provided Photoshop image as the source image.",
      "Only fill the transparent expanded canvas area. Preserve the original content, style, lighting, perspective, color palette, and texture.",
      "Extend the scene naturally from the existing image instead of replacing it.",
    ],
  };

  const guidance = modeGuidance[mode];
  if (!guidance) return prompt;
  return `${guidance.join("\n")}\n\nUser edit request:\n${prompt}`;
}

async function requestGenerations(settings, prompt) {
  const total = Math.max(1, settings.count);
  const results = [];

  for (let index = 0; index < total; index += 1) {
    setStatus(total > 1
      ? `正在调用 OpenAI 文生图 ${index + 1}/${total}...`
      : "正在调用 OpenAI 文生图...");
    setProgress(64 + Math.round((index / total) * 18), true);
    const batch = await requestSingleGeneration(settings, prompt);
    results.push(...batch);
  }

  return results.slice(0, total);
}

async function requestSingleGeneration(settings, prompt) {
  if (isComfyModel(settings.model)) {
    return requestSingleComfyEdit(settings, prompt, null, null, { mode: "generate" });
  }

  const payload = cleanObject({
    model: settings.model,
    prompt,
    n: 1,
    size: settings.size,
    quality: settings.quality,
    output_format: settings.format,
  });

  const response = await sendRequest(buildApiUrl(settings.baseUrl, settings.generationPath), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, "文生图请求");

  return parseOpenAIImageResponse(response);
}

async function requestEdits(settings, prompt, imageB64, maskB64, options = {}) {
  const total = Math.max(1, settings.count);
  const results = [];

  for (let index = 0; index < total; index += 1) {
    setStatus(maskB64
      ? `正在调用 OpenAI 局部编辑 ${index + 1}/${total}...`
      : `正在调用 OpenAI 参考图编辑 ${index + 1}/${total}...`);
    setProgress(68 + Math.round((index / total) * 14), true);
    const batch = await requestSingleEdit(settings, prompt, imageB64, maskB64, options);
    results.push(...batch);
  }

  return results.slice(0, total);
}

async function requestSingleEdit(settings, prompt, imageB64, maskB64, options = {}) {
  if (isComfyModel(settings.model)) {
    return requestSingleComfyEdit(settings, prompt, imageB64, maskB64, options);
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
  form.append("image", base64ToBlob(imageB64, "image/png"), "input.png");
  if (maskB64) {
    form.append("mask", base64ToBlob(maskB64, "image/png"), "mask.png");
  }

  setStatus(maskB64
    ? `正在上传局部编辑：图像 ${formatBytes(imageBytes)}，Mask ${formatBytes(maskBytes)}`
    : `正在上传参考图：${formatBytes(imageBytes)}`);

  const response = await sendRequest(buildApiUrl(settings.baseUrl, settings.editPath), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: form,
  }, maskB64 ? "局部编辑请求" : "参考图编辑请求");

  return parseOpenAIImageResponse(response);
}

async function requestSingleComfyEdit(settings, prompt, imageB64, maskB64, options = {}) {
  if (!imageB64 || !maskB64) {
    throw new Error("ComfyUI 预设目前只接局部重绘/透明补丁流程，请先选择需要编辑的区域。");
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
  const maskedInputB64 = await createComfyMaskInputBase64(imageB64, maskB64);
  await saveDebugBase64Image("comfy-last-mask-input.png", maskedInputB64);

  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
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
    const json = JSON.parse(await response.text());
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
  for (const item of items || []) {
    if (!item?.b64) {
      composited.push(item);
      continue;
    }
    const composite = await createInpaintCompositeImages(item.b64, originalB64, maskB64);
    composited.push({
      ...item,
      b64: composite.previewB64,
      importB64: composite.importB64,
      format: "png",
    });
  }
  return composited;
}

async function createInpaintCompositeImages(generatedB64, originalB64, maskB64) {
  const original = await loadImage(`data:image/png;base64,${stripDataUrl(originalB64)}`);
  const generated = await loadImage(`data:image/png;base64,${stripDataUrl(generatedB64)}`);
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

async function parseOpenAIImageResponse(response) {
  const text = await response.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch (error) {
    const detail = text ? text.slice(0, 300) : response.statusText;
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${json?.error?.message || response.statusText}`);
  }

  const data = json.data || [];
  return data.map((item) => ({
    b64: item.b64_json || item.b64 || null,
    url: item.url || null,
    format: item.output_format || item.format || null,
  }));
}

async function sendRequest(url, options = {}, label = "请求") {
  const { responseType, ...fetchOptions } = options;
  try {
    return await fetch(url, fetchOptions);
  } catch (fetchError) {
    if (typeof XMLHttpRequest === "undefined") {
      throw makeNetworkError(fetchError, url, label);
    }

    try {
      return await sendXhrRequest(url, options);
    } catch (xhrError) {
      throw makeNetworkError(xhrError, url, label);
    }
  }
}

function sendXhrRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method || "GET", url, true);
    xhr.timeout = 180000;
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
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText,
        text: () => Promise.resolve(getText()),
        arrayBuffer: () => Promise.resolve(xhr.response instanceof ArrayBuffer ? xhr.response : new ArrayBuffer(0)),
      });
    };
    xhr.onerror = () => reject(new Error("Network request failed"));
    xhr.ontimeout = () => reject(new Error("request timeout"));
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
    duplicateDoc = await sourceDoc.duplicate("OpenAI inpaint region", true);
    try {
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
    const shouldForceCapturedSelection = isCapturedRegionResult(item);
    const shouldFit = shouldForceCapturedSelection || $("fitSelectionInput").checked;
    const liveSelection = shouldFit && !shouldForceCapturedSelection && !item.placementRect && !item.targetRect
      ? await getSelectionInfo()
      : null;
    const placementRect = shouldForceCapturedSelection
      ? (item.placementRect || item.targetRect)
      : shouldFit
      ? (item.placementRect || item.targetRect || liveSelection)
      : null;
    const cropRect = shouldForceCapturedSelection
      ? (item.cropRect || item.targetRect)
      : shouldFit ? item.cropRect : null;
    const layerName = item.mode === "cutout" ? "OpenAI Cutout" : shouldForceCapturedSelection ? "OpenAI Inpaint" : "OpenAI Image";
    await placeResultAsLayer(item, placementRect, layerName, cropRect);
    setStatus(shouldForceCapturedSelection ? "已按生成时选区裁切导入" : "已导入到当前文档");
  } catch (error) {
    console.error(error);
    setStatus(`导入失败：${error.message || error}`);
  } finally {
    setBusy(false);
  }
}

function isCapturedRegionResult(item) {
  return (item?.mode === "inpaint" || item?.mode === "cutout") &&
    (isSelectionValid(item.placementRect) || isSelectionValid(item.targetRect));
}

async function placeResultAsLayer(item, selectionInfo, layerName, cropRect = null) {
  const binary = await resultToArrayBuffer(item, true);
  const format = item.format || detectFormatFromResult(item) || "png";
  const imageSize = getPngSize(binary) || { width: 1024, height: 1024 };

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
    await transformLayerToRect(importedLayer, selectionInfo);
  }

  if (isSelectionValid(cropRect) && importedLayer) {
    await applyRectMaskToLayer(importedLayer, cropRect);
  }
}

async function resultToArrayBuffer(item, preferImport = false) {
  const itemB64 = preferImport && item.importB64 ? item.importB64 : item.b64;
  if (itemB64) {
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

async function applyRectMaskToLayer(layer, rect) {
  await core.executeAsModal(async () => {
    await action.batchPlay([
      {
        _obj: "select",
        _target: [{ _id: layer.id, _ref: "layer" }],
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      },
      rectSelectionCommand(rect),
      {
        _obj: "make",
        new: { _class: "channel" },
        at: { _ref: "channel", _enum: "channel", _value: "mask" },
        using: { _enum: "userMaskEnabled", _value: "revealSelection" },
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName: "Crop OpenAI image to selection" });
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
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
      rgba[offset + 3] = 0;
    }
  }

  return bytesToBase64(encodePngRgba(width, height, rgba));
}

async function createInpaintInputs(selection, docSize, model) {
  const targetRect = clampRectToDocument(cloneRect(selection), docSize);
  const placementRect = getInpaintPlacementRect(targetRect, docSize, model);
  const apiSize = getImageEditSizeForSelection(placementRect.width, placementRect.height, model);
  const image = await exportDocumentRegionAsBase64(placementRect);
  const mask = await createSelectionMaskBase64(placementRect, targetRect);
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

function getInpaintPlacementRect(targetRect, docSize, model) {
  const contextualRect = expandRectForInpaintContext(targetRect, docSize);
  if (supportsFlexibleImageSize(model)) {
    return roundRectToPixels(contextualRect);
  }

  const apiSize = getImageEditSizeForSelection(contextualRect.width, contextualRect.height, model);
  return roundRectToPixels(clampRectToDocument(getPaddedPlacementRect(contextualRect, apiSize), docSize));
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

async function createSelectionMaskBase64(sourceRect, fallbackRect) {
  if (!imaging?.getSelection || !app.activeDocument) {
    return createRelativeRectMaskBase64(sourceRect.width, sourceRect.height, sourceRect, fallbackRect);
  }

  let selectionImage = null;
  try {
    selectionImage = await imaging.getSelection({
      documentID: app.activeDocument._id,
      sourceBounds: {
        left: sourceRect.left,
        top: sourceRect.top,
        right: sourceRect.right,
        bottom: sourceRect.bottom,
      },
    });

    const imageData = selectionImage?.imageData;
    const width = Math.round(toNumber(imageData?.width) || sourceRect.width);
    const height = Math.round(toNumber(imageData?.height) || sourceRect.height);
    const pixels = await imageData.getData({ chunky: true });
    const rgba = new Uint8Array(width * height * 4);
    const pixelCount = Math.max(1, width * height);
    const inferredComponents = Math.floor((pixels?.length || pixelCount) / pixelCount);
    const components = Math.max(1, imageData.components || inferredComponents || 1);

    for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
      const selected = Math.max(0, Math.min(255, pixels[pixelIndex * components] || 0));
      const offset = pixelIndex * 4;
      rgba[offset] = 255;
      rgba[offset + 1] = 255;
      rgba[offset + 2] = 255;
      rgba[offset + 3] = 255 - selected;
    }

    return bytesToBase64(encodePngRgba(width, height, rgba));
  } catch (error) {
    console.warn("createSelectionMaskBase64 failed, using rectangular mask", error);
    return createRelativeRectMaskBase64(sourceRect.width, sourceRect.height, sourceRect, fallbackRect);
  } finally {
    try {
      selectionImage?.imageData?.dispose?.();
    } catch (error) {
      console.warn("selection image dispose failed", error);
    }
  }
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
  const image = await loadImage(`data:image/png;base64,${stripDataUrl(imageB64)}`);
  const width = docSize.width + padding.left + padding.right;
  const height = docSize.height + padding.top + padding.bottom;

  const imageCanvas = document.createElement("canvas");
  imageCanvas.width = width;
  imageCanvas.height = height;
  const imageCtx = imageCanvas.getContext("2d");
  imageCtx.clearRect(0, 0, width, height);
  imageCtx.drawImage(image, padding.left, padding.top, docSize.width, docSize.height);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d");
  maskCtx.clearRect(0, 0, width, height);
  maskCtx.fillStyle = "rgba(255,255,255,1)";
  maskCtx.fillRect(padding.left, padding.top, docSize.width, docSize.height);

  return {
    image: await canvasToBase64(imageCanvas),
    mask: await canvasToBase64(maskCanvas),
  };
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

    tile.append(image);
    tile.addEventListener("click", () => selectResult(item, isCurrent));
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

  const meta = document.createElement("div");
  meta.className = "selected-preview-meta";
  meta.textContent = `${MODE_META[item.mode]?.label || "结果"} · ${item.size || "auto"} · ${item.format || "png"}`;

  preview.append(image, meta);
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
        loaded.push({ ...record, b64: arrayBufferToBase64(buffer) });
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
  $("importSelectedBtn").disabled = busy || !state.selectedId;
  $("clearResultsBtn").disabled = busy;
  $("saveSettingsBtn").disabled = busy;
  $("testConnectionBtn").disabled = busy;
  $("generateBtnLabel").textContent = busy ? "生成中..." : "生成";
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

function setStatus(message) {
  const text = formatStatusMessage(message);
  $("statusBar").textContent = text;
  const settingsStatus = $("settingsStatusBar");
  if (settingsStatus) {
    settingsStatus.textContent = text;
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
    pngChunk("IDAT", zlibStore(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function createIhdr(width, height) {
  const data = new Uint8Array(13);
  writeUint32(data, 0, width);
  writeUint32(data, 4, height);
  data[8] = 8;
  data[9] = 6;
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
  url = url.replace(/^(https?:\/\/)(?:localhost|127\.0\.0\.1):9456(\/|$)/i, `http://127.0.0.1:49456$2`);
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
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
