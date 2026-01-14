import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Swords,
  Users,
  Settings,
  ChevronLeft,
  Heart,
  Sparkles,
  Play,
  Loader2,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { 
  Dice3D, 
  CharacterSheet,
  CombatArena,
  type Character,
  type Ability
} from "@/components/combat";
import { DMChat } from "@/components/DMChat";
import { useDungeonMaster } from "@/hooks/useDungeonMaster";
import { useRealtimeCharacters, type GameCharacter, type CombatEnemy } from "@/hooks/useRealtimeGame";
import { useCharacter, type CharacterAbility } from "@/hooks/useCharacter";
import { supabase } from "@/integrations/supabase/client";
import type { GameEvent, Vec2 } from "@/engine";

// Convert GameCharacter to Character format (for character sheet compatibility)
function toGridCharacter(char: GameCharacter, initiative: number = 10): Character {
  return {
    id: char.id,
    name: char.name,
    class: char.class,
    level: char.level,
    hp: char.hp,
    maxHp: char.max_hp,
    ac: char.ac,
    initiative,
    position: char.position || { x: Math.floor(Math.random() * 5), y: Math.floor(Math.random() * 5) },
    statusEffects: char.status_effects,
    isEnemy: false,
  };
}

// Convert CharacterAbility to Ability format (for ability bar)
function toAbility(ability: CharacterAbility): Ability {
  return {
    id: ability.id,
    name: ability.name,
    type: ability.type as Ability["type"],
    description: ability.description,
    damage: ability.damage,
    range: ability.range,
    manaCost: ability.manaCost,
    cooldown: ability.cooldown,
  };
}

const Game = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const [showDice, setShowDice] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [campaign, setCampaign] = useState<{ name: string; current_scene: string | null } | null>(null);
  const [inCombat, setInCombat] = useState(false);
  
  // Real data hooks
  const { character: myCharacter, isLoading: charLoading } = useCharacter(campaignId);
  const { characters: partyCharacters, isLoading: partyLoading, updateCharacter } = useRealtimeCharacters(campaignId);

  const { 
    messages, 
    isLoading: dmLoading, 
    currentResponse, 
    sendMessage, 
    startNewAdventure 
  } = useDungeonMaster();

  // Fetch campaign data
  useEffect(() => {
    if (!campaignId) return;
    
    const fetchCampaign = async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("name, current_scene")
        .eq("id", campaignId)
        .maybeSingle();
      
      if (error) {
        console.error("Error fetching campaign:", error);
        return;
      }
      if (data) setCampaign(data);
    };
    
    fetchCampaign();
  }, [campaignId]);

  // Redirect to character creation if no character
  useEffect(() => {
    if (!charLoading && !myCharacter && campaignId) {
      navigate(`/game/${campaignId}/create-character`);
    }
  }, [charLoading, myCharacter, campaignId, navigate]);

  // Get last suggestions from DM
  const lastDMMessage = messages.filter(m => m.role === "assistant").pop();
  const suggestions = lastDMMessage?.parsed?.suggestions;

  // Create grid characters for party sidebar compatibility
  const gridCharacters: Character[] = useMemo(() => {
    return partyCharacters.map((c, i) => toGridCharacter(c, 20 - i));
  }, [partyCharacters]);

  // Convert party to engine entity format for CombatArena
  const combatEntities = useMemo(() => {
    return partyCharacters.map((c, i) => ({
      id: c.id,
      name: c.name,
      faction: "player" as const,
      position: { x: (i % 4) * 1 + 1, y: Math.floor(i / 4) * 1 + 4 } as Vec2,
      hp: c.hp,
      maxHp: c.max_hp,
      ac: c.ac,
      initiative: 10 + Math.floor(Math.random() * 10),
    }));
  }, [partyCharacters]);

  // Add some test enemies when combat starts
  const allCombatEntities = useMemo(() => {
    if (!inCombat) return combatEntities;
    
    // Add some enemies for testing
    const enemies = [
      { id: "enemy-1", name: "Goblin", faction: "enemy" as const, position: { x: 8, y: 2 } as Vec2, hp: 12, maxHp: 12, ac: 13, initiative: 15 },
      { id: "enemy-2", name: "Orc", faction: "enemy" as const, position: { x: 9, y: 3 } as Vec2, hp: 20, maxHp: 20, ac: 14, initiative: 12 },
    ];
    return [...combatEntities, ...enemies];
  }, [combatEntities, inCombat]);

  // Handle engine events
  const handleEngineEvent = useCallback((event: GameEvent) => {
    console.log("Engine event:", event);
    
    // Sync damage back to database
    if (event.type === "entity_damaged" && event.entityId && event.value) {
      const char = partyCharacters.find(c => c.id === event.entityId);
      if (char) {
        updateCharacter(char.id, { hp: Math.max(0, char.hp - event.value) });
      }
    }
    
    if (event.type === "entity_healed" && event.entityId && event.value) {
      const char = partyCharacters.find(c => c.id === event.entityId);
      if (char) {
        updateCharacter(char.id, { hp: Math.min(char.max_hp, char.hp + event.value) });
      }
    }
    
    // Show toast for significant events
    if (event.type === "entity_died") {
      toast.error(event.description);
    }
    if (event.type === "combat_ended") {
      toast.success(event.description);
      setInCombat(false);
    }
  }, [partyCharacters, updateCharacter]);

  const handleSendMessage = (message: string) => {
    const context = {
      party: partyCharacters.map(c => ({
        name: c.name,
        class: c.class,
        level: c.level,
        hp: c.hp,
        maxHp: c.max_hp,
      })),
      location: campaign?.current_scene || "Unknown",
      campaignName: campaign?.name || "Adventure",
      inCombat,
    };
    sendMessage(message, context);
  };

  const handleStartAdventure = () => {
    const context = {
      party: partyCharacters.map(c => ({
        name: c.name,
        class: c.class,
        level: c.level,
        hp: c.hp,
        maxHp: c.max_hp,
      })),
      location: "Unknown",
      campaignName: campaign?.name || "New Adventure",
    };
    startNewAdventure(context);
  };

  const handleToggleCombat = () => {
    setInCombat(!inCombat);
  };

  // Loading state
  if (charLoading || partyLoading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading adventure...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="glass-dark border-b border-border flex-shrink-0">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm"><ChevronLeft className="w-4 h-4 mr-1" />Back</Button>
            </Link>
            <div className="hidden sm:block">
              <h1 className="font-display text-lg text-foreground">{campaign?.name || "Adventure"}</h1>
              <p className="text-xs text-muted-foreground">
                {myCharacter ? `Playing as ${myCharacter.name}` : "Loading..."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={showDice ? "default" : "ghost"} size="sm" onClick={() => setShowDice(!showDice)}>
              <Sparkles className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm"><Settings className="w-4 h-4" /></Button>
          </div>
        </div>
      </header>

      {/* Main Game Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: AI DM Chat Panel */}
        <div className={`${inCombat ? "w-1/3 hidden lg:flex" : "flex-1"} flex-col min-w-0 flex`}>
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-md"
              >
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/20 flex items-center justify-center">
                  <Sparkles className="w-10 h-10 text-primary" />
                </div>
                <h2 className="font-display text-2xl mb-4">Welcome, {myCharacter?.name || "Adventurer"}</h2>
                <p className="text-muted-foreground mb-8">
                  The AI Dungeon Master awaits to guide you through perilous dungeons, 
                  ancient mysteries, and epic battles. Your story begins now.
                </p>
                <Button onClick={handleStartAdventure} size="lg" className="gap-2" disabled={dmLoading}>
                  <Play className="w-5 h-5" />
                  Begin Your Adventure
                </Button>
              </motion.div>
            </div>
          ) : (
            <>
              <DMChat
                messages={messages}
                isLoading={dmLoading}
                currentResponse={currentResponse}
                onSendMessage={handleSendMessage}
                suggestions={suggestions}
              />
              {showDice && (
                <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} className="border-t border-border p-4">
                  <Dice3D size="md" />
                </motion.div>
              )}
            </>
          )}
        </div>

        {/* Center: Combat Arena (engine-driven) */}
        {inCombat && (
          <div className="flex-1 flex flex-col">
            <CombatArena
              initialEntities={allCombatEntities}
              myEntityId={myCharacter?.id}
              rows={10}
              cols={12}
              onEvent={handleEngineEvent}
            />
          </div>
        )}

        {/* Right: Party Sidebar */}
        <aside className="w-72 border-l border-border bg-card/30 hidden lg:flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <h2 className="font-display text-sm uppercase">Party ({partyCharacters.length})</h2>
            </div>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3">
              {partyCharacters.map((member) => {
                const gridChar = gridCharacters.find(c => c.id === member.id);
                return (
                  <div 
                    key={member.id} 
                    onClick={() => gridChar && setSelectedCharacter(gridChar)} 
                    className={`card-parchment rounded-lg p-3 cursor-pointer hover:border-primary/50 transition-colors ${
                      member.id === myCharacter?.id ? "ring-2 ring-primary/50" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-display text-sm">{member.name}</span>
                      <span className="text-xs text-muted-foreground">{member.class}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Heart className="w-3 h-3 text-destructive" />
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <motion.div 
                          className={`h-full ${member.hp / member.max_hp > 0.5 ? "bg-green-500" : member.hp / member.max_hp > 0.25 ? "bg-yellow-500" : "bg-destructive"}`}
                          initial={false}
                          animate={{ width: `${(member.hp / member.max_hp) * 100}%` }}
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{member.hp}/{member.max_hp}</span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      {member.id === myCharacter?.id && (
                        <span className="text-xs text-primary">You</span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        ({member.position?.x || 0}, {member.position?.y || 0})
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <div className="p-4 border-t border-border space-y-2">
            <Button 
              variant={inCombat ? "destructive" : "default"} 
              className="w-full" 
              onClick={handleToggleCombat}
            >
              <Swords className="w-4 h-4 mr-2" />
              {inCombat ? "Exit Combat" : "Enter Combat"}
            </Button>
          </div>
        </aside>

        {/* Character Sheet Modal */}
        <AnimatePresence>
          {selectedCharacter && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80"
              onClick={() => setSelectedCharacter(null)}
            >
              <motion.div onClick={(e) => e.stopPropagation()}>
                {(() => {
                  const fullChar = partyCharacters.find(c => c.id === selectedCharacter.id);
                  if (!fullChar) {
                    return (
                      <CharacterSheet 
                        character={{ 
                          ...selectedCharacter, 
                          stats: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 }, 
                          xp: 0, 
                          xpToNext: 100, 
                          abilities: [] 
                        }} 
                        onClose={() => setSelectedCharacter(null)} 
                      />
                    );
                  }
                  
                  return (
                    <CharacterSheet 
                      character={{ 
                        ...selectedCharacter, 
                        stats: fullChar.stats, 
                        xp: fullChar.xp, 
                        xpToNext: fullChar.xp_to_next, 
                        abilities: fullChar.abilities.map(toAbility)
                      }} 
                      onClose={() => setSelectedCharacter(null)} 
                    />
                  );
                })()}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Game;
