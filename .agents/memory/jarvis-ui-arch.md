---
name: JARVIS Web UI Architecture
description: How the JARVIS web app UI is structured after the 2026 redesign
---

## Design
- Dark navy (#060d1a) background with subtle SVG grid overlay
- Central glowing JARVIS orb (SVG with animated cyan ring) as hero element
- 5-icon bottom nav bar: HOME · CHAT · VOICE · MEMORY · SYSTEM
- Corner decorations (thin cyan lines) at all 4 corners

## View architecture (single-file SPA)
- `home` — Minimalist orb, text input, hold-to-speak, action cards
- `chat` — Left sidebar (conversation rooms like ChatGPT) + right chat panel
- `memory` — Pillar stats + upload, conversation room list, local memory CRUD
- `settings` — Left sidebar (agents + API keys) + right workspace (terminal logs + architecture info)

## All AI logic preserved
- 5 agents: developer, marketing, research, sales, pm
- 30+ tools via chatAgentic server fn
- ElevenLabs voice (server-side fallback → browser TTS)
- Supabase pillars (identity/goals/relationships/knowledge)
- Vision analysis via Claude
- Website builder with live preview
- Conversation rooms persist in localStorage

**Why:** User wanted reference-image redesign (dark navy grid, central orb, minimal) while keeping all AI functionality intact.
