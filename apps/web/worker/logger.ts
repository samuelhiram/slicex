type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type Logger = {
  debug: (payload: Record<string, unknown>, msg?: string) => void;
  info: (payload: Record<string, unknown>, msg?: string) => void;
  warn: (payload: Record<string, unknown>, msg?: string) => void;
  error: (payload: Record<string, unknown>, msg?: string) => void;
  child: (bindings: Record<string, unknown>) => Logger;
};

export function createLogger(
  level: string = "info",
  bindings: Record<string, unknown> = {},
): Logger {
  const min = LEVELS[(level as Level) in LEVELS ? (level as Level) : "info"];

  function emit(lvl: Level, payload: Record<string, unknown>, msg?: string) {
    if (LEVELS[lvl] < min) return;
    const entry = {
      level: lvl,
      time: Date.now(),
      service: "slicex-web",
      ...bindings,
      ...payload,
      ...(msg ? { msg } : {}),
    };
    // Workers ships console.log lines to Logpush as structured logs.
    console.log(JSON.stringify(entry));
  }

  return {
    debug: (p, m) => emit("debug", p, m),
    info: (p, m) => emit("info", p, m),
    warn: (p, m) => emit("warn", p, m),
    error: (p, m) => emit("error", p, m),
    child: (extra) => createLogger(level, { ...bindings, ...extra }),
  };
}
