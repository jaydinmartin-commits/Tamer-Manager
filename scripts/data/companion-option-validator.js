function duplicateIds(definitions) {
  const seen = new Set();
  const duplicates = new Set();
  for (const definition of definitions) {
    if (seen.has(definition.id)) duplicates.add(definition.id);
    seen.add(definition.id);
  }
  return [...duplicates];
}

function findCycles(byId) {
  const visiting = new Set();
  const visited = new Set();
  const cycles = new Set();
  function visit(id, path = []) {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      for (const item of path.slice(Math.max(0, start))) cycles.add(item);
      cycles.add(id);
      return;
    }
    if (visited.has(id)) return;
    const item = byId.get(id);
    if (!item) return;
    visiting.add(id);
    for (const prerequisite of item.prerequisiteIds ?? []) visit(prerequisite, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return [...cycles];
}

export const CompanionOptionValidator = Object.freeze({
  validate(definitions = []) {
    const errors = [];
    if (!Array.isArray(definitions)) {
      return { valid: false, errors: ["Companion options must be an array."] };
    }
    const list = definitions;
    const validObjects = list.filter(item => item && typeof item === "object" && !Array.isArray(item));
    if (validObjects.length !== list.length) errors.push("Every companion option must be an object.");
    for (const duplicate of duplicateIds(validObjects)) errors.push(`Duplicate companion option ID: ${duplicate}`);

    const byId = new Map();
    for (const definition of validObjects) {
      if (typeof definition.id !== "string" || !definition.id.trim()) errors.push("Every companion option requires a non-empty string ID.");
      else if (!byId.has(definition.id)) byId.set(definition.id, definition);
      if (!["improvement", "augment"].includes(definition.type)) errors.push(`Option ${definition.id ?? "(unknown)"} has an unsupported type.`);
      if (typeof definition.name !== "string" || !definition.name.trim()) errors.push(`Option ${definition.id ?? "(unknown)"} requires a name.`);
      if (!Number.isInteger(definition.slotCost) || definition.slotCost < 0) errors.push(`Option ${definition.id} has an invalid slotCost.`);
      if (!Number.isFinite(definition.pointCost) || definition.pointCost < 0) errors.push(`Option ${definition.id} has an invalid pointCost.`);
      if (!definition.requirements || typeof definition.requirements !== "object" || Array.isArray(definition.requirements)) {
        errors.push(`Option ${definition.id} has invalid requirements.`);
      } else if (!Number.isInteger(definition.requirements.tamerLevel) || definition.requirements.tamerLevel < 0 || definition.requirements.tamerLevel > 20) {
        errors.push(`Option ${definition.id} has an invalid Tamer level requirement.`);
      }
      if (!Array.isArray(definition.prerequisiteIds)) errors.push(`Option ${definition.id} prerequisiteIds must be an array.`);
      if (!Array.isArray(definition.requirements?.companionIdentifiers)) errors.push(`Option ${definition.id} companionIdentifiers must be an array.`);
      if (typeof definition.repeatable !== "boolean") errors.push(`Option ${definition.id} repeatable must be a boolean.`);
      if (definition.maxSelections !== null && (!Number.isInteger(definition.maxSelections) || definition.maxSelections < 1)) errors.push(`Option ${definition.id} has invalid maxSelections.`);
      if (definition.maxSelections !== null && !definition.repeatable && definition.maxSelections > 1) errors.push(`Option ${definition.id} cannot have maxSelections greater than 1 unless repeatable.`);
      if (definition.treeId !== null && (typeof definition.treeId !== "string" || !definition.treeId.trim())) errors.push(`Option ${definition.id} has an invalid treeId.`);
      if (definition.displayOnManager != null && typeof definition.displayOnManager !== "boolean") errors.push(`Option ${definition.id} displayOnManager must be a boolean.`);
      if (definition.displayOnSheet != null && typeof definition.displayOnSheet !== "boolean") errors.push(`Option ${definition.id} displayOnSheet must be a boolean.`);
    }

    for (const definition of validObjects) {
      const id = definition.id ?? "(unknown)";
      for (const prerequisiteId of Array.isArray(definition.prerequisiteIds) ? definition.prerequisiteIds : []) {
        if (!byId.has(prerequisiteId)) errors.push(`Option ${id} references missing prerequisite ${prerequisiteId}.`);
      }
      if (definition.replacesId === definition.id) errors.push(`Option ${id} cannot replace itself.`);
      if (definition.replacesId && !byId.has(definition.replacesId)) errors.push(`Option ${id} references missing replacement target ${definition.replacesId}.`);
    }
    for (const id of findCycles(byId)) errors.push(`Companion option prerequisite cycle includes ${id}.`);
    return { valid: errors.length === 0, errors: [...new Set(errors)] };
  }
});
