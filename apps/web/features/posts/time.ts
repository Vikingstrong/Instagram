const fullDate = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Short Instagram-style age: "только что", "5 мин.", "3 ч.", "2 д.", then
// the date. `now` is a parameter so tests do not depend on the clock.
export function timeAgo(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const minutes = Math.floor((now - date.getTime()) / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч.`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} д.`;
  return fullDate.format(date);
}

export const formatPostDate = (iso: string) => fullDate.format(new Date(iso));
