import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const DEV_DEBUG = import.meta.env.DEV;

function AuthDebugPanelAuthed() {
  const location = useLocation();
  const { user, isLoading, lastAuthError } = useAuth();

  return (
    <div className="fixed bottom-2 left-2 z-[9999] max-w-xs rounded-md border border-border bg-card/95 p-2 text-[11px] text-muted-foreground">
      <div>session: {user ? "yes" : "no"}</div>
      <div>userId: {user?.id ?? "-"}</div>
      <div>authLoading: {String(isLoading)}</div>
      <div>route: {location.pathname}</div>
      <div>lastAuthError: {lastAuthError ? `${lastAuthError.message} (${lastAuthError.status ?? "-"})` : "none"}</div>
    </div>
  );
}

export default function AuthDebugPanel() {
  const location = useLocation();
  const isLoginRoute = location.pathname === "/login" || location.pathname === "/signup";

  if (!DEV_DEBUG || isLoginRoute) return null;
  return <AuthDebugPanelAuthed />;
}
