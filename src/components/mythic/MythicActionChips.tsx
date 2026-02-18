import { Button } from "@/components/ui/button";

interface MythicActionChip {
  id: string;
  label: string;
  prompt: string;
  tags: string[];
}

const ACTION_CHIPS: MythicActionChip[] = [
  {
    id: "threaten",
    label: "Threaten",
    prompt: "I threaten the nearest hostile force and demand they stand down.",
    tags: ["threaten", "dominance"],
  },
  {
    id: "mercy",
    label: "Show Mercy",
    prompt: "I hold back and show mercy, but I expect respect for it.",
    tags: ["mercy", "restraint"],
  },
  {
    id: "demand-payment",
    label: "Demand Payment",
    prompt: "I demand payment or tribute before I continue helping.",
    tags: ["demand_payment", "greed"],
  },
  {
    id: "investigate",
    label: "Investigate",
    prompt: "I investigate the scene carefully and call out anything suspicious.",
    tags: ["investigate", "caution"],
  },
  {
    id: "retreat",
    label: "Retreat",
    prompt: "I fall back, regroup, and set a stronger position before re-engaging.",
    tags: ["retreat", "survival"],
  },
];

interface Props {
  disabled?: boolean;
  onSelect: (prompt: string, tags: string[]) => void;
}

export function MythicActionChips({ disabled = false, onSelect }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {ACTION_CHIPS.map((chip) => (
        <Button
          key={chip.id}
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-[11px]"
          disabled={disabled}
          onClick={() => onSelect(chip.prompt, chip.tags)}
        >
          {chip.label}
        </Button>
      ))}
    </div>
  );
}
