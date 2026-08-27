# Operating Notes — revision log

Append-only audit trail of `/improve-system` runs. Never imported into session context,
so the full history can live here; keep `.claude/operating-notes.md` lean instead.

## 2026-08-27 — bootstrap: /improve-system command

- ADD (x13) — seeded the notes from repo history and code rather than an empty skeleton: the
  Netlify-firewall → Supabase Edge Function migration, the superseded `netlify/functions/analyze.js`,
  the `netlify.toml` redirect ordering, the `node-fetch` regression, the Vite cache-bust token,
  the hand-rolled Supabase helpers, key storage locations, and the absence of tests/linter.
  Evidence: `git log` (commits `12552d9`, `89dd4b4`, `e159a76`, `545dc0d`, `4d6e585`),
  `netlify.toml`, `vite.config.js`, `netlify/functions/analyze.js`, `src/App.jsx`.
