import { CompanionOptionStore } from "../scripts/data/companion-option-store.js";
import { CompanionOptionValidator } from "../scripts/data/companion-option-validator.js";
import { CompanionTreeStore } from "../scripts/data/companion-tree-store.js";
import { TamerRecords } from "../scripts/data/tamer-records.js";
import { CompanionRecord } from "../scripts/data/companion-record.js";
import { CompanionInitializationApplication } from "../scripts/data/companion-initialization-application.js";

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

const failed = results.filter(result => !result.passed);
globalThis.__TAMER_MANAGER_STORE_TESTS__ = { passed: results.length - failed.length, failed: failed.length, tests: results };
if (failed.length) throw new Error(JSON.stringify(globalThis.__TAMER_MANAGER_STORE_TESTS__));
