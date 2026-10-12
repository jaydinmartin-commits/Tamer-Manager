import { CompanionAccessResolver } from "./companion-access-resolver.js";
import { CompanionAccessAdapters } from "./companion-access-adapters.js";
import { TamerProgressionProvider } from "./tamer-progression-provider.js";

export const TamerAccessPreview = Object.freeze({
  async resolve(owner, { companionId = null } = {}) {
    if (!owner?.uuid || !Array.isArray(owner.items)) {
      return { valid: false, eligible: false, context: null, sources: [], errors: ["A valid owner Actor is required."] };
    }

    const adapters = [CompanionAccessAdapters.tamerClass(owner)];
    const access = await CompanionAccessResolver.resolve({ owner, companionId, adapters });
    if (!access.valid) {
      return { valid: false, eligible: false, context: null, sources: [], errors: access.errors };
    }

    const tamerSource = access.context.sources.find(source => source.id === "tamer-class");
    if (!tamerSource) {
      return {
        valid: true,
        eligible: false,
        context: access.context,
        sources: [],
        errors: [],
        reason: "no-supported-access-source"
      };
    }

    const progressionResult = await TamerProgressionProvider.resolve(access.context);
    const progression = progressionResult.valid ? progressionResult : null;

    return {
      valid: true,
      eligible: true,
      context: access.context,
      sources: access.context.sources.map(source => ({
        id: source.id,
        type: source.type,
        name: source.name,
        documentUuid: source.documentUuid,
        allowedOperations: [...source.allowedOperations],
        progressionProviderIds: [...source.progressionProviderIds],
        metadata: foundry.utils.deepClone(source.metadata)
      })),
      progression: progression ? {
        providerId: "tamer-class",
        level: progression.level,
        maxCompanions: progression.maxCompanions,
        maxSize: progression.maxSize,
        maxCR: progression.maxCR
      } : null,
      errors: [],
      reason: progression ? null : (progressionResult.reason ?? "invalid-tamer-level")
    };
  }
});
