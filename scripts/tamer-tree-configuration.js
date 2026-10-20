const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { CompanionTreeStore } from "./data/companion-tree-store.js";

export class TamerTreeConfiguration extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tamer-manager-tree-configuration",
    classes: ["tamer-manager", "tamer-manager-config", "tamer-manager-tree-config"],
    window: { title: "Bespoke Companion Trees", resizable: true },
    position: { width: 900, height: 620 },
    actions: {
      newTree: TamerTreeConfiguration._onNewTree,
      editTree: TamerTreeConfiguration._onEditTree,
      saveTree: TamerTreeConfiguration._onSaveTree,
      deleteTree: TamerTreeConfiguration._onDeleteTree,
      cancelEdit: TamerTreeConfiguration._onCancelEdit,
      refresh: TamerTreeConfiguration._onRefresh
    }
  };

  static PARTS = {
    main: { template: "modules/tamer-manager/templates/tamer-tree-configuration.hbs", root: true }
  };

  constructor(options = {}) {
    super(options);
    this.editingId = null;
  }

  _canRender() {
    return Boolean(game.user?.isGM) && super._canRender();
  }

  async _prepareContext() {
    const trees = CompanionTreeStore.list();
    const tree = this.editingId ? CompanionTreeStore.get(this.editingId) : null;
    return {
      trees,
      hasTrees: trees.length > 0,
      editingId: this.editingId,
      draft: tree ? { ...tree, companionIdentifier: tree.companionIdentifier ?? "" } : { id: "", name: "", description: "", companionIdentifier: "" }
    };
  }

  static async _onNewTree() {
    this.editingId = null;
    await this.render({ force: true });
  }

  static async _onEditTree(event, target) {
    const id = target?.dataset?.treeId;
    if (!id || !CompanionTreeStore.get(id)) {
      ui.notifications.warn("That companion tree no longer exists.");
      await this.render({ force: true });
      return;
    }
    this.editingId = id;
    await this.render({ force: true });
  }

  static async _onCancelEdit() {
    this.editingId = null;
    await this.render({ force: true });
  }

  static async _onRefresh() {
    await this.render({ force: true });
  }

  static async _onSaveTree(event, target) {
    const form = target?.closest("form");
    if (!form) return;
    try {
      const data = new FormData(form);
      const id = String(data.get("id") ?? "").trim();
      const name = String(data.get("name") ?? "").trim();
      const description = String(data.get("description") ?? "").trim();
      const companionIdentifier = String(data.get("companionIdentifier") ?? "").trim();
      if (!id || !name) {
        ui.notifications.warn("A tree ID and name are required.");
        return;
      }
      if (this.editingId && id !== this.editingId) {
        ui.notifications.error("An existing tree ID cannot be changed.");
        return;
      }
      await CompanionTreeStore.upsert({ id, name, description, companionIdentifier });
      this.editingId = id;
      ui.notifications.info("Bespoke companion tree saved.");
      await this.render({ force: true });
    } catch (error) {
      console.error("Tamer Manager | Failed to save companion tree.", error);
      ui.notifications.error(error.message || "The companion tree could not be saved.");
    }
  }

  static async _onDeleteTree(event, target) {
    const id = target?.dataset?.treeId;
    if (!id) return;
    const tree = CompanionTreeStore.get(id);
    if (!tree) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Companion Tree" },
      content: `Delete "${foundry.utils.escapeHTML(tree.name)}"?`,
      rejectClose: false,
      modal: true
    });
    if (!confirmed) return;
    try {
      await CompanionTreeStore.remove(id);
      this.editingId = null;
      ui.notifications.info("Companion tree deleted.");
      await this.render({ force: true });
    } catch (error) {
      console.error("Tamer Manager | Failed to delete companion tree.", error);
      ui.notifications.error(error.message || "The companion tree could not be deleted.");
    }
  }
}

globalThis.TamerTreeConfiguration = TamerTreeConfiguration;
