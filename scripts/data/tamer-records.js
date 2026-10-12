import { CompanionRecord } from "./companion-record.js";
import { CompanionInitialization } from "./companion-initialization.js";
import { CompanionInitializationApplication } from "./companion-initialization-application.js";

const MODULE_ID = "tamer-manager";
const FLAG_KEY = "companions";

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
    const normalized = companions.map(record => CompanionRecord.normalize(record)).filter(Boolean);
    await actor.setFlag(MODULE_ID, FLAG_KEY, normalized);
    return true;
  }

  // Shared preflight for the UI and data layer. Adding a record is a live
  // companion-management operation, so it must not bypass access/progression
  // or CR/size eligibility validation.
  static async previewAdd(actor, companion) {
    if (!this.isTamer(actor) || !companion) {
      return { eligible: false, reason: "missing-tamer-or-companion" };
    }
    if (!companion.uuid) return { eligible: false, reason: "missing-companion-uuid" };
    if (this.read(actor).some(record => record.actorUuid === companion.uuid)) {
      return { eligible: false, reason: "already-registered" };
    }
    return CompanionInitialization.planWithAccess({ owner: actor, companion });
  }

  static async add(actor, companion) {
    const preview = await this.previewAdd(actor, companion);
    if (!preview.eligible) return { record: null, reason: preview.reason ?? "initialization-preflight-failed" };

    const records = this.read(actor);
    const actorUuid = companion.uuid ?? null;
    if (!actorUuid) return { record: null, reason: "missing-companion-uuid" };
    const existing = records.find(record => record.actorUuid === actorUuid);
    if (existing) return { record: existing, initialization: null };

    // The Actor mutation is guarded by a deterministic application ID so retries
    // cannot grant the same training hit dice twice.
    const initialization = await CompanionInitializationApplication.apply({
      owner: actor,
      companion,
      plan: preview,
      applicationId: `${actor.uuid}::${companion.uuid}::initialization-v1`
    });
    if (!initialization.applied || !initialization.verified) {
      return { record: null, reason: initialization.reason ?? "initialization-application-failed" };
    }

    const record = CompanionRecord.create({
      id: foundry.utils.randomID(),
      name: companion.name ?? "Companion",
      actorUuid
    });
    records.push(record);
    const written = await this.write(actor, records);
    if (!written) return { record: null, reason: "companion-record-persistence-failed", initialization };
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
