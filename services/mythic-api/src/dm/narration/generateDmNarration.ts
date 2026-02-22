import type { DmNarrationInput, DmNarrationResult } from "./types.js";

function errMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return "unknown_error";
}

export interface GenerateDmNarrationArgs<TPayload> {
  input: DmNarrationInput;
  generateAi: () => Promise<DmNarrationResult<TPayload>>;
  generateProcedural: (reason: string | null) => Promise<DmNarrationResult<TPayload>>;
}

export async function generateDmNarration<TPayload>(
  args: GenerateDmNarrationArgs<TPayload>,
): Promise<DmNarrationResult<TPayload>> {
  const { input } = args;
  if (input.mode === "procedural") {
    return await args.generateProcedural("mode:procedural");
  }
  if (input.mode === "ai") {
    return await args.generateAi();
  }

  try {
    return await args.generateAi();
  } catch (error) {
    const fallback = await args.generateProcedural(`hybrid_fallback:${errMessage(error).slice(0, 220)}`);
    return {
      ...fallback,
      debug: {
        ...(fallback.debug ?? {}),
        hybrid_fallback: true,
        hybrid_error_message: errMessage(error).slice(0, 500),
      },
    };
  }
}

