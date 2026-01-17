import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDbHealth } from "@/ui/data/useDbHealth";
import { useDiagnostics } from "@/ui/data/diagnostics";

const buildSha = import.meta.env.VITE_GIT_SHA ?? "unknown";
const DEV_DEBUG = import.meta.env.DEV;

export default function AppShell() {
  const location = useLocation();
  const { user } = useAuth();
  const { status, lastError } = useDbHealth();
  const { lastError: lastApiError, lastErrorAt, engineSnapshot } = useDiagnostics();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-56 shrink-0 border-r border-border bg-card/40 p-4 md:block">
          <div className="mb-6 text-lg font-semibold">Saga Spark</div>
          <nav className="flex flex-col gap-2 text-sm">
            {[
              { to: "/dashboard", label: "Dashboard" },
              { to: "/dashboard#create", label: "Create/Join" },
              { to: "/game", label: "Game" },
              { to: "/servers", label: "Servers/Admin" },
            ].map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `rounded-md px-2 py-1 ${isActive ? "bg-primary/10 text-primary" : "text-muted-foreground"}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="flex min-h-screen flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border bg-card/40 px-4 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <span>Auth: {user?.email ?? "guest"}</span>
              <span>DB: {status === "ok" ? "ok" : status}</span>
              {lastError ? <span className="text-destructive">DB Error: {lastError}</span> : null}
            </div>
            <div className="text-muted-foreground">{location.pathname}</div>
          </div>

          <div className="flex-1 p-4">
            <Outlet />
          </div>

          {DEV_DEBUG ? (
            <div className="border-t border-border bg-card/40 px-4 py-2 text-[11px] text-muted-foreground">
              <div className="flex flex-wrap items-center gap-4">
                <span>Build: {buildSha}</span>
                <span>Route: {location.pathname}</span>
                <span>Last API Error: {lastApiError ?? "none"}</span>
                {lastErrorAt ? <span>At: {new Date(lastErrorAt).toLocaleTimeString()}</span> : null}
                {engineSnapshot ? (
                  <span>
                    Engine: {engineSnapshot.state ?? "unknown"} | {engineSnapshot.locationName ?? "?"}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
