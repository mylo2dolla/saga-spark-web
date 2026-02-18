import { useEffect, useMemo, useRef } from "react";

interface PixelBoardCanvasProps {
  width: number;
  height: number;
  className?: string;
  onDraw: (ctx: CanvasRenderingContext2D, frame: { t: number; dt: number; width: number; height: number }) => void;
  onClickPixel?: (x: number, y: number) => void;
}

export function PixelBoardCanvas(props: PixelBoardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const timeRef = useRef<number>(0);
  const mountedRef = useRef<boolean>(false);
  const drawRef = useRef(props.onDraw);

  useEffect(() => {
    drawRef.current = props.onDraw;
  }, [props.onDraw]);

  const safeWidth = useMemo(() => Math.max(32, Math.floor(props.width)), [props.width]);
  const safeHeight = useMemo(() => Math.max(24, Math.floor(props.height)), [props.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    mountedRef.current = true;
    canvas.width = safeWidth;
    canvas.height = safeHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const tick = (ts: number) => {
      if (!mountedRef.current) return;
      const t = ts / 1000;
      const dt = t - timeRef.current;
      timeRef.current = t;

      ctx.clearRect(0, 0, safeWidth, safeHeight);
      drawRef.current(ctx, { t, dt, width: safeWidth, height: safeHeight });
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      mountedRef.current = false;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [safeHeight, safeWidth]);

  return (
    <canvas
      ref={canvasRef}
      width={safeWidth}
      height={safeHeight}
      className={props.className}
      style={{
        width: "100%",
        height: "100%",
        imageRendering: "pixelated",
      }}
      onClick={(event) => {
        if (!props.onClickPixel) return;
        const target = event.currentTarget;
        const rect = target.getBoundingClientRect();
        const relX = (event.clientX - rect.left) / rect.width;
        const relY = (event.clientY - rect.top) / rect.height;
        const px = Math.max(0, Math.min(safeWidth - 1, Math.floor(relX * safeWidth)));
        const py = Math.max(0, Math.min(safeHeight - 1, Math.floor(relY * safeHeight)));
        props.onClickPixel(px, py);
      }}
    />
  );
}
