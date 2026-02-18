import type { MythicActionEventRow, MythicCombatantRow } from "@/hooks/useMythicCombatState";

function asObj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function buildCombatCallouts(args: {
  events: MythicActionEventRow[];
  combatants: MythicCombatantRow[];
  limit?: number;
}): string[] {
  const byId = new Map(args.combatants.map((c) => [c.id, c.name] as const));
  const lines: string[] = [];

  for (const e of args.events) {
    const line = calloutForEvent(e, byId);
    if (!line) continue;
    lines.push(line);
  }

  const limit = Math.max(5, Math.min(50, Math.floor(args.limit ?? 16)));
  return lines.slice(-limit);
}

function calloutForEvent(e: MythicActionEventRow, nameById: Map<string, string>): string | null {
  const p = asObj(e.payload);

  if (e.event_type === "skill_used") {
    const actor = e.actor_combatant_id ? nameById.get(String(e.actor_combatant_id)) : null;
    const skillName = typeof p.skill_name === "string" ? p.skill_name : (typeof p.skill_id === "string" ? p.skill_id : "a skill");
    if (!actor) return `A combatant uses ${skillName}.`;
    return `${actor} uses ${skillName}.`;
  }

  if (e.event_type === "damage") {
    const srcId = String(p.source_combatant_id ?? "");
    const tgtId = String(p.target_combatant_id ?? "");
    const src = nameById.get(srcId) ?? "Someone";
    const tgt = nameById.get(tgtId) ?? "someone";
    const dmg = Math.max(0, Math.floor(num(p.damage_to_hp, 0)));
    if (dmg <= 0) return `${src} hits ${tgt}.`;
    return `${src} hits ${tgt} for ${dmg}.`;
  }

  if (e.event_type === "healed") {
    const tgtId = String(p.target_combatant_id ?? "");
    const tgt = nameById.get(tgtId) ?? "Someone";
    const amt = Math.max(0, Math.floor(num(p.amount, 0)));
    return amt > 0 ? `${tgt} heals ${amt}.` : `${tgt} recovers.`;
  }

  if (e.event_type === "status_applied") {
    const tgtId = String(p.target_combatant_id ?? "");
    const tgt = nameById.get(tgtId) ?? "Someone";
    const status = asObj(p.status);
    const statusId = typeof status.id === "string" ? status.id : "a status";
    return `${tgt} gains ${statusId}.`;
  }

  if (e.event_type === "moved") {
    const actor = e.actor_combatant_id ? nameById.get(String(e.actor_combatant_id)) : null;
    const forced = typeof p.forced === "string" ? ` (${p.forced})` : "";
    if (!actor && typeof p.target_combatant_id === "string") {
      const t = nameById.get(p.target_combatant_id) ?? "Someone";
      return `${t} is moved${forced}.`;
    }
    if (!actor) return null;
    return `${actor} moves${forced}.`;
  }

  if (e.event_type === "death") {
    const tgtId = String(p.target_combatant_id ?? "");
    const tgt = nameById.get(tgtId) ?? "A foe";
    return `${tgt} collapses into static.`;
  }

  return null;
}

