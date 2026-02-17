import type { FastifyInstance } from "fastify";

export async function registerFunctionsRoutes(app: FastifyInstance) {
  // All Mythic-compatible endpoints are mounted under /functions/v1/<function-name>
  // to preserve existing client paths.
  app.options("/functions/v1/:name", async (req, reply) => {
    reply.code(200).send();
  });

  app.post("/functions/v1/:name", async (req, reply) => {
    const name = String((req.params as { name?: unknown }).name ?? "").trim();
    reply
      .code(404)
      .type("application/json")
      .send({ ok: false, error: `Unknown function: ${name}`, code: "function_not_found", requestId: req.id });
  });
}

