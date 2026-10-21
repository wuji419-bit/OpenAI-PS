# v0.1.315 Photoshop validation — 2026-10-21

Validated in the running Photoshop 27.6.0 host on macOS, using screen capture,
mouse clicks, native Photoshop menu actions, and UXP diagnostics. Tests used
temporary documents and a local OpenAI-compatible HTTP fixture gateway. No
external image model or paid service was called. A read-only check also confirmed
connectivity and authentication to the configured internal gateway after adding
its required `/v1` base prefix. Actual internal-gateway image generation and real
model output quality remain unverified.

## Failures found and repaired

- UXP could not resolve `./gateway.js` from the HTML-loaded script. Loading
  `./src/gateway.js` from the plugin root fixes startup. The offline host now
  resolves modules from that same root.
- The real-host Alpha verifier sampled the composite outside a required modal
  scope. The verifier now uses `executeAsModal`; placement failures also fail
  diagnostics instead of being recorded as completed modes.
- Scrolling native input controls could cover fixed settings actions. Putting
  actions after the fields in the same scroll area prevents that overlap; Back
  now has visible text.

## Validation results

| Check | Observed result |
| --- | --- |
| Syntax and offline regressions | `npm run check`, `npm run smoke`; 26 transparency and 34 gateway/task regressions passed |
| Real Photoshop diagnostics | Generate, reference, inpaint, split and outpaint passed; `PHOTOSHOP_SMOKE_OK version=0.1.315` |
| Explicit Images route | JSON generation and multipart reference editing reached the configured local gateway with its opaque image-model alias |
| Screenshot editing | Actual `/images/edits` multipart request contained an image and no mask |
| Partial batch failure | The second request returned HTTP 503; the first result remained durable and was imported by clicking Import |
| Mode change during generation | Switching the panel to inpaint did not change the running task's generation endpoint |
| Document switch during generation | Results stayed bound to the captured document; neither document gained layers after the switch |
| Wrong-document manual import | Import was blocked; clicking Bind current document enabled an intentional import into the second temporary document |
| Cancellation | Clicking Stop during a three-image batch retained the first accepted image; only two requests started |
| Exact transparent replacement | A mouse-drawn selection at `(100, 98)` with size `129 × 130` received a same-size native RGBA patch; composite Alpha matched the returned normalized PNG at every pixel |
| Undo | The native Edit → Undo menu restored the original two-layer stack in one step |
| History recovery | With the localStorage history index absent and in-memory results cleared, clicking Load recovered all five fixture results from their image files and sidecars |
| Settings usability | After scrolling past the fields, clicking Test connection reached the service; actions stayed visible and clickable |
| Internal gateway reachability | The configured gateway returned 404 for `/models` and succeeded for `/v1/models`; the corrected `/v1` base was saved through the UI, with the API key and model unchanged |

The real-host diagnostic stubs provider calls and history writes while exercising
Photoshop capture, normalization, placement and canvas operations. The separate
screen-driven fixture-gateway tests above use real HTTP requests and durable UXP
file writes. Together they verify host behavior and transport/persistence without
claiming a live internal-gateway integration test.
