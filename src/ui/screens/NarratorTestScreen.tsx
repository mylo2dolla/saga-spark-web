import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { callEdgeFunction } from "@/lib/edge";

type NarratorSample = {
  id: string;
  label: string;
  payload: Record<string, unknown>;
};

const SAMPLE_FIXTURES: NarratorSample[] = [
  {
    id: "combat",
    label: "Combat Spike",
    payload: {
      campaignSeed: "sample-campaign",
      sessionId: "sample-session",
      eventId: "combat-001",
      boardType: "combat",
      biome: "dungeon",
      tone: "grim",
      intensity: "high",
      actionSummary: "Pressure priority target at center lane.",
      recoveryBeat: "Pick one target and keep tempo.",
      boardAnchor: "collapsed atrium",
      summaryObjective: "Finish the bruiser before reinforcements rotate in.",
      summaryRumor: "The eastern door is about to breach.",
      boardNarration: "The chamber shakes with steel and static.",
      stateChanges: ["Damage landed on Bone Marshal", "Status bleed applied", "Turn tempo secured"],
      events: [
        {
          id: "evt-1",
          event_type: "damage",
          turn_index: 11,
          payload: {
            source_name: "Rook",
            target_name: "Bone Marshal",
            damage_to_hp: 34,
          },
        },
        {
          id: "evt-2",
          event_type: "status_applied",
          turn_index: 11,
          payload: {
            source_name: "Rook",
            target_name: "Bone Marshal",
            status: { id: "bleed" },
          },
        },
      ],
    },
  },
  {
    id: "travel",
    label: "Travel Beat",
    payload: {
      campaignSeed: "sample-campaign",
      sessionId: "sample-session",
      eventId: "travel-001",
      boardType: "travel",
      biome: "forest",
      tone: "tactical",
      intensity: "med",
      actionSummary: "Scout the ridge path before the convoy arrives.",
      recoveryBeat: "Choose the next route segment and lock it in.",
      boardAnchor: "pine ridge route",
      summaryObjective: "Find a safe crossing before dusk.",
      summaryRumor: "Bandits set up near the old watchtower.",
      boardNarration: "Mist drifts between the trees while the route clock keeps moving.",
      stateChanges: ["Route segment unlocked", "Danger meter increased"],
      events: [
        {
          id: "evt-10",
          event_type: "travel_step",
          payload: {
            source_name: "Scout Team",
            target_name: "watchtower trail",
          },
        },
      ],
    },
  },
  {
    id: "loot",
    label: "Loot Drop",
    payload: {
      campaignSeed: "sample-campaign",
      sessionId: "sample-session",
      eventId: "loot-001",
      boardType: "dungeon",
      biome: "dungeon",
      tone: "mischievous",
      intensity: "med",
      actionSummary: "Sweep the room and secure rewards.",
      recoveryBeat: "Stabilize the room and move to the next breach.",
      boardAnchor: "vault antechamber",
      boardNarration: "Dust falls from the ceiling as the lock gives way.",
      stateChanges: ["Loot crate opened", "XP awarded"],
      events: [
        {
          id: "evt-20",
          event_type: "loot_drop",
          payload: {
            source_name: "Vault Crate",
            target_name: "party stash",
          },
        },
      ],
    },
  },
];

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function safeParseJson(value: string): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "JSON payload must be an object." };
    }
    return { ok: true, payload: parsed as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

export default function NarratorTestScreen() {
  const [selectedSampleId, setSelectedSampleId] = useState<string>(SAMPLE_FIXTURES[0]!.id);
  const [payloadText, setPayloadText] = useState<string>(prettyJson(SAMPLE_FIXTURES[0]!.payload));
  const [includeAi, setIncludeAi] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const sampleOptions = useMemo(() => SAMPLE_FIXTURES.map((sample) => ({ id: sample.id, label: sample.label })), []);

  const applySample = (sampleId: string) => {
    const sample = SAMPLE_FIXTURES.find((entry) => entry.id === sampleId);
    if (!sample) return;
    setSelectedSampleId(sampleId);
    setPayloadText(prettyJson(sample.payload));
    setError(null);
  };

  const runHarness = async () => {
    const parsed = safeParseJson(payloadText);
    if (parsed.ok === false) {
      setError(parsed.error);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await callEdgeFunction<Record<string, unknown>>("mythic-narrator-test", {
        requireAuth: true,
        timeoutMs: includeAi ? 60_000 : 20_000,
        maxRetries: 0,
        body: {
          ...parsed.payload,
          includeAi,
        },
      });
      if (res.error) {
        throw res.error;
      }
      setResult(res.data ?? null);
    } catch (runError) {
      setResult(null);
      setError(runError instanceof Error ? runError.message : "Narrator harness request failed.");
    } finally {
      setLoading(false);
    }
  };

  const procedural = result && typeof result.procedural === "object"
    ? result.procedural as Record<string, unknown>
    : null;
  const ai = result && typeof result.ai === "object"
    ? result.ai as Record<string, unknown>
    : null;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Narrator A/B Harness</h1>
        <p className="text-sm text-muted-foreground">
          Paste structured event JSON, run procedural narration, and compare against AI output.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="space-y-3 rounded-lg border border-border bg-card/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium" htmlFor="sample-select">Sample</label>
            <select
              id="sample-select"
              value={selectedSampleId}
              onChange={(event) => applySample(event.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-sm"
            >
              {sampleOptions.map((sample) => (
                <option key={sample.id} value={sample.id}>{sample.label}</option>
              ))}
            </select>
            <Button size="sm" variant="secondary" onClick={() => applySample(selectedSampleId)}>
              Reload Sample
            </Button>
          </div>

          <label className="block text-sm font-medium" htmlFor="payload-json">Event Payload JSON</label>
          <textarea
            id="payload-json"
            value={payloadText}
            onChange={(event) => setPayloadText(event.target.value)}
            className="h-[420px] w-full rounded border border-border bg-background p-3 font-mono text-xs"
          />

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeAi}
                onChange={(event) => setIncludeAi(event.target.checked)}
              />
              Include AI comparison
            </label>
            <Button onClick={() => void runHarness()} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running
                </>
              ) : "Run Narrator Test"}
            </Button>
          </div>

          {error ? <div className="text-sm text-destructive">{error}</div> : null}
        </section>

        <section className="space-y-3">
          <div className="rounded-lg border border-border bg-card/20 p-4">
            <div className="mb-2 text-sm font-semibold">Procedural</div>
            <div className="rounded border border-border bg-background p-3 text-sm whitespace-pre-wrap">
              {typeof procedural?.text === "string" ? procedural.text : "No output yet."}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              template_id: {typeof procedural?.template_id === "string" ? procedural.template_id : "n/a"}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card/20 p-4">
            <div className="mb-2 text-sm font-semibold">AI</div>
            <div className="rounded border border-border bg-background p-3 text-sm whitespace-pre-wrap">
              {typeof ai?.text === "string" && ai.text.trim().length > 0
                ? ai.text
                : (typeof ai?.error === "string" ? `AI error: ${ai.error}` : "AI not requested or unavailable.")}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              model: {typeof ai?.model === "string" ? ai.model : "n/a"}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card/20 p-4">
            <div className="mb-2 text-sm font-semibold">Procedural Debug</div>
            <pre className="max-h-[280px] overflow-auto rounded border border-border bg-background p-3 text-[11px] leading-relaxed">
              {procedural?.debug ? prettyJson(procedural.debug) : "No debug payload yet."}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
