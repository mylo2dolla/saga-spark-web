import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { BoardRenderer } from "@/ui/components/mythic/board2/render/BoardRenderer";
import type {
  RenderSnapshot,
  RendererSettings,
  VisualEvent,
  RendererDebugState,
} from "@/ui/components/mythic/board2/render/types";

export * from "@/ui/components/mythic/board2/render/types";
export { BoardRenderer } from "@/ui/components/mythic/board2/render/BoardRenderer";
export { buildRenderSnapshot } from "@/ui/components/mythic/board2/render/snapshot/buildRenderSnapshot";
export { buildVisualEventQueue } from "@/ui/components/mythic/board2/render/events/buildVisualEventQueue";

interface UseBoardRendererMountArgs {
  hostRef: RefObject<HTMLDivElement>;
  snapshot: RenderSnapshot | null;
  events: VisualEvent[];
  settings: RendererSettings;
  onFailure?: (failure: BoardRendererFailure) => void;
}

export interface BoardRendererFailure {
  phase: "mount" | "tick" | "resize";
  count: number;
  message: string;
  signature: string;
}

const EMPTY_DEBUG: RendererDebugState = {
  fps: 0,
  drawCalls: 0,
  eventTimeline: [],
  queueDepth: 0,
  activeParticles: 0,
  activeFloatingTexts: 0,
  uiDensity: "minimal",
  tokenLabelMode: "compact",
  statusChipMode: "none",
  intentChipMode: "none",
};

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }
  return "renderer_failure";
}

function failureSignature(phase: BoardRendererFailure["phase"], message: string): string {
  const normalized = message.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${phase}:${normalized || "unknown"}`;
}

export function useBoardRendererMount(args: UseBoardRendererMountArgs) {
  const [hostNode, setHostNode] = useState<HTMLDivElement | null>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const lastDebugAtRef = useRef<number>(0);
  const failureCountsRef = useRef<Record<BoardRendererFailure["phase"], number>>({
    mount: 0,
    tick: 0,
    resize: 0,
  });
  const onFailureRef = useRef<UseBoardRendererMountArgs["onFailure"]>(args.onFailure);
  const [ready, setReady] = useState(false);
  const [debugState, setDebugState] = useState<RendererDebugState>(EMPTY_DEBUG);

  const stableSettings = useMemo(
    () => ({
      fastMode: args.settings.fastMode,
      cinematicCamera: args.settings.cinematicCamera,
      showDevOverlay: args.settings.showDevOverlay,
      reducedMotion: args.settings.reducedMotion,
      qualityMode: args.settings.qualityMode,
      uiDensity: args.settings.uiDensity,
      tokenLabelMode: args.settings.tokenLabelMode,
      fitMode: args.settings.fitMode,
      edgePaddingPx: args.settings.edgePaddingPx,
      safeInsetTopPx: args.settings.safeInsetTopPx,
      safeInsetBottomPx: args.settings.safeInsetBottomPx,
      backgroundFill: args.settings.backgroundFill,
    }),
    [
      args.settings.fastMode,
      args.settings.cinematicCamera,
      args.settings.showDevOverlay,
      args.settings.reducedMotion,
      args.settings.qualityMode,
      args.settings.uiDensity,
      args.settings.tokenLabelMode,
      args.settings.fitMode,
      args.settings.edgePaddingPx,
      args.settings.safeInsetTopPx,
      args.settings.safeInsetBottomPx,
      args.settings.backgroundFill,
    ],
  );

  useEffect(() => {
    if (args.hostRef.current && args.hostRef.current !== hostNode) {
      setHostNode(args.hostRef.current);
    }
  }, [args.hostRef, hostNode]);

  useEffect(() => {
    onFailureRef.current = args.onFailure;
  }, [args.onFailure]);

  useEffect(() => {
    const host = hostNode;
    if (!host) return;

    let disposed = false;
    const teardownRenderer = () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTickRef.current = null;
      lastDebugAtRef.current = 0;
      const renderer = rendererRef.current;
      rendererRef.current = null;
      if (renderer) renderer.destroy();
      if (!disposed) {
        setReady(false);
        setDebugState(EMPTY_DEBUG);
      }
    };
    const reportFailure = (phase: BoardRendererFailure["phase"], error: unknown) => {
      failureCountsRef.current[phase] = (failureCountsRef.current[phase] ?? 0) + 1;
      const count = failureCountsRef.current[phase];
      const message = failureMessage(error);
      onFailureRef.current?.({
        phase,
        count,
        message,
        signature: failureSignature(phase, message),
      });
      return count;
    };

    failureCountsRef.current = { mount: 0, tick: 0, resize: 0 };

    void BoardRenderer.mount(host, stableSettings).then((renderer) => {
      if (disposed) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      setReady(true);

      const loop = (time: number) => {
        if (!rendererRef.current) return;
        const last = lastTickRef.current ?? time;
        const delta = Math.max(1, Math.min(50, time - last));
        lastTickRef.current = time;
        try {
          rendererRef.current.tick(delta);
        } catch (error) {
          const count = reportFailure("tick", error);
          if (count >= 2) {
            teardownRenderer();
            return;
          }
        }
        if (time - lastDebugAtRef.current >= 120) {
          lastDebugAtRef.current = time;
          setDebugState(rendererRef.current.getDebugState());
        }
        rafRef.current = window.requestAnimationFrame(loop);
      };
      rafRef.current = window.requestAnimationFrame(loop);
    }).catch((error) => {
      reportFailure("mount", error);
      teardownRenderer();
    });

    let resizeRaf: number | null = null;
    const applyResize = () => {
      resizeRaf = null;
      const renderer = rendererRef.current;
      const target = args.hostRef.current;
      if (!renderer || !target) return;
      try {
        renderer.resize(target.clientWidth, target.clientHeight);
      } catch (error) {
        const count = reportFailure("resize", error);
        if (count >= 2) {
          teardownRenderer();
        }
      }
    };
    const scheduleResize = () => {
      if (resizeRaf !== null) {
        window.cancelAnimationFrame(resizeRaf);
      }
      resizeRaf = window.requestAnimationFrame(applyResize);
    };
    scheduleResize();
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => scheduleResize())
      : null;
    observer?.observe(host);
    window.addEventListener("resize", scheduleResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", scheduleResize);
      observer?.disconnect();
      if (resizeRaf !== null) {
        window.cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }
      teardownRenderer();
    };
  }, [hostNode]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !args.snapshot) return;
    renderer.setSnapshot(args.snapshot);
  }, [args.snapshot]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setSettings(stableSettings);
  }, [stableSettings]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !Array.isArray(args.events) || args.events.length === 0) return;
    renderer.enqueueEvents(args.events);
  }, [args.events]);

  return {
    rendererRef,
    ready,
    debugState,
  };
}
