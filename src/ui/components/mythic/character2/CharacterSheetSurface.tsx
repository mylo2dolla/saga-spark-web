import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CharacterSheetSections } from "@/ui/components/mythic/character2/CharacterSheetSections";
import type {
  CharacterProfileDraft,
  CharacterSheetSaveState,
  CharacterSheetSection,
  CharacterSheetViewModel,
} from "@/ui/components/mythic/character2/types";

interface CharacterSheetSurfaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: CharacterSheetViewModel;
  section: CharacterSheetSection;
  onSectionChange: (section: CharacterSheetSection) => void;
  draft: CharacterProfileDraft;
  onDraftChange: (next: CharacterProfileDraft) => void;
  saveState: CharacterSheetSaveState;
  equipmentBusy: boolean;
  equipmentError: string | null;
  onEquipItem: (inventoryId: string) => void;
  onUnequipItem: (inventoryId: string) => void;
  partyBusy: boolean;
  partyError: string | null;
  onIssueCompanionCommand: (payload: {
    companionId: string;
    stance: "aggressive" | "balanced" | "defensive";
    directive: "focus" | "protect" | "harry" | "hold";
    targetHint?: string;
  }) => void;
}

export function CharacterSheetSurface(props: CharacterSheetSurfaceProps) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-[min(92vw,760px)] overflow-hidden border border-amber-200/25 bg-[linear-gradient(180deg,rgba(17,14,10,0.96),rgba(8,10,16,0.98))] text-amber-50 sm:max-w-[760px]"
      >
        <SheetHeader>
          <SheetTitle className="font-display text-2xl text-amber-100">{props.model.name}</SheetTitle>
          <SheetDescription className="text-amber-100/75">
            Level {props.model.level} {props.model.className} · {props.model.role}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 h-[calc(100%-92px)] overflow-auto pr-1">
          <CharacterSheetSections
            model={props.model}
            section={props.section}
            onSectionChange={props.onSectionChange}
            draft={props.draft}
            onDraftChange={props.onDraftChange}
            saveState={props.saveState}
            equipmentBusy={props.equipmentBusy}
            equipmentError={props.equipmentError}
            onEquipItem={props.onEquipItem}
            onUnequipItem={props.onUnequipItem}
            partyBusy={props.partyBusy}
            partyError={props.partyError}
            onIssueCompanionCommand={props.onIssueCompanionCommand}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
