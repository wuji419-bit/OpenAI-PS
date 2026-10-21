# OpenAI Image Flow

The maintained plugin flow is implemented in `src/app.js`.

## Supported Modes

- `generate` - text-to-image generation.
- `reference` - export the current Photoshop document as a reference image and call the edit endpoint.
- `inpaint` - export an Alpha-preserving rectangular screenshot and edit it through the explicitly configured Images or Responses protocol without an API mask. Normalize the result to the captured size and write native RGBA at the captured origin; transparent replacements add a non-destructive source-group mask inside the same undoable transaction.
- `outpaint` - create an expanded canvas input and mask, call the edit endpoint, expand the Photoshop canvas, and place the returned full-canvas layer back at 1:1 scale.
- `split` - export the full canvas, resolve automatic or user-specified semantic targets, and ask `gpt-image-2.5-sunburst` to extract each full-canvas transparent layer.

## Endpoints

The default official endpoints are:

```text
POST https://api.openai.com/v1/images/generations
POST https://api.openai.com/v1/images/edits
```

The user can override the base URL and endpoint paths for compatible local relays.

The current local Cockpit Tools API service default is:

```text
http://127.0.0.1:49456/v1
```

Configured gateway ports are preserved. Images API is the default protocol; Responses is an explicit alternative with a configurable controller and path. No HTTP status silently changes a route or model.

## Output Handling

OpenAI image responses are parsed from base64 image data. The plugin stores results in local plugin data, shows previews in the panel, and can place selected output into Photoshop as a new layer.

## Manual Smoke Test

- Plugin loads in Adobe UXP Developer Tool.
- Panel opens in Photoshop.
- Missing API key is reported before a request is sent.
- Text-to-image returns a preview.
- Reference edit exports the active document and returns a preview.
- Rectangular selection repaint exports the selected region and returns a preview.
- Outpaint expands the Photoshop canvas by the requested margins and imports a full-canvas layer aligned at the new origin.
- Split mode accepts either an empty prompt for automatic semantic targets or a single/manual comma-separated target list, and places each returned layer at full-canvas coordinates.
- Import places the selected result into Photoshop.
- History persists across panel reloads.

## Local Automated Smoke Test

Run this from the plugin directory before opening Photoshop:

```sh
node --check src/app.js
node --check scripts/smoke-plugin.js
npm run smoke
```

The smoke script validates the manifest, icon path convention, UI element bindings, gateway Base URL preservation, single-target split parsing, and the five maintained mode branches and native Alpha replacement regressions without consuming API credits.

## Test Asset

For Photoshop-side manual testing, `/Volumes/D/悟空.psd` is a good layered PSD source. It has transparent regions and multiple visible semantic parts, making it useful for reference edit, selection repaint, and split-layer checks.

## Task and persistence boundaries

A task snapshots UI settings, mode, source document/canvas, selection, reference and outpaint padding before submitting. Each accepted image is saved before further requests, normalization or placement. JSON sidecars are authoritative recovery records; localStorage holds a deduplicated, bounded index without image base64. A missing index is rebuilt on history load. Raw outputs are kept when normalization fails and are not imported into unchecked coordinates.

Automatic placement checks task identity and source context. Low-level placement validates the source again inside Photoshop's modal scope. An explicit rebind action supports intentional import to a compatible document or a new host session. Legacy histories without source metadata keep their original manual-import behavior. Inpaint still uses the same native RGBA transaction and Alpha-preserving algorithms.

`npm run test:gateway` exercises transport ambiguity, cancellation, stale tasks, partial batches, history recovery, disk/quota errors and both request protocols. Its only HTTP traffic is to an ephemeral loopback mock server. No live generation is part of offline verification.
