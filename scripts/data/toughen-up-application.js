const MODULE_ID = "tamer-manager";
const FLAG_KEY = "appliedHitDieImprovements";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getHitDie(actor) {
  const hd = actor?.system?.attributes?.hd;
  const denomination = finiteNumber(hd?.denomination);
  const maximum = finiteNumber(hd?.max);
  if (denomination == null || denomination < 2 || maximum == null || maximum < 0) return null;
  return { denomination, maximum };
}

function getConstitutionModifier(actor) {
  return finiteNumber(actor?.system?.abilities?.con?.mod);
}

function getHitPoints(actor) {
  const hp = actor?.system?.attributes?.hp;
  const value = finiteNumber(hp?.value);
  const maximum = finiteNumber(hp?.max);
  if (value == null || maximum == null || maximum < 0 || value < 0) return null;
  return { value, maximum, formula: hp?.formula ?? null };
}

function getUpdatedNpcFormula(formula, constitutionModifier) {
  if (typeof formula !== "string") return null;

  // Only transform a single die term with an optional fixed integer modifier.
  // Dynamic expressions, extra dice, and other formula syntax must fail closed
  // rather than risk changing the meaning of the NPC's HP formula.
  const match = formula.trim().match(/^([0-9]*)d([0-9]+)(?:\s*([+-])\s*([0-9]+))?\s*$/i);
  if (!match) return null;

  const count = Number(match[1] || 1);
  const faces = Number(match[2]);
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(faces) || faces < 2) return null;

  const sign = match[3] === "-" ? -1 : 1;
  const existingModifier = match[4] == null ? 0 : sign * Number(match[4]);
  const updatedModifier = existingModifier + constitutionModifier;
  const suffix = updatedModifier === 0
    ? ""
    : updatedModifier < 0
      ? String(updatedModifier)
      : "+" + updatedModifier;

  return (count + 1) + "d" + faces + suffix;
}

function getLedger(actor) {
  const ledger = actor?.getFlag?.(MODULE_ID, FLAG_KEY);
  return Array.isArray(ledger) ? ledger : [];
}

function clone(value) {
  return foundry.utils.deepClone(value);
}

export const ToughenUpApplication = Object.freeze({
  /**
   * Returns a read-only preflight. It does not roll or mutate the Actor.
   * applicationId must uniquely identify this individual Toughen Up selection.
   */
  preview({ actor, applicationId } = {}) {
    if (!actor?.isOwner && !game.user?.isGM) {
      return { eligible: false, reason: "actor-not-owned" };
    }
    if (!actor?.update || !actor?.setFlag || !applicationId) {
      return { eligible: false, reason: "missing-actor-or-application-id" };
    }

    const existing = getLedger(actor).find(entry => entry.applicationId === String(applicationId));
    if (existing) {
      return { eligible: false, reason: "already-applied", previous: clone(existing) };
    }

    if (actor.type !== "npc") return { eligible: false, reason: "unsupported-actor-type-for-hit-die-update" };

    const hitDie = getHitDie(actor);
    if (!hitDie) return { eligible: false, reason: "unsupported-hit-die-data" };

    const hp = getHitPoints(actor);
    if (!hp) return { eligible: false, reason: "unsupported-hit-point-data" };

    const constitutionModifier = getConstitutionModifier(actor);
    if (constitutionModifier == null) {
      return { eligible: false, reason: "missing-constitution-modifier" };
    }

    const formulaAfter = getUpdatedNpcFormula(hp.formula, constitutionModifier);
    if (!formulaAfter) return { eligible: false, reason: "unsupported-npc-hp-formula" };

    return {
      eligible: true,
      applicationId: String(applicationId),
      denomination: hitDie.denomination,
      hitDiceBefore: hitDie.maximum,
      hpBefore: hp,
      formulaBefore: hp.formula,
      formulaAfter,
      constitutionModifier
    };
  },

  /**
   * Applies one Toughen Up selection. The selection ID ledger makes retries
   * idempotent and stores the rolled result for audit/recovery.
   */
  async apply({ actor, applicationId } = {}) {
    const preview = this.preview({ actor, applicationId });
    if (!preview.eligible) return preview;

    const roll = await (new Roll(String.raw`1d${preview.denomination}`)).evaluate();
    const hpIncrease = Math.max(0, Number(roll.total) + preview.constitutionModifier);
    const hpBefore = preview.hpBefore;
    const hpAfter = {
      max: hpBefore.maximum + hpIncrease,
      // Preserve the actor's missing HP; an unconscious/0-HP companion stays at 0.
      value: hpBefore.value === 0
        ? 0
        : Math.min(hpBefore.maximum + hpIncrease, hpBefore.value + hpIncrease)
    };

    const ledgerEntry = {
      applicationId: preview.applicationId,
      type: "toughen-up",
      denomination: preview.denomination,
      roll: Number(roll.total),
      constitutionModifier: preview.constitutionModifier,
      hpIncrease,
      hpBefore: clone(hpBefore),
      hpAfter: clone(hpAfter),
      formulaBefore: preview.formulaBefore,
      formulaAfter: preview.formulaAfter,
      hitDiceBefore: preview.hitDiceBefore,
      hitDiceAfter: preview.hitDiceBefore + 1,
      appliedAt: new Date().toISOString()
    };

    // Apply mechanics and audit record in one Actor update to avoid a successful
    // HP change without a corresponding idempotency record if a later write fails.
    const ledger = getLedger(actor);
    await actor.update({
      "system.attributes.hd.max": preview.hitDiceBefore + 1,
      "system.attributes.hp.formula": preview.formulaAfter,
      "system.attributes.hp.max": hpAfter.max,
      "system.attributes.hp.value": hpAfter.value,
      [`flags.${MODULE_ID}.${FLAG_KEY}`]: [...ledger, ledgerEntry]
    });

    const verifiedHP = getHitPoints(actor);
    const verifiedHD = getHitDie(actor);
    const verified = Boolean(
      verifiedHP &&
      verifiedHD &&
      verifiedHP.maximum === hpAfter.max &&
      verifiedHP.value === hpAfter.value &&
      verifiedHP.formula === preview.formulaAfter &&
      verifiedHD.maximum === preview.hitDiceBefore + 1
    );

    return {
      applied: true,
      verified,
      applicationId: preview.applicationId,
      roll: Number(roll.total),
      constitutionModifier: preview.constitutionModifier,
      hpIncrease,
      hpBefore,
      hpAfter: verifiedHP,
      formulaBefore: preview.formulaBefore,
      formulaAfter: verifiedHP?.formula ?? null,
      hitDiceBefore: preview.hitDiceBefore,
      hitDiceAfter: verifiedHD?.maximum ?? null,
      reason: verified ? null : "post-update-verification-failed"
    };
  },

  async reconcile({ actor, desiredApplicationIds = [] } = {}) {
    const warnings = [];
    if (!actor?.update || !actor?.getFlag) {
      return { removed: 0, warnings: ["Toughen Up could not be reconciled because the companion Actor is unavailable."] };
    }
    const desired = new Set(desiredApplicationIds.map(String));
    const obsolete = getLedger(actor)
      .filter(entry => entry?.type === "toughen-up" && !desired.has(String(entry.applicationId)))
      .sort((a, b) => {
        const rank = entry => Number(String(entry.applicationId).match(/::rank-(\d+)::toughen-up-v1$/)?.[1] ?? 0);
        return rank(b) - rank(a);
      });
    let removed = 0;
    for (const entry of obsolete) {
      const ledger = getLedger(actor);
      if (!ledger.some(value => value.applicationId === entry.applicationId)) continue;
      const hp = getHitPoints(actor);
      const hd = getHitDie(actor);
      const expectedMax = Number(entry.hpAfter?.max);
      const expectedFormula = entry.formulaAfter;
      const expectedHD = Number(entry.hitDiceAfter);
      if (!hp || !hd || hp.maximum !== expectedMax || hd.maximum !== expectedHD ||
          actor.system?.attributes?.hp?.formula !== expectedFormula) {
        warnings.push("Toughen Up could not safely undo a removed rank because the companion's HP, Hit Dice, or HP formula changed after it was applied. Its history was preserved.");
        continue;
      }
      const hpIncrease = Math.max(0, Number(entry.hpIncrease) || 0);
      const nextMax = Math.max(0, hp.maximum - hpIncrease);
      const nextValue = hp.value === 0 ? 0 : Math.max(0, Math.min(nextMax, hp.value - hpIncrease));
      const nextLedger = ledger.filter(value => value.applicationId !== entry.applicationId);
      try {
        await actor.update({
          "system.attributes.hd.max": Math.max(0, hd.maximum - 1),
          "system.attributes.hp.max": nextMax,
          "system.attributes.hp.value": nextValue,
          "system.attributes.hp.formula": entry.formulaBefore,
          [`flags.${MODULE_ID}.${FLAG_KEY}`]: nextLedger
        });
        const verified = Number(actor.system?.attributes?.hd?.max) === expectedHD - 1 &&
          Number(actor.system?.attributes?.hp?.max) === nextMax &&
          actor.system?.attributes?.hp?.formula === entry.formulaBefore &&
          !getLedger(actor).some(value => value.applicationId === entry.applicationId);
        if (!verified) {
          warnings.push("A removed Toughen Up rank could not be fully verified after reversal. Check the companion's HP and Hit Dice.");
          continue;
        }
        removed += 1;
      } catch (error) {
        console.error("Tamer Manager | Toughen Up reversal failed.", error);
        warnings.push("A removed Toughen Up rank could not be reverted. Its history was preserved.");
        break;
      }
    }
    return { removed, warnings };
  },

  history(actor) {
    return clone(getLedger(actor));
  }
});
