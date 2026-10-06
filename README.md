# Tamer Manager

A clean-room Foundry VTT module for managing Tamer companions.

## Development target

- Foundry VTT v14.368
- D&D 5e v6.0.5
- ApplicationV2 architecture

## Repository separation

This repository is the active development repository. The previous repository, `Tamer-companion-manager`, is historical reference material only and is not a dependency, code source, or release channel for this module.

The module uses its own module ID, API namespace, flag namespace, release manifest, and package name so an installation of the historical module cannot be mistaken for this one.

## Current development stage

The current build establishes the isolated manager/data foundation first. Actor-sheet integration, improvement selection, summoning, vessels, Pocket Family, Splicer augments, and other higher-level systems will be added only after the foundation is tested.
