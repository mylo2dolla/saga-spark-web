/**
 * NPC Dialog UI component - handles conversation with NPCs.
 */

import { useState } from "react";
import { useUnifiedEngineContext } from "@/contexts/UnifiedEngineContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, ShoppingBag, Scroll, Heart, Swords } from "lucide-react";
import type { NPC, DialogueNode, Quest } from "@/engine/narrative/types";
import { calculateDisposition, getRelationship } from "@/engine/narrative/NPC";

interface NPCDialogProps {
  npc: NPC;
  playerId: string;
  onClose?: () => void;
  onStartQuest?: (questId: string) => void;
  onTrade?: (npcId: string) => void;
}

export function NPCDialog({ npc, playerId, onClose, onStartQuest, onTrade }: NPCDialogProps) {
  const { talkToNPC, getQuest, acceptQuest, availableQuests } = useUnifiedEngineContext();
  const [currentNode, setCurrentNode] = useState<DialogueNode | null>(
    npc.dialogue.find(d => d.id === "greeting") ?? npc.dialogue[0] ?? null
  );

  // Get relationship info
  const relationship = getRelationship(npc, playerId);
  const disposition = relationship?.disposition ?? "neutral";

  // Get quests this NPC offers
  const offeredQuests = npc.questsOffered
    .map(qId => availableQuests.find(q => q.id === qId))
    .filter((q): q is Quest => q !== undefined);

  const handleResponse = (nextNodeId?: string) => {
    talkToNPC(playerId, npc.id);
    if (nextNodeId) {
      const nextNode = npc.dialogue.find(d => d.id === nextNodeId);
      setCurrentNode(nextNode ?? null);
    } else {
      setCurrentNode(null);
    }
  };

  const handleAcceptQuest = (questId: string) => {
    acceptQuest(playerId, questId);
    onStartQuest?.(questId);
  };

  const dispositionColors: Record<string, string> = {
    hostile: "bg-red-500/20 text-red-500",
    unfriendly: "bg-orange-500/20 text-orange-500",
    neutral: "bg-muted text-muted-foreground",
    friendly: "bg-green-500/20 text-green-500",
    allied: "bg-blue-500/20 text-blue-500",
  };

  const dispositionIcons: Record<string, typeof Heart> = {
    hostile: Swords,
    unfriendly: Swords,
    neutral: MessageCircle,
    friendly: Heart,
    allied: Heart,
  };

  const DispositionIcon = dispositionIcons[disposition] ?? MessageCircle;

  return (
    <Card className="w-full max-w-lg bg-card/95 backdrop-blur border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-primary" />
              {npc.name}
            </CardTitle>
            {npc.title && (
              <p className="text-sm text-muted-foreground mt-1">{npc.title}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className={dispositionColors[disposition]}>
              <DispositionIcon className="w-3 h-3 mr-1" />
              {disposition}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Personality traits */}
        {npc.personality.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {npc.personality.slice(0, 4).map(trait => (
              <Badge key={trait} variant="outline" className="text-xs">
                {trait}
              </Badge>
            ))}
          </div>
        )}

        {/* Dialogue */}
        <ScrollArea className="h-48 rounded-md border bg-background/50 p-4">
          {currentNode ? (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-sm italic">"{currentNode.text}"</p>
                {currentNode.speakerMood && (
                  <span className="text-xs text-muted-foreground mt-1 block">
                    *{currentNode.speakerMood}*
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {currentNode.responses.map((response, idx) => (
                  <Button
                    key={idx}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-left h-auto py-2 px-3"
                    onClick={() => handleResponse(response.nextNodeId)}
                  >
                    <span className="text-primary mr-2">&gt;</span>
                    {response.text}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <p>The conversation has ended.</p>
              <Button 
                variant="link" 
                size="sm" 
                onClick={() => setCurrentNode(npc.dialogue[0] ?? null)}
                className="mt-2"
              >
                Start new conversation
              </Button>
            </div>
          )}
        </ScrollArea>

        {/* Available quests from this NPC */}
        {offeredQuests.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Scroll className="w-4 h-4" />
              Available Quests
            </h4>
            {offeredQuests.map(quest => (
              <div 
                key={quest.id}
                className="flex items-center justify-between p-2 rounded-md bg-primary/5 border border-primary/10"
              >
                <div>
                  <p className="text-sm font-medium">{quest.title}</p>
                  <p className="text-xs text-muted-foreground">{quest.briefDescription}</p>
                </div>
                <Button size="sm" onClick={() => handleAcceptQuest(quest.id)}>
                  Accept
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Trade button */}
        {npc.canTrade && (
          <Button 
            variant="outline" 
            className="w-full" 
            onClick={() => onTrade?.(npc.id)}
          >
            <ShoppingBag className="w-4 h-4 mr-2" />
            Trade with {npc.name}
          </Button>
        )}

        {/* Close button */}
        <Button variant="secondary" className="w-full" onClick={onClose}>
          End Conversation
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * NPC list component - shows all NPCs in view
 */
interface NPCListProps {
  onSelectNPC?: (npc: NPC) => void;
}

export function NPCList({ onSelectNPC }: NPCListProps) {
  const { npcs } = useUnifiedEngineContext();

  if (npcs.length === 0) {
    return null;
  }

  return (
    <Card className="w-full max-w-xs bg-card/95 backdrop-blur border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          NPCs ({npcs.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-32">
          <div className="space-y-1">
            {npcs.map(npc => (
              <Button
                key={npc.id}
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => onSelectNPC?.(npc)}
              >
                <span className="truncate">{npc.name}</span>
                {npc.title && (
                  <span className="text-xs text-muted-foreground ml-2 truncate">
                    {npc.title}
                  </span>
                )}
              </Button>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
