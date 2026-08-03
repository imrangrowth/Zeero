---
name: JARVIS Backend Ports
description: Port assignments and vite config for the JARVIS project
---

- Web app (TanStack Start + Vite): port 5000
- Mobile Express backend: port 3001, health at /api/health
- `vite.config.ts` must keep `watch.ignored: ["**/mobile/**"]` to prevent EMFILE errors from bun watching node_modules inside mobile/

**Why:** The mobile/ directory has its own node_modules that causes EMFILE if Vite watches them.
