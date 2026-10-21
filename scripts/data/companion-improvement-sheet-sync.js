const MODULE_ID = "tamer-manager";

export function hasAdvancementData(advancement) {
  if (Array.isArray(advancement)) return advancement.length > 0;
  return Boolean(advancement && typeof advancement === "object" && !Array.isArray(advancement) && Object.keys(advancement).length > 0);
}

/**
 * Synchronize only module-owned improvement Items. Unrelated items and manually
 * created copies are never modified or deleted by this reconciliation.
 */
/**
 * Run the native D&D 5e advancement workflow for each newly added rank.
 * The caller saves the selection only after all required choice workflows finish.
 */
export async function applyNewImprovementAdvancements(actor, previousSelections, nextSelections, definitions) {
  const byId = new Map(definitions.map(definition => [String(definition.id), definition]));
  const countSelections = selections => {
    const counts = new Map();
    for (const raw of selections ?? []) {
      const id = typeof raw === "string" ? raw : String(raw?.id ?? "");
      if (!id) continue;
      const count = typeof raw === "string" ? 1 : Math.max(1, Math.floor(Number(raw?.count ?? raw?.rank ?? 1) || 1));
      counts.set(id, (counts.get(id) ?? 0) + count);
    }
    return counts;
  };
  const before = countSelections(previousSelections);
  const after = countSelections(nextSelections);
  const warnings = [];
  const Manager = game.dnd5e?.applications?.advancement?.AdvancementManager;
  for (const [id, count] of after) {
    const definition = byId.get(id);
    if (!definition?.sourceUuid) continue;
    const oldCount = before.get(id) ?? 0;
    const source = await fromUuid(definition.sourceUuid).catch(() => null);
    if (!source || source.documentName !== "Item") {
      warnings.push(definition.name + " has advancements but its source Item is unavailable.");
      continue;
    }
    const sourceData = source.toObject();
    if (!hasAdvancementData(sourceData.system?.advancement)) continue;
    if (!Manager?.forNewItem) {
      warnings.push("The D&D 5e advancement workflow is unavailable; " + definition.name + " was not added.");
      continue;
    }
    for (let rank = 1; rank <= count; rank++) {
      // Existing selection records can outlive an interrupted advancement
      // workflow. Retry ranks whose managed advancement Item is still pending.
      const completedRank = Array.from(actor.items ?? []).some(item =>
        item.getFlag?.(MODULE_ID, "managedImprovementId") === id &&
        Number(item.getFlag?.(MODULE_ID, "managedImprovementRank")) === rank &&
        item.getFlag?.(MODULE_ID, "advancementWorkflow") !== true
      );
      if (completedRank) continue;
      // Record existing documents before opening the workflow. An interrupted
      // rank may already have a pending managed Item, so matching only by flags
      // could mistakenly mark that stale Item complete instead of the new result.
      const existingItemIds = new Set(Array.from(actor.items ?? []).map(item => item.id ?? item._id).filter(Boolean));
      const itemData = foundry.utils.deepClone(sourceData);
      delete itemData._id;
      itemData.flags ??= {};
      itemData.flags[MODULE_ID] = {
        ...(itemData.flags[MODULE_ID] ?? {}),
        managedImprovementId: id,
        managedImprovementRank: rank,
        sourceUuid: source.uuid,
        advancementWorkflow: true
      };
      let manager;
      try {
        manager = Manager.forNewItem(actor, itemData);
        if (!manager.steps?.length) {
          warnings.push(definition.name + " has advancement data, but D&D 5e produced no applicable advancement steps. The selection was not saved as configured.");
          return { warnings };
        }
        const completed = await new Promise(resolve => {
          let settled = false;
          const finish = value => {
            if (settled) return;
            settled = true;
            Hooks.off("dnd5e.advancementManagerComplete", onComplete);
            resolve(value);
          };
          const onComplete = candidate => {
            if (candidate === manager) finish(true);
          };
          Hooks.on("dnd5e.advancementManagerComplete", onComplete);
          const originalOnClose = manager._onClose.bind(manager);
          manager._onClose = function(options) {
            originalOnClose(options);
            finish(false);
          };
          Promise.resolve(manager.render({ force: true })).catch(error => {
            console.error("Tamer Manager | Could not open advancement workflow.", error);
            finish(false);
          });
        });
        if (!completed) {
          warnings.push(definition.name + " rank " + rank + " advancement was cancelled or failed; selections were not saved.");
          return { warnings };
        }
        const created = Array.from(actor.items ?? []).find(item =>
          !existingItemIds.has(item.id ?? item._id) &&
          item.getFlag?.(MODULE_ID, "managedImprovementId") === id &&
          Number(item.getFlag?.(MODULE_ID, "managedImprovementRank")) === rank &&
          item.getFlag?.(MODULE_ID, "advancementWorkflow") === true
        );
        if (created) {
          // Keep the Item that owns the advancement data even when the GM has
          // disabled its ordinary sheet display. Deleting it here would orphan
          // advancement choices and prevent D&D 5e from tracking/reversing them.
          await created.update({
            ["flags." + MODULE_ID + ".advancementWorkflow"]: false,
            ["flags." + MODULE_ID + ".displayOnSheet"]: definition.displayOnSheet === true
          });
        }
      } catch (error) {
        console.error("Tamer Manager | Improvement advancement failed for " + id + " rank " + rank + ".", error);
        warnings.push(definition.name + " rank " + rank + " advancement could not be completed.");
        return { warnings };
      }
    }
  }
  return { warnings };
}

export async function syncImprovementSheetItems(actor, selections, definitions, allDefinitions = definitions) {
  const byId = new Map(definitions.map(definition => [String(definition.id), definition]));
  const allById = new Map(allDefinitions.map(definition => [String(definition.id), definition]));
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

  // Preserve selected legacy definitions that are no longer configured, plus
  // selected managed Items that actually own native advancement data. Do not
  // preserve every selected-but-ineligible definition: its stale sheet Item
  // must still be removed when it is no longer eligible for this companion.
  const advancementOwnedIds = existing
    .filter(item => {
      const id = String(item.getFlag(MODULE_ID, "managedImprovementId") ?? "");
      return counts.has(id) &&
        hasAdvancementData(item.system?.advancement);
    })
    .map(item => String(item.getFlag(MODULE_ID, "managedImprovementId")));
  const desiredIds = new Set([
    ...desired.keys(),
    ...[...counts.keys()].filter(id => !allById.has(id)),
    ...advancementOwnedIds
  ]);
  const removals = existing.filter(item => !desiredIds.has(String(item.getFlag(MODULE_ID, "managedImprovementId"))));
  // Advancement Items own selected choices/effects. Remove deselected
  // improvements and ranks above the selected count.
  const excessAdvancementRanks = existing.filter(item => {
    if (item.getFlag(MODULE_ID, "advancementWorkflow") === true) return true;
    const id = String(item.getFlag(MODULE_ID, "managedImprovementId") ?? "");
    if (!id || !hasAdvancementData(item.system?.advancement)) return false;
    const rank = Number(item.getFlag(MODULE_ID, "managedImprovementRank"));
    return !counts.has(id) || (Number.isFinite(rank) && rank > (counts.get(id) ?? 0));
  });
  const removalIds = [...new Set([...removals, ...excessAdvancementRanks].map(item => item.id).filter(Boolean))];
  if (removalIds.length) {
    try {
      await actor.deleteEmbeddedDocuments("Item", removalIds);
    } catch (error) {
      console.error("Tamer Manager | Failed to remove deselected managed improvements and advancement ranks.", error);
      warnings.push("One or more removed improvement advancements could not be cleaned up from the companion.");
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
    const roman = ({ i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 })[rank];
    return roman ?? (Number(rank) || 0);
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
