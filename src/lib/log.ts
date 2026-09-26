// src/lib/log.ts  (isomorphic)
// One JSON line per event on stdout/stderr (Vercel captures both). Isomorphic but meant for server code.
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const REDACT = /token|secret|password|authorization|cookie|private_?key|signature|email|phone|address|line1|postal|cart_token/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Fields = {};
  for (const [k, v] of Object.entries(value as Fields)) {
    out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

function emit(level: Level, event: string, fields?: Fields) {
  if (level === "debug" && process.env.LOG_LEVEL !== "debug") return;
  const line = JSON.stringify({ level, ts: new Date().toISOString(), event, ...(redact(fields ?? {}) as Fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Fields) => emit("debug", event, fields),
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, err?: unknown, fields?: Fields) =>
    emit("error", event, {
      ...fields,
      err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack?.split("\n").slice(0, 5).join("\n") } : err,
    }),
};
