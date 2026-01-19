export interface PlayerState {
  currentLocationId: string | null;
  knownLocations: string[];
  flags: string[];
  injuries: string[];
  statusEffects: string[];
  inventory: string[];
}

export interface PlayerDelta {
  current_location_id?: string | null;
  known_locations_add?: string[];
  flags_add?: string[];
  injuries_add?: string[];
  status_effects_add?: string[];
  inventory_add?: string[];
  inventory_remove?: string[];
}

export interface WorldEventDelta {
  player_delta?: PlayerDelta;
  player_state_fingerprint?: string;
  action_hash?: string;
  summary?: string;
  locations?: unknown[];
  npcs?: unknown[];
  quests?: unknown[];
  storyFlags?: unknown[];
}

export const emptyPlayerState = (): PlayerState => ({
  currentLocationId: null,
  knownLocations: [],
  flags: [],
  injuries: [],
  statusEffects: [],
  inventory: [],
});

const uniq = (items: string[]) => Array.from(new Set(items));

export const applyPlayerDelta = (state: PlayerState, delta?: PlayerDelta): PlayerState => {
  if (!delta) return state;
  const next = { ...state };
  if (typeof delta.current_location_id !== "undefined") {
    next.currentLocationId = delta.current_location_id ?? null;
  }
  if (delta.known_locations_add?.length) {
    next.knownLocations = uniq(next.knownLocations.concat(delta.known_locations_add));
  }
  if (delta.flags_add?.length) {
    next.flags = uniq(next.flags.concat(delta.flags_add));
  }
  if (delta.injuries_add?.length) {
    next.injuries = uniq(next.injuries.concat(delta.injuries_add));
  }
  if (delta.status_effects_add?.length) {
    next.statusEffects = uniq(next.statusEffects.concat(delta.status_effects_add));
  }
  if (delta.inventory_add?.length) {
    next.inventory = uniq(next.inventory.concat(delta.inventory_add));
  }
  if (delta.inventory_remove?.length) {
    next.inventory = next.inventory.filter(item => !delta.inventory_remove?.includes(item));
  }
  return next;
};

export const derivePlayerStateFromEvents = (events: Array<{ delta: unknown }>): PlayerState => {
  let state = emptyPlayerState();
  for (const event of events) {
    if (!event?.delta || typeof event.delta !== "object") continue;
    const deltaObj = event.delta as WorldEventDelta;
    if (!deltaObj.player_delta) continue;
    state = applyPlayerDelta(state, deltaObj.player_delta);
  }
  return state;
};

export const hashPlayerState = (state: PlayerState): string => {
  const payload = JSON.stringify({
    currentLocationId: state.currentLocationId,
    knownLocations: [...state.knownLocations].sort(),
    flags: [...state.flags].sort(),
    injuries: [...state.injuries].sort(),
    statusEffects: [...state.statusEffects].sort(),
    inventory: [...state.inventory].sort(),
  });
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 31 + payload.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
};
