import { TamerManager } from "./tamer-manager.js";
import { TamerRecords } from "./data/tamer-records.js";
import { CompanionOptionDefinition } from "./data/companion-option-definition.js";
import { CompanionOptionStore } from "./data/companion-option-store.js";
import { CompanionOptionValidator } from "./data/companion-option-validator.js";
import { CompanionOptions } from "./data/companion-options.js";
import { CompanionSelection } from "./data/companion-selection.js";

const MODULE_ID = "tamer-manager";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "companionOptions", {
    name: "Tamer Manager Companion Options",
    hint: "Internal configuration storage for GM-defined companion Improvements and compatible option definitions.",
    scope: "world",
    config: false,
    type: Object,
    default: {
      schemaVersion: 1,
      definitions: []
    }
  });

  game.modules.get(MODULE_ID).api = {
    TamerManager,
    TamerRecords,
    CompanionOptionDefinition,
    CompanionOptionStore,
    CompanionOptions,
    CompanionSelection
  };
});
