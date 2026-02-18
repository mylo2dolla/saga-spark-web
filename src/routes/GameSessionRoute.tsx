import { Outlet, useParams } from "react-router-dom";
import NotFound from "@/pages/NotFound";
import { useAuth } from "@/hooks/useAuth";

const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === "true";

export default function GameSessionRoute() {
  const { campaignId } = useParams();
  const { user, isLoading } = useAuth();
  if (!campaignId) {
    return <NotFound />;
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading session...</div>;
  }

  if (!user && !E2E_BYPASS_AUTH) {
    return <div className="text-sm text-muted-foreground">Login required.</div>;
  }

  return <Outlet />;
}
