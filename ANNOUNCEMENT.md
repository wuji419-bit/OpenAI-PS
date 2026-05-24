# OpenAI Photoshop Generator v0.1.74 公告

这次更新主要处理本地中转 `http://127.0.0.1:49456/v1` 今天只支持 `/responses`、不支持图片端点导致插件一直报错的问题。

## 更新内容

- 当本地 `49456` 中转不支持 `/images/generations` 或 `/images/edits` 时，插件会直接提示“当前中转不支持图片端点”，不再只显示 `Network request failed`。
- `文生图`、`参考图`、`选区重绘`、`扩图`、`拆图` 都依赖图片端点；如果当前中转只剩 `/responses`，这些功能不能继续跑。
- `选区重绘` 合成失败时，不再把模型原始返回图当成结果显示或导入，避免整张图被模型乱改后还被放回 Photoshop。
- 版本号更新到 `v0.1.74`，并刷新前端缓存参数，方便确认 Photoshop 载入的是新版。

## 当前机器检查结果

我在本机测到：

- `http://127.0.0.1:49456/v1/responses` 正常。
- `http://127.0.0.1:49456/v1/images/generations` 返回 `404 endpoint not supported`。
- `http://127.0.0.1:49456/v1/images/edits` 返回 `404 endpoint not supported`。

所以这不是 Photoshop 选区的问题，而是当前中转没有图片生成/编辑接口。要继续用这些功能，需要换成支持 `/images` 的 OpenAI 中转或官方 OpenAI API。
