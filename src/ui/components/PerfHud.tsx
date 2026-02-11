import { useEffect, useRef, useState } from "react";

const DEV_DEBUG = import.meta.env.DEV;

interface PerfSnapshot {
  fps: number;
  memMb: number | null;
  longTasks: number;
}

export default function PerfHud() {
  const [snapshot, setSnapshot] = useState<PerfSnapshot>({ fps: 0, memMb: null, longTasks: 0 });
  const frameCountRef = useRef(0);
  const lastTickRef = useRef(performance.now());
  const longTaskRef = useRef(0);

  useEffect(() => {
    if (!DEV_DEBUG) return;

    let rafId = 0;
    const tick = (now: number) => {
      frameCountRef.current += 1;
      const elapsed = now - lastTickRef.current;
      if (elapsed >= 1000) {
        const fps = Math.round((frameCountRef.current * 1000) / elapsed);
        frameCountRef.current = 0;
        lastTickRef.current = now;
        const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
        const memMb = mem ? Math.round(mem.usedJSHeapSize / (1024 * 1024)) : null;
        setSnapshot({ fps, memMb, longTasks: longTaskRef.current });
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    const observer = "PerformanceObserver" in window
      ? new PerformanceObserver(list => {
        list.getEntries().forEach(entry => {
          if (entry.duration >= 50) {
            longTaskRef.current += 1;
          }
        });
      })
      : null;

    if (observer) {
      try {
        observer.observe({ type: "longtask", buffered: true });
      } catch {
        // Long task timing not supported in all browsers.
      }
    }

    return () => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, []);

  if (!DEV_DEBUG) return null;

  return (
    <div
      className="fixed bottom-2 right-2 z-[9999] rounded-md border border-border bg-card/95 px-2 py-1 text-[11px] text-muted-foreground"
      aria-live="polite"
    >
      <div>FPS: {snapshot.fps}</div>
      <div>Heap: {snapshot.memMb ?? "n/a"} MB</div>
      <div>Long tasks: {snapshot.longTasks}</div>
    </div>
  );
}
