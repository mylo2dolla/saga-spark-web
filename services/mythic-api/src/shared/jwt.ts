import { createRemoteJWKSet, jwtVerify } from "jose";
import { getConfig } from "./env.js";

export interface VerifiedJwt {
  userId: string;
  role: string | null;
  payload: Record<string, unknown>;
}

const config = getConfig();
const jwks = createRemoteJWKSet(new URL(config.supabaseJwksUrl));

export async function verifySupabaseAccessToken(token: string): Promise<VerifiedJwt> {
  // Reject obviously invalid tokens without hitting JWKS/network.
  // Supabase access tokens are JWTs with exactly 3 dot-separated segments.
  if (token.split(".").length !== 3) {
    throw new Error("Invalid token format");
  }

  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.supabaseJwtIssuer,
  });

  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) {
    throw new Error("Token missing subject");
  }

  const role = typeof (payload as { role?: unknown }).role === "string" ? String((payload as { role?: unknown }).role) : null;
  return { userId: sub, role, payload: payload as unknown as Record<string, unknown> };
}
