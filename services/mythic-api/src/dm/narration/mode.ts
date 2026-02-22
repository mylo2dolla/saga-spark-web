import type { DmNarratorMode } from "./types.js";

function normalizeMode(value: string | null | undefined): DmNarratorMode | null {
  const key = (value ?? "").trim().toLowerCase();
  if (key === "ai" || key === "procedural" || key === "hybrid") return key;
  return null;
}

export interface ResolveDmNarratorModeInput {
  envMode: string | null | undefined;
  headerMode: string | null | undefined;
  queryMode: string | null | undefined;
  allowQueryOverride: boolean;
}

export interface ResolveDmNarratorModeResult {
  mode: DmNarratorMode;
  source: "env" | "header" | "query" | "default";
  warnings: string[];
}

export function resolveDmNarratorMode(input: ResolveDmNarratorModeInput): ResolveDmNarratorModeResult {
  const warnings: string[] = [];
  const envMode = normalizeMode(input.envMode);
  const headerMode = normalizeMode(input.headerMode);
  const queryMode = normalizeMode(input.queryMode);

  if (input.envMode && !envMode) {
    warnings.push(`invalid_env_mode:${String(input.envMode).trim()}`);
  }
  if (input.headerMode && !headerMode) {
    warnings.push(`invalid_header_mode:${String(input.headerMode).trim()}`);
  }
  if (input.queryMode && !queryMode) {
    warnings.push(`invalid_query_mode:${String(input.queryMode).trim()}`);
  }
  if (input.queryMode && !input.allowQueryOverride) {
    warnings.push("query_override_ignored_in_production");
  }

  if (queryMode && input.allowQueryOverride) {
    return { mode: queryMode, source: "query", warnings };
  }
  if (headerMode) {
    return { mode: headerMode, source: "header", warnings };
  }
  if (envMode) {
    return { mode: envMode, source: "env", warnings };
  }
  return { mode: "hybrid", source: "default", warnings };
}

