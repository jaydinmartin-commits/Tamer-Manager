import { readFileSync } from "node:fs";
import { CompanionOptionStore } from "../scripts/data/companion-option-store.js";
import { CompanionOptionValidator } from "../scripts/data/companion-option-validator.js";
import { CompanionTreeStore } from "../scripts/data/companion-tree-store.js";
import { TamerRecords } from "../scripts/data/tamer-records.js";
import { CompanionRecord } from "../scripts/data/companion-record.js";
import { CompanionInitializationApplication } from "../scripts/data/companion-initialization-application.js";
import { selectedImprovementSlotCost, additionalImprovementSlotCost, hasRequiredImprovementReplacement } from "../scripts/data/companion-improvement-cost.js";
import { selectedImprovementDisplay } from "../scripts/data/companion-improvement-display.js";
import { CompanionOptionDefinition } from "../scripts/data/companion-option-definition.js";
import { CompanionOptions } from "../scripts/data/companion-options.js";
import { TamerCompanionSummary } from "../scripts/data/tamer-companion-summary.js";
import { reconcileGrowthHitDie, syncImprovementSheetItems } from "../scripts/data/companion-improvement-sheet-sync.js";

if (!globalThis.foundry) globalThis.foundry = { utils: { deepClone: value => structuredClone(value) } };

const settings = new Map();
const settingRegistry = new Set(["tamer-manager.companionOptions", "tamer-manager.companionTrees"]);
globalThis.game = {
  user: { isGM: true },
  settings: {
    settings: { has: key => settingRegistry.has(key) },
    get: (scope, key) => structuredClone(settings.get(`${scope}.${key}`)),
    set: async (scope, key, value) => {
      const full = `${scope}.${key}`;
      if (game.__failNextSettingWrite) {
        game.__failNextSettingWrite = false;
        throw new Error("injected setting write failure");
      }
      settings.set(full, structuredClone(value));
      return structuredClone(value);
    }
  },
  __failNextSettingWrite: false
};

function assert(condition, message) { if (!condition) throw new Error(message); }
function assertThrows(callback, message) {
  let threw = false;
  try { callback(); } catch { threw = true; }
  assert(threw, message);
}
async function assertRejects(callback, message) {
  let threw = false;
  try { await callback(); } catch { threw = true; }
  assert(threw, message);
}
const results = [];
async function test(name, callback) {
  try { await callback(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: String(error?.message ?? error) }); }
}
const option = (id, extra = {}) => ({
  id, type: "improvement", name: id, sourceUuid: null,
  requirements: { tamerLevel: 1, companionIdentifiers: [] },
  repeatable: false, maxSelections: null, slotCost: 1, pointCost: 0,
  prerequisiteIds: [], replacesId: null, treeId: null, metadata: {}, ...extra
});

await test("D&D 5e size abbreviations normalize for Tamer eligibility", () => {
  const aliases = [
    ["Tiny", "tiny"], ["SM", "small"], ["Med", "medium"],
    ["LG", "large"], ["Huge", "huge"], ["GRG", "gargantuan"]
  ];
  for (const [input, expected] of aliases) {
    assert(TamerCompanionSummary.sizeRank(input) === TamerCompanionSummary.sizeRank(expected),
      `Size alias ${input} should normalize to ${expected}.`);
  }
  assert(TamerCompanionSummary.sizeRank("not-a-size") === -1,
    "Unknown size codes must remain invalid rather than being guessed.");

  const tamer = { items: [{ type: "class", name: "Tamer", system: { levels: 10 } }] };
  const wolf = { name: "Wolf", system: { traits: { size: "sm" }, details: { cr: 0.25 } } };
  const result = TamerCompanionSummary.canTame(tamer, wolf);
  assert(result.eligible === true,
    "A valid D&D 5e small-size abbreviation must not reject an otherwise eligible wolf.");
});

await test("improvement slot accounting honors costs, repeatable ranks, and replacements", () => {
  const definitions = [
    option("growth-i", { slotCost: 1 }),
    option("growth-ii", { slotCost: 2, replacesId: "growth-i" }),
    option("toughen-up", { slotCost: 1, repeatable: true, maxSelections: 4 })
  ];
  assert(selectedImprovementSlotCost({ improvements: [{ id: "growth-ii", count: 1 }, { id: "growth-i", count: 1 }] }, definitions) === 2,
    "An upgrade should replace the lower-tier cost instead of stacking both.");
  assert(selectedImprovementSlotCost({ improvements: [{ id: "growth-ii", count: 1 }] }, definitions) === 2,
    "A saved upgrade without its replacement target must still consume its full configured cost.");
  assert(selectedImprovementSlotCost({ improvements: [{ id: "toughen-up", count: 3 }] }, definitions) === 3,
    "Repeatable rank count should multiply the configured slot cost.");
  assert(selectedImprovementSlotCost({ improvements: ["growth-i", { id: "toughen-up", rank: 2 }] }, definitions) === 3,
    "Legacy string selections and rank-form repeatable counts should be accounted for.");
  assert(selectedImprovementSlotCost({ improvements: [{ id: "removed-definition", count: 2 }] }, definitions) === 0,
    "Unknown legacy definitions must not have a guessed slot cost.");
  assert(selectedImprovementSlotCost({ improvements: [{ id: "toughen-up", count: Number.NaN }] }, definitions) === 1,
    "A corrupt non-finite saved rank must not make the total NaN.");
  assert(selectedImprovementSlotCost({ improvements: [{ id: "toughen-up", count: 2.8 }] }, definitions) === 2,
    "Fractional persisted ranks must be normalized to whole ranks.");
  assert(selectedImprovementSlotCost({ improvements: [{ id: "growth-ii", count: 1 }, { id: "growth-i", count: 1 }, { id: "toughen-up", count: 1 }] }, definitions) === 3,
    "Replacing a lower-tier improvement must not discount unrelated selected improvements.");
  assert(selectedImprovementSlotCost({ improvements: [{ id: "free-choice", count: 3 }] }, [option("free-choice", { slotCost: 0, repeatable: true, maxSelections: 4 })]) === 0,
    "A valid zero-slot improvement must not consume slots.");
  assert(selectedImprovementSlotCost({ improvements: [{ id: "bonded-grant", count: 1 }, { id: "growth-i", count: 1 }] }, [
    option("bonded-grant", { slotCost: 0, grantOnTaming: true }),
    option("growth-i", { slotCost: 1 })
  ]) === 1, "An automatic taming grant must not consume improvement slots.");
  assert(additionalImprovementSlotCost(2, 1) === 1,
    "An upgrade should consume only the difference between its cost and the replaced improvement.");
  assert(additionalImprovementSlotCost(1, 2) === 0,
    "A replacement credit larger than the new cost must not create negative slot usage.");
  assert(additionalImprovementSlotCost(2, 0) === 2,
    "An improvement without a replacement should consume its full configured cost.");
  const selectedUpgrade = option("growth-ii", { slotCost: 2, replacesId: "growth-i" });
  assert(hasRequiredImprovementReplacement(selectedUpgrade, new Set(["growth-i"]), new Set()),
    "A newly selected upgrade must have its replacement selected.");
  assert(!hasRequiredImprovementReplacement(selectedUpgrade, new Set(), new Set()),
    "A newly selected upgrade without its replacement must be rejected.");
  assert(hasRequiredImprovementReplacement(selectedUpgrade, new Set(), new Set(["growth-ii"])),
    "A previously saved upgrade must remain valid if its replaced selection is absent.");
});

await test("selected improvement display resolves names, repeatable ranks, upgrades, and missing definitions", () => {
  const definitions = [
    option("growth-i", { name: "Growth I", slotCost: 1 }),
    option("growth-ii", { name: "Growth II", slotCost: 2, replacesId: "growth-i" }),
    option("toughen-up", { name: "Toughen Up", repeatable: true, maxSelections: 4 })
  ];
  const result = selectedImprovementDisplay({
    improvements: [
      { id: "growth-i", count: 1 },
      { id: "growth-ii", count: 1 },
      { id: "toughen-up", count: 3 },
      { id: "missing-old-option", count: 2 }
    ]
  }, definitions);
  assert(result.some(item => item.label === "Growth II"), "Configured selected improvements should display their configured names.");
  assert(!result.some(item => item.id === "growth-i"), "An improvement replaced by a selected upgrade should not be displayed as active.");
  assert(result.some(item => item.label === "Toughen Up ×3"), "Repeatable improvement ranks should be clear on the card.");
  assert(result.some(item => item.missingDefinition && item.label === "missing-old-option (definition missing)"), "Legacy selections without definitions must remain visible instead of being silently hidden.");
  const strings = selectedImprovementDisplay({ improvements: ["growth-i"] }, definitions);
  assert(strings.some(item => item.label === "Growth I"), "Legacy string-format selections must display.");
});

await test("companion record round-trip preserves vessel, summon, improvement, and splicer state", () => {
  const input = {
    id: "round-trip", name: "Test Companion", actorUuid: "Actor.companion",
    vesselUuid: "Actor.tamer.Item.vessel", vesselName: "Pocket Vessel",
    tokenUuid: "Scene.scene.Token.token", status: "summoned",
    improvements: ["growth", { id: "keen-senses", rank: 2 }],
    splicer: { augments: [{ id: "fire" }], pendingAugments: [{ id: "water" }] }
  };
  const normalized = CompanionRecord.normalize(input);
  assert(normalized.vesselUuid === input.vesselUuid && normalized.vesselName === input.vesselName,
    "Vessel assignment should survive normalization.");
  assert(normalized.tokenUuid === input.tokenUuid && normalized.status === "summoned",
    "Summoned token state should survive normalization.");
  assert(normalized.improvements.length === 2 && normalized.improvements[1].rank === 2,
    "Saved improvement selections should survive normalization.");
  assert(normalized.splicer.augments[0].id === "fire" && normalized.splicer.pendingAugments[0].id === "water",
    "Splicer augments and pending augments should survive normalization.");
  const second = CompanionRecord.normalize(normalized);
  assert(JSON.stringify(second) === JSON.stringify(normalized), "Record normalization should be idempotent.");
});

settings.set("tamer-manager.companionOptions", { schemaVersion: 1, definitions: [] });
settings.set("tamer-manager.companionTrees", { schemaVersion: 1, trees: [] });

await test("option validator rejects duplicate IDs and dangling prerequisites", () => {
  const result = CompanionOptionValidator.validate([option("a"), option("a"), option("b", { prerequisiteIds: ["missing"] })]);
  assert(!result.valid, "Invalid definitions should be rejected.");
  assert(result.errors.some(error => error.includes("Duplicate")), "Duplicate IDs should be reported.");
  assert(result.errors.some(error => error.includes("missing prerequisite")), "Dangling prerequisites should be reported.");
});

await test("companion record preserves repeatable improvement rank counts", () => {
  const normalized = CompanionRecord.normalize({
    id: "ranked", name: "Ranked Companion", actorUuid: "Actor.ranked",
    improvements: [{ id: "toughen-up", count: 3 }, { id: "growth", rank: 2 }]
  });
  assert(normalized.improvements[0].count === 3, "Explicit repeatable count should survive normalization.");
  assert(normalized.improvements[1].rank === 2, "Legacy rank representation should survive normalization.");
  const again = CompanionRecord.normalize(normalized);
  assert(again.improvements[0].count === 3, "Repeated normalization must preserve repeatable counts.");
});

await test("option validator enforces repeatability and replacement definitions", () => {
  const invalidRepeat = CompanionOptionValidator.validate([
    option("single", { repeatable: false, maxSelections: 2 })
  ]);
  assert(!invalidRepeat.valid && invalidRepeat.errors.some(error => error.includes("maxSelections")),
    "Non-repeatable option must not permit multiple selections.");
  const invalidReplace = CompanionOptionValidator.validate([
    option("base"),
    option("upgrade", { replacesId: "missing" })
  ]);
  assert(!invalidReplace.valid && invalidReplace.errors.some(error => error.includes("replacement target")),
    "Missing replacement target must be rejected.");
  const valid = CompanionOptionValidator.validate([
    option("base"),
    option("upgrade", { replacesId: "base" })
  ]);
  assert(valid.valid, "A valid replacement chain should pass validation.");
});

await test("option validator rejects prerequisite cycles", () => {
  const result = CompanionOptionValidator.validate([
    option("a", { prerequisiteIds: ["b"] }), option("b", { prerequisiteIds: ["a"] })
  ]);
  assert(!result.valid && result.errors.some(error => error.includes("cycle")), "Prerequisite cycle should be rejected.");
});

await test("option store round-trips valid definitions", async () => {
  await CompanionOptionStore.write([option("steady")]);
  assert(CompanionOptionStore.get("steady")?.name === "steady", "Stored definition did not round-trip.");
});

await test("option store preserves unrecognized extension fields", async () => {
  const extended = { ...option("extended"), vendorExtension: { preserved: true, version: 2 } };
  await CompanionOptionStore.write([extended]);
  const stored = CompanionOptionStore.get("extended");
  assert(stored?.vendorExtension?.preserved === true && stored.vendorExtension.version === 2,
    "Unknown extension data was silently discarded.");
  await CompanionOptionStore.write([stored]);
  assert(CompanionOptionStore.get("extended")?.vendorExtension?.version === 2,
    "Extension data was lost during a read/write cycle.");
  await CompanionOptionStore.write([option("steady")]);
});

await test("option store refuses to silently drop malformed records", async () => {
  await assertRejects(() => CompanionOptionStore.write([option("safe"), { nope: true }]),
    "Malformed option record should reject the whole write.");
  assert(CompanionOptionStore.get("steady")?.name === "steady", "Rejected write changed existing store.");
});

await test("option store rejects invalid numeric values before normalization", async () => {
  await assertRejects(() => CompanionOptionStore.write([option("bad-cost", { slotCost: -1 })]),
    "Negative slot cost should be rejected.");
  await assertRejects(() => CompanionOptionStore.write([option("bad-level", { requirements: { tamerLevel: 99, companionIdentifiers: [] } })]),
    "Out-of-range Tamer level should be rejected.");
});

await test("unknown future schema versions are preserved and never overwritten", async () => {
  const future = { schemaVersion: 99, definitions: [{ id: "future", vendorField: { keep: true } }] };
  settings.set("tamer-manager.companionOptions", future);
  assertThrows(() => CompanionOptionStore.read(), "Future schema should fail closed.");
  await assertRejects(() => CompanionOptionStore.write([option("overwrite")]), "Write must not overwrite unknown schema.");
  assert(settings.get("tamer-manager.companionOptions").schemaVersion === 99, "Future schema was overwritten.");
  settings.set("tamer-manager.companionOptions", { schemaVersion: 1, definitions: [option("steady")] });
});

await test("failed setting write leaves prior option store intact", async () => {
  const before = JSON.stringify(CompanionOptionStore.read());
  game.__failNextSettingWrite = true;
  await assertRejects(() => CompanionOptionStore.write([option("new")]), "Injected write should reject.");
  assert(JSON.stringify(CompanionOptionStore.read()) === before, "Failed write changed stored data.");
});

await test("orphaned option tree references remain editable and can be recovered", async () => {
  await CompanionOptionStore.write([option("orphaned-tree-option", { treeId: "bespoke-missing" })]);
  assert(CompanionOptionStore.get("orphaned-tree-option")?.treeId === "bespoke-missing",
    "An option with a missing tree must remain readable and editable.");
  assert(CompanionTreeStore.list().length === 0,
    "A missing tree reference must not prevent opening the tree manager.");
  await CompanionTreeStore.write([{ id: "bespoke-missing", name: "Recovered Bespoke Tree", description: "" }]);
  assert(CompanionTreeStore.get("bespoke-missing")?.name === "Recovered Bespoke Tree",
    "The missing tree should be recreatable using its referenced ID.");
  await CompanionOptionStore.write([option("orphaned-tree-option")]);
  await CompanionTreeStore.remove("bespoke-missing");
});

await test("tree store rejects missing tree references and blocks referenced deletion", async () => {
  await CompanionTreeStore.write([{ id: "core", name: "Core", description: "" }]);
  await CompanionOptionStore.write([option("tree-option", { treeId: "core" })]);
  await assertRejects(() => CompanionTreeStore.remove("core"), "Referenced tree deletion should be blocked.");
  assert(CompanionTreeStore.get("core"), "Referenced tree should remain stored.");
  await assertRejects(() => CompanionTreeStore.write([]), "Tree removal while referenced should be rejected.");
  await CompanionOptionStore.write([option("tree-option")]);
  await CompanionTreeStore.remove("core");
  assert(!CompanionTreeStore.get("core"), "Unreferenced tree should be removable.");
});

await test("tree writes require GM permissions", async () => {
  game.user.isGM = false;
  await assertRejects(() => CompanionTreeStore.write([{ id: "nope", name: "Nope", description: "" }]),
    "Non-GM tree write should reject.");
  game.user.isGM = true;
});

await test("malformed tree store is not normalized into empty data", () => {
  assertThrows(() => CompanionTreeStore.migrate({ schemaVersion: 1, trees: [{ vendorField: true }] }),
    "Malformed tree must be rejected.");
});



await test("unlink removes only the relationship and reports failed persistence", async () => {
  const flags = { "tamer-manager.companions": [
    { id: "relationship-1", name: "Training Dummy", actorUuid: "Actor.dummy" }
  ] };
  let failWrite = false;
  const actor = {
    uuid: "Actor.tamer",
    items: [{ type: "class", name: "Tamer", system: { identifier: "tamer", levels: 3 } }],
    getFlag: (scope, key) => flags[`${scope}.${key}`],
    setFlag: async (scope, key, value) => {
      if (failWrite) { failWrite = false; throw new Error("injected unlink failure"); }
      flags[`${scope}.${key}`] = structuredClone(value);
    }
  };
  const removedActor = { uuid: "Actor.dummy", deleted: false };
  failWrite = true;
  await assertRejects(() => TamerRecords.remove(actor, "relationship-1"),
    "Failed unlink persistence must be reported.");
  assert(TamerRecords.read(actor).length === 1, "Failed unlink must preserve the saved relationship.");
  const removed = await TamerRecords.remove(actor, "relationship-1");
  assert(removed, "Expected unlink to succeed on retry.");
  assert(TamerRecords.read(actor).length === 0, "Successful unlink should remove the relationship.");
  assert(removedActor.deleted === false, "Unlink must not delete the companion Actor.");
});

await test("missing Actor references remain visible in relationship data", () => {
  const flags = { "tamer-manager.companions": [
    { id: "missing-relationship", name: "Lost Companion", actorUuid: "Actor.no-longer-exists" }
  ] };
  const actor = {
    uuid: "Actor.tamer",
    items: [{ type: "class", name: "Tamer", system: { identifier: "tamer", levels: 3 } }],
    getFlag: (scope, key) => flags[`${scope}.${key}`]
  };
  const records = TamerRecords.read(actor);
  assert(records.length === 1 && records[0].actorUuid === "Actor.no-longer-exists",
    "Missing Actor lookup must not erase the relationship reference.");
});

await test("initialization recovery repairs a failed relationship write without reapplying mechanics", async () => {
  const tamerFlags = {};
  let failRelationshipWrite = true;
  const tamer = {
    uuid: "Actor.tamer", system: { attributes: { prof: 2 } },
    items: [{ uuid: "Actor.tamer.Item.tamer", type: "class", name: "Tamer", system: { identifier: "tamer", levels: 3 } }],
    getFlag: (scope, key) => tamerFlags[`${scope}.${key}`],
    setFlag: async (scope, key, value) => {
      if (failRelationshipWrite) { failRelationshipWrite = false; throw new Error("injected relationship write failure"); }
      tamerFlags[`${scope}.${key}`] = structuredClone(value);
    }
  };
  const companionFlags = {};
  const companion = {
    uuid: "Actor.companion", name: "Companion", type: "npc",
    system: { details: { cr: 0.5 }, traits: { size: "tiny" },
      attributes: { hd: { denomination: 8, max: 1 }, hp: { value: 6, max: 10, formula: "1d8+2" } },
      abilities: { con: { mod: 2 } } },
    getFlag: (scope, key) => companionFlags[`${scope}.${key}`],
    setFlag: async (scope, key, value) => { companionFlags[`${scope}.${key}`] = structuredClone(value); },
    update: async changes => {
      for (const [path, value] of Object.entries(changes)) {
        if (path.startsWith("system.")) {
          const keys = path.split("."); let target = companion;
          for (const key of keys.slice(0, -1)) target = target[key] ??= {};
          target[keys[keys.length - 1]] = value;
        } else if (path.startsWith("flags.")) companionFlags[path.slice(6)] = structuredClone(value);
      }
    }
  };
  const oldRoll = globalThis.Roll;
  const oldRandomID = globalThis.foundry.utils.randomID;
  let generatedId = 0;
  globalThis.foundry.utils.randomID = () => `test-record-${++generatedId}`;
  globalThis.Roll = class { constructor(formula) { this.formula = formula; } async evaluate() { return { total: 4 }; } };
  try {
    const applicationId = `${tamer.uuid}::${companion.uuid}::initialization-v1`;
    const initialization = await CompanionInitializationApplication.apply({
      owner: tamer, companion, applicationId,
      plan: { eligible: true, training: { hitDice: 1 } }
    });
    assert(initialization.applied && initialization.verified, `Fixture initialization should commit; got ${JSON.stringify(initialization)}.`);
    const hitDiceAfterFirst = companion.system.attributes.hd.max;
    failRelationshipWrite = true;
    const first = await TamerRecords.add(tamer, companion);
    assert(!first.record && first.reason === "companion-record-persistence-failed", `First recovery attempt should report relationship write failure; got ${JSON.stringify(first)}.`);
    assert(TamerRecords.read(tamer).length === 0, "Failed write must not claim a saved relationship.");
    assert((companionFlags["tamer-manager.companionInitializationApplications"] ?? []).length === 1, "Initialization ledger should be committed.");
    const second = await TamerRecords.add(tamer, companion);
    assert(second.record && second.initialization?.recovered, "Retry should recover the relationship from the ledger.");
    assert(companion.system.attributes.hd.max === hitDiceAfterFirst, "Recovery must not grant hit dice twice.");
    assert(TamerRecords.read(tamer).length === 1, "Recovery should create exactly one relationship.");
    const third = await TamerRecords.add(tamer, companion);
    assert(third.record?.id === second.record.id, "Repeated add should return the existing relationship.");
    assert(companion.system.attributes.hd.max === hitDiceAfterFirst, "Repeated add must remain idempotent.");
  } finally {
    if (oldRoll === undefined) delete globalThis.Roll; else globalThis.Roll = oldRoll;
    if (oldRandomID === undefined) delete globalThis.foundry.utils.randomID; else globalThis.foundry.utils.randomID = oldRandomID;
  }
});

await test("native companion picker scopes source filtering through a composable wrapper and restores fallback state", () => {
  const source = readFileSync(new URL("../scripts/tamer-manager.js", import.meta.url), "utf8");
  assert(source.includes("CompendiumBrowser.selectOne({"),
    "Add Companion must use the native D&D 5e Compendium Browser.");
  assert(source.includes("dnd5e.applications.settings.CompendiumBrowserSettingsConfig.collateSources"),
    "The wrapper must target the dnd5e v6 source-collation API, not replace CompendiumBrowser.fetch.");
  assert(source.includes("libWrapper.register(") && source.includes('"WRAPPER"'),
    "The source filter must register as a composable libWrapper wrapper when libWrapper is available.");
  assert(source.includes("function(wrapped, ...args)") && source.includes("const nativeSources = [...wrapped(...args)]"),
    "The wrapper must call the wrapped native method with its original arguments and preserve its sources.");
  assert(source.includes("if (!activeAllowedCollections) return new Set(nativeSources)"),
    "The wrapper must leave native sources unchanged outside an active companion picker.");
  assert(source.includes("return new Set([...itemSources, ...activeAllowedCollections])"),
    "The configured Actor allowlist must be combined with normal non-Actor browser sources.");
  assert(source.includes("CompendiumBrowserSettingsConfig.collateSources = function(...args)"),
    "Worlds without libWrapper must use the scoped source-collation fallback.");
  assert(source.includes("if (!useLibWrapper) CompendiumBrowserSettingsConfig.collateSources = originalCollateSources"),
    "The fallback source-collation method must be restored after selection or cancellation.");
  assert(source.includes("activeAllowedCollections = null") && source.includes("companionPickerActive = false"),
    "Picker state must be cleared after selection or cancellation.");
  assert(source.includes('uuid.startsWith(`Compendium.${name}.`)'),
    "The selected Actor UUID must still be checked against the configured collections.");
});



await test("option display flags default safely for legacy definitions", () => {
  const normalized = CompanionOptionDefinition.normalize(option("legacy-display"));
  assert(normalized.displayOnManager === true, "Legacy options should remain visible on the manager card by default.");
  assert(normalized.displayOnSheet === false, "Legacy options should not be copied to companion sheets without an explicit opt-in.");
});

await test("growth hit die reconciliation is reversible and idempotent", async () => {
  const flags = {};
  const actor = {
    system: { attributes: { hd: { denomination: 6 } } },
    getFlag(scope, key) { return flags[scope]?.[key]; },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key === "system.attributes.hd.denomination") this.system.attributes.hd.denomination = value;
        else if (key === "flags.tamer-manager.growthHitDieState") {
          flags["tamer-manager"] ??= {};
          flags["tamer-manager"].growthHitDieState = structuredClone(value);
        } else if (key === "flags.tamer-manager.-=growthHitDieState") {
          if (flags["tamer-manager"]) delete flags["tamer-manager"].growthHitDieState;
        }
      }
    },
    async unsetFlag(scope, key) { if (flags[scope]) delete flags[scope][key]; }
  };
  const definitions = [
    option("growth-i", { treeId: "tree-a" }),
    option("growth-ii", { treeId: "tree-a" }),
    option("growth-iii", { treeId: "tree-a" }),
    option("growth-iv", { treeId: "tree-a" })
  ];
  const first = await reconcileGrowthHitDie(actor, [{ id: "growth-ii", count: 1 }], definitions);
  assert(first.changed && actor.system.attributes.hd.denomination === 8, "Growth II should set the Hit Die denomination to d8.");
  const upgraded = await reconcileGrowthHitDie(actor, [{ id: "growth-iii", count: 1 }], definitions);
  assert(upgraded.changed && actor.system.attributes.hd.denomination === 10, "Growth III should upgrade the Hit Die denomination to d10.");
  const repeated = await reconcileGrowthHitDie(actor, [{ id: "growth-iii", count: 1 }], definitions);
  assert(!repeated.changed && actor.system.attributes.hd.denomination === 10, "Saving the same Growth selection twice should not reapply or lose the original denomination.");
  const removed = await reconcileGrowthHitDie(actor, [], definitions);
  assert(removed.changed && actor.system.attributes.hd.denomination === 6, "Removing Growth should restore the original Hit Die denomination.");
});

await test("known but ineligible bespoke improvements are not retained on the companion sheet", async () => {
  const deleted = [];
  const managedItem = {
    id: "managed-growth",
    getFlag(scope, key) {
      if (scope === "tamer-manager" && key === "managedImprovementId") return "growth-i";
      return undefined;
    }
  };
  const actor = {
    items: [managedItem],
    async deleteEmbeddedDocuments(type, ids) {
      assert(type === "Item", "Only Item documents should be deleted.");
      deleted.push(...ids);
    }
  };
  const globalDefinitions = [{ id: "growth-i", name: "Growth I", type: "improvement", treeId: "bespoke-tree", displayOnSheet: true }];
  const result = await syncImprovementSheetItems(actor, [{ id: "growth-i", count: 1 }], [], globalDefinitions);
  assert(deleted.includes("managed-growth"), "A known improvement that is no longer eligible must be removed from module-managed sheet display.");
  assert(result.warnings.length === 0, "A known but ineligible improvement should not be misreported as a missing legacy definition.");
});

await test("bespoke tree eligibility requires the configured companion identifier to match", () => {
  settings.set("tamer-manager.companionTrees", {
    schemaVersion: 1,
    trees: [{ id: "blue-beetle-tree", name: "Blue Beetle", description: "", companionIdentifier: "khaji-da" }]
  });
  settings.set("tamer-manager.companionOptions", {
    schemaVersion: 1,
    definitions: [
      option("toughen-up", { name: "Toughen Up", treeId: null }),
      option("growth-i", { name: "Growth I", treeId: "blue-beetle-tree" }),
      option("growth-ii", { name: "Growth II", treeId: "blue-beetle-tree", requirements: { tamerLevel: 1, companionIdentifiers: ["different-companion"] } })
    ]
  });
  const khajiDa = { system: { identifier: "khaji-da" } };
  const otherCompanion = { system: { identifier: "other-companion" } };
  const forKhajiDa = CompanionOptions.byType("improvement", { companion: khajiDa }).map(item => item.id);
  const forOther = CompanionOptions.byType("improvement", { companion: otherCompanion }).map(item => item.id);
  assert(forKhajiDa.includes("growth-i"), "A matching bespoke companion should receive its configured tree improvements.");
  assert(!forKhajiDa.includes("growth-ii"), "An option-level companion restriction should further narrow the tree's eligibility.");
  assert(!forOther.includes("growth-i") && !forOther.includes("growth-ii"), "A mismatched bespoke companion must not receive another tree's improvements.");
  assert(forOther.includes("toughen-up"), "Universal improvements remain available when the bespoke tree does not match.");
});

await test("tree store round-trips explicit companion identifiers", async () => {
  settings.set("tamer-manager.companionOptions", { schemaVersion: 1, definitions: [] });
  settings.set("tamer-manager.companionTrees", { schemaVersion: 1, trees: [] });
  await CompanionTreeStore.upsert({
    id: "blue-beetle-tree",
    name: "Blue Beetle",
    description: "Bespoke tree",
    companionIdentifier: "khaji-da"
  });
  const saved = CompanionTreeStore.get("blue-beetle-tree");
  assert(saved?.companionIdentifier === "khaji-da", "Saving a tree must preserve its companion identifier for eligibility filtering.");
});

await test("bespoke tree eligibility can match an NPC Actor by its name slug", () => {
  settings.set("tamer-manager.companionTrees", {
    schemaVersion: 1,
    trees: [{ id: "blue-beetle-tree", name: "Blue Beetle", description: "", companionIdentifier: "khaji-da" }]
  });
  settings.set("tamer-manager.companionOptions", {
    schemaVersion: 1,
    definitions: [option("growth-i", { name: "Growth I", treeId: "blue-beetle-tree" })]
  });
  const actorWithoutIdentifier = { name: "Khaji Da", system: { details: {} } };
  assert(CompanionOptions.byType("improvement", { companion: actorWithoutIdentifier }).some(item => item.id === "growth-i"),
    "A dnd5e NPC Actor without a dedicated system identifier should match through its normalized name slug.");
});

await test("name-slug fallback normalizes whitespace without Foundry string extensions", () => {
  const original = String.prototype.slugify;
  try {
    delete String.prototype.slugify;
    settings.set("tamer-manager.companionTrees", {
      schemaVersion: 1,
      trees: [{ id: "blue-beetle-tree", name: "Blue Beetle", description: "", companionIdentifier: "khaji-da" }]
    });
    settings.set("tamer-manager.companionOptions", {
      schemaVersion: 1,
      definitions: [option("growth-i", { name: "Growth I", treeId: "blue-beetle-tree" })]
    });
    const actorWithoutIdentifier = { name: "Khaji Da", system: { details: {} } };
    assert(CompanionOptions.byType("improvement", { companion: actorWithoutIdentifier }).some(item => item.id === "growth-i"),
      "The fallback must normalize spaces to hyphens when Foundry's slugify extension is unavailable.");
  } finally {
    if (original) String.prototype.slugify = original;
  }
});

await test("tree upsert preserves companion identifier on partial update", async () => {
  settings.set("tamer-manager.companionOptions", { schemaVersion: 1, definitions: [] });
  settings.set("tamer-manager.companionTrees", { schemaVersion: 1, trees: [] });
  await CompanionTreeStore.upsert({
    id: "blue-beetle-tree",
    name: "Blue Beetle",
    description: "Bespoke tree",
    companionIdentifier: "khaji-da"
  });
  await CompanionTreeStore.upsert({
    id: "blue-beetle-tree",
    name: "Blue Beetle Revised",
    description: "Updated description"
  });
  const saved = CompanionTreeStore.get("blue-beetle-tree");
  assert(saved?.companionIdentifier === "khaji-da", "A partial tree update must preserve its companion identifier.");
  assert(saved?.name === "Blue Beetle Revised", "The update must still save fields that were supplied.");
});

const failed = results.filter(result => !result.passed);
globalThis.__TAMER_MANAGER_STORE_TESTS__ = { passed: results.length - failed.length, failed: failed.length, tests: results };
if (failed.length) throw new Error(JSON.stringify(globalThis.__TAMER_MANAGER_STORE_TESTS__));
