# OpenAI Photoshop Generator

这是一个从零写的轻量版 Photoshop UXP 插件，目标是只服务 OpenAI 图像 API，不再继承 Stable Diffusion / A1111 / ComfyUI 那套复杂参数。

## 当前功能

- 文生图：输入提示词生成图片。
- 参考图编辑：把当前 Photoshop 画布导出为参考图，再交给 OpenAI 编辑。
- 矩形选区重绘：读取当前矩形选区，生成同尺寸 mask 后调用 OpenAI edits。
- 扩图：按上、下、左、右边距生成扩图输入和 mask。
- 结果预览：生成结果会在面板内显示缩略图。
- 导入图层：选中结果后可放进当前 Photoshop 文档。
- 贴合选区：导入时可自动缩放到当前矩形选区。
- 历史：结果图片写入插件数据目录，历史索引保存在 localStorage。
- 中文界面：主流程和状态提示均为中文。

## 文件位置

- 开发目录：`C:\Users\Administrator\source\OpenAI-Photoshop-Plugin`
- 打包文件：`C:\Users\Administrator\source\OpenAI-Photoshop-Plugin\dist\OpenAI-Photoshop-Generator-0.1.0.ccx`
- ZIP 备份：`C:\Users\Administrator\source\OpenAI-Photoshop-Plugin\dist\OpenAI-Photoshop-Generator-0.1.0.zip`

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
5. `/chat/completions` 是聊天接口，不是标准图片接口。除非你的本地服务自己把聊天接口改成返回图片 base64，否则图片插件应使用图片接口。
6. 选择模式，填写提示词。
7. 点击“生成”。
8. 在结果里点“导入”或先“选中”再“导入”。

## 下一步建议

- 把矩形选区升级为真实套索/通道 mask。
- 扩图导入时自动扩 Photoshop 画布。
- 加一个“打开为新文档”按钮。
- 加 prompt 预设和常用风格库。
