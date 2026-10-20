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


/**
 * Keep the companion's Hit Die denomination aligned with its selected Growth
 * improvement. Size, attacks, and all other Growth effects remain the feature's
 * responsibility. The original die size is tracked so deselection can restore
 * it without overwriting a later manual change to the Actor.
 */
export async function reconcileGrowthHitDie(actor, selections, definitions) {
  const byId = new Map(definitions.map(definition => [String(definition.id), definition]));
  const selectedIds = new Set((selections ?? []).map(raw =>
    typeof raw === "string" ? raw : String(raw?.id ?? "")
  ).filter(Boolean));
  const growthRank = value => {
    const normalized = String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = normalized.match(/growth(vi|iv|iii|ii|i|[1-6])$/);
    if (!match) return 0;
    const rank = match[1];
    return ({ i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 })[rank] ?? Number(rank) ?? 0;
  };
  let highestRank = 0;
  for (const id of selectedIds) {
    const definition = byId.get(id);
    if (!definition || definition.type !== "improvement") continue;
    if (!definition.treeId && !(definition.requirements?.companionIdentifiers?.length)) continue;
    highestRank = Math.max(highestRank, growthRank(definition.id), growthRank(definition.name));
  }

  const denomination = Number(actor?.system?.attributes?.hd?.denomination);
  if (!Number.isInteger(denomination) || denomination < 2) {
    return { changed: false, warning: "Growth Hit Die size could not be reconciled because the Actor's Hit Die denomination is invalid." };
  }

  const previous = actor.getFlag?.(MODULE_ID, "growthHitDieState") ?? null;
  if (highestRank > 0) {
    const target = highestRank === 1 ? 6 : highestRank === 2 ? 8 : highestRank === 3 ? 10 : 12;
    const baseDenomination = Number.isInteger(previous?.baseDenomination) ? previous.baseDenomination : denomination;
    const state = { baseDenomination, appliedDenomination: target, rank: highestRank };
    if (denomination === target && previous?.baseDenomination === baseDenomination && previous?.appliedDenomination === target && previous?.rank === highestRank) {
      return { changed: false, warning: null };
    }
    await actor.update({
      "system.attributes.hd.denomination": target,
      ["flags." + MODULE_ID + ".growthHitDieState"]: state
    });
    const verified = Number(actor.system?.attributes?.hd?.denomination) === target;
    return { changed: verified, warning: verified ? null : "Growth Hit Die size could not be verified after the Actor update." };
  }

  if (!previous) return { changed: false, warning: null };
  if (denomination === Number(previous.appliedDenomination)) {
    await actor.update({
      "system.attributes.hd.denomination": Number(previous.baseDenomination),
      ["flags." + MODULE_ID + ".-=growthHitDieState"]: null
    });
    const verified = Number(actor.system?.attributes?.hd?.denomination) === Number(previous.baseDenomination);
    return { changed: verified, warning: verified ? null : "The original Hit Die size could not be restored after Growth was removed." };
  }
  // A GM/user changed the denomination after Growth was applied. Preserve that
  // deliberate edit rather than restoring a stale value over it.
  await actor.unsetFlag?.(MODULE_ID, "growthHitDieState");
  return { changed: false, warning: null };
}
