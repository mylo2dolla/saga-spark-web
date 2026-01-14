/**
 * Enhanced status effect system with stacking, triggers, and stat modifiers.
 * Pure functions only - no mutations.
 */

import type { 
  EnhancedStatus, 
  StatusCategory, 
  StatusTrigger, 
  StatusTriggerEffect,
  StatModifiers,
  DamageType 
} from "./types";

// ============= Status Factory =============

let statusIdCounter = 0;

export function createStatus(params: {
  id?: string;
  name: string;
  description: string;
  icon?: string;
  category: StatusCategory;
  source: string;
  duration: number;
  stacks?: number;
  maxStacks?: number;
  stackBehavior?: "refresh" | "add" | "max";
  statModifiers?: StatModifiers;
  triggers?: StatusTriggerEffect[];
  immuneTo?: string[];
}): EnhancedStatus {
  return {
    id: params.id ?? `status_${++statusIdCounter}`,
    name: params.name,
    description: params.description,
    icon: params.icon,
    category: params.category,
    source: params.source,
    duration: params.duration,
    stacks: params.stacks ?? 1,
    maxStacks: params.maxStacks ?? 1,
    stackBehavior: params.stackBehavior ?? "refresh",
    statModifiers: params.statModifiers ?? {},
    triggers: params.triggers ?? [],
    immuneTo: params.immuneTo,
  };
}

// ============= Status Application =============

export function applyStatus(
  currentStatuses: readonly EnhancedStatus[],
  newStatus: EnhancedStatus
): { statuses: readonly EnhancedStatus[]; applied: boolean; message: string } {
  // Check immunity
  for (const status of currentStatuses) {
    if (status.immuneTo?.includes(newStatus.id)) {
      return {
        statuses: currentStatuses,
        applied: false,
        message: `Immune to ${newStatus.name} due to ${status.name}`,
      };
    }
  }

  const existingIndex = currentStatuses.findIndex(s => s.id === newStatus.id);
  
  if (existingIndex >= 0) {
    const existing = currentStatuses[existingIndex];
    let updated: EnhancedStatus;
    
    switch (newStatus.stackBehavior) {
      case "refresh":
        updated = { ...existing, duration: newStatus.duration };
        break;
      case "add":
        updated = {
          ...existing,
          stacks: Math.min(existing.stacks + newStatus.stacks, existing.maxStacks),
          duration: Math.max(existing.duration, newStatus.duration),
        };
        break;
      case "max":
        updated = {
          ...existing,
          stacks: existing.maxStacks,
          duration: Math.max(existing.duration, newStatus.duration),
        };
        break;
    }
    
    const newStatuses = [...currentStatuses];
    newStatuses[existingIndex] = updated;
    
    return {
      statuses: newStatuses,
      applied: true,
      message: `${newStatus.name} ${newStatus.stackBehavior === "refresh" ? "refreshed" : "stacked"} (${updated.stacks}x)`,
    };
  }

  return {
    statuses: [...currentStatuses, newStatus],
    applied: true,
    message: `${newStatus.name} applied`,
  };
}

export function removeStatus(
  statuses: readonly EnhancedStatus[],
  statusId: string
): readonly EnhancedStatus[] {
  return statuses.filter(s => s.id !== statusId);
}

export function removeStatusBySource(
  statuses: readonly EnhancedStatus[],
  source: string
): readonly EnhancedStatus[] {
  return statuses.filter(s => s.source !== source);
}

// ============= Status Tick & Triggers =============

export interface StatusTickResult {
  statuses: readonly EnhancedStatus[];
  damage: number;
  damageType?: DamageType;
  healing: number;
  appliedStatuses: string[];
  removedStatuses: string[];
  preventAction: boolean;
  messages: string[];
}

export function tickStatuses(
  statuses: readonly EnhancedStatus[],
  trigger: StatusTrigger
): StatusTickResult {
  let totalDamage = 0;
  let damageType: DamageType | undefined;
  let totalHealing = 0;
  let preventAction = false;
  const appliedStatuses: string[] = [];
  const removedStatuses: string[] = [];
  const messages: string[] = [];
  
  const newStatuses: EnhancedStatus[] = [];
  
  for (const status of statuses) {
    // Process triggers
    for (const triggerEffect of status.triggers) {
      if (triggerEffect.trigger === trigger) {
        if (triggerEffect.damage) {
          const dmg = triggerEffect.damage + (triggerEffect.damagePerStack ?? 0) * (status.stacks - 1);
          totalDamage += dmg;
          damageType = triggerEffect.damageType;
          messages.push(`${status.name} deals ${dmg} damage`);
        }
        if (triggerEffect.healing) {
          const heal = triggerEffect.healing + (triggerEffect.healingPerStack ?? 0) * (status.stacks - 1);
          totalHealing += heal;
          messages.push(`${status.name} heals ${heal}`);
        }
        if (triggerEffect.applyStatus) {
          appliedStatuses.push(triggerEffect.applyStatus);
        }
        if (triggerEffect.removeStatus) {
          removedStatuses.push(triggerEffect.removeStatus);
        }
        if (triggerEffect.preventAction) {
          preventAction = true;
          messages.push(`Stunned by ${status.name}!`);
        }
      }
    }
    
    // Handle duration on turn_start or turn_end
    if (trigger === "on_turn_start" || trigger === "on_turn_end") {
      if (status.duration > 0) {
        if (status.duration === 1) {
          messages.push(`${status.name} expired`);
          removedStatuses.push(status.id);
        } else {
          newStatuses.push({ ...status, duration: status.duration - 1 });
        }
      } else if (status.duration === -1) {
        // Permanent status
        newStatuses.push(status);
      }
    } else {
      newStatuses.push(status);
    }
  }
  
  // Filter out removed statuses
  const finalStatuses = newStatuses.filter(s => !removedStatuses.includes(s.id));
  
  return {
    statuses: finalStatuses,
    damage: totalDamage,
    damageType,
    healing: totalHealing,
    appliedStatuses,
    removedStatuses,
    preventAction,
    messages,
  };
}

// ============= Stat Calculation from Statuses =============

export function calculateStatusStats(statuses: readonly EnhancedStatus[]): StatModifiers {
  const result: StatModifiers = {};
  const keys: (keyof StatModifiers)[] = [
    "strength", "dexterity", "constitution", "intelligence",
    "wisdom", "charisma", "maxHp", "ac", "attackBonus",
    "damageBonus", "speed", "initiative"
  ];

  for (const status of statuses) {
    const multiplier = status.stacks;
    for (const key of keys) {
      const mod = status.statModifiers[key];
      if (mod !== undefined) {
        (result as Record<string, number>)[key] = 
          ((result as Record<string, number>)[key] ?? 0) + mod * multiplier;
      }
    }
  }

  return result;
}

export function hasStatusCategory(
  statuses: readonly EnhancedStatus[], 
  category: StatusCategory
): boolean {
  return statuses.some(s => s.category === category);
}

export function getStatusesByCategory(
  statuses: readonly EnhancedStatus[],
  category: StatusCategory
): readonly EnhancedStatus[] {
  return statuses.filter(s => s.category === category);
}

// ============= Common Status Templates =============

export function createPoison(source: string, damage: number, duration: number): EnhancedStatus {
  return createStatus({
    id: "poison",
    name: "Poison",
    description: "Taking damage over time from poison",
    icon: "☠️",
    category: "debuff",
    source,
    duration,
    maxStacks: 5,
    stackBehavior: "add",
    triggers: [{
      trigger: "on_turn_start",
      damage,
      damagePerStack: damage,
      damageType: "poison",
    }],
  });
}

export function createBurning(source: string, damage: number, duration: number): EnhancedStatus {
  return createStatus({
    id: "burning",
    name: "Burning",
    description: "Taking fire damage over time",
    icon: "🔥",
    category: "debuff",
    source,
    duration,
    maxStacks: 3,
    stackBehavior: "add",
    triggers: [{
      trigger: "on_turn_start",
      damage,
      damagePerStack: Math.floor(damage / 2),
      damageType: "fire",
    }],
  });
}

export function createBleed(source: string, damage: number, duration: number): EnhancedStatus {
  return createStatus({
    id: "bleed",
    name: "Bleeding",
    description: "Losing blood and taking damage on movement",
    icon: "🩸",
    category: "debuff",
    source,
    duration,
    maxStacks: 10,
    stackBehavior: "add",
    triggers: [{
      trigger: "on_move",
      damage,
      damagePerStack: 1,
      damageType: "physical",
    }],
  });
}

export function createStun(source: string, duration: number): EnhancedStatus {
  return createStatus({
    id: "stun",
    name: "Stunned",
    description: "Cannot take actions",
    icon: "💫",
    category: "debuff",
    source,
    duration,
    maxStacks: 1,
    stackBehavior: "refresh",
    triggers: [{
      trigger: "on_turn_start",
      preventAction: true,
    }],
  });
}

export function createHaste(source: string, duration: number): EnhancedStatus {
  return createStatus({
    id: "haste",
    name: "Haste",
    description: "Moving faster than normal",
    icon: "⚡",
    category: "buff",
    source,
    duration,
    statModifiers: { speed: 2, initiative: 5 },
  });
}

export function createShield(source: string, acBonus: number, duration: number): EnhancedStatus {
  return createStatus({
    id: "shield",
    name: "Shield",
    description: "Protected by a magical barrier",
    icon: "🛡️",
    category: "buff",
    source,
    duration,
    statModifiers: { ac: acBonus },
  });
}

export function createStrength(source: string, bonus: number, duration: number): EnhancedStatus {
  return createStatus({
    id: "strength_buff",
    name: "Strength",
    description: "Enhanced physical power",
    icon: "💪",
    category: "buff",
    source,
    duration,
    maxStacks: 3,
    stackBehavior: "add",
    statModifiers: { strength: bonus, damageBonus: Math.floor(bonus / 2) },
  });
}

export function createRegeneration(source: string, healing: number, duration: number): EnhancedStatus {
  return createStatus({
    id: "regeneration",
    name: "Regeneration",
    description: "Healing over time",
    icon: "💚",
    category: "buff",
    source,
    duration,
    triggers: [{
      trigger: "on_turn_start",
      healing,
    }],
  });
}
