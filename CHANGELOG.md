# Changelog

All notable changes to this project are documented here.

## [0.1.68] - 2026-05-22

### Changed

- Changed split mode from connected-component splitting to semantic `gpt-image-2` layer extraction, so connected UI parts can become separate layers such as frame, fill bar, badge, and text.

## [0.1.67] - 2026-05-22

### Fixed

- Made result previews much larger in the Photoshop panel: one-column result tiles and a taller selected preview, so cutout and split-layer outputs are inspectable.

## [0.1.66] - 2026-05-21

### Fixed

- Cropped transparent result previews to visible pixels so cutout and split-layer thumbnails are large enough to inspect while preserving original import size and placement.

## [0.1.65] - 2026-05-21

### Added

- Added a `拆图` mode that sends the current Photoshop canvas to `gpt-image-2`, asks it to isolate visible elements on a transparent PNG, then splits the returned elements into separate Photoshop layers.

## [0.1.64] - 2026-05-21

### Changed

- Removed the Koukoutu auto-crop checkbox from settings because cutout placement now always preserves the original canvas/selection size.

## [0.1.63] - 2026-05-21

### Fixed

- Replaced the top-right SVG-only settings icon with a visible text `设置` button for Photoshop UXP compatibility.

## [0.1.62] - 2026-05-21

### Added

- Added official Koukoutu website and API documentation links in the Koukoutu API settings section.
- Added a user-facing Chinese release announcement for the Photoshop panel update.

### Fixed

- Fixed Koukoutu cutout placement drift by forcing the synchronous API response to keep the original canvas/selection size.
- Reworked Photoshop UXP panel styling so mode tabs, settings buttons, parameter controls, and outpaint padding fields render in stable positions.
- Removed the non-actionable mode explanation card from the main workflow to reduce visual clutter.
- Synchronized the source plugin folder and the Photoshop `PluginsStorage` runtime copy for HTML, CSS, manifest version, and button binding behavior.

## [0.1.56] - 2026-05-17

### Changed

- Added semantic target detection before selection repaint: when a prompt asks to replace a character or subject, GPT first locates the current source subject inside the selected region and the edit mask is shrunk to that box.
- This makes broad module selections behave like ChatGPT-style surgical edits: chair/throne, base, frame, text, numbers, icons, props, and background stay outside the editable mask unless the prompt explicitly targets them.

## [0.1.55] - 2026-05-17

### Changed

- Added a local-edit lock to selection repaint prompts so subject replacement requests preserve unmentioned UI/icon details inside the selected region.
- Added a "局部角色替换" prompt preset for character swaps that should keep the chair, base, frame, text, props, lighting, and original 2D game-icon style unchanged.

## [0.1.49] - 2026-05-15

### Added

- Added a dedicated Koukoutu API settings section with `X-API-Key`, output format, edge enhancement, and crop options.
- Routed Cutout mode to Koukoutu's synchronous `background-removal` API and places the returned transparent result back into Photoshop.

## [0.1.48] - 2026-05-15

### Fixed

- Removed the experimental feather-specific mask refinement so selection repaint uses the actual Photoshop selection/mask generically again.
- Kept the more stable fetch transport for OpenAI-compatible image edits.

## [0.1.47] - 2026-05-14

### Fixed

- Use the fetch transport for OpenAI-compatible image edits so local cockpit-tools requests are less likely to fail as UXP XHR long requests.
- Refine selection repaint masks for white feather removal prompts so broad rectangular selections edit the feather instead of the whole rectangle.

## [0.1.46] - 2026-05-14

### Fixed

- Show string-style OpenAI-compatible error bodies, including cockpit-tools Codex authorization failures, instead of only `Service Unavailable`.

## [0.1.45] - 2026-05-14

### Fixed

- Made the prompt action controls visible as text buttons in the Photoshop UXP panel.
- Let result thumbnails and the large selected preview import with a double-click.
- Imported no-mask reference-region results as the full generated crop instead of reapplying the selection crop mask.

## [0.1.44] - 2026-05-14

### Changed

- Reference mode now uses a no-mask image-to-image edit path for the current selection when one exists.
- Reference mode exports the selected region with surrounding context and imports the result back to that captured region.
- Removed the inactive Influence Strength slider from Reference mode.

## [0.1.43] - 2026-05-14

### Fixed

- Kept selection repaint status updates alive after the OpenAI edit request returns, covering response reading, JSON parsing, and mask compositing.
- Forced OpenAI-compatible image edit requests through XHR to avoid Photoshop UXP fetch stalls on multipart uploads with large b64 JSON responses.
- Yielded during mask compositing so large selected areas do not make the Photoshop panel look frozen after the model response arrives.

## [0.1.42] - 2026-05-14

### Changed

- Simplified the main parameter controls by removing visible Quality and Format controls.
- Fixed image requests to use automatic quality and PNG output while keeping only Count visible.
- Tightened the parameter layout and removed output format text from the selected result preview.

## [0.1.41] - 2026-05-14

### Fixed

- Kept the OpenAI/Codex image route on `gpt-image-2` after auth import so it stays compatible with the cockpit-tools local API service.
- Extended OpenAI-compatible image edit request timeout to 12 minutes so slower Codex `/images/edits` jobs are not cut off at 120 seconds.

## [0.1.40] - 2026-05-14

### Fixed

- Replaced the top-right settings SVG icon with a stable text glyph so it remains visible in the Photoshop UXP panel.

## [0.1.39] - 2026-05-14

### Added

- Added a direct OpenAI auth JSON importer in settings.
- The importer accepts official `sk-...` API keys directly or JSON objects containing `api_key`, `apiKey`, `OPENAI_API_KEY`, or `openai_api_key`.

### Changed

- Direct auth import sets Base URL to `https://api.openai.com/v1`, endpoints to `/images/generations` and `/images/edits`, and model to `gpt-image-1.5`.

### Rejected

- Account `id_token`, `access_token`, and `refresh_token` values are not used for OpenAI API auth; the plugin now shows a clear message when those are pasted without an API key.

## [0.1.38] - 2026-05-14

### Fixed

- Added explicit fetch timeouts so stalled OpenAI edit proxy requests fail instead of leaving the panel in an infinite generating state.
- Selection repaint `/images/edits` requests now time out after 120 seconds with a clear network failure message.

## [0.1.37] - 2026-05-14

### Changed

- Selection repaint now forces a single OpenAI edit request even when the global count is higher.
- OpenAI edit requests now update the status while waiting for the model response instead of leaving the UI at the upload message.

## [0.1.36] - 2026-05-14

### Changed

- Locked the routing boundary: only Cutout mode uses the configured ComfyUI server.
- Text-to-image, reference edit, selection repaint, and outpaint now stay on OpenAI-compatible image endpoints even if an older `comfy:*` model value is still stored locally.
- Removed ComfyUI inpaint presets from the visible Model ID suggestions to avoid accidental route changes.

### Fixed

- Prevented selection repaint from being routed to ComfyUI because of stale model settings.

## [0.1.35] - 2026-05-14

### Changed

- Selection repaint uses OpenAI-compatible image models and the configured `/images/edits` endpoint.
- Updated the plugin version from `0.1.34` to `0.1.35`.

### Fixed

- Removed the forced `comfy:flux-fill` fallback from selection repaint so local OpenAI-compatible edit proxies are used intentionally.

## [0.1.34] - 2026-05-14

### Added

- Added ComfyUI workflow support for selection repainting with Basic Inpaint, SDXL Inpaint, and FLUX Fill presets.
- Added a Cutout mode that sends the active canvas or selected region to a remote ComfyUI server and places the transparent PNG result back into Photoshop at the original position.
- Added RMBG-based subject cutout for opaque character, prop, monster, weapon, and white-background assets.
- Added automatic cutout strategy detection with optional GPT vision assistance and local fallback heuristics.
- Added bundled ComfyUI API workflow JSON files and remote setup notes for AI-machine deployment.
- Added progress updates for upload, queue, wait, download, and Photoshop placement stages.

### Changed

- Added experimental ComfyUI inpaint workflow files for remote setup validation; active plugin routing was later restricted in `0.1.36` so only Cutout mode uses ComfyUI.
- ComfyUI inpaint outputs are mask-locked so pixels outside the selected mask are restored from the original input.
- Cutout no longer treats fully opaque PNGs as already-cut transparent assets; existing alpha is only used when meaningful transparency is detected.
- Bumped the plugin version from `0.1.20` to `0.1.34`.

### Fixed

- Fixed ComfyUI prompt responses with empty `node_errors: {}` being treated as failures.
- Fixed opaque source images being returned unchanged by Cutout mode.
- Fixed Cutout mode routing so it uses the configured ComfyUI server instead of local image-edit endpoints.

## [0.1.20] - 2026-05-08

### Added

- Published the real Photoshop UXP plugin source in the repository root.
- Added OpenAI Image API generation and edit workflows.
- Added text-to-image, reference edit, selection repaint, and outpaint modes.
- Added result preview, local history, and Photoshop layer import workflow.
- Added maintainer documentation, issue templates, security policy, and roadmap.

### Changed

- Rewrote the root README to describe the Photoshop + OpenAI image workflow project clearly.
- Removed unrelated GitHub plugin scaffold files from the public project tree.
