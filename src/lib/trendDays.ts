/**
 * The Dashboard trend window — the last 7 calendar days, oldest first.
 *
 * Built in JS, not by Postgres: SQLite has no generate_series (and no
 * to_char), so the old trend query died locally with
 * "no such function: to_char" and the revenue/cost charts never rendered
 * on the Windows app. The same (day, label) pairs are passed as $N
 * parameters into a UNION ALL series, which runs verbatim on Postgres through
 * /api/query and on SQLite through pgToSqlite — $N placeholders bind
 * identically on both engines.
 *
 * Dates are UTC (toISOString), so the window matches SQLite's CURRENT_DATE
 * (UTC) and the server's CURRENT_DATE on a UTC VPS. The label matches
 * Postgres to_char(day, 'Dy') in an English locale: the same three-letter
 * abbreviation ('Mon'..'Sun') as the en-US short weekday.
 */

export interface TrendDay {
  /** 'YYYY-MM-DD'. */
  day: string;
  /** Three-letter weekday, e.g. 'Mon'. */
  label: string;
}

export function last7Days(now: Date = new Date()): TrendDay[] {
  const days: TrendDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    days.push({
      day: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    });
  }
  return days;
}

/** The 14 query parameters for the trend VALUES list: (day, label) x 7. */
export function trendDaysParams(days: TrendDay[]): string[] {
  return days.flatMap((d) => [d.day, d.label]);
}
