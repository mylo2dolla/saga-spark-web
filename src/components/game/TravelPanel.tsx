/**
 * Engine-driven Travel Panel component.
 * Calls beginTravel from the WorldTravelEngine and shows travel progress,
 * current location, destination, and combat interrupts.
 */

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Navigation,
  Swords,
  Clock,
  ChevronRight,
  AlertTriangle,
  Loader2,
  Shield,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  beginTravel,
  resumeTravelAfterCombat,
  canBeginTravel,
  getReachableLocations,
  getTravelInfo,
  type BeginTravelResult,
} from "@/engine/WorldTravelEngine";
import type { TravelWorldState, CombatEncounter } from "@/engine/narrative/TravelPersistence";
import type { EnhancedLocation, TravelState } from "@/engine/narrative/Travel";
import type { Entity, GameState } from "@/engine/types";
import type { WorldEvent } from "@/engine/narrative/types";

interface TravelPanelProps {
  world: TravelWorldState;
  playerId: string;
  isInCombat: boolean;
  onWorldUpdate: (world: TravelWorldState) => void;
  onTravelStateUpdate: (travelState: TravelState) => void;
  onCombatStart: (entities: readonly Entity[], encounter?: CombatEncounter | null) => void;
  onWorldEvent?: (event: WorldEvent) => void;
}

export function TravelPanel({
  world,
  playerId,
  isInCombat,
  onWorldUpdate,
  onTravelStateUpdate,
  onCombatStart,
  onWorldEvent,
}: TravelPanelProps) {
  const [isTraveling, setIsTraveling] = useState(false);
  const [selectedDestination, setSelectedDestination] = useState<string | null>(null);
  const [travelResult, setTravelResult] = useState<BeginTravelResult | null>(null);

  // Get travel info from world state
  const travelInfo = useMemo(() => getTravelInfo(world), [world]);

  // Get reachable locations
  const reachableLocations = useMemo(() => getReachableLocations(world), [world]);

  // Check if can travel to selected destination
  const canTravelToSelected = useMemo(() => {
    if (!selectedDestination) return { canTravel: false, reason: "No destination selected" };
    return canBeginTravel(world, selectedDestination, playerId, isInCombat);
  }, [world, selectedDestination, playerId, isInCombat]);

  // Handle travel initiation
  const handleBeginTravel = useCallback(() => {
    if (!selectedDestination || isInCombat) return;

    setIsTraveling(true);

    const result = beginTravel(world, selectedDestination, playerId, isInCombat);
    setTravelResult(result);

    if (!result.success) {
      toast.error(result.message);
      setIsTraveling(false);
      return;
    }

    // Emit world events
    result.events.forEach(e => onWorldEvent?.(e));

    // Update world state
    onWorldUpdate(result.world);
    onTravelStateUpdate(result.travelState);

    if (result.combatTriggered && result.combatEntities.length > 0) {
      // Combat interrupted travel
      toast.warning(result.message);
      onCombatStart(result.combatEntities, result.combatEncounter);
    } else if (result.arrived) {
      // Arrived at destination
      toast.success(result.message);
      setSelectedDestination(null);
    }

    setIsTraveling(false);
  }, [
    world,
    selectedDestination,
    playerId,
    isInCombat,
    onWorldUpdate,
    onTravelStateUpdate,
    onCombatStart,
    onWorldEvent,
  ]);

  // Handle resuming travel after combat
  const handleResumeTravelAfterCombat = useCallback(
    (victory: boolean) => {
      const result = resumeTravelAfterCombat(world, playerId, victory);

      result.events.forEach(e => onWorldEvent?.(e));
      onWorldUpdate(result.world);
      onTravelStateUpdate(result.travelState);

      if (result.arrived) {
        toast.success(result.message);
      } else {
        toast.info(result.message);
      }
    },
    [world, playerId, onWorldUpdate, onTravelStateUpdate, onWorldEvent]
  );

  // Get danger level badge color
  const getDangerColor = (level: number) => {
    if (level <= 2) return "bg-green-500/20 text-green-500";
    if (level <= 4) return "bg-yellow-500/20 text-yellow-500";
    if (level <= 6) return "bg-orange-500/20 text-orange-500";
    return "bg-red-500/20 text-red-500";
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Navigation className="w-5 h-5 text-primary" />
          Travel
        </CardTitle>
        <CardDescription>
          {travelInfo.isInTransit
            ? `Traveling... ${Math.round(travelInfo.transitProgress)}%`
            : `Current: ${travelInfo.currentLocation?.name ?? "Unknown"}`}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-4 overflow-hidden">
        {/* Current Location Info */}
        {travelInfo.currentLocation && !travelInfo.isInTransit && (
          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="w-4 h-4 text-primary" />
              <span className="font-medium">{travelInfo.currentLocation.name}</span>
              <Badge className={getDangerColor(travelInfo.currentLocation.dangerLevel ?? 1)}>
                Danger: {travelInfo.currentLocation.dangerLevel ?? 1}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {travelInfo.currentLocation.ambientDescription ?? travelInfo.currentLocation.description}
            </p>
          </div>
        )}

        {/* Travel Progress */}
        {travelInfo.isInTransit && (
          <div className="p-4 rounded-lg bg-primary/10 border border-primary/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="font-medium">Traveling...</span>
              </div>
              <span className="text-sm text-muted-foreground">
                {Math.round(travelInfo.transitProgress)}%
              </span>
            </div>
            <Progress value={travelInfo.transitProgress} className="h-2" />
            {travelInfo.destination && (
              <p className="text-sm text-muted-foreground mt-2">
                → {travelInfo.destination.name}
              </p>
            )}
          </div>
        )}

        {/* Combat Interrupt Notice */}
        {isInCombat && travelInfo.isInTransit && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30">
            <div className="flex items-center gap-2 text-destructive">
              <Swords className="w-5 h-5" />
              <span className="font-medium">Combat Encounter!</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Defeat the enemies to continue your journey.
            </p>
          </div>
        )}

        {/* Reachable Destinations */}
        {!travelInfo.isInTransit && !isInCombat && (
          <>
            <div className="text-sm font-medium text-muted-foreground">
              Available Destinations ({reachableLocations.length})
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-2">
                {reachableLocations.map((location) => (
                  <motion.div
                    key={location.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedDestination === location.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    }`}
                    onClick={() => setSelectedDestination(location.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{location.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getDangerColor(location.dangerLevel ?? 1)} variant="outline">
                          Lv {location.dangerLevel ?? 1}
                        </Badge>
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {location.travelTime?.[world.travelState.currentLocationId] ?? 1}h
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                      {location.type} • {location.services?.join(", ") || "No services"}
                    </p>
                    {selectedDestination === location.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="mt-2 pt-2 border-t border-border"
                      >
                        <p className="text-sm text-muted-foreground">
                          {location.ambientDescription ?? location.description}
                        </p>
                      </motion.div>
                    )}
                  </motion.div>
                ))}

                {reachableLocations.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No connected locations.</p>
                    <p className="text-xs">This area appears to be isolated.</p>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Travel Button */}
            <AnimatePresence>
              {selectedDestination && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                >
                  <Button
                    className="w-full gap-2"
                    onClick={handleBeginTravel}
                    disabled={!canTravelToSelected.canTravel || isTraveling}
                  >
                    {isTraveling ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Traveling...
                      </>
                    ) : (
                      <>
                        <Navigation className="w-4 h-4" />
                        Travel
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                  {!canTravelToSelected.canTravel && canTravelToSelected.reason && (
                    <p className="text-xs text-destructive text-center mt-1">
                      {canTravelToSelected.reason}
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {/* World Time */}
        <div className="mt-auto pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>Day {Math.floor(world.globalTime / 24) + 1}</span>
          </div>
          <span>Hour {world.globalTime % 24}:00</span>
        </div>
      </CardContent>
    </Card>
  );
}
