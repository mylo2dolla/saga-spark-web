export type OperationStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";

export interface OperationState {
  id: string;
  name: string;
  status: OperationStatus;
  started_at: number;
  ended_at: number | null;
  error_code: string | null;
  error_message: string | null;
  attempt: number;
  next_retry_at: number | null;
}

export const makeOperationId = (name: string) => `${name}:${crypto.randomUUID()}`;

export function createPendingOperation(name: string, id = makeOperationId(name)): OperationState {
  return {
    id,
    name,
    status: "PENDING",
    started_at: Date.now(),
    ended_at: null,
    error_code: null,
    error_message: null,
    attempt: 0,
    next_retry_at: null,
  };
}

export function withOperationStatus(
  op: OperationState,
  patch: Partial<OperationState>,
): OperationState {
  return {
    ...op,
    ...patch,
  };
}
