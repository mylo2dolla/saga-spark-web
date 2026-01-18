import type { ReactNode } from "react";
import { getSupabaseConfigInfo } from "@/ui/data/supabaseConfig";

export default function EnvGuard({ children }: { children: ReactNode }) {
  const config = getSupabaseConfigInfo();
  if (config.errors.length > 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-sm">
          <div className="mb-2 text-lg font-semibold text-foreground">Supabase configuration error</div>
          <p className="text-muted-foreground">
            Fix the following configuration issues before running the app:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
            {config.errors.map(error => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <div className="mt-4 rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
            <div>Host: {config.host ?? "-"}</div>
            <div>Anon key length: {config.keyLength}</div>
            <div>Anon key: {config.maskedKey ?? "-"}</div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
