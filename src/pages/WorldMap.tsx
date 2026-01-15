/**
 * World Map page - displays the navigable world map.
 * Shows locations, connections, and player position from engine state.
 */

import { useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Map,
  MapPin,
  ChevronLeft,
  Compass,
  AlertTriangle,
  Crown,
  Skull,
  Home,
  Trees,
  Mountain,
  Building,
  Castle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGameSessionContext } from "@/contexts/GameSessionContext";
import type { EnhancedLocation, LocationType } from "@/engine/narrative/Travel";

const LOCATION_ICONS: Record<LocationType, React.ReactNode> = {
  town: <Building className="w-5 h-5" />,
  city: <Crown className="w-5 h-5" />,
  village: <Home className="w-5 h-5" />,
  dungeon: <Skull className="w-5 h-5" />,
  wilderness: <Compass className="w-5 h-5" />,
  ruins: <AlertTriangle className="w-5 h-5" />,
  stronghold: <Castle className="w-5 h-5" />,
  temple: <Building className="w-5 h-5" />,
  cave: <Mountain className="w-5 h-5" />,
  forest: <Trees className="w-5 h-5" />,
  mountain: <Mountain className="w-5 h-5" />,
  coast: <Compass className="w-5 h-5" />,
  swamp: <Trees className="w-5 h-5" />,
};

export default function WorldMap() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const gameSession = useGameSessionContext();
  const world = gameSession.unifiedState?.world;
  const travelState = gameSession.travelState;

  // Get all locations from engine
  const locations = useMemo(() => {
    if (!world) return [];
    return Array.from(world.locations.values()) as EnhancedLocation[];
  }, [world]);

  // Get current location
  const currentLocationId = travelState?.currentLocationId;
  const discoveredLocations = travelState?.discoveredLocations ?? new Set();

  // Calculate map bounds
  const bounds = useMemo(() => {
    if (locations.length === 0) {
      return { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    }
    
    const xs = locations.map(l => l.position.x);
    const ys = locations.map(l => l.position.y);
    const padding = 50;
    
    return {
      minX: Math.min(...xs) - padding,
      maxX: Math.max(...xs) + padding,
      minY: Math.min(...ys) - padding,
      maxY: Math.max(...ys) + padding,
    };
  }, [locations]);

  const mapWidth = bounds.maxX - bounds.minX;
  const mapHeight = bounds.maxY - bounds.minY;

  // Convert world position to SVG position
  const toSvgPos = useCallback((pos: { x: number; y: number }) => ({
    x: ((pos.x - bounds.minX) / mapWidth) * 800,
    y: ((pos.y - bounds.minY) / mapHeight) * 600,
  }), [bounds, mapWidth, mapHeight]);

  // Handle location click
  const handleLocationClick = useCallback((locationId: string) => {
    if (discoveredLocations.has(locationId)) {
      navigate(`/game/${campaignId}/location/${locationId}`);
    }
  }, [campaignId, navigate, discoveredLocations]);

  // Handle travel
  if (gameSession.isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Map className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Loading map...</p>
        </div>
      </div>
    );
  }

  if (!gameSession.isInitialized || !world || !travelState) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Map className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">
            {gameSession.error ?? "Map data is not ready yet."}
          </p>
          <Link to={`/game/${campaignId}`} className="mt-4 inline-block">
            <Button>Return to Game</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-b from-background to-muted/20">
      {/* Header */}
      <header className="glass-dark border-b border-border flex-shrink-0">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={`/game/${campaignId}`}>
              <Button variant="ghost" size="sm">
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Map className="w-5 h-5 text-primary" />
              <h1 className="font-display text-lg">World Map</h1>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              <MapPin className="w-3 h-3 mr-1" />
              {discoveredLocations.size} Discovered
            </Badge>
          </div>
        </div>
      </header>

      {/* Map Container */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="relative bg-card/50 rounded-xl border border-border shadow-xl overflow-hidden" style={{ width: '100%', maxWidth: '1000px', aspectRatio: '4/3' }}>
          {/* Background grid */}
          <div className="absolute inset-0 opacity-10">
            <svg width="100%" height="100%">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          </div>

          {/* Map SVG */}
          <svg viewBox="0 0 800 600" className="w-full h-full">
            {/* Connection Lines */}
            {locations.map(location => 
              location.connectedTo.map(targetId => {
                const target = locations.find(l => l.id === targetId);
                if (!target) return null;
                
                const from = toSvgPos(location.position);
                const to = toSvgPos(target.position);
                const isDiscovered = discoveredLocations.has(location.id) && discoveredLocations.has(targetId);
                
                return (
                  <line
                    key={`${location.id}-${targetId}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={isDiscovered ? "hsl(var(--primary))" : "hsl(var(--muted))"}
                    strokeWidth={isDiscovered ? 2 : 1}
                    strokeDasharray={isDiscovered ? "none" : "4 4"}
                    opacity={isDiscovered ? 0.6 : 0.3}
                  />
                );
              })
            )}

            {/* Location Nodes */}
            {locations.map(location => {
              const pos = toSvgPos(location.position);
              const isDiscovered = discoveredLocations.has(location.id);
              const isCurrent = location.id === currentLocationId;
              const enhanced = location as EnhancedLocation;
              
              const dangerColor = enhanced.dangerLevel <= 3 
                ? "hsl(142 76% 36%)" 
                : enhanced.dangerLevel <= 6 
                ? "hsl(45 93% 47%)" 
                : "hsl(0 84% 60%)";
              
              return (
                <g
                  key={location.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() => handleLocationClick(location.id)}
                  style={{ cursor: isDiscovered ? "pointer" : "default" }}
                >
                  {/* Glow effect for current location */}
                  {isCurrent && (
                    <motion.circle
                      r={30}
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      initial={{ opacity: 0.5, scale: 1 }}
                      animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.2, 1] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                    />
                  )}
                  
                  {/* Location circle */}
                  <motion.circle
                    r={isDiscovered ? 20 : 12}
                    fill={isDiscovered ? "hsl(var(--card))" : "hsl(var(--muted))"}
                    stroke={isCurrent ? "hsl(var(--primary))" : isDiscovered ? dangerColor : "hsl(var(--border))"}
                    strokeWidth={isCurrent ? 3 : 2}
                    whileHover={isDiscovered ? { scale: 1.1 } : undefined}
                  />
                  
                  {/* Location icon */}
                  {isDiscovered && (
                    <foreignObject x={-10} y={-10} width={20} height={20}>
                      <div className="flex items-center justify-center w-full h-full text-foreground">
                        {LOCATION_ICONS[enhanced.type] || <MapPin className="w-4 h-4" />}
                      </div>
                    </foreignObject>
                  )}
                  
                  {/* Question mark for undiscovered */}
                  {!isDiscovered && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="12"
                      fill="hsl(var(--muted-foreground))"
                    >
                      ?
                    </text>
                  )}
                  
                  {/* Location name */}
                  {isDiscovered && (
                    <text
                      y={30}
                      textAnchor="middle"
                      fontSize="11"
                      fill="hsl(var(--foreground))"
                      className="font-display"
                    >
                      {location.name}
                    </text>
                  )}
                  
                  {/* Player marker */}
                  {isCurrent && (
                    <motion.g
                      initial={{ y: -5 }}
                      animate={{ y: [-5, -8, -5] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                    >
                      <circle cy={-30} r={6} fill="hsl(var(--primary))" />
                      <polygon
                        points="0,-20 -4,-26 4,-26"
                        fill="hsl(var(--primary))"
                      />
                    </motion.g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm rounded-lg border border-border p-3">
            <div className="text-xs font-display mb-2">Legend</div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <span>Your Location</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full border-2 border-green-500 bg-card" />
                <span>Safe (1-3)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full border-2 border-yellow-500 bg-card" />
                <span>Moderate (4-6)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full border-2 border-destructive bg-card" />
                <span>Dangerous (7-10)</span>
              </div>
            </div>
          </div>

          {/* Current Location Info */}
          {currentLocationId && (
            <div className="absolute top-4 right-4 bg-card/90 backdrop-blur-sm rounded-lg border border-border p-3 max-w-xs">
              {(() => {
                const current = locations.find(l => l.id === currentLocationId);
                if (!current) return null;
                const enhanced = current as EnhancedLocation;
                
                return (
                  <>
                    <div className="flex items-center gap-2 mb-1">
                      <MapPin className="w-4 h-4 text-primary" />
                      <span className="font-display text-sm">{current.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{enhanced.type}</p>
                    <Link to={`/game/${campaignId}/location/${currentLocationId}`}>
                      <Button size="sm" className="w-full">
                        View Location
                      </Button>
                    </Link>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
