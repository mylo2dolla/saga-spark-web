import { BoardSceneCanvas } from "@/components/mythic/boards/BoardSceneCanvas";
import type { MythicBoardStateV2 } from "@/types/mythicBoard";

interface DungeonSceneProps {
  boardState: MythicBoardStateV2;
  player: { x: number; y: number };
}

export function DungeonScene({ boardState, player }: DungeonSceneProps) {
  return <BoardSceneCanvas boardState={boardState} player={player} className="mythic-dungeon-scene" />;
}
