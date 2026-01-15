/**
 * Save/Load menu component for game persistence.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Save, 
  FolderOpen, 
  Trash2, 
  Clock, 
  Trophy,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGamePersistence, type GameSave } from "@/hooks/useGamePersistence";
import { useUnifiedEngineContext } from "@/contexts/UnifiedEngineContext";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface SaveLoadMenuProps {
  campaignId: string;
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onLoad?: () => void;
  mode: "save" | "load";
  playtimeSeconds?: number;
}

export function SaveLoadMenu({
  campaignId,
  userId,
  isOpen,
  onClose,
  onLoad,
  mode,
  playtimeSeconds = 0,
}: SaveLoadMenuProps) {
  const { unified, travelState } = useUnifiedEngineContext();
  const persistence = useGamePersistence({ campaignId, userId });
  const [saveName, setSaveName] = useState("");
  const [selectedSave, setSelectedSave] = useState<GameSave | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Fetch saves when menu opens
  useEffect(() => {
    if (isOpen) {
      persistence.fetchSaves();
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (!saveName.trim()) {
      toast.error("Please enter a save name");
      return;
    }
    
    const saveId = await persistence.saveGame(unified, travelState, saveName.trim(), playtimeSeconds);
    if (saveId) {
      setSaveName("");
      onClose();
    }
  };

  const handleLoad = async (save: GameSave) => {
    const state = await persistence.loadGame(save.id);
    if (state) {
      onLoad?.();
      onClose();
    }
  };

  const handleDelete = async (saveId: string) => {
    await persistence.deleteSave(saveId);
    setConfirmDelete(null);
    setSelectedSave(null);
  };

  const formatPlaytime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "save" ? (
              <>
                <Save className="w-5 h-5" />
                Save Game
              </>
            ) : (
              <>
                <FolderOpen className="w-5 h-5" />
                Load Game
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {mode === "save" 
              ? "Save your current progress to continue later"
              : "Load a previous save to continue your adventure"
            }
          </DialogDescription>
        </DialogHeader>

        {/* New save input (only in save mode) */}
        {mode === "save" && (
          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Enter save name..."
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
            <Button onClick={handleSave} disabled={persistence.isSaving}>
              {persistence.isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
            </Button>
          </div>
        )}

        {/* Save list */}
        <ScrollArea className="h-72">
          {persistence.isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : persistence.saves.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FolderOpen className="w-12 h-12 mb-4 opacity-50" />
              <p>No saves found</p>
              {mode === "save" && (
                <p className="text-sm">Create your first save above</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {persistence.saves.map((save) => (
                <motion.div
                  key={save.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`
                    p-3 rounded-lg border cursor-pointer transition-colors
                    ${selectedSave?.id === save.id 
                      ? "border-primary bg-primary/10" 
                      : "border-border hover:border-primary/50"
                    }
                  `}
                  onClick={() => setSelectedSave(save)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium">{save.save_name}</h4>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1">
                          <Trophy className="w-3 h-3" />
                          Level {save.player_level}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatPlaytime(save.playtime_seconds)}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(save.updated_at), { addSuffix: true })}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {selectedSave && (
            <>
              {mode === "load" && (
                <Button 
                  onClick={() => handleLoad(selectedSave)}
                  disabled={persistence.isLoading}
                  className="flex-1"
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Load Save
                </Button>
              )}
              {mode === "save" && (
                <Button 
                  onClick={async () => {
                    await persistence.updateSave(selectedSave.id, unified, playtimeSeconds);
                    toast.success("Save updated!");
                    onClose();
                  }}
                  disabled={persistence.isSaving}
                  variant="secondary"
                  className="flex-1"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Overwrite
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={() => setConfirmDelete(selectedSave.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
        </DialogFooter>

        {/* Delete confirmation */}
        <AnimatePresence>
          {confirmDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-background/90 flex items-center justify-center p-6 rounded-lg"
            >
              <div className="text-center">
                <Trash2 className="w-12 h-12 text-destructive mx-auto mb-4" />
                <h3 className="font-display text-lg mb-2">Delete Save?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This action cannot be undone.
                </p>
                <div className="flex gap-2 justify-center">
                  <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </Button>
                  <Button 
                    variant="destructive" 
                    onClick={() => handleDelete(confirmDelete)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
