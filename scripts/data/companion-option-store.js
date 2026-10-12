import { CompanionOptionDefinition } from "./companion-option-definition.js";
import { CompanionOptionValidator } from "./companion-option-validator.js";

const MODULE_ID = "tamer-manager";
const SETTING_KEY = "companionOptions";
const SCHEMA_VERSION = 1;

function clone(value) { return foundry.utils.deepClone(value); }
function emptyStore() { return { schemaVersion: SCHEMA_VERSION, definitions: [] }; }

function migrateStore(value) {
  if (value == null) return emptyStore();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored companion options are malformed; no data was changed.");
  }
  if (!Number.isInteger(value.schemaVersion)) {
    throw new Error("Stored companion options have no recognized schema version; export or repair the data before editing.");
  }
  if (value.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Stored companion options use newer schema version ${value.schemaVersion}; this module will not overwrite them.`);
  }
  if (value.schemaVersion < 1) {
    throw new Error(`Unsupported companion option schema version ${value.schemaVersion}; data was preserved.`);
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`No safe migration is registered for companion option schema version ${value.schemaVersion}.`);
  }
  if (!Array.isArray(value.definitions)) {
    throw new Error("Stored companion options have no definitions array; data was preserved.");
  }
  const definitions = [];
  for (let index = 0; index < value.definitions.length; index += 1) {
    const raw = value.definitions[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !raw.id) {
      throw new Error(`Stored companion option at index ${index} is malformed; no data was changed.`);
    }
    try {
      definitions.push(CompanionOptionDefinition.normalize(raw));
    } catch (error) {
      throw new Error(`Stored companion option at index ${index} cannot be normalized: ${error.message}`);
    }
  }
  const result = CompanionOptionValidator.validate(definitions);
  if (!result.valid) throw new Error(`Stored companion options failed validation; data was preserved. ${result.errors.join(" ")}`);
  return { schemaVersion: SCHEMA_VERSION, definitions };
}

function readRawStore() {
  if (!game.settings?.settings?.has?.(`${MODULE_ID}.${SETTING_KEY}`)) {
    throw new Error("Tamer Manager companion option storage is not registered.");
  }
  return game.settings.get(MODULE_ID, SETTING_KEY);
}
function readStore() { return migrateStore(readRawStore()); }
function normalizeDefinitions(definitions) {
  if (!Array.isArray(definitions)) throw new Error("Companion option definitions must be an array.");
  const normalized = definitions.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record) || !record.id) {
      throw new Error(`Companion option at index ${index} is malformed; it was not discarded.`);
    }
    if (record.name != null && typeof record.name !== "string") throw new Error(`Companion option at index ${index} has an invalid name.`);
    if (record.slotCost != null && (!Number.isInteger(record.slotCost) || record.slotCost < 0)) throw new Error(`Companion option ${record.id} has invalid slotCost.`);
    if (record.pointCost != null && (!Number.isFinite(record.pointCost) || record.pointCost < 0)) throw new Error(`Companion option ${record.id} has invalid pointCost.`);
    if (record.repeatable != null && typeof record.repeatable !== "boolean") throw new Error(`Companion option ${record.id} has invalid repeatable flag.`);
    if (record.maxSelections != null && (!Number.isInteger(record.maxSelections) || record.maxSelections < 1)) throw new Error(`Companion option ${record.id} has invalid maxSelections.`);
    if (record.requirements != null && (!record.requirements || typeof record.requirements !== "object" || Array.isArray(record.requirements))) throw new Error(`Companion option ${record.id} has invalid requirements.`);
    if (record.requirements?.tamerLevel != null && (!Number.isInteger(record.requirements.tamerLevel) || record.requirements.tamerLevel < 0 || record.requirements.tamerLevel > 20)) throw new Error(`Companion option ${record.id} has invalid Tamer level requirement.`);
    if (record.prerequisiteIds != null && !Array.isArray(record.prerequisiteIds)) throw new Error(`Companion option ${record.id} prerequisiteIds must be an array.`);
    if (record.treeId != null && (typeof record.treeId !== "string" || !record.treeId.trim())) throw new Error(`Companion option ${record.id} has invalid treeId.`);
    return CompanionOptionDefinition.normalize(record);
  });
  const validation = CompanionOptionValidator.validate(normalized);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  return normalized;
}

export const CompanionOptionStore = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  read() { return clone(readStore()); },
  list(type = null) {
    const definitions = readStore().definitions;
    return type ? definitions.filter(definition => definition.type === String(type)) : definitions;
  },
  get(id) { return readStore().definitions.find(definition => definition.id === String(id)) ?? null; },
  async write(definitions) {
    const normalized = normalizeDefinitions(definitions);
    const store = { schemaVersion: SCHEMA_VERSION, definitions: normalized };
    await game.settings.set(MODULE_ID, SETTING_KEY, store);
    return clone(store);
  },
  async upsert(definition) {
    if (!definition || typeof definition !== "object" || !definition.id) throw new Error("Invalid companion option definition.");
    const normalized = CompanionOptionDefinition.normalize(definition);
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
    normalizeDefinitions(definitions);
    return true;
  },
  migrate(value) { return clone(migrateStore(value)); }
});
