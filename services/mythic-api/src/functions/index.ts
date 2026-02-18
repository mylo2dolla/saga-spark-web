import type { FunctionHandler } from "./types.js";
import { dungeonMaster } from "./dungeon-master.js";
import { mythicApplyXp } from "./mythic-apply-xp.js";
import { mythicBootstrap } from "./mythic-bootstrap.js";
import { mythicBoardTransition } from "./mythic-board-transition.js";
import { mythicCombatStart } from "./mythic-combat-start.js";
import { mythicCombatTick } from "./mythic-combat-tick.js";
import { mythicCombatUseSkill } from "./mythic-combat-use-skill.js";
import { mythicCreateCampaign } from "./mythic-create-campaign.js";
import { mythicCreateCharacter } from "./mythic-create-character.js";
import { mythicDmContext } from "./mythic-dm-context.js";
import { mythicDungeonMaster } from "./mythic-dungeon-master.js";
import { mythicFieldGenerate } from "./mythic-field-generate.js";
import { mythicGenerateLoot } from "./mythic-generate-loot.js";
import { mythicJoinCampaign } from "./mythic-join-campaign.js";
import { mythicListCampaigns } from "./mythic-list-campaigns.js";
import { mythicRecomputeCharacter } from "./mythic-recompute-character.js";
import { mythicSetLoadout } from "./mythic-set-loadout.js";
import { mythicShopBuy } from "./mythic-shop-buy.js";
import { mythicShopStock } from "./mythic-shop-stock.js";
import { mythicTts } from "./mythic-tts.js";
import { worldContentWriter } from "./world-content-writer.js";
import { worldGenerator } from "./world-generator.js";

const handlers: FunctionHandler[] = [
  dungeonMaster,
  mythicApplyXp,
  mythicBootstrap,
  mythicBoardTransition,
  mythicCombatStart,
  mythicCombatTick,
  mythicCombatUseSkill,
  mythicCreateCampaign,
  mythicCreateCharacter,
  mythicDmContext,
  mythicDungeonMaster,
  mythicFieldGenerate,
  mythicGenerateLoot,
  mythicJoinCampaign,
  mythicListCampaigns,
  mythicRecomputeCharacter,
  mythicSetLoadout,
  mythicShopBuy,
  mythicShopStock,
  mythicTts,
  worldContentWriter,
  worldGenerator,
];

export const FUNCTION_HANDLERS = new Map<string, FunctionHandler>(
  handlers.map((handler) => [handler.name, handler]),
);
