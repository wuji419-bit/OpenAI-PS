# Security Policy

## Reporting Security Issues

Please do not report sensitive security issues in public GitHub issues.

For now, open a private GitHub security advisory if available, or contact the maintainer through the GitHub profile linked from this repository.

## Sensitive Data

This project may interact with:

- OpenAI API keys
- Photoshop documents
- generated images
- local user presets

Never commit secrets or private creative assets. If a secret is accidentally committed, rotate it immediately before opening a cleanup pull request.

## API Key Handling

The prototype stores the OpenAI API key locally in the Photoshop UXP runtime using browser-like local storage. It is not committed to the repository and should not be sent to third-party services other than the OpenAI API endpoint selected by the user.

Future releases should prefer OS-backed secure storage when the Photoshop UXP runtime makes that practical.
