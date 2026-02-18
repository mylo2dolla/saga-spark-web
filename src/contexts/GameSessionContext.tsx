/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, type ReactNode } from "react";
import { useGameSession } from "@/hooks/useGameSession";

type GameSessionContextValue = ReturnType<typeof useGameSession>;

const GameSessionContext = createContext<GameSessionContextValue | null>(null);

export function GameSessionProvider({
  campaignId,
  children,
}: {
  campaignId: string;
  children: ReactNode;
}) {
  const session = useGameSession({ campaignId });

  return (
    <GameSessionContext.Provider value={session}>
      {children}
    </GameSessionContext.Provider>
  );
}

export function MockGameSessionProvider({
  value,
  children,
}: {
  value: GameSessionContextValue;
  children: ReactNode;
}) {
  return (
    <GameSessionContext.Provider value={value}>
      {children}
    </GameSessionContext.Provider>
  );
}

export function useGameSessionContext(): GameSessionContextValue {
  const context = useContext(GameSessionContext);
  if (!context) {
    throw new Error("useGameSessionContext must be used within a GameSessionProvider");
  }
  return context;
}
