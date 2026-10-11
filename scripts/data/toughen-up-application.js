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
  return { value, maximum };
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

    const hitDie = getHitDie(actor);
    if (!hitDie) return { eligible: false, reason: "unsupported-hit-die-data" };

    const hp = getHitPoints(actor);
    if (!hp) return { eligible: false, reason: "unsupported-hit-point-data" };

    const constitutionModifier = getConstitutionModifier(actor);
    if (constitutionModifier == null) {
      return { eligible: false, reason: "missing-constitution-modifier" };
    }

    return {
      eligible: true,
      applicationId: String(applicationId),
      denomination: hitDie.denomination,
      hitDiceBefore: hitDie.maximum,
      hpBefore: hp,
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

    const hdPath = "system.attributes.hd.max";
    const ledgerEntry = {
      applicationId: preview.applicationId,
      type: "toughen-up",
      denomination: preview.denomination,
      roll: Number(roll.total),
      constitutionModifier: preview.constitutionModifier,
      hpIncrease,
      hpBefore: clone(hpBefore),
      hpAfter: clone(hpAfter),
      hitDiceBefore: preview.hitDiceBefore,
      hitDiceAfter: preview.hitDiceBefore + 1,
      appliedAt: new Date().toISOString()
    };

    // Apply mechanics and audit record in one Actor update to avoid a successful
    // HP change without a corresponding idempotency record if a later write fails.
    const ledger = getLedger(actor);
    await actor.update({
      "system.attributes.hp.max": hpAfter.max,
      "system.attributes.hp.value": hpAfter.value,
      [hdPath]: preview.hitDiceBefore + 1,
      [`flags.${MODULE_ID}.${FLAG_KEY}`]: [...ledger, ledgerEntry]
    });

    const verifiedHP = getHitPoints(actor);
    const verifiedHD = getHitDie(actor);
    const verified = Boolean(
      verifiedHP &&
      verifiedHD &&
      verifiedHP.maximum === hpAfter.max &&
      verifiedHP.value === hpAfter.value &&
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
      hitDiceBefore: preview.hitDiceBefore,
      hitDiceAfter: verifiedHD?.maximum ?? null,
      reason: verified ? null : "post-update-verification-failed"
    };
  },

  history(actor) {
    return clone(getLedger(actor));
  }
});
