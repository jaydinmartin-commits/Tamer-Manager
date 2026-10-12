const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { TamerRecords } from "./data/tamer-records.js";
import { TamerCompanionSummary } from "./data/tamer-companion-summary.js";

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
      openCompanion: TamerManager._onOpenCompanion,
      toggleSummon: TamerManager._onToggleSummon
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
    const tamerClass = this.tamer?.items?.find(item =>
      item.type === "class" &&
      (String(item.name ?? "").trim().toLowerCase() === "tamer" ||
       String(item.system?.identifier ?? "").trim().toLowerCase() === "tamer")
    );
    const tamerLevel = Number(tamerClass?.system?.levels) || 0;
    let progression = null;
    try { if (tamerLevel >= 1 && tamerLevel <= 20) progression = TamerCompanionSummary.forLevel(tamerLevel); }
    catch { progression = null; }
    const companions = await Promise.all(records.map(async (record, index) => {
      let actor = null;
      if (record.actorUuid) {
        try { actor = await fromUuid(record.actorUuid); }
        catch { actor = null; }
      }
      return {
        ...record,
        actorName: actor?.name ?? record.name ?? "Missing companion Actor",
        selectedImprovements: Array.isArray(record.improvements) ? record.improvements.length : 0,
        improvementProgressLabel: (() => {
          const selected = Array.isArray(record.improvements) ? record.improvements.length : 0;
          if (!actor || tamerLevel < 1) return `${selected} / —`;
          try {
            const available = TamerCompanionSummary.trainingFor(tamerLevel, actor.system?.details?.cr ?? actor.system?.details?.challenge).improvements;
            return `${selected} / ${available}`;
          } catch { return `${selected} / —`; }
        })(),
        challengeRatingLabel: (() => {
          const cr = actor?.system?.details?.cr ?? actor?.system?.details?.challenge;
          if (cr === 0 || cr === "0") return "CR 0";
          if (cr === null || cr === undefined || cr === "") return "—";
          const n = Number(cr);
          if (Number.isFinite(n)) {
            const common = [[1/8,"1/8"],[1/4,"1/4"],[1/2,"1/2"],[1/3,"1/3"]];
            const fraction = common.find(([value]) => Math.abs(value - n) < 0.0001);
            return `CR ${fraction?.[1] ?? n}`;
          }
          return `CR ${String(cr)}`;
        })(),
        sizeLabel: actor?.system?.traits?.size
          ? String(actor.system.traits.size).replace(/^./, value => value.toUpperCase())
          : "",
        availableImprovements: actor && tamerLevel >= 1 ? (() => { try { return TamerCompanionSummary.trainingFor(tamerLevel, actor.system?.details?.cr ?? actor.system?.details?.challenge).improvements; } catch { return null; } })() : null,
        vesselName: record.vesselName || (record.vesselUuid ? "Assigned vessel" : "No vessel assigned"),
        statusLabel: record.status === "summoned" ? "Summoned" : (record.vesselUuid || record.vesselName ? "Stored in vessel" : "In vessel (unassigned)"),
        actorExists: Boolean(actor),
        actorUuid: record.actorUuid ?? "",
        portrait: actor?.img ?? "icons/svg/mystery-man.svg",
        actorType: typeof actor?.system?.details?.type?.value === "string"
          ? actor.system.details.type.value
          : (typeof actor?.system?.details?.type === "string" ? actor.system.details.type : actor?.type ?? null),
        challengeRating: actor?.system?.details?.cr ?? null,
        size: actor?.system?.traits?.size ?? null,
        hitPoints: actor?.system?.attributes?.hp?.value ?? null,
        hitPointsMax: actor?.system?.attributes?.hp?.max ?? null,
        armorClass: actor?.system?.attributes?.ac?.value ?? null,
        slot: index + 1
      };
    }));
    return { moduleId: MODULE_ID, tamer: this.tamer, companions,
      tamerLevel, companionCount: records.length,
      maxCompanions: progression?.maxCompanions ?? null,
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

  static async chooseActor(tamer) {
    if (!tamer || !TamerRecords.isTamer(tamer)) return null;
    const existing = new Set(TamerRecords.read(tamer).map(record => record.actorUuid));
    const candidates = (game.actors?.contents ?? []).filter(actor => actor !== tamer && actor.type === "npc" && !existing.has(actor.uuid));
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
    const actor = await this.constructor.chooseActor(this.tamer);
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

  static async _onToggleSummon(event, target) {
    const recordId = target?.dataset?.recordId;
    if (!recordId || !this.tamer) return;
    const records = TamerRecords.read(this.tamer);
    const record = records.find(item => item.id === recordId);
    if (!record) {
      ui.notifications.warn("That companion relationship no longer exists.");
      await this.render({ force: true });
      return;
    }
    if (!game.user?.isGM && !this.tamer.isOwner) {
      ui.notifications.warn("You do not have permission to summon this companion.");
      return;
    }
    const scene = canvas.scene;
    if (!scene) {
      ui.notifications.warn("Open a scene before summoning a companion.");
      return;
    }

    if (record.status === "summoned" && record.tokenUuid) {
      let tokenDoc = null;
      try { tokenDoc = await fromUuid(record.tokenUuid); } catch { tokenDoc = null; }
      if (!tokenDoc) {
        tokenDoc = scene.tokens.find(token => token.id === record.tokenUuid || token.uuid === record.tokenUuid) ?? null;
      }
      if (!tokenDoc || tokenDoc.parent?.id !== scene.id) {
        ui.notifications.warn("The recorded companion token is not on the current scene. Its relationship was preserved.");
        return;
      }
      await scene.deleteEmbeddedDocuments("Token", [tokenDoc.id]);
      const updated = records.map(item => item.id === recordId
        ? { ...item, status: "in-vessel", tokenUuid: null }
        : item);
      try {
        await TamerRecords.write(this.tamer, updated);
      } catch (error) {
        console.error("Tamer Manager | Could not save companion storage state.", error);
        ui.notifications.error("The token was removed, but the companion status could not be saved. Refresh and check the record.");
        return;
      }
      ui.notifications.info("Companion returned to storage.");
      await this.render({ force: true });
      return;
    }

    const actor = await fromUuid(record.actorUuid).catch(() => null);
    if (!actor || actor.type !== "npc") {
      ui.notifications.warn("The companion Actor could not be found or is no longer an NPC.");
      return;
    }
    const tamerToken = canvas.tokens?.placeables?.find(token => token.actor?.uuid === this.tamer.uuid);
    if (!tamerToken) {
      ui.notifications.warn("Place or select a token for the Tamer on the current scene before summoning.");
      return;
    }
    const grid = Number(scene.grid?.size) || Number(canvas.grid?.size) || 100;
    const prototype = actor.prototypeToken?.toObject?.() ?? {};
    const tokenData = {
      ...prototype,
      name: actor.name,
      actorId: actor.id,
      actorLink: true,
      x: tamerToken.document.x + grid,
      y: tamerToken.document.y,
      hidden: false
    };
    delete tokenData._id;
    const [created] = await scene.createEmbeddedDocuments("Token", [tokenData]);
    if (!created) {
      ui.notifications.error("Foundry did not create a token for this companion.");
      return;
    }
    try {
      await TamerRecords.write(this.tamer, records.map(item => item.id === recordId
        ? { ...item, status: "summoned", tokenUuid: created.uuid }
        : item));
    } catch (error) {
      console.error("Tamer Manager | Could not save summoned companion state.", error);
      ui.notifications.error("The token was created, but its summoned state could not be saved. Do not summon it again until you check the scene.");
      return;
    }
    ui.notifications.info(`${actor.name} summoned.`);
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
    const record = TamerRecords.read(this.tamer).find(item => item.id === recordId);
    if (!record) {
      ui.notifications.warn("That companion relationship no longer exists.");
      await this.render({ force: true });
      return;
    }
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Unlink Companion" },
      content: `<p>Unlink <strong>${foundry.utils.escapeHTML(record.name || "this companion")}</strong> from ${foundry.utils.escapeHTML(this.tamer.name)}?</p><p>This removes only the relationship. It does not delete the Actor or reverse previously applied initialization benefits.</p>`,
      yes: { label: "Unlink companion" },
      no: { label: "Cancel" }
    });
    if (!confirmed) return;
    try {
      const removed = await TamerRecords.remove(this.tamer, recordId);
      if (removed) {
        ui.notifications.info("Companion unlinked. The Actor itself was not deleted.");
        await this.render({ force: true });
      } else {
        ui.notifications.warn("The companion relationship was not changed. Refresh the manager and try again.");
      }
    } catch (error) {
      console.error("Tamer Manager | Failed to persist companion unlink.", error);
      ui.notifications.error("Could not save the unlink. The relationship has been kept; refresh before retrying.");
      await this.render({ force: true });
    }
  }
}
globalThis.TamerManager = TamerManager;
