const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const MODULE_ID = "tamer-manager";
const SETTING_KEY = "companionCompendiums";

export class TamerCompendiumConfiguration extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tamer-manager-compendium-configuration",
    classes: ["tamer-manager", "tamer-manager-config"],
    window: { title: "Companion Source Compendiums", resizable: true },
    position: { width: 760, height: 680 },
    actions: { save: TamerCompendiumConfiguration._onSave, refresh: TamerCompendiumConfiguration._onRefresh }
  };

  static PARTS = {
    main: { template: "modules/tamer-manager/templates/tamer-compendium-configuration.hbs", root: true }
  };

  _canRender() {
    return Boolean(game.user?.isGM) && super._canRender();
  }

  async _prepareContext() {
    const selected = new Set(game.settings.get(MODULE_ID, SETTING_KEY) ?? []);
    const browserSources = game.settings.get("dnd5e", "packSourceConfiguration") ?? {};
    const packs = Array.from(game.packs ?? [])
      .filter(pack => (pack.documentName === "Actor" || pack.metadata?.type === "Actor") &&
        browserSources[pack.collection] !== false)
      .sort((a, b) => String(a.metadata?.label ?? a.collection).localeCompare(String(b.metadata?.label ?? b.collection)))
      .map(pack => ({
        collection: pack.collection,
        label: pack.metadata?.label ?? pack.title ?? pack.collection,
        packageName: pack.metadata?.packageName ?? "",
        selected: selected.has(pack.collection),
        visible: Boolean(pack.visible)
      }));
    return { packs, hasPacks: packs.length > 0, selectedCount: packs.filter(pack => pack.selected).length };
  }

  static async _onRefresh() { await this.render({ force: true }); }

  static async _onSave(event, target) {
    const form = target?.closest("form");
    if (!form) return;
    const selected = Array.from(form.querySelectorAll('input[name="compendium"]:checked'))
      .map(input => String(input.value))
      .filter(collection => game.packs?.get(collection)?.documentName === "Actor" || game.packs?.get(collection)?.metadata?.type === "Actor");
    try {
      await game.settings.set(MODULE_ID, SETTING_KEY, [...new Set(selected)]);
      ui.notifications.info("Companion source compendiums saved.");
      await this.render({ force: true });
    } catch (error) {
      console.error("Tamer Manager | Failed to save companion source compendiums.", error);
      ui.notifications.error("Could not save companion source compendiums.");
    }
  }
}

globalThis.TamerCompendiumConfiguration = TamerCompendiumConfiguration;
