const TYPE_VALUES = new Set(["improvement", "augment"]);

function clone(value) {
  return foundry.utils.deepClone(value);
}

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeRequirements(requirements = {}) {
  const normalized = {
    tamerLevel: Number.isInteger(Number(requirements.tamerLevel)) && Number(requirements.tamerLevel) > 0
      ? Number(requirements.tamerLevel)
      : 0,
    companionIdentifiers: Array.isArray(requirements.companionIdentifiers)
      ? [...new Set(requirements.companionIdentifiers.map(value => cleanString(value)).filter(Boolean))]
      : []
  };
  return normalized;
}

export const CompanionOptionDefinition = Object.freeze({
  create({
    id,
    type = "improvement",
    name = "",
    sourceUuid = null,
    requirements = {},
    repeatable = false,
    maxSelections = null,
    slotCost = 0,
    pointCost = 0,
    prerequisiteIds = [],
    replacesId = null,
    treeId = null,
    companionIdentifiers = [],
    metadata = {}
  } = {}) {
    if (!id) throw new Error("CompanionOptionDefinition requires an id.");
    if (!TYPE_VALUES.has(type)) {
      throw new Error(`Unsupported companion option type: ${type}`);
    }

    const normalizedMax = maxSelections == null
      ? null
      : Math.max(1, Number(maxSelections) || 1);

    return {
      id: String(id),
      type: String(type),
      name: String(name ?? ""),
      sourceUuid: sourceUuid ? String(sourceUuid) : null,
      requirements: normalizeRequirements({
        ...requirements,
        companionIdentifiers: companionIdentifiers.length
          ? companionIdentifiers
          : requirements.companionIdentifiers
      }),
      repeatable: Boolean(repeatable),
      maxSelections: normalizedMax,
      slotCost: Math.max(0, Number(slotCost) || 0),
      pointCost: Math.max(0, Number(pointCost) || 0),
      prerequisiteIds: Array.isArray(prerequisiteIds)
        ? [...new Set(prerequisiteIds.map(value => String(value)).filter(Boolean))]
        : [],
      replacesId: replacesId ? String(replacesId) : null,
      treeId: treeId ? String(treeId) : null,
      metadata: clone(metadata ?? {})
    };
  },

  normalize(record) {
    if (!record?.id) return null;

    return this.create({
      ...clone(record),
      requirements: record.requirements ?? {},
      companionIdentifiers: record.requirements?.companionIdentifiers ?? []
    });
  }
});
