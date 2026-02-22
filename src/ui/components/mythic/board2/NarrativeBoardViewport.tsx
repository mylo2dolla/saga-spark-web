import { CombatScene } from "@/ui/components/mythic/board2/scenes/CombatScene";
import { DungeonScene } from "@/ui/components/mythic/board2/scenes/DungeonScene";
import { PixiBoardRenderer } from "@/ui/components/mythic/board2/pixi/PixiBoardRenderer";
import { TownScene } from "@/ui/components/mythic/board2/scenes/TownScene";
import { TravelScene } from "@/ui/components/mythic/board2/scenes/TravelScene";
import type { NarrativeBoardSceneModel, NarrativeHotspot } from "@/ui/components/mythic/board2/types";

interface NarrativeBoardViewportProps {
  scene: NarrativeBoardSceneModel;
  isActing: boolean;
  renderer: "dom" | "pixi";
  fastMode?: boolean;
  showDevOverlay?: boolean;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
}

export function NarrativeBoardViewport(props: NarrativeBoardViewportProps) {
  if (props.renderer === "pixi") {
    return (
      <PixiBoardRenderer
        scene={props.scene}
        isActing={props.isActing}
        fastMode={props.fastMode}
        showDevOverlay={props.showDevOverlay}
        onSelectHotspot={props.onSelectHotspot}
        onSelectMiss={props.onSelectMiss}
      />
    );
  }

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
    />
  );
}
