import { CompanionOptionStore } from "./companion-option-store.js";

const MODULE_ID = "tamer-manager";
const SETTING_KEY = "companionTrees";
const SCHEMA_VERSION = 1;

function clone(value) { return foundry.utils.deepClone(value); }
function emptyStore() { return { schemaVersion: SCHEMA_VERSION, trees: [] }; }

function validateTrees(trees, definitions = CompanionOptionStore.read().definitions) {
  if (!Array.isArray(trees)) throw new Error("Companion trees must be an array.");
  const ids = new Set();
  const errors = [];
  for (const tree of trees) {
    if (!tree || typeof tree !== "object" || Array.isArray(tree)) {
      errors.push("Every companion tree must be an object.");
      continue;
    }
    if (typeof tree.id !== "string" || !tree.id.trim()) errors.push("Every companion tree requires an ID.");
    else if (ids.has(tree.id)) errors.push(`Duplicate companion tree ID: ${tree.id}`);
    else ids.add(tree.id);
    if (typeof tree.name !== "string" || !tree.name.trim()) errors.push(`Tree ${tree.id ?? "(unknown)"} requires a name.`);
    if (typeof tree.description !== "string") errors.push(`Tree ${tree.id ?? "(unknown)"} requires a description string.`);
  }
  for (const definition of definitions) {
    if (definition.treeId && !trees.some(tree => tree?.id === definition.treeId)) {
      errors.push(`Option ${definition.id} references missing companion tree ${definition.treeId}.`);
    }
  }
  if (errors.length) throw new Error(errors.join(" "));
  return trees;
}

function migrate(value, definitions) {
  if (value == null) return emptyStore();
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isInteger(value.schemaVersion)) {
    throw new Error("Stored companion trees are malformed; data was preserved.");
  }
  if (value.schemaVersion > SCHEMA_VERSION) throw new Error(`Stored companion trees use newer schema version ${value.schemaVersion}; data was preserved.`);
  if (value.schemaVersion !== SCHEMA_VERSION) throw new Error(`No safe migration exists for companion tree schema version ${value.schemaVersion}.`);
  if (!Array.isArray(value.trees)) throw new Error("Stored companion trees have no trees array; data was preserved.");
  const trees = value.trees.map((tree, index) => {
    if (!tree || typeof tree !== "object" || Array.isArray(tree) || !tree.id) {
      throw new Error(`Stored companion tree at index ${index} is malformed; data was preserved.`);
    }
    return { ...clone(tree), id: String(tree.id), name: String(tree.name ?? ""), description: String(tree.description ?? "") };
  });
  validateTrees(trees, definitions);
  return { schemaVersion: SCHEMA_VERSION, trees };
}

export const CompanionTreeStore = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  read() {
    if (!game.settings?.settings?.has?.(`${MODULE_ID}.${SETTING_KEY}`)) throw new Error("Companion tree storage is not registered.");
    return clone(migrate(game.settings.get(MODULE_ID, SETTING_KEY), CompanionOptionStore.read().definitions));
  },
  list() { return this.read().trees; },
  get(id) { return this.list().find(tree => tree.id === String(id)) ?? null; },
  validate(trees) { validateTrees(trees, CompanionOptionStore.read().definitions); return true; },
  async write(trees) {
    // Refuse to overwrite malformed or future-version persisted tree data.
    this.read();
    if (!game.user?.isGM) throw new Error("Only a GM may modify companion trees.");
    const normalized = trees.map((tree, index) => {
      if (!tree || typeof tree !== "object" || Array.isArray(tree) || !tree.id) throw new Error(`Companion tree at index ${index} is malformed.`);
      return { ...clone(tree), id: String(tree.id), name: String(tree.name ?? "").trim(), description: String(tree.description ?? "") };
    });
    validateTrees(normalized, CompanionOptionStore.read().definitions);
    const store = { schemaVersion: SCHEMA_VERSION, trees: normalized };
    await game.settings.set(MODULE_ID, SETTING_KEY, store);
    return clone(store);
  },
  async upsert(tree) {
    if (!tree?.id) throw new Error("A companion tree ID is required.");
    const trees = this.list();
    const normalized = { id: String(tree.id), name: String(tree.name ?? "").trim(), description: String(tree.description ?? "") };
    const index = trees.findIndex(item => item.id === normalized.id);
    if (index < 0) trees.push(normalized); else trees[index] = normalized;
    return this.write(trees);
  },
  async remove(id) {
    if (!game.user?.isGM) throw new Error("Only a GM may modify companion trees.");
    const targetId = String(id);
    const referenced = CompanionOptionStore.read().definitions.filter(option => option.treeId === targetId);
    if (referenced.length) throw new Error(`Cannot remove tree ${targetId}; ${referenced.length} option(s) still reference it.`);
    return this.write(this.list().filter(tree => tree.id !== targetId));
  },
  migrate(value, definitions = CompanionOptionStore.read().definitions) { return clone(migrate(value, definitions)); }
});
