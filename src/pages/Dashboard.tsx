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
  Check,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { useAuth } from "@/hooks/useAuth";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, profile, isLoading: authLoading, signOut } = useAuth();
  const { campaigns, isLoading: campaignsLoading, createCampaign, joinCampaign } = useCampaigns();
  
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignDescription, setNewCampaignDescription] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "Unknown error";

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login");
    }
  }, [user, authLoading, navigate]);

  const handleLogout = async () => {
    try {
      await signOut();
      navigate("/login");
    } catch (error: unknown) {
      toast({
        title: "Logout failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  const handleCreateCampaign = async () => {
    if (!newCampaignName.trim()) return;
    setIsCreating(true);
    
    try {
      const campaign = await createCampaign(newCampaignName, newCampaignDescription || undefined);
      toast({
        title: "Campaign created!",
        description: `"${campaign.name}" is ready. Invite code: ${campaign.invite_code}`,
      });
      setNewCampaignName("");
      setNewCampaignDescription("");
      setCreateDialogOpen(false);
    } catch (error: unknown) {
      toast({
        title: "Failed to create campaign",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinCampaign = async () => {
    if (!joinCode.trim()) return;
    setIsJoining(true);
    
    try {
      const campaign = await joinCampaign(joinCode);
      toast({
        title: "Joined campaign!",
        description: `Welcome to "${campaign.name}"!`,
      });
      setJoinCode("");
      setJoinDialogOpen(false);
    } catch (error: unknown) {
      toast({
        title: "Failed to join campaign",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsJoining(false);
    }
  };

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast({
      title: "Copied!",
      description: "Invite code copied to clipboard",
    });
    setTimeout(() => setCopiedCode(null), 2000);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  const displayName = profile?.display_name || user.email?.split("@")[0] || "Adventurer";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="glass-dark border-b border-border sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Logo size="md" />
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {displayName}
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
            Welcome, <span className="text-primary">{displayName}</span>
          </h1>
          <p className="text-muted-foreground">
            Choose a campaign to continue or start a new adventure
          </p>
        </motion.div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-4 mb-8">
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
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
                <div className="space-y-2">
                  <Label htmlFor="campaign-description">Description (optional)</Label>
                  <Textarea
                    id="campaign-description"
                    placeholder="A tale of adventure and mystery..."
                    value={newCampaignDescription}
                    onChange={(e) => setNewCampaignDescription(e.target.value)}
                    className="bg-input resize-none"
                    rows={3}
                  />
                </div>
                <Button 
                  onClick={handleCreateCampaign} 
                  className="w-full"
                  disabled={isCreating || !newCampaignName.trim()}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Campaign"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
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
                    placeholder="ABC123XY"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    className="bg-input uppercase tracking-wider"
                  />
                </div>
                <Button 
                  onClick={handleJoinCampaign} 
                  variant="arcane" 
                  className="w-full"
                  disabled={isJoining || !joinCode.trim()}
                >
                  {isJoining ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Joining...
                    </>
                  ) : (
                    "Join Adventure"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Loading State */}
        {campaignsLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {/* Campaigns Grid */}
        {!campaignsLoading && campaigns.length > 0 && (
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
                  {campaign.description && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                      {campaign.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                    <span className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      Party
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {formatDistanceToNow(new Date(campaign.updated_at), { addSuffix: true })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/game/${campaign.id}`}>
                        Continue
                      </Link>
                    </Button>
                    <button
                      onClick={() => copyInviteCode(campaign.invite_code)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                      {copiedCode === campaign.invite_code ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      {campaign.invite_code}
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!campaignsLoading && campaigns.length === 0 && (
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
