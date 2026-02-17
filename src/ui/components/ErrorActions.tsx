import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface ErrorAction {
  id: string;
  label: string;
  onClick: () => void | Promise<void>;
  variant?: "default" | "secondary" | "outline" | "destructive";
  disabled?: boolean;
}

export function ErrorActions({
  actions,
  leading,
}: {
  actions: ErrorAction[];
  leading?: ReactNode;
}) {
  if (!actions.length && !leading) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {leading}
      {actions.map((action) => (
        <Button
          key={action.id}
          size="sm"
          variant={action.variant ?? "outline"}
          onClick={() => void action.onClick()}
          disabled={action.disabled}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

