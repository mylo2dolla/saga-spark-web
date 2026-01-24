import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import ApiDebugPanel from "../components/ApiDebugPanel";
import { useDbHealth } from "@/ui/data/useDbHealth";
import { useDiagnostics } from "@/ui/data/diagnostics";

const buildSha = import.meta.env.VITE_GIT_SHA ?? "unknown";
const DEV_DEBUG = import.meta.env.DEV;

export default function AppShell() {
  const location = useLocation();
  const { user, isProfileCreating } = useAuth();
  const isLoginRoute = location.pathname === "/login" || location.pathname === "/signup";
  const shouldPollDb = Boolean(user) && !isLoginRoute;
  const { status, lastError } = useDbHealth(shouldPollDb);
  const { lastError: lastApiError, lastErrorAt, engineSnapshot } = useDiagnostics();
  const navLinks = [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/dashboard#create", label: "Create/Join" },
    { to: "/game", label: "Game" },
    { to: "/servers", label: "Servers/Admin" },
  ];
  useEffect(() => {
    if (!DEV_DEBUG) return;
    console.info("[auth] log", {
      step: "route_guard",
      route: location.pathname,
      hasSession: Boolean(user),
      bootstrapped: Boolean(user),
      skipGameHooks: isLoginRoute || !user,
    });
  }, [location.pathname, user]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-56 shrink-0 border-r border-border bg-card/40 p-4 md:block lg:w-64">
          <div className="mb-6 text-lg font-semibold">Saga Spark</div>
          <nav className="flex flex-col gap-2 text-sm">
            {navLinks.map(link => (
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
          <div className="border-b border-border bg-card/40 px-4 py-3 md:hidden">
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold">Saga Spark</div>
              <span className="text-xs text-muted-foreground">{location.pathname}</span>
            </div>
            <nav className="mt-2 flex flex-wrap gap-2 text-xs">
              {navLinks.map(link => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) =>
                    `rounded-md border border-transparent px-2 py-1 ${
                      isActive
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground"
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center justify-between border-b border-border bg-card/40 px-4 py-2 text-xs sm:text-sm">
            <div className="flex flex-wrap items-center gap-4">
              <span>Auth: {user?.email ?? "guest"}</span>
              {isProfileCreating ? <span>Profile: creating...</span> : null}
              <span>DB: {shouldPollDb ? (status === "ok" ? "ok" : status) : "paused"}</span>
              {lastError ? <span className="text-destructive">DB Error: {lastError}</span> : null}
            </div>
            <div className="hidden text-muted-foreground md:block">{location.pathname}</div>
          </div>

          <div className="flex-1 p-4 sm:p-6 lg:p-8">
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
          {DEV_DEBUG ? <ApiDebugPanel /> : null}
        </main>
      </div>
    </div>
  );
}
