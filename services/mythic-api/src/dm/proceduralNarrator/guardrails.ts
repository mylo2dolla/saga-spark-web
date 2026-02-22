import { containsForbiddenSexualContent } from "../../shared/content_policy.js";

const FORBIDDEN_STRINGS: RegExp[] = [
  /\bsexual\s+violence\b/i,
  /\brape\b/i,
  /\bmolest/i,
  /\bunderage\b/i,
];

export function hasForbiddenNarrationContent(text: string): boolean {
  if (containsForbiddenSexualContent(text)) return true;
  return FORBIDDEN_STRINGS.some((pattern) => pattern.test(text));
}

