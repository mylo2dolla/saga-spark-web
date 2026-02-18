import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";

export type BoardInspectKind =
  | "vendor"
  | "notice_board"
  | "npc"
  | "gate"
  | "hotspot"
  | "landmark"
  | "room"
  | "door"
  | "chest"
  | "trap"
  | "altar"
  | "puzzle"
  | "combatant";

export interface BoardInspectTarget {
  kind: BoardInspectKind;
  id: string;
  title: string;
  subtitle?: string;
  vendorId?: string;
  actions: MythicUiAction[];
  meta?: Record<string, unknown>;
  rect?: { x: number; y: number; w: number; h: number };
}
