import { TamerManager } from "./tamer-manager.js";
import { TamerDevelopmentPanel } from "./tamer-development-panel.js";
import { TamerConfiguration } from "./tamer-configuration.js";
import { TamerRecords } from "./data/tamer-records.js";
import { CompanionOptionDefinition } from "./data/companion-option-definition.js";
import { CompanionOptionStore } from "./data/companion-option-store.js";
import { CompanionOptionValidator } from "./data/companion-option-validator.js";
import { CompanionTreeStore } from "./data/companion-tree-store.js";
import { CompanionOptions } from "./data/companion-options.js";
import { CompanionSelection } from "./data/companion-selection.js";
import { TamerCompanionSummary } from "./data/tamer-companion-summary.js";
import { CompanionInitialization } from "./data/companion-initialization.js";
import { CompanionInitializationApplication } from "./data/companion-initialization-application.js";
import { CompanionAccessContext } from "./data/companion-access-context.js";
import { CompanionAccessResolver } from "./data/companion-access-resolver.js";
import { CompanionProgression } from "./data/companion-progression.js";
import { TamerProgressionProvider } from "./data/tamer-progression-provider.js";
import { ToughenUpApplication } from "./data/toughen-up-application.js";

const MODULE_ID = "tamer-manager";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "companionOptions", {
    name: "Tamer Manager Companion Options",
    hint: "Internal configuration storage for GM-defined companion Improvements and compatible option definitions.",
    scope: "world",
    config: false,
    type: Object,
    default: { schemaVersion: 1, definitions: [] }
  });

  game.settings.register(MODULE_ID, "companionTrees", {
    name: "Tamer Manager Companion Trees",
    hint: "Internal configuration storage for named companion improvement trees.",
    scope: "world", config: false, type: Object,
    default: { schemaVersion: 1, trees: [] }
  });

  game.settings.registerMenu(MODULE_ID, "developmentPanel", {
    name: "Development & Testing",
    label: "Open Test Panel",
    hint: "Run companion access, progression, and initialization checks from a GM-facing interface.",
    icon: "fa-solid fa-flask",
    type: TamerDevelopmentPanel,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "companionOptionsConfig", {
    name: "Tamer Manager Companion Options",
    label: "Configure Companion Options",
    hint: "Create and manage GM-defined Improvements and compatible companion option definitions.",
    icon: "fa-solid fa-paw",
    type: TamerConfiguration,
    restricted: true
  });

  // Foundry V2 sheets expose their header controls through application-class hooks.
  // Keep this integration thin: the manager itself owns all companion logic and persistence.
  const openManagerFromSheet = app => {
    const actor = app?.document ?? app?.actor ?? app?.object;
    if (!actor || !TamerRecords.isTamer(actor)) return;
    const entry = {
      action: "openTamerCompanionManager",
      label: "Companion Manager",
      icon: "fa-solid fa-paw",
      visible: true,
      onClick: () => TamerManager.openFor(actor)
    };
    const controls = arguments;
  };
  for (const hookName of [
    "getHeaderControlsActorSheet",
    "getHeaderControlsActorSheet5eCharacter",
    "getHeaderControlsActorSheet5eCharacter2",
    "getHeaderControlsActorSheet5eNPC",
    "getHeaderControlsActorSheet5eNPC2"
  ]) {
    Hooks.on(hookName, (app, controls) => {
      const actor = app?.document ?? app?.actor ?? app?.object;
      if (!actor || !TamerRecords.isTamer(actor) || !Array.isArray(controls)) return;
      if (controls.some(control => control.action === "openTamerCompanionManager")) return;
      controls.push({
        action: "openTamerCompanionManager",
        label: "Companion Manager",
        icon: "fa-solid fa-paw",
        visible: true,
        onClick: () => TamerManager.openFor(actor)
      });
    });
  }

  game.modules.get(MODULE_ID).api = {
    TamerManager,
    TamerDevelopmentPanel,
    TamerConfiguration,
    TamerRecords,
    CompanionOptionDefinition,
    CompanionOptionStore,
    CompanionOptionValidator,
    CompanionTreeStore,
    CompanionOptions,
    CompanionSelection,
    TamerCompanionSummary,
    CompanionInitialization,
    CompanionInitializationApplication,
    CompanionAccessContext,
    CompanionAccessResolver,
    CompanionProgression,
    TamerProgressionProvider,
    ToughenUpApplication
  };
});
