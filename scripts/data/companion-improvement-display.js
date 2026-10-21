/**
 * Resolves a companion's saved improvement selections to safe display entries.
 * Unknown legacy selections remain visible so saved data is never silently hidden.
 */
export function selectedImprovementDisplay(record, definitions = []) {
  const byId = new Map((Array.isArray(definitions) ? definitions : []).map(definition => [String(definition.id), definition]));
  const selections = new Map();
  for (const raw of record?.improvements ?? []) {
    const id = typeof raw === "string" ? raw : String(raw?.id ?? "");
    if (!id) continue;
    const countValue = typeof raw === "string" ? 1 : Number(raw?.count ?? raw?.rank ?? 1);
    const count = Number.isFinite(countValue) ? Math.max(1, Math.floor(countValue)) : 1;
    selections.set(id, (selections.get(id) ?? 0) + count);
  }

  const replacedIds = new Set();
  for (const id of selections.keys()) {
    const replacesId = byId.get(id)?.replacesId;
    if (replacesId && selections.has(String(replacesId))) replacedIds.add(String(replacesId));
  }

  return [...selections.entries()]
    .filter(([id]) => !replacedIds.has(id))
    .map(([id, count]) => {
      const definition = byId.get(id);
      const name = String(definition?.name ?? id);
      const repeatable = definition?.repeatable === true;
      return {
        id,
        name,
        count,
        missingDefinition: !definition,
        label: definition
          ? (count > 1 ? `${name} ×${count}` : name)
          : `${name} (definition missing)`
      };
    });
}
