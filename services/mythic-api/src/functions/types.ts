import type { VerifiedJwt } from "../shared/jwt.js";

export type FunctionAuthMode = "required" | "optional" | "none";

export interface LoggerLike {
  debug: (msg: string, data?: Record<string, unknown>) => void;
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
}

export interface FunctionContext {
  requestId: string;
  user: VerifiedJwt | null;
  log: LoggerLike;
}

export interface FunctionHandler {
  name: string;
  auth: FunctionAuthMode;
  handle: (req: Request, ctx: FunctionContext) => Promise<Response>;
}

