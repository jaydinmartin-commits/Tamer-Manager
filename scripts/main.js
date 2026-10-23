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

  // Add the launcher to the character header during ApplicationV2 renders.
  // dnd5e 6's rest buttons are conditional on showRests, so the launcher must
  // also have a header fallback instead of silently disappearing with the rest container.
  const addTamerManagerSheetButton = (app, html) => {
    const actor = app?.actor ?? app?.document ?? app?.object;
    if (!actor || !TamerRecords.isTamer(actor)) return;

    const root = app.element?.[0] ?? app.element ?? html?.[0] ?? html;
    if (!root?.querySelector) return;
    if (root.querySelector('[data-action="openTamerManagerSheetButton"]')) return;

    const header = root.querySelector(".sheet-header");
    if (!header) return;

    let restContainer = header.querySelector(".sheet-header-buttons");
    if (!restContainer) {
      // Keep the same native location even when a sheet theme hides the rest controls.
      restContainer = document.createElement("div");
      restContainer.className = "sheet-header-buttons";
      const right = header.querySelector(".right");
      if (right) right.prepend(restContainer);
      else header.append(restContainer);
    }

    // Prefer an actual rest button for exact native styling; otherwise use the
    // same class names found in dnd5e 6's character-header.hbs.
    const restButton = restContainer.querySelector('button[data-action="rest"]')
      ?? root.querySelector(".sheet-header-buttons button");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = "openTamerManagerSheetButton";
    button.className = restButton?.className || "shortRest-rest gold-button";
    button.title = "Open Tamer Manager";
    button.setAttribute("aria-label", "Open Tamer Manager");
    button.setAttribute("data-tooltip", "Open Tamer Manager");
    button.innerHTML = '<i class="fa-solid fa-paw" aria-hidden="true"></i>';
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      TamerManager.openFor(actor);
    });

    const anchor = restButton ?? restContainer.lastElementChild;
    if (anchor) anchor.insertAdjacentElement("afterend", button);
    else restContainer.append(button);
  };

  Hooks.on("renderApplicationV2", addTamerManagerSheetButton);
  Hooks.on("renderActorSheetV2", addTamerManagerSheetButton);
  Hooks.on("renderCharacterActorSheet", addTamerManagerSheetButton);

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
