import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";

import { registerFunctionsRoutes } from "./routes/functions.js";
import { getConfig } from "./shared/env.js";

export async function buildApp() {
  const config = getConfig();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.apikey",
          "req.headers.cookie",
          "req.headers.set-cookie",
        ],
        remove: true,
      },
    },
    trustProxy: true,
    requestIdHeader: "x-request-id",
    genReqId: (req) => {
      const incoming =
        (req.headers["x-request-id"] as string | undefined)
        ?? (req.headers["x-correlation-id"] as string | undefined)
        ?? (req.headers["x-vercel-id"] as string | undefined);
      return incoming && incoming.trim().length > 0 ? incoming.trim() : crypto.randomUUID();
    },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (config.allowedOrigins.length === 0) return cb(null, true);
      cb(null, config.allowedOrigins.includes(origin));
    },
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["authorization", "x-client-info", "apikey", "content-type", "x-idempotency-key", "x-request-id"],
    exposedHeaders: ["x-request-id"],
    credentials: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: config.globalRateLimitMax,
    timeWindow: config.globalRateLimitWindowMs,
    hook: "onRequest",
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (req, context) => ({
      ok: false,
      error: "Rate limit exceeded. Retry shortly.",
      code: "rate_limited",
      retry_after_ms: Math.max(0, context.ttl ?? 0),
      requestId: req.id,
    }),
  });

  app.get("/healthz", async () => ({ ok: true }));

  await registerFunctionsRoutes(app);

  return app;
}

