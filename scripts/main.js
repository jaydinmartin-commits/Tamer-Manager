import { TamerManager } from "./tamer-manager.js";
import { TamerRecords } from "./data/tamer-records.js";

const MODULE_ID = "tamer-manager";

Hooks.once("init", () => {
  game.modules.get(MODULE_ID).api = {
    TamerManager,
    TamerRecords
  };
});
