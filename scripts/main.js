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
  Hooks.on("getHeaderControlsApplicationV2", addCompanionManagerHeaderControl);

  // D&D 5e v6 may finish exposing its sheet class after the module init hook.
  // Register once the system is ready, rather than permanently skipping the tab
  // when the class is not yet available during init.
  Hooks.once("ready", () => {
  const CharacterActorSheet = game.dnd5e?.applications?.actor?.CharacterActorSheet ?? globalThis.dnd5e?.applications?.actor?.CharacterActorSheet;
  if (CharacterActorSheet && !CharacterActorSheet.__tamerManagerTabRegistered) {
    CharacterActorSheet.__tamerManagerTabRegistered = true;
    CharacterActorSheet.PARTS = {
      ...CharacterActorSheet.PARTS,
      companions: {
        container: { classes: ["tab-body"], id: "companions" },
        template: "modules/tamer-manager/templates/tamer-manager.hbs",
        scrollable: [""]
      }
    };
    const companionTab = {
      tab: "companions",
      label: "Companions",
      icon: "fa-solid fa-paw",
      condition: actor => TamerRecords.isTamer(actor)
    };
    const existingTabs = CharacterActorSheet.TABS;
    if (Array.isArray(existingTabs)) {
      // Legacy list-shaped tab configuration.
      CharacterActorSheet.TABS = existingTabs.some(tab => tab?.tab === "companions")
        ? existingTabs : [...existingTabs, companionTab];
    } else if (existingTabs && typeof existingTabs === "object") {
      // ApplicationV2 system sheets may expose grouped tab configuration.
      const groupedKey = Object.keys(existingTabs).find(key => Array.isArray(existingTabs[key]?.tabs));
      if (!groupedKey) {
        console.error("Tamer Manager | Unsupported CharacterActorSheet.TABS shape; preserving native tabs.", existingTabs);
        delete CharacterActorSheet.__tamerManagerTabRegistered;
        return;
      }
      const group = existingTabs[groupedKey];
      CharacterActorSheet.TABS = {
        ...existingTabs,
        [groupedKey]: {
          ...group,
          tabs: group.tabs.some(tab => tab?.tab === "companions" || tab?.id === "companions")
            ? group.tabs : [...group.tabs, companionTab]
        }
      };
    } else {
      console.error("Tamer Manager | CharacterActorSheet.TABS is unavailable; preserving native tabs.");
      delete CharacterActorSheet.__tamerManagerTabRegistered;
      return;
    }

    const originalPreparePartContext = CharacterActorSheet.prototype._preparePartContext;
    CharacterActorSheet.prototype._preparePartContext = async function(partId, context, options) {
      if (partId === "companions") {
        const managerContext = await TamerManager.prototype._prepareContext.call({ tamer: this.actor });
        return { ...context, ...managerContext, inSheetTab: true };
      }
      return originalPreparePartContext.call(this, partId, context, options);
    };

    const forwardManagerAction = handler => function(event, target) {
      // Sheet actions can be invoked with a delegated target or the event's
      // current target depending on the ApplicationV2 action dispatcher.
      const actionTarget = target?.dataset
        ? target
        : event?.currentTarget?.dataset
          ? event.currentTarget
          : event?.target?.closest?.("[data-action]") ?? target;
      const actor = this.actor ?? this.document ?? this.object;
      if (!actor) {
        console.error("Tamer Manager | Sheet action had no owning Actor.", { action: actionTarget?.dataset?.action, sheet: this });
        ui.notifications.error("Tamer Manager could not identify the character for this action. Reopen the character sheet and try again.");
        return;
      }
      const context = { tamer: actor, render: this.render.bind(this) };
      return handler.call(context, event, actionTarget);
    };
    const sheetOptions = CharacterActorSheet.DEFAULT_OPTIONS ?? {};
    const managerActions = {
      tamerRefresh: TamerManager._onRefresh,
      tamerAddCompanion: TamerManager._onAddCompanion,
      tamerRemoveCompanion: TamerManager._onRemoveCompanion,
      tamerOpenCompanion: TamerManager._onOpenCompanion,
      tamerToggleSummon: TamerManager._onToggleSummon,
      tamerAssignVessel: TamerManager._onAssignVessel,
      tamerClearVessel: TamerManager._onClearVessel,
      tamerManageImprovements: TamerManager._onManageImprovements
    };
    CharacterActorSheet.DEFAULT_OPTIONS = {
      ...sheetOptions,
      actions: {
        ...(sheetOptions.actions ?? {}),
        ...Object.fromEntries(Object.entries(managerActions).map(([name, handler]) => [name, forwardManagerAction(handler)]))
      }
    };

    // The system action dispatcher can miss actions on dynamically added parts.
    // A delegated fallback keeps the Companion tab buttons functional.
    const originalOnRender = CharacterActorSheet.prototype._onRender;
    if (typeof originalOnRender === "function" && !CharacterActorSheet.prototype.__tamerManagerRenderActionsPatched) {
      CharacterActorSheet.prototype.__tamerManagerRenderActionsPatched = true;
      CharacterActorSheet.prototype._onRender = async function(context, options) {
        await originalOnRender.call(this, context, options);
        const sheet = this;
        const root = sheet.element;
        if (!root?.addEventListener || root.dataset?.tamerManagerActionsBound) return;
        if (root.dataset) root.dataset.tamerManagerActionsBound = "true";
        root.addEventListener("click", event => {
          const target = event.target?.closest?.('button[data-action^="tamer"]');
          if (!target || !root.contains(target)) return;
          const handler = managerActions[target.dataset.action];
          if (typeof handler !== "function") return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const actor = sheet.actor ?? sheet.document ?? sheet.object;
          if (!actor) {
            ui.notifications.error("Tamer Manager could not identify the character for this action.");
            return;
          }
          const actionContext = { tamer: actor, render: sheet.render.bind(sheet) };
          Promise.resolve(handler.call(actionContext, event, target)).catch(error => {
            console.error("Tamer Manager | Companion-tab action failed.", error);
            ui.notifications.error("That Companion Manager action failed. Check the console for details.");
          });
        }, true);
      };
    }
  } else if (!CharacterActorSheet) {
    console.error("Tamer Manager | D&D 5e CharacterActorSheet was unavailable at ready; the standalone Companion Manager remains available.");
  }
  });

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
