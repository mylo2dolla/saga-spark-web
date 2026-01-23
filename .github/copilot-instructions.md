# Copilot instructions for Saga Spark

## Project overview
Saga Spark is a Vite + React web app for a fantasy RPG companion experience. The client integrates a physics/combat engine with a narrative/world simulation. The unified state is the single source of truth for both systems, and React hooks/contexts expose it to UI components.

## Architecture (current)
- **Engine layer**: Physics/combat logic lives under `src/engine`, with public exports aggregated in `src/engine/index.ts`.
- **Unified state**: `src/engine/UnifiedState.ts` composes combat `GameState` with narrative `WorldState` and provides pure update helpers.
- **React integration**: `src/hooks/useUnifiedEngine.ts` wraps the engine and unified state, while `src/contexts/UnifiedEngineContext.tsx` provides a context and hooks for UI components.
- **UI flow**: Components use `useUnifiedEngineContext()` to dispatch game actions and read unified state (e.g., game loop, combat arena, narrative UI).

## Resources
- Engine public API exports: `src/engine/index.ts`
- Combat game state: `src/engine/GameState.ts`
- Core engine types (including `GameAction`): `src/engine/types.ts`
- Unified state helpers: `src/engine/UnifiedState.ts`
- Unified engine hook: `src/hooks/useUnifiedEngine.ts`
- Unified engine context: `src/contexts/UnifiedEngineContext.tsx`

## Self-check (before coding)
- Verify any referenced file paths exist in the repo.
- If a path changes, update this document to match the real location.
- Never invent modules or architecture that are not present in the codebase.
