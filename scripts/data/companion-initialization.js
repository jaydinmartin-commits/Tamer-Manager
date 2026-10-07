import { TamerCompanionSummary } from "./tamer-companion-summary.js";

const LOST_TRAIT_CATEGORIES = Object.freeze([
  "spellcasting",
  "summoning",
  "regeneration",
  "rejuvenation",
  "legendary-resistance",
  "limited-hit-point-restoration",
  "legendary-actions",
  "mythic-traits",
  "lair-actions",
  "regional-effects"
]);

const SHARED_RESILIENCE_LEVELS = Object.freeze([3, 5, 11, 17]);

function clone(value) {
  return foundry.utils.deepClone(value);
}

function normalizeCR(value) {
  const cr = Number(value);
  return Number.isFinite(cr) ? cr : null;
}

function getCompanionIdentifier(actor) {
  return String(
    actor?.system?.identifier ??
    actor?.identifier ??
    ""
  ).trim().toLowerCase();
}

function getTamerPB(actor) {
  const value = Number(actor?.system?.attributes?.prof ?? actor?.system?.prof);
  return Number.isFinite(value) ? value : null;
}

function getAbilityModifier(actor, ability = "con") {
  const value = Number(actor?.system?.abilities?.[ability]?.mod);
  return Number.isFinite(value) ? value : null;
}

function getHitDie(actor) {
  const denomination = Number(actor?.system?.attributes?.hd?.denomination);
  return Number.isFinite(denomination) && denomination > 0 ? denomination : null;
}

function getSharedResilienceCount(tamerLevel) {
  return SHARED_RESILIENCE_LEVELS.filter(level => level <= Number(tamerLevel)).length;
}

function getTrainingPlan(tamer, companion) {
  const cr = normalizeCR(
    companion?.system?.details?.cr ??
    companion?.system?.details?.challenge
  );

  if (cr == null) {
    throw new Error("Companion CR is required to initialize a companion.");
  }

  return TamerCompanionSummary.training(tamer, cr);
}

export const CompanionInitialization = Object.freeze({
  lostTraitCategories() {
    return [...LOST_TRAIT_CATEGORIES];
  },

  sharedResilienceLevels() {
    return [...SHARED_RESILIENCE_LEVELS];
  },

  plan({ tamer, companion, bespoke = false, bonusImprovementIds = [] } = {}) {
    if (!tamer || !companion) {
      throw new Error("Tamer and companion Actors are required.");
    }

    const summary = TamerCompanionSummary.forTamer(tamer);
    const training = getTrainingPlan(tamer, companion);
    const tamerLevel = summary.level;
    const companionCR = training.companionCR;

    if (!training.eligible) {
      return {
        eligible: false,
        reason: training.reason,
        tamerLevel,
        companionCR,
        maxCR: summary.maxCR
      };
    }

    const hitDie = getHitDie(companion);
    const constitutionModifier = getAbilityModifier(companion);
    const resilienceCount = bespoke ? getSharedResilienceCount(tamerLevel) : 0;

    return clone({
      eligible: true,
      tamerLevel,
      companionCR,
      companionIdentifier: getCompanionIdentifier(companion),
      maxSize: summary.maxSize,
      maxCR: summary.maxCR,
      training: {
        improvements: training.improvements,
        hitDice: training.hitDice
      },
      bespoke: {
        enabled: Boolean(bespoke),
        bonusImprovementIds: [...new Set(
          (Array.isArray(bonusImprovementIds) ? bonusImprovementIds : [])
            .map(value => String(value).trim())
            .filter(Boolean)
        )],
        sharedResilience: {
          levelsReached: SHARED_RESILIENCE_LEVELS.filter(level => level <= tamerLevel),
          additionalHitDice: resilienceCount,
          baseHitDie: hitDie,
          constitutionModifier
        }
      },
      lostTraitCategories: [...LOST_TRAIT_CATEGORIES],
      proficiencyBonus: getTamerPB(tamer),
      mutationRequired: true
    });
  }
});
