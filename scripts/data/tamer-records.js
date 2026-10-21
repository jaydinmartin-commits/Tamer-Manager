import { CompanionRecord } from "./companion-record.js";
import { CompanionInitialization } from "./companion-initialization.js";
import { CompanionInitializationApplication } from "./companion-initialization-application.js";
import { CompanionOptions } from "./companion-options.js";

const MODULE_ID = "tamer-manager";
const FLAG_KEY = "companions";

function validateRecords(records) {
  if (!Array.isArray(records)) throw new Error("Companion records must be an array.");
  const ids = new Set();
  const actors = new Set();
  const normalized = records.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record) || !record.id) {
      throw new Error(`Companion record at index ${index} is malformed; no data was written.`);
    }
    const value = CompanionRecord.normalize(record);
    if (!value) throw new Error(`Companion record at index ${index} could not be normalized.`);
    if (ids.has(value.id)) throw new Error(`Duplicate companion record ID: ${value.id}`);
    ids.add(value.id);
    if (value.actorUuid) {
      if (actors.has(value.actorUuid)) throw new Error(`Duplicate companion Actor reference: ${value.actorUuid}`);
      actors.add(value.actorUuid);
    }
    return value;
  });
  return normalized;
}

function applicationMatches(companion, entry) {
  const hd = Number(companion?.system?.attributes?.hd?.max);
  const hp = companion?.system?.attributes?.hp;
  return Number.isInteger(hd) && hd === entry.hitDiceAfter &&
    Number(hp?.max) === entry.hpAfter?.max &&
    Number(hp?.value) === entry.hpAfter?.value &&
    String(hp?.formula ?? "") === String(entry.formulaAfter ?? "");
}

export class TamerRecords {
  static isTamer(actor) {
    return Boolean(actor?.items?.some(item =>
      item.type === "class" &&
      (String(item.name ?? "").trim().toLowerCase() === "tamer" ||
       String(item.system?.identifier ?? "").trim().toLowerCase() === "tamer")
    ));
  }

  static read(actor) {
    if (!this.isTamer(actor)) return [];
    return CompanionRecord.read(actor);
  }

  static async write(actor, companions) {
    if (!actor?.setFlag || !this.isTamer(actor)) return false;
    const normalized = validateRecords(companions);
    await actor.setFlag(MODULE_ID, FLAG_KEY, normalized);
    const persisted = CompanionRecord.read(actor);
    if (persisted.length !== normalized.length ||
        persisted.some((record, index) => record.id !== normalized[index].id ||
          record.actorUuid !== normalized[index].actorUuid)) {
      throw new Error("Companion relationship persistence could not be verified.");
    }
    return true;
  }

  static async previewAdd(actor, companion) {
    if (!this.isTamer(actor) || !companion) return { eligible: false, reason: "missing-tamer-or-companion" };
    if (!companion.uuid) return { eligible: false, reason: "missing-companion-uuid" };
    if (this.read(actor).some(record => record.actorUuid === companion.uuid)) {
      return { eligible: false, reason: "already-registered" };
    }
    return CompanionInitialization.planWithAccess({ owner: actor, companion });
  }

  static async add(actor, companion) {
    if (!this.isTamer(actor) || !companion?.uuid) {
      return { record: null, reason: !companion?.uuid ? "missing-companion-uuid" : "missing-tamer-or-companion" };
    }
    const records = this.read(actor);
    const existing = records.find(record => record.actorUuid === companion.uuid);
    if (existing) return { record: existing, initialization: null };

    const applicationId = `${actor.uuid}::${companion.uuid}::initialization-v1`;
    // Recovery path: the mechanical update may have succeeded while the separate
    // Tamer relationship write failed. Reconcile only if the ledger and final
    // mechanical values prove that this exact initialization committed.
    const prior = CompanionInitializationApplication.history(companion)
      .find(entry => entry.applicationId === applicationId);
    if (prior) {
      if (!applicationMatches(companion, prior)) {
        return { record: null, reason: "initialization-recovery-state-mismatch" };
      }
      const recovered = CompanionRecord.create({
        id: foundry.utils.randomID(), name: companion.name ?? "Companion", actorUuid: companion.uuid
      });
      try {
        await this.write(actor, [...records, recovered]);
        return { record: recovered, initialization: { applied: true, verified: true, recovered: true, ...prior } };
      } catch (error) {
        return { record: null, reason: "companion-record-persistence-failed", initialization: prior, error };
      }
    }

    const preview = await this.previewAdd(actor, companion);
    if (!preview.eligible) return { record: null, reason: preview.reason ?? "initialization-preflight-failed" };

    const initialization = await CompanionInitializationApplication.apply({
      owner: actor, companion, plan: preview, applicationId
    });
    if (!initialization.applied || !initialization.verified) {
      return { record: null, reason: initialization.reason ?? "initialization-application-failed" };
    }

    const record = CompanionRecord.create({
      id: foundry.utils.randomID(), name: companion.name ?? "Companion", actorUuid: companion.uuid
    });
    // Bespoke features explicitly marked "grant on taming" are selected once
    // during initial registration and never consume improvement slots.
    const automaticGrants = CompanionOptions.byType("improvement", { companion })
      .filter(option => option.grantOnTaming === true &&
        CompanionOptions.isAvailable(option, { tamer: actor, companion }));
    record.improvements = [...new Set(automaticGrants.map(option => String(option.id)))];
    try {
      await this.write(actor, [...records, record]);
    } catch (error) {
      return { record: null, reason: "companion-record-persistence-failed", initialization, error };
    }
    return { record, initialization };
  }

  static async remove(actor, recordId) {
    if (!this.isTamer(actor)) return false;
    const records = this.read(actor);
    const filtered = records.filter(record => String(record.id) !== String(recordId));
    if (filtered.length === records.length) return false;
    await this.write(actor, filtered);
    return true;
  }
}
