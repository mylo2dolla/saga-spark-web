import { Outlet, useParams } from "react-router-dom";
import { GameSessionProvider } from "@/contexts/GameSessionContext";
import NotFound from "@/pages/NotFound";
import DevDebugOverlay from "@/components/debug/DevDebugOverlay";

export default function GameSessionRoute() {
  const { campaignId } = useParams();
  if (!campaignId) {
    return <NotFound />;
  }

  return (
    <GameSessionProvider campaignId={campaignId}>
      <Outlet />
      <DevDebugOverlay />
    </GameSessionProvider>
  );
}
