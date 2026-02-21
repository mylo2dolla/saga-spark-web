import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CharacterCompanionSummary,
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
  equipmentBusy: boolean;
  equipmentError: string | null;
  onEquipItem: (inventoryId: string) => void;
  onUnequipItem: (inventoryId: string) => void;
  partyBusy: boolean;
  partyError: string | null;
  onIssueCompanionCommand: (payload: {
    companionId: string;
    stance: "aggressive" | "balanced" | "defensive";
    directive: "focus" | "protect" | "harry" | "hold";
    targetHint?: string;
  }) => void;
}

type CompanionDraft = {
  stance: "aggressive" | "balanced" | "defensive";
  directive: "focus" | "protect" | "harry" | "hold";
  targetHint: string;
};

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

function fmtStatMods(mods: Record<string, number>): string {
  const pairs = Object.entries(mods);
  if (pairs.length === 0) return "No stat mods";
  return pairs
    .map(([key, value]) => `${key} ${value >= 0 ? `+${value}` : `${value}`}`)
    .join(" · ");
}

function slotLabel(slot: string): string {
  return slot.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function companionDefaultDraft(entry: CharacterCompanionSummary): CompanionDraft {
  return {
    stance: entry.stance,
    directive: entry.directive,
    targetHint: entry.targetHint ?? "",
  };
}

export function CharacterSheetSections(props: CharacterSheetSectionsProps) {
  const statusTone = props.saveState.error
    ? "text-red-200"
    : props.saveState.isSaving || props.saveState.isDirty
      ? "text-amber-200"
      : "text-emerald-200";

  const [companionDrafts, setCompanionDrafts] = useState<Record<string, CompanionDraft>>({});

  const companionDefaults = useMemo(
    () => Object.fromEntries(props.model.companionNotes.map((entry) => [entry.companionId, companionDefaultDraft(entry)])),
    [props.model.companionNotes],
  );

  useEffect(() => {
    setCompanionDrafts((prev) => {
      const next: Record<string, CompanionDraft> = { ...prev };
      for (const [companionId, draft] of Object.entries(companionDefaults)) {
        if (!next[companionId]) next[companionId] = draft;
      }
      return next;
    });
  }, [companionDefaults]);

  return (
    <Tabs value={props.section} onValueChange={(value) => props.onSectionChange(value as CharacterSheetSection)}>
      <TabsList className="w-full justify-start overflow-auto bg-amber-100/10 text-amber-100/75">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="combat">Combat</TabsTrigger>
        <TabsTrigger value="skills">Skills</TabsTrigger>
        <TabsTrigger value="equipment">Equipment</TabsTrigger>
        <TabsTrigger value="party">Party</TabsTrigger>
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
                {props.model.lastCombatReward ? (
                  <div className="mt-1 text-[11px] text-amber-100/75">
                    Last combat: {props.model.lastCombatReward.victory ? "Victory" : "Defeat"} ·
                    {" "}+{props.model.lastCombatReward.xpGained} XP
                    {props.model.lastCombatReward.loot.length > 0 ? ` · ${props.model.lastCombatReward.loot.join(", ")}` : ""}
                  </div>
                ) : null}
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
          {props.model.lastCombatReward ? (
            <div className="mt-2 rounded border border-red-200/25 bg-black/20 p-2 text-xs text-red-100/85">
              <div className="font-medium">
                {props.model.lastCombatReward.victory ? "Last Combat Victory" : "Last Combat Result"}
              </div>
              <div className="mt-1">
                XP +{props.model.lastCombatReward.xpGained}
                {props.model.lastCombatReward.loot.length > 0 ? ` · Loot: ${props.model.lastCombatReward.loot.join(", ")}` : ""}
              </div>
              <div className="mt-1 text-[11px] text-red-100/70">
                {new Date(props.model.lastCombatReward.endedAt).toLocaleString()}
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-amber-200/25 bg-amber-100/5 p-3">
          <div className="mb-2 text-sm font-semibold text-amber-100">Combat Castables</div>
          {props.model.combatSkills.length === 0 ? (
            <div className="text-xs text-amber-100/70">No combat skills available.</div>
          ) : (
            <div className="space-y-2">
              {props.model.combatSkills.slice(0, 8).map((skill) => (
                <div key={skill.id} className="rounded border border-amber-200/20 bg-background/20 p-2 text-xs text-amber-100/80">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-amber-100">{skill.name}</div>
                    <div className={skill.usableNow ? "text-emerald-200" : "text-amber-200"}>
                      {skill.usableNow ? "Ready" : (skill.reason ?? "Locked")}
                    </div>
                  </div>
                  <div>
                    MP {skill.mpCost} · {skill.targeting} · range {skill.rangeTiles} · cooldown {skill.cooldownTurns}
                    {skill.cooldownRemaining > 0 ? ` (${skill.cooldownRemaining} remaining)` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="skills" className="space-y-3">
        <div className="rounded-lg border border-amber-200/25 bg-amber-100/5 p-3">
          <div className="mb-2 text-sm font-semibold text-amber-100">Active + Ultimate Skills</div>
          {props.model.combatSkills.length === 0 ? (
            <div className="text-xs text-amber-100/70">No active skills recorded.</div>
          ) : (
            <div className="space-y-2">
              {props.model.combatSkills.map((skill) => (
                <div key={skill.id} className="rounded border border-amber-200/20 bg-background/20 p-2 text-xs text-amber-100/80">
                  <div className="font-medium text-amber-100">{skill.name}</div>
                  <div>
                    {skill.kind} · MP {skill.mpCost} · {skill.targeting} · range {skill.rangeTiles} · cooldown {skill.cooldownTurns}
                    {skill.cooldownRemaining > 0 ? ` (${skill.cooldownRemaining} remaining)` : ""}
                  </div>
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

      <TabsContent value="equipment" className="space-y-3">
        <div className="rounded-lg border border-amber-200/25 bg-amber-100/5 p-3">
          <div className="mb-2 text-sm font-semibold text-amber-100">Equipped Totals</div>
          {Object.keys(props.model.equipmentTotals).length === 0 ? (
            <div className="text-xs text-amber-100/70">No active equipment bonuses.</div>
          ) : (
            <div className="flex flex-wrap gap-2 text-xs text-amber-100/80">
              {Object.entries(props.model.equipmentTotals).map(([key, value]) => (
                <span key={`equipment-total-${key}`} className="rounded border border-amber-200/20 bg-background/20 px-2 py-1">
                  {key}: {value >= 0 ? `+${value}` : value}
                </span>
              ))}
            </div>
          )}
          {props.equipmentError ? <div className="mt-2 text-xs text-red-200">{props.equipmentError}</div> : null}
        </div>

        <div className="space-y-2">
          {props.model.equipmentSlots.length === 0 ? (
            <div className="rounded-lg border border-amber-200/25 bg-amber-100/5 p-3 text-xs text-amber-100/70">
              No equipment inventory is available for this character.
            </div>
          ) : props.model.equipmentSlots.map((slot) => (
            <div key={`equipment-slot-${slot.slot}`} className="rounded-lg border border-amber-200/25 bg-amber-100/5 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-100/75">{slotLabel(slot.slot)}</div>
              <div className="space-y-2">
                {slot.equippedItems.length === 0 ? (
                  <div className="rounded border border-amber-200/20 bg-background/20 p-2 text-xs text-amber-100/70">No equipped item.</div>
                ) : slot.equippedItems.map((item) => (
                  <div key={item.inventoryId} className="rounded border border-emerald-200/30 bg-emerald-500/10 p-2 text-xs text-emerald-100">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{item.name}</div>
                      <div className="text-[10px] uppercase tracking-wide">equipped</div>
                    </div>
                    <div className="mt-1 text-emerald-100/80">{item.rarity} · {fmtStatMods(item.statMods)}</div>
                    {item.grantedAbilities.length > 0 ? (
                      <div className="mt-1 text-[11px] text-emerald-100/80">Abilities: {item.grantedAbilities.join(", ")}</div>
                    ) : null}
                    <div className="mt-2">
                      <Button size="sm" variant="secondary" disabled={props.equipmentBusy} onClick={() => props.onUnequipItem(item.inventoryId)}>
                        Unequip
                      </Button>
                    </div>
                  </div>
                ))}

                {slot.backpackItems.map((item) => (
                  <div key={item.inventoryId} className="rounded border border-amber-200/20 bg-background/20 p-2 text-xs text-amber-100/80">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-amber-100">{item.name}</div>
                      <div className="text-[10px] uppercase tracking-wide">{item.rarity}</div>
                    </div>
                    <div className="mt-1">{fmtStatMods(item.statMods)}</div>
                    {Object.keys(item.deltaMods).length > 0 ? (
                      <div className="mt-1 text-[11px]">
                        Delta: {Object.entries(item.deltaMods).map(([key, value]) => `${key} ${value >= 0 ? `+${value}` : value}`).join(" · ")}
                      </div>
                    ) : null}
                    <div className="mt-2">
                      <Button size="sm" disabled={props.equipmentBusy} onClick={() => props.onEquipItem(item.inventoryId)}>
                        Equip
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="party" className="space-y-3">
        <div className="rounded-lg border border-fuchsia-200/25 bg-fuchsia-300/5 p-3">
          <div className="mb-2 text-sm font-semibold text-fuchsia-100">Companion Roster + Commands</div>
          {props.partyError ? <div className="mb-2 text-xs text-red-200">{props.partyError}</div> : null}
          {props.model.companionNotes.length === 0 ? (
            <div className="text-xs text-fuchsia-100/70">No companion roster is currently active.</div>
          ) : (
            <div className="space-y-2">
              {props.model.companionNotes.map((entry) => {
                const draft = companionDrafts[entry.companionId] ?? companionDefaultDraft(entry);
                return (
                  <div key={entry.id} className="rounded border border-fuchsia-200/20 bg-background/20 p-2 text-xs text-fuchsia-100/80">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-fuchsia-100">{entry.name || entry.companionId}</div>
                      <div className="text-[11px]">{entry.archetype}</div>
                    </div>
                    <div className="mt-1">{entry.line}</div>
                    <div className="mt-1 text-[11px]">Mood {entry.mood} · Urgency {entry.urgency}</div>

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-fuchsia-100/70">Stance</div>
                        <Select
                          value={draft.stance}
                          onValueChange={(value) => {
                            if (value !== "aggressive" && value !== "balanced" && value !== "defensive") return;
                            setCompanionDrafts((prev) => ({
                              ...prev,
                              [entry.companionId]: { ...draft, stance: value },
                            }));
                          }}
                        >
                          <SelectTrigger className="h-8 border-fuchsia-200/20 bg-background/30 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="aggressive">Aggressive</SelectItem>
                            <SelectItem value="balanced">Balanced</SelectItem>
                            <SelectItem value="defensive">Defensive</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-fuchsia-100/70">Directive</div>
                        <Select
                          value={draft.directive}
                          onValueChange={(value) => {
                            if (value !== "focus" && value !== "protect" && value !== "harry" && value !== "hold") return;
                            setCompanionDrafts((prev) => ({
                              ...prev,
                              [entry.companionId]: { ...draft, directive: value },
                            }));
                          }}
                        >
                          <SelectTrigger className="h-8 border-fuchsia-200/20 bg-background/30 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="focus">Focus</SelectItem>
                            <SelectItem value="protect">Protect</SelectItem>
                            <SelectItem value="harry">Harry</SelectItem>
                            <SelectItem value="hold">Hold</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="mt-2">
                      <Input
                        value={draft.targetHint}
                        onChange={(event) => {
                          const value = event.target.value;
                          setCompanionDrafts((prev) => ({
                            ...prev,
                            [entry.companionId]: { ...draft, targetHint: value },
                          }));
                        }}
                        maxLength={80}
                        className="h-8 border-fuchsia-200/20 bg-background/30 text-xs"
                        placeholder="Target hint (optional)"
                      />
                    </div>

                    <div className="mt-2">
                      <Button
                        size="sm"
                        disabled={props.partyBusy}
                        onClick={() => props.onIssueCompanionCommand({
                          companionId: entry.companionId,
                          stance: draft.stance,
                          directive: draft.directive,
                          targetHint: draft.targetHint.trim() || undefined,
                        })}
                      >
                        Issue Command
                      </Button>
                    </div>
                  </div>
                );
              })}
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
