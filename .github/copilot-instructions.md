# Saga Spark - AI Coding Agent Instructions

## Project Overview
Saga Spark is a fantasy RPG companion web app built with **Vite + React + TypeScript + Supabase**. It features a physics-based 2D combat engine, narrative/quest systems, NPC interactions, and world generation via Supabase Edge Functions (Groq API). The app handles both tactical combat on a grid and story-driven world traversal.

## Architecture & Data Flows

### Core Systems (Three Layers)
1. **Engine Layer** (`src/engine/`): Pure physics/combat logic (immutable state, no mutations)
   - `Engine.ts`: Action processor → game state updates
   - `GameState.ts`: Turn management, entity spawning, event tracking
   - `Combat.ts`: Attack resolution, damage calculation
   - `Physics.ts`: Movement, pathfinding, collision detection
   - `types.ts`: Core types (`GameState`, `Entity`, `GameAction`, `GameEvent`)

2. **Narrative Layer** (`src/engine/narrative/`): World state, NPCs, quests, items
   - `types.ts`: Campaign, NPC, Quest, Item, Inventory, Equipment definitions (immutable)
   - `World.ts`: World state factory and updates
   - `Quest.ts`, `NPC.ts`, `Item.ts`: Domain logic
   - `Travel.ts`: Location traversal system
   - `Progression.ts`: Character leveling/stat gains

3. **React Integration** (`src/hooks/`, `src/contexts/`):
   - `useUnifiedEngine`: Bridge combining game + narrative state
   - `UnifiedEngineContext.tsx`: Single context providing both systems
   - Other domain hooks: `useAuth`, `useCampaigns`, `useDungeonMaster`, etc.

**Critical Pattern**: `UnifiedState` combines `GameState` + `WorldState` in a single immutable object (`src/engine/UnifiedState.ts`). All mutations return new objects—never mutate existing state.

### Supabase Integration
- **Client**: `src/integrations/supabase/client.ts` (auto-generated, with debug logging)
- **Edge Functions** (Groq-powered): `supabase/functions/`
  - `world-generator`: Creates campaign, factions, NPCs, quests
  - `world-content-writer`: Generates descriptions, narratives
  - `generate-class`: Creates custom character classes
  - All deploy with `npx supabase functions deploy <name>`
- **Secret Management**: Functions read `GROQ_API_KEY` + `GROQ_BASE_URL` from Supabase secrets (never exposed to client)

## Critical Workflows

### Development
```bash
npm install                    # Install deps (Bun preferred in package.json)
npm run dev                    # Start Vite dev server (port 8080)
npm run build                  # Production build
npm run lint                   # ESLint check
```

### Supabase Local Setup
```bash
scripts/bootstrap-supabase.sh  # Apply migrations + seed
npx supabase functions deploy world-generator  # Deploy edge functions
# Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env
```

### Testing Edge Functions (Local)
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/generate-class \
  -H "apikey: <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"classDescription":"Arcane duelist"}'
```

## Key Patterns & Conventions

### 1. Immutable State Management
All state objects (game, world, unified) are immutable. **Never mutate**—return new objects:
```typescript
// ✓ Correct: src/engine/GameState.ts pattern
export function updateEntity(state: GameState, entity: Entity): GameState {
  const updated = { ...state, entities: [...state.entities] };
  const idx = updated.entities.findIndex(e => e.id === entity.id);
  if (idx >= 0) updated.entities[idx] = entity;
  return updated;
}

// ✗ Wrong: state.entities[0] = newEntity;
```

### 2. React Hooks for State Access
Domain logic lives in hooks. Components import hooks, not raw state:
- `useUnifiedEngine()`: Main engine + world state, returns `{ entities, isInCombat, npcs, quests, ...dispatch/tick/talkToNPC }`
- `useAuth()`: User session (returns Profile, isLoading, user)
- `useCampaigns()`: Campaign CRUD operations
- `useDungeonMaster()`: AI DM responses for narrative (returns `DMResponse` with description/events/combat)

Example:
```tsx
const { entities, dispatch, npcs, addNPC } = useUnifiedEngine(options);
dispatch({ type: "move", playerId, position }); // Game action
addNPC(npc); // World action
```

### 3. Typed Actions & Events
Game actions are discriminated unions with specific payload:
```typescript
// src/engine/types.ts
export type GameAction = 
  | MoveAction  // { type: "move", playerId, position }
  | AttackAction  // { type: "attack", attacker, defender }
  | AbilityAction  // { type: "ability", playerId, abilityId, position }
  | EndTurnAction  // { type: "endTurn", playerId }
```

World actions follow same pattern. **Always check action type before accessing payload properties**.

### 4. Component Structure
- UI components import from `@ui/*` alias (path in `tsconfig.json`)
- Screens in `src/ui/screens/`: `GameScreen`, `DashboardScreen`, `CharacterScreen`
- Reusable UI in `src/ui/components/` + shadcn/ui (Radix-based)
- Game-specific UI in `src/ui/worldboard/` for grid rendering

### 5. Context Usage (UnifiedEngineContext)
```tsx
// src/contexts/UnifiedEngineContext.tsx
export const UnifiedEngineProvider = ({ children, campaignSeed }) => {
  const unified = useUnifiedEngine({ campaignSeed, rows: 10, cols: 12 });
  return <UnifiedEngineContext.Provider value={unified}>{children}</UnifiedEngineContext.Provider>;
};

// In components:
const { entities, dispatch, npcs } = useContext(UnifiedEngineContext);
```

### 6. Narrative Events → Game State Bridging
When NPCs die or combat triggers events, `useUnifiedEngine` automatically:
- Routes combat kills to narrative progression (`processCombatKill`)
- Triggers quest state changes (`completeQuest`, `acceptQuest`)
- Updates inventory/equipment on loot pickup
- See `useUnifiedEngine` lines 80–150 for event routing

## File Organization

| Path | Purpose |
|------|---------|
| `src/engine/` | Physics/combat (pure, immutable) |
| `src/engine/narrative/` | Quests, NPCs, items, progression |
| `src/hooks/` | React hooks (state access + side effects) |
| `src/contexts/` | React contexts (global state providers) |
| `src/ui/` | Screen/page components + app shell |
| `src/components/` | Game UI (combat, DM chat, dice roller) |
| `supabase/functions/` | Edge functions (Groq-powered) |
| `supabase/migrations/` | DB schema (auto-managed) |

## TypeScript & Config Notes
- Path aliases: `@/*` → `src/*`, `@ui/*` → `src/ui/*`
- Strict mode disabled (see `tsconfig.json`) for faster iteration
- No unused param/local warnings
- Implicit `any` allowed (developer preference)

## Common Tasks

**Add a new game action type**:
1. Add union case to `GameAction` in `src/engine/types.ts`
2. Add handler in `Engine.ts` `processAction()`
3. Create hook wrapper if needed (e.g., `dispatch({ type: "newAction", ... })`)

**Add a narrative event**:
1. Define event in `src/engine/narrative/types.ts` (WorldEvent union)
2. Route in `useUnifiedEngine` event handler (lines ~100–150)
3. Update `UnifiedEngineContext.tsx` if exposing as action

**Wire up Supabase function**:
1. Create/update function in `supabase/functions/<name>/index.ts`
2. Deploy: `npx supabase functions deploy <name>`
3. Call from React hook via `supabase.functions.invoke()`

## Resources
- [Engine types](../src/engine/types.ts): Core game types
- [Game state](../src/engine/GameState.ts): Game state management and turn handling
- [Main hook](../src/hooks/useUnifiedEngine.ts): Central state orchestrator combining game + world logic
- [Context provider](../src/contexts/UnifiedEngineContext.tsx): Global context provider
