import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const handle = buildServer({
  dbPath: `${config.canvasDataDir}/canvas.db`,
  apiKey: config.openRouterApiKey,
  validatorModel: config.validatorModel,
  executorModel: config.executorModel,
  maxEditDelta: config.maxEditDelta,
  cooldownMinutes: config.cooldownMinutes,
  ipHashSalt: config.ipHashSalt,
  maxPageDepth: config.maxPageDepth,
  rateLimitEnabled: config.rateLimitEnabled,
});

await handle.fastify.listen({ port: config.port, host: config.host });
console.log(`canvas listening on ${config.host}:${config.port}`);
