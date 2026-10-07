# Tamer Manager Architecture

## Clean-room boundary

This repository is the active implementation of Tamer Manager. The historical repository `Tamer-companion-manager` is reference-only and is never a runtime dependency.

The active module identity is `tamer-manager`. Its Foundry flag namespace, API namespace, manifest, download URL, templates, styles, and global application name are independent of the historical module.

## Verified target

- Foundry VTT v14.368
- D&D 5e v6.0.5
- ApplicationV2 architecture

## Architecture rules

1. The manager is its own ApplicationV2 application.
2. It never replaces or subclasses the D&D 5e actor sheet.
3. Actor documents remain authoritative for companion Actors.
4. Tamer relationship/progression data uses this module's own flag namespace.
5. Actor-sheet augmentation gets its own adapter only after the actual target lifecycle and DOM are independently verified.
6. No global DOM mutation.
7. No monkey-patching of Foundry or dnd5e classes.
8. No interception or cancellation of another application's events.
9. No render-on-render feedback loops.
10. No polling, per-frame work, or unnecessary repeated UUID resolution.
11. CSS remains scoped to this module's application or explicit integration root.
12. Unexpected integration conditions fail closed rather than altering the host application.

## Development stages

1. Standalone manager and persistence foundation.
2. Companion records and relationship state.
3. Companion Options data model and GM configuration.
4. Improvement and Splicer progression engines.
5. Paradigm-specific systems (Infuser, Splicer, Necromancer, Siphoner, etc.).
6. Vessel, summoning, and Pocket Family systems.
7. Manager UI and visual polish.
8. Independently verified actor-sheet adapter.
9. Performance and coexistence testing.
10. Release packaging from the exact tested commit.

A later stage must not destabilize an earlier stable stage.

## Companion Options architecture

The module uses a shared Companion Options infrastructure for configurable companion choices while keeping each game mechanic distinct.

- **Improvements** are the general Tamer companion progression system.
- **Splicer Augments** use the same definition/selection infrastructure but retain Splicer-specific point costs, repeatability, application timing, and release/refund rules.
- **Paradigm features** are not automatically available to every Tamer. A configurable option may require a specific Tamer subclass (paradigm), such as Splicer or Infuser.
- **Tamer-level requirements** and **companion identity requirements** are independently supported.
- Companion records store selections/references, not duplicated rule definitions.
- Source Item UUIDs are optional references; a compendium is never required for the configuration system.
- GM-defined configuration is authoritative.

Subclass requirements are evaluated against the Tamer Actor's actual dnd5e `subclass` Item and its class/subclass identifiers. This prevents a paradigm-specific option from being offered to a Tamer who does not have the required paradigm.
