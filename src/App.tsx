import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import Game from "./pages/Game";
import CreateCharacter from "./pages/CreateCharacter";
import NewCampaign from "./pages/NewCampaign";
import LocationView from "./pages/LocationView";
import WorldMap from "./pages/WorldMap";
import NPCView from "./pages/NPCView";
import QuestView from "./pages/QuestView";
import CombatView from "./pages/CombatView";
import ServerDashboard from "./pages/ServerDashboard";
import NotFound from "./pages/NotFound";
import GameSessionRoute from "./routes/GameSessionRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/new-campaign" element={<NewCampaign />} />
          <Route path="/game/:campaignId" element={<GameSessionRoute />}>
            <Route index element={<Game />} />
            <Route path="create-character" element={<CreateCharacter />} />
            <Route path="map" element={<WorldMap />} />
            <Route path="location/:locationId" element={<LocationView />} />
            <Route path="npc/:npcId" element={<NPCView />} />
            <Route path="quest/:questId" element={<QuestView />} />
            <Route path="combat" element={<CombatView />} />
          </Route>
          <Route path="/admin" element={<ServerDashboard />} />
          <Route path="/servers" element={<ServerDashboard />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
