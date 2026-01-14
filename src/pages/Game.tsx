import { useState, useEffect } from "react";
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
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Dice3D, 
  CombatGrid, 
  TurnTracker, 
  AbilityBar, 
  CharacterSheet,
  FloatingDamage,
  useFloatingDamage,
  type Character,
  type Ability
} from "@/components/combat";
import { DMChat } from "@/components/DMChat";
import { useDungeonMaster } from "@/hooks/useDungeonMaster";
import { useRealtimeCharacters, useRealtimeCombat, type GameCharacter, type CombatEnemy } from "@/hooks/useRealtimeGame";
import { useCharacter, type CharacterAbility } from "@/hooks/useCharacter";
import { supabase } from "@/integrations/supabase/client";

// Convert GameCharacter to combat Character format
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

// Convert CombatEnemy to Character format
function enemyToGridCharacter(enemy: CombatEnemy): Character {
  return {
    id: enemy.id,
    name: enemy.name,
    class: "Monster",
    level: 1,
    hp: enemy.hp,
    maxHp: enemy.maxHp,
    ac: enemy.ac,
    initiative: enemy.initiative,
    position: enemy.position,
    isEnemy: true,
  };
}

// Convert CharacterAbility to Ability format
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
  const [selectedAbility, setSelectedAbility] = useState<Ability | null>(null);
  const [campaign, setCampaign] = useState<{ name: string; current_scene: string | null } | null>(null);
  const { damages, addDamage, removeDamage } = useFloatingDamage();
  
  // Real data hooks
  const { character: myCharacter, isLoading: charLoading, updateCharacter: updateMyCharacter } = useCharacter(campaignId);
  const { characters: partyCharacters, isLoading: partyLoading, updateCharacter } = useRealtimeCharacters(campaignId);
  const { 
    combatState, 
    isLoading: combatLoading, 
    startCombat, 
    endCombat, 
    nextTurn, 
    updateEnemies 
  } = useRealtimeCombat(campaignId);
  
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
      const { data } = await supabase
        .from("campaigns")
        .select("name, current_scene")
        .eq("id", campaignId)
        .single();
      
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

  // Combine party members and enemies for grid
  const inCombat = combatState?.is_active ?? false;
  const currentTurnIndex = combatState?.current_turn_index ?? 0;
  const roundNumber = combatState?.round_number ?? 1;
  
  // Create initiative map from combat state
  const initiativeMap = new Map<string, number>();
  combatState?.initiative_order?.forEach((id, index) => {
    initiativeMap.set(id, 20 - index); // Higher index = lower initiative
  });

  // Convert to grid characters
  const gridCharacters: Character[] = [
    ...partyCharacters.map(c => toGridCharacter(c, initiativeMap.get(c.id) ?? 10)),
    ...(combatState?.enemies || []).map(enemyToGridCharacter),
  ];

  // Get my character's abilities for the ability bar
  const myAbilities: Ability[] = myCharacter?.abilities?.map(toAbility) ?? [];

  // Handle effects from DM response
  useEffect(() => {
    if (lastDMMessage?.parsed?.effects) {
      lastDMMessage.parsed.effects.forEach(effect => {
        const targetChar = gridCharacters.find(c => c.name.toLowerCase() === effect.target.toLowerCase());
        if (targetChar && targetChar.position) {
          const screenX = targetChar.position.x * 50 + 200;
          const screenY = targetChar.position.y * 50 + 100;
          
          addDamage(
            effect.value,
            effect.effect === "heal" ? "heal" : "damage",
            { x: screenX, y: screenY }
          );

          // Update character HP in database
          if (!targetChar.isEnemy) {
            const partyChar = partyCharacters.find(c => c.id === targetChar.id);
            if (partyChar) {
              const newHp = effect.effect === "heal" 
                ? Math.min(partyChar.max_hp, partyChar.hp + effect.value)
                : Math.max(0, partyChar.hp - effect.value);
              updateCharacter(partyChar.id, { hp: newHp });
            }
          } else if (combatState?.enemies) {
            // Update enemy HP
            const updatedEnemies = combatState.enemies.map(e => {
              if (e.id === targetChar.id) {
                const newHp = effect.effect === "heal" 
                  ? Math.min(e.maxHp, e.hp + effect.value)
                  : Math.max(0, e.hp - effect.value);
                return { ...e, hp: newHp };
              }
              return e;
            });
            updateEnemies(updatedEnemies);
          }
        }
      });
    }

    // Handle combat state from DM
    if (lastDMMessage?.parsed?.combat) {
      const dmCombat = lastDMMessage.parsed.combat;
      if (dmCombat.active && !inCombat) {
        // DM started combat - create enemies from the response
        const enemies: CombatEnemy[] = (dmCombat.enemies || []).map((e: { name: string; hp?: number; ac?: number }, i: number) => ({
          id: `enemy-${Date.now()}-${i}`,
          name: e.name,
          hp: e.hp || 15,
          maxHp: e.hp || 15,
          ac: e.ac || 12,
          initiative: Math.floor(Math.random() * 20) + 1,
          position: { x: 6 + i, y: 2 + (i % 3) },
        }));
        
        // Build initiative order
        const allCombatants = [
          ...partyCharacters.map(c => ({ id: c.id, initiative: Math.floor(Math.random() * 20) + 1 })),
          ...enemies.map(e => ({ id: e.id, initiative: e.initiative })),
        ].sort((a, b) => b.initiative - a.initiative);
        
        startCombat(enemies, allCombatants.map(c => c.id));
      } else if (!dmCombat.active && inCombat) {
        endCombat();
      }
    }
  }, [lastDMMessage]);

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
      enemies: inCombat ? combatState?.enemies?.map(e => ({
        name: e.name,
        hp: e.hp,
        maxHp: e.maxHp,
      })) : undefined,
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

  const handleEndTurn = () => {
    nextTurn();
  };

  const handleToggleCombat = () => {
    if (inCombat) {
      endCombat();
    } else {
      // Start combat with no enemies initially (DM will add them)
      const order = partyCharacters.map(c => c.id);
      startCombat([], order);
    }
  };

  // Loading state
  if (charLoading || partyLoading || combatLoading) {
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

        {/* Center: Combat Grid (when in combat) */}
        {inCombat && (
          <div className="flex-1 flex flex-col p-4 gap-4">
            <TurnTracker 
              characters={gridCharacters} 
              currentTurnIndex={currentTurnIndex} 
              roundNumber={roundNumber} 
              onEndTurn={handleEndTurn}
              onSkipTurn={handleEndTurn}
            />
            <div className="flex-1 relative">
              <CombatGrid 
                characters={gridCharacters} 
                selectedCharacterId={selectedCharacter?.id} 
                onCharacterClick={setSelectedCharacter} 
              />
              <FloatingDamage damages={damages} onComplete={removeDamage} />
            </div>
            <AbilityBar 
              abilities={myAbilities} 
              selectedAbilityId={selectedAbility?.id} 
              onAbilitySelect={setSelectedAbility} 
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
                          className="h-full bg-destructive" 
                          initial={false}
                          animate={{ width: `${(member.hp / member.max_hp) * 100}%` }}
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{member.hp}/{member.max_hp}</span>
                    </div>
                    {member.id === myCharacter?.id && (
                      <div className="mt-2 text-xs text-primary">You</div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <div className="p-4 border-t border-border">
            <Button 
              variant={inCombat ? "destructive" : "combat"} 
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
            >
              {(() => {
                // Find the full character data
                const fullChar = partyCharacters.find(c => c.id === selectedCharacter.id);
                if (!fullChar) {
                  // It's an enemy - show basic sheet
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
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Game;