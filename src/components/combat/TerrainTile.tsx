import { motion } from "framer-motion";

export type TerrainType = 
  | "stone" 
  | "grass" 
  | "water" 
  | "lava" 
  | "ice" 
  | "sand" 
  | "wood" 
  | "void"
  | "wall"
  | "pillar"
  | "chest"
  | "door";

interface TerrainTileProps {
  type: TerrainType;
  size: number;
}

const terrainStyles: Record<TerrainType, {
  background: string;
  border?: string;
  icon?: string;
  animated?: boolean;
}> = {
  stone: {
    background: "linear-gradient(135deg, #4a4a4a 0%, #3a3a3a 50%, #2a2a2a 100%)",
    border: "rgba(60,60,60,0.5)",
  },
  grass: {
    background: "linear-gradient(135deg, #2d5a27 0%, #1e4620 50%, #163518 100%)",
    border: "rgba(30,70,32,0.5)",
  },
  water: {
    background: "linear-gradient(135deg, #1e4a6e 0%, #1a3d5c 50%, #15304a 100%)",
    border: "rgba(30,74,110,0.5)",
    animated: true,
  },
  lava: {
    background: "linear-gradient(135deg, #8b2500 0%, #a83200 50%, #c44000 100%)",
    border: "rgba(139,37,0,0.8)",
    animated: true,
  },
  ice: {
    background: "linear-gradient(135deg, #88c8e8 0%, #6ab8dc 50%, #4ca8d0 100%)",
    border: "rgba(136,200,232,0.5)",
  },
  sand: {
    background: "linear-gradient(135deg, #c4a35a 0%, #b89b52 50%, #a8894a 100%)",
    border: "rgba(196,163,90,0.5)",
  },
  wood: {
    background: "linear-gradient(135deg, #5c4033 0%, #4a3429 50%, #38281f 100%)",
    border: "rgba(92,64,51,0.5)",
  },
  void: {
    background: "linear-gradient(135deg, #0a0a0a 0%, #000000 50%, #050505 100%)",
    border: "rgba(20,20,20,0.8)",
  },
  wall: {
    background: "linear-gradient(135deg, #555555 0%, #444444 50%, #333333 100%)",
    border: "rgba(80,80,80,0.8)",
    icon: "🧱",
  },
  pillar: {
    background: "linear-gradient(135deg, #666666 0%, #555555 50%, #444444 100%)",
    border: "rgba(100,100,100,0.8)",
    icon: "🏛️",
  },
  chest: {
    background: "linear-gradient(135deg, #5c4033 0%, #4a3429 50%, #38281f 100%)",
    border: "rgba(196,163,90,0.8)",
    icon: "📦",
  },
  door: {
    background: "linear-gradient(135deg, #6b4423 0%, #593a1e 50%, #472f18 100%)",
    border: "rgba(107,68,35,0.8)",
    icon: "🚪",
  },
};

const TerrainTile = ({ type, size }: TerrainTileProps) => {
  const style = terrainStyles[type];

  return (
    <motion.div
      className="w-full h-full relative overflow-hidden"
      style={{
        background: style.background,
        boxShadow: `inset 0 0 ${size / 4}px rgba(0,0,0,0.3)`,
      }}
    >
      {/* Texture overlay */}
      <div 
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Ccircle cx='3' cy='3' r='1'/%3E%3Ccircle cx='13' cy='13' r='1'/%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      {/* Animated effects for water/lava */}
      {style.animated && (
        <motion.div
          className="absolute inset-0 opacity-30"
          animate={{
            background: type === "water" 
              ? [
                  "radial-gradient(ellipse at 20% 30%, rgba(255,255,255,0.3) 0%, transparent 50%)",
                  "radial-gradient(ellipse at 80% 70%, rgba(255,255,255,0.3) 0%, transparent 50%)",
                  "radial-gradient(ellipse at 20% 30%, rgba(255,255,255,0.3) 0%, transparent 50%)",
                ]
              : [
                  "radial-gradient(ellipse at 30% 40%, rgba(255,200,0,0.4) 0%, transparent 50%)",
                  "radial-gradient(ellipse at 70% 60%, rgba(255,200,0,0.4) 0%, transparent 50%)",
                  "radial-gradient(ellipse at 30% 40%, rgba(255,200,0,0.4) 0%, transparent 50%)",
                ],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Icon for special terrain */}
      {style.icon && (
        <div 
          className="absolute inset-0 flex items-center justify-center"
          style={{ fontSize: size * 0.5 }}
        >
          {style.icon}
        </div>
      )}

      {/* Border */}
      <div 
        className="absolute inset-0 border"
        style={{ borderColor: style.border }}
      />
    </motion.div>
  );
};

export default TerrainTile;