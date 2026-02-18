import { useEffect, useMemo, useRef, useState } from "react";
import { Stage } from "@pixi/react";

interface MythicStageProps {
  className?: string;
  width?: number;
  height?: number;
  children: React.ReactNode;
}

export function MythicStage({ className, width = 320, height = 180, children }: MythicStageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [hostSize, setHostSize] = useState({ width: 960, height: 540 });

  useEffect(() => {
    if (!hostRef.current) return;
    const node = hostRef.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextWidth = Math.max(320, Math.floor(entry.contentRect.width));
      const nextHeight = Math.max(180, Math.floor(entry.contentRect.height));
      setHostSize({ width: nextWidth, height: nextHeight });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const scale = useMemo(() => {
    const sx = hostSize.width / width;
    const sy = hostSize.height / height;
    return Math.max(1, Math.floor(Math.min(sx, sy)));
  }, [hostSize.height, hostSize.width, height, width]);

  return (
    <div ref={hostRef} className={className ?? "mythic-stage"}>
      <div
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          imageRendering: "pixelated",
        }}
      >
        <Stage
          width={width}
          height={height}
          options={{
            antialias: false,
            autoDensity: false,
            backgroundAlpha: 0,
            powerPreference: "high-performance",
          }}
        >
          {children}
        </Stage>
      </div>
    </div>
  );
}
