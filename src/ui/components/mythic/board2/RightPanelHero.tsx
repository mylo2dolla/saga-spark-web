import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NarrativeCombatCoreAction, NarrativeHeroModel, NarrativeTone } from "@/ui/components/mythic/board2/types";

interface RightPanelHeroCharacter {
  name: string;
  level: number;
  className: string;
  role: string;
  hpCurrent: number;
  hpMax: number;
  mpCurrent: number;
  mpMax: number;
  armor: number;
  turnLabel: string;
}

interface RightPanelHeroWarning {
  tone: NarrativeTone;
  title: string;
  detail: string;
}

interface RightPanelHeroProps {
  hero: NarrativeHeroModel;
  warning: RightPanelHeroWarning | null;
  isBusy: boolean;
  isStateRefreshing: boolean;
  character: RightPanelHeroCharacter | null;
  combatCoreActions: NarrativeCombatCoreAction[];
  onCoreAction: (skillId: string, targeting: string) => void;
  onOpenCharacterSheet: () => void;
}

function toneClass(tone: NarrativeTone | undefined): string {
  if (tone === "good") return "border-emerald-200/45 bg-emerald-300/15 text-emerald-100";
  if (tone === "warn") return "border-amber-200/45 bg-amber-300/15 text-amber-100";
  if (tone === "danger") return "border-red-200/45 bg-red-300/15 text-red-100";
  return "border-white/30 bg-white/10 text-white/85";
}

function warningClass(tone: NarrativeTone): string {
  if (tone === "danger") return "border-destructive/45 bg-destructive/10 text-destructive";
  if (tone === "warn") return "border-amber-300/45 bg-amber-500/10 text-amber-100";
  if (tone === "good") return "border-emerald-300/45 bg-emerald-500/10 text-emerald-100";
  return "border-amber-200/30 bg-amber-100/10 text-amber-100/80";
}

function clampPercent(current: number, max: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

export function RightPanelHero(props: RightPanelHeroProps) {
  const hpPct = props.character ? clampPercent(props.character.hpCurrent, props.character.hpMax) : 0;
  const mpPct = props.character ? clampPercent(props.character.mpCurrent, props.character.mpMax) : 0;

  return (
    <div className="rounded-lg border border-amber-200/25 bg-[linear-gradient(170deg,rgba(31,21,14,0.95),rgba(10,12,19,0.96))] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-amber-100/70">{props.hero.modeLabel}</div>
          <div className="font-display text-xl text-amber-100">{props.hero.statusLabel}</div>
          <div className="text-xs text-amber-100/80">{props.hero.objective}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="rounded border border-amber-200/30 bg-amber-100/10 px-2 py-1 text-[11px] text-amber-100/80">
            {props.hero.contextSourceLabel}
          </div>
          <Button size="sm" variant="secondary" onClick={props.onOpenCharacterSheet}>
            Character Sheet
          </Button>
        </div>
      </div>

      {props.warning ? (
        <div className={`mt-2 rounded-md border px-2.5 py-2 text-xs ${warningClass(props.warning.tone)}`}>
          <div className="font-medium">{props.warning.title}</div>
          <div className="mt-0.5">{props.warning.detail}</div>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {props.hero.chips.map((chip) => (
          <div key={`hero-chip-${chip.id}`} className={`rounded border px-2 py-1 text-[11px] ${toneClass(chip.tone)}`}>
            <span className="font-semibold">{chip.label}</span>: {chip.value}
          </div>
        ))}
        <div className="ml-auto inline-flex items-center gap-1 rounded border border-amber-200/30 bg-amber-100/10 px-2 py-1 text-[11px] text-amber-100/80">
          <span>{props.hero.syncLabel}</span>
          {props.isBusy || props.isStateRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        </div>
      </div>

      {props.character ? (
        <div className="mt-2 rounded border border-amber-200/25 bg-black/20 p-2">
          <div className="flex items-center justify-between gap-2 text-[11px] text-amber-100/85">
            <div className="truncate font-medium">{props.character.name} · Lv {props.character.level} {props.character.className}</div>
            <div className="text-amber-100/70">{props.character.role}</div>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-emerald-100/80">HP</div>
              <div className="h-1.5 w-full rounded bg-black/35">
                <div className="h-full rounded bg-emerald-300" style={{ width: `${hpPct}%` }} />
              </div>
              <div className="mt-0.5 text-[10px] text-emerald-100/85">{Math.floor(props.character.hpCurrent)}/{Math.floor(props.character.hpMax)}</div>
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-sky-100/80">MP</div>
              <div className="h-1.5 w-full rounded bg-black/35">
                <div className="h-full rounded bg-sky-300" style={{ width: `${mpPct}%` }} />
              </div>
              <div className="mt-0.5 text-[10px] text-sky-100/85">{Math.floor(props.character.mpCurrent)}/{Math.floor(props.character.mpMax)}</div>
            </div>
          </div>

          <div className="mt-1.5 text-[10px] text-amber-100/75">Armor {props.character.armor} · {props.character.turnLabel}</div>
        </div>
      ) : null}

      {props.combatCoreActions.length > 0 ? (
        <div className="mt-2 rounded border border-red-200/25 bg-red-300/10 p-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-red-100/80">Core Actions</div>
          <div className="grid gap-1 sm:grid-cols-3">
            {props.combatCoreActions.map((action) => (
              <Button
                key={`hero-core-${action.id}`}
                size="sm"
                variant={action.usableNow ? "default" : "secondary"}
                disabled={!action.usableNow || props.isBusy}
                className="h-7 justify-between"
                onClick={() => props.onCoreAction(action.id, action.targeting)}
              >
                <span>{action.label}</span>
                <span className="ml-2 text-[10px] uppercase tracking-wide">
                  {action.usableNow ? "Use" : (action.reason ?? "Locked")}
                </span>
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { RightPanelHeroCharacter, RightPanelHeroWarning };
