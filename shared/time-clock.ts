export const TIME_ZONE = "America/Chicago";
export type TimeEntry = {
  id: string; employee_id: string; clock_in: string; clock_out: string | null;
  notes: string; version: number; created_at: string; updated_at: string;
};

/** Wall-clock inputs always use Air King's timezone, regardless of device location. */
export function localTime(instant: string | number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const p = Object.fromEntries(parts.map(v => [v.type, v.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Zero results = spring-forward gap; two = the repeated fall-back hour. */
export function timeCandidates(wall: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(wall)) return [];
  const normalized = wall.length === 16 ? wall + ":00" : wall;
  const utc = Date.parse(normalized + "Z");
  if (!Number.isFinite(utc)) return [];
  return [5, 6].map(offset => new Date(utc + offset * 3600000).toISOString())
    .filter(instant => localTime(instant) === normalized);
}

export function dateBoundary(day: string): string {
  const instant = timeCandidates(day + "T00:00")[0];
  if (!instant) throw new Error("Choose a valid date.");
  return instant;
}

export function shiftDay(day: string, days: number): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekStart(now = Date.now()): string {
  const day = localTime(now).slice(0, 10);
  const weekday = new Date(day + "T12:00:00Z").getUTCDay();
  return shiftDay(day, -(weekday + 6) % 7);
}

export function elapsedMs(entry: Pick<TimeEntry, "clock_in" | "clock_out">, now: number,
  from = -Infinity, to = Infinity): number {
  return Math.max(0, Math.min(entry.clock_out ? Date.parse(entry.clock_out) : now, to)
    - Math.max(Date.parse(entry.clock_in), from));
}

export function duration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
