import type { NarrativeSceneLegendItem } from "@/ui/components/mythic/board2/types";

interface BoardLegendProps {
  items: NarrativeSceneLegendItem[];
}

function toneClass(tone: NarrativeSceneLegendItem["tone"]): string {
  if (tone === "good") return "border-emerald-200/40 bg-emerald-300/12 text-emerald-100";
  if (tone === "warn") return "border-amber-200/40 bg-amber-300/12 text-amber-100";
  if (tone === "danger") return "border-red-200/45 bg-red-300/14 text-red-100";
  return "border-white/25 bg-white/10 text-white/85";
}

export function BoardLegend(props: BoardLegendProps) {
  if (props.items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {props.items.slice(0, 8).map((item) => (
        <div key={item.id} className={`rounded border px-2 py-1 ${toneClass(item.tone)}`}>
          <span className="font-semibold">{item.label}</span>
          {item.detail ? <span className="ml-1 opacity-80">{item.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}
