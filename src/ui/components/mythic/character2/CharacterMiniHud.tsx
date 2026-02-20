import { Button } from "@/components/ui/button";
import type { CharacterSheetViewModel } from "@/ui/components/mythic/character2/types";

interface CharacterMiniHudProps {
  model: CharacterSheetViewModel;
  onOpen: () => void;
}

function clampPercent(current: number, max: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

export function CharacterMiniHud(props: CharacterMiniHudProps) {
  const hpPct = clampPercent(props.model.hpGauge.current, props.model.hpGauge.max);
  const mpPct = clampPercent(props.model.mpGauge.current, props.model.mpGauge.max);

  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="w-full rounded-xl border border-amber-200/30 bg-[linear-gradient(160deg,rgba(26,17,8,0.9),rgba(8,10,16,0.96))] p-3 text-left text-amber-50 transition hover:border-amber-200/45 hover:bg-[linear-gradient(160deg,rgba(34,24,11,0.9),rgba(11,13,20,0.96))]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg leading-tight text-amber-100">{props.model.name}</div>
          <div className="text-xs text-amber-100/75">
            Lv {props.model.level} {props.model.className} · {props.model.role}
          </div>
        </div>
        <div className="rounded border border-amber-200/35 bg-amber-100/10 px-2 py-1 text-[11px] uppercase tracking-wide text-amber-100/80">
          {props.model.boardMode}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded border border-emerald-200/30 bg-emerald-400/10 p-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-emerald-100/75">HP</div>
          <div className="h-1.5 w-full rounded bg-black/35">
            <div className="h-full rounded bg-emerald-300" style={{ width: `${hpPct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-emerald-50">{props.model.hpGauge.current}/{props.model.hpGauge.max}</div>
        </div>

        <div className="rounded border border-sky-200/30 bg-sky-400/10 p-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-sky-100/75">MP</div>
          <div className="h-1.5 w-full rounded bg-black/35">
            <div className="h-full rounded bg-sky-300" style={{ width: `${mpPct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-sky-50">{props.model.mpGauge.current}/{props.model.mpGauge.max}</div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-amber-100/80">
        <span>Armor {props.model.combat.armor}</span>
        <span>Coins {props.model.coins}</span>
        <span>{props.model.combat.playerTurnLabel}</span>
      </div>

      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="secondary" className="h-7 text-[11px]" asChild>
          <span>Open Character Sheet</span>
        </Button>
      </div>
    </button>
  );
}
