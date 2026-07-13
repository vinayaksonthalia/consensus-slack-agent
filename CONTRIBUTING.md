# Contributing to Consensus

Thanks for your interest! Consensus started as a Slack Agent Builder Challenge 2026 entry and aims to become a production-grade workspace consistency guardian.

## Development setup

```sh
npm install
slack run          # requires the Slack CLI + a developer sandbox
```

## Quality bar

Every change must pass all three before review:

```sh
npm run lint       # biome
npm run check      # tsc --checkJs over JSDoc types
node --test        # unit + regression tests
```

If you touch the contradiction judge or its prompts, also run the eval and include the metrics in your PR description:

```sh
npm run eval       # 58-case labeled eval incl. 9 adversarial injection attacks
```

The bar: precision ≥ 0.85, recall ≥ 0.85, zero near-miss false positives, zero errored cases. Do not weaken dataset labels to make a prompt pass — improve the prompt or argue the label with evidence.

## Style

ES modules, JSDoc types (no TypeScript files), biome formatting (single quotes, 2-space indent, 120 columns), kebab-case filenames. Match what you see.

## Security & privacy invariants (non-negotiable)

- Private-channel decision content must never reach a non-member — in alerts, App Home, or agent answers.
- Unknown permission state fails closed.
- All user-generated text is untrusted: wrap it (`wrapUntrusted`) before any LLM prompt and sanitize it (`sanitizeMrkdwn`) before any Block Kit surface.
- No tokens or secrets in the repo, ever. Runtime credentials live in `.env` (local), Render environment variables (the hosted service), or GitHub Actions secrets (CI).
