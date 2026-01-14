/**
 * Location view page - displays the current location in the game world.
 * Reads from engine state, dispatches actions only.
 */

import { useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Users,
  Scroll,
  ChevronLeft,
  Compass,
  Shield,
  Store,
  Bed,
  Swords,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useUnifiedEngineOptional } from "@/contexts/UnifiedEngineContext";
import type { EnhancedLocation } from "@/engine/narrative/Travel";
import type { NPC, Quest } from "@/engine/narrative/types";

export default function LocationView() {
  const { campaignId, locationId } = useParams();
  const navigate = useNavigate();
  const engine = useUnifiedEngineOptional();

  // If no engine context, redirect to campaign page
  useEffect(() => {
    if (!engine && campaignId) {
      navigate(`/game/${campaignId}`);
    }
  }, [engine, campaignId, navigate]);

  if (!engine) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading location...</p>
      </div>
    );
  }

  // Get location from engine
  const location = engine.unified.world.locations.get(locationId ?? "") as EnhancedLocation | undefined;
  const currentLocationId = engine.travelState?.currentLocationId;
  const isCurrentLocation = locationId === currentLocationId;

  // Get NPCs at this location
  const npcsAtLocation = useMemo(() => {
    if (!location) return [];
    return location.npcs
      .map(npcId => engine.getNPC(npcId))
      .filter((npc): npc is NPC => npc !== undefined);
  }, [location, engine]);

  // Get quests available at this location
  const questsAtLocation = useMemo(() => {
    if (!location) return [];
    const enhancedLocation = location as EnhancedLocation;
    return (enhancedLocation.questHooks ?? [])
      .map(questId => engine.getQuest(questId))
      .filter((quest): quest is Quest => quest !== undefined && quest.state === "available");
  }, [location, engine]);

  // Get connected locations
  const connectedLocations = useMemo(() => {
    if (!location) return [];
    return location.connectedTo
      .map(id => engine.unified.world.locations.get(id) as EnhancedLocation)
      .filter((loc): loc is EnhancedLocation => loc !== undefined);
  }, [location, engine]);

  // Handle travel
  const handleTravel = useCallback((destinationId: string) => {
    if (!engine.travelTo) {
      toast.error("Travel not available");
      return;
    }
    
    const destination = engine.unified.world.locations.get(destinationId);
    if (destination) {
      engine.travelTo(destinationId);
      toast.success(`Traveling to ${destination.name}...`);
      navigate(`/game/${campaignId}/location/${destinationId}`);
    }
  }, [engine, campaignId, navigate]);

  // Handle NPC interaction
  const handleTalkToNPC = useCallback((npcId: string) => {
    navigate(`/game/${campaignId}/npc/${npcId}`);
  }, [campaignId, navigate]);

  // Handle enter combat
  const handleEnterCombat = useCallback(() => {
    engine.beginCombat();
    navigate(`/game/${campaignId}/combat`);
  }, [engine, campaignId, navigate]);

  if (!location) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background">
        <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
        <h1 className="text-xl font-display mb-2">Location Not Found</h1>
        <p className="text-muted-foreground mb-4">This location doesn't exist or hasn't been discovered.</p>
        <Link to={`/game/${campaignId}/map`}>
          <Button>View Map</Button>
        </Link>
      </div>
    );
  }

  const enhancedLocation = location as EnhancedLocation;
  const dangerColor = enhancedLocation.dangerLevel <= 3 
    ? "text-green-500" 
    : enhancedLocation.dangerLevel <= 6 
    ? "text-yellow-500" 
    : "text-destructive";

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="glass-dark border-b border-border flex-shrink-0">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={`/game/${campaignId}/map`}>
              <Button variant="ghost" size="sm">
                <ChevronLeft className="w-4 h-4 mr-1" />
                Map
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                <h1 className="font-display text-lg">{location.name}</h1>
                <Badge variant="outline" className="capitalize">
                  {enhancedLocation.type}
                </Badge>
              </div>
              {isCurrentLocation && (
                <p className="text-xs text-primary">You are here</p>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className={dangerColor}>
              <Shield className="w-3 h-3 mr-1" />
              Danger: {enhancedLocation.dangerLevel}
            </Badge>
            {enhancedLocation.factionControl && (
              <Badge variant="outline">
                Controlled by {enhancedLocation.factionControl}
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left: Location Details */}
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Description */}
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground leading-relaxed">
                  {location.description || enhancedLocation.ambientDescription}
                </p>
                {enhancedLocation.weather && (
                  <p className="mt-2 text-sm text-muted-foreground italic">
                    Weather: {enhancedLocation.weather}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Services */}
            {enhancedLocation.services && enhancedLocation.services.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Store className="w-4 h-4" />
                    Services Available
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {enhancedLocation.inn && (
                      <Badge variant="secondary">
                        <Bed className="w-3 h-3 mr-1" />
                        Inn & Rest
                      </Badge>
                    )}
                    {enhancedLocation.services.map(service => (
                      <Badge key={service} variant="outline" className="capitalize">
                        {service}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* NPCs */}
            {npcsAtLocation.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Characters Here ({npcsAtLocation.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {npcsAtLocation.map(npc => (
                      <motion.div
                        key={npc.id}
                        whileHover={{ scale: 1.02 }}
                        className="p-3 rounded-lg border border-border bg-card cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => handleTalkToNPC(npc.id)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-display">{npc.name}</span>
                          {npc.canTrade && (
                            <Badge variant="outline" className="text-xs">
                              <Store className="w-3 h-3 mr-1" />
                              Trade
                            </Badge>
                          )}
                        </div>
                        {npc.title && (
                          <p className="text-xs text-muted-foreground">{npc.title}</p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {npc.personality.slice(0, 2).map(trait => (
                            <span key={trait} className="text-xs px-1.5 py-0.5 bg-secondary rounded capitalize">
                              {trait}
                            </span>
                          ))}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Quests */}
            {questsAtLocation.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Scroll className="w-4 h-4" />
                    Available Quests
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {questsAtLocation.map(quest => (
                      <Link 
                        key={quest.id} 
                        to={`/game/${campaignId}/quest/${quest.id}`}
                        className="block"
                      >
                        <div className="p-3 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-display">{quest.title}</span>
                            <Badge variant={quest.importance === "main" ? "default" : "secondary"}>
                              {quest.importance}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {quest.briefDescription}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Combat Zone */}
            {enhancedLocation.dangerLevel >= 3 && isCurrentLocation && (
              <Card className="border-destructive/50">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-display text-destructive flex items-center gap-2">
                        <Swords className="w-4 h-4" />
                        Dangerous Area
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Enemies may be lurking in this {enhancedLocation.type}.
                      </p>
                    </div>
                    <Button variant="destructive" onClick={handleEnterCombat}>
                      <Swords className="w-4 h-4 mr-2" />
                      Enter Combat
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Right: Travel Options */}
        <aside className="w-80 border-l border-border bg-card/30 p-4 hidden lg:block">
          <div className="flex items-center gap-2 mb-4">
            <Compass className="w-4 h-4 text-primary" />
            <h2 className="font-display text-sm uppercase">Connected Locations</h2>
          </div>
          
          <ScrollArea className="h-[calc(100vh-200px)]">
            <div className="space-y-3">
              {connectedLocations.map(dest => {
                const isDiscovered = engine.travelState?.discoveredLocations?.has(dest.id);
                const destEnhanced = dest as EnhancedLocation;
                
                return (
                  <motion.div
                    key={dest.id}
                    whileHover={{ x: 4 }}
                    className={`p-3 rounded-lg border transition-colors ${
                      isDiscovered 
                        ? "border-border bg-card cursor-pointer hover:border-primary/50" 
                        : "border-dashed border-muted bg-muted/20"
                    }`}
                    onClick={() => isDiscovered && isCurrentLocation && handleTravel(dest.id)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`font-display ${!isDiscovered && "text-muted-foreground"}`}>
                        {isDiscovered ? dest.name : "???"}
                      </span>
                      <Badge variant="outline" className="capitalize text-xs">
                        {destEnhanced.type}
                      </Badge>
                    </div>
                    
                    {isDiscovered && (
                      <>
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                          {dest.description?.substring(0, 80)}...
                        </p>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs ${
                            destEnhanced.dangerLevel <= 3 ? "text-green-500" :
                            destEnhanced.dangerLevel <= 6 ? "text-yellow-500" : "text-destructive"
                          }`}>
                            Danger: {destEnhanced.dangerLevel}
                          </span>
                          {isCurrentLocation && (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs">
                              Travel
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                    
                    {!isDiscovered && (
                      <p className="text-xs text-muted-foreground italic">
                        Unexplored territory
                      </p>
                    )}
                  </motion.div>
                );
              })}
              
              {connectedLocations.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-4">
                  No connected locations discovered.
                </p>
              )}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
