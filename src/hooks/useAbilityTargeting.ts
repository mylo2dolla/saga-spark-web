import { useCallback } from "react";
import type { GameAbility, GridPosition, AbilityUseResult, CombatEntity } from "@/types/game";

interface UseAbilityTargetingProps {
  gridSize: { rows: number; cols: number };
  entities: CombatEntity[];
  isPositionBlocked: (x: number, y: number) => boolean;
}

export function useAbilityTargeting({ gridSize, entities, isPositionBlocked }: UseAbilityTargetingProps) {
  
  const getDistance = useCallback((from: GridPosition, to: GridPosition): number => {
    return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
  }, []);

  const getEntityAt = useCallback((position: GridPosition): CombatEntity | undefined => {
    return entities.find(e => e.position.x === position.x && e.position.y === position.y);
  }, [entities]);

  const getValidTargets = useCallback((
    ability: GameAbility,
    casterPosition: GridPosition,
    casterId: string
  ): GridPosition[] => {
    const validPositions: GridPosition[] = [];
    
    for (let y = 0; y < gridSize.rows; y++) {
      for (let x = 0; x < gridSize.cols; x++) {
        const targetPos = { x, y };
        const distance = getDistance(casterPosition, targetPos);
        
        // Check if within range
        if (distance > ability.range) continue;
        
        // Handle different targeting types
        switch (ability.targetingType) {
          case "self":
            if (x === casterPosition.x && y === casterPosition.y) {
              validPositions.push(targetPos);
            }
            break;
            
          case "single": {
            const entity = getEntityAt(targetPos);
            if (entity && entity.id !== casterId) {
              validPositions.push(targetPos);
            }
            break;
          }
          
          case "tile":
            if (!isPositionBlocked(x, y)) {
              validPositions.push(targetPos);
            }
            break;
            
          case "area":
          case "cone":
          case "line":
            // For area effects, just need to be in range
            validPositions.push(targetPos);
            break;
        }
      }
    }
    
    return validPositions;
  }, [gridSize, getDistance, getEntityAt, isPositionBlocked]);

  const getAreaOfEffect = useCallback((
    ability: GameAbility,
    targetPosition: GridPosition,
    casterPosition: GridPosition
  ): GridPosition[] => {
    const affectedPositions: GridPosition[] = [];
    const areaSize = ability.areaSize || 1;
    
    switch (ability.targetingType) {
      case "self":
      case "single":
      case "tile":
        affectedPositions.push(targetPosition);
        break;
        
      case "area":
        // Circular area around target
        for (let dy = -areaSize; dy <= areaSize; dy++) {
          for (let dx = -areaSize; dx <= areaSize; dx++) {
            const pos = { x: targetPosition.x + dx, y: targetPosition.y + dy };
            const dist = Math.abs(dx) + Math.abs(dy);
            if (dist <= areaSize && pos.x >= 0 && pos.y >= 0 && 
                pos.x < gridSize.cols && pos.y < gridSize.rows) {
              affectedPositions.push(pos);
            }
          }
        }
        break;
        
      case "cone": {
        // Cone from caster toward target
        const dx = Math.sign(targetPosition.x - casterPosition.x);
        const dy = Math.sign(targetPosition.y - casterPosition.y);
        
        for (let i = 1; i <= ability.range; i++) {
          const spread = Math.floor(i / 2);
          for (let s = -spread; s <= spread; s++) {
            let pos: GridPosition;
            if (dx !== 0) {
              pos = { x: casterPosition.x + (dx * i), y: casterPosition.y + s };
            } else {
              pos = { x: casterPosition.x + s, y: casterPosition.y + (dy * i) };
            }
            if (pos.x >= 0 && pos.y >= 0 && pos.x < gridSize.cols && pos.y < gridSize.rows) {
              affectedPositions.push(pos);
            }
          }
        }
        break;
      }
        
      case "line": {
        // Line from caster to target (and beyond)
        const lineDir = {
          x: Math.sign(targetPosition.x - casterPosition.x),
          y: Math.sign(targetPosition.y - casterPosition.y),
        };
        
        for (let i = 1; i <= ability.range; i++) {
          const pos = {
            x: casterPosition.x + (lineDir.x * i),
            y: casterPosition.y + (lineDir.y * i),
          };
          if (pos.x >= 0 && pos.y >= 0 && pos.x < gridSize.cols && pos.y < gridSize.rows) {
            affectedPositions.push(pos);
          }
        }
        break;
      }
    }
    
    return affectedPositions;
  }, [gridSize]);

  const getEntitiesInArea = useCallback((positions: GridPosition[]): CombatEntity[] => {
    return positions
      .map(pos => getEntityAt(pos))
      .filter((e): e is CombatEntity => e !== undefined);
  }, [getEntityAt]);

  const isValidTarget = useCallback((
    ability: GameAbility,
    casterPosition: GridPosition,
    targetPosition: GridPosition,
    casterId: string
  ): boolean => {
    const validTargets = getValidTargets(ability, casterPosition, casterId);
    return validTargets.some(t => t.x === targetPosition.x && t.y === targetPosition.y);
  }, [getValidTargets]);

  const parseDiceRoll = useCallback((diceString: string): number => {
    // Parse strings like "2d6+3" or "1d8"
    const match = diceString.match(/(\d+)d(\d+)([+-]\d+)?/);
    if (!match) return 0;
    
    const [, numDice, dieSize, modifier] = match;
    let total = 0;
    
    for (let i = 0; i < parseInt(numDice); i++) {
      total += Math.floor(Math.random() * parseInt(dieSize)) + 1;
    }
    
    if (modifier) {
      total += parseInt(modifier);
    }
    
    return Math.max(0, total);
  }, []);

  const rollD20 = useCallback((): { roll: number; isCritical: boolean; isFumble: boolean } => {
    const roll = Math.floor(Math.random() * 20) + 1;
    return {
      roll,
      isCritical: roll === 20,
      isFumble: roll === 1,
    };
  }, []);

  const executeAbility = useCallback((
    ability: GameAbility,
    caster: CombatEntity,
    targetPosition: GridPosition,
    targetAC?: number
  ): AbilityUseResult => {
    // Check if target is valid
    if (!isValidTarget(ability, caster.position, targetPosition, caster.id)) {
      return {
        success: false,
        description: "Target is out of range or invalid",
      };
    }

    // Roll to hit (for damage abilities)
    if (ability.damage) {
      const { roll, isCritical, isFumble } = rollD20();
      
      if (isFumble) {
        return {
          success: false,
          isFumble: true,
          description: `${caster.name}'s ${ability.name} misses spectacularly!`,
        };
      }

      // Check against AC if provided
      if (targetAC !== undefined && !isCritical) {
        const hitBonus = Math.floor((caster.ac - 10) / 2); // Simplified
        if (roll + hitBonus < targetAC) {
          return {
            success: false,
            description: `${caster.name}'s ${ability.name} misses (rolled ${roll})`,
          };
        }
      }

      // Calculate damage
      let damage = parseDiceRoll(ability.damage);
      if (isCritical) {
        damage = damage * 2;
      }

      return {
        success: true,
        damage,
        isCritical,
        description: isCritical 
          ? `CRITICAL! ${caster.name}'s ${ability.name} deals ${damage} damage!`
          : `${caster.name}'s ${ability.name} deals ${damage} damage!`,
      };
    }

    // Healing abilities
    if (ability.healing) {
      const healing = parseDiceRoll(ability.healing);
      return {
        success: true,
        healing,
        description: `${caster.name}'s ${ability.name} heals for ${healing}!`,
      };
    }

    // Utility ability
    return {
      success: true,
      effectsApplied: ability.effects,
      description: `${caster.name} uses ${ability.name}!`,
    };
  }, [isValidTarget, rollD20, parseDiceRoll]);

  return {
    getDistance,
    getEntityAt,
    getValidTargets,
    getAreaOfEffect,
    getEntitiesInArea,
    isValidTarget,
    executeAbility,
    parseDiceRoll,
    rollD20,
  };
}
