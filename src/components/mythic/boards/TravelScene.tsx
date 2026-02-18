import { BoardSceneCanvas } from "@/components/mythic/boards/BoardSceneCanvas";
import type { MythicBoardStateV2 } from "@/types/mythicBoard";

interface TravelSceneProps {
  boardState: MythicBoardStateV2;
  player: { x: number; y: number };
}

export function TravelScene({ boardState, player }: TravelSceneProps) {
  return <BoardSceneCanvas boardState={boardState} player={player} showFog className="mythic-travel-scene" />;
}
