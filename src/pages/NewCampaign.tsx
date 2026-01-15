/**
 * Campaign creation page with seed definition.
 * Players define title/description which influences the entire generated world.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Wand2, 
  Scroll, 
  Swords, 
  Crown, 
  Skull, 
  Mountain,
  Sparkles,
  ArrowRight,
  Loader2,
  RefreshCw,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useWorldGenerator } from "@/hooks/useWorldGenerator";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

// Preset campaign themes
const CAMPAIGN_PRESETS = [
  {
    id: "dark-fantasy",
    title: "The Ashen Throne",
    description: "A kingdom consumed by shadow where the dead walk and ancient evils stir. The last king lies dying, and darkness spreads from the cursed mountains.",
    themes: ["dark fantasy", "undead", "political intrigue"],
    icon: Skull,
  },
  {
    id: "high-adventure",
    title: "The Dragon's Hoard",
    description: "Legendary treasures await in forgotten dungeons. Ancient dragons guard untold riches, and brave adventurers seek fame and fortune across the realm.",
    themes: ["high fantasy", "treasure hunting", "dragons"],
    icon: Crown,
  },
  {
    id: "mystery",
    title: "Shadows of Thornwood",
    description: "A quiet village harbors dark secrets. Strange disappearances, whispered conspiracies, and an ancient forest that seems to watch your every move.",
    themes: ["mystery", "horror", "investigation"],
    icon: Mountain,
  },
  {
    id: "war",
    title: "The Shattered Alliance",
    description: "War engulfs the continent. Armies clash, alliances crumble, and heroes must choose their side in a conflict that will reshape the world forever.",
    themes: ["war", "military", "politics"],
    icon: Swords,
  },
];

const THEME_SUGGESTIONS = [
  "Dark Fantasy", "High Fantasy", "Steampunk", "Horror",
  "Mystery", "Political Intrigue", "War", "Exploration",
  "Treasure Hunting", "Undead", "Dragons", "Demons",
  "Pirates", "Wilderness", "Urban", "Planar",
];

export default function NewCampaign() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { generateInitialWorld, isGenerating } = useWorldGenerator();
  
  const [step, setStep] = useState<"choose" | "customize" | "generating">("choose");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedThemes, setSelectedThemes] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const handlePresetSelect = (preset: typeof CAMPAIGN_PRESETS[0]) => {
    setTitle(preset.title);
    setDescription(preset.description);
    setSelectedThemes(preset.themes);
    setStep("customize");
  };

  const handleCustom = () => {
    setTitle("");
    setDescription("");
    setSelectedThemes([]);
    setStep("customize");
  };

  const toggleTheme = (theme: string) => {
    const lower = theme.toLowerCase();
    if (selectedThemes.includes(lower)) {
      setSelectedThemes(selectedThemes.filter(t => t !== lower));
    } else if (selectedThemes.length < 5) {
      setSelectedThemes([...selectedThemes, lower]);
    }
  };

  const handleRandomize = () => {
    const titles = [
      "The Crimson Prophecy",
      "Echoes of the Fallen",
      "The Last Vigil",
      "Secrets of the Deep",
      "The Wanderer's Path",
      "Shadows of the Past",
      "The Broken Crown",
      "Whispers in the Dark",
    ];
    const descriptions = [
      "An ancient prophecy stirs in the hearts of mortals. Long-forgotten powers awaken, and the fate of the realm hangs by a thread.",
      "In the aftermath of a great calamity, survivors struggle to rebuild. But something sinister lurks in the ruins of the old world.",
      "The last defenders of a dying order must stand against an encroaching darkness. Their vigil may be the world's final hope.",
      "Beneath the waves lies a civilization thought lost to time. Its secrets could save the world—or doom it forever.",
    ];
    
    setTitle(titles[Math.floor(Math.random() * titles.length)]);
    setDescription(descriptions[Math.floor(Math.random() * descriptions.length)]);
    
    const randomThemes = THEME_SUGGESTIONS
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map(t => t.toLowerCase());
    setSelectedThemes(randomThemes);
  };

  const handleCreate = async () => {
    if (!user) {
      toast.error("You must be logged in to create a campaign");
      return;
    }
    
    if (!title.trim() || !description.trim()) {
      toast.error("Please provide a title and description");
      return;
    }

    setIsCreating(true);
    setStep("generating");

    try {
      // Create the campaign in the database
      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      const { data: campaign, error: campaignError } = await supabase
        .from("campaigns")
        .insert({
          name: title,
          description: description,
          owner_id: user.id,
          invite_code: inviteCode,
          is_active: true,
        })
        .select()
        .single();

      if (campaignError) throw campaignError;

      // Add owner as campaign member
      const { error: memberError } = await supabase.from("campaign_members").insert({
        campaign_id: campaign.id,
        user_id: user.id,
        is_dm: true,
      });
      if (memberError) throw memberError;

      // Generate the initial world using AI
      const generatedWorld = await generateInitialWorld({
        title,
        description,
        themes: selectedThemes,
      });

      if (generatedWorld) {
        // Store the generated content - cast to Json for Supabase
        const contentToStore = [
          ...generatedWorld.factions.map(f => ({
            campaign_id: campaign.id,
            content_type: "faction",
            content_id: f.id,
            content: JSON.parse(JSON.stringify(f)) as Json,
            generation_context: { title, description, themes: selectedThemes } as Json,
          })),
          ...generatedWorld.npcs.map((npc, i) => ({
            campaign_id: campaign.id,
            content_type: "npc",
            content_id: `npc_initial_${i}`,
            content: JSON.parse(JSON.stringify(npc)) as Json,
            generation_context: { title, description, themes: selectedThemes } as Json,
          })),
          {
            campaign_id: campaign.id,
            content_type: "quest",
            content_id: "initial_quest",
            content: JSON.parse(JSON.stringify(generatedWorld.initialQuest)) as Json,
            generation_context: { title, description, themes: selectedThemes } as Json,
          },
          {
            campaign_id: campaign.id,
            content_type: "location",
            content_id: "starting_location",
            content: JSON.parse(JSON.stringify(generatedWorld.startingLocation)) as Json,
            generation_context: { title, description, themes: selectedThemes } as Json,
          },
        ];

        const { error: contentError } = await supabase
          .from("ai_generated_content")
          .insert(contentToStore);
        if (contentError) throw contentError;

        // Update campaign with current scene
        const { error: sceneError } = await supabase
          .from("campaigns")
          .update({ current_scene: generatedWorld.startingLocation.name })
          .eq("id", campaign.id);
        if (sceneError) throw sceneError;
      }

      toast.success("Campaign created! Your world awaits...");
      navigate(`/game/${campaign.id}/create-character`);
    } catch (error) {
      console.error("Failed to create campaign:", error);
      toast.error("Failed to create campaign");
      setStep("customize");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ChevronLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <h1 className="font-display text-xl">Create New Campaign</h1>
          <div className="w-32" />
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <AnimatePresence mode="wait">
          {/* Step 1: Choose a starting point */}
          {step === "choose" && (
            <motion.div
              key="choose"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center">
                <h2 className="font-display text-3xl mb-2">Choose Your Tale</h2>
                <p className="text-muted-foreground">
                  Select a preset to get started quickly, or create your own unique world
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {CAMPAIGN_PRESETS.map((preset) => (
                  <Card
                    key={preset.id}
                    className="cursor-pointer hover:border-primary transition-colors"
                    onClick={() => handlePresetSelect(preset)}
                  >
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10">
                          <preset.icon className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="font-display">{preset.title}</CardTitle>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="text-sm line-clamp-3">
                        {preset.description}
                      </CardDescription>
                      <div className="flex gap-2 mt-3 flex-wrap">
                        {preset.themes.map(theme => (
                          <Badge key={theme} variant="secondary" className="text-xs">
                            {theme}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="text-center">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={handleCustom}
                  className="gap-2"
                >
                  <Scroll className="w-5 h-5" />
                  Write Your Own Story
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 2: Customize campaign details */}
          {step === "customize" && (
            <motion.div
              key="customize"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center">
                <h2 className="font-display text-3xl mb-2">Shape Your World</h2>
                <p className="text-muted-foreground">
                  The campaign seed influences NPCs, quests, factions, and the entire narrative
                </p>
              </div>

              <Card>
                <CardContent className="pt-6 space-y-6">
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={handleRandomize}>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Randomize
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="title">Campaign Title</Label>
                    <Input
                      id="title"
                      placeholder="The Ashen Throne, Echoes of the Fallen..."
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="font-display text-lg"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Campaign Description</Label>
                    <Textarea
                      id="description"
                      placeholder="Describe the world, the conflict, and what makes this campaign unique. This will influence everything from NPC personalities to quest themes..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={4}
                    />
                    <p className="text-xs text-muted-foreground">
                      Be descriptive! This is the seed that shapes your entire world.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Themes (select up to 5)</Label>
                    <div className="flex flex-wrap gap-2">
                      {THEME_SUGGESTIONS.map((theme) => {
                        const isSelected = selectedThemes.includes(theme.toLowerCase());
                        return (
                          <Badge
                            key={theme}
                            variant={isSelected ? "default" : "outline"}
                            className="cursor-pointer hover:bg-primary/20"
                            onClick={() => toggleTheme(theme)}
                          >
                            {theme}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep("choose")}>
                  <ChevronLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button
                  size="lg"
                  onClick={handleCreate}
                  disabled={!title.trim() || !description.trim() || isCreating}
                  className="gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Creating World...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-5 h-5" />
                      Create Campaign
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Generating world */}
          {step === "generating" && (
            <motion.div
              key="generating"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center py-20 text-center"
            >
              <div className="relative">
                <div className="absolute inset-0 animate-ping opacity-20">
                  <Sparkles className="w-20 h-20 text-primary" />
                </div>
                <Sparkles className="w-20 h-20 text-primary animate-pulse" />
              </div>
              
              <h2 className="font-display text-2xl mt-8 mb-4">
                Forging Your World
              </h2>
              
              <div className="space-y-2 text-muted-foreground">
                <p className="animate-pulse">Generating factions and allegiances...</p>
                <p className="animate-pulse delay-75">Creating NPCs with unique personalities...</p>
                <p className="animate-pulse delay-150">Weaving the threads of your first quest...</p>
                <p className="animate-pulse delay-200">Building your starting location...</p>
              </div>
              
              <div className="mt-8">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
