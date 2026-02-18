import type { FastifyReply, FastifyRequest } from "fastify";

function normalizeHeaderValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") return String(value);
  return "";
}

export function toWebRequest(req: FastifyRequest): Request {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    const normalized = normalizeHeaderValue(value);
    if (!normalized) continue;
    headers.set(key, normalized);
  }

  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : req.body ? JSON.stringify(req.body) : undefined;
  if (body && !headers.get("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(url.toString(), { method, headers, body });
}

export async function sendWebResponse(reply: FastifyReply, response: Response) {
  reply.code(response.status);
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length") return;
    reply.header(key, value);
  });

  if (!response.body) {
    reply.send();
    return;
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const isEventStream = contentType.includes("text/event-stream");

  if (isEventStream) {
    const payload = await response.text();
    reply.send(payload);
    return;
  }

  const payload = Buffer.from(await response.arrayBuffer());
  reply.send(payload);
}
