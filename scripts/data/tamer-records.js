import { CompanionRecord } from "./companion-record.js";

const MODULE_ID = "tamer-manager";
const FLAG_KEY = "companions";

export class TamerRecords {
  static isTamer(actor) {
    return Boolean(actor?.items?.some(item =>
      item.type === "class" &&
      (
        String(item.name ?? "").trim().toLowerCase() === "tamer" ||
        String(item.system?.identifier ?? "").trim().toLowerCase() === "tamer"
      )
    ));
  }

  static read(actor) {
    if (!this.isTamer(actor)) return [];
    return CompanionRecord.read(actor);
  }

  static async write(actor, companions) {
    if (!actor?.setFlag || !this.isTamer(actor)) return false;
    const normalized = companions
      .map(record => CompanionRecord.normalize(record))
      .filter(Boolean);
    await actor.setFlag(MODULE_ID, FLAG_KEY, normalized);
    return true;
  }

  static async add(actor, companion) {
    if (!this.isTamer(actor) || !companion) return null;

    const records = this.read(actor);
    const actorUuid = companion.uuid ?? null;
    if (!actorUuid) return null;

    const existing = records.find(record => record.actorUuid === actorUuid);
    if (existing) return existing;

    const id = foundry.utils.randomID();
    const record = CompanionRecord.create({
      id,
      name: companion.name ?? "Companion",
      actorUuid
    });

    records.push(record);
    await this.write(actor, records);
    return record;
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
