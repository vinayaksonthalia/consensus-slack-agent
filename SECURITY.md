# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security reports. Email the maintainer instead (see the GitHub profile) with a description and reproduction steps. You'll get a response within 72 hours.

## Design invariants

Consensus handles workspace conversation data, so these hold everywhere:

- **Fail-closed permissions** — private-channel decisions are only shown to verified channel members; membership-check failures redact.
- **Prompt-injection hardening** — all user text is delimiter-wrapped as untrusted data before reaching an LLM; measured against adversarial cases in the eval suite.
- **Output sanitization** — user-derived text is entity-escaped and length-capped before rendering to Block Kit (no `<!channel>`/mention/link injection).
- **Secrets hygiene** — no credentials in the repo; local runtime uses `.env` (gitignored), the hosted service uses Render environment variables, and CI uses encrypted GitHub Actions secrets.
