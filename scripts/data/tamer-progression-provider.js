import { TamerCompanionSummary } from "./tamer-companion-summary.js";

const PROVIDER_ID = "tamer-class";

export const TamerProgressionProvider = Object.freeze({
  id: PROVIDER_ID,

  async resolve(context) {
    if (!context || !Array.isArray(context.sources)) {
      return { valid: false, providerId: PROVIDER_ID, reason: "invalid-access-context" };
    }

    const source = context.sources.find(entry => entry?.id === PROVIDER_ID);
    if (!source || source.type !== "class" || !source.documentUuid) {
      return { valid: false, providerId: PROVIDER_ID, reason: "missing-tamer-source" };
    }

    const level = Number(source.metadata?.classLevel);
    if (!Number.isInteger(level) || level < 1 || level > 20) {
      return { valid: false, providerId: PROVIDER_ID, reason: "invalid-tamer-level" };
    }

    const summary = TamerCompanionSummary.forLevel(level);
    return {
      valid: true,
      providerId: PROVIDER_ID,
      level: summary.level,
      maxCompanions: summary.maxCompanions,
      maxSize: summary.maxSize,
      maxCR: summary.maxCR
    };
  }
});
