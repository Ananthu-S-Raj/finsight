/**
 * Minimal structured logger. Emits one JSON object per line with a stable
 * shape so logs can be shipped to any collector (CloudWatch, Datadog, ...).
 * Never logs secrets, tokens, passwords or full request bodies.
 */

type Level = "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

const IS_PROD = process.env.NODE_ENV === "production";

function emit(level: Level, component: string, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component,
    event,
    ...fields,
  });
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (level === "warn") {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const logger = {
  info: (component: string, event: string, fields?: LogFields) => emit("info", component, event, fields),
  warn: (component: string, event: string, fields?: LogFields) => emit("warn", component, event, fields),
  error: (component: string, event: string, fields?: LogFields) => emit("error", component, event, fields),
  /**
   * Error serializer: extracts only safe, useful facts from an unknown
   * thrown value — never the full stack for 4xx-class client errors.
   */
  err: (err: unknown): LogFields => {
    if (err && typeof err === "object") {
      const e = err as { message?: unknown; name?: unknown; code?: unknown; status?: unknown };
      const fields: LogFields = {};
      if (typeof e.message === "string") fields.message = e.message;
      if (typeof e.code === "string") fields.code = e.code;
      if (typeof e.status === "number") fields.status = e.status;
      if (IS_PROD && typeof e.name === "string") fields.name = e.name;
      return fields;
    }
    if (typeof err === "string") return { message: err };
    return { message: String(err) };
  },
};
