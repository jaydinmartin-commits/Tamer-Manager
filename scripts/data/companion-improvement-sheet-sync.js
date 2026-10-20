const MODULE_ID = "tamer-manager";

/**
 * Synchronize only module-owned improvement Items. Unrelated items and manually
 * created copies are never modified or deleted by this reconciliation.
 */
export async function syncImprovementSheetItems(actor, selections, definitions) {
  const byId = new Map(definitions.map(definition => [String(definition.id), definition]));
  const counts = new Map();
  for (const raw of selections ?? []) {
    const id = typeof raw === "string" ? raw : String(raw?.id ?? "");
    if (!id) continue;
    const rawCount = typeof raw === "string" ? 1 : Number(raw?.count ?? raw?.rank ?? 1);
    const count = Number.isFinite(rawCount) ? Math.max(1, Math.floor(rawCount)) : 1;
    counts.set(id, Math.max(counts.get(id) ?? 0, count));
  }

  const replaced = new Set();
  for (const id of counts.keys()) {
    const target = byId.get(id)?.replacesId;
    if (target && counts.has(String(target))) replaced.add(String(target));
  }
  const desired = new Map([...counts.keys()]
    .filter(id => !replaced.has(id))
    .map(id => [id, byId.get(id)])
    .filter(([, definition]) => definition?.displayOnSheet === true));
  const existing = Array.from(actor.items ?? []).filter(item => item.getFlag?.(MODULE_ID, "managedImprovementId"));
  const existingById = new Map(existing.map(item => [String(item.getFlag(MODULE_ID, "managedImprovementId")), item]));
  const warnings = [];

  // Add before removing so a missing source or failed creation never deletes
  // the previous working sheet representation.
  for (const [id, definition] of desired) {
    if (existingById.has(id)) continue;
    if (!definition.sourceUuid) {
      warnings.push(definition.name + " is set to appear on the sheet but has no Source Item UUID.");
      continue;
    }
    const source = await fromUuid(definition.sourceUuid).catch(() => null);
    if (!source || source.documentName !== "Item") {
      warnings.push(definition.name + " could not be added because its source Item is unavailable.");
      continue;
    }
    const data = source.toObject();
    delete data._id;
    data.flags ??= {};
    data.flags[MODULE_ID] = {
      ...(data.flags[MODULE_ID] ?? {}),
      managedImprovementId: id,
      sourceUuid: source.uuid
    };
    try {
      const created = await actor.createEmbeddedDocuments("Item", [data]);
      if (created?.[0]) existingById.set(id, created[0]);
      else warnings.push(definition.name + " was not created on the companion sheet.");
    } catch (error) {
      console.error("Tamer Manager | Failed to add sheet improvement " + id + ".", error);
      warnings.push(definition.name + " could not be added to the companion sheet.");
    }
  }

  const desiredIds = new Set(desired.keys());
  const removals = existing.filter(item => !desiredIds.has(String(item.getFlag(MODULE_ID, "managedImprovementId"))));
  if (removals.length) {
    try {
      await actor.deleteEmbeddedDocuments("Item", removals.map(item => item.id));
    } catch (error) {
      console.error("Tamer Manager | Failed to remove deselected sheet improvements.", error);
      warnings.push("One or more deselected managed improvements could not be removed from the companion sheet.");
    }
  }
  return { warnings };
}
