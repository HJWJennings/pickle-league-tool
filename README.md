# 🥒 Pickle League automation

Weekly stats + fine bookkeeping for an FPL Draft league, scored on total points.
Runs on GitHub Actions cron, no server, no dependencies.

## What it does

Every Tuesday it pulls the league, records that gameweek's raw points, derives
everything else, and sends you a formatted WhatsApp-ready message to forward
to the group.

**Key design choice:** `state.json` stores *only* raw points per gameweek.
Fines, monthly tables and MOTM are recomputed from scratch on every run. That
means a failed week, a backfill, or a corrected score can never double-fine
anyone. Don't be tempted to cache the derived numbers.

## Rules as implemented

| Rule | Behaviour |
| --- | --- |
| Fine trigger | Score **strictly lower** than the pickle. A draw is not a loss — no fine. |
| Fine amount | `config.fine.amount`, default £1 |
| Collection | None. Everyone pre-pays a £10 float; the script decrements a balance. |
| MOTM | Highest total across the month's gameweek range. **Ties are shared** and the prize splits. |
| Double gameweeks | Not normalised. Planning for them is part of the game. |

## Safety nets

- **Gameweek guard** — `state.lastReportedGw` stops it resending the same
  summary during international breaks and over the summer. State still saves
  (scores get corrected sometimes); only the send is skipped.
- **Sanity assertions** — the run *throws* if the manager count is wrong,
  points come back non-numeric, everyone scores zero, or the pickle isn't in
  the league. A crash emails you; a wrong-but-plausible message doesn't. So it
  crashes on purpose.

## Setup

1. **Create a private repo** and drop these files in.
2. **Get your league ID** — open your league on `draft.premierleague.com`, open
   devtools → Network, and look for the request to
   `draft.premierleague.com/api/league/<ID>/details`. That `<ID>` goes in `config.json`.
3. **Set the month ranges** in `config.json`. The ones in there are a template
   based on a typical season shape — check them against the real 2026/27
   fixture calendar and publish them to the group *before GW1*. This is the
   single most likely thing to cause an argument.
4. **After the draft vote**, set `pickle.entryId`. To find someone's entry ID,
   run `npm run dry` once — it prints the manager directory into `state.json`,
   keyed by entry ID.
5. **Delivery (optional but recommended):** message `@BotFather` on Telegram,
   `/newbot`, grab the token. Message your new bot once, then visit
   `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your chat ID. Add
   both as repo secrets: `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`.
   Without these it still works — the message lands in the Actions run summary,
   which is readable and copy-pasteable from the GitHub mobile app.

## Commands

```bash
npm run dry        # fetch + print, write nothing, send nothing
npm run run        # normal weekly run
npm run backfill   # fill any gameweeks the cron missed
node index.js --force   # record before the gameweek has settled
```

## ⚠️ Verify before you trust it

The Draft API is undocumented, so a few field names are best-effort and I
couldn't test against your live league. All three are flagged with `VERIFY:`
comments in `src/fpl.js`:

- **`/game` → `current_event_finished`** — the field exists but may be named
  differently. Guarded with `?? null`, so a rename means the "is it settled?"
  check silently stops working rather than crashing. Check this one first.
- **`/entry/{id}/history`** — used only by `--backfill`. If it 404s, switch to
  `/entry/{id}/event/{gw}` and read `entry_history.points`.
- **`standings[].event_total`** — for a *points-scored* draft league this should
  be the current gameweek's points. Confirm it isn't cumulative before GW2.

The two-ID gotcha is already handled but worth knowing about: `league_entries[].id`
and `league_entries[].entry_id` are different numbers and standings uses the
former. Everything here keys on `entry_id`.

## Operational notes

- **Tuesday, not Monday.** Bonus points and provisional scores settle late.
- **Entry IDs change every season.** August needs a fresh `pickle.entryId` and
  a wiped `state.json`. Keep last season's file for posterity.
- **Rescheduled gameweeks** are the one case that can go wrong: the script keys
  on gameweek number, so a postponed-then-replayed fixture inside the same GW
  is fine, but a GW that reopens after you've recorded it will silently update.
  That's usually what you want, but it can retroactively change a fine.
- **Your exposure as pickle-holder:** if the pickle turns out good, 9 people ×
  £1 × 38 weeks is £300+. The £10 float caps each person's downside at 10
  fines; past that they need a top-up. Consider a mid-season pickle re-vote
  instead if it gets silly.
