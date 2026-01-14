import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { GridState, GridTile, GridPosition } from "@/types/game";

export function useGridState(campaignId: string | undefined) {
  const [gridState, setGridState] = useState<GridState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const parseGridState = (data: unknown): GridState => {
    const state = data as Record<string, unknown>;
    const gridSize = (state.grid_size || { rows: 10, cols: 12 }) as { rows: number; cols: number };
    return {
      id: state.id as string,
      campaignId: state.campaign_id as string,
      gridSize,
      tiles: (state.tiles || []) as GridTile[],
    };
  };

  // Fetch initial grid state
  useEffect(() => {
    if (!campaignId) return;

    const fetchGridState = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase
          .from("grid_state")
          .select("*")
          .eq("campaign_id", campaignId)
          .maybeSingle();

        if (error) throw error;
        
        if (data) {
          setGridState(parseGridState(data));
        } else {
          // Initialize grid state if it doesn't exist
          setGridState({
            id: "",
            campaignId,
            gridSize: { rows: 10, cols: 12 },
            tiles: [],
          });
        }
      } catch (error) {
        console.error("Error fetching grid state:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchGridState();
  }, [campaignId]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!campaignId) return;

    const channel: RealtimeChannel = supabase
      .channel(`grid:${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "grid_state",
          filter: `campaign_id=eq.${campaignId}`,
        },
        (payload) => {
          if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
            setGridState(parseGridState(payload.new));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

  const updateTile = useCallback(async (tile: GridTile) => {
    if (!campaignId || !gridState) return;

    try {
      const updatedTiles = [...gridState.tiles];
      const existingIndex = updatedTiles.findIndex(t => t.x === tile.x && t.y === tile.y);
      
      if (existingIndex >= 0) {
        updatedTiles[existingIndex] = tile;
      } else {
        updatedTiles.push(tile);
      }

      const { error } = await supabase
        .from("grid_state")
        .update({ tiles: JSON.parse(JSON.stringify(updatedTiles)) })
        .eq("campaign_id", campaignId);

      if (error) throw error;
    } catch (error) {
      console.error("Error updating tile:", error);
    }
  }, [campaignId, gridState]);

  const moveEntity = useCallback(async (
    entityId: string,
    entityType: "character" | "enemy",
    from: GridPosition,
    to: GridPosition
  ) => {
    if (!campaignId || !gridState) return;

    try {
      const updatedTiles = [...gridState.tiles];
      
      // Remove from old position
      const fromIndex = updatedTiles.findIndex(t => t.x === from.x && t.y === from.y);
      if (fromIndex >= 0) {
        updatedTiles[fromIndex] = { ...updatedTiles[fromIndex], occupantId: undefined, occupantType: undefined };
      }
      
      // Add to new position
      const toIndex = updatedTiles.findIndex(t => t.x === to.x && t.y === to.y);
      if (toIndex >= 0) {
        updatedTiles[toIndex] = { ...updatedTiles[toIndex], occupantId: entityId, occupantType: entityType };
      } else {
        updatedTiles.push({
          x: to.x,
          y: to.y,
          terrain: "floor",
          blocked: false,
          occupantId: entityId,
          occupantType: entityType,
        });
      }

      const { error } = await supabase
        .from("grid_state")
        .update({ tiles: JSON.parse(JSON.stringify(updatedTiles)) })
        .eq("campaign_id", campaignId);

      if (error) throw error;

      // Also update character position in characters table
      if (entityType === "character") {
        await supabase
          .from("characters")
          .update({ position: JSON.parse(JSON.stringify(to)) })
          .eq("id", entityId);
      }
    } catch (error) {
      console.error("Error moving entity:", error);
    }
  }, [campaignId, gridState]);

  const initializeGrid = useCallback(async () => {
    if (!campaignId) return;

    try {
      // Check if grid exists
      const { data: existing } = await supabase
        .from("grid_state")
        .select("id")
        .eq("campaign_id", campaignId)
        .maybeSingle();

      if (!existing) {
        // Create initial grid
        const initialTiles: GridTile[] = [];
        for (let y = 0; y < 10; y++) {
          for (let x = 0; x < 12; x++) {
            initialTiles.push({
              x,
              y,
              terrain: "floor",
              blocked: false,
            });
          }
        }

        const { error } = await supabase
          .from("grid_state")
          .insert([{
            campaign_id: campaignId,
            grid_size: JSON.parse(JSON.stringify({ rows: 10, cols: 12 })),
            tiles: JSON.parse(JSON.stringify(initialTiles)),
          }]);

        if (error) throw error;
      }
    } catch (error) {
      console.error("Error initializing grid:", error);
    }
  }, [campaignId]);

  const getTileAt = useCallback((x: number, y: number): GridTile | undefined => {
    return gridState?.tiles.find(t => t.x === x && t.y === y);
  }, [gridState]);

  const isPositionBlocked = useCallback((x: number, y: number): boolean => {
    const tile = getTileAt(x, y);
    if (!tile) return false;
    return tile.blocked || tile.occupantId !== undefined;
  }, [getTileAt]);

  const getDistance = useCallback((from: GridPosition, to: GridPosition): number => {
    return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
  }, []);

  return {
    gridState,
    isLoading,
    updateTile,
    moveEntity,
    initializeGrid,
    getTileAt,
    isPositionBlocked,
    getDistance,
  };
}
