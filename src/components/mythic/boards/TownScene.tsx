import { BoardSceneCanvas } from "@/components/mythic/boards/BoardSceneCanvas";
import type { MythicBoardStateV2 } from "@/types/mythicBoard";

interface TownSceneProps {
  boardState: MythicBoardStateV2;
  player: { x: number; y: number };
}

export function TownScene({ boardState, player }: TownSceneProps) {
  return <BoardSceneCanvas boardState={boardState} player={player} className="mythic-town-scene" />;
}
