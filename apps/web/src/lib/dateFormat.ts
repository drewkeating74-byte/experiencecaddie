export function formatUsDate(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return "";
  const ymd = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return raw;

  const date = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(date.getTime())) return raw;

  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}
