import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppShell from "@/ui/app-shell/AppShell";
import { ErrorBoundary } from "@/ui/components/ErrorBoundary";
import { DiagnosticsProvider } from "@/ui/data/diagnostics";
import AuthScreen from "@/ui/screens/AuthScreen";
import DashboardScreen from "@/ui/screens/DashboardScreen";
import CharacterScreen from "@/ui/screens/CharacterScreen";
import GameScreen from "@/ui/screens/GameScreen";
import ServerAdminScreen from "@/ui/screens/ServerAdminScreen";
import GameSessionRoute from "./routes/GameSessionRoute";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <DiagnosticsProvider>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/game" element={<Navigate to="/dashboard" replace />} />
              <Route path="/login" element={<AuthScreen mode="login" />} />
              <Route path="/signup" element={<AuthScreen mode="signup" />} />
              <Route element={<AppShell />}>
                <Route path="/dashboard" element={<DashboardScreen />} />
                <Route path="/servers" element={<ServerAdminScreen />} />
                <Route path="/admin" element={<ServerAdminScreen />} />
                <Route path="/game/:campaignId" element={<GameSessionRoute />}>
                  <Route index element={<GameScreen />} />
                  <Route path="create-character" element={<CharacterScreen />} />
                </Route>
              </Route>
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </DiagnosticsProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
