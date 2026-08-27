# noteflow

Meeting recorder and note-taker PWA for Beach Life Rentals / AMI Construction Group.
React 18 + Vite, deployed on Netlify, with Supabase for storage and a Supabase Edge Function
(`analyze-meeting`) proxying Claude for summaries. Live transcription is Deepgram over WebSocket.

- `src/App.jsx` — the whole app (state, views, Supabase helpers, recording loop)
- `netlify/functions/analyze.js` — legacy Claude proxy, no longer on the call path
- `npm run dev` / `npm run build` — there is no test suite or linter

## Operating notes

@.claude/operating-notes.md

These are maintained by `/improve-system`, which reviews a completed session and folds its
durable lessons in. Run it at the end of a session that taught you something.
