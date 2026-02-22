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
      cleaned: input.trim(),
      explicit: true,
      intent: "dm_prompt",
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

  return { raw: input, cleaned, explicit: true, intent: "dm_prompt" };
}

function parseNaturalLanguageCommand(input: string): PlayerCommandParseResult | null {
  const cleaned = cleanText(input);
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();

  if (/\b(?:start|begin|engage|enter)\b.*\b(?:combat|fight|battle)\b/.test(lower)) {
    return { raw: input, cleaned, explicit: false, intent: "combat_start" };
  }

  const panel = panelFromText(lower);
  if (panel && (/\b(?:open|show|view|inspect|check)\b/.test(lower) || /^menu\b/.test(lower))) {
    return { raw: input, cleaned, explicit: false, intent: "open_menu", panel };
  }

  if (/\b(?:go|travel|head|move|run|walk|return)\b.*\b(?:town|inn|city|settlement)\b/.test(lower)
    || /\b(?:town|inn|city|settlement)\b.*\b(?:go|travel|head|move|run|walk|return)\b/.test(lower)) {
    return {
      raw: input,
      cleaned,
      explicit: false,
      intent: "town",
      boardTarget: "town",
      travelGoal: "return_town",
    };
  }

  if (/\b(?:go|travel|head|move|enter|descend)\b.*\b(?:dungeon|cave|ruin)\b/.test(lower)
    || /\b(?:dungeon|cave|ruin)\b.*\b(?:go|travel|head|move|enter|descend)\b/.test(lower)) {
    return {
      raw: input,
      cleaned,
      explicit: false,
      intent: "dungeon",
      boardTarget: "dungeon",
      searchTarget: "dungeon",
      travelGoal: "enter_dungeon",
    };
  }

  if (/\b(?:travel|journey|scout|explore)\b/.test(lower) || /\b(?:route|road|wilds|outskirts)\b/.test(lower)) {
    return {
      raw: input,
      cleaned,
      explicit: false,
      intent: "travel",
      boardTarget: "travel",
      travelGoal: "explore_wilds",
    };
  }

  if (/\b(?:shop|market|vendor|merchant|store)\b/.test(lower)) {
    return { raw: input, cleaned, explicit: false, intent: "shop" };
  }

  if (/\b(?:list|show|what|which|check)\b.*\b(?:skills?|abilities)\b/.test(lower)) {
    return { raw: input, cleaned, explicit: false, intent: "skills_list" };
  }

  if (/\b(?:status|hp|mp|health|stats?)\b/.test(lower)) {
    return { raw: input, cleaned, explicit: false, intent: "status_check" };
  }

  if (/\b(?:steal|pickpocket)\b/.test(lower)) {
    return { raw: input, cleaned, explicit: false, intent: "steal" };
  }

  if (/\b(?:loot|forage|search|scout|investigate)\b/.test(lower)) {
    const probeKind = /\bforage\b/.test(lower)
      ? "forage"
      : /\bscout\b/.test(lower)
        ? "scout"
        : /\bsearch\b/.test(lower) || /\binvestigate\b/.test(lower)
          ? "search"
          : "loot";
    return {
      raw: input,
      cleaned,
      explicit: false,
      intent: "loot",
      probeKind,
      boardTarget: "travel",
      travelGoal: "explore_wilds",
    };
  }

  const skillMatch = cleaned.match(/\b(?:use|cast)\s+(.+?)(?:\s+(?:on|at|against)\s+(.+))?$/i);
  if (skillMatch) {
    const skillQuery = cleanText(skillMatch[1] ?? "");
    const targetQuery = cleanText(skillMatch[2] ?? "");
    if (skillQuery.length > 0) {
      return {
        raw: input,
        cleaned,
        explicit: false,
        intent: "use_skill",
        skillQuery,
        targetQuery: targetQuery || undefined,
      };
    }
  }

  return null;
}

export function parsePlayerCommand(input: string): PlayerCommandParseResult {
  const slash = parseSlashCommand(input.trim());
  if (slash) return slash;

  const cleaned = cleanText(input);

  if (!cleaned) {
    return { raw: input, cleaned, explicit: false, intent: "unknown" };
  }

  // Typed input is authoritative freeform by default.
  // Slash commands remain the explicit mechanical command lane.
  return { raw: input, cleaned, explicit: false, intent: "dm_prompt" };
}
