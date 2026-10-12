const MODULE_ID = "tamer-manager";
const FLAG_KEY = "companionInitializationApplications";

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function clone(value) {
  return foundry.utils.deepClone(value);
}
function readLedger(actor) {
  const ledger = actor?.getFlag?.(MODULE_ID, FLAG_KEY);
  return Array.isArray(ledger) ? ledger : [];
}
function getHitDice(actor) {
  const denomination = numberOrNull(actor?.system?.attributes?.hd?.denomination);
  const maximum = numberOrNull(actor?.system?.attributes?.hd?.max);
  if (!Number.isInteger(denomination) || denomination < 2 ||
      !Number.isInteger(maximum) || maximum < 0) return null;
  return { denomination, maximum };
}
function getHP(actor) {
  const value = numberOrNull(actor?.system?.attributes?.hp?.value);
  const maximum = numberOrNull(actor?.system?.attributes?.hp?.max);
  const formula = actor?.system?.attributes?.hp?.formula;
  if (value == null || maximum == null || value < 0 || maximum < 0 ||
      value > maximum || typeof formula !== "string") return null;
  return { value, maximum, formula };
}
function parseHPFormula(formula) {
  const match = String(formula).trim().match(/^([0-9]*)d([0-9]+)(?:\s*([+-])\s*([0-9]+))?$/i);
  if (!match) return null;
  const count = Number(match[1] || 1);
  const faces = Number(match[2]);
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(faces) || faces < 2) return null;
  const modifier = match[4] == null ? 0 : (match[3] === "-" ? -1 : 1) * Number(match[4]);
  return { count, faces, modifier };
}
function formatHPFormula(count, faces, modifier) {
  return `${count}d${faces}${modifier === 0 ? "" : modifier > 0 ? "+" + modifier : modifier}`;
}

export const CompanionInitializationApplication = Object.freeze({
  preview({ owner, companion, plan, applicationId } = {}) {
    if (!owner?.uuid || !companion?.uuid || !plan?.eligible || !applicationId) {
      return { eligible: false, reason: "missing-initialization-input" };
    }
    if (companion.type !== "npc") return { eligible: false, reason: "unsupported-companion-actor-type" };
    if (typeof companion.update !== "function" || typeof companion.setFlag !== "function" ||
        typeof companion.getFlag !== "function") {
      return { eligible: false, reason: "missing-companion-update-capability" };
    }
    if (readLedger(companion).some(entry => entry.applicationId === String(applicationId))) {
      return { eligible: false, reason: "already-applied" };
    }
    const hitDiceToAdd = numberOrNull(plan.training?.hitDice);
    if (!Number.isInteger(hitDiceToAdd) || hitDiceToAdd < 0) {
      return { eligible: false, reason: "invalid-hit-dice-plan" };
    }
    const hitDice = getHitDice(companion);
    if (!hitDice) return { eligible: false, reason: "unsupported-hit-die-data" };
    const hp = getHP(companion);
    if (!hp) return { eligible: false, reason: "unsupported-hit-point-data" };
    const conMod = numberOrNull(companion.system?.abilities?.con?.mod);
    if (conMod == null) return { eligible: false, reason: "missing-constitution-modifier" };
    const parsed = parseHPFormula(hp.formula);
    if (!parsed || parsed.faces !== hitDice.denomination || parsed.count !== hitDice.maximum) {
      return { eligible: false, reason: "unsupported-or-inconsistent-hp-formula" };
    }
    return {
      eligible: true, applicationId: String(applicationId), hitDiceToAdd,
      denomination: hitDice.denomination, hitDiceBefore: hitDice.maximum,
      hitDiceAfter: hitDice.maximum + hitDiceToAdd, hpBefore: hp,
      hpFormulaAfter: formatHPFormula(parsed.count + hitDiceToAdd, parsed.faces,
        parsed.modifier + conMod * hitDiceToAdd),
      constitutionModifier: conMod
    };
  },

  async apply({ owner, companion, plan, applicationId } = {}) {
    const preview = this.preview({ owner, companion, plan, applicationId });
    if (!preview.eligible) return preview;

    const ledger = readLedger(companion);
    let hpIncrease = 0;
    const rolls = [];
    for (let index = 0; index < preview.hitDiceToAdd; index += 1) {
      const roll = await (new Roll(`1d${preview.denomination}`)).evaluate();
      const total = numberOrNull(roll.total);
      if (total == null) return { eligible: false, reason: "invalid-hit-die-roll" };
      rolls.push(total);
      hpIncrease += Math.max(1, total + preview.constitutionModifier);
    }
    const hpAfter = {
      max: preview.hpBefore.maximum + hpIncrease,
      value: preview.hpBefore.value === 0 ? 0 :
        Math.min(preview.hpBefore.maximum + hpIncrease, preview.hpBefore.value + hpIncrease)
    };
    const entry = {
      applicationId: preview.applicationId, type: "companion-initialization",
      hitDiceAdded: preview.hitDiceToAdd, rolls,
      constitutionModifier: preview.constitutionModifier, hpAdded: hpIncrease,
      hpBefore: clone(preview.hpBefore), hpAfter: { ...hpAfter },
      formulaBefore: preview.hpBefore.formula, formulaAfter: preview.hpFormulaAfter,
      hitDiceBefore: preview.hitDiceBefore, hitDiceAfter: preview.hitDiceAfter,
      appliedAt: new Date().toISOString()
    };

    // Persist mechanical values and the idempotency ledger in one Actor update.
    await companion.update({
      "system.attributes.hd.max": preview.hitDiceAfter,
      "system.attributes.hp.formula": preview.hpFormulaAfter,
      "system.attributes.hp.max": hpAfter.max,
      "system.attributes.hp.value": hpAfter.value,
      [`flags.${MODULE_ID}.${FLAG_KEY}`]: [...ledger, entry]
    });

    const finalHD = getHitDice(companion);
    const finalHP = getHP(companion);
    const verified = Boolean(finalHD && finalHP &&
      finalHD.maximum === preview.hitDiceAfter &&
      finalHP.maximum === hpAfter.max && finalHP.value === hpAfter.value &&
      finalHP.formula === preview.hpFormulaAfter);
    return { applied: true, verified, ...entry,
      reason: verified ? null : "post-update-verification-failed" };
  },

  history(companion) {
    return clone(readLedger(companion));
  }
});
