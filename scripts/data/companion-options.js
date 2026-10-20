import { CompanionOptionDefinition } from "./companion-option-definition.js";

const MODULE_ID = "tamer-manager";
const SETTING_KEY = "companionOptions";

function getDefinitions() {
  if (!game.settings?.settings?.has?.(`${MODULE_ID}.${SETTING_KEY}`)) return [];
  const value = game.settings.get(MODULE_ID, SETTING_KEY);
  return Array.isArray(value?.definitions) ? value.definitions : [];
}

function getTamerClass(actor) {
  return actor?.items?.find(item =>
    item.type === "class" &&
    (
      String(item.name ?? "").trim().toLowerCase() === "tamer" ||
      String(item.system?.identifier ?? "").trim().toLowerCase() === "tamer"
    )
  ) ?? null;
}

function getTamerLevel(actor) {
  const tamer = getTamerClass(actor);
  const levels = Number(tamer?.system?.levels);
  return Number.isFinite(levels) ? levels : 0;
}

function companionIdentifier(companion) {
  return String(companion?.system?.identifier ?? companion?.system?.details?.identifier ??
    companion?.flags?.["tamer-manager"]?.companionIdentifier ?? companion?.companionIdentifier ?? "")
    .trim().toLowerCase();
}
function companionMatches(companion, requirements) {
  const identifiers = requirements.companionIdentifiers ?? [];
  if (!identifiers.length) return true;
  const identifier = companionIdentifier(companion);
  return Boolean(identifier) && identifiers.some(value => String(value).trim().toLowerCase() === identifier);
}
function configuredTrees() {
  try {
    const store = game.settings.get(MODULE_ID, "companionTrees");
    return new Map((Array.isArray(store?.trees) ? store.trees : []).map(tree => [String(tree.id), tree]));
  } catch { return new Map(); }
}

export const CompanionOptions = Object.freeze({
  settingKey: SETTING_KEY,

  read() {
    return getDefinitions()
      .map(record => CompanionOptionDefinition.normalize(record))
      .filter(Boolean);
  },

  get(id) {
    return this.read().find(option => option.id === String(id)) ?? null;
  },

  byType(type, { companion = null } = {}) {
    const definitions = this.read().filter(option => option.type === String(type));
    if (!companion) return definitions;
    const identifier = companionIdentifier(companion);
    const trees = configuredTrees();
    return definitions.filter(option => {
      if (!option.treeId) {
        const identifiers = option.requirements?.companionIdentifiers ?? [];
        return !identifiers.length || companionMatches(companion, option.requirements);
      }
      const tree = trees.get(String(option.treeId));
      if (!tree || !identifier) return false;
      // New trees declare the companion's system identifier explicitly. For
      // existing trees, preserve the original convention that tree ID equals
      // the companion identifier. An option-level identifier may narrow access,
      // but must never bypass a mismatch with its assigned tree.
      const expectedIdentifier = String(tree.companionIdentifier ?? tree.id).trim().toLowerCase();
      if (expectedIdentifier !== identifier) return false;
      const identifiers = option.requirements?.companionIdentifiers ?? [];
      return !identifiers.length || companionMatches(companion, option.requirements);
    });
  },

  isAvailable(option, { tamer = null, companion = null } = {}) {
    const definition = typeof option === "string" ? this.get(option) : option;
    if (!definition || !tamer) return false;

    const requirements = definition.requirements;
    if (requirements.tamerLevel && getTamerLevel(tamer) < requirements.tamerLevel) return false;
    if (!companionMatches(companion, requirements)) return false;

    return true;
  }
});

export { getTamerClass, getTamerLevel };
