import { CompanionOptionDefinition } from "./companion-option-definition.js";

const MODULE_ID = "tamer-manager";
const SETTING_KEY = "companionOptions";
const SCHEMA_VERSION = 1;

function clone(value) {
  return foundry.utils.deepClone(value);
}

function normalizeStore(value) {
  const source = value && typeof value === "object" ? value : {};
  const definitions = Array.isArray(source.definitions) ? source.definitions : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    definitions: definitions.map(record => CompanionOptionDefinition.normalize(record)).filter(Boolean)
  };
}

function readStore() {
  if (!game.settings?.settings?.has?.(`${MODULE_ID}.${SETTING_KEY}`)) {
    return { schemaVersion: SCHEMA_VERSION, definitions: [] };
  }
  return normalizeStore(game.settings.get(MODULE_ID, SETTING_KEY));
}

function validateDefinitions(definitions) {
  const ids = new Set();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate companion option ID: ${definition.id}`);
    ids.add(definition.id);
  }
  for (const definition of definitions) {
    if (definition.prerequisiteIds.includes(definition.id)) {
      throw new Error(`Companion option cannot require itself: ${definition.id}`);
    }
    if (definition.replacesId === definition.id) {
      throw new Error(`Companion option cannot replace itself: ${definition.id}`);
    }
    for (const prerequisiteId of definition.prerequisiteIds) {
      if (!ids.has(prerequisiteId)) throw new Error(`Unknown prerequisite ${prerequisiteId} for ${definition.id}.`);
    }
    if (definition.replacesId && !ids.has(definition.replacesId)) {
      throw new Error(`Unknown replacement ${definition.replacesId} for ${definition.id}.`);
    }
  }
  return definitions;
}

export const CompanionOptionStore = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  read() { return clone(readStore()); },
  list(type = null) {
    const definitions = readStore().definitions;
    return type ? definitions.filter(definition => definition.type === String(type)) : definitions;
  },
  get(id) {
    return readStore().definitions.find(definition => definition.id === String(id)) ?? null;
  },
  async write(definitions) {
    if (!Array.isArray(definitions)) throw new Error("Companion option definitions must be an array.");
    if (!game.settings?.settings?.has?.(`${MODULE_ID}.${SETTING_KEY}`)) {
      throw new Error("Tamer Manager companion option storage is not registered.");
    }
    const normalized = definitions.map(record => CompanionOptionDefinition.normalize(record)).filter(Boolean);
    validateDefinitions(normalized);
    const store = { schemaVersion: SCHEMA_VERSION, definitions: normalized };
    await game.settings.set(MODULE_ID, SETTING_KEY, store);
    return clone(store);
  },
  async upsert(definition) {
    const normalized = CompanionOptionDefinition.normalize(definition);
    if (!normalized) throw new Error("Invalid companion option definition.");
    const definitions = readStore().definitions;
    const index = definitions.findIndex(item => item.id === normalized.id);
    if (index === -1) definitions.push(normalized);
    else definitions[index] = normalized;
    return this.write(definitions);
  },
  async remove(id) {
    const targetId = String(id);
    const definitions = readStore().definitions;
    if (!definitions.some(definition => definition.id === targetId)) return this.read();
    const dependents = definitions.filter(definition =>
      definition.id !== targetId && (definition.prerequisiteIds.includes(targetId) || definition.replacesId === targetId)
    );
    if (dependents.length) throw new Error(`Cannot remove ${targetId}; other options depend on it.`);
    return this.write(definitions.filter(definition => definition.id !== targetId));
  },
  validate(definitions = readStore().definitions) {
    const normalized = definitions.map(record => CompanionOptionDefinition.normalize(record)).filter(Boolean);
    validateDefinitions(normalized);
    return true;
  }
});
