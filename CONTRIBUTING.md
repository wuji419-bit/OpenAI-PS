# Contributing

Thanks for helping improve OpenAI PS.

## Useful Contributions

- Photoshop UXP compatibility fixes
- OpenAI Image API compatibility updates
- better layer import and export workflows
- prompt preset improvements for real Photoshop work
- documentation, screenshots, and installation notes
- bug reports with clear reproduction steps

## Before You Start

Open an issue for large changes. Small documentation fixes can go directly to a pull request.

Please do not commit:

- OpenAI API keys
- private PSD files
- generated client assets
- local Photoshop or UXP cache files
- binary build outputs unless a release needs them

## Pull Request Checklist

- Explain what changed and why.
- Include manual test notes.
- Mention the Photoshop version used for testing.
- Mention whether the change affects API calls, billing, or local credential storage.
- Keep unrelated cleanup out of the pull request.

## Development Notes

The maintained Photoshop code lives in the repository root:

- `manifest.json`
- `index.html`
- `src/app.js`
- `src/styles.css`
- `assets/`

Keep generated release artifacts out of normal pull requests unless the pull request is explicitly preparing a release.
