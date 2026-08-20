/**
 * Pure date maths for the hourly cron's time-window guards. No I/O, no clock
 * reads — `now` is always passed in, so every branch is testable.
 *
 * Two moments matter per gameweek:
 *   - the gameweek deadline itself (events[].deadline_time, CONFIRMED field)
 *   - the waiver deadline, which this league runs 24h before that
 */

const HOUR_MS = 60 * 60 * 1000;
export const WAIVER_LEAD_MS = 24 * HOUR_MS;

/**
 * A deadline rendered for humans in UK local time, e.g. "Fri 21 Aug, 18:30".
 *
 * deadline_time is UTC; the league is in the UK, so a raw UTC time reads an
 * hour early for the two-thirds of the season on BST. Intl with an explicit
 * Europe/London zone gets the BST/GMT switch right without a dependency or a
 * hand-rolled DST table.
 */
export function formatUkDeadline(at) {
  if (at == null) return null;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London'
  }).format(at);
}

/** The raw deadline_time string for a gameweek, or null if not in the list. */
export function deadlineTimeForGw(events, gw) {
  const event = (events ?? []).find((e) => Number(e.id) === Number(gw));
  return event?.deadline_time ?? null;
}

/**
 * Gameweek deadline as a Date. Throws on an unparseable value rather than
 * returning Invalid Date — a NaN timestamp would silently disable every
 * window guard downstream, which is exactly the quiet-wrongness this project
 * refuses to ship.
 */
export function gameweekDeadline(events, gw) {
  const raw = deadlineTimeForGw(events, gw);
  if (raw == null) return null;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw new Error(
      `Unparseable deadline_time for GW${gw}: ${JSON.stringify(raw)}. ` +
        `The bootstrap-static shape has changed — check src/fpl.js.`
    );
  }
  return at;
}

/** Waiver deadline: 24 hours before the gameweek deadline. */
export function waiverDeadline(events, gw) {
  const at = gameweekDeadline(events, gw);
  return at == null ? null : new Date(at.getTime() - WAIVER_LEAD_MS);
}

/**
 * Is `now` inside [target + afterHours, target + afterHours + windowHours)?
 *
 * The cron fires hourly, so a window wider than an hour guarantees at least
 * one tick lands inside it even if a run is skipped or delayed. The
 * already-sent-this-gameweek guards in state.json are what stop a second
 * tick inside the same window from sending twice — this function is only
 * about "is it roughly time yet", never about "have we already done it".
 */
export function withinWindow(now, target, { afterHours = 0, windowHours = 2 } = {}) {
  if (target == null) return false;
  const opens = target.getTime() + afterHours * HOUR_MS;
  const closes = opens + windowHours * HOUR_MS;
  const t = now.getTime();
  return t >= opens && t < closes;
}

/**
 * Which gameweek's waiver window is open right now, if any.
 *
 * Waivers are reported ~1h after they process, so the window is
 * [waiverDeadline + 1h, waiverDeadline + 3h).
 *
 * Scans every event rather than trusting `current_event`: between gameweeks
 * that field's meaning is ambiguous (it can still point at the just-finished
 * week), and picking the wrong gameweek here would tag the message with the
 * wrong number. Deadlines are unambiguous.
 */
export function gameweekInWaiverWindow(events, now, opts = {}) {
  const { afterHours = 1, windowHours = 2 } = opts;
  for (const e of events ?? []) {
    const wd = waiverDeadline(events, e.id);
    if (withinWindow(now, wd, { afterHours, windowHours })) return Number(e.id);
  }
  return null;
}

/**
 * Which gameweek's deadline window is open right now, if any.
 * Free agency closes at the deadline, so the window is [deadline, deadline + 2h).
 */
export function gameweekInDeadlineWindow(events, now, opts = {}) {
  const { afterHours = 0, windowHours = 2 } = opts;
  for (const e of events ?? []) {
    const d = gameweekDeadline(events, e.id);
    if (withinWindow(now, d, { afterHours, windowHours })) return Number(e.id);
  }
  return null;
}
