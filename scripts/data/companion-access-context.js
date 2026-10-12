const ACCESS_SOURCE_TYPES = new Set(["class", "feat", "item", "other"]);

function cleanString(value) {
  return String(value ?? "").trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(cleanString)
    .filter(Boolean))];
}

function normalizeSource(source) {
  if (!source || typeof source !== "object") return null;
  const id = cleanString(source.id);
  const type = cleanString(source.type);
  const documentUuid = cleanString(source.documentUuid);
  if (!id || !ACCESS_SOURCE_TYPES.has(type) || !documentUuid) return null;
  if (!Array.isArray(source.allowedOperations) || !Array.isArray(source.progressionProviderIds)) {
    return null;
  }
  if (source.metadata != null && (typeof source.metadata !== "object" || Array.isArray(source.metadata))) {
    return null;
  }

  return {
    id,
    type,
    documentUuid,
    name: cleanString(source.name),
    allowedOperations: uniqueStrings(source.allowedOperations),
    progressionProviderIds: uniqueStrings(source.progressionProviderIds),
    metadata: source.metadata ? foundry.utils.deepClone(source.metadata) : {}
  };
}

export const CompanionAccessContext = Object.freeze({
  create({ ownerUuid, owner = null, sources = [], companionId = null } = {}) {
    const normalizedOwnerUuid = cleanString(ownerUuid || owner?.uuid);
    if (!normalizedOwnerUuid) throw new Error("Companion access requires an owner Actor UUID.");
    if (!Array.isArray(sources)) throw new Error("Companion access sources must be an array.");

    const normalizedSources = sources.map((source, index) => {
      const normalized = normalizeSource(source);
      if (!normalized) {
        throw new Error(`Companion access source at index ${index} is invalid.`);
      }
      return normalized;
    });

    const sourceIds = normalizedSources.map(source => source.id);
    if (new Set(sourceIds).size !== sourceIds.length) {
      throw new Error("Companion access source IDs must be unique.");
    }

    const providerIds = normalizedSources.flatMap(source => source.progressionProviderIds);
    return {
      ownerUuid: normalizedOwnerUuid,
      companionId: companionId == null ? null : cleanString(companionId) || null,
      sources: normalizedSources,
      allowedOperations: uniqueStrings(normalizedSources.flatMap(source => source.allowedOperations)),
      progressionProviderIds: uniqueStrings(providerIds)
    };
  },

  normalize(context) {
    if (!context || typeof context !== "object") return null;
    try {
      return this.create(context);
    } catch {
      return null;
    }
  },

  can(context, operation) {
    const normalized = this.normalize(context);
    const requested = cleanString(operation);
    return Boolean(normalized && requested && normalized.allowedOperations.includes(requested));
  },

  hasSource(context, sourceId) {
    const normalized = this.normalize(context);
    const requested = cleanString(sourceId);
    return Boolean(normalized && requested && normalized.sources.some(source => source.id === requested));
  }
});
