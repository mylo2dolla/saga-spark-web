import { useState } from "react";
import { Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { callEdgeFunction } from "@/lib/edge";
import { toast } from "sonner";

type FieldType =
  | "campaign_name"
  | "campaign_description"
  | "class_concept"
  | "character_name"
  | "dm_action"
  | "npc_name"
  | "quest_hook"
  | "generic";

interface PromptAssistFieldProps {
  value: string;
  onChange: (next: string) => void;
  fieldType: FieldType;
  campaignId?: string;
  context?: Record<string, unknown>;
  placeholder?: string;
  multiline?: boolean;
  minRows?: number;
  inputId?: string;
  disabled?: boolean;
  className?: string;
  onBlur?: () => void;
  maxLength?: number;
}

export function PromptAssistField(props: PromptAssistFieldProps) {
  const {
    value,
    onChange,
    fieldType,
    campaignId,
    context,
    placeholder,
    multiline = false,
    minRows = 4,
    inputId,
    disabled = false,
    className,
    onBlur,
    maxLength,
  } = props;

  const [isRandoming, setIsRandoming] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);

  const runGenerate = async (mode: "random" | "expand") => {
    if (disabled) return;
    if (mode === "expand" && !value.trim()) {
      toast.error("Type a rough idea first, then use Expand.");
      return;
    }

    const setBusy = mode === "random" ? setIsRandoming : setIsExpanding;
    setBusy(true);
    try {
      const { data, error } = await callEdgeFunction<{ ok: boolean; text?: string; error?: string }>(
        "mythic-field-generate",
        {
          requireAuth: true,
          body: {
            mode,
            fieldType,
            currentText: value,
            campaignId,
            context: context ?? {},
          },
        },
      );
      if (error) throw error;
      if (!data?.ok || !data.text) {
        throw new Error(data?.error ?? "Field generation returned no text");
      }
      const next = data.text.trim();
      onChange(maxLength && next.length > maxLength ? next.slice(0, maxLength) : next);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to generate text";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      {multiline ? (
        <Textarea
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-h-[120px]"
          style={{ minHeight: `${Math.max(2, minRows) * 1.4}rem` }}
          rows={minRows}
          disabled={disabled}
          onBlur={onBlur}
          maxLength={maxLength}
        />
      ) : (
        <Input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onBlur={onBlur}
          maxLength={maxLength}
        />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => runGenerate("random")}
          disabled={disabled || isRandoming || isExpanding}
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {isRandoming ? "Generating..." : "Random"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => runGenerate("expand")}
          disabled={disabled || isRandoming || isExpanding || !value.trim()}
        >
          <WandSparkles className="mr-1 h-3.5 w-3.5" />
          {isExpanding ? "Expanding..." : "Expand"}
        </Button>
      </div>
    </div>
  );
}
