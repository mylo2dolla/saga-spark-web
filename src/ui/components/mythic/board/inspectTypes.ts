import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";

export type BoardInspectKind = "vendor" | "notice_board" | "npc" | "gate" | "hotspot";

export interface BoardInspectTarget {
  kind: BoardInspectKind;
  id: string;
  title: string;
  subtitle?: string;
  vendorId?: string;
  actions: MythicUiAction[];
}

