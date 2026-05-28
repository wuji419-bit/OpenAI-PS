# OpenAI Photoshop Generator v0.1.75 公告

这次更新修正 `v0.1.74` 对 Cockpit Tools 本地 API 的判断：`http://127.0.0.1:49456/v1` 本来就可能提供图片生成能力，插件不应该提前拦截 `/images/generations` 和 `/images/edits`。

## 更新内容

- 撤掉对 `127.0.0.1:49456/v1/images/*` 的硬拦截，让请求真实发给 Cockpit Tools。
- 文生图、参考图、选区重绘、扩图、拆图会继续走设置里的图片接口路径。
- 如果 Cockpit 当前没有注册图片路由、账号没有图片模型权限，或模型不可用，插件会显示实际网络/HTTP 错误，并提示检查 Cockpit 图片生成开关、图片路由和 `gpt-image-2` 账号能力。
- 保留 `选区重绘` 的合成失败保护，避免合成失败时把模型原始乱改图直接导回 Photoshop。
- 版本号更新到 `v0.1.75`，并刷新前端缓存参数，方便确认 Photoshop 载入的是新版。

## 当前说明

这个版本不会再把 Cockpit Tools 当成“必然不支持图片”的中转。后续如果还报错，重点看 Cockpit Tools 本地侧车是否真的注册了 `/v1/images/generations` 和 `/v1/images/edits`，以及当前 Codex 账号是否能使用 `gpt-image-2`。
