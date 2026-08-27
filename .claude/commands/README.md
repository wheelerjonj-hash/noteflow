# Project commands

## `/improve-system`

Reviews the session you just finished and updates `.claude/operating-notes.md` — the durable
guidance imported into every session through `CLAUDE.md`. The point is that a lesson paid for
once (a failed deploy, a correction from you, a dead end) is not paid for again.

```
/improve-system                      # full pass over this session
/improve-system --dry-run            # show the proposed edits, write nothing
/improve-system --commit             # write, then commit the notes files alone
/improve-system --global             # write to ~/.claude/operating-notes.md instead
/improve-system deployment           # same pass, weighted toward a topic
```

Run it when a session ends, or when one has clearly taught something worth keeping.
"No durable lessons this session" is a normal outcome — the command is built to say that
rather than pad the file.

**Where edits land.** Project notes go in `.claude/operating-notes.md`, capped at 60 entries so
they stay a budget rather than an archive; every run is logged in `.claude/operating-notes.log.md`,
which is never imported and keeps the full history. `--global` targets
`~/.claude/operating-notes.md` for lessons that hold across repos — add `@~/.claude/operating-notes.md`
to your `~/.claude/CLAUDE.md` once so those actually load.

**Running it automatically.** To fire it at the end of every session, add a `Stop` hook in
`.claude/settings.json` that injects the prompt. Worth knowing before you do: it spends tokens on
every session, including the ones with nothing to learn, so most people are better off invoking
it deliberately.
