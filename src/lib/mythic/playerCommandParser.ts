export type PlayerCommandIntent =
  | "shop"
  | "loot"
  | "steal"
  | "travel"
  | "dungeon"
  | "town"
  | "combat_start"
  | "use_skill"
  | "skills_list"
  | "status_check"
  | "open_menu"
  | "dm_prompt"
  | "unknown";

export type PlayerCommandPanel =
  | "character"
  | "equipment"
  | "skills"
  | "progression"
  | "quests"
  | "shop"
  | "commands"
  | "settings";

export interface PlayerCommandParseResult {
  raw: string;
  cleaned: string;
  explicit: boolean;
  intent: PlayerCommandIntent;
  boardTarget?: "town" | "travel" | "dungeon";
  panel?: PlayerCommandPanel;
  skillQuery?: string;
  targetQuery?: string;
  probeKind?: "scout" | "search" | "forage" | "loot";
  searchTarget?: "dungeon" | "cave" | "ruin" | "treasure" | "landmark";
  travelGoal?: "find_dungeon" | "explore_wilds" | "return_town" | "enter_dungeon";
}

function cleanText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

function panelFromText(value: string): PlayerCommandPanel | undefined {
  const lower = value.toLowerCase();
  if (/\b(gear|equipment|inventory)\b/.test(lower)) return "equipment";
  if (/\b(skill|skills|ability|abilities)\b/.test(lower)) return "skills";
  if (/\b(loadout|loadouts)\b/.test(lower)) return "skills";
  if (/\b(progression|level|xp)\b/.test(lower)) return "progression";
  if (/\b(quest|quests)\b/.test(lower)) return "quests";
  if (/\b(shop|market|vendor|merchant|store)\b/.test(lower)) return "shop";
  if (/\b(setting|settings|audio|voice|animation)\b/.test(lower)) return "settings";
  if (/\b(command|commands|help)\b/.test(lower)) return "commands";
  if (/\b(character|sheet|stats)\b/.test(lower)) return "character";
  return undefined;
}

function parseSlashCommand(input: string): PlayerCommandParseResult | null {
  if (!input.startsWith("/")) return null;
  const cleaned = cleanText(input.slice(1));
  if (!cleaned) {
    return {
      raw: input,
      cleaned: "",
      explicit: true,
      intent: "unknown",
    };
  }

  const [head, ...tailParts] = cleaned.split(" ");
  const tail = tailParts.join(" ").trim();
  const command = head.toLowerCase();

  if (command === "travel") {
    const target = tail.toLowerCase();
    const boardTarget = target === "town" || target === "travel" || target === "dungeon" ? target : "travel";
    if (boardTarget === "dungeon") {
      return {
        raw: input,
        cleaned,
        explicit: true,
        intent: "dungeon",
        boardTarget: "dungeon",
        searchTarget: "dungeon",
        travelGoal: "enter_dungeon",
      };
    }
    return {
      raw: input,
      cleaned,
      explicit: true,
      intent: boardTarget,
      boardTarget,
      travelGoal: boardTarget === "town" ? "return_town" : "explore_wilds",
    };
  }
  if (command === "town") return { raw: input, cleaned, explicit: true, intent: "town", boardTarget: "town" };
  if (command === "dungeon") return { raw: input, cleaned, explicit: true, intent: "dungeon", boardTarget: "dungeon" };
  if (command === "shop") return { raw: input, cleaned, explicit: true, intent: "shop" };
  if (command === "loot") return { raw: input, cleaned, explicit: true, intent: "loot", probeKind: "loot" };
  if (command === "search" || command === "scout" || command === "forage") {
    const probeKind = command === "search" ? "search" : command === "scout" ? "scout" : "forage";
    return {
      raw: input,
      cleaned,
      explicit: true,
      intent: "loot",
      probeKind,
      boardTarget: "travel",
      travelGoal: "explore_wilds",
    };
  }
  if (command === "steal") return { raw: input, cleaned, explicit: true, intent: "steal" };
  if (command === "skills") return { raw: input, cleaned, explicit: true, intent: "skills_list" };
  if (command === "status") return { raw: input, cleaned, explicit: true, intent: "status_check" };
  if (command === "menu") {
    return {
      raw: input,
      cleaned,
      explicit: true,
      intent: "open_menu",
      panel: panelFromText(tail) ?? "character",
    };
  }
  if (command === "combat" && /^start\b/i.test(tail)) {
    return { raw: input, cleaned, explicit: true, intent: "combat_start" };
  }
  if (command === "skill") {
    const parts = tail.split("@");
    const skillQuery = cleanText(parts[0] ?? "");
    const targetQuery = cleanText(parts[1] ?? "");
    return {
      raw: input,
      cleaned,
      explicit: true,
      intent: "use_skill",
      skillQuery: skillQuery || undefined,
      targetQuery: targetQuery || undefined,
    };
  }

  return { raw: input, cleaned, explicit: true, intent: "unknown" };
}

export function parsePlayerCommand(input: string): PlayerCommandParseResult {
  const slash = parseSlashCommand(input.trim());
  if (slash) return slash;

  const cleaned = cleanText(input);

  if (!cleaned) {
    return { raw: input, cleaned, explicit: false, intent: "unknown" };
  }
  // Non-slash player text is always freeform narration input.
  return { raw: input, cleaned, explicit: false, intent: "dm_prompt" };
}
