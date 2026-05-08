# OpenAI Image Flow

The maintained plugin flow is implemented in `src/app.js`.

## Supported Modes

- `generate` - text-to-image generation.
- `reference` - export the current Photoshop document as a reference image and call the edit endpoint.
- `inpaint` - export the selected rectangular region, generate a matching mask, and call the edit endpoint.
- `outpaint` - create an expanded canvas input and mask, then call the edit endpoint.

## Endpoints

The default official endpoints are:

```text
POST https://api.openai.com/v1/images/generations
POST https://api.openai.com/v1/images/edits
```

The user can override the base URL and endpoint paths for compatible local relays.

## Output Handling

OpenAI image responses are parsed from base64 image data. The plugin stores results in local plugin data, shows previews in the panel, and can place selected output into Photoshop as a new layer.

## Manual Smoke Test

- Plugin loads in Adobe UXP Developer Tool.
- Panel opens in Photoshop.
- Missing API key is reported before a request is sent.
- Text-to-image returns a preview.
- Reference edit exports the active document and returns a preview.
- Rectangular selection repaint exports the selected region and returns a preview.
- Import places the selected result into Photoshop.
- History persists across panel reloads.
