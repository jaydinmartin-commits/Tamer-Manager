import { TamerManager } from "./tamer-manager.js";
import { TamerDevelopmentPanel } from "./tamer-development-panel.js";
import { TamerConfiguration } from "./tamer-configuration.js";
import { TamerTreeConfiguration } from "./tamer-tree-configuration.js";
import { TamerCompendiumConfiguration } from "./tamer-compendium-configuration.js";
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

  game.settings.register(MODULE_ID, "companionCompendiums", {
    name: "Tamer Manager Companion Compendiums",
    hint: "Compendium collections allowed in the native Add Companion picker.",
    scope: "world", config: false, type: Array, default: []
  });

  game.settings.registerMenu(MODULE_ID, "companionCompendiumsConfig", {
    name: "Companion Source Compendiums",
    label: "Configure Compendiums",
    hint: "Choose which Actor compendiums are available when adding a companion.",
    icon: "fa-solid fa-books",
    type: TamerCompendiumConfiguration,
    restricted: true
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

  game.settings.registerMenu(MODULE_ID, "companionTreesConfig", {
    name: "Bespoke Companion Trees",
    label: "Manage Companion Trees",
    hint: "Create and manage named improvement trees for bespoke companions.",
    icon: "fa-solid fa-sitemap",
    type: TamerTreeConfiguration,
    restricted: true
  });

  // Foundry v14 dispatches ApplicationV2 header controls through class-specific hooks.
  // D&D 5e v6's CharacterActorSheet extends BaseActorSheet, which in turn extends
  // foundry.applications.sheets.ActorSheetV2. Register the concrete system class hook
  // and the core base hook for compatibility with sheets using the base class directly.
  const addCompanionManagerHeaderControl = (app, controls) => {
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
  };
  Hooks.on("getHeaderControlsCharacterActorSheet", addCompanionManagerHeaderControl);
  Hooks.on("getHeaderControlsActorSheetV2", addCompanionManagerHeaderControl);

  // Extend the actual D&D 5e v6 CharacterActorSheet rather than inserting a
  // detached window into the sheet. The standalone manager/header control remains
  // available as a fallback.
  const CharacterActorSheet = game.dnd5e?.applications?.actor?.CharacterActorSheet;
  if (CharacterActorSheet && !CharacterActorSheet.__tamerManagerTabRegistered) {
    CharacterActorSheet.__tamerManagerTabRegistered = true;
    CharacterActorSheet.PARTS = {
      ...CharacterActorSheet.PARTS,
      companions: {
        container: { classes: ["tab-body", "tamer-manager"], id: "tabs" },
        template: "modules/tamer-manager/templates/tamer-manager.hbs",
        scrollable: [""]
      }
    };
    CharacterActorSheet.TABS = [
      ...CharacterActorSheet.TABS,
      {
        tab: "companions",
        label: "Companions",
        icon: "fa-solid fa-paw",
        condition: actor => TamerRecords.isTamer(actor)
      }
    ];

    const originalPreparePartContext = CharacterActorSheet.prototype._preparePartContext;
    CharacterActorSheet.prototype._preparePartContext = async function(partId, context, options) {
      if (partId === "companions") {
        const managerContext = await TamerManager.prototype._prepareContext.call({ tamer: this.actor });
        return { ...context, ...managerContext };
      }
      return originalPreparePartContext.call(this, partId, context, options);
    };

    const forwardManagerAction = handler => function(event, target) {
      const context = { tamer: this.actor, render: this.render.bind(this) };
      return handler.call(context, event, target);
    };
    const sheetOptions = CharacterActorSheet.DEFAULT_OPTIONS ?? {};
    const managerActions = {
      refresh: TamerManager._onRefresh,
      addCompanion: TamerManager._onAddCompanion,
      removeCompanion: TamerManager._onRemoveCompanion,
      openCompanion: TamerManager._onOpenCompanion,
      toggleSummon: TamerManager._onToggleSummon,
      assignVessel: TamerManager._onAssignVessel,
      clearVessel: TamerManager._onClearVessel,
      manageImprovements: TamerManager._onManageImprovements
    };
    CharacterActorSheet.DEFAULT_OPTIONS = {
      ...sheetOptions,
      actions: {
        ...(sheetOptions.actions ?? {}),
        ...Object.fromEntries(Object.entries(managerActions).map(([name, handler]) => [name, forwardManagerAction(handler)]))
      }
    };
  } else if (!CharacterActorSheet) {
    console.warn("Tamer Manager | D&D 5e CharacterActorSheet was unavailable during init; the standalone Companion Manager remains available.");
  }

  game.modules.get(MODULE_ID).api = {
    TamerManager,
    TamerDevelopmentPanel,
    TamerConfiguration,
    TamerTreeConfiguration,
    TamerCompendiumConfiguration,
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
