const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { CompanionOptionDefinition } from "./data/companion-option-definition.js";
import { CompanionOptionStore } from "./data/companion-option-store.js";

export class TamerConfiguration extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tamer-manager-configuration",
    classes: ["tamer-manager", "tamer-manager-config"],
    window: { title: "Tamer Manager Configuration", resizable: true },
    position: { width: 1050, height: 700 },
    actions: {
      newOption: TamerConfiguration._onNewOption,
      editOption: TamerConfiguration._onEditOption,
      saveOption: TamerConfiguration._onSaveOption,
      deleteOption: TamerConfiguration._onDeleteOption,
      cancelEdit: TamerConfiguration._onCancelEdit,
      refresh: TamerConfiguration._onRefresh
    }
  };

  static PARTS = {
    main: {
      template: "modules/tamer-manager/templates/tamer-configuration.hbs",
      root: true
    }
  };

  constructor(options = {}) {
    super(options);
    this.editingId = null;
  }

  _canRender() {
    if (!game.user?.isGM) return false;
    return super._canRender();
  }

  async _prepareContext() {
    const definitions = CompanionOptionStore.list();
    const definition = this.editingId
      ? CompanionOptionStore.get(this.editingId)
      : null;

    return {
      definitions,
      editingId: this.editingId,
      draft: definition ? this._draftFromDefinition(definition) : this._defaultDraft(),
      hasDefinitions: definitions.length > 0
    };
  }

  _defaultDraft() {
    return {
      id: "",
      type: "improvement",
      name: "",
      sourceUuid: "",
      tamerLevel: 0,
      companionIdentifiers: "",
      repeatable: false,
      maxSelections: "",
      slotCost: 1,
      pointCost: 0,
      prerequisiteIds: "",
      replacesId: "",
      treeId: ""
    };
  }

  _draftFromDefinition(definition) {
    return {
      id: definition.id,
      type: definition.type,
      name: definition.name,
      sourceUuid: definition.sourceUuid ?? "",
      tamerLevel: definition.requirements?.tamerLevel ?? 0,
      companionIdentifiers: (definition.requirements?.companionIdentifiers ?? []).join(", "),
      repeatable: definition.repeatable,
      maxSelections: definition.maxSelections ?? "",
      slotCost: definition.slotCost,
      pointCost: definition.pointCost,
      prerequisiteIds: (definition.prerequisiteIds ?? []).join(", "),
      replacesId: definition.replacesId ?? "",
      treeId: definition.treeId ?? ""
    };
  }

  static async _onNewOption() {
    this.editingId = null;
    await this.render({ force: true });
  }

  static async _onEditOption(event, target) {
    const id = target?.dataset?.optionId;
    if (!id) return;

    if (!CompanionOptionStore.get(id)) {
      ui.notifications.warn("That companion option no longer exists.");
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

  static async _onSaveOption(event, target) {
    const form = target?.closest("form");
    if (!form) return;

    try {
      const data = new FormData(form);
      const id = String(data.get("id") ?? "").trim();
      const name = String(data.get("name") ?? "").trim();

      if (!id || !name) {
        ui.notifications.warn("An option ID and name are required.");
        return;
      }

      if (this.editingId && id !== this.editingId) {
        ui.notifications.error("An existing option's ID cannot be changed.");
        return;
      }

      const repeatable = data.get("repeatable") === "on";
      const list = value => String(value ?? "").split(",").map(v => v.trim()).filter(Boolean);

      const definition = CompanionOptionDefinition.create({
        id,
        type: String(data.get("type") ?? "improvement"),
        name,
        sourceUuid: String(data.get("sourceUuid") ?? "").trim() || null,
        requirements: {
          tamerLevel: Number(data.get("tamerLevel") ?? 0) || 0,
          companionIdentifiers: list(data.get("companionIdentifiers"))
        },
        repeatable,
        maxSelections: repeatable && data.get("maxSelections")
          ? Number(data.get("maxSelections"))
          : null,
        slotCost: Number(data.get("slotCost") ?? 0) || 0,
        pointCost: Number(data.get("pointCost") ?? 0) || 0,
        prerequisiteIds: list(data.get("prerequisiteIds")),
        replacesId: String(data.get("replacesId") ?? "").trim() || null,
        treeId: String(data.get("treeId") ?? "").trim() || null
      });

      await CompanionOptionStore.upsert(definition);
      this.editingId = definition.id;
      ui.notifications.info("Companion option saved.");
      await this.render({ force: true });
    } catch (error) {
      console.error("Tamer Manager | Failed to save companion option.", error);
      ui.notifications.error(error.message || "The companion option could not be saved.");
    }
  }

  static async _onDeleteOption(event, target) {
    const id = target?.dataset?.optionId;
    if (!id) return;

    const definition = CompanionOptionStore.get(id);
    if (!definition || !window.confirm(`Delete "${definition.name}"?`)) return;

    try {
      await CompanionOptionStore.remove(id);
      this.editingId = null;
      ui.notifications.info("Companion option deleted.");
      await this.render({ force: true });
    } catch (error) {
      ui.notifications.error(error.message || "The companion option could not be deleted.");
    }
  }
}

globalThis.TamerConfiguration = TamerConfiguration;
