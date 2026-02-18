export interface SupabaseErrorInfo {
  message: string;
  code: string | null;
  details: string | null;
  hint: string | null;
  status: number | null;
  name: string | null;
}

const readString = (value: unknown): string | null => {
  return typeof value === "string" && value.length > 0 ? value : null;
};

const readNumber = (value: unknown): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

export function getSupabaseErrorInfo(error: unknown, fallback = "Unknown error"): SupabaseErrorInfo {
  if (!error || typeof error !== "object") {
    return {
      message: fallback,
      code: null,
      details: null,
      hint: null,
      status: null,
      name: null,
    };
  }

  const raw = error as Record<string, unknown>;
  return {
    message: readString(raw.message) ?? fallback,
    code: readString(raw.code),
    details: readString(raw.details),
    hint: readString(raw.hint),
    status: readNumber(raw.status),
    name: readString(raw.name),
  };
}
