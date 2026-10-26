# Zeero

An experimental personal AI assistant interface, built around conversations, specialized agents, and contextual memory.

## What is in this repository?

The current codebase contains a browser-based assistant interface and server-side functions for several workflows:

- **Conversation and agent routing** — routes requests to specialized assistant roles.
- **Knowledge and memory** — functions for recalling and logging information and saving interactions.
- **Voice output** — speech synthesis integration points.
- **Development workflows** — code-focused assistant tooling and website-building functions.
- **Context** — identity and live-context utilities used to shape assistant responses.

This is an evolving prototype. The presence of an integration in the source does not guarantee it is configured or operational in a fresh installation.

## Technology

TypeScript · React · TanStack Router / Start · Vite · server functions

The project also references external AI and speech services. Credentials and service configuration are not included here.

## Local development

**Requirements:** Node.js and npm.

```bash
npm install
npm run dev
```

```bash
npm run build
npm run lint
```

Review the environment variables and service integrations in the source before attempting to use model, voice, or memory features. Never commit API keys.

## Where to look

- `src/routes/index.tsx` — main assistant interface and agent definitions
- `src/lib/jarvis.functions.ts` — assistant server functions
- `src/lib/jarvis-self-model.ts` — identity and context utilities
- `src/lib/jarvis-pillars.functions.ts` — knowledge and interaction helpers

## Status

**In development.** This repository documents an iteration of the personal-assistant project, not a packaged consumer release.
