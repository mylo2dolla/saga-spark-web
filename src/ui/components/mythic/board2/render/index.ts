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
}

const EMPTY_DEBUG: RendererDebugState = {
  fps: 0,
  drawCalls: 0,
  eventTimeline: [],
  queueDepth: 0,
  activeParticles: 0,
  activeFloatingTexts: 0,
};

export function useBoardRendererMount(args: UseBoardRendererMountArgs) {
  const [hostNode, setHostNode] = useState<HTMLDivElement | null>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const lastDebugAtRef = useRef<number>(0);
  const [ready, setReady] = useState(false);
  const [debugState, setDebugState] = useState<RendererDebugState>(EMPTY_DEBUG);

  const stableSettings = useMemo(
    () => ({
      fastMode: args.settings.fastMode,
      cinematicCamera: args.settings.cinematicCamera,
      showDevOverlay: args.settings.showDevOverlay,
      reducedMotion: args.settings.reducedMotion,
    }),
    [
      args.settings.fastMode,
      args.settings.cinematicCamera,
      args.settings.showDevOverlay,
      args.settings.reducedMotion,
    ],
  );

  useEffect(() => {
    if (args.hostRef.current && args.hostRef.current !== hostNode) {
      setHostNode(args.hostRef.current);
    }
  }, [args.hostRef, hostNode]);

  useEffect(() => {
    const host = hostNode;
    if (!host) return;

    let disposed = false;
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
        const delta = Math.max(1, time - last);
        lastTickRef.current = time;
        rendererRef.current.tick(delta);
        if (time - lastDebugAtRef.current >= 120) {
          lastDebugAtRef.current = time;
          setDebugState(rendererRef.current.getDebugState());
        }
        rafRef.current = window.requestAnimationFrame(loop);
      };
      rafRef.current = window.requestAnimationFrame(loop);
    }).catch(() => {
      setReady(false);
    });

    const onResize = () => {
      const renderer = rendererRef.current;
      const target = args.hostRef.current;
      if (!renderer || !target) return;
      renderer.resize(target.clientWidth, target.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTickRef.current = null;
      lastDebugAtRef.current = 0;
      const renderer = rendererRef.current;
      rendererRef.current = null;
      if (renderer) renderer.destroy();
      setReady(false);
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
