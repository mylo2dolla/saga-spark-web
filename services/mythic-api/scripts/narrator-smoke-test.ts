import assert from "node:assert/strict";

import { generateProceduralNarration } from "../src/dm/proceduralNarrator/index.js";
import { hasForbiddenNarrationContent } from "../src/dm/proceduralNarrator/guardrails.js";

type SampleKind = "combat" | "travel" | "dungeon" | "town";

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sampleEvent(kind: SampleKind, index: number): Record<string, unknown> {
  if (kind === "combat") {
    return {
      id: `combat-${index}`,
      event_type: index % 3 === 0 ? "status_applied" : "damage",
      turn_index: index,
      payload: {
        source_name: "Rook",
        target_name: index % 2 === 0 ? "Bone Marshal" : "Ash Stalker",
        damage_to_hp: 12 + (index % 27),
        status: { id: index % 3 === 0 ? "bleed" : "burn" },
      },
    };
  }
  if (kind === "travel") {
    return {
      id: `travel-${index}`,
      event_type: "travel_step",
      turn_index: index,
      payload: {
        source_name: "Scout Team",
        target_name: index % 2 === 0 ? "ridge trail" : "river ford",
      },
    };
  }
  if (kind === "dungeon") {
    return {
      id: `dungeon-${index}`,
      event_type: index % 2 === 0 ? "room_entered" : "loot_drop",
      turn_index: index,
      payload: {
        source_name: "Breach Team",
        target_name: index % 2 === 0 ? "vault antechamber" : "supply cache",
      },
    };
  }
  return {
    id: `town-${index}`,
    event_type: index % 2 === 0 ? "npc_dialogue" : "quest_update",
    turn_index: index,
    payload: {
      source_name: "Street Broker",
      target_name: "you",
    },
  };
}

function sampleInput(kind: SampleKind, index: number) {
  return {
    campaignSeed: "smoke-campaign",
    sessionId: "smoke-session",
    eventId: `${kind}-${index}`,
    boardType: kind === "town" ? "town" : kind,
    biome: kind === "travel" ? "forest" : kind === "town" ? "city" : "dungeon",
    tone: kind === "combat" ? "grim" : kind === "town" ? "comic" : "tactical",
    intensity: kind === "combat" ? "high" : kind === "travel" ? "med" : "low",
    actionSummary: `Sample action ${index} for ${kind}.`,
    recoveryBeat: "Choose one concrete move and commit it.",
    boardAnchor: kind === "travel" ? "ridge route" : "active board",
    summaryObjective: kind === "combat" ? "Focus priority target." : "Secure momentum.",
    summaryRumor: kind === "town" ? "A broker knows a shortcut." : "Pressure is moving fast.",
    boardNarration: "The board remains authoritative and pressure-forward.",
    introOpening: index % 9 === 0,
    suppressNarrationOnError: false,
    executionError: null,
    stateChanges: [`state-change-${index}`],
    events: [sampleEvent(kind, index)],
  } as const;
}

function run() {
  const kinds: SampleKind[] = ["combat", "travel", "dungeon", "town"];
  const outputs: string[] = [];
  const lengths: number[] = [];

  for (let index = 0; index < 120; index += 1) {
    const kind = kinds[index % kinds.length]!;
    const input = sampleInput(kind, index);
    const first = generateProceduralNarration(input);
    const second = generateProceduralNarration(input);

    assert.ok(first.text.trim().length > 0, `empty narration at sample ${index}`);
    assert.equal(first.text, second.text, `non-deterministic output at sample ${index}`);
    assert.ok(!hasForbiddenNarrationContent(first.text), `forbidden content at sample ${index}`);

    outputs.push(first.text);
    lengths.push(wordCount(first.text));
  }

  const avgWords = lengths.reduce((sum, value) => sum + value, 0) / Math.max(1, lengths.length);
  assert.ok(avgWords >= 10, `average narration length too short: ${avgWords.toFixed(2)}`);
  assert.ok(avgWords <= 120, `average narration length too long: ${avgWords.toFixed(2)}`);

  const unique = new Set(outputs);
  assert.ok(unique.size >= 40, `low output variety: ${unique.size} unique narrations`);

  console.log("Narrator smoke test passed.");
  console.log(`Samples: ${outputs.length}`);
  console.log(`Unique outputs: ${unique.size}`);
  console.log(`Average words: ${avgWords.toFixed(2)}`);
}

run();

