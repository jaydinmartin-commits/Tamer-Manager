function cleanString(value) {
  return String(value ?? "").trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(cleanString)
    .filter(Boolean))];
}

function normalizeProvider(provider) {
  if (!provider || typeof provider !== "object") return null;
  const id = cleanString(provider.id);
  if (!id || typeof provider.resolve !== "function") return null;
  return { id, resolve: provider.resolve };
}

export const CompanionProgression = Object.freeze({
  createProvider({ id, resolve } = {}) {
    const normalizedId = cleanString(id);
    if (!normalizedId || typeof resolve !== "function") {
      throw new Error("A progression provider requires an id and resolve function.");
    }
    return Object.freeze({ id: normalizedId, resolve });
  },

  async resolveAll(context, providers = []) {
    if (!context || typeof context !== "object") {
      return { valid: false, results: [], errors: ["A companion access context is required."] };
    }

    const normalizedProviders = (Array.isArray(providers) ? providers : [])
      .map(normalizeProvider)
      .filter(Boolean);
    const requestedIds = uniqueStrings(context.progressionProviderIds);
    const byId = new Map(normalizedProviders.map(provider => [provider.id, provider]));
    const errors = [];
    const results = [];

    for (const id of requestedIds) {
      const provider = byId.get(id);
      if (!provider) {
        errors.push(`Missing progression provider: ${id}.`);
        continue;
      }

      try {
        const result = await provider.resolve(context);
        if (!result || result.valid !== true || result.providerId !== id) {
          errors.push(`Progression provider ${id} returned an invalid result.`);
          continue;
        }
        results.push(foundry.utils.deepClone(result));
      } catch (error) {
        errors.push(`Progression provider ${id} failed: ${String(error?.message ?? error)}`);
      }
    }

    return {
      valid: errors.length === 0 && results.length === requestedIds.length,
      results,
      errors
    };
  }
});
