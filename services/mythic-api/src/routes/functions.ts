import type { FastifyInstance } from "fastify";
import { FUNCTION_HANDLERS } from "../functions/index.js";
import { toWebRequest, sendWebResponse } from "../shared/http.js";
import { AuthError, optionalUser, requireUser } from "../shared/auth.js";
import { sanitizeError } from "../shared/redact.js";

export async function registerFunctionsRoutes(app: FastifyInstance) {
  // All Mythic-compatible endpoints are mounted under /functions/v1/<function-name>
  // to preserve existing client paths.
  app.options("/functions/v1/:name", async (req, reply) => {
    reply.code(200).send();
  });

  app.post("/functions/v1/:name", async (req, reply) => {
    const name = String((req.params as { name?: unknown }).name ?? "").trim();

    const handler = FUNCTION_HANDLERS.get(name) ?? null;
    if (!handler) {
      reply
        .code(404)
        .type("application/json")
        .send({ error: `Unknown function: ${name}`, code: "function_not_found", requestId: req.id });
      return;
    }

    reply.header("x-request-id", req.id);

    try {
      const webReq = toWebRequest(req);
      let user = null;
      try {
        if (handler.auth === "required") {
          user = await requireUser(webReq.headers);
        } else if (handler.auth === "optional") {
          user = await optionalUser(webReq.headers);
        }
      } catch (error) {
        if (error instanceof AuthError) {
          reply
            .code(error.status)
            .type("application/json")
            .send({ error: error.message, code: error.code, requestId: req.id });
          return;
        }
        throw error;
      }

      const response = await handler.handle(webReq, {
        requestId: req.id,
        user,
        log: {
          debug: (msg, data) => req.log.debug({ ...data }, msg),
          info: (msg, data) => req.log.info({ ...data }, msg),
          warn: (msg, data) => req.log.warn({ ...data }, msg),
          error: (msg, data) => req.log.error({ ...data }, msg),
        },
      });
      await sendWebResponse(reply, response);
    } catch (error) {
      const normalized = sanitizeError(error);
      req.log.error({ err: normalized, route: name }, "function.unhandled_error");
      reply
        .code(500)
        .type("application/json")
        .send({ error: normalized.message || "Internal error", code: normalized.code ?? "function_failed", requestId: req.id });
    }
  });
}
