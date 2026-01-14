import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  MapPin, 
  Compass, 
  Mountain, 
  TreePine, 
  Castle, 
  Skull,
  Home,
  Sparkles,
  Lock,
  ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Location {
  id: string;
  name: string;
  type: "town" | "dungeon" | "forest" | "mountain" | "castle" | "special";
  position: { x: number; y: number };
  discovered: boolean;
  visited: boolean;
  currentLocation: boolean;
  description?: string;
  connections: string[];
}

interface WorldMapProps {
  locations: Location[];
  partyPosition: { x: number; y: number };
  onLocationClick: (location: Location) => void;
  onTravel: (locationId: string) => void;
  canTravel: boolean;
}

const locationIcons: Record<Location["type"], typeof MapPin> = {
  town: Home,
  dungeon: Skull,
  forest: TreePine,
  mountain: Mountain,
  castle: Castle,
  special: Sparkles,
};

const locationColors: Record<Location["type"], string> = {
  town: "from-amber-500 to-amber-700",
  dungeon: "from-red-600 to-red-800",
  forest: "from-green-500 to-green-700",
  mountain: "from-stone-400 to-stone-600",
  castle: "from-purple-500 to-purple-700",
  special: "from-primary to-amber-500",
};

const WorldMap = ({
  locations,
  partyPosition,
  onLocationClick,
  onTravel,
  canTravel,
}: WorldMapProps) => {
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [hoveredLocation, setHoveredLocation] = useState<string | null>(null);

  const handleLocationClick = (location: Location) => {
    if (!location.discovered) return;
    setSelectedLocation(location);
    onLocationClick(location);
  };

  // Draw connection lines between locations
  const renderConnections = () => {
    const lines: JSX.Element[] = [];
    const drawnPairs = new Set<string>();

    locations.forEach((loc) => {
      if (!loc.discovered) return;
      
      loc.connections.forEach((connId) => {
        const pairKey = [loc.id, connId].sort().join("-");
        if (drawnPairs.has(pairKey)) return;
        drawnPairs.add(pairKey);

        const connectedLoc = locations.find(l => l.id === connId);
        if (!connectedLoc?.discovered) return;

        lines.push(
          <motion.line
            key={pairKey}
            x1={`${loc.position.x}%`}
            y1={`${loc.position.y}%`}
            x2={`${connectedLoc.position.x}%`}
            y2={`${connectedLoc.position.y}%`}
            stroke="hsl(var(--border))"
            strokeWidth="2"
            strokeDasharray="5,5"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1, delay: 0.5 }}
          />
        );
      });
    });

    return lines;
  };

  return (
    <div className="relative w-full aspect-video bg-gradient-to-br from-stone-900 via-stone-800 to-stone-900 rounded-xl border border-border overflow-hidden">
      {/* Map background texture */}
      <div 
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM12 86c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm28-65c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm23-11c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-6 60c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm29 22c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zM32 63c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm57-13c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-9-21c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM60 91c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM35 41c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 60c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2z' fill='%23ffffff' fill-opacity='0.1' fill-rule='evenodd'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Compass */}
      <div className="absolute top-4 right-4 z-10">
        <motion.div
          animate={{ rotate: [0, 5, -5, 0] }}
          transition={{ duration: 10, repeat: Infinity }}
          className="w-12 h-12 rounded-full bg-card/80 border border-border flex items-center justify-center"
        >
          <Compass className="w-6 h-6 text-primary" />
        </motion.div>
      </div>

      {/* Map title */}
      <div className="absolute top-4 left-4 z-10">
        <div className="bg-card/80 backdrop-blur-sm border border-border rounded-lg px-4 py-2">
          <h2 className="font-display text-lg text-foreground">World Map</h2>
        </div>
      </div>

      {/* SVG for connections */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {renderConnections()}
      </svg>

      {/* Locations */}
      {locations.map((location) => {
        const Icon = locationIcons[location.type];
        const isHovered = hoveredLocation === location.id;
        const isSelected = selectedLocation?.id === location.id;

        return (
          <motion.div
            key={location.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${location.position.x}%`,
              top: `${location.position.y}%`,
            }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: Math.random() * 0.5 }}
          >
            <motion.button
              onClick={() => handleLocationClick(location)}
              onMouseEnter={() => setHoveredLocation(location.id)}
              onMouseLeave={() => setHoveredLocation(null)}
              whileHover={{ scale: 1.2 }}
              whileTap={{ scale: 0.9 }}
              disabled={!location.discovered}
              className={`
                relative w-12 h-12 rounded-full
                flex items-center justify-center
                transition-all duration-200
                ${location.discovered 
                  ? `bg-gradient-to-br ${locationColors[location.type]} shadow-lg cursor-pointer`
                  : "bg-muted cursor-not-allowed"
                }
                ${isSelected ? "ring-4 ring-primary ring-offset-2 ring-offset-background" : ""}
                ${location.currentLocation ? "ring-2 ring-primary animate-pulse" : ""}
              `}
            >
              {location.discovered ? (
                <Icon className="w-6 h-6 text-white" />
              ) : (
                <Lock className="w-5 h-5 text-muted-foreground" />
              )}

              {/* Visited indicator */}
              {location.visited && (
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 border-2 border-background" />
              )}

              {/* Current location indicator */}
              {location.currentLocation && (
                <motion.div
                  className="absolute -bottom-6"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 1, repeat: Infinity }}
                >
                  <MapPin className="w-5 h-5 text-primary" />
                </motion.div>
              )}
            </motion.button>

            {/* Hover tooltip */}
            <AnimatePresence>
              {isHovered && location.discovered && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-20"
                >
                  <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-xl whitespace-nowrap">
                    <div className="font-display text-sm font-medium">{location.name}</div>
                    <div className="text-xs text-muted-foreground capitalize">{location.type}</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}

      {/* Selected location panel */}
      <AnimatePresence>
        {selectedLocation && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute bottom-4 right-4 w-72 bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-xl overflow-hidden"
          >
            <div className={`h-2 bg-gradient-to-r ${locationColors[selectedLocation.type]}`} />
            <div className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${locationColors[selectedLocation.type]} flex items-center justify-center`}>
                  {(() => {
                    const Icon = locationIcons[selectedLocation.type];
                    return <Icon className="w-5 h-5 text-white" />;
                  })()}
                </div>
                <div>
                  <h3 className="font-display font-medium">{selectedLocation.name}</h3>
                  <p className="text-xs text-muted-foreground capitalize">{selectedLocation.type}</p>
                </div>
              </div>

              {selectedLocation.description && (
                <p className="text-sm text-muted-foreground mb-4">
                  {selectedLocation.description}
                </p>
              )}

              {!selectedLocation.currentLocation && canTravel && (
                <Button 
                  className="w-full gap-2"
                  onClick={() => onTravel(selectedLocation.id)}
                >
                  Travel Here
                  <ChevronRight className="w-4 h-4" />
                </Button>
              )}

              {selectedLocation.currentLocation && (
                <div className="text-center text-sm text-primary">
                  <MapPin className="w-4 h-4 inline mr-1" />
                  You are here
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fog of war edges */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, transparent 50%, hsl(var(--background) / 0.8) 100%)",
        }}
      />
    </div>
  );
};

export default WorldMap;