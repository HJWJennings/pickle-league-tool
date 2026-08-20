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

## Pickle jar vs. float (`config.fine`) — two separate, non-interacting figures

`config.fine` holds three distinct numbers. Don't conflate them:

- **`amount`** (£1) — the per-fine charge.
- **`floatStart`** (£10) — each manager's pre-paid personal float. Decremented
  once per fine *for that manager*. Shown two places only: the message's
  "Running low" warning and every row of `ledger.csv`'s `Balance` column.
- **`entryFee`** (£20) — each manager's one-off entry fee, paid once at the
  start of the season into the shared pickle jar.

The weekly message's **"Pickle jar"** total is the shared pot, not anyone's
personal float:

```
jarTotal = (entryFee × expectedManagers) + (fines so far × amount)
```

Computed fresh in `src/message.js` on every run — from `config.fine`,
`config.expectedManagers`, and `state.json`'s full gameweek history via
`fineLedger` — never stored or incremented in place, same recompute-not-cache
rule as everything else. `expectedManagers` (not a hardcoded headcount) means
the jar's starting total stays correct if the roster size ever changes.

`floatStart` and `entryFee` never appear in each other's calculation.
`ledger.js`'s per-manager balance logic (`floatStart - fines × amount`) is
untouched by the jar total and stays the authority on individual balances;
the jar total is untouched by any individual's float and stays the authority
on the shared pot.

## Pickle history (`config.pickle.history`)

Who counts as "the pickle" is not a single value — it's an array of
`{ fromGw, entryId }`, e.g.:

```json
"pickle": {
  "history": [
    { "fromGw": 1, "entryId": 2105, "label": "Cormac" }
  ]
}
```

Every place that needs "the pickle" (fines, the weekly message, `ledger.csv`,
the startup sanity checks) resolves it **per gameweek** via
`pickleEntryIdForGw(history, gw)` in `src/pickle.js`: the entry with the
highest `fromGw` that is `<= gw`. It's a pure lookup, recomputed fresh on
every call — nothing about it is cached, so `src/message.js` and
`src/ledger.js` can never disagree about which pickle applied to a given
gameweek, and re-running or backfilling never changes what an *already
recorded* gameweek resolves to, as long as you only ever append entries
after the fact.

`pickleEntryIdForGw` (via `validatePickleHistory`) throws — doesn't warn —
if `history` is empty, out of order, or has two entries sharing a `fromGw`,
since silently picking one would be exactly the kind of wrong-but-plausible
result this project refuses to produce.

**The tool never writes to `pickle.history`.** No code path adds, edits, or
removes an entry automatically — changing the pickle, including correcting
a past mistake, is always a manual edit to `config.json` that you make
yourself, outside the tool.

- **Adding a new entry** for a future `fromGw` (the normal case — the league
  votes in a new pickle) is safe and expected at any time; it only affects
  gameweeks from that `fromGw` onward.
- **Editing an existing entry's `fromGw` or `entryId`** rewrites what every
  gameweek from that point resolves to on the next recompute — including
  gameweeks already reported and already reflected in `ledger.csv`'s
  balances. Only do this deliberately, to correct a genuine mistake in the
  history itself, with a clear idea of which already-sent fines and balances
  will change as a result — never as a casual edit.

## Display names (`config.managers`)

The weekly Telegram/WhatsApp message shows each manager as
`"{teamName} - {managerName}"` (e.g. "Mæts back on Semenyo - Harry Jennings"),
sourced from `config.managers`: an array of
`{ entryId, initials, teamName, managerName }`, one entry per manager, keyed
by the same `entryId` used everywhere else in `config.json` — no separate
identity system.

```json
"managers": [
  { "entryId": 2105, "initials": "TODO", "teamName": "TODO", "managerName": "TODO" }
]
```

`src/message.js` builds an `entryId → record` lookup from `config.managers`
fresh on every call and falls back to a bare `#entryId` if a manager isn't in
the array (e.g. an unfilled `TODO` row) — so a missing entry degrades the
display rather than crashing the run.

**`ledger.csv` deliberately does not use this.** `src/ledger.js` is untouched
by `config.managers` and keeps reading `state.managers` (the directory
`index.js` refreshes from the live API's `entry_name`/player name each run)
for its `Team`/`Manager` columns, exactly as before. Full display names are
for the group-facing message only; the CSV stays on whatever `state.managers`
holds and isn't meant to be forwarded to anyone. `config.managers`'s
`initials` field is there for your own reference when scanning the config by
eye — nothing in the tool currently reads it.

Entry IDs change every season (see Season rollover below), so `config.managers`
needs the same season-start refresh as `pickle.history`. Right now only the
current pickle's real `entryId` (2105) is known; the other rows are seeded
with fake negative placeholder IDs and `"TODO"` values — fill both in from a
`--dry-run`'s output (or the FPL Draft API directly) once the real IDs are
available. Don't invent names or IDs in the meantime; the `#entryId` fallback
is the correct behaviour for an unfilled row, not a bug to work around.

## MOTM months (`config.motmMonths`)

Manager-of-the-month gameweek ranges live in `config.motmMonths`: an array of
`{ label, fromGw, toGw }`, sorted and contiguous. The 2026/27 season's real
ranges, confirmed against the fixture list:

| Month     | GW range |
|-----------|----------|
| August    | 1–2      |
| September | 3–5      |
| October   | 6–9      |
| November  | 10–12    |
| December  | 13–18    |
| January   | 19–23    |
| February  | 24–27    |
| March     | 28–30    |
| April     | 31–33    |
| May       | 34–38    |

No special handling around the GW20 mid-season redraft — the January block
(GW19–23) runs straight through it; a redraft doesn't reset or split a month.

`monthFor`/`monthTable`/`managerOfTheMonth` in `src/pickle.js` read
`fromGw`/`toGw`/`label` directly — recomputed from `state.json` on every run,
same as everything else derived. `validateMotmMonths` runs once at startup
(`index.js`) and throws — doesn't warn — if the array is empty, has a gap or
an overlap between months, or doesn't cover exactly GW1–38, since a gap would
silently drop a gameweek from every month's total and an overlap would
double-count one.

## Layout

- `index.js` — orchestrator: fetch, sanity-check, record, derive, send
- `src/fpl.js` — Draft API calls
- `src/pickle.js` — pure logic, no I/O. Easiest place to test changes.
- `src/message.js` — message formatting
- `src/ledger.js` — CSV formatting for `ledger.csv`, pure, no I/O
- `config.json` — league ID, pickle history, display names, MOTM month ranges
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
points, everyone on zero, pickle not in the league, `motmMonths` with a gap,
overlap, or that doesn't cover exactly GW1–38. A crash sends a Telegram
alert; a wrong-but-plausible message doesn't. Prefer loud failure over a
graceful fallback that hides a broken API.

## Season rollover

Entry IDs change every season. Each August: archive `state.json`, reset it,
set the new `leagueId` and `expectedManagers`, start a fresh
`pickle.history` with one entry at `fromGw: 1` for the new season's pickle,
refresh `config.managers` with the new season's real `entryId`s (`teamName`/
`managerName`/`initials` for people already in the league can usually carry
over unchanged), and replace `motmMonths` with that season's real
month/gameweek ranges taken from the fixture list (`validateMotmMonths` will
refuse to run if the new ranges don't cover exactly GW1–38 with no gaps or
overlaps).
