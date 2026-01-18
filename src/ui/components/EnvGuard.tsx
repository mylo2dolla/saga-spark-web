import type { ReactNode } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export default function EnvGuard({ children }: { children: ReactNode }) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-sm">
          <div className="mb-2 text-lg font-semibold text-foreground">Missing environment</div>
          <p className="text-muted-foreground">
            Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before running the app.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
