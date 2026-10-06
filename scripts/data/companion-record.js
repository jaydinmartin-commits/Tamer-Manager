const MODULE_ID = "tamer-manager";
const FLAG_KEY = "companions";

function clone(value) {
  return foundry.utils.deepClone(value);
}

export const CompanionRecord = Object.freeze({
  create({ id, name = "", actorUuid = null, vesselUuid = null, vesselName = "" } = {}) {
    if (!id) throw new Error("CompanionRecord requires an id.");

    return {
      id: String(id),
      name: String(name),
      actorUuid: actorUuid ? String(actorUuid) : null,
      tokenUuid: null,
      vesselUuid: vesselUuid ? String(vesselUuid) : null,
      vesselName: String(vesselName ?? ""),
      status: "in-vessel",
      improvements: [],
      splicer: {
        augments: []
      }
    };
  },

  normalize(record) {
    if (!record || !record.id) return null;

    const normalized = {
      ...this.create({
        id: record.id,
        name: record.name,
        actorUuid: record.actorUuid,
        vesselUuid: record.vesselUuid,
        vesselName: record.vesselName
      }),
      tokenUuid: record.tokenUuid ? String(record.tokenUuid) : null,
      status: ["in-vessel", "summoned"].includes(String(record.status))
        ? String(record.status)
        : record.tokenUuid ? "summoned" : "in-vessel",
      improvements: Array.isArray(record.improvements)
        ? clone(record.improvements)
        : [],
      splicer: {
        ...(record.splicer ? clone(record.splicer) : {}),
        augments: Array.isArray(record.splicer?.augments)
          ? clone(record.splicer.augments)
          : []
      }
    };

    if (Array.isArray(record.splicer?.pendingAugments)) {
      normalized.splicer.pendingAugments = clone(record.splicer.pendingAugments);
    }

    return normalized;
  },

  read(actor) {
    const value = actor?.getFlag?.(MODULE_ID, FLAG_KEY);
    const records = Array.isArray(value) ? value : value?.companions;
    return Array.isArray(records)
      ? records.map(this.normalize).filter(Boolean)
      : [];
  }
});
