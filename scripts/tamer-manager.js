const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { TamerRecords } from "./data/tamer-records.js";

const MODULE_ID = "tamer-manager";
const ADD_REASONS = {
  "missing-tamer-or-companion": "A Tamer and companion Actor are required.",
  "missing-companion-uuid": "The selected Actor cannot be referenced as a companion.",
  "already-registered": "That Actor is already registered as a companion.",
  "unsupported-companion-actor-type": "Only NPC Actors can be initialized as companions.",
  "unsupported-hit-die-data": "The companion hit-die data is not in a supported format.",
  "unsupported-hit-point-data": "The companion hit-point data is not in a supported format.",
  "missing-constitution-modifier": "The companion has no valid Constitution modifier.",
  "unsupported-or-inconsistent-hp-formula": "The companion HP formula is not safely compatible with automatic hit-die scaling.",
  "already-applied": "This companion has already received its initialization benefits.",
  "initialization-application-failed": "The companion initialization could not be applied and verified.",
  "post-update-verification-failed": "The initialization update could not be verified; check the companion before retrying.",
  "companion-record-persistence-failed": "Initialization was applied, but the companion record could not be saved. Check the manager before retrying.",
  "missing-owner-or-companion": "A Tamer and companion Actor are required.",
  "invalid-access-context": "Companion management access could not be validated.",
  "missing-companion-management-access": "This character does not have permission to manage companions.",
  "invalid-progression": "The Tamer's level could not be validated. Check the Tamer class level.",
  "progression-level-mismatch": "The Tamer's progression data did not match the class level.",
  "missing-companion-cr": "The selected Actor has no valid challenge rating.",
  "cr-exceeds-tamer-limit": "This companion's challenge rating exceeds the Tamer's current limit.",
  "cr-band-not-supported-by-summary": "This companion's challenge rating is not supported by the current Tamer progression rules.",
  "missing-or-invalid-companion-size": "The selected Actor has no valid size.",
  "size-exceeds-tamer-limit": "This companion is too large for the Tamer's current level."
};

export class TamerManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tamer-manager",
    classes: ["tamer-manager"],
    window: { title: "Tamer Manager", resizable: true },
    position: { width: 900, height: 700 },
    actions: {
      refresh: TamerManager._onRefresh,
      addCompanion: TamerManager._onAddCompanion,
      removeCompanion: TamerManager._onRemoveCompanion,
      openCompanion: TamerManager._onOpenCompanion
    }
  };
  static PARTS = {
    main: { template: "modules/tamer-manager/templates/tamer-manager.hbs", root: true }
  };

  constructor(options = {}) {
    super(options);
    this.tamer = options.tamer ?? null;
  }

  async _prepareContext() {
    const records = this.tamer ? TamerRecords.read(this.tamer) : [];
    const companions = records.map(record => {
      const actor = record.actorUuid ? game.actors?.get?.(record.actorUuid) : null;
      return {
        ...record,
        actorName: actor?.name ?? record.name ?? "Missing companion Actor",
        actorExists: Boolean(actor),
        actorUuid: record.actorUuid ?? "",
        challengeRating: actor?.system?.details?.cr ?? null,
        size: actor?.system?.traits?.size ?? null,
        hitPoints: actor?.system?.attributes?.hp?.value ?? null,
        hitPointsMax: actor?.system?.attributes?.hp?.max ?? null
      };
    });
    return { moduleId: MODULE_ID, tamer: this.tamer, companions,
      hasTamer: Boolean(this.tamer), canManage: Boolean(this.tamer && TamerRecords.isTamer(this.tamer)) };
  }

  static async openFor(tamer) {
    if (!tamer || !TamerRecords.isTamer(tamer)) {
      ui.notifications.warn("Open Companion Manager from a character with the Tamer class.");
      return null;
    }
    const app = new this({ tamer });
    await app.render({ force: true });
    return app;
  }

  static async chooseTamer() {
    const candidates = (game.actors?.contents ?? []).filter(TamerRecords.isTamer);
    if (candidates.length === 1) return candidates[0];
    if (!candidates.length) {
      ui.notifications.warn("No Tamer actors were found.");
      return null;
    }
    const options = candidates.map(actor =>
      `<option value="${actor.uuid}">${foundry.utils.escapeHTML(actor.name)}</option>`).join("");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Select Tamer" },
      content: `<form><label>Tamer <select name="tamer">${options}</select></label></form>`,
      buttons: [
        { action: "select", label: "Open", default: true,
          callback: (event, button) => button.form.elements.tamer.value },
        { action: "cancel", label: "Cancel" }
      ]
    });
    return result ? fromUuid(result).catch(() => null) : null;
  }

  static async chooseActor() {
    const existing = new Set(TamerRecords.read(this.tamer).map(record => record.actorUuid));
    const candidates = (game.actors?.contents ?? []).filter(actor => actor !== this.tamer && !existing.has(actor.uuid));
    if (!candidates.length) {
      ui.notifications.warn("No eligible unregistered Actor documents are available to add.");
      return null;
    }
    const options = candidates.map(actor =>
      `<option value="${actor.uuid}">${foundry.utils.escapeHTML(actor.name)}</option>`).join("");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Add Companion" },
      content: `<form><label>Companion <select name="actor">${options}</select></label></form>`,
      buttons: [
        { action: "select", label: "Add", default: true,
          callback: (event, button) => button.form.elements.actor.value },
        { action: "cancel", label: "Cancel" }
      ]
    });
    return result ? fromUuid(result).catch(() => null) : null;
  }

  static async _onRefresh() { await this.render({ force: true }); }

  static async _onAddCompanion() {
    if (!this.tamer) return;
    const actor = await this.constructor.chooseActor();
    if (!actor) return;

    const preview = await TamerRecords.previewAdd(this.tamer, actor);
    if (!preview.eligible) {
      ui.notifications.warn(ADD_REASONS[preview.reason] ?? `Companion could not be added (${preview.reason ?? "eligibility-check-failed"}).`);
      return;
    }

    const result = await TamerRecords.add(this.tamer, actor);
    if (!result?.record) {
      ui.notifications.error(ADD_REASONS[result?.reason] ??
        `The companion could not be initialized (${result?.reason ?? "initialization-failed"}).`);
      return;
    }
    await this.render({ force: true });
  }

  static async _onOpenCompanion(event, target) {
    const uuid = target?.dataset?.actorUuid;
    if (!uuid) return;
    const actor = await fromUuid(uuid).catch(() => null);
    if (!actor) {
      ui.notifications.warn("That companion Actor is no longer available. Its saved relationship was preserved.");
      await this.render({ force: true });
      return;
    }
    actor.sheet?.render(true);
  }

  static async _onRemoveCompanion(event, target) {
    const recordId = target?.dataset?.recordId;
    if (!recordId || !this.tamer) return;
    const removed = await TamerRecords.remove(this.tamer, recordId);
    if (removed) await this.render({ force: true });
  }
}
globalThis.TamerManager = TamerManager;
