import { CompanionInitialization } from "./data/companion-initialization.js";
import { CompanionInitializationApplication } from "./data/companion-initialization-application.js";
import { TamerRecords } from "./data/tamer-records.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const MODULE_ID = "tamer-manager";

function actorOptions(actors, selected = "") {
  return actors.map(actor => ({
    value: actor.uuid,
    label: actor.name,
    selected: actor.uuid === selected
  }));
}

export class TamerDevelopmentPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tamer-manager-development-panel",
    classes: ["tamer-manager", "tamer-manager-development"],
    window: { title: "Tamer Manager — Development & Testing", resizable: true },
    position: { width: 760, height: 720 },
    actions: {
      refresh: TamerDevelopmentPanel._onRefresh,
      runPreflight: TamerDevelopmentPanel._onRunPreflight,
      applyInitialization: TamerDevelopmentPanel._onApplyInitialization,
      openOwner: TamerDevelopmentPanel._onOpenOwner,
      openCompanion: TamerDevelopmentPanel._onOpenCompanion
    }
  };

  static PARTS = {
    main: { template: "modules/tamer-manager/templates/tamer-development-panel.hbs", root: true }
  };

  constructor(options = {}) {
    super(options);
    this.ownerUuid = options.ownerUuid ?? "";
    this.companionUuid = options.companionUuid ?? "";
    this.report = null;
    this.lastPlan = null;
    this.applicationId = "";
    this.busy = false;
  }

  static open() {
    if (!game.user?.isGM) {
      ui.notifications.warn("Only a GM can open Development & Testing.");
      return null;
    }
    return new this().render({ force: true });
  }

  async _prepareContext() {
    const actors = (game.actors?.contents ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const owners = actors.filter(TamerRecords.isTamer);
    const owner = this.ownerUuid ? await fromUuid(this.ownerUuid).catch(() => null) : null;
    const companion = this.companionUuid ? await fromUuid(this.companionUuid).catch(() => null) : null;
    return {
      owners: actorOptions(owners, owner?.uuid ?? ""),
      companions: actorOptions(actors.filter(actor => actor !== owner), companion?.uuid ?? ""),
      selectedOwnerUuid: owner?.uuid ?? "",
      selectedCompanionUuid: companion?.uuid ?? "",
      ownerName: owner?.name ?? "Not selected",
      companionName: companion?.name ?? "Not selected",
      report: this.report,
      canApply: Boolean(this.lastPlan?.eligible && owner && companion && !this.busy),
      busy: this.busy
    };
  }

  async _onRefresh() { this.report = null; this.lastPlan = null; await this.render({ force: true }); }
  async _onOpenOwner(event, target) {
    const actor = await fromUuid(target?.form?.elements?.owner?.value ?? "").catch(() => null);
    actor?.sheet?.render(true);
  }
  async _onOpenCompanion(event, target) {
    const actor = await fromUuid(target?.form?.elements?.companion?.value ?? "").catch(() => null);
    actor?.sheet?.render(true);
  }

  async _selectedActors(target) {
    const form = target?.form ?? target?.closest?.("form") ?? this.element?.querySelector("form");
    const ownerUuid = form?.elements?.owner?.value ?? "";
    const companionUuid = form?.elements?.companion?.value ?? "";
    const owner = ownerUuid ? await fromUuid(ownerUuid).catch(() => null) : null;
    const companion = companionUuid ? await fromUuid(companionUuid).catch(() => null) : null;
    this.ownerUuid = owner?.uuid ?? "";
    this.companionUuid = companion?.uuid ?? "";
    return { owner, companion };
  }

  async _onRunPreflight(event, target) {
    if (!game.user?.isGM || this.busy) return;
    this.busy = true;
    try {
      const { owner, companion } = await this._selectedActors(target);
      if (!owner || !companion) {
        this.report = { title: "Selection required", status: "failed", details: ["Choose both a Tamer and an NPC companion."] };
        this.lastPlan = null;
      } else {
        const result = await CompanionInitialization.planWithAccess({ owner, companion });
        this.lastPlan = result.eligible ? result : null;
        this.applicationId = `${owner.uuid}::${companion.uuid}::initialization-v1`;
        const appPreview = result.eligible ? CompanionInitializationApplication.preview({
          owner, companion, plan: result, applicationId: this.applicationId
        }) : null;
        this.report = {
          title: result.eligible ? "Eligibility preflight passed" : "Eligibility preflight failed",
          status: result.eligible && appPreview?.eligible ? "passed" : "failed",
          details: [
            `Owner: ${owner.name} (level ${result.tamerLevel ?? "unknown"})`,
            `Companion: ${companion.name} (CR ${result.companionCR ?? companion.system?.details?.cr ?? "unknown"})`,
            `CR limit: ${result.maxCR ?? "not available"}; size limit: ${result.maxSize ?? "not available"}`,
            `Training hit dice planned: ${result.training?.hitDice ?? "not available"}`,
            appPreview ? (appPreview.eligible
              ? `Initialization data valid. Hit dice: ${appPreview.hitDiceBefore} → ${appPreview.hitDiceAfter}; HP formula: ${appPreview.hpBefore?.formula} → ${appPreview.hpFormulaAfter}.`
              : `Initialization application blocked: ${appPreview.reason}`) : `Access/eligibility result: ${result.reason ?? "eligible"}`
          ],
          reason: result.reason ?? appPreview?.reason ?? null
        };
        if (!appPreview?.eligible) this.lastPlan = null;
      }
    } catch (error) {
      this.lastPlan = null;
      this.report = { title: "Test failed with an exception", status: "failed", details: [String(error?.message ?? error)] };
    } finally {
      this.busy = false;
      await this.render({ force: true });
    }
  }

  async _onApplyInitialization(event, target) {
    if (!game.user?.isGM || this.busy || !this.lastPlan) return;
    this.busy = true;
    try {
      const { owner, companion } = await this._selectedActors(target);
      if (!owner || !companion) throw new Error("Select both Actors again and rerun the preflight.");
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Apply Companion Initialization" },
        content: `<p>This will permanently update <strong>${foundry.utils.escapeHTML(companion.name)}</strong>'s hit dice, HP formula, maximum HP, and current HP, and write an initialization history entry.</p><p>Use a duplicate/test Actor first. This action does not automatically undo itself.</p>`,
        yes: { label: "Apply initialization" },
        no: { label: "Cancel" }
      });
      if (!confirmed) return;
      const result = await CompanionInitialization.planWithAccess({ owner, companion });
      if (!result.eligible) throw new Error(`Preflight no longer passes: ${result.reason ?? "ineligible"}`);
      const applied = await CompanionInitializationApplication.apply({
        owner, companion, plan: result,
        applicationId: `${owner.uuid}::${companion.uuid}::initialization-v1`
      });
      this.lastPlan = null;
      this.report = {
        title: applied.verified ? "Initialization applied and verified" : "Initialization not verified",
        status: applied.verified ? "passed" : "failed",
        details: [
          `Actor: ${companion.name}`,
          `Hit dice added: ${applied.hitDiceAdded ?? "not applied"}`,
          `HP increase: ${applied.hpAdded ?? "not applied"}`,
          `HP formula: ${applied.formulaBefore ?? "unknown"} → ${applied.formulaAfter ?? "unknown"}`,
          applied.reason ?? "Actor values were checked after the update."
        ]
      };
      if (applied.verified) ui.notifications.info("Companion initialization applied and verified.");
      else ui.notifications.error("Initialization could not be verified. Inspect the Actor before retrying.");
    } catch (error) {
      this.report = { title: "Initialization failed", status: "failed", details: [String(error?.message ?? error)] };
      ui.notifications.error("Tamer Manager test failed. See Development & Testing for details.");
    } finally {
      this.busy = false;
      await this.render({ force: true });
    }
  }
}
