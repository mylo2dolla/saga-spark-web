/**
 * Status effects display component.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Zap, 
  Heart, 
  ShieldCheck, 
  Flame, 
  Skull, 
  Snowflake,
  Clock
} from "lucide-react";
import type { EnhancedStatus, StatusCategory } from "@/engine/narrative/types";

interface StatusEffectsProps {
  statuses: readonly EnhancedStatus[];
  compact?: boolean;
}

export function StatusEffects({ statuses, compact = false }: StatusEffectsProps) {
  const buffs = statuses.filter(s => s.category === "buff");
  const debuffs = statuses.filter(s => s.category === "debuff");
  const neutrals = statuses.filter(s => s.category === "neutral");

  if (statuses.length === 0) {
    if (compact) return null;
    return (
      <Card className="w-full max-w-xs bg-card/95 backdrop-blur border-primary/20">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground text-center">
            No active effects
          </p>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {statuses.map(status => (
          <StatusBadge key={status.id} status={status} />
        ))}
      </div>
    );
  }

  return (
    <Card className="w-full max-w-xs bg-card/95 backdrop-blur border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          Status Effects
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {buffs.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-green-500 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Buffs
            </p>
            {buffs.map(status => (
              <StatusRow key={status.id} status={status} />
            ))}
          </div>
        )}

        {debuffs.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-red-500 flex items-center gap-1">
              <Skull className="w-3 h-3" />
              Debuffs
            </p>
            {debuffs.map(status => (
              <StatusRow key={status.id} status={status} />
            ))}
          </div>
        )}

        {neutrals.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Other
            </p>
            {neutrals.map(status => (
              <StatusRow key={status.id} status={status} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: EnhancedStatus }) {
  const categoryColors: Record<StatusCategory, string> = {
    buff: "bg-green-500/20 text-green-500 border-green-500/30",
    debuff: "bg-red-500/20 text-red-500 border-red-500/30",
    neutral: "bg-muted text-muted-foreground border-muted",
  };

  return (
    <Badge 
      variant="outline" 
      className={`text-xs ${categoryColors[status.category]}`}
    >
      {status.icon ?? "✨"} {status.name}
      {status.stacks > 1 && ` (${status.stacks})`}
      {status.duration > 0 && (
        <span className="ml-1 opacity-70">{status.duration}t</span>
      )}
    </Badge>
  );
}

function StatusRow({ status }: { status: EnhancedStatus }) {
  const categoryColors: Record<StatusCategory, string> = {
    buff: "text-green-500",
    debuff: "text-red-500",
    neutral: "text-muted-foreground",
  };

  const categoryBgColors: Record<StatusCategory, string> = {
    buff: "bg-green-500/10",
    debuff: "bg-red-500/10",
    neutral: "bg-muted/50",
  };

  return (
    <div className={`p-2 rounded-md ${categoryBgColors[status.category]}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-base">{status.icon ?? "✨"}</span>
          <span className={`text-sm font-medium ${categoryColors[status.category]}`}>
            {status.name}
          </span>
          {status.stacks > 1 && (
            <Badge variant="secondary" className="text-xs px-1">
              x{status.stacks}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          {status.duration === -1 ? "∞" : `${status.duration}t`}
        </div>
      </div>
      <p className="text-xs text-muted-foreground pl-6">
        {status.description}
      </p>
    </div>
  );
}

/**
 * Compact status bar for combat HUD
 */
interface StatusBarProps {
  statuses: readonly EnhancedStatus[];
}

export function StatusBar({ statuses }: StatusBarProps) {
  if (statuses.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {statuses.slice(0, 5).map(status => (
        <div
          key={status.id}
          className={`w-6 h-6 rounded-md flex items-center justify-center text-xs cursor-help ${
            status.category === "buff" 
              ? "bg-green-500/20 border border-green-500/30"
              : status.category === "debuff"
              ? "bg-red-500/20 border border-red-500/30"
              : "bg-muted border border-muted"
          }`}
          title={`${status.name}: ${status.description} (${status.duration}t)`}
        >
          {status.icon ?? "✨"}
        </div>
      ))}
      {statuses.length > 5 && (
        <span className="text-xs text-muted-foreground">
          +{statuses.length - 5}
        </span>
      )}
    </div>
  );
}
