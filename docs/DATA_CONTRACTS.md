# Tamer Manager Data Contracts

Status: implementation contract for the persistence foundation. These rules are normative for future UI adapters.

## Authoritative data

- **Companion Actor mechanics** (system statistics and initialization ledger) are authoritative on the companion Actor document.
- **Tamer-to-companion relationships** are authoritative in the Tamer Actor's `flags.tamer-manager.companions`. A relationship is a reference to an Actor UUID, not a copy of the Actor.
- **GM-defined option definitions** are authoritative in the world setting `tamer-manager.companionOptions`. Option definitions have stable IDs. A companion's selections reference these IDs; they do not duplicate definitions.
- **Improvement trees** are configuration groupings that reference option IDs. They must not become a second store for the improvement definitions.
- **Source Item UUIDs and companion Actor UUIDs are references, not guaranteed-live objects.** Documents may be deleted, moved, unlinked, or unavailable. A missing reference must be reported and safely skipped; it must not silently erase the saved reference or unrelated data.

## Writes and retries

- Validate a complete candidate state before writing it. Reject malformed records and duplicate relationship IDs/Actor references rather than filtering them out.
- A failed write must be surfaced to the caller. No UI may report success before the persistence operation has completed and its result has been verified where practical.
- Initialization mechanics and their idempotency ledger are written together in a single companion Actor update. Retrying an application ID already present in the ledger must never grant hit dice or HP again.
- Relationship persistence is a separate Actor-document write; Foundry does not provide a cross-Actor transaction. The operation must therefore be recoverable: if mechanics are committed but the Tamer relationship write fails, a retry may reconcile the missing relationship only after verifying the initialization ledger and resulting Actor statistics.
- Do not automatically roll back committed Actor mechanics merely because a second document write failed. Report partial completion and offer safe recovery.
- Removing a relationship only removes the relationship record. It does not reverse mechanics or delete the companion Actor.
- Option/tree edits must validate all references before saving. Deleting a referenced option or tree is blocked unless an explicit, validated migration/reassignment is performed.

## Schema and migration

- Persisted stores carry an integer `schemaVersion`.
- A reader may migrate only versions for which a deterministic migration is implemented and tested.
- Unknown newer versions, malformed top-level values, and malformed individual records must be preserved and surfaced as errors; never rewrite them as an empty store.
- Migration is prepare/validate/write: construct and validate the full candidate in memory, then persist it. A failed validation or write must not intentionally replace the previous stored value.
- Normalization is not validation. Normalization must not be used to hide malformed records by dropping them or converting invalid values into plausible defaults.
- New schema versions require tests for old valid data, malformed data, unknown future versions, and failed writes.

## Concurrency and permissions

- GM configuration writes are restricted to a GM-facing configuration boundary and must still validate in the data layer.
- Before writing, use the latest available persisted state rather than a stale UI snapshot. Where a write can race with another writer, use an explicit conflict/revision strategy or document the single-writer assumption; do not claim transactional guarantees that Foundry settings do not provide.
- Actor UUIDs and option IDs are stable references; names are display data and may change.
- The UI is an adapter. Progression, authorization, validation, persistence, recovery, and migration rules belong in data/domain modules.

## Testable guarantees

1. Repeated initialization with the same application ID cannot apply the same benefit twice.
2. If the initialization update rejects, the caller receives failure and no relationship is reported as saved.
3. If initialization succeeded but relationship persistence failed, a later retry can reconcile the relationship only when the ledger and final mechanics match.
4. Invalid relationship collections and invalid option stores are rejected without destructive normalization.
5. Cyclic prerequisites, dangling references, and invalid costs/requirements are rejected.
6. Unknown schema versions are never rewritten.
7. Tree references are validated against the authoritative option store.
8. A package passing CI is not considered live-Foundry verified until installed and tested in the target Foundry/D&D 5e versions.
