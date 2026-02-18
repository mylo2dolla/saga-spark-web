import type { VerifiedJwt } from "./jwt.js";
import { verifySupabaseAccessToken } from "./jwt.js";

export class AuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}

export function bearerTokenFromHeaders(headers: Headers): string | null {
  const authHeader = headers.get("Authorization") ?? headers.get("authorization");
  if (!authHeader) return null;
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function requireUser(headers: Headers): Promise<VerifiedJwt> {
  const token = bearerTokenFromHeaders(headers);
  if (!token) throw new AuthError("auth_required", "Authentication required", 401);
  try {
    return await verifySupabaseAccessToken(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid token";
    throw new AuthError("auth_invalid", message, 401);
  }
}

export async function optionalUser(headers: Headers): Promise<VerifiedJwt | null> {
  const token = bearerTokenFromHeaders(headers);
  if (!token) return null;
  try {
    return await verifySupabaseAccessToken(token);
  } catch {
    return null;
  }
}

