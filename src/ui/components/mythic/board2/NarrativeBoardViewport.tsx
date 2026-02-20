import { CombatScene } from "@/ui/components/mythic/board2/scenes/CombatScene";
import { DungeonScene } from "@/ui/components/mythic/board2/scenes/DungeonScene";
import { TownScene } from "@/ui/components/mythic/board2/scenes/TownScene";
import { TravelScene } from "@/ui/components/mythic/board2/scenes/TravelScene";
import type { NarrativeBoardSceneModel, NarrativeHotspot } from "@/ui/components/mythic/board2/types";

interface NarrativeBoardViewportProps {
  scene: NarrativeBoardSceneModel;
  isActing: boolean;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
  onQuickCast: (skillId: string, targeting: string) => void;
}

export function NarrativeBoardViewport(props: NarrativeBoardViewportProps) {
  if (props.scene.mode === "town") {
    return (
      <TownScene
        scene={props.scene}
        onSelectHotspot={props.onSelectHotspot}
        onSelectMiss={props.onSelectMiss}
      />
    );
  }

  if (props.scene.mode === "travel") {
    return (
      <TravelScene
        scene={props.scene}
        onSelectHotspot={props.onSelectHotspot}
        onSelectMiss={props.onSelectMiss}
      />
    );
  }

  if (props.scene.mode === "dungeon") {
    return (
      <DungeonScene
        scene={props.scene}
        onSelectHotspot={props.onSelectHotspot}
        onSelectMiss={props.onSelectMiss}
      />
    );
  }

  return (
    <CombatScene
      scene={props.scene}
      isActing={props.isActing}
      onSelectHotspot={props.onSelectHotspot}
      onSelectMiss={props.onSelectMiss}
      onQuickCast={props.onQuickCast}
    />
  );
}
