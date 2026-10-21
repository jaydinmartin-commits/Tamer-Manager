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


/** Resolve saved native advancement choices to readable labels for the companion card. */
export function selectedAdvancementChoiceLabels(actor, improvementId) {
  const labels = [];
  const add = value => {
    if (typeof value !== "string" || !value.trim()) return;
    // Keep duplicates: separate ranks of a repeatable improvement may have
    // distinct selections, and each rank must remain visible on the card.
    labels.push(value.trim());
  };
  for (const item of Array.from(actor?.items ?? [])) {
    if (String(item.getFlag?.("tamer-manager", "managedImprovementId") ?? "") !== String(improvementId)) continue;
    const advancement = item.system?.advancement;
    const entries = Array.isArray(advancement) ? advancement : Object.values(advancement ?? {});
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const configuration = entry.configuration ?? {};
      const options = configuration.items ?? configuration.choices ?? {};
      const optionMap = new Map();
      if (Array.isArray(options)) {
        for (const option of options) {
          if (typeof option === "string") optionMap.set(option, option);
          else if (option && typeof option === "object") {
            const key = String(option.uuid ?? option.id ?? option.value ?? option.name ?? "");
            if (key) optionMap.set(key, String(option.name ?? option.label ?? option.title ?? key));
          }
        }
      } else if (options && typeof options === "object") {
        for (const [key, option] of Object.entries(options)) {
          const label = typeof option === "string" ? option : String(option?.name ?? option?.label ?? option?.title ?? key);
          optionMap.set(key, label);
          if (option && typeof option === "object") for (const alias of [option.uuid, option.id, option.value].filter(Boolean)) optionMap.set(String(alias), label);
        }
      }
      const selected = entry.value ?? entry.selected ?? entry.choices ?? [];
      for (const value of (Array.isArray(selected) ? selected : selected == null || selected === "" ? [] : [selected])) {
        if (typeof value === "string") add(optionMap.get(value) ?? value);
        else if (value && typeof value === "object") add(value.name ?? value.label ?? value.title ?? value.value);
      }
    }
  }
  return labels;
}
