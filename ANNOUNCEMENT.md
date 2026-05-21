# OpenAI Photoshop Generator v0.1.65 公告

本次更新主要修复 Photoshop 面板里的抠图位置、按钮显示和设置页排版问题，并补充抠抠图官网入口。
新增 `拆图` 模式：使用 `gpt-image-2` 先识别画面里的独立元素，再把返回的透明 PNG 自动拆成多个 Photoshop 图层。

## 更新内容

- 修复抠抠图结果自动放回 Photoshop 后发生偏移的问题。
- 优化 Photoshop UXP 面板布局，修复模式按钮、设置页按钮、参数控件显示异常。
- 去掉没有实际操作意义的模式说明卡片，减少界面占用。
- 修复扩图边距控件位置异常，改为更稳定的左对齐输入布局。
- 在抠抠图 API 设置区增加官网和 API 文档入口：
  - 官网：https://www.koukoutu.com/
  - API 文档：https://www.koukoutu.com/dev
- 同步源插件目录和 Photoshop 运行目录，避免两边版本不一致导致按钮失效。
- 新增拆图：当前画布会走 OpenAI 图片编辑接口和 `gpt-image-2`，插件再按透明元素自动分层放回 Photoshop。

## 使用提示

更新后请关闭插件面板并重新打开；如果仍看到旧界面，请重启 Photoshop。新版界面顶部显示版本号 `v0.1.65`。

抠图模式仍使用当前配置的抠抠图 API Key，不会改变已有密钥和接口设置。
