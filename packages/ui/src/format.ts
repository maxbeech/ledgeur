// Presentation helpers shared across screens — one definition each.

/** "3:04 PM" style clock from an ISO string or Date. */
export function formatClock(input: string | Date, locale?: string): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** Human relative time: "just now", "12m ago", "3h ago", "2d ago", else a date. */
export function relativeTime(input: string | Date, now: Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  const secs = Math.round((now.getTime() - d.getTime()) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** mm:ss elapsed clock from seconds — for the live recorder. */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
