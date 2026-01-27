type LogLevel = "info" | "warn" | "error";

export function logEvent(
  level: LogLevel,
  event: string,
  fields?: Record<string, unknown>
) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(fields ?? {}),
  };

  const line = JSON.stringify(payload);
  switch (level) {
    case "warn":
      console.warn(line);
      return;
    case "error":
      console.error(line);
      return;
    default:
      console.info(line);
  }
}

