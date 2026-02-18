import { Outlet, useParams } from "react-router-dom";
import NotFound from "@/pages/NotFound";
import DevDebugOverlay from "@/components/debug/DevDebugOverlay";
import { useAuth } from "@/hooks/useAuth";

export default function GameSessionRoute() {
  const { campaignId } = useParams();
  const { user, isLoading } = useAuth();
  if (!campaignId) {
    return <NotFound />;
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading session...</div>;
  }

  if (!user) {
    return <div className="text-sm text-muted-foreground">Login required.</div>;
  }

  return (
    <>
      <Outlet />
      <DevDebugOverlay />
    </>
  );
}
