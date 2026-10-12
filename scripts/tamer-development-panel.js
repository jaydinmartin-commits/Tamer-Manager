import { CompanionInitialization } from "./data/companion-initialization.js";
import { TamerConfiguration } from "./tamer-configuration.js";
import { CompanionInitializationApplication } from "./data/companion-initialization-application.js";
import { TamerRecords } from "./data/tamer-records.js";
import { CompanionOptionStore } from "./data/companion-option-store.js";
import { CompanionOptions } from "./data/companion-options.js";
import { ToughenUpApplication } from "./data/toughen-up-application.js";

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
      // ApplicationV2 action handlers are instance methods; bind their method
      // references through the prototype so the framework can invoke them on
      // the live application instance.
      refresh: TamerDevelopmentPanel.prototype._onRefresh,
      openOptionSettings: TamerDevelopmentPanel.prototype._onOpenOptionSettings,
      runPreflight: TamerDevelopmentPanel.prototype._onRunPreflight,
      applyInitialization: TamerDevelopmentPanel.prototype._onApplyInitialization,
      testImprovement: TamerDevelopmentPanel.prototype._onTestImprovement,
      applyToughenUp: TamerDevelopmentPanel.prototype._onApplyToughenUp,
      openOwner: TamerDevelopmentPanel.prototype._onOpenOwner,
      openCompanion: TamerDevelopmentPanel.prototype._onOpenCompanion
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
    this.improvementId = "";
    this.improvementApplicationId = "";
    this.improvementReport = null;
    this.busy = false;
  }

  static open() {
    if (!game.user?.isGM) {
      ui.notifications.warn("Only a GM can open Development & Testing.");
      return null;
    }
    const app = new this();
    app.render({ force: true });
    return app;
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
      report: this.report ? { ...this.report, isPassed: this.report.status === "passed" } : null,
      canApply: Boolean(this.lastPlan?.eligible && owner && companion && !this.busy),
      improvementOptions: [{ value: "builtin:toughen-up", label: "Toughen Up (built-in universal improvement)", selected: this.improvementId === "builtin:toughen-up" }, ...CompanionOptionStore.list("improvement").map(option => ({ value: option.id, label: option.name + " (registered)", selected: this.improvementId === option.id }))],
      improvementReport: this.improvementReport ? { ...this.improvementReport, isPassed: this.improvementReport.status === "passed" } : null,
      canApplyToughenUp: Boolean(this.companionUuid && this.improvementReport?.canApply && !this.busy),
      busy: this.busy
    };
  }

  async _onRefresh() { this.report = null; this.lastPlan = null; this.improvementReport = null; await this.render({ force: true }); }
  async _onOpenOptionSettings() { if (game.user?.isGM) new TamerConfiguration().render({ force: true }); }
  async _onOpenOwner(event, target) {
    const { owner } = await this._selectedActors(target);
    owner?.sheet?.render(true);
  }
  async _onOpenCompanion(event, target) {
    const { companion } = await this._selectedActors(target);
    companion?.sheet?.render(true);
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

  async _onTestImprovement(event, target) {
    if (!game.user?.isGM || this.busy) return;
    this.busy = true;
    try {
      const form = target?.form ?? target?.closest?.("form") ?? this.element?.querySelector("form");
      const selectedId = form?.elements?.improvement?.value ?? "";
      const { owner, companion } = await this._selectedActors(target);
      this.improvementId = selectedId;
      if (!companion) throw new Error("Select a companion Actor first.");
      if (!selectedId) throw new Error("Choose an improvement first.");
      if (selectedId === "builtin:toughen-up") {
        // Give each explicit test a unique ID; preserve it through Apply.
        this.improvementApplicationId = `${companion.uuid}::toughen-up::dev-test::${foundry.utils.randomID()}`;
        const preview = ToughenUpApplication.preview({ actor: companion, applicationId: this.improvementApplicationId });
        this.improvementReport = { title: preview.eligible ? "Toughen Up preflight passed" : "Toughen Up preflight failed", status: preview.eligible ? "passed" : "failed", canApply: Boolean(preview.eligible), details: preview.eligible ? ["Actor: " + companion.name, "Hit die: d" + preview.denomination + "; count: " + preview.hitDiceBefore, "HP formula: " + preview.formulaBefore + " → " + preview.formulaAfter, "Constitution modifier: " + preview.constitutionModifier, "This preview is read-only."] : ["Blocked: " + preview.reason] };
      } else {
        const definition = CompanionOptionStore.get(selectedId);
        if (!definition || definition.type !== "improvement") throw new Error("That registered improvement no longer exists.");
        const issues = [];
        try { CompanionOptionStore.validate(); } catch (validationError) { issues.push("Registration validation: " + String(validationError?.message ?? validationError)); }
        if (!owner) issues.push("Select a Tamer to check level requirements.");
        else if (!CompanionOptions.isAvailable(definition, { tamer: owner, companion: { actorUuid: companion.uuid } })) issues.push("Tamer-level or companion-identifier requirements are not met.");
        this.improvementReport = { title: issues.length ? "Registration/eligibility check failed" : "Registration/eligibility check passed", status: issues.length ? "failed" : "passed", canApply: false, details: ["Name: " + definition.name + " (" + definition.id + ")", "Source Item: " + (definition.sourceUuid || "not linked"), "Tamer level required: " + (definition.requirements?.tamerLevel ?? 0), "Prerequisites: " + (definition.prerequisiteIds?.join(", ") || "none"), "Repeatable: " + (definition.repeatable ? "yes" : "no") + "; max selections: " + (definition.maxSelections ?? 1), ...issues, ...(issues.length ? [] : ["No mechanical adapter is registered for this option yet; it can be configured and validated but not applied here."])] };
      }
    } catch (error) { this.improvementReport = { title: "Improvement test failed", status: "failed", canApply: false, details: [String(error?.message ?? error)] }; }
    finally { this.busy = false; await this.render({ force: true }); }
  }

  async _onApplyToughenUp(event, target) {
    if (!game.user?.isGM || this.busy || this.improvementId !== "builtin:toughen-up") return;
    this.busy = true;
    try {
      const { companion } = await this._selectedActors(target);
      if (!companion) throw new Error("Select a companion Actor first.");
      const applicationId = this.improvementApplicationId;
      if (!applicationId || !applicationId.startsWith(`${companion.uuid}::toughen-up::dev-test::`)) {
        throw new Error("Run the Toughen Up preflight again before applying.");
      }
      const preview = ToughenUpApplication.preview({ actor: companion, applicationId });
      if (!preview.eligible) throw new Error("Toughen Up is blocked: " + preview.reason);
      const confirmed = await foundry.applications.api.DialogV2.confirm({ window: { title: "Apply Toughen Up (Test)" }, content: "<p>This permanently adds one hit die and rolls its HP increase for <strong>" + foundry.utils.escapeHTML(companion.name) + "</strong>.</p><p>Use a disposable test NPC. This test action is recorded to prevent duplicate application.</p>", yes: { label: "Apply Toughen Up" }, no: { label: "Cancel" } });
      if (!confirmed) return;
      const result = await ToughenUpApplication.apply({ actor: companion, applicationId });
      this.improvementReport = { title: result.verified ? "Toughen Up applied and verified" : "Toughen Up verification failed", status: result.verified ? "passed" : "failed", canApply: false, details: ["Roll: " + (result.roll ?? "not rolled"), "HP increase: " + (result.hpIncrease ?? "not applied"), "HP formula: " + (result.formulaBefore ?? "unknown") + " → " + (result.formulaAfter ?? "unknown"), "Hit dice: " + (result.hitDiceBefore ?? "unknown") + " → " + (result.hitDiceAfter ?? "unknown"), result.reason ?? "Post-update Actor values checked."] };
    } catch (error) { this.improvementReport = { title: "Toughen Up application failed", status: "failed", canApply: false, details: [String(error?.message ?? error)] }; }
    finally { this.busy = false; await this.render({ force: true }); }
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
