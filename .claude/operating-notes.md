# Operating Notes — noteflow

Durable, hard-won guidance for working in this repo. Maintained by `/improve-system`.
Every entry is imperative, one line, and earned by something that actually happened.

## Build, Run & Verify

- Verify changes with `npm run dev` (Vite) or `npm run build` — there is no test suite and no linter, so a clean build plus a manual check in the browser is the whole verification story. [2026-08-27]
- Do not add a test framework or linter as a side effect of another task; propose it separately. [2026-08-27]

## Architecture Invariants

- `src/App.jsx` is the entire app — 865 lines, all state, all views, inline styles. Extend it in place rather than starting a component split unless the user asks for one. [2026-08-27]
- Supabase is the persistence layer, called over plain `fetch` against `/rest/v1/` — there is no `@supabase/supabase-js` dependency, so match the existing hand-rolled helpers at the top of `App.jsx`. [2026-08-27]
- The Supabase URL and **anon** key are hardcoded in `src/App.jsx` by design; never put a service-role key, Deepgram key, or Anthropic key there — those belong in `localStorage` (user-entered) or Supabase secrets. [2026-08-27]
- User API keys (Deepgram, Anthropic) live in `localStorage` under `dg_key` / `anthropic_key` and are entered in Settings; keep any new key on that same path. [2026-08-27]
- Meeting type (phone / in-person / site) selects the Deepgram WebSocket query params — change transcription behavior there, not in the recording loop. [2026-08-27]

## Deployment

- Route Anthropic calls through the Supabase Edge Function `analyze-meeting`, never from the browser and never from Netlify — Netlify's egress firewall blocks `api.anthropic.com`. [2026-08-27]
- `netlify/functions/analyze.js` is superseded by that Edge Function and is no longer on the app's call path; do not "fix" it in response to an AI-summary bug — check the Edge Function first. [2026-08-27]
- In `netlify.toml`, the SPA catch-all redirect (`/*` → `/index.html`) must stay last; a rule placed after it swallows function routes. [2026-08-27]
- Netlify functions run on Node 18+ with native `fetch` — do not add `node-fetch`, it breaks the bundle. [2026-08-27]
- Built asset filenames carry a manual version token (`assets/[name]-v5-[hash]`) in `vite.config.js` to force Android PWA clients past their cache; bump it when a release must not be served stale. [2026-08-27]

## Known Traps

- The Edge Function returns Claude's text with markdown fences stripped and the client `JSON.parse`s it — a prompt change that alters the response shape breaks summaries silently, so re-check the parse path alongside any prompt edit. [2026-08-27]
