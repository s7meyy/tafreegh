/** صياغة عربية للمدد والأعداد والتواريخ. */

/** «ساعة و12 دقيقة» — لا «01:12:00». الإنسان يقرأ الأول أسرع. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";

  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);

  const parts: string[] = [];
  if (h > 0) parts.push(plural(h, "ساعة", "ساعتان", "ساعات"));
  if (m > 0) parts.push(plural(m, "دقيقة", "دقيقتان", "دقائق"));
  if (parts.length === 0) return "أقل من دقيقة";
  return parts.join(" و");
}

/** «ساعة» / «ساعتان» / «3 ساعات» / «12 ساعة» — العربية تفرّق بين هذه. */
function plural(n: number, one: string, two: string, few: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${one}`;
}

export function formatCount(n: number, one: string, two: string, few: string) {
  if (n === 0) return `لا ${few}`;
  return plural(n, one, two, few);
}

const dateFormatter = new Intl.DateTimeFormat("ar", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dateFormatter.format(typeof d === "string" ? new Date(d) : d);
}

/** توقيت داخل المقطع: ‏3:05 أو ‏1:03:05. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
