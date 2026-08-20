# Pickle League — project context

Weekly stats and fine bookkeeping for a private FPL Draft league of 9
friends. Runs once a week on GitHub Actions cron, sends a message to Harry on
Telegram, who forwards it to the league's WhatsApp group.

This is a hobby project. Optimise for "still works in April with zero
maintenance", not for engineering elegance.

## Hard constraints — do not change without asking

- **Zero dependencies.** No npm packages, no `node_modules`, no lockfile. The
  workflow has no install step and no `setup-node`. Plain Node on
  `ubuntu-latest` only. If a task seems to need a library, say so rather than
  adding one.
- **`state.json` stores raw per-gameweek points and nothing else.** Fines,
  monthly tables and manager-of-the-month are recomputed from scratch on every
  run. Never cache derived values — that is what makes re-runs, backfills and
  corrected scores safe. A double-fined friend is the failure mode this design
  exists to prevent.
- **No database, no dashboard, no web frontend.** Git is the datastore.
- **Never commit secrets.** `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID` are GitHub
  repo secrets, read from `process.env`.

## League rules as implemented

- Scoring is classic total points, not head-to-head.
- A "pickle" is voted in after the draft — the worst-drafted team.
- Anyone scoring **strictly lower** than the pickle in a gameweek pays £1.
  Level with the pickle is **not** a fine. This is deliberate.
- Everyone pre-pays a £10 float; the script decrements balances. No money is
  collected mid-season and no payment links are generated.
- Manager of the month = highest total across a configured gameweek range.
  Ties are shared and the prize splits.
- Double gameweeks are **not** normalised. Planning for them is part of the
  game.

## Layout

- `index.js` — orchestrator: fetch, sanity-check, record, derive, send
- `src/fpl.js` — Draft API calls
- `src/pickle.js` — pure logic, no I/O. Easiest place to test changes.
- `src/message.js` — message formatting
- `src/ledger.js` — CSV formatting for `ledger.csv`, pure, no I/O
- `config.json` — league ID, pickle entry ID, month ranges
- `state.json` — written by the bot each week, committed back
- `ledger.csv` — row-per-manager-per-gameweek fine ledger for manually
  checking the maths (points, pickle's score, fined Y/N, running balance).
  Recomputed from scratch from `state.json` on every run, same as everything
  else derived — never hand-edit it, edits are overwritten next run.

## Known-unverified

`src/fpl.js` has `VERIFY:` comments on three field names guessed against an
undocumented API. If data looks wrong, check those first. When you confirm or
correct one, update the comment.

Two different IDs exist in the league payload: `league_entries[].id`
(used by `standings[]`) and `league_entries[].entry_id` (used by `/entry/`
endpoints). Everything keys on `entry_id`. Mixing them up is the most likely
source of a subtle bug.

## Message format

Uses WhatsApp markup (`*bold*`). The Telegram send deliberately sets **no**
`parse_mode`, so asterisks arrive literally and render as bold when pasted into
WhatsApp. Don't "fix" this by adding Markdown parse mode.

## Testing

There is no test framework. `node index.js --dry-run` fetches and prints
without writing state or sending. For logic changes, write a throwaway script
that imports from `src/pickle.js` with fixture data — it's pure and needs no
network.

Off-season note: the Draft API returns no current gameweek outside the season,
so a dry run will exit early rather than showing a message.

## Failure philosophy

The script **throws** on suspicious data — wrong manager count, non-numeric
points, everyone on zero, pickle not in the league. A crash sends a Telegram
alert; a wrong-but-plausible message doesn't. Prefer loud failure over a
graceful fallback that hides a broken API.

## Season rollover

Entry IDs change every season. Each August: archive `state.json`, reset it,
set the new `leagueId`, `pickle.entryId`, `expectedManagers`, and month ranges
taken from the real gameweek deadlines.
