---
description: Review the completed session and fold its durable lessons into the long-term operating notes
argument-hint: [--dry-run] [--commit] [--global] [optional focus hint]
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(date:*), Bash(mkdir:*), Bash(wc:*), Bash(git status:*), Bash(git log:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*)
---

# Improve the operating notes

You are reviewing the session in this conversation, from its first user message to now,
and updating the long-term operating notes so the next session starts smarter than this one did.

Today: !`date +%Y-%m-%d`
Working tree: !`git status --short`
Recent commits: !`git log --oneline -10`

Arguments: `$ARGUMENTS`
- `--dry-run` — do every step but write nothing; print the proposed edits as a diff and stop.
- `--commit` — after writing, commit the notes files alone (no other paths) on the current branch.
- `--global` — target `~/.claude/operating-notes.md` instead of the project notes. Use this only for
  lessons that are true regardless of repo (tool habits, the user's working preferences).
- Anything else is a focus hint: weight the review toward that topic, but still do the full pass.

**Notes file:** `.claude/operating-notes.md` (or the `--global` path above).
**Audit log:** `.claude/operating-notes.log.md` — append-only, never loaded into context.

## 1. Bootstrap

Read the notes file. If it does not exist, create it with this skeleton and continue:

```md
# Operating Notes — <repo name>

Durable, hard-won guidance for working in this repo. Maintained by `/improve-system`.
Every entry is imperative, one line, and earned by something that actually happened.

## Environment & Setup
## Build, Run & Verify
## Architecture Invariants
## Deployment
## Working Preferences
## Known Traps
```

Sections may be added or dropped as the repo's real shape demands — do not keep an empty section
alive just because the skeleton named it.

## 2. Gather evidence

Re-read the session for the things that are expensive to learn twice. Look specifically for:

- **Corrections.** Anywhere the user said "no", redirected you, or restated a preference.
  These are the highest-value signal in the session — mine them first.
- **Failure→fix pairs.** A command, build, deploy, or test that failed and then worked.
  What was the actual cause, and what would have avoided the failed attempt entirely?
- **Dead ends.** Approaches you spent turns on and abandoned. A note that saves a future
  session from re-walking one is worth as much as a note that tells it what works.
- **Discovered facts.** Non-obvious things about the codebase, its services, or its deploy path
  that took real work to establish.
- **Contradicted notes.** Anything in the existing notes that this session proved wrong,
  stale, or misleading. Hunt for these deliberately.

Use `git diff` and `git log` on this session's commits to check your memory against what actually
landed. If the session produced no commits and no failures, say so and stop — there is nothing to learn.

## 3. Extract candidates

For each candidate lesson, apply every test. Drop it unless all pass:

1. **Durable** — will it still be true in a month? Transient outages and one-off flakes are not lessons.
2. **Transferable** — would it change your behavior on a *different* task here? Facts about this
   task's specific bug are not lessons.
3. **Earned** — did it cost this session real time or a wrong turn? If it's visible in five seconds
   of reading a config file, the next session will find it faster than it can read your note about it.
4. **Actionable** — it tells a future session what to *do*, not merely what is true.

Never write: praise, session narration, restatements of general Claude Code behavior, anything you
inferred but did not observe, or a fact you are not confident in.

## 4. Reconcile against the existing notes

The default outcome for a candidate is that it is already covered. For each surviving candidate,
pick exactly one:

- **SKIP** — an existing note already says it. Re-confirmed by this session? Bump its date tag.
- **STRENGTHEN** — an existing note is vague, half-right, or missing the reason. Edit it in place.
- **REPLACE** — this session contradicts an existing note. The new evidence wins; delete the old line.
- **DELETE** — a note is obsolete (the code, service, or workflow it describes is gone). No candidate
  required — do this pass whenever you spot one.
- **ADD** — genuinely new. Place it in the section it belongs to, not at the end of the file.

Deleting a wrong note is worth more than adding a right one: a stale note actively misleads,
while a missing note merely costs a lookup. A pass that only deletes is a good pass.

## 5. Enforce the budget

These notes are loaded into every session's context, so they are a budget, not an archive.

- Entry format: one line, imperative, with the reason, ending in a date tag.
  `- Route Anthropic calls through the Supabase Edge Function, never the browser — Netlify's egress firewall blocks api.anthropic.com. [2026-08-27]`
- Hard cap: **60 entries** across the file. At the cap, earn each addition by merging duplicates
  or dropping the least load-bearing entry. Say in your report what you dropped and why.
- Merge near-duplicates rather than letting a section accumulate variations on one idea.

## 6. Apply and report

1. Write the notes file (skip if `--dry-run`).
2. Append one entry to `.claude/operating-notes.log.md`, creating it if absent:
   `## <today> — <session topic in a few words>` followed by one bullet per edit,
   each tagged `ADD` / `STRENGTHEN` / `REPLACE` / `DELETE` with a half-line of rationale.
   This file is the audit trail and is never imported into context — keep the full history.
3. If `--commit`, stage only the notes files and commit as `Update operating notes from <topic> session`.
   Never commit unrelated working-tree changes, and never push unless the user asks.
4. Report to the user: each edit in one line, then the entry count against the cap. If nothing
   met the bar, say exactly that — "no durable lessons this session" is a correct and common result.
   Do not pad the notes to justify the run.
