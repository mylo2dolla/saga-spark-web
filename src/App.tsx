import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import AppShell from "@/ui/app-shell/AppShell";
import { ErrorBoundary } from "@/ui/components/ErrorBoundary";
import EnvGuard from "@/ui/components/EnvGuard";
import { DiagnosticsProvider } from "@/ui/data/diagnostics";
import { AuthProvider } from "@/contexts/AuthContext";
import AuthScreen from "@/ui/screens/AuthScreen";
import DashboardScreen from "@/ui/screens/DashboardScreen";
import MythicCharacterScreen from "@/ui/screens/MythicCharacterScreen";
import MythicGameScreen from "@/ui/screens/MythicGameScreen";
import ServerAdminScreen from "@/ui/screens/ServerAdminScreen";
import LandingScreen from "@/ui/screens/LandingScreen";
import GameSessionRoute from "./routes/GameSessionRoute";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function LegacyGameRedirect() {
  const { campaignId } = useParams();
  if (!campaignId) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to={`/mythic/${campaignId}`} replace />;
}

function LegacyCharacterRedirect() {
  const { campaignId } = useParams();
  if (!campaignId) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to={`/mythic/${campaignId}/create-character`} replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <EnvGuard>
        <AuthProvider>
          <BrowserRouter>
            <DiagnosticsProvider>
              <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<LandingScreen />} />
                  <Route path="/game" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/login" element={<AuthScreen mode="login" />} />
                  <Route path="/signup" element={<AuthScreen mode="signup" />} />
                  <Route path="/auth" element={<Navigate to="/login" replace />} />
                  <Route element={<AppShell />}>
                    <Route path="/dashboard" element={<DashboardScreen />} />
                    <Route path="/servers" element={<ServerAdminScreen />} />
                    <Route path="/admin" element={<ServerAdminScreen />} />
                    <Route path="/mythic/:campaignId" element={<GameSessionRoute />}>
                      <Route index element={<MythicGameScreen />} />
                      <Route path="create-character" element={<MythicCharacterScreen />} />
                    </Route>
                    <Route path="/game/:campaignId" element={<LegacyGameRedirect />} />
                    <Route path="/game/:campaignId/create-character" element={<LegacyCharacterRedirect />} />
                  </Route>
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </ErrorBoundary>
            </DiagnosticsProvider>
          </BrowserRouter>
        </AuthProvider>
      </EnvGuard>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
