import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  CharacterProfileDraft,
  CharacterSheetSaveState,
  CharacterSheetSection,
  CharacterSheetViewModel,
} from "@/ui/components/mythic/character2/types";

interface CharacterSheetSectionsProps {
  model: CharacterSheetViewModel;
  section: CharacterSheetSection;
  onSectionChange: (section: CharacterSheetSection) => void;
  draft: CharacterProfileDraft;
  onDraftChange: (next: CharacterProfileDraft) => void;
  saveState: CharacterSheetSaveState;
}

function saveStatusLabel(state: CharacterSheetSaveState): string {
  if (state.isSaving) return "Saving...";
  if (state.error) return state.error;
  if (state.lastSavedAt) {
    return `Saved ${new Date(state.lastSavedAt).toLocaleTimeString()}`;
  }
  if (state.isDirty) return "Unsaved changes";
  return "Autosave active";
}

function gaugePercent(current: number, max: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

export function CharacterSheetSections(props: CharacterSheetSectionsProps) {
  const statusTone = props.saveState.error
    ? "text-red-200"
    : props.saveState.isSaving || props.saveState.isDirty
      ? "text-amber-200"
      : "text-emerald-200";

  return (
    <Tabs value={props.section} onValueChange={(value) => props.onSectionChange(value as CharacterSheetSection)}>
      <TabsList className="w-full justify-start overflow-auto bg-amber-100/10 text-amber-100/75">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="combat">Combat</TabsTrigger>
        <TabsTrigger value="skills">Skills</TabsTrigger>
        <TabsTrigger value="companions">Companions</TabsTrigger>
        <TabsTrigger value="quests">Quests</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-3">
        <div className="rounded-lg border border-amber-200/25 bg-amber-100/5 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-amber-100">Identity</div>
            <div className={`text-xs ${statusTone}`}>{saveStatusLabel(props.saveState)}</div>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <label className="space-y-1 text-xs text-amber-100/80">
              <span>Name</span>
              <Input
                value={props.draft.name}
                onChange={(event) => props.onDraftChange({ ...props.draft, name: event.target.value })}
                className="h-9 border-amber-200/25 bg-background/30"
                maxLength={80}
              />
            </label>
            <label className="space-y-1 text-xs text-amber-100/80">
              <span>Callsign</span>
              <Input
                value={props.draft.callsign}
                onChange={(event) => props.onDraftChange({ ...props.draft, callsign: event.target.value })}
                className="h-9 border-amber-200/25 bg-background/30"
                maxLength={48}
              />
            </label>
            <label className="space-y-1 text-xs text-amber-100/80">
              <span>Pronouns</span>
              <Input
                value={props.draft.pronouns}
                onChange={(event) => props.onDraftChange({ ...props.draft, pronouns: event.target.value })}
                className="h-9 border-amber-200/25 bg-background/30"
                maxLength={48}
              />
            </label>
            <div className="rounded border border-amber-200/20 bg-background/20 p-2 text-xs text-amber-100/80">
              <div>Level {props.model.level}</div>
              <div>XP {props.model.xp} / next {props.model.xpToNext}</div>
              <div>Unspent points {props.model.unspentPoints}</div>
              <div>Coins {props.model.coins}</div>
            </div>
          </div>

          <label className="mt-2 block space-y-1 text-xs text-amber-100/80">
            <span>Origin Note</span>
            <Textarea
              value={props.draft.originNote}
              onChange={(event) => props.onDraftChange({ ...props.draft, originNote: event.target.value })}
              className="min-h-[90px] border-amber-200/25 bg-background/30"
              maxLength={220}
            />
          </label>
        </div>

        <div className="rounded-lg border border-amber-200/25 bg-amber-100/5 p-3">
          <div className="mb-2 text-sm font-semibold text-amber-100">Ability Lenses (D&D-style)</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {props.model.statLenses.map((stat) => (
              <div key={stat.id} className="rounded border border-amber-200/20 bg-background/20 p-2 text-xs text-amber-100/80">
                <div className="text-[11px] uppercase tracking-wide text-amber-100/70">{stat.dndLabel}</div>
                <div className="font-semibold text-amber-100">{stat.mythicLabel}</div>
                <div>Value {stat.value}</div>
                <div>Modifier {stat.modifier >= 0 ? `+${stat.modifier}` : stat.modifier}</div>
              </div>
            ))}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="combat" className="space-y-3">
        <div className="rounded-lg border border-red-200/25 bg-red-300/5 p-3">
          <div className="mb-2 text-sm font-semibold text-red-100">Combat Readiness</div>
          <div className="mb-2 text-xs text-red-100/80">
            Status {props.model.combat.status} · {props.model.combat.playerTurnLabel}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded border border-emerald-200/30 bg-emerald-400/10 p-2 text-xs text-emerald-100">
              <div className="mb-1">HP</div>
              <div className="h-1.5 w-full rounded bg-black/35">
                <div className="h-full rounded bg-emerald-300" style={{ width: `${gaugePercent(props.model.hpGauge.current, props.model.hpGauge.max)}%` }} />
              </div>
              <div className="mt-1">{props.model.hpGauge.current}/{props.model.hpGauge.max}</div>
            </div>
            <div className="rounded border border-sky-200/30 bg-sky-400/10 p-2 text-xs text-sky-100">
              <div className="mb-1">MP</div>
              <div className="h-1.5 w-full rounded bg-black/35">
                <div className="h-full rounded bg-sky-300" style={{ width: `${gaugePercent(props.model.mpGauge.current, props.model.mpGauge.max)}%` }} />
              </div>
              <div className="mt-1">{props.model.mpGauge.current}/{props.model.mpGauge.max}</div>
            </div>
          </div>
          <div className="mt-2 grid gap-2 text-xs text-red-100/80 sm:grid-cols-2">
            <div>Armor {props.model.combat.armor}</div>
            <div>Allies {props.model.combat.allyCount} · Enemies {props.model.combat.enemyCount}</div>
            <div>Focused target {props.model.combat.focusedTargetName ?? "none"}</div>
            <div>Mode {props.model.boardMode}</div>
          </div>
        </div>

        <div className="rounded-lg border border-amber-200/25 bg-amber-100/5 p-3">
          <div className="mb-2 text-sm font-semibold text-amber-100">Quick Skill Read</div>
          {props.model.equippedSkills.length === 0 ? (
            <div className="text-xs text-amber-100/70">No equipped combat skills available.</div>
          ) : (
            <div className="space-y-2">
              {props.model.equippedSkills.slice(0, 6).map((skill) => (
                <div key={skill.id} className="rounded border border-amber-200/20 bg-background/20 p-2 text-xs text-amber-100/80">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-amber-100">{skill.name}</div>
                    <div className={skill.usableNow ? "text-emerald-200" : "text-amber-200"}>
                      {skill.usableNow ? "Ready" : (skill.reason ?? "Locked")}
                    </div>
                  </div>
                  <div>{skill.targeting} · range {skill.rangeTiles} · cooldown {skill.cooldownTurns}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="skills" className="space-y-3">
        <div className="rounded-lg border border-amber-200/25 bg-amber-100/5 p-3">
          <div className="mb-2 text-sm font-semibold text-amber-100">Equipped Abilities</div>
          {props.model.equippedSkills.length === 0 ? (
            <div className="text-xs text-amber-100/70">No equipped abilities.</div>
          ) : (
            <div className="space-y-2">
              {props.model.equippedSkills.map((skill) => (
                <div key={skill.id} className="rounded border border-amber-200/20 bg-background/20 p-2 text-xs text-amber-100/80">
                  <div className="font-medium text-amber-100">{skill.name}</div>
                  <div>{skill.kind} · {skill.targeting} · range {skill.rangeTiles} · cooldown {skill.cooldownTurns}</div>
                  {skill.description ? <div className="mt-1 text-amber-100/70">{skill.description}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-amber-200/25 bg-amber-100/5 p-3">
          <div className="mb-2 text-sm font-semibold text-amber-100">Passive Skills</div>
          {props.model.passiveSkills.length === 0 ? (
            <div className="text-xs text-amber-100/70">No passive skills recorded.</div>
          ) : (
            <div className="space-y-2">
              {props.model.passiveSkills.map((skill) => (
                <div key={skill.id} className="rounded border border-amber-200/20 bg-background/20 p-2 text-xs text-amber-100/80">
                  <div className="font-medium text-amber-100">{skill.name}</div>
                  <div>{skill.kind}</div>
                  {skill.description ? <div className="mt-1 text-amber-100/70">{skill.description}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="companions" className="space-y-3">
        <div className="rounded-lg border border-fuchsia-200/25 bg-fuchsia-300/5 p-3">
          <div className="mb-2 text-sm font-semibold text-fuchsia-100">Companion Activity</div>
          {props.model.companionNotes.length === 0 ? (
            <div className="text-xs text-fuchsia-100/70">No companion check-ins yet.</div>
          ) : (
            <div className="space-y-2">
              {props.model.companionNotes.map((entry) => (
                <div key={entry.id} className="rounded border border-fuchsia-200/20 bg-background/20 p-2 text-xs text-fuchsia-100/80">
                  <div className="font-medium text-fuchsia-100">{entry.companionId}</div>
                  <div className="mt-1">{entry.line}</div>
                  <div className="mt-1 text-[11px]">Mood {entry.mood} · Urgency {entry.urgency} · Hook {entry.hookType}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="quests" className="space-y-3">
        <div className="rounded-lg border border-sky-200/25 bg-sky-300/5 p-3">
          <div className="mb-2 text-sm font-semibold text-sky-100">Quest and World Threads</div>
          {props.model.questThreads.length === 0 ? (
            <div className="text-xs text-sky-100/70">No persistent threads yet.</div>
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
              {props.model.questThreads.map((thread) => (
                <div key={thread.id} className="rounded border border-sky-200/20 bg-background/20 p-2 text-xs text-sky-100/80">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sky-100">{thread.title}</div>
                    <div className="text-[10px] uppercase tracking-wide">{thread.source}</div>
                  </div>
                  {thread.detail ? <div className="mt-1">{thread.detail}</div> : null}
                  <div className="mt-1 text-[10px]">
                    Severity {thread.severity} · {new Date(thread.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
