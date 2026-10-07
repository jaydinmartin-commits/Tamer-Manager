function duplicateIds(definitions) {
  const seen = new Set();
  const duplicates = new Set();

  for (const definition of definitions) {
    if (seen.has(definition.id)) duplicates.add(definition.id);
    seen.add(definition.id);
  }

  return [...duplicates];
}

export const CompanionOptionValidator = Object.freeze({
  validate(definitions = []) {
    const list = Array.isArray(definitions) ? definitions : [];
    const byId = new Map(list.map(definition => [definition.id, definition]));
    const errors = [];

    for (const duplicate of duplicateIds(list)) {
      errors.push(`Duplicate companion option ID: ${duplicate}`);
    }

    for (const definition of list) {
      if (definition.replacesId === definition.id) {
        errors.push(`Option ${definition.id} cannot replace itself.`);
      }

      for (const prerequisiteId of definition.prerequisiteIds) {
        if (!byId.has(prerequisiteId)) {
          errors.push(
            `Option ${definition.id} references missing prerequisite ${prerequisiteId}.`
          );
        }
      }

      if (definition.replacesId && !byId.has(definition.replacesId)) {
        errors.push(
          `Option ${definition.id} references missing replacement target ${definition.replacesId}.`
        );
      }

      if (definition.maxSelections !== null && !definition.repeatable && definition.maxSelections > 1) {
        errors.push(
          `Option ${definition.id} cannot have maxSelections greater than 1 unless it is repeatable.`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
});
