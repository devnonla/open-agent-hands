const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseDays(dow: string): number[] | null {
  if (dow === "*") return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  for (const part of dow.split(",")) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from > to) return null;
      for (let d = from; d <= to; d++) days.add(d % 7);
      continue;
    }
    if (!/^\d$/.test(part)) return null;
    days.add(Number(part) % 7);
  }
  return [...days].sort((a, b) => a - b);
}

function describeDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 5 && days.every((d) => d >= 1 && d <= 5)) return "Weekdays";
  if (days.length === 2 && days[0] === 0 && days[1] === 6) return "Weekends";
  return [...days.filter((d) => d !== 0), ...days.filter((d) => d === 0)].map((d) => DAY_NAMES[d]).join(", ");
}

function describeTime(minute: string, hour: string): string | null {
  const isNum = (v: string) => /^\d{1,2}$/.test(v);
  if (isNum(minute) && isNum(hour)) return `at ${pad2(Number(hour))}:${pad2(Number(minute))}`;
  if (isNum(minute) && hour.includes(",") && hour.split(",").every(isNum))
    return `at ${hour
      .split(",")
      .map((h) => `${pad2(Number(h))}:${pad2(Number(minute))}`)
      .join(", ")}`;
  const minuteStep = /^\*\/(\d+)$/.exec(minute);
  const hourRange = /^(\d+)-(\d+)$/.exec(hour);
  if (minute === "*" && hour === "*") return "every minute";
  if (minuteStep && hour === "*") return `every ${minuteStep[1]} min`;
  if (minuteStep && hourRange) return `every ${minuteStep[1]} min, ${pad2(Number(hourRange[1]))}:00–${pad2(Number(hourRange[2]))}:59`;
  if (isNum(minute) && hour === "*") return minute === "0" ? "every hour" : `every hour at :${pad2(Number(minute))}`;
  const hourStep = /^\*\/(\d+)$/.exec(hour);
  if (isNum(minute) && hourStep) return `every ${hourStep[1]} hours`;
  if (isNum(minute) && hourRange) return `every hour, ${pad2(Number(hourRange[1]))}:00–${pad2(Number(hourRange[2]))}:00`;
  return null;
}

export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [minute, hour, dom, month, dow] = parts;
  if (dom !== "*" || month !== "*") return expr;
  const days = parseDays(dow);
  const time = describeTime(minute, hour);
  if (!days || days.length === 0 || !time) return expr;
  return `${describeDays(days)}, ${time}`;
}

export function parseJobCronExpressions(cronField: string | null | undefined): string[] {
  if (!cronField?.trim()) return [];
  return cronField
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function formatJobSchedulesLabel(cronField: string | null | undefined): string {
  const expressions = parseJobCronExpressions(cronField);
  if (expressions.length === 0) return "Manual only";
  return expressions.map(describeCron).join(" · ");
}

export function jobIsScheduled(cronField: string | null | undefined): boolean {
  return parseJobCronExpressions(cronField).length > 0;
}
