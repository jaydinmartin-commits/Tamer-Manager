function clone(value) {
  return foundry.utils.deepClone(value);
}

export const CompanionSelection = Object.freeze({
  create({ id, count = 1, uuid = null } = {}) {
    if (!id) throw new Error("CompanionSelection requires an id.");

    return {
      id: String(id),
      count: Math.max(1, Number(count) || 1),
      uuid: uuid ? String(uuid) : null
    };
  },

  normalize(selection) {
    if (!selection?.id) return null;

    return this.create({
      ...clone(selection),
      count: selection.count ?? 1
    });
  },

  normalizeList(selections) {
    if (!Array.isArray(selections)) return [];
    return selections
      .map(selection => this.normalize(selection))
      .filter(Boolean);
  }
});
