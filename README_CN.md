# OpenAI Photoshop Generator

当前版本：**v0.1.297**

这是一个从零写的轻量版 Photoshop UXP 插件，目标是在 Photoshop 里直接完成 OpenAI 图像生成、局部重绘、扩图、拆图，以及通过抠抠图 API 做透明 PNG 抠图。

## 当前功能

- 文生图：输入提示词生成图片。
- 参考图编辑：把当前 Photoshop 画布导出为参考图，再交给 OpenAI 编辑。
- 双图风格参考：参考图模式可额外选择“图二”；当前 Photoshop 画布或选区作为图一，通过用户自己运行的外部 ComfyUI GPT Image2 Alpha 工作流处理。
- 选区重绘：读取当前 Photoshop 选区边界，导出白底截图参考图，通过 `/responses` 图像工具按普通上传图片编辑；正常大小的选区直接上传原始白底截图，只对极小选区补最小白边；不把选区作为 API mask 发送，返回后再按原选区放回新图层。
- 扩图：按上、下、左、右边距生成扩图输入和 mask。
- 抠图：把当前画布或选区上传到抠抠图同步接口，返回透明 PNG/WebP，并自动放回原位置成为新图层。
- 拆图：用 `gpt-image-2` 识别并抽取独立语义图层，也支持在提示词里手动指定拆图目标。
- 结果预览：生成结果会在面板内显示缩略图。
- 导入图层：选中结果后可放进当前 Photoshop 文档。
- 贴合选区：导入时可自动缩放到当前矩形选区。
- 历史：结果图片写入插件数据目录，历史索引保存在 localStorage。
- 中文界面：主流程和状态提示均为中文。

## 文件位置

- macOS Git 仓库：`/Users/yjm/source/OpenAI-PS`
- macOS 当前开发同步目录：`/private/tmp/openai-photoshop-generator-dev`
- macOS Photoshop 外部插件目录：`~/Library/Application Support/Adobe/UXP/Plugins/External/com.local.openai.photoshop.generator`
- macOS Photoshop 插件存储目录：`~/Library/Application Support/Adobe/UXP/PluginsStorage/PHSP/27/External/com.local.openai.photoshop.generator`
- macOS 同步后强制刷新 Photoshop 面板：`node scripts/reload-photoshop-plugin.js`
- macOS 在真实 Photoshop 运行时执行六模式离线诊断：`node scripts/run-photoshop-smoke.js`
- 如果 reload 提示 `ECONNREFUSED 127.0.0.1:14001`，说明 Adobe UXP Developer Tool 的 websocket 服务没有在接连接；先打开 UXP Developer Tool 并确认 Photoshop 已连接，再重新运行 reload 或重启验证脚本。
- 如果真实 Photoshop smoke 报 “Photoshop 是模态的” 或 “host application is busy or in a modal state”，先解锁屏幕并关闭 Photoshop 里的错误/确认弹窗，再重新运行上面的脚本。
- 如果 reload/smoke 进一步提示 `stale temporary ScriptPlugin modal command`、`waiting for debugger attach`、`cannot remove the existing plugin session`，或显示最近 UXP 日志里有 `remove attempt(s) but no init 当前版本 line`，说明 Photoshop 的 UXP 宿主里残留了旧调试脚本插件的模态状态；只重启 UXP Developer Tools 不够，需要保存 PSD、重启 Photoshop 后再运行同步和 smoke。
- Windows Photoshop 外部插件目录：`%APPDATA%\Adobe\UXP\Plugins\External\com.local.openai.photoshop.generator`
- Windows Photoshop 插件存储目录：`%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\External\com.local.openai.photoshop.generator`

## 安装方式

当前机器没有检测到 Adobe UPIA：

`C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe`

所以 `.ccx` 不能在这台机器上直接命令安装。官方推荐方式是：

1. 安装 Adobe Creative Cloud。
2. 安装 Adobe UXP Developer Tool。
3. 在 UXP Developer Tool 里 Add Plugin，选择本项目的 `manifest.json`。
4. 选择 Photoshop，点击 Load。

我也已经把开发版复制到了这些目录，Photoshop 重启后可以检查“插件”菜单：

- `C:\Users\Administrator\AppData\Roaming\Adobe\UXP\Plugins\External\com.local.openai.photoshop.generator`
- `C:\Program Files\Common Files\Adobe\UXP\Plugins\External\com.local.openai.photoshop.generator`
- `C:\Program Files\Common Files\Adobe\UXP\Developer\com.local.openai.photoshop.generator`

但 Adobe 文档说明 UXP 插件不能只靠直接拷贝目录完成正式安装，通常还需要 `.ccx` 安装器或 UXP Developer Tool 写入插件数据库。

## 使用方式

1. 打开插件面板。
2. 点击右上角齿轮，填写服务配置。
3. 官方 OpenAI 默认配置：
   - 服务地址：`https://api.openai.com/v1`
   - 文生图接口：`/images/generations`
   - 编辑接口：`/images/edits`
   - 模型：`gpt-image-2`
4. 本地转发服务示例：
   - 服务地址：`http://127.0.0.1:49456/v1`
   - 文生图接口：`/images/generations`
   - 编辑接口：`/images/edits`
   - API Key：填本地服务要求的密钥
   - 模型：填本地服务支持的图片模型 ID
5. 选区重绘会优先使用 `/responses` 的 `image_generation` 工具执行 ChatGPT 风格截图编辑；如果该接口不可用，会停止并报错，避免退回旧的 mask 编辑路径。
6. `/responses` 图像工具的主控模型默认使用 `gpt-5.5`；如果服务返回 `model_not_available`，插件会自动尝试备用主控模型，但仍会把配置里的 `gpt-image-2` 保留在图像生成工具上。
6. 选区重绘的提示词约束是通用规则：按用户文字识别要移除或修改的完整可见目标，并把用户明确说“不变/保持/保留/不要动”的内容当作保护参考，不依赖“手、弓”等特定对象词。
7. `/chat/completions` 是聊天接口，不是标准图片接口。除非你的本地服务自己把聊天接口改成返回图片 base64，否则图片插件应使用图片接口。
8. 选择模式，填写提示词。
9. 点击“生成”。
10. 在结果里点“导入”或先“选中”再“导入”。

## 本地验证

每次修改后先在仓库根目录运行：

```bash
node --check src/app.js
node --check scripts/smoke-plugin.js
node scripts/sync-runtime-copies.js
node scripts/smoke-plugin.js
node scripts/audit-plugin-state.js
```

`scripts/smoke-plugin.js` 通过时会输出 `PLUGIN_SMOKE_MATRIX`，其中 `generate/reference/inpaint/outpaint/cutout/split=ok` 表示六个主要功能路径都被离线跑过；`noMaskReference=ok` 和 `noMaskInpaint=ok` 表示参考图选区编辑和选区重绘都走普通上传截图路径，没有退回 API mask；`maskedOutpaint=ok` 表示扩图仍然走带 mask 的扩展画布路径；`cutoutOriginalSize=ok` 和 `splitFullCanvas=ok` 表示抠图与拆图层保留原区域/整画布尺寸，避免回贴漂移。

`scripts/audit-plugin-state.js` 是只读总审计：它会报告源码/运行时副本/Photoshop 插件信息缓存是否同版、UXP Developer Tool 当前 workspace 指向哪个插件目录、Photoshop 进程是否正在运行及其 PID、smoke 覆盖钩子是否存在，以及当前 Photoshop UXP 进程是否仍需要重启才会加载磁盘上的新版。输出行里的 `panelVersion=stale-in-memory` 表示磁盘和缓存已经是新版，但 Photoshop 面板还在显示旧内存会话。

最终验收可以用严格模式：

```bash
node scripts/audit-plugin-state.js --strict-runtime
```

严格模式会在 Photoshop 运行时还没有初始化当前插件版本时返回失败，避免把“磁盘已经同步”误判为“真实 Photoshop 已加载新版”。

Photoshop 重启并加载新版面板后，再运行：

```bash
node scripts/run-photoshop-smoke.js
```

它会在真实 Photoshop UXP 运行时执行同一组六模式离线诊断，并输出 `PHOTOSHOP_SMOKE_MATRIX` 和 `PHOTOSHOP_SMOKE_OK`。矩阵里会同时打印 `runtimePluginVersion` 和 `panelVersion`，用来证明真实面板已经加载当前版本。如果 reload/smoke 仍提示旧版本 init、`stale temporary ScriptPlugin modal command` 或 `cannot remove the existing plugin session`，说明 Photoshop 进程还没清掉旧 UXP 会话，需要保存 PSD 后重启 Photoshop。

保存 PSD 后，也可以使用带保护的重启验证脚本：

```bash
node scripts/restart-photoshop-and-smoke.js
node scripts/restart-photoshop-and-smoke.js --confirm-saved
```

第一条只输出 dry-run 提示，不会退出 Photoshop；第二条只有在你已经确认 PSD 保存后才会退出并重新打开 Photoshop，然后自动执行同步、reload、真实 Photoshop smoke 和最终状态审计。
如果这条流程失败，它会输出 `PHOTOSHOP_RESTART_FAILED` 和 `PHOTOSHOP_RESTART_NEXT_ACTION`，按后者提示处理即可。

## 抠抠图 API 配置

只有“抠图”模式会走抠抠图同步接口；文生图、参考图、选区重绘、扩图、拆图都走 OpenAI 兼容图片接口。其中选区重绘走 `/responses` 图片工具，不走 `/images/edits` mask 上传。抠图接口固定为：

```text
https://sync.koukoutu.com/v1/create
```

需要在插件设置里填写抠抠图 `X-API-Key`。插件会固定使用 `crop=0`，让返回图保持原画布或原选区尺寸，避免放回 Photoshop 时发生偏移。

仓库内保留的是用于连接外部服务的 ComfyUI workflow 描述文件。插件不内置 ComfyUI 程序、模型或自定义节点：

- `comfyui-workflows/codex_basic_inpaint_masklock_api.json`
- `comfyui-workflows/codex_sdxl_inpaint_masklock_api.json`
- `comfyui-workflows/codex_flux_fill_inpaint_masklock_api.json`
- `comfyui-workflows/codex_transparent_png_effect_composite_api.json`
- `comfyui-workflows/codex_gpt_image2_alpha_api.json`

远程机器安装和校验说明在 `comfyui-remote-setup/`。

## 下一步建议

- 为选区重绘增加更多真实图片回归用例，覆盖手、文字、水印、道具遮挡等常见局部编辑。
- 加一个“打开为新文档”按钮。
- 加 prompt 预设和常用风格库。
