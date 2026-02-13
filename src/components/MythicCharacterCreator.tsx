import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { useMythicCreator } from "@/hooks/useMythicCreator";
import type { MythicCreateCharacterResponse } from "@/types/mythic";
import { PromptAssistField } from "@/components/PromptAssistField";

type Step = "concept" | "review";

interface Props {
  campaignId: string;
  onComplete: (res: MythicCreateCharacterResponse) => void;
  onCancel?: () => void;
}

const stepVariants = {
  initial: { opacity: 0, x: 18 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -18 },
};

export function MythicCharacterCreator({ campaignId, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>("concept");
  const [characterName, setCharacterName] = useState("");
  const [classDescription, setClassDescription] = useState("");
  const [result, setResult] = useState<MythicCreateCharacterResponse | null>(null);

  const { isBootstrapping, isCreating, bootstrapCampaign, createCharacter } = useMythicCreator();

  const canGenerate = useMemo(() => {
    return characterName.trim().length >= 2 && classDescription.trim().length >= 5;
  }, [characterName, classDescription]);

  const handleGenerate = async () => {
    await bootstrapCampaign(campaignId);
    const created = await createCharacter({
      campaignId,
      characterName: characterName.trim(),
      classDescription: classDescription.trim(),
    });
    if (!created) return;
    setResult(created);
    setStep("review");
  };

  const handleConfirm = () => {
    if (!result) return;
    onComplete(result);
  };

  const isBusy = isBootstrapping || isCreating;

  return (
    <div className="mx-auto w-full max-w-3xl rounded-xl border border-border bg-card/40 p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="font-display text-2xl">Mythic Class Forge</div>
          <div className="text-sm text-muted-foreground">Describe your class. The system generates a real kit in Supabase (mythic schema).</div>
        </div>
        {onCancel ? (
          <Button variant="outline" onClick={onCancel} disabled={isBusy}>
            Cancel
          </Button>
        ) : null}
      </div>

      <AnimatePresence mode="wait">
        {step === "concept" ? (
          <motion.div key="concept" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2 }}>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Character Name</Label>
                <PromptAssistField
                  inputId="name"
                  value={characterName}
                  onChange={setCharacterName}
                  fieldType="character_name"
                  campaignId={campaignId}
                  placeholder="e.g. Nyx"
                  disabled={isBusy}
                  maxLength={60}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="concept">Class Concept</Label>
                <PromptAssistField
                  inputId="concept"
                  value={classDescription}
                  onChange={setClassDescription}
                  fieldType="class_concept"
                  campaignId={campaignId}
                  placeholder='e.g. "werewolf ninja pyromancer" or "goblin priest of broken vending machines"'
                  multiline
                  minRows={6}
                  disabled={isBusy}
                  maxLength={2000}
                />
                <div className="text-xs text-muted-foreground">
                  Violence/gore allowed. Sexual content forbidden.
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button onClick={handleGenerate} disabled={!canGenerate || isBusy}>
                  {isBusy ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Forging...
                    </span>
                  ) : (
                    "Generate Kit"
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}

        {step === "review" && result ? (
          <motion.div key="review" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2 }}>
            <div className="grid gap-4">
              <div className="rounded-lg border border-border bg-background/40 p-4">
                <div className="font-display text-xl">{result.class.class_name}</div>
                <div className="mt-1 text-sm text-muted-foreground">{result.class.class_description}</div>
                <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Role</div>
                    <div className="font-medium">{result.class.role}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Weapon Family</div>
                    <div className="font-medium">{result.class.weapon_identity.family}</div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-xs text-muted-foreground">Base Stats</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs md:grid-cols-6">
                    {Object.entries(result.class.base_stats).map(([k, v]) => (
                      <div key={k} className="rounded-md border border-border bg-card/50 p-2 text-center">
                        <div className="font-display text-sm">{v}</div>
                        <div className="text-muted-foreground">{k}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 rounded-md border border-border bg-card/30 p-3">
                  <div className="text-xs text-muted-foreground">Weakness (by design)</div>
                  <div className="mt-1 text-sm">{result.class.weakness.description}</div>
                  <div className="mt-2 text-xs text-muted-foreground">Counterplay</div>
                  <div className="text-sm">{result.class.weakness.counterplay}</div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/40 p-4">
                <div className="mb-2 text-sm font-semibold">Abilities</div>
                <ScrollArea className="h-[320px] pr-3">
                  <div className="grid gap-2">
                    {result.skills.map((s, idx) => (
                      <div key={idx} className="rounded-md border border-border bg-card/30 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{s.name}</div>
                            <div className="text-xs text-muted-foreground">{s.kind} · {s.targeting} · range {s.range_tiles} · cd {s.cooldown_turns}</div>
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-muted-foreground">{s.description}</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="flex items-center justify-between">
                <Button variant="outline" onClick={() => setStep("concept")} disabled={isBusy}>
                  Regenerate
                </Button>
                <Button onClick={handleConfirm}>
                  Confirm Character
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
