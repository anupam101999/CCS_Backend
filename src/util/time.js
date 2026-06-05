const DEFAULT_TIME_ZONE = "Asia/Kolkata";
const DEFAULT_LOCALE = "en-IN";

if (!process.env.TZ) {
  process.env.TZ = DEFAULT_TIME_ZONE;
}

function getTimeZone() {
  return DEFAULT_TIME_ZONE;
}

function getOffset(date, timeZone) {
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const zonedDate = new Date(date.toLocaleString("en-US", { timeZone }));
  const offsetMinutes = Math.round((zonedDate.getTime() - utcDate.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");

  return `${sign}${hours}:${minutes}`;
}

function getLocalParts(date = new Date(), timeZone = getTimeZone()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  return Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
}

function formatDateOnly(date = new Date(), timeZone = getTimeZone()) {
  const parts = getLocalParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localTimestamp(date = new Date(), timeZone = getTimeZone()) {
  const parts = getLocalParts(date, timeZone);
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${milliseconds}${getOffset(date, timeZone)}`;
}

function nextDailyRunTimestamp(timeValue, timeZone = getTimeZone(), from = new Date()) {
  const match = String(timeValue || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return "";

  const [, hour, minute] = match;
  const parts = getLocalParts(from, timeZone);
  const offset = getOffset(from, timeZone);
  const todayAtRunTime = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${hour}:${minute}:00.000${offset}`,
  );
  const nextRun =
    todayAtRunTime.getTime() > from.getTime()
      ? todayAtRunTime
      : new Date(todayAtRunTime.getTime() + 24 * 60 * 60 * 1000);

  return localTimestamp(nextRun, timeZone);
}

module.exports = {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
  formatDateOnly,
  getTimeZone,
  localTimestamp,
  nextDailyRunTimestamp,
};
