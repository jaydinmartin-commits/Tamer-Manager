import { CompanionAccessResolver } from "./companion-access-resolver.js";

function isTamerClass(item) {
  return item?.type === "class" && (
    String(item.name ?? "").trim().toLowerCase() === "tamer" ||
    String(item.system?.identifier ?? "").trim().toLowerCase() === "tamer"
  );
}

export const CompanionAccessAdapters = Object.freeze({
  tamerClass(owner) {
    return {
      id: "tamer-class",
      async resolve() {
        const item = owner?.items?.find(isTamerClass);
        if (!item?.uuid) return null;

        return {
          valid: true,
          source: {
            id: "tamer-class",
            type: "class",
            documentUuid: item.uuid,
            name: String(item.name ?? "Tamer"),
            allowedOperations: [
              CompanionAccessResolver.operations.OPEN_MANAGER,
              CompanionAccessResolver.operations.MANAGE_COMPANIONS,
              CompanionAccessResolver.operations.CHOOSE_IMPROVEMENTS
            ],
            progressionProviderIds: ["tamer-class"],
            metadata: {
              classIdentifier: String(item.system?.identifier ?? "tamer"),
              classLevel: Number.isFinite(Number(item.system?.levels))
                ? Number(item.system.levels)
                : null
            }
          }
        };
      }
    };
  }
});
