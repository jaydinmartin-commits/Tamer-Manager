import { TamerManager } from "./tamer-manager.js";
import { TamerRecords } from "./data/tamer-records.js";
import { CompanionOptionDefinition } from "./data/companion-option-definition.js";
import { CompanionOptions } from "./data/companion-options.js";
import { CompanionSelection } from "./data/companion-selection.js";

const MODULE_ID = "tamer-manager";

Hooks.once("init", () => {
  game.modules.get(MODULE_ID).api = {
    TamerManager,
    TamerRecords,
    CompanionOptionDefinition,
    CompanionOptions,
    CompanionSelection
  };
});
