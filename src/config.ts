export interface Config {
  readonly openRouterApiKey: string;
  readonly validatorModel: string;
  readonly executorModel: string;
  readonly ipHashSalt: string;
  readonly cooldownMinutes: number;
  readonly maxEditDelta: number;
  readonly maxPageDepth: number;
  readonly port: number;
  readonly host: string;
  readonly logLevel: string;
  readonly canvasDataDir: string;
}

export function loadConfig(): Config {
  const ipHashSalt = requireEnv("IP_HASH_SALT");
  const openRouterApiKey = requireEnv("OPENROUTER_API_KEY");
  return {
    openRouterApiKey,
    validatorModel: process.env["VALIDATOR_MODEL"] ?? "anthropic/claude-3-haiku",
    executorModel: process.env["EXECUTOR_MODEL"] ?? "anthropic/claude-3.5-sonnet",
    ipHashSalt,
    cooldownMinutes: parseIntEnv("COOLDOWN_MINUTES", 60),
    maxEditDelta: parseIntEnv("MAX_EDIT_DELTA", 20),
    maxPageDepth: parseIntEnv("MAX_PAGE_DEPTH", 4),
    port: parseIntEnv("PORT", 3131),
    host: process.env["HOST"] ?? "127.0.0.1",
    logLevel: process.env["LOG_LEVEL"] ?? "info",
    canvasDataDir: process.env["CANVAS_DATA_DIR"] ?? "./data",
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be an integer, got: ${raw}`);
  }
  return parsed;
}
