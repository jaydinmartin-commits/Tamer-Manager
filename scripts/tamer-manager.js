const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { TamerRecords } from "./data/tamer-records.js";
import { CompanionOptions } from "./data/companion-options.js";
import { TamerCompanionSummary } from "./data/tamer-companion-summary.js";
import { selectedImprovementSlotCost, additionalImprovementSlotCost, hasRequiredImprovementReplacement } from "./data/companion-improvement-cost.js";
import { selectedImprovementDisplay } from "./data/companion-improvement-display.js";
import { syncImprovementSheetItems, reconcileGrowthHitDie } from "./data/companion-improvement-sheet-sync.js";
import { ToughenUpApplication } from "./data/toughen-up-application.js";

const MODULE_ID = "tamer-manager";

// The dnd5e v6 browser does not expose a per-instance pack allowlist. Scope a
// fetch filter to the lifetime of this picker so its native UI only lists the
// GM-enabled Actor packs. The guard prevents overlapping Tamer pickers.
let companionPickerActive = false;


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
      toggleSummon: TamerManager._onToggleSummon,
      assignVessel: TamerManager._onAssignVessel,
      clearVessel: TamerManager._onClearVessel,
      manageImprovements: TamerManager._onManageImprovements
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
    const resourceFor = names => {
      const item = this.tamer?.items?.find(candidate => {
        const name = String(candidate.name ?? "").trim().toLowerCase();
        const identifier = String(candidate.system?.identifier ?? "").trim().toLowerCase();
        return names.includes(name) || names.includes(identifier);
      });
      const uses = item?.system?.uses;
      if (!item || !uses || uses.max == null) return null;
      return { name: item.name, value: uses.value ?? 0, max: uses.max };
    };
    const resources = [
      resourceFor(["soul bond", "soul-bond"]),
      resourceFor(["splicer", "splicer points", "splicer-points"])
    ].filter(Boolean);
    let progression = null;
    try { if (tamerLevel >= 1 && tamerLevel <= 20) progression = TamerCompanionSummary.forLevel(tamerLevel); }
    catch { progression = null; }
    const companions = await Promise.all(records.map(async (record, index) => {
      let actor = null;
      if (record.actorUuid) {
        try { actor = await fromUuid(record.actorUuid); }
        catch { actor = null; }
      }
      const improvementDisplay = selectedImprovementDisplay(record, CompanionOptions.byType("improvement", { companion: actor }).filter(option => option.displayOnManager !== false));
      return {
        ...record,
        actorName: actor?.name ?? record.name ?? "Missing companion Actor",
        selectedImprovements: Array.isArray(record.improvements) ? record.improvements.length : 0,
        improvementDisplay,
        hasImprovementDisplay: improvementDisplay.length > 0,
        improvementProgressLabel: (() => {
          const selectedSlots = selectedImprovementSlotCost(record, CompanionOptions.byType("improvement"));
          if (!actor || tamerLevel < 1) return `${selectedSlots} / —`;
          try {
            const available = TamerCompanionSummary.trainingFor(tamerLevel, actor.system?.details?.cr ?? actor.system?.details?.challenge).improvements;
            return `${selectedSlots} / ${available}`;
          } catch { return `${selectedSlots} / —`; }
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
        isSummoned: record.status === "summoned",
        isSummonedBespoke: record.status === "summoned" && CompanionOptions.byType("improvement", { companion: actor }).some(option => Boolean(option.treeId)),
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
    return { moduleId: MODULE_ID, tamer: this.tamer, companions, resources, hasResources: resources.length > 0,
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
    const configured = game.settings.get(MODULE_ID, "companionCompendiums") ?? [];
    const allowedCollections = new Set(configured.filter(collection => {
      const pack = game.packs?.get(collection);
      // Foundry exposes documentName on normal CompendiumCollection instances,
      // while some compatible pack wrappers only expose metadata.type.
      return (pack?.documentName === "Actor" || pack?.metadata?.type === "Actor") &&
        Boolean(pack.visible);
    }));
    if (!allowedCollections.size) {
      ui.notifications.warn("No visible Actor compendiums are configured. Ask the GM to use Tamer Manager → Configure Compendiums.");
      return null;
    }

    // Load the system browser only when the GM opens the picker. A system-path
    // mismatch must never prevent module settings, API, or manager initialization.
    let CompendiumBrowser;
    let CompendiumBrowserSettingsConfig;
    try {
      ({ default: CompendiumBrowser } = await import("/systems/dnd5e/module/applications/compendium-browser.mjs"));
      ({ default: CompendiumBrowserSettingsConfig } = await import("/systems/dnd5e/module/applications/settings/compendium-browser-settings.mjs"));
    } catch (error) {
      console.error("Tamer Manager | Could not load the D&D 5e Compendium Browser for Add Companion.", error);
      ui.notifications.error("Tamer Manager loaded, but the D&D 5e Compendium Browser could not be loaded. Confirm D&D 5e v6 is active and fully initialized.");
      return null;
    }
    if (typeof CompendiumBrowser?.selectOne !== "function" ||
        typeof CompendiumBrowserSettingsConfig?.collateSources !== "function") {
      ui.notifications.error("The D&D 5e Compendium Browser API is unavailable. Confirm that dnd5e v6 has finished initializing.");
      return null;
    }
    if (companionPickerActive) {
      ui.notifications.warn("The companion picker is already open.");
      return null;
    }

    // dnd5e v6's native browser has no per-window collection allowlist. Scope
    // source collation to the GM-enabled Actor packs while retaining the exact
    // native D&D 5e interface and all native filters.
    const originalFetch = CompendiumBrowser.fetch;
    companionPickerActive = true;
    let uuid;
    try {
      CompendiumBrowser.fetch = async function(documentClass, options = {}) {
        if (documentClass !== CONFIG.Actor.documentClass) {
          return originalFetch.call(this, documentClass, options);
        }

        // Filter at the native browser's source-collation stage so disallowed
        // packs are never indexed for this picker (avoids unnecessary work and
        // keeps unauthorized entries out of the browser result pipeline).
        const originalCollateSources = CompendiumBrowserSettingsConfig.collateSources;
        CompendiumBrowserSettingsConfig.collateSources = function() {
          const nativeSources = [...originalCollateSources.call(this)];
          // Preserve the system's normal Item sources for browser internals, but
          // replace its Actor-source list with the GM's explicit Tamer Manager
          // allowlist. This setting must work independently of global dnd5e
          // browser source preferences.
          const itemSources = nativeSources.filter(collection => {
            const pack = game.packs.get(collection);
            return pack?.documentName !== "Actor" && pack?.metadata?.type !== "Actor";
          });
          return new Set([...itemSources, ...allowedCollections]);
        };
        try {
          // Await the index operation: its source-collation call happens during
          // this asynchronous work, not synchronously at invocation time.
          return await originalFetch.call(this, documentClass, options);
        } finally {
          CompendiumBrowserSettingsConfig.collateSources = originalCollateSources;
        }
      };
      uuid = await CompendiumBrowser.selectOne({
        tab: "monsters",
        filters: {
          locked: { documentClass: "Actor", types: new Set(["npc"]) },
          initial: { documentClass: "Actor", types: new Set(["npc"]) }
        },
        selection: { min: 1, max: 1 }
      });
    } finally {
      CompendiumBrowser.fetch = originalFetch;
      companionPickerActive = false;
    }
    if (!uuid) return null;

    const collection = [...allowedCollections].find(name => uuid.startsWith(`Compendium.${name}.`));
    if (!collection) {
      ui.notifications.warn("That Actor is not from a compendium enabled by the GM for Tamer Manager.");
      return null;
    }
    const source = await fromUuid(uuid).catch(() => null);
    if (!source || source.type !== "npc") {
      ui.notifications.warn("Choose an NPC Actor from an enabled compendium.");
      return null;
    }
    // Compendium documents must never be modified in place. Create a world Actor
    // copy before initialization, then let the existing initialization/recovery
    // contract manage the world document as it would a manually created NPC.
    const data = source.toObject();
    delete data._id;
    data.folder = null;
    foundry.utils.setProperty(data, "flags.tamer-manager.sourceUuid", uuid);
    const companion = await Actor.create(data);
    if (!companion) {
      ui.notifications.error("Foundry could not create a world Actor from the selected compendium entry.");
      return null;
    }
    return companion;
  }

  static async _onRefresh() { await this.render({ force: true }); }

  static async _onAddCompanion() {
    if (!this.tamer) return;
    const actor = await TamerManager.chooseActor(this.tamer);
    if (!actor) return;

    const preview = await TamerRecords.previewAdd(this.tamer, actor);
    if (!preview.eligible) {
      if (actor.getFlag?.(MODULE_ID, "sourceUuid")) {
        try { await actor.delete(); }
        catch (error) { console.error("Tamer Manager | Could not clean up rejected compendium Actor.", error); }
      }
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

  static async _onAssignVessel(event, target) {
    const recordId = target?.dataset?.recordId;
    if (!recordId || !this.tamer) return;
    if (!game.user?.isGM && !this.tamer.isOwner) {
      ui.notifications.warn("You do not have permission to manage this companion.");
      return;
    }
    const record = TamerRecords.read(this.tamer).find(item => item.id === recordId);
    if (!record) {
      ui.notifications.warn("That companion relationship no longer exists.");
      await this.render({ force: true });
      return;
    }
    const items = this.tamer.items?.contents ?? Array.from(this.tamer.items ?? []);
    // Only offer items explicitly identifiable as vessels. A generic piece of
    // equipment, consumable, loot, or feat must never become a vessel by accident.
    const isVesselItem = item => {
      const flags = item.flags?.["tamer-manager"] ?? {};
      const identifier = String(item.system?.identifier ?? item.system?.slug ?? "").toLowerCase();
      const name = String(item.name ?? "").toLowerCase();
      return flags.isVessel === true ||
        flags.vessel === true ||
        flags.kind === "vessel" ||
        identifier.includes("vessel") ||
        /\bvessel\b/.test(name);
    };
    const candidates = items.filter(item =>
      item.id !== record.actorUuid &&
      ["equipment", "consumable", "loot", "feat"].includes(item.type) &&
      isVesselItem(item)
    );
    if (!candidates.length) {
      ui.notifications.warn("No vessel items were found on this Tamer. Add the vessel item to the character first.");
      return;
    }
    const options = candidates.map(item =>
      `<option value="${foundry.utils.escapeHTML(item.uuid)}" ${item.uuid === record.vesselUuid ? "selected" : ""}>${foundry.utils.escapeHTML(item.name)}</option>`).join("");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Assign Companion Vessel" },
      content: `<form><label>Vessel <select name="vessel"><option value="">Choose a vessel</option>${options}</select></label></form>`,
      buttons: [
        { action: "assign", label: "Assign", default: true,
          callback: (event, button) => button.form.elements.vessel.value },
        { action: "cancel", label: "Cancel" }
      ]
    });
    if (!result) return;
    const vessel = await fromUuid(result).catch(() => null);
    if (!vessel || vessel.parent?.uuid !== this.tamer.uuid) {
      ui.notifications.warn("The selected vessel is no longer on this Tamer.");
      return;
    }
    try {
      const latest = TamerRecords.read(this.tamer);
      if (!latest.some(item => item.id === recordId)) throw new Error("Companion relationship changed before assignment.");
      const saved = await TamerRecords.write(this.tamer, latest.map(item => item.id === recordId
        ? { ...item, vesselUuid: vessel.uuid, vesselName: vessel.name }
        : item));
      if (!saved) throw new Error("Vessel assignment did not persist.");
      ui.notifications.info(`Assigned ${vessel.name} to ${record.name}.`);
      await this.render({ force: true });
    } catch (error) {
      console.error("Tamer Manager | Vessel assignment failed.", error);
      ui.notifications.error("Could not save the vessel assignment. The previous relationship was preserved.");
    }
  }

  static async _onManageImprovements(event, target) {
    const recordId = target?.dataset?.recordId;
    if (!recordId || !this.tamer) return;
    if (!game.user?.isGM && !this.tamer.isOwner) {
      ui.notifications.warn("You do not have permission to manage this companion.");
      return;
    }
    const record = TamerRecords.read(this.tamer).find(item => item.id === recordId);
    if (!record) {
      ui.notifications.warn("That companion relationship no longer exists.");
      await this.render({ force: true });
      return;
    }
    const actor = await fromUuid(record.actorUuid).catch(() => null);
    if (!actor) {
      ui.notifications.warn("The companion Actor could not be found.");
      return;
    }
    const classItem = this.tamer.items?.find(item => item.type === "class" &&
      (String(item.name ?? "").trim().toLowerCase() === "tamer" ||
       String(item.system?.identifier ?? "").trim().toLowerCase() === "tamer"));
    const tamerLevel = Number(classItem?.system?.levels) || 0;
    let maximum = 0;
    try {
      maximum = TamerCompanionSummary.trainingFor(
        tamerLevel, actor.system?.details?.cr ?? actor.system?.details?.challenge
      ).improvements;
    } catch {
      ui.notifications.warn("The current Tamer progression does not define an improvement allowance for this companion.");
      return;
    }
    const allDefinitions = CompanionOptions.byType("improvement");
    const definitions = CompanionOptions.byType("improvement", { companion: actor });
    const savedCounts = new Map();
    for (const value of record.improvements ?? []) {
      const id = typeof value === "string" ? value : String(value?.id ?? "");
      if (!id) continue;
      const rawCount = typeof value === "string" ? 1 : Number(value?.count ?? value?.rank ?? 1);
      const count = Number.isFinite(rawCount) && rawCount >= 1 ? Math.floor(rawCount) : 1;
      savedCounts.set(id, (savedCounts.get(id) ?? 0) + count);
    }
    const byId = new Map(definitions.map(definition => [definition.id, definition]));
    const previouslySavedIds = new Set(savedCounts.keys());
    const effectiveSelectedIds = new Set([...savedCounts.keys()]);
    for (const id of [...effectiveSelectedIds]) {
      const definition = byId.get(id);
      if (definition?.replacesId) effectiveSelectedIds.delete(definition.replacesId);
    }
    const selectedCount = selectedImprovementSlotCost(record, allDefinitions);
    const unknownLegacySelections = [...savedCounts.entries()].filter(([id]) => !byId.has(id));
    if (!definitions.length && !unknownLegacySelections.length) {
      ui.notifications.warn("No companion improvements have been configured by the GM yet.");
      return;
    }
    const rows = await Promise.all(definitions.map(async definition => {
      const count = savedCounts.get(definition.id) ?? 0;
      const isSelected = count > 0;
      const prerequisitesMet = (definition.prerequisiteIds ?? []).every(id => effectiveSelectedIds.has(id));
      const levelMet = CompanionOptions.isAvailable(definition, { tamer: this.tamer, companion: actor });
      const replacementMet = !definition.replacesId || effectiveSelectedIds.has(definition.replacesId);
      const replacedCost = definition.replacesId && effectiveSelectedIds.has(definition.replacesId)
        ? (Number(byId.get(definition.replacesId)?.slotCost) || 0) * (savedCounts.get(definition.replacesId) ?? 1)
        : 0;
      const remaining = Math.max(0, maximum - selectedCount);
      const requiredSlots = additionalImprovementSlotCost(definition.slotCost, replacedCost);
      const cap = definition.repeatable ? (definition.maxSelections ?? maximum) : 1;
      const disabled = !isSelected && (!levelMet || !prerequisitesMet || !replacementMet || remaining < requiredSlots);
      const disabledReason = !isSelected
        ? (!levelMet
          ? "Tamer level or companion restriction not met"
          : !prerequisitesMet
            ? `Prerequisites required: ${definition.prerequisiteIds.filter(id => !effectiveSelectedIds.has(id)).map(id => byId.get(id)?.name ?? id).join(", ")}`
            : !replacementMet
              ? `Select ${byId.get(definition.replacesId)?.name ?? definition.replacesId} first`
              : remaining < requiredSlots
                ? `Needs ${requiredSlots} additional slot(s); ${remaining} available`
                : "")
        : "";
      const sourceItem = definition.sourceUuid ? await fromUuid(definition.sourceUuid).catch(() => null) : null;
      const rawDescription = String(definition.metadata?.description ?? sourceItem?.system?.description?.value ?? "");
      const description = rawDescription.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const escapedDescription = foundry.utils.escapeHTML(description);
      const detail = disabled ? foundry.utils.escapeHTML(disabledReason) : (description || (definition.prerequisiteIds?.length ? `Prerequisites: ${foundry.utils.escapeHTML(definition.prerequisiteIds.join(", "))}` : "No additional prerequisites"));
      return `<label class="tamer-manager__improvement-option" data-tooltip="${escapedDescription}" data-tooltip-direction="RIGHT" title="${escapedDescription}"><input type="checkbox" name="improvement" value="${foundry.utils.escapeHTML(definition.id)}" ${isSelected ? "checked" : ""} ${disabled ? "disabled" : ""}><span><strong>${foundry.utils.escapeHTML(definition.name)}</strong><small>${detail}</small>${definition.repeatable ? `<span class="tamer-manager__rank-control">Ranks <input type="number" name="count-${foundry.utils.escapeHTML(definition.id)}" min="1" max="${cap}" value="${Math.min(count || 1, cap)}"></span>` : ""}</span></label>`;
    }));
    const legacyRows = unknownLegacySelections.map(([id, count]) =>
      `<label class="tamer-manager__improvement-option is-legacy"><input type="checkbox" checked disabled><span><strong>${foundry.utils.escapeHTML(id)}</strong><small>Previously saved selection (${count} rank${count === 1 ? "" : "s"}). Its definition is not currently configured; this selection will be preserved.</small></span></label>`
    ).join("");
    const legacyNotice = unknownLegacySelections.length
      ? `<p class="tamer-manager__legacy-note"><i class="fa-solid fa-triangle-exclamation"></i> ${unknownLegacySelections.length} saved selection(s) are not currently configured. They will be preserved, but their slot costs cannot be verified until the GM restores their definitions.</p>`
      : "";
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: `Manage Improvements — ${actor.name}` },
      content: `<form><p>Choose up to ${maximum} improvement slots. Repeatable improvements can use multiple slots when permitted.</p>${legacyNotice}<div class="tamer-manager__improvement-list">${legacyRows}${rows.join("")}</div></form>`,
      buttons: [
        { action: "save", label: "Save", default: true, callback: (event, button) => {
          const form = button.form;
          const selected = Array.from(form.querySelectorAll('input[name="improvement"]:checked')).map(input => {
            const definition = byId.get(input.value);
            const countInput = form.querySelector(`input[name="count-${CSS.escape(input.value)}"]`);
            const count = definition?.repeatable ? Math.max(1, Math.min(Number(countInput?.value) || 1, definition.maxSelections ?? maximum)) : 1;
            return { id: input.value, count };
          });
          for (const [id, count] of unknownLegacySelections) selected.push({ id, count });
          return selected;
        }},
        { action: "cancel", label: "Cancel" }
      ]
    });
    if (!Array.isArray(result)) return;
    const resultCounts = new Map(result.map(value => [value.id, value.count]));
    const resultIds = new Set(resultCounts.keys());
    if (unknownLegacySelections.length) {
      const newlyAddedKnownSelection = result.some(value => byId.has(value.id) && !savedCounts.has(value.id));
      if (newlyAddedKnownSelection) {
        ui.notifications.warn("Restore the missing improvement definitions before adding new improvements. Existing saved selections were not changed.");
        return;
      }
    }
    const resultDefinitions = result.map(value => byId.get(value.id));
    const effectiveIds = new Set([...resultIds].filter(id => !resultDefinitions.some(definition => definition?.replacesId === id)));
    const effectiveCount = selectedImprovementSlotCost({ improvements: result }, allDefinitions);
    if (effectiveCount > maximum) {
      ui.notifications.warn(`This companion can have at most ${maximum} effective improvement slots at the Tamer's current level.`);
      return;
    }
    for (const value of result) {
      const definition = byId.get(value.id);
      if (!definition && unknownLegacySelections.some(([id]) => id === value.id)) continue;
      if (!definition || !CompanionOptions.isAvailable(definition, { tamer: this.tamer, companion: actor }) ||
          (definition.prerequisiteIds ?? []).some(prerequisite => !effectiveIds.has(prerequisite)) ||
          !hasRequiredImprovementReplacement(definition, resultIds, previouslySavedIds) ||
          (!definition.repeatable && value.count !== 1) ||
          value.count > (definition.maxSelections ?? maximum) ||
          !Number.isInteger(Number(definition.slotCost)) || Number(definition.slotCost) < 0) {
        ui.notifications.warn(`The selection for ${definition?.name ?? value.id} is no longer valid. No changes were saved.`);
        return;
      }
    }
    try {
      const latest = TamerRecords.read(this.tamer);
      if (!latest.some(item => item.id === recordId)) throw new Error("Companion relationship changed before saving.");
      const saved = await TamerRecords.write(this.tamer, latest.map(item => item.id === recordId
        ? { ...item, improvements: result }
        : item));
      if (!saved) throw new Error("Improvement selection did not persist.");
      const warnings = [];
      const toughenDefinitions = definitions.filter(definition =>
        String(definition.id ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") === "toughenup" ||
        String(definition.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") === "toughenup"
      );
      const toughenById = new Map(toughenDefinitions.map(definition => [definition.id, definition]));
      const toughenHistory = new Set(ToughenUpApplication.history(actor).map(entry => entry.applicationId));
      for (const selected of result) {
        const definition = toughenById.get(selected.id);
        if (!definition) continue;
        const count = Math.max(1, Math.floor(Number(selected.count ?? 1) || 1));
        for (let rank = 1; rank <= count; rank += 1) {
          const applicationId = this.tamer.uuid + "::" + actor.uuid + "::" + definition.id + "::rank-" + rank + "::toughen-up-v1";
          if (toughenHistory.has(applicationId)) continue;
          try {
            const application = await ToughenUpApplication.apply({ actor, applicationId });
            if (!application.applied || !application.verified) {
              warnings.push("Toughen Up rank " + rank + " needs attention (" + (application.reason ?? "application-not-verified") + ").");
            } else toughenHistory.add(applicationId);
          } catch (error) {
            console.error("Tamer Manager | Toughen Up application failed.", error);
            warnings.push("Toughen Up could not be applied completely. Reopen and save improvements to retry.");
          }
        }
      }
      try {
        const growth = await reconcileGrowthHitDie(actor, result, definitions);
        if (growth.warning) warnings.push(growth.warning);
      } catch (error) {
        console.error("Tamer Manager | Growth Hit Die reconciliation failed.", error);
        warnings.push("Growth Hit Die size could not be reconciled. Reopen and save improvements to retry.");
      }
      const sheetSync = await syncImprovementSheetItems(actor, result, definitions, allDefinitions);
      warnings.push(...sheetSync.warnings);
      if (warnings.length) {
        ui.notifications.warn("Selections saved, but some mechanics or sheet items need attention: " + warnings.join(" "));
      } else {
        ui.notifications.info("Companion improvements saved.");
      }
      await this.render({ force: true });
    } catch (error) {
      console.error("Tamer Manager | Improvement selection failed.", error);
      ui.notifications.error("Could not save improvements. The previous selections were preserved.");
    }
  }

  static async _onClearVessel(event, target) {
    const recordId = target?.dataset?.recordId;
    if (!recordId || !this.tamer) return;
    const records = TamerRecords.read(this.tamer);
    if (!records.some(item => item.id === recordId)) return;
    try {
      const saved = await TamerRecords.write(this.tamer, records.map(item => item.id === recordId
        ? { ...item, vesselUuid: null, vesselName: "" }
        : item));
      if (!saved) throw new Error("Vessel removal did not persist.");
      await this.render({ force: true });
    } catch (error) {
      console.error("Tamer Manager | Vessel removal failed.", error);
      ui.notifications.error("Could not remove the vessel assignment.");
    }
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

    if (record.status === "summoned" && !record.tokenUuid) {
      ui.notifications.warn("This companion is marked summoned but has no saved token reference. Refresh and reconcile the existing scene token before summoning again.");
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
      const updated = records.map(item => item.id === recordId
        ? { ...item, status: "in-vessel", tokenUuid: null }
        : item);
      try {
        const saved = await TamerRecords.write(this.tamer, updated);
        if (!saved) throw new Error("The companion storage state was not persisted.");
      } catch (error) {
        console.error("Tamer Manager | Could not save companion storage state.", error);
        ui.notifications.error("Could not save the storage state. The summoned token was left in place to avoid losing track of it.");
        return;
      }
      await scene.deleteEmbeddedDocuments("Token", [tokenDoc.id]);
      ui.notifications.info("Companion returned to storage.");
      await this.render({ force: true });
      return;
    }

    if (records.some(item => item.id !== recordId && item.actorUuid === record.actorUuid && item.status === "summoned")) {
      ui.notifications.warn("Another relationship already marks this companion Actor as summoned. Resolve the duplicate record before summoning again.");
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
      const saved = await TamerRecords.write(this.tamer, records.map(item => item.id === recordId
        ? { ...item, status: "summoned", tokenUuid: created.uuid }
        : item));
      if (!saved) throw new Error("The summoned companion state was not persisted.");
    } catch (error) {
      console.error("Tamer Manager | Could not save summoned companion state; removing newly created token.", error);
      try { await scene.deleteEmbeddedDocuments("Token", [created.id]); }
      catch (cleanupError) { console.error("Tamer Manager | Could not roll back orphaned companion token.", cleanupError); }
      ui.notifications.error("The summoned state could not be saved. The newly created token was rolled back where possible.");
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
