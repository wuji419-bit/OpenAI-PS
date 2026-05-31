# Changelog

All notable changes to this project are documented here.

## [0.1.291] - 2026-05-31

### Changed

- Selection repaint no longer stops when the returned screenshot result has a different aspect ratio from the original Photoshop selection. Mismatched results are fitted back to the exact selected crop size before import, and older direct-selection patch imports now warn instead of failing on ratio differences.

## [0.1.290] - 2026-05-31

### Fixed

- Automatic semantic split placement now uses the same visible-bounds alignment path as manual import, so transparent split layers are moved back onto their original canvas coordinates instead of relying on Photoshop's default placed-object bounds.
- Split result metadata now preserves the Koukoutu matte flag for live diagnostics, making it easier to verify that拆图 layers used the API cutout path rather than the old JavaScript white-matte fallback.

## [0.1.289] - 2026-05-31

### Fixed

- Semantic split now sends each full-canvas white-matte layer through the configured Koukoutu background-removal API instead of using JavaScript white-threshold matting, preserving cleaner edges and avoiding speckled/broken cutouts.
- Split imports now record each layer's visible bounds and align those bounds back to the original canvas position, preventing transparent PNGs from being centered by Photoshop's visible-bounds placement behavior.
- Split mode now requires the Koukoutu API key up front because the transparent alpha matte is part of the intended拆图 workflow.

## [0.1.288] - 2026-05-31

### Fixed

- Semantic split layer extraction now retries transient upstream failures such as `HTTP 502`, `EOF`, and `upstream_error` before giving up on an individual layer.
- Dense split runs no longer abort the whole job when one generated layer fails; failed layer targets are skipped after retries so successful layers can still be imported back into Photoshop.
- Codex sidecar split extraction now pauses briefly between full-canvas layer requests to reduce upstream disconnects during high-count拆图 batches.

## [0.1.287] - 2026-05-30

### Changed

- Semantic split now plans拆图 in two passes: first broad visual blocks such as victory banners, ranking panels, reward grids, CTA strips, and bottom buttons, then detailed child elements inside each block.
- Automatic split planning now allows up to 40 semantic targets, treats general “拆所有元素” instructions as auto-detection hints instead of one target, and asks for high-detail vision analysis so dense game-result screens can be decomposed more carefully.
- Split layer extraction prompts now carry the large-block context and approximate canvas region, reducing merged neighboring elements while preserving full-canvas original-coordinate layer placement.

## [0.1.286] - 2026-05-29

### Fixed

- Selection repaint no longer source-aligns or moves pixels inside the returned PNG. The request path and model-returned image content are left alone after crop/size normalization; the placement correction is only applied when Photoshop imports the result layer, using the real imported layer bounds to scale and move it back onto the original selected rectangle.
- Preserved the active Cockpit Tools local API port at `http://127.0.0.1:49456/v1` while applying the repaint placement fix, so the remote port restoration is not overwritten.

## [0.1.285] - 2026-05-29

### Fixed

- Selection repaint placement now uses the actual Photoshop layer bounds immediately after import when the returned PNG covers the full selected crop, instead of assuming Photoshop placed the image at the canvas center. Real Photoshop smoke diagnostics now fail if a direct selection patch layer does not land on the original selected rectangle.

## [0.1.284] - 2026-05-29

### Fixed

- Selection repaint keeps the existing prompt behavior but removes broad non-white footprint anchoring; returned images are normalized to the original crop size, white-matted, then source-aligned by visual matching so preserved content is moved back toward its original uploaded-screenshot position without guessing from unrelated objects.

## [0.1.283] - 2026-05-29

### Fixed

- Selection repaint footprint normalization now scales protected returned content around the model result's own center instead of snapping it to the broad non-white bounds of the original selection, preventing preserved objects from shifting when the selected crop also contains content that should be removed.

## [0.1.282] - 2026-05-29

### Fixed

- Selection repaint now normalizes same-ratio high-resolution model returns back to the original Photoshop crop dimensions and white-mattes transparent padding before placement, preventing Photoshop from shrinking smart-object bounds such as a 244x182 feather crop down to the model's visible 86px content.

## [0.1.281] - 2026-05-29

### Fixed

- Selection repaint now records the original non-white footprint of protected screenshot crops and, for preservation prompts, rescales a shrunken returned subject back into that footprint before Photoshop placement.

## [0.1.280] - 2026-05-29

### Changed

- Selection repaint now uploads the selected Photoshop crop itself as a white-matted screenshot instead of adding an extra white context margin, and the Responses prompt explicitly forbids shrinking the protected object's visible footprint inside the crop.

## [0.1.279] - 2026-05-29

### Changed

- Tightened the Photoshop panel parameter section spacing, shrinking the quantity input, checkbox row, and section padding so the area below the negative prompt no longer leaves a wide empty block.

## [0.1.278] - 2026-05-29

### Fixed

- Real Photoshop offline diagnostics now return a white padded screenshot canvas for inpaint smoke tests, so the direct-selection-patch invariant exercises the same crop-back safety path as ChatGPT-style repaint instead of tripping the unsafe full-canvas guard.

## [0.1.277] - 2026-05-29

### Fixed

- Responses image workflows now default the mainline controller model back to `gpt-5.5` and retry alternate controller models on `model_not_available`, while keeping `gpt-image-2` on the image tool itself.

## [0.1.276] - 2026-05-29

### Added

- Offline and real Photoshop smoke matrices now include `cutoutOriginalSize` and `splitFullCanvas`, so cutout placement and semantic split full-canvas coordinate preservation are explicitly covered instead of only proving those modes were called.

## [0.1.275] - 2026-05-29

### Added

- Runtime audits now print `panelVersion=stale-in-memory` plus source/cache/runtime version evidence, and real Photoshop smoke matrices include both `runtimePluginVersion` and the visible `panelVersion`, making stale Photoshop UXP sessions distinguishable from unsynced plugin files.

## [0.1.274] - 2026-05-29

### Added

- History smoke coverage now verifies that direct screenshot repaint patches keep `direct-selection-patch`, `skipPreviewCrop`, null `cropRect`, full-image-size placement, and import bytes after save/load, preventing history reimports from falling back to old mask or visible-bounds placement behavior.

## [0.1.273] - 2026-05-29

### Added

- Pixel-level screenshot repaint smoke coverage now includes an arbitrary sticker-over-cup selection, proving non-hand/non-bow local edits still export a white-matted normal image reference, keep protected pixels, composite semi-transparent edit targets as ordinary pixels, and avoid API masks.

## [0.1.272] - 2026-05-29

### Added

- Smoke coverage now verifies that the sanitized `/responses` screenshot-repaint debug request record exposes metadata such as byte count and format while omitting API keys and image base64 bytes.

## [0.1.271] - 2026-05-29

### Added

- Smoke coverage now includes a non-hand/non-bow screenshot repaint prompt (`remove the red sticker, keep the cup unchanged`) to prove generic local-edit and protected-content guidance applies to arbitrary objects, not only the original bow/hand regression.

## [0.1.270] - 2026-05-29

### Changed

- Selection screenshot repaint guidance now uses generic complete-target removal and protected-content rules instead of hand/paw/bow-specific prompt wording, so local edits rely on the user's instruction rather than object-specific hacks.

## [0.1.269] - 2026-05-29

### Fixed

- Reload and guarded restart diagnostics now identify `ECONNREFUSED` from the UXP Developer Tool websocket separately, telling the operator to open/connect Adobe UXP Developer Tool instead of treating the failure as an unsynced plugin copy.

## [0.1.268] - 2026-05-29

### Fixed

- Photoshop process reporting in the state audit now filters out transient `pgrep` helper matches, so the PID evidence only lists the real Photoshop host process while preserving the raw match list for debugging.

## [0.1.267] - 2026-05-29

### Added

- State audit output now includes the running Photoshop process state, PID details, and the UXP Developer Tool workspace plugin path/version status, making stale in-memory panels distinguishable from unsynced workspaces or stopped hosts.

## [0.1.266] - 2026-05-29

### Added

- Koukoutu cutout now writes a sanitized `cutout-last-koukoutu-request.json` debug record proving `crop=0`, `stampCrop=0`, raw byte response mode, input/output formats, and endpoint routing without storing API keys or image bytes.

## [0.1.265] - 2026-05-29

### Added

- Runtime sync and state audit now verify hashes for every managed plugin/support script, not just manifest/app/html versions, so six-mode smoke, Photoshop smoke, reload, restart, and sync helpers cannot silently drift in runtime copies.

## [0.1.264] - 2026-05-29

### Added

- `openai-last-inpaint-input.json` now exposes the original selection's non-white content ratio plus the protected-blank-result safety thresholds, making blank-result rejection auditable when a preserved object would otherwise be erased.

## [0.1.263] - 2026-05-29

### Fixed

- Selection repaint now refuses to import an almost blank crop when the prompt includes preservation constraints and the original selected screenshot contained visible protected content, preventing model failures from wiping out objects the user explicitly asked to keep unchanged.

## [0.1.262] - 2026-05-29

### Changed

- Preservation wording entered in the negative prompt field, such as "不要改变弓" or "keep the bow unchanged", is now labeled as `Preservation constraints` instead of generic negative constraints. This reduces the chance that protected objects are interpreted as things to avoid or remove during selection repaint.

## [0.1.261] - 2026-05-29

### Changed

- ChatGPT-style no-mask screenshot/reference edits now send the uploaded image before the instruction text in the Responses message content, matching the user's web workflow more closely. The sanitized debug request records expose `inputContentOrder=image-first` for verification.

## [0.1.260] - 2026-05-29

### Changed

- ChatGPT-style selection repaint prompts now state that the user's text is the only edit specification, and that anything described as unchanged, preserved, kept, or not touched is protected reference content. This makes "remove this, keep that unchanged" behavior generic instead of relying on object-specific prompt tweaks.

## [0.1.259] - 2026-05-29

### Changed

- Photoshop runtime offline diagnostics now verify the two placement invariants most tied to drift: selection repaint must place as a no-mask `direct-selection-patch`, and outpaint must record an actual canvas expansion before placing the returned layer.

## [0.1.258] - 2026-05-29

### Added

- Selection repaint screenshot export now writes `openai-last-inpaint-input.json`, a sanitized metadata record proving the model upload is a normal white-matted screenshot reference with `hasMask=false`, including canvas/crop geometry without storing image base64.
- State audit output now includes the latest Photoshop UXP init versions, whether the expected version was ever initialized, the stale in-memory version, and the exact restart-and-smoke command needed when disk/cache are current but Photoshop still displays an older panel.

## [0.1.257] - 2026-05-29

### Changed

- The guarded Photoshop restart verifier now emits `PHOTOSHOP_RESTART_FAILED` plus a concrete `PHOTOSHOP_RESTART_NEXT_ACTION` hint when quit, reload, runtime smoke, or strict audit fails.

## [0.1.256] - 2026-05-29

### Changed

- `scripts/audit-plugin-state.js` now supports `--strict-runtime` so final validation fails until the running Photoshop UXP process has actually initialized the current plugin version; the guarded restart helper uses this strict audit after runtime smoke.

## [0.1.255] - 2026-05-29

### Changed

- Selection repaint placement status now says the screenshot edit is being placed back at the original selection position, avoiding stale "selection protection mask layer" wording on the current no-mask direct patch workflow.

## [0.1.254] - 2026-05-29

### Added

- Added `scripts/restart-photoshop-and-smoke.js`, a guarded restart-and-verify helper that defaults to dry-run and only quits Photoshop when `--confirm-saved` is explicitly provided, then syncs runtime copies, reloads the plugin, runs Photoshop runtime smoke, and audits final state.

## [0.1.253] - 2026-05-29

### Fixed

- State audit coverage detection now cross-checks the six major mode names across plugin runtime diagnostics, local smoke, and Photoshop runtime smoke scripts instead of relying on generated matrix output text.

## [0.1.252] - 2026-05-29

### Added

- Added `scripts/audit-plugin-state.js`, a read-only state audit that reports source/runtime version sync, Photoshop plugin info cache status, six-mode smoke coverage hooks, and whether the current Photoshop UXP process still needs a restart to load the synced plugin.

## [0.1.251] - 2026-05-29

### Changed

- Photoshop runtime offline diagnostics now log a coverage matrix for all six major modes plus the critical no-mask reference/repaint and masked-outpaint route invariants.

## [0.1.250] - 2026-05-29

### Fixed

- `/images/edits` debug request records now sanitize endpoint URLs by removing credentials, query strings, and fragments, and smoke output now reports a six-mode coverage matrix for the major plugin workflows.

## [0.1.249] - 2026-05-29

### Fixed

- OpenAI-compatible `/images/edits` requests now write a sanitized `openai-last-images-edit-request.json` debug record with route, mask presence, file formats, model, fidelity mode, and prompt metadata, so compatibility-path edits can be audited without exposing API keys or image bytes.

## [0.1.248] - 2026-05-29

### Fixed

- GPT Image 2 edit requests no longer send an explicit `input_fidelity` field, matching OpenAI's current API contract where GPT Image 2 automatically uses high-fidelity input handling and rejects manual fidelity changes. The debug request record now labels GPT Image 2 edits as `automatic-high` instead.

## [0.1.247] - 2026-05-29

### Fixed

- High-fidelity image edit requests now skip GPT Image mini variants, matching OpenAI's documented support boundary and avoiding rejected selection repaint requests when a mini image model is configured.

## [0.1.246] - 2026-05-29

### Changed

- ChatGPT-style screenshot repaint and no-mask reference edits now request high input fidelity from GPT Image models, so the model is biased toward preserving the uploaded reference object's linework, shape, color, scale, and placement while making only the requested local edit.

## [0.1.245] - 2026-05-29

### Fixed

- Selection repaint now writes a sanitized `openai-last-responses-edit-request.json` debug record for the exact Responses edit route, prompt, model/tool settings, reference crop, and `hasMask=false` invariant, making it directly verifiable that ChatGPT-style screenshot repaint is not sending an API mask.
- Photoshop reload diagnostics now report the last loaded OpenAI plugin init version and timestamp from the latest UXP log, so stale in-memory panels such as `0.1.151` are distinguishable from correctly synced disk files.

## [0.1.244] - 2026-05-29

### Fixed

- OpenAI-compatible `/images/generations` and `/images/edits` fallbacks now treat HTTP 405 and 501 like 404 endpoint-missing responses, so relays that report unsupported image endpoints with method/not-implemented statuses can still recover through `/responses` without masking auth or quota errors.

## [0.1.243] - 2026-05-29

### Fixed

- Responses image requests that succeed without an `image_generation_call` now report the returned output types and text summary, making relay/model misrouting visible instead of surfacing as a generic "no image" failure.

## [0.1.242] - 2026-05-29

### Fixed

- Responses image-generation parsing now also accepts `data_url`, `image_url`, and `{ image_url: { url } }` relay variants at top level, nested `result`, and nested `data[]`, so the selection repaint path does not misread valid ChatGPT-style edit responses as empty.

## [0.1.241] - 2026-05-29

### Fixed

- Standard `/images/generations` and `/images/edits` parsing now accepts common OpenAI-compatible relay image fields such as `image_base64`, `image_url`, `data_url`, and nested `result` payloads, preventing successful relay responses from being treated as empty image results.

## [0.1.240] - 2026-05-29

### Fixed

- Screenshot repaint crop-back now accepts returned images that preserve the uploaded white reference canvas geometry even if the model slightly changes the margin color, while still rejecting wrong-ratio or unrelated square outputs before Photoshop placement.

## [0.1.239] - 2026-05-29

### Changed

- Selection repaint now uploads normal-sized selections with a white context margin around the Photoshop crop, then crops the returned canvas back to the exact original selection. The Responses prompt now distinguishes the uploaded white canvas from the selected crop, matching ChatGPT-style uploaded-image editing more closely and reducing subject recentering or full redraws.

## [0.1.238] - 2026-05-29

### Changed

- Clarified Responses edit progress text for no-mask selection/reference edits so the panel says it is ordinary uploaded-screenshot/reference editing with no API Mask instead of showing a misleading `Mask 0 B` status.

## [0.1.237] - 2026-05-29

### Changed

- Updated panel copy, connection status, and edit-endpoint error text so selection repaint is described as ChatGPT-style white-background screenshot upload, not API mask editing, reducing user-facing and diagnostic confusion around the current no-mask workflow.

## [0.1.236] - 2026-05-29

### Fixed

- Padded small-selection repaint crop-back now verifies that a square returned image still looks like the original white padded reference canvas before center-cropping it, preventing arbitrary square outputs from being cropped into the selection and placed as misleading patches.

## [0.1.235] - 2026-05-29

### Changed

- No-mask reference and selection repaint requests now pass the original Photoshop crop size into the Responses prompt and explicitly require the same aspect ratio, reducing square-canvas or recentered outputs before the import safety gates need to reject them.

## [0.1.234] - 2026-05-29

### Fixed

- Final Photoshop placement now rejects direct selection repaint patches whose image ratio no longer matches the saved selection rectangle, protecting older history/manual imports from stretching wrong-ratio results back into the document.

## [0.1.233] - 2026-05-29

### Fixed

- Selection repaint crop-back now rejects direct screenshot results whose final image ratio no longer matches the original Photoshop selection, preventing square or wrong-ratio model outputs from being stretched into the selected rectangle.

## [0.1.232] - 2026-05-29

### Changed

- Selection repaint now uploads normal-sized Photoshop selections as the direct white-background screenshot crop instead of always centering them inside a much larger square canvas; only tiny selections are padded to a minimum white canvas. This more closely matches ChatGPT web image editing behavior and reduces unwanted subject recentering or redraws.

## [0.1.231] - 2026-05-29

### Fixed

- History saving now invalidates stale cropped previews and Blob preview URLs whenever a result is materialized into local import bytes, keeping result cards, history cards, and Photoshop imports tied to the same image data.

## [0.1.230] - 2026-05-29

### Fixed

- URL-only results now run cropped-preview preparation again after history saving materializes them into local image bytes, so result cards can show the processed local preview instead of a full-canvas or stale remote preview.

## [0.1.229] - 2026-05-29

### Fixed

- Result cards are re-rendered after history saving materializes URL-only results into local bytes, so the panel preview no longer keeps pointing at a stale remote URL after the import-safe local copy is available.

## [0.1.228] - 2026-05-29

### Fixed

- Saving a URL-only result to history now materializes the current result card with the downloaded local image bytes and clears the remote URL, so later import uses the saved image instead of re-downloading a short-lived result URL.

## [0.1.227] - 2026-05-29

### Fixed

- History loading now re-detects the saved image file format from the actual bytes instead of trusting stale metadata from older records, keeping previews and re-imports aligned with the real stored result.

## [0.1.226] - 2026-05-29

### Fixed

- Semantic split now fails immediately when returned layer pixels cannot be decoded for white-matte removal, instead of handing a fallback full-canvas white-matte result to Photoshop placement.

## [0.1.225] - 2026-05-29

### Fixed

- Screenshot-reference repaint URL results are now downloaded through the plugin request path, sniffed from their actual bytes, converted to PNG, and then cropped back to the Photoshop selection, avoiding UXP remote image/CORS failures and stale URL format metadata during crop-back.

## [0.1.224] - 2026-05-29

### Fixed

- Manual/history imports for captured reference, outpaint, cutout, and split results now re-normalize the returned image bytes to the saved Photoshop placement rectangle before placing, preventing older or externally reloaded results from drifting or returning at the wrong scale.

## [0.1.223] - 2026-05-29

### Fixed

- Screenshot repaint crop-back now uses a pixel-level padded-canvas check for square selections, so upscaled square selection-only model results are no longer mistaken for the white reference canvas and cropped through the center.

## [0.1.222] - 2026-05-29

### Fixed

- Added a manual/history import regression for direct selection repaint patches, ensuring re-imported screenshot edits still fit by full image dimensions and do not fall back to visible-bounds scaling or post-import masks.

## [0.1.221] - 2026-05-29

### Fixed

- Direct selection repaint patches are now placed by the full returned image dimensions instead of Photoshop visible layer bounds, preventing transparent or white-margined model patches from stretching or drifting when pasted back over the original selection.

## [0.1.220] - 2026-05-29

### Fixed

- Koukoutu and ComfyUI uploads now use inferred PNG/JPEG/WebP MIME types and matching file extensions, removing the last forced-PNG upload paths from cutout and Comfy workflows.

## [0.1.219] - 2026-05-29

### Fixed

- Image edit, visual analysis, cutout, and Comfy inpaint upload/decode paths now infer PNG/JPEG/WebP MIME types from the actual reference and mask bytes instead of forcing PNG labels, preventing ChatGPT-style screenshot references or relay/cached inputs from being mislabeled.

## [0.1.218] - 2026-05-29

### Fixed

- Photoshop reload and runtime smoke failures now report the Photoshop plugin info cache version plus the exact recent UXP log, temporary ScriptPlugin ids, remove attempts, and missing expected init line, making stale in-memory panels distinguishable from unsynced plugin files.

## [0.1.217] - 2026-05-29

### Fixed

- Inpaint composite and clip fallback image loading now infer the actual returned image format instead of forcing model output through PNG data URLs, preventing JPEG/WebP relay outputs from failing during mask composition or preclip preparation.

## [0.1.216] - 2026-05-29

### Fixed

- Processed `previewB64` thumbnails now infer their real image format instead of assuming PNG, keeping panel thumbnails consistent with imported result bytes.

## [0.1.215] - 2026-05-29

### Fixed

- Preview data URLs are now rebuilt with the verified image format, so stale MIME labels from relays do not create misleading or broken result thumbnails.

## [0.1.214] - 2026-05-29

### Fixed

- Image format detection now prefers actual PNG/JPEG/WebP byte signatures over stale data URL MIME labels or `output_format` metadata in Responses and standard image replies.

## [0.1.213] - 2026-05-29

### Fixed

- Split-layer import now fails safely if white-matte removal cannot be verified, instead of placing the original white-background model output into Photoshop.

## [0.1.212] - 2026-05-29

### Fixed

- Koukoutu cutout responses now record the actual returned image byte format instead of stale requested metadata, preventing PNG responses from being treated as WebP during preview, import, or history reuse.

## [0.1.211] - 2026-05-29

### Fixed

- Standard `/images/*` response parsing now prefers actual image data URL/signature formats before `output_format` metadata, preventing stale relay metadata from entering previews, history, or placement records.

## [0.1.210] - 2026-05-29

### Fixed

- Generated result cards now preserve normalized placement, visible-import, and processed preview metadata from post-processing, so history saves and later imports keep the same safe placement behavior as the first generated result.

## [0.1.209] - 2026-05-29

### Fixed

- Base64/data URL image results now prefer their own MIME header or file signature over stale `format` metadata before pixel processing, preventing JPEG/WebP relay outputs from being treated as PNG in split and screenshot crop-back workflows.

## [0.1.208] - 2026-05-29

### Fixed

- URL image results are now format-sniffed from downloaded bytes before pixel processing, so extensionless JPEG/WebP relay outputs are not forced through PNG decoding during split, matte removal, or crop-back workflows.

## [0.1.207] - 2026-05-29

### Fixed

- Semantic split now rejects returned layer images whose aspect ratio cannot map back to the Photoshop canvas, preventing cropped model outputs from being stretched into misplaced full-canvas layers.

## [0.1.206] - 2026-05-29

### Fixed

- Screenshot repaint now preserves model results that already come back as an upscaled selection crop, instead of recropping them as if they were still the padded white reference canvas.

## [0.1.205] - 2026-05-29

### Fixed

- Selected reference edits now export exactly the selected crop instead of reusing full-canvas inpaint context, matching normal uploaded-image behavior and reducing whole-image redraws.

## [0.1.204] - 2026-05-29

### Fixed

- Photoshop placement now infers image format from actual import bytes when result metadata is stale, so PNG import data is no longer validated or written as WebP/JPEG during immediate layer placement.

## [0.1.203] - 2026-05-29

### Fixed

- History files now infer their stored format from the actual saved import bytes instead of stale result metadata, preventing mismatched history extensions and later import validation issues.

## [0.1.202] - 2026-05-29

### Fixed

- Result previews now prefer actual Photoshop import bytes over stale display bytes when both exist, preventing the panel from showing a different image than the one that will be placed.

## [0.1.201] - 2026-05-29

### Changed

- No-mask Responses edit prompts now explicitly protect visible unchanged pixels and only reconstruct hidden pixels underneath removed occluders, reducing whole-object redraws during ChatGPT-style local edits.

## [0.1.200] - 2026-05-29

### Fixed

- Result previews now prefer processed preview/import bytes before remote URLs, so the panel shows the safely cropped or normalized image that will be placed into Photoshop instead of a stale full remote result.

## [0.1.199] - 2026-05-29

### Changed

- Full-canvas reference edits now also use the no-mask normal-upload Responses path with white-matted input and result-size normalization back to the original Photoshop document.

## [0.1.198] - 2026-05-29

### Fixed

- Selected-region reference edit results are now normalized to the captured Photoshop context size, and rejected when the returned image aspect ratio cannot map back safely, preventing model-sized square outputs from being stretched into the selection.

## [0.1.197] - 2026-05-29

### Fixed

- Offline six-mode diagnostics now selects a reference region and verifies both selected reference edits and selection repaint use the no-mask normal-upload path, so regressions back to old mask-style routing fail visibly.

## [0.1.196] - 2026-05-29

### Changed

- Selected-region reference edits now use the same direct no-mask Responses normal-upload path as selection repaint, instead of trying the older `/images/edits` compatibility route first.

## [0.1.195] - 2026-05-29

### Fixed

- Selected-region reference edits now white-matte transparent pixels before upload, matching normal ChatGPT image uploads and preventing transparent canvas pixels from being interpreted as mask-like holes.

## [0.1.194] - 2026-05-29

### Fixed

- History now preserves placement-size normalization metadata, so resized cutout/outpaint imports keep their placement context when reloaded from history.

## [0.1.193] - 2026-05-29

### Fixed

- Koukoutu cutout results are now resized to the captured Photoshop region when the returned aspect ratio matches, and rejected when the ratio is incompatible, preventing cropped background-removal outputs from drifting on placement.

## [0.1.192] - 2026-05-29

### Fixed

- Outpaint results are now resized to the expanded canvas when the returned aspect ratio matches, and rejected when the returned aspect ratio is incompatible, preventing wrong-sized outpaint images from drifting on placement.
- Safety-stop placement errors that contain “已停止导入” are no longer misclassified as user cancellations, so real failures remain visible in the panel.

## [0.1.191] - 2026-05-29

### Fixed

- Responses parsing now accepts nested `response.output` and `response.output_text` envelopes from OpenAI-compatible relays, preventing successful image or JSON responses from being misreported as empty.

## [0.1.190] - 2026-05-29

### Fixed

- Semantic split URL image results are now downloaded and decoded before white-matte removal, preventing URL-based relay outputs from being placed back as full white-background layers.

## [0.1.189] - 2026-05-29

### Fixed

- Responses SSE image-generation placeholders are now merged with their completed item by id, so an early empty `output_item.added` event cannot hide the final generated image.

## [0.1.188] - 2026-05-29

### Fixed

- Responses SSE partial-image preview events are now ignored in final result parsing, so an intermediate preview cannot replace the completed image-generation result.

## [0.1.187] - 2026-05-29

### Fixed

- Responses SSE parsing now normalizes image generation completion events that carry the result directly on the event, so streaming relay image results are not dropped.

## [0.1.186] - 2026-05-29

### Fixed

- Plain base64 image results without `output_format` are now inspected by file signature, so JPEG/WebP relay outputs are not accidentally treated as PNG during preview or Photoshop placement.
- MIME-style relay format values such as `image/webp` are now normalized correctly.

## [0.1.185] - 2026-05-29

### Fixed

- Screenshot-reference repaint now fails safely if the model result cannot be normalized and cropped back to the original Photoshop selection, instead of silently importing the full uncropped padded canvas into the selected area.

## [0.1.184] - 2026-05-29

### Fixed

- Screenshot-reference repaint results are now normalized to PNG before crop-back, so URL, WebP, or JPEG relay outputs are still cropped to the original Photoshop selection instead of placing the entire padded white reference canvas into the selected area.

## [0.1.183] - 2026-05-29

### Fixed

- Negative prompt text is now appended as explicit supplemental constraints instead of `Avoid: ...`, so Chinese preservation instructions like “不要改变眼睛/弓不要变” are treated as protected-unchanged constraints rather than inverted into something the model should avoid.

## [0.1.182] - 2026-05-29

### Fixed

- Image result parsing now infers PNG/JPEG/WebP format from returned data URLs and image URLs when relays omit `output_format`, preventing valid non-PNG results from being imported or size-checked as PNG.

## [0.1.181] - 2026-05-29

### Fixed

- Responses SSE parsing now preserves streamed `image_generation_call` output items while also stitching `output_text.delta`, preventing OpenAI-compatible relays from losing successful image results when they return event streams.

## [0.1.180] - 2026-05-29

### Fixed

- Responses image-generation tool calls now preserve the UI's default `auto` quality instead of downgrading unknown/default quality values to `low`, matching the OpenAI image tool's automatic quality behavior and improving screenshot repaint fidelity.

## [0.1.179] - 2026-05-29

### Fixed

- Runtime synchronization now scans the local Adobe UXP tree for every same-id plugin copy before and after syncing, so hidden Photoshop-loaded folders cannot keep an older panel version alive unnoticed.
- Smoke validation now checks `src/styles.css` and all discovered Adobe UXP same-id copies for exact source parity, catching stale runtime UI assets before Photoshop loads them.

## [0.1.178] - 2026-05-29

### Fixed

- Responses SSE parsing now stitches `response.output_text.delta` events back into one JSON text payload for semantic split, cutout strategy, and semantic inpaint helpers, instead of only trying the final event and silently disabling analysis.

## [0.1.177] - 2026-05-29

### Fixed

- Responses relay parsing now preserves image format metadata that appears beside nested `data[]` image entries, so WebP/JPEG relay outputs keep the right import extension and dimension validation path.

## [0.1.176] - 2026-05-29

### Fixed

- Responses image parsing now accepts official `image_generation_call.result` base64 plus common relay variants such as `b64_json`, nested `data[].b64_json`, and image URLs, while still filtering non-image output items.
- Added smoke coverage for official and relay Responses image output shapes so successful image calls do not get misreported as “no image returned.”

## [0.1.175] - 2026-05-29

### Fixed

- History entries now save the actual Photoshop import bytes when an item has a prepared `importB64`, and reload that import image for later placement instead of falling back to stale preview/original bytes.
- History metadata now preserves placement mode, preclipped import state, visible import rect, and preview crop flags so importing from history behaves like importing immediately after generation.

## [0.1.174] - 2026-05-29

### Fixed

- Photoshop placement now reads real JPEG and WebP dimensions before import instead of assuming `1024x1024`, preventing WebP cutouts or JPEG relay results from landing at the wrong offset after `placeEvent`.
- Added smoke coverage for JPEG/WebP dimension parsing and invalid WebP rejection before Photoshop placement.

## [0.1.173] - 2026-05-29

### Fixed

- Runtime synchronization now verifies each copied plugin directory after syncing and prints the exact synced version, so a copied-but-stale runtime path fails immediately instead of leaving Photoshop to load an old build silently.
- Photoshop reload failures now include the disk manifest/app/html versions plus stale UXP session hints, making it clear when Photoshop is showing an old in-memory panel even though the files are already updated.

## [0.1.172] - 2026-05-29

### Fixed

- Screenshot repaint crop-back now detects when the model already returned a selection-sized image and avoids cropping it again with padded-canvas coordinates, preventing tiny or misaligned imports.

## [0.1.171] - 2026-05-29

### Fixed

- Reference image edits without a mask now also fall back from `/images/edits` 404 responses to the ChatGPT-style `/responses` image tool instead of failing while masked edits could recover.
- Once `/images/edits` is marked unsupported, sidecar reference edits no longer keep trying that endpoint first.

## [0.1.170] - 2026-05-29

### Fixed

- Standard `/images/generations` and `/images/edits` responses now fail during parsing if the response contains no usable `b64_json`, `b64`, or `url`, preventing empty success results from entering preview, history, or Photoshop import.

## [0.1.169] - 2026-05-29

### Fixed

- Responses text-to-image fallback now passes the configured GPT Image model on the `image_generation` tool, matching the user's selected model instead of silently using the Responses tool default.

## [0.1.168] - 2026-05-29

### Changed

- Added Chinese hand/paw/arm removal constraints to screenshot repaint prompts so Chinese Photoshop requests like “把手去掉，弓不要变” treat the hand as the removable occluder and preserve the protected object underneath.

## [0.1.167] - 2026-05-29

### Fixed

- Changed the Responses API mainline model used for image-generation tool calls and semantic planning from the unsupported `gpt-5.4-mini` string to `gpt-5`, while keeping the configured GPT Image model on the image tool itself.
- Added a pixel-level bow-and-hand screenshot repaint regression that verifies the selected region is exported as a white-background uploaded-image reference, not as a mask, then cropped back to the exact Photoshop selection size before placement.

## [0.1.166] - 2026-05-29

### Fixed

- Runtime synchronization now also updates temporary `/private/tmp/openai-ps-git.*` development copies, preventing Photoshop from continuing to load and display stale builds such as `0.1.151`.
- Smoke validation now checks those temporary development copies so future version bumps cannot miss the folder Photoshop is actually using.
- Photoshop runtime smoke no longer creates a transient `runScript` helper plugin to open the panel, avoiding a host-side modal command that can block later UXP loads and diagnostics.

## [0.1.165] - 2026-05-29

### Fixed

- Selection screenshot repaint now bypasses any stale "Responses unsupported" cache entry so it always tries the ChatGPT-style `/responses` image edit path and still refuses unsafe `/images/edits` fallback if that path is unavailable.
- Added Chinese no-mask guidance directly to the real screenshot repaint request prompt, matching the user's web workflow: edit it as a normal uploaded image, not as an API mask.

## [0.1.164] - 2026-05-29

### Fixed

- Offline six-mode diagnostics now closes its temporary Photoshop document through a document-id `close` fallback when the UXP document object does not expose `closeWithoutSaving`, so smoke tests do not leave unsaved `未标题-*` documents in the user's workspace.
- Added a websocket-based Photoshop reload script that forces UXP Developer Tools to load the synced plugin folder and waits for the current `PLUGIN_VERSION` init log, preventing the panel from staying on an older in-memory version after files are copied.
- Runtime synchronization now also updates Adobe's `PluginsInfo/v1/PS.json` cache for this plugin, so Photoshop's plugin metadata no longer keeps reporting an older `versionString` after the files are already synced.
- Added a Photoshop-runtime smoke script that opens the OpenAI panel through UXP `runScript`, attaches through the DevTools debug websocket, executes the real `runOfflineSixModeDiagnostics()` function, and verifies that every major mode reports start/done logs in the running Photoshop process.
- The runtime smoke script now clears successful websocket timers and fails cleanly when Photoshop is locked in a modal state instead of leaving background Node processes running.

## [0.1.163] - 2026-05-29

### Changed

- Selection repaint now sends a padded white-background screenshot reference instead of a tight crop, then crops the returned image back to the original selection before Photoshop placement. This matches the ChatGPT web upload behavior more closely and prevents tight selections from making the image tool zoom, recenter, or preserve unwanted hand/paw shapes as part of the object.
- Updated the Chinese README to document the current no-mask `/responses` screenshot repaint workflow and macOS runtime paths, preventing old `/images/edits` mask notes from misleading future debugging.

## [0.1.162] - 2026-05-28

### Fixed

- The panel now writes every visible version label from `PLUGIN_VERSION` during startup, so Photoshop cannot keep showing a stale HTML version string after the JavaScript runtime has loaded the newer plugin.

## [0.1.161] - 2026-05-28

### Changed

- Strengthened screenshot repaint prompts to preserve the screenshot framing, object scale, position, rotation, and margins, preventing the model from zooming, cropping, or re-centering protected objects when a selected crop is edited.

## [0.1.160] - 2026-05-28

### Changed

- Selection screenshot repaint now refuses to silently fall back to `/images/edits` when the ChatGPT-style `/responses` image tool path is unavailable, preventing the plugin from returning to the older incompatible edit behavior.

## [0.1.159] - 2026-05-28

### Changed

- Bumped the Photoshop cache-buster after finalizing the no-mask screenshot repaint request path and prompt wording, so the already-loaded `0.1.158` panel cannot keep a stale script.

## [0.1.158] - 2026-05-28

### Changed

- Forced selection repaint screenshot edits to prefer the ChatGPT-style Responses image tool even when the default local sidecar is configured, instead of first using the `/images/edits` compatibility route.
- Simplified screenshot repaint prompting so the user's instruction is sent first and generic constraints stay short; removed fixed `2D game-icon style` wording from edit prompts that could make unrelated images get reinterpreted.
- Kept screenshot repaint mask-free: the selected Photoshop region is uploaded as a white-background reference image and the returned PNG is placed directly over the captured selection rectangle.
- Tightened the smoke test so async VM assertions are awaited and the actual screenshot repaint `/responses` payload is checked for the no-mask contract.

## [0.1.157] - 2026-05-28

### Fixed

- Replaced split/preview DOM image decoding with the plugin's PNG decoder so UXP `<img>` timeouts no longer stall cropped previews.
- Removed Photoshop color-range white-matte masking from split placement; white matte removal now happens in JavaScript before placing the layer, avoiding the native "program error" dialog.

## [0.1.156] - 2026-05-28

### Fixed

- Reused the existing six-mode smoke menu command for offline diagnostics instead of registering a new command, so Photoshop can reload the plugin even when UXP still has the previous manifest cached.

## [0.1.155] - 2026-05-28

### Added

- Added an offline all-mode diagnostics command that runs generation, reference edit, selection repaint, outpaint, cutout, and split through the Photoshop placement pipeline without calling external image APIs.

## [0.1.154] - 2026-05-28

### Changed

- Changed selection repaint to match the ChatGPT upload workflow: the selected area is exported as a normal white-background screenshot reference and sent without an API mask.
- The Photoshop selection now controls only which rectangle is captured and where the returned screenshot edit is placed back.
- Selection repaint prompts now explicitly treat "keep unchanged" objects as protected visual references instead of editable mask regions.
- Selection repaint exports now explicitly composite transparent pixels onto a white matte before sending the screenshot reference.
- Added runtime-copy sync checks and a sync script so the source tree, UXP Developer Tool temp plugin, and Photoshop runtime copies do not drift across versions again.

## [0.1.105] - 2026-05-27

### Fixed

- Fixed Photoshop layer mask creation descriptors that could trigger the native "无法完成请求，因为程序错误" dialog while placing selection repaint results.
- Restored selection repaint placement to align full transparent region patches at 1:1 size instead of scaling from visible pixel bounds.
- Disabled the fragile current-selection mask path for automatic inpaint placement; the captured rectangular crop mask is rebuilt explicitly after placement.

## [0.1.76] - 2026-05-22

### Fixed

- Updated the default local Cockpit Tools Base URL from the stale `http://127.0.0.1:49456/v1` port to the currently running `http://127.0.0.1:51866/v1` service.
- Migrated legacy local Base URL values on load so stored `9456` or `49456` settings normalize to `51866`.

## [0.1.75] - 2026-05-22

### Fixed

- Corrected Photoshop UXP manifest icon paths so `scale: [1, 2]` resolves `assets/panel@1x.png`, `assets/panel@2x.png`, `assets/plugin@1x.png`, and `assets/plugin@2x.png` instead of looking for duplicated suffixes such as `panel@1x@1x.png`.

## [0.1.74] - 2026-05-22

### Fixed

- Manual split targets now take effect even when the user enters a single target instead of two or more comma/newline-separated targets.
- Outpaint results now preserve padding metadata, expand the Photoshop canvas to the generated size, and place the returned full-canvas image back at 1:1 scale.
- Outpaint placement failures now keep their warning status instead of being overwritten by a generic success message.
- Updated README cutout routing notes to describe the current Koukoutu workflow instead of the older ComfyUI cutout path.

## [0.1.73] - 2026-05-22

### Fixed

- Fixed selection repaint placement so transparent inpaint patches align to the original exported region at 1:1 size instead of being scaled from their visible pixel bounds.
- Made GPT `/responses` parsing tolerate local relay SSE-style `data:` payloads for semantic selection, split, and cutout analysis helpers.
- Corrected the cutout mode hint to describe the current Koukoutu workflow instead of the older ComfyUI wording.

## [0.1.72] - 2026-05-22

### Changed

- Strengthened semantic split prompts so every returned layer must be a full-canvas PNG at the original document size and original coordinates, allowing Photoshop to stack the split layers back into the exact source layout.

## [0.1.71] - 2026-05-22

### Changed

- Updated semantic split prompts so base/background/frame layers are reconstructed as clean surfaces with foreground icons, text, and buttons removed, instead of returning a panel with holes.

## [0.1.70] - 2026-05-22

### Fixed

- Preserved semantic split labels through the full generation flow, so auto-placed Photoshop layers keep names such as `Split 1 血条底框`, `Split 2 红色条`, `Split 3 骨头牌`, and `Split 4 x10 字`.

## [0.1.69] - 2026-05-22

### Changed

- Split mode now asks the vision model to identify semantic UI/art layers automatically before calling `gpt-image-2`, so users do not need to type targets like frame, fill bar, badge, and text manually.

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
