# Changelog

All notable changes to this project are documented here.

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
