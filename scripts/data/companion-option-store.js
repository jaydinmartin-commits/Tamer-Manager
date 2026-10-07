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
    definitions: definitions
      .map(record => CompanionOptionDefinition.normalize(record))
      .filter(Boolean)
  };
}

function readStore() {
  if (!game.settings?.settings?.has?.(`${MODULE_ID}.${SETTING_KEY}`)) {
    return { schemaVersion: SCHEMA_VERSION, definitions: [] };
  }

  return normalizeStore(game.settings.get(MODULE_ID, SETTING_KEY));
}

export const CompanionOptionStore = Object.freeze({
  schemaVersion: SCHEMA_VERSION,

  read() {
    return clone(readStore());
  },

  list(type = null) {
    const definitions = readStore().definitions;
    return type
      ? definitions.filter(definition => definition.type === String(type))
      : definitions;
  },

  get(id) {
    return readStore().definitions.find(
      definition => definition.id === String(id)
    ) ?? null;
  },

  async write(definitions) {
    if (!game.settings?.settings?.has?.(`${MODULE_ID}.${SETTING_KEY}`)) {
      throw new Error("Tamer Manager companion option storage is not registered.");
    }

    const normalized = definitions
      .map(record => CompanionOptionDefinition.normalize(record))
      .filter(Boolean);

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
    const definitions = readStore().definitions.filter(
      definition => definition.id !== String(id)
    );

    return this.write(definitions);
  }
});
