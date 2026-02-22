export type DmNarratorMode = "ai" | "procedural" | "hybrid";

export type DmNarratorSource = "ai" | "procedural";

export interface DmNarrationInput {
  requestId: string;
  campaignId: string;
  mode: DmNarratorMode;
  expectedTurnIndex: number;
  turnSeed: string;
}

export interface DmNarrationResult<TPayload> {
  source: DmNarratorSource;
  payload: TPayload;
  text: string;
  aiModel?: string | null;
  templateId?: string | null;
  latencyMs?: number;
  debug?: Record<string, unknown> | null;
}

