# Architecture Contracts

**Status:** planning contract, not a claim that all listed features are implemented.  
**Target:** Foundry VTT v14 / D&D 5e v6.  
**Scope:** this isolated `tamer-manager` repository only.

## Non-negotiable boundaries

- Keep this repository independent from the historical `Tamer-companion-manager` project and its IDs, flags, settings, code, and releases.
- Foundry Actor/Item documents and persistent flags are authoritative; UI state is not a second source of truth.
- Extend the native dnd5e sheet through narrow, idempotent integration. Never replace the sheet or broadly mutate its DOM.
- Fail closed on unsupported actors, missing source documents, ambiguous rules, or invalid settings. Never silently guess eligibility.
- Keep runtime work incremental and low-cost: avoid render loops, polling, broad MutationObservers, event hijacking, and repeated UUID resolution.
- Preserve the current manager-card layout unless the future appearance settings deliberately change it. Put companion choices on the companion sheet when requested.
- Keep this module's design and content isolated from other homebrew projects unless the user explicitly requests crossover.

## Current implementation audit

This is a source review of the current default branch, not a claim that every scenario has been exercised in Foundry.

- `TamerRecords.isTamer` currently gates both reads and writes on the presence of a Tamer class Item. That is safe for the current narrow feature set, but it cannot yet represent feat/item-granted management access.
- `TamerManager` currently selects a Tamer Actor and adds Actors from the world collection. GM-configured compendium sources and drag/drop bonding are not implemented in the inspected code.
- `CompanionOptions.isAvailable` currently requires a Tamer context and may resolve a companion UUID synchronously when checking identifiers. A future shared resolver should pass resolved document/context data through a single evaluation rather than repeatedly resolving the same UUID in option checks.
- `CompanionInitialization.plan` currently requires a Tamer and derives training from Tamer progression. Bespoke and feature-granted companions need explicit progression providers rather than treating the existing Tamer plan as universal.
- `CompanionOptionDefinition` currently supports only `improvement` and `augment`. Its current fields provide a starting point for costs, repeatability, prerequisites, replacements, and tree IDs, but do not yet encode the complete set of access-source, progression-provider, universal-option, infusion, compendium-source, or appearance settings.
- `CompanionRecord` normalizes current companion state including improvements, vessel references, and Splicer augment data. It does not yet define a versioned access-source/owner model for non-Tamer entry points.

**Implication:** do not simply remove the Tamer check or expand the option type enum and immediately wire new features into it. First define read-only access/progression contracts and migration rules; then integrate each entry point behind its own validated adapter.

## Separate access from companion identity

A companion must not be assumed to belong to a Tamer. The current Tamer-only record gate is an initial limitation, not the final authorization model.

Planned manager entry points include:
- Tamer class and its normal progression.
- Tamer Adept feat and its class-responsive benefits.
- Spirit Bonded feat (Ryoko's feat), with its own eligibility and bond rules.
- An attuned bespoke orb and its bespoke-companion rules.
- Future compatible features through a shared access contract.

Each access source should resolve into an explicit context: owner actor, granting source document, allowed operations, progression provider(s), and capacity/slot restrictions. Revalidate permissions and eligibility when committing an operation; a stale UI must not authorize changes. Multiclass characters may qualify through multiple independent sources. Do not assume every companion uses Tamer levels or Tamer improvement counts.

Keep **access**, **eligibility**, **progression**, **selection state**, and **application of effects** separate. A feature that expands eligible options must not automatically grant additional selections. Planned bespoke companion progression tiers are levels **1, 3, 5, 9, 13, and 17**, with class-responsive Bond/Inheritance/Attunement options; exact mechanics require their own design approval.

## GM configuration means content authoring

The GM-facing system is more than a toggle. It should let GMs author rules/content without code edits for every new tree or augment.

Planned configuration areas:
1. **Improvement trees:** create/edit trees, organize choices, prerequisites, replacement rules, and eligible progression/access sources.
2. **Universal improvements:** options available across eligible companion types and access sources, with explicit requirements.
3. **Splicer augments:** definitions, costs, eligibility, repeatability, and optional selection caps.
4. **Infuser options:** define elemental infusion options; select infusions on a rest per companion, according to the feature's rules.
5. **Compendium sources:** choose which compendiums/folders the Add Companion workflow searches; do not treat every Actor as eligible by default.
6. **Appearance:** manager-card colors and fonts, with validated safe defaults and no arbitrary script/CSS injection.
7. **Feature adapters:** extend the configuration model for future access sources without duplicating core manager code.

Settings must be versioned and validated before saving. Invalid/missing settings should fall back safely, not prevent the manager from loading. Reference source Items by UUID when appropriate and handle deleted/unavailable sources explicitly.

The existing `CompanionOptionDefinition` and `CompanionOptionStore` are a starting point, not a mandate to force every feature into the current two-type enum. Evolve the schema deliberately and migrate existing settings safely.

## Records and source documents

- Keep stable record IDs and persistent Actor UUID references; never store whole Actor documents in flags.
- Version record schemas and migrate before changing persistent shapes.
- Store lightweight improvement references/IDs while treating the corresponding Item/source document as authoritative for mechanics and descriptions. Missing sources must not crash the manager or invent substitute content.
- Keep vessel, token, summon state, bond, and feature-specific state distinct when lifecycles differ.
- Do not broaden storage ownership by simply weakening `TamerRecords.isTamer`. Introduce an owner/access adapter and migrate safely.

## Bonding and Add Companion

- Support drag-and-drop of a valid Actor into the manager for bonding/registration.
- Validate document type, identity/duplicates, user permissions, access-source rules, and capacity before persistence. Invalid or cancelled operations make no changes.
- Add Companion must use GM-configured compendium sources and validate a candidate before adding it.
- Feature-granted managers must not expose Tamer-only operations.
- Keep new behavior in the correct manager or companion-sheet surface without casually changing the stable card layout.

## Staged implementation order

1. Review existing records, settings, option definitions, exported APIs, and release behavior; specify migrations and extension points.
2. Add shared read-only access/progression resolvers and validators first, preserving current Tamer behavior.
3. Evolve the versioned GM configuration model and authoring APIs for trees/options, universal improvements, augments, sources, and appearance; implement configuration UI in small validated sections.
4. Implement configured compendium selection and drag/drop bonding with permission, duplicate, capacity, and document validation.
5. Add independently tested adapters for Tamer, Tamer Adept, Spirit Bonded, and attuned bespoke orbs. Detection of a feature must not grant rules that have not been implemented.
6. Add choices to the companion character sheet where requested, preserving native dnd5e behavior.
7. Implement higher-level systems in isolated stages: Infuser rest choices per companion; Splicer costs/repeatability; summoning, vessels, Pocket Family, and other planned workflows.
8. Review diffs, migration behavior, positive/negative eligibility cases, and performance-sensitive hooks before a versioned release.

A GM configuration screen may arrive in phases, but its data model, validation, access contracts, and extension points must be planned now.

## Regression checklist

- Existing Tamer records and saved option settings survive upgrades.
- A character without a qualifying source cannot use Tamer-only management.
- Each feat/item entry point is tested independently and does not inherit unrelated permissions.
- Multiclass/multiple-source access does not duplicate progression benefits.
- Invalid, missing, duplicate, deleted, or inaccessible documents fail safely.
- Prerequisites, level gates, replacement rules, repeatability, costs, and caps are checked at commit time, not just in the UI.
- Cancelled or failed drag/drop leaves persistent data unchanged.
- Add Companion respects GM-selected compendium sources.
- Appearance settings reject executable content and recover safely from malformed data.
- Native dnd5e sheet behavior and the manager-card layout remain intact.
- No polling/render loop or broad DOM watcher is introduced; hot paths avoid repeated document resolution.
