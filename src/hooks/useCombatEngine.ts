import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { DiceRoller3DRef, DiceType } from "@/components/combat/DiceRoller3D";
import type { Character } from "@/components/combat/CombatMiniature";
import type { Ability } from "@/components/combat/AbilityBar";

// Combat event types that the DM will narrate
export type CombatEventType = 
  | "combat_start" 
  | "turn_start" 
  | "attack" 
  | "spell" 
  | "damage" 
  | "heal" 
  | "miss" 
  | "critical" 
  | "fumble" 
  | "death" 
  | "combat_end";

export interface DiceRollResult {
  id: string;
  type: DiceType;
  result: number;
  modifier: number;
  total: number;
  isCritical: boolean;
  isFumble: boolean;
  label?: string;
}

export interface CombatEvent {
  id: string;
  type: CombatEventType;
  timestamp: Date;
  actor?: string;
  target?: string;
  ability?: string;
  rolls?: DiceRollResult[];
  damage?: number;
  damageType?: string;
  healing?: number;
  success?: boolean;
  description?: string;
}

export interface CombatAction {
  type: "attack" | "spell" | "defense" | "heal" | "utility" | "move";
  actorId: string;
  targetId?: string;
  ability?: Ability;
  targetPosition?: { x: number; y: number };
}

interface CombatEngineState {
  isProcessing: boolean;
  pendingEvents: CombatEvent[];
  lastEvent: CombatEvent | null;
}

interface UseCombatEngineProps {
  characters: Character[];
  onCharacterUpdate: (characterId: string, updates: Partial<Character>) => void;
  onEnemyUpdate: (enemyId: string, updates: Partial<Character>) => void;
  onCombatEvent: (event: CombatEvent) => void;
}

export function useCombatEngine({
  characters,
  onCharacterUpdate,
  onEnemyUpdate,
  onCombatEvent,
}: UseCombatEngineProps) {
  const [state, setState] = useState<CombatEngineState>({
    isProcessing: false,
    pendingEvents: [],
    lastEvent: null,
  });

  const diceRollerRef = useRef<DiceRoller3DRef>(null);

  // Bind the dice roller ref
  const bindDiceRoller = useCallback((ref: DiceRoller3DRef | null) => {
    if (ref) {
      (diceRollerRef as React.MutableRefObject<DiceRoller3DRef | null>).current = ref;
    }
  }, []);

  // Calculate modifier from ability score
  const getAbilityModifier = (score: number): number => {
    return Math.floor((score - 10) / 2);
  };

  // Get character by ID
  const getCharacter = useCallback((id: string): Character | undefined => {
    return characters.find(c => c.id === id);
  }, [characters]);

  // Roll dice using the 3D physics roller
  const rollDice = useCallback(async (
    diceType: DiceType,
    count: number = 1,
    modifier: number = 0,
    label?: string
  ): Promise<DiceRollResult[]> => {
    if (!diceRollerRef.current) {
      // Fallback to simple random if no dice roller is bound
      const results: DiceRollResult[] = [];
      const max = parseInt(diceType.slice(1));
      
      for (let i = 0; i < count; i++) {
        const result = Math.floor(Math.random() * max) + 1;
        results.push({
          id: `roll-${Date.now()}-${i}`,
          type: diceType,
          result,
          modifier: i === 0 ? modifier : 0,
          total: result + (i === 0 ? modifier : 0),
          isCritical: result === max,
          isFumble: result === 1,
          label,
        });
      }
      return results;
    }

    // Use the 3D dice roller
    const rolls = await diceRollerRef.current.roll([
      { type: diceType, count, modifier, label }
    ]);

    return rolls.map((r, i) => ({
      id: r.id,
      type: r.type,
      result: r.result,
      modifier: r.modifier || 0,
      total: r.result + (r.modifier || 0),
      isCritical: r.isCritical,
      isFumble: r.isFumble,
      label: r.label,
    }));
  }, []);

  // Create a combat event
  const createEvent = useCallback((
    type: CombatEventType,
    data: Partial<CombatEvent> = {}
  ): CombatEvent => {
    return {
      id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      timestamp: new Date(),
      ...data,
    };
  }, []);

  // Process an attack action
  const processAttack = useCallback(async (
    action: CombatAction
  ): Promise<CombatEvent[]> => {
    const events: CombatEvent[] = [];
    const actor = getCharacter(action.actorId);
    const target = action.targetId ? getCharacter(action.targetId) : undefined;

    if (!actor || !target) {
      toast.error("Invalid attack target");
      return events;
    }

    // Calculate attack modifier (simplified: level + base)
    const attackModifier = actor.level + 2;
    
    // Roll attack
    const attackRolls = await rollDice("d20", 1, attackModifier, `${actor.name} attacks ${target.name}`);
    const attackRoll = attackRolls[0];
    
    // Determine hit
    const isHit = attackRoll.isCritical || (!attackRoll.isFumble && attackRoll.total >= target.ac);
    
    if (attackRoll.isCritical) {
      // Critical hit - roll damage twice
      const damageType = action.ability?.damage?.split("d")[1]?.match(/\d+/)?.[0] || "6";
      const damageDice = (action.ability?.damage?.match(/(\d+)d/) || ["", "1"])[1];
      const damageRolls = await rollDice(
        `d${damageType}` as DiceType, 
        parseInt(damageDice) * 2, 
        actor.level,
        "Critical damage!"
      );
      const totalDamage = damageRolls.reduce((sum, r) => sum + r.result, 0) + actor.level;
      
      events.push(createEvent("critical", {
        actor: actor.name,
        target: target.name,
        ability: action.ability?.name || "Attack",
        rolls: [attackRoll, ...damageRolls],
        damage: totalDamage,
        success: true,
        description: `${actor.name} lands a devastating critical hit on ${target.name}!`,
      }));

      // Apply damage
      const newHp = Math.max(0, target.hp - totalDamage);
      if (target.isEnemy) {
        onEnemyUpdate(target.id, { hp: newHp });
      } else {
        onCharacterUpdate(target.id, { hp: newHp });
      }

      events.push(createEvent("damage", {
        target: target.name,
        damage: totalDamage,
        description: `${target.name} takes ${totalDamage} damage!`,
      }));

      // Check for death
      if (newHp <= 0) {
        events.push(createEvent("death", {
          target: target.name,
          description: `${target.name} falls!`,
        }));
      }
    } else if (attackRoll.isFumble) {
      events.push(createEvent("fumble", {
        actor: actor.name,
        target: target.name,
        ability: action.ability?.name || "Attack",
        rolls: [attackRoll],
        success: false,
        description: `${actor.name} fumbles their attack completely!`,
      }));
    } else if (isHit) {
      // Regular hit - roll damage
      const damageMatch = action.ability?.damage?.match(/(\d+)d(\d+)/);
      const diceCount = damageMatch ? parseInt(damageMatch[1]) : 1;
      const diceType = damageMatch ? `d${damageMatch[2]}` as DiceType : "d6";
      
      const damageRolls = await rollDice(diceType, diceCount, actor.level, "Damage");
      const totalDamage = damageRolls.reduce((sum, r) => sum + r.result, 0) + actor.level;

      events.push(createEvent("attack", {
        actor: actor.name,
        target: target.name,
        ability: action.ability?.name || "Attack",
        rolls: [attackRoll, ...damageRolls],
        damage: totalDamage,
        success: true,
        description: `${actor.name} hits ${target.name} with ${action.ability?.name || "an attack"}!`,
      }));

      // Apply damage
      const newHp = Math.max(0, target.hp - totalDamage);
      if (target.isEnemy) {
        onEnemyUpdate(target.id, { hp: newHp });
      } else {
        onCharacterUpdate(target.id, { hp: newHp });
      }

      events.push(createEvent("damage", {
        target: target.name,
        damage: totalDamage,
        description: `${target.name} takes ${totalDamage} damage!`,
      }));

      // Check for death
      if (newHp <= 0) {
        events.push(createEvent("death", {
          target: target.name,
          description: `${target.name} falls!`,
        }));
      }
    } else {
      // Miss
      events.push(createEvent("miss", {
        actor: actor.name,
        target: target.name,
        ability: action.ability?.name || "Attack",
        rolls: [attackRoll],
        success: false,
        description: `${actor.name}'s attack misses ${target.name}!`,
      }));
    }

    return events;
  }, [getCharacter, rollDice, createEvent, onCharacterUpdate, onEnemyUpdate]);

  // Process a spell action
  const processSpell = useCallback(async (
    action: CombatAction
  ): Promise<CombatEvent[]> => {
    const events: CombatEvent[] = [];
    const actor = getCharacter(action.actorId);
    const target = action.targetId ? getCharacter(action.targetId) : undefined;

    if (!actor || !action.ability) {
      toast.error("Invalid spell cast");
      return events;
    }

    // For healing spells
    if (action.ability.type === "heal" && target) {
      const healMatch = action.ability.damage?.match(/(\d+)d(\d+)/);
      const diceCount = healMatch ? parseInt(healMatch[1]) : 1;
      const diceType = healMatch ? `d${healMatch[2]}` as DiceType : "d8";
      
      const healRolls = await rollDice(diceType, diceCount, actor.level, `${action.ability.name} healing`);
      const totalHealing = healRolls.reduce((sum, r) => sum + r.result, 0) + actor.level;

      events.push(createEvent("heal", {
        actor: actor.name,
        target: target.name,
        ability: action.ability.name,
        rolls: healRolls,
        healing: totalHealing,
        success: true,
        description: `${actor.name} heals ${target.name} for ${totalHealing} HP!`,
      }));

      // Apply healing
      const newHp = Math.min(target.maxHp, target.hp + totalHealing);
      if (target.isEnemy) {
        onEnemyUpdate(target.id, { hp: newHp });
      } else {
        onCharacterUpdate(target.id, { hp: newHp });
      }

      return events;
    }

    // For damage spells
    if (target) {
      // Roll spell attack
      const spellModifier = actor.level + 3;
      const attackRolls = await rollDice("d20", 1, spellModifier, `${action.ability.name} attack`);
      const attackRoll = attackRolls[0];
      
      const isHit = attackRoll.isCritical || (!attackRoll.isFumble && attackRoll.total >= target.ac);

      if (isHit) {
        const damageMatch = action.ability.damage?.match(/(\d+)d(\d+)/);
        const diceCount = damageMatch ? parseInt(damageMatch[1]) : 2;
        const diceType = damageMatch ? `d${damageMatch[2]}` as DiceType : "d6";
        const multiplier = attackRoll.isCritical ? 2 : 1;
        
        const damageRolls = await rollDice(diceType, diceCount * multiplier, 0, "Spell damage");
        const totalDamage = damageRolls.reduce((sum, r) => sum + r.result, 0);

        events.push(createEvent(attackRoll.isCritical ? "critical" : "spell", {
          actor: actor.name,
          target: target.name,
          ability: action.ability.name,
          rolls: [attackRoll, ...damageRolls],
          damage: totalDamage,
          damageType: "magical",
          success: true,
          description: attackRoll.isCritical 
            ? `${actor.name}'s ${action.ability.name} strikes ${target.name} with devastating magical force!`
            : `${actor.name} casts ${action.ability.name} on ${target.name}!`,
        }));

        // Apply damage
        const newHp = Math.max(0, target.hp - totalDamage);
        if (target.isEnemy) {
          onEnemyUpdate(target.id, { hp: newHp });
        } else {
          onCharacterUpdate(target.id, { hp: newHp });
        }

        events.push(createEvent("damage", {
          target: target.name,
          damage: totalDamage,
          damageType: "magical",
          description: `${target.name} takes ${totalDamage} magical damage!`,
        }));

        if (newHp <= 0) {
          events.push(createEvent("death", {
            target: target.name,
            description: `${target.name} is defeated!`,
          }));
        }
      } else {
        events.push(createEvent("miss", {
          actor: actor.name,
          target: target.name,
          ability: action.ability.name,
          rolls: [attackRoll],
          success: false,
          description: attackRoll.isFumble 
            ? `${actor.name}'s ${action.ability.name} fizzles completely!`
            : `${target.name} evades ${actor.name}'s ${action.ability.name}!`,
        }));
      }
    }

    return events;
  }, [getCharacter, rollDice, createEvent, onCharacterUpdate, onEnemyUpdate]);

  // Main action executor
  const executeAction = useCallback(async (action: CombatAction): Promise<CombatEvent[]> => {
    setState(prev => ({ ...prev, isProcessing: true }));
    
    let events: CombatEvent[] = [];

    try {
      switch (action.type) {
        case "attack":
          events = await processAttack(action);
          break;
        case "spell":
          events = await processSpell(action);
          break;
        case "heal":
          events = await processSpell({ ...action, type: "spell" });
          break;
        case "move":
          if (action.targetPosition) {
            const actor = getCharacter(action.actorId);
            if (actor) {
              if (actor.isEnemy) {
                onEnemyUpdate(action.actorId, { position: action.targetPosition });
              } else {
                onCharacterUpdate(action.actorId, { position: action.targetPosition });
              }
              events.push(createEvent("turn_start", {
                actor: actor.name,
                description: `${actor.name} moves to a new position.`,
              }));
            }
          }
          break;
        default:
          break;
      }

      // Emit events
      events.forEach(event => {
        onCombatEvent(event);
      });

      setState(prev => ({
        ...prev,
        isProcessing: false,
        pendingEvents: [...prev.pendingEvents, ...events],
        lastEvent: events[events.length - 1] || prev.lastEvent,
      }));

    } catch (error) {
      console.error("Combat engine error:", error);
      toast.error("Combat action failed");
      setState(prev => ({ ...prev, isProcessing: false }));
    }

    return events;
  }, [processAttack, processSpell, getCharacter, onCharacterUpdate, onEnemyUpdate, createEvent, onCombatEvent]);

  // Roll initiative for all combatants
  const rollInitiative = useCallback(async (combatants: Character[]): Promise<Map<string, number>> => {
    const initiatives = new Map<string, number>();
    
    for (const combatant of combatants) {
      const dexMod = 2; // Simplified
      const rolls = await rollDice("d20", 1, dexMod, `${combatant.name} Initiative`);
      initiatives.set(combatant.id, rolls[0].total);
    }

    return initiatives;
  }, [rollDice]);

  // Clear pending events
  const clearEvents = useCallback(() => {
    setState(prev => ({ ...prev, pendingEvents: [] }));
  }, []);

  return {
    isProcessing: state.isProcessing,
    pendingEvents: state.pendingEvents,
    lastEvent: state.lastEvent,
    executeAction,
    rollInitiative,
    rollDice,
    bindDiceRoller,
    clearEvents,
  };
}
