import type { AssetFallbackManifest, SpriteAtlasEntry } from "@/ui/components/mythic/board2/render/AssetManager";

export const MYTHIC_ATLAS_ENTRIES: SpriteAtlasEntry[] = [
  { alias: "entity:ally:infantry", url: "/mythic/atlas/entity-ally-infantry.svg" },
  { alias: "entity:ally:caster", url: "/mythic/atlas/entity-ally-caster.svg" },
  { alias: "entity:enemy:brute", url: "/mythic/atlas/entity-enemy-brute.svg" },
  { alias: "entity:enemy:caster", url: "/mythic/atlas/entity-enemy-caster.svg" },
  { alias: "entity:enemy:beast", url: "/mythic/atlas/entity-enemy-beast.svg" },
  { alias: "entity:neutral:npc", url: "/mythic/atlas/entity-neutral-npc.svg" },
  { alias: "building:town", url: "/mythic/atlas/building-town.svg" },
  { alias: "building:dungeon", url: "/mythic/atlas/building-dungeon.svg" },
  { alias: "prop:landmark", url: "/mythic/atlas/prop-landmark.svg" },
  { alias: "prop:lantern", url: "/mythic/atlas/prop-lantern.svg" },
  { alias: "prop:tree", url: "/mythic/atlas/prop-tree.svg" },
  { alias: "prop:torch", url: "/mythic/atlas/prop-torch.svg" },
];

export const MYTHIC_ASSET_FALLBACKS: AssetFallbackManifest = {
  classFallbacks: {
    infantry: "entity:ally:infantry",
    caster: "entity:ally:caster",
    brute: "entity:enemy:brute",
    beast: "entity:enemy:beast",
    npc: "entity:neutral:npc",
    structure: "building:town",
  },
  biomeFallbacks: {
    town_cobble_lantern: ["building:town", "prop:lantern"],
    forest_green_fireflies: ["prop:tree", "prop:landmark"],
    dungeon_stone_torch: ["building:dungeon", "prop:torch"],
    plains_road_dust: ["prop:landmark"],
    snow_frost_mist: ["prop:landmark", "entity:neutral:npc"],
    desert_heat_shimmer: ["prop:landmark", "entity:enemy:beast"],
  },
};
