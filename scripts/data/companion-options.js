import { CompanionOptionDefinition } from "./companion-option-definition.js";

const MODULE_ID = "tamer-manager";
const SETTING_KEY = "companionOptions";

function getDefinitions() {
  if (!game.settings?.settings?.has?.(`${MODULE_ID}.${SETTING_KEY}`)) return [];
  const value = game.settings.get(MODULE_ID, SETTING_KEY);
  return Array.isArray(value) ? value : [];
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

function companionMatches(record, requirements) {
  const identifiers = requirements.companionIdentifiers ?? [];
  if (!identifiers.length) return true;

  const actorUuid = String(record?.actorUuid ?? "");
  const actor = actorUuid && globalThis.fromUuidSync ? globalThis.fromUuidSync(actorUuid) : null;
  const identifier = String(
    actor?.system?.identifier ??
    actor?.identifier ??
    ""
  ).trim().toLowerCase();

  return identifiers.some(value =>
    String(value).trim().toLowerCase() === identifier
  );
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

  byType(type) {
    return this.read().filter(option => option.type === String(type));
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
