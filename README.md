# Tamer Manager

A clean-room Foundry VTT module for managing Tamer companions.

## Development target

- Foundry VTT v14.368
- D&D 5e v6.0.5
- ApplicationV2 architecture

## Repository separation

This repository is the active development repository. The previous repository, `Tamer-companion-manager`, is historical reference material only and is not a dependency, code source, or release channel for this module.

The module uses its own module ID, API namespace, flag namespace, release manifest, and package name so an installation of the historical module cannot be mistaken for this one.

## Current candidate scope

Version 0.1.17 is a development candidate for the standalone companion manager and its persistence foundation. It includes the manager window, character-sheet header entry point, companion relationship management, initialization/recovery safeguards, and GM-facing option/tree storage contracts. Improvement selection, summoning, vessels, Pocket Family, and Splicer augments are not yet implemented as complete user-facing systems.

Automated CI validates JavaScript syntax, data/access contracts, and package contents. It cannot launch Foundry itself; verify the manager entry point and companion interactions in a live Foundry v14 / D&D 5e v6 world before relying on them in a campaign.
