/**
 * Computes the effective slot usage of saved improvement selections.
 * Unknown definitions are deliberately ignored here; callers should surface them
 * as legacy data rather than guessing their cost.
 */
export function selectedImprovementSlotCost(record, definitions) {
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const counts = new Map();
  for (const selection of record?.improvements ?? []) {
    const id = typeof selection === "string" ? selection : String(selection?.id ?? "");
    if (!id) continue;
    const rawCount = typeof selection === "string" ? 1 : Number(selection?.count ?? selection?.rank ?? 1);
    // Corrupt persisted counts must never turn the total into NaN and bypass the allowance check.
    const count = Number.isFinite(rawCount) && rawCount >= 1 ? Math.floor(rawCount) : 1;
    counts.set(id, (counts.get(id) ?? 0) + count);
  }
  return [...counts.entries()].reduce((total, [id, count]) => {
    const definition = byId.get(id);
    if (!definition) return total;
    const replacedBySelectedUpgrade = [...counts.keys()].some(selectedId => byId.get(selectedId)?.replacesId === id);
    return replacedBySelectedUpgrade ? total : total + Math.max(0, Number(definition.slotCost) || 0) * count;
  }, 0);
}

/**
 * Returns the additional slots an improvement needs after crediting the
 * configured cost of the improvement it replaces.
 */
export function additionalImprovementSlotCost(requiredSlots, replacedSlots = 0) {
  const required = Math.max(0, Number(requiredSlots) || 0);
  const credit = Math.max(0, Number(replacedSlots) || 0);
  return Math.max(0, required - credit);
}
