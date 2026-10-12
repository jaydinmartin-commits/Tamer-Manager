const ACCESS_OPERATIONS = Object.freeze({
  OPEN_MANAGER: "open-manager",
  MANAGE_COMPANIONS: "manage-companions",
  CHOOSE_IMPROVEMENTS: "choose-improvements",
  MANAGE_AUGMENTS: "manage-augments",
  MANAGE_INFUSIONS: "manage-infusions"
});

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") return null;
  const id = cleanString(adapter.id);
  if (!id || typeof adapter.resolve !== "function") return null;
  return { id, resolve: adapter.resolve };
}

export const CompanionAccessResolver = Object.freeze({
  operations: ACCESS_OPERATIONS,

  async resolve({ owner, companionId = null, adapters = [] } = {}) {
    if (!owner?.uuid || !Array.isArray(adapters)) {
      return { valid: false, context: null, errors: ["A valid owner Actor and access adapter list are required."] };
    }

    const normalizedAdapters = adapters.map(normalizeAdapter);
    if (normalizedAdapters.some(adapter => !adapter)) {
      return { valid: false, context: null, errors: ["One or more access adapters are invalid."] };
    }
    const ids = normalizedAdapters.map(adapter => adapter.id);
    if (new Set(ids).size !== ids.length) {
      return { valid: false, context: null, errors: ["Access adapter IDs must be unique."] };
    }

    const sources = [];
    const errors = [];

    for (const adapter of normalizedAdapters) {
      try {
        const result = await adapter.resolve({ owner, companionId });
        if (result == null) continue;
        if (!result || result.valid !== true || !result.source) {
          errors.push(`Access adapter ${adapter.id} returned an invalid result.`);
          continue;
        }
        if (cleanString(result.source.id) !== adapter.id) {
          errors.push(`Access adapter ${adapter.id} returned a mismatched source ID.`);
          continue;
        }
        sources.push(result.source);
      } catch (error) {
        errors.push(`Access adapter ${adapter.id} failed: ${String(error?.message ?? error)}`);
      }
    }

    if (errors.length) {
      return { valid: false, context: null, errors };
    }

    try {
      const { CompanionAccessContext } = await import("./companion-access-context.js");
      const context = CompanionAccessContext.create({
        ownerUuid: owner.uuid,
        companionId,
        sources
      });
      return { valid: true, context, errors: [] };
    } catch (error) {
      return {
        valid: false,
        context: null,
        errors: [String(error?.message ?? error)]
      };
    }
  }
});
