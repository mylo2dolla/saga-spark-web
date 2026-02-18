import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorActions, type ErrorAction } from "@/ui/components/ErrorActions";

type AsyncState = "idle" | "loading" | "error" | "empty" | "success";

export function AsyncStateCard({
  title,
  state,
  message,
  actions = [],
  children,
}: {
  title: string;
  state: AsyncState;
  message?: string | null;
  actions?: ErrorAction[];
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{message ?? "Loading..."}</span>
          </div>
        ) : null}
        {state === "error" ? (
          <>
            <div className="text-sm text-destructive">{message ?? "Something went wrong."}</div>
            <ErrorActions actions={actions} />
          </>
        ) : null}
        {state === "empty" ? <div className="text-sm text-muted-foreground">{message ?? "No data."}</div> : null}
        {state === "success" || state === "idle" ? children : null}
      </CardContent>
    </Card>
  );
}

