import { Sparkles } from "lucide-react";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

const Logo = ({ size = "md", showText = true }: LogoProps) => {
  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-12 w-12",
  };

  const textClasses = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-3xl",
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <div className={`${sizeClasses[size]} text-primary animate-pulse-glow rounded-full bg-primary/20 flex items-center justify-center`}>
          <Sparkles className="w-2/3 h-2/3" />
        </div>
        <div className="absolute inset-0 bg-primary/30 blur-xl rounded-full" />
      </div>
      {showText && (
        <span className={`font-display font-bold text-glow-gold text-primary ${textClasses[size]}`}>
          MythWeaver
        </span>
      )}
    </div>
  );
};

export default Logo;
