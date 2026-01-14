import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { 
  Plus, 
  Users, 
  LogOut, 
  Scroll, 
  Clock, 
  Key,
  Copy,
  Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import Logo from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Mock campaigns for UI demo
const mockCampaigns = [
  {
    id: "1",
    name: "The Dragon's Lair",
    players: 4,
    lastPlayed: "2 hours ago",
    inviteCode: "DRAGON42"
  },
  {
    id: "2", 
    name: "Shadows of Neverwinter",
    players: 3,
    lastPlayed: "Yesterday",
    inviteCode: "SHADOW99"
  }
];

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [campaigns] = useState(mockCampaigns);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!session) {
          navigate("/login");
        } else {
          setUser(session.user);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate("/login");
      } else {
        setUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const handleCreateCampaign = () => {
    if (!newCampaignName.trim()) return;
    toast({
      title: "Campaign created!",
      description: `"${newCampaignName}" is ready for adventure.`,
    });
    setNewCampaignName("");
  };

  const handleJoinCampaign = () => {
    if (!joinCode.trim()) return;
    toast({
      title: "Joining campaign...",
      description: "Looking for the adventure party.",
    });
    setJoinCode("");
  };

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="glass-dark border-b border-border sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Logo size="md" />
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {user.email}
            </span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Welcome Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-2">
            Welcome, <span className="text-primary">Adventurer</span>
          </h1>
          <p className="text-muted-foreground">
            Choose a campaign to continue or start a new adventure
          </p>
        </motion.div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-4 mb-8">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="hero">
                <Plus className="w-4 h-4 mr-2" />
                Create Campaign
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Create New Campaign</DialogTitle>
                <DialogDescription>
                  Start a new adventure. An invite code will be generated for your party.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="campaign-name">Campaign Name</Label>
                  <Input
                    id="campaign-name"
                    placeholder="The Lost Mines of Phandelver"
                    value={newCampaignName}
                    onChange={(e) => setNewCampaignName(e.target.value)}
                    className="bg-input"
                  />
                </div>
                <Button onClick={handleCreateCampaign} className="w-full">
                  Create Campaign
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="arcane">
                <Key className="w-4 h-4 mr-2" />
                Join Campaign
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Join Campaign</DialogTitle>
                <DialogDescription>
                  Enter the invite code shared by your Dungeon Master
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-code">Invite Code</Label>
                  <Input
                    id="invite-code"
                    placeholder="DRAGON42"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    className="bg-input uppercase tracking-wider"
                  />
                </div>
                <Button onClick={handleJoinCampaign} variant="arcane" className="w-full">
                  Join Adventure
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Campaigns Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.map((campaign, index) => (
            <motion.div
              key={campaign.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="card-parchment rounded-xl overflow-hidden group cursor-pointer hover:border-primary/50 transition-colors"
            >
              <div className="h-32 bg-gradient-to-br from-primary/20 to-arcane/20 flex items-center justify-center">
                <Scroll className="w-12 h-12 text-primary/50 group-hover:text-primary transition-colors" />
              </div>
              <div className="p-6">
                <h3 className="font-display text-lg text-foreground mb-2">{campaign.name}</h3>
                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                  <span className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {campaign.players} players
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {campaign.lastPlayed}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/game/${campaign.id}`}>
                      Continue
                    </Link>
                  </Button>
                  <button
                    onClick={() => copyInviteCode(campaign.inviteCode)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    {copiedCode === campaign.inviteCode ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {campaign.inviteCode}
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {campaigns.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <Scroll className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="font-display text-xl text-foreground mb-2">No Campaigns Yet</h2>
            <p className="text-muted-foreground mb-6">
              Create your first campaign or join an existing one to begin
            </p>
          </motion.div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
