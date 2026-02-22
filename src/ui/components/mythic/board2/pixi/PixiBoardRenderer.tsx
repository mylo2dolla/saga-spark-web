import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CombatSceneData, NarrativeBoardSceneModel, NarrativeHotspot } from "@/ui/components/mythic/board2/types";
import {
  buildRenderSnapshot,
  buildVisualEventQueue,
  useBoardRendererMount,
  type RenderFrameState,
  type VisualEvent,
} from "@/ui/components/mythic/board2/render";

interface PixiBoardRendererProps {
  scene: NarrativeBoardSceneModel;
  isActing: boolean;
  fastMode?: boolean;
  showDevOverlay?: boolean;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
}

function findHotspotAtPoint(hotspots: NarrativeHotspot[], point: { x: number; y: number }): NarrativeHotspot | null {
  const ordered = [...hotspots].sort((left, right) => {
    const leftArea = left.rect.w * left.rect.h;
    const rightArea = right.rect.w * right.rect.h;
    if (leftArea !== rightArea) return leftArea - rightArea;
    const leftTier = left.visual?.tier === "primary" ? 0 : left.visual?.tier === "secondary" ? 1 : 2;
    const rightTier = right.visual?.tier === "primary" ? 0 : right.visual?.tier === "secondary" ? 1 : 2;
    return leftTier - rightTier;
  });

  for (const hotspot of ordered) {
    const minX = Math.floor(hotspot.rect.x);
    const minY = Math.floor(hotspot.rect.y);
    const maxX = Math.floor(hotspot.rect.x + hotspot.rect.w - 1);
    const maxY = Math.floor(hotspot.rect.y + hotspot.rect.h - 1);
    if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
      return hotspot;
    }
  }
  return null;
}

export function PixiBoardRenderer(props: PixiBoardRendererProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameStateRef = useRef<RenderFrameState | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visualEvents, setVisualEvents] = useState<VisualEvent[]>([]);

  const snapshot = useMemo(() => buildRenderSnapshot(props.scene), [props.scene]);

  const engineEvents = useMemo(() => {
    if (props.scene.mode !== "combat") return [];
    const details = props.scene.details as CombatSceneData;
    return details.recentEvents ?? [];
  }, [props.scene.details, props.scene.mode]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    media.onchange = sync;
    return () => {
      media.onchange = null;
    };
  }, []);

  useEffect(() => {
    const built = buildVisualEventQueue(
      engineEvents,
      frameStateRef.current,
      {
        snapshot,
        boardType: snapshot.board.type,
      },
    );
    frameStateRef.current = built.frameState;
    setVisualEvents(built.queue);
  }, [engineEvents, snapshot]);

  const rendererSettings = useMemo(
    () => ({
      fastMode: Boolean(props.fastMode),
      cinematicCamera: !props.fastMode,
      showDevOverlay: Boolean(props.showDevOverlay),
      reducedMotion,
    }),
    [props.fastMode, props.showDevOverlay, reducedMotion],
  );

  const { rendererRef, ready, debugState } = useBoardRendererMount({
    hostRef,
    snapshot,
    events: visualEvents,
    settings: rendererSettings,
  });

  const onPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    const renderer = rendererRef.current;
    if (!host || !renderer) return;
    const rect = host.getBoundingClientRect();
    const tile = renderer.screenToTile(event.clientX - rect.left, event.clientY - rect.top);
    if (!tile) return;
    const hotspot = findHotspotAtPoint(props.scene.hotspots, tile);
    if (hotspot) {
      props.onSelectHotspot(hotspot, tile);
      return;
    }
    props.onSelectMiss(tile);
  };

  return (
    <div
      data-testid="board-pixi-renderer"
      className="relative h-full min-h-[280px] w-full overflow-hidden rounded-lg border border-amber-200/30 bg-black/20"
      aria-busy={props.isActing}
    >
      <div
        data-testid="board-grid-layer"
        ref={hostRef}
        className="h-full w-full cursor-crosshair"
        onPointerUp={onPointer}
      />

      {!ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-amber-100/70">
          Loading renderer...
        </div>
      ) : null}

      {props.showDevOverlay ? (
        <div
          data-testid="board-render-debug"
          className="pointer-events-none absolute bottom-1 left-1 rounded border border-cyan-200/35 bg-black/55 px-2 py-1 text-[10px] text-cyan-100/85"
        >
          fps {debugState.fps.toFixed(1)} · draw {debugState.drawCalls} · queue {debugState.queueDepth}
        </div>
      ) : null}
    </div>
  );
}
