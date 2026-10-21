# Tamer Manager

A standalone Foundry VTT module for managing Tamer companions.

## Compatibility target

- Foundry VTT v14 (developed against v14.368)
- D&D 5e system v6.0 (developed against v6.0.5)
- ApplicationV2 sheets and applications

## Install

Use the module manifest:

`https://raw.githubusercontent.com/jaydinmartin-commits/Tamer-Manager/main/module.json`

Install from a published release for normal use. Do not install a pull-request branch as a campaign module.

## Current project status

This repository is the active development and release repository. The former `Tamer-companion-manager` repository is historical reference material only and is not a dependency, code source, or release channel for this module.

Implemented areas include the standalone Companion Manager, character-sheet header entry point, the Companion sheet tab, companion relationship persistence and recovery, GM-managed option/tree configuration, companion eligibility/progression checks, sheet improvement synchronization, and the Toughen Up configuration workflow.

Improvement advancement handling is under active correction. In particular, removing a managed improvement that granted a native D&D 5e advancement must reverse that advancement's applied effects—not merely delete the source Item. The current candidate for that fix is tracked in [PR #31](https://github.com/jaydinmartin-commits/Tamer-Manager/pull/31); it is not part of the published v0.1.45 release.

The Companion tab layout correction was merged in PR #30 and is included in the published v0.1.46 release. Live Foundry sheet alignment still needs verification.

## Validation

GitHub Actions checks JavaScript syntax, module/package contents, and automated data/access contracts. These tests do not launch Foundry or prove live UI positioning, dnd5e advancement reversal, or campaign-world behavior. Test those in Foundry v14 with D&D 5e v6 before relying on a candidate in a campaign.

## Development documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Data contracts](docs/DATA_CONTRACTS.md)
