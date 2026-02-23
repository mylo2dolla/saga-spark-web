import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CombatScene } from "@/ui/components/mythic/board2/scenes/CombatScene";
import { DungeonScene } from "@/ui/components/mythic/board2/scenes/DungeonScene";
import { PixiBoardRenderer } from "@/ui/components/mythic/board2/pixi/PixiBoardRenderer";
import { TownScene } from "@/ui/components/mythic/board2/scenes/TownScene";
import { TravelScene } from "@/ui/components/mythic/board2/scenes/TravelScene";
import type { BoardRendererFailure } from "@/ui/components/mythic/board2/render";
import type { NarrativeBoardSceneModel, NarrativeHotspot } from "@/ui/components/mythic/board2/types";

const PIXI_FAILURE_FALLBACK_THRESHOLD = 2;

export interface NarrativeBoardRendererDiagnostics {
  requestedRenderer: "dom" | "pixi";
  activeRenderer: "dom" | "pixi";
  fallbackActive: boolean;
  failureCount: number;
  failureSignature: string | null;
  failureMessage: string | null;
}

interface NarrativeBoardViewportProps {
  scene: NarrativeBoardSceneModel;
  isActing: boolean;
  renderer: "dom" | "pixi";
  fastMode?: boolean;
  showDevOverlay?: boolean;
  safeInsetTopPx?: number;
  safeInsetBottomPx?: number;
  onRendererDiagnostics?: (diagnostics: NarrativeBoardRendererDiagnostics) => void;
  onRendererFallback?: (diagnostics: NarrativeBoardRendererDiagnostics) => void;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
}

export function NarrativeBoardViewport(props: NarrativeBoardViewportProps) {
  const [activeRenderer, setActiveRenderer] = useState<"dom" | "pixi">(props.renderer);
  const [fallbackActive, setFallbackActive] = useState(false);
  const [failureCount, setFailureCount] = useState(0);
  const [lastFailure, setLastFailure] = useState<BoardRendererFailure | null>(null);
  const requestedRendererRef = useRef<"dom" | "pixi">(props.renderer);
  const failureCountRef = useRef(0);
  const fallbackActiveRef = useRef(false);

  const diagnostics = useMemo<NarrativeBoardRendererDiagnostics>(() => ({
    requestedRenderer: props.renderer,
    activeRenderer,
    fallbackActive,
    failureCount,
    failureSignature: lastFailure?.signature ?? null,
    failureMessage: lastFailure?.message ?? null,
  }), [activeRenderer, fallbackActive, failureCount, lastFailure?.message, lastFailure?.signature, props.renderer]);

  useEffect(() => {
    props.onRendererDiagnostics?.(diagnostics);
  }, [diagnostics, props.onRendererDiagnostics]);

  useEffect(() => {
    if (requestedRendererRef.current === props.renderer) {
      if (props.renderer === "dom" && activeRenderer !== "dom") {
        setActiveRenderer("dom");
      }
      return;
    }

    requestedRendererRef.current = props.renderer;
    failureCountRef.current = 0;
    fallbackActiveRef.current = false;
    setFailureCount(0);
    setFallbackActive(false);
    setLastFailure(null);
    setActiveRenderer(props.renderer);
  }, [activeRenderer, props.renderer]);

  const activateDomFallback = useCallback((failure: BoardRendererFailure | null, nextFailureCount: number) => {
    if (fallbackActiveRef.current) return;
    fallbackActiveRef.current = true;
    setFallbackActive(true);
    setActiveRenderer("dom");
    const payload: NarrativeBoardRendererDiagnostics = {
      requestedRenderer: props.renderer,
      activeRenderer: "dom",
      fallbackActive: true,
      failureCount: nextFailureCount,
      failureSignature: failure?.signature ?? null,
      failureMessage: failure?.message ?? null,
    };
    props.onRendererDiagnostics?.(payload);
    props.onRendererFallback?.(payload);
  }, [props.onRendererDiagnostics, props.onRendererFallback, props.renderer]);

  const onPixiFailure = useCallback((failure: BoardRendererFailure) => {
    setLastFailure(failure);
    const nextCount = Math.max(failureCountRef.current + 1, failure.count);
    failureCountRef.current = nextCount;
    setFailureCount(nextCount);
    if (
      props.renderer === "pixi"
      && (failure.phase === "mount" || nextCount >= PIXI_FAILURE_FALLBACK_THRESHOLD)
    ) {
      activateDomFallback(failure, nextCount);
    }
  }, [activateDomFallback, props.renderer]);

  const domScene = (() => {
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
  })();

  return (
    <div className="relative h-full w-full">
      {activeRenderer === "pixi" ? (
        <PixiBoardRenderer
          scene={props.scene}
          isActing={props.isActing}
          fastMode={props.fastMode}
          showDevOverlay={props.showDevOverlay}
          safeInsetTopPx={props.safeInsetTopPx}
          safeInsetBottomPx={props.safeInsetBottomPx}
          onRendererFailure={onPixiFailure}
          onRequestDomFallback={() => activateDomFallback(lastFailure, Math.max(PIXI_FAILURE_FALLBACK_THRESHOLD, failureCountRef.current))}
          onSelectHotspot={props.onSelectHotspot}
          onSelectMiss={props.onSelectMiss}
        />
      ) : domScene}

      {props.showDevOverlay ? (
        <div
          data-testid="board-render-route-debug"
          className="pointer-events-none absolute right-1 top-1 rounded border border-cyan-200/35 bg-black/55 px-2 py-1 text-[10px] text-cyan-100/85"
        >
          req {props.renderer} · active {activeRenderer}
          {fallbackActive ? " · fallback" : ""}
          {lastFailure ? ` · ${lastFailure.signature}` : ""}
        </div>
      ) : null}
    </div>
  );
}
