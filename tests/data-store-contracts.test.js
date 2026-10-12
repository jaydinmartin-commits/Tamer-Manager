import { CompanionOptionStore } from "../scripts/data/companion-option-store.js";
import { CompanionOptionValidator } from "../scripts/data/companion-option-validator.js";
import { CompanionTreeStore } from "../scripts/data/companion-tree-store.js";
import { TamerRecords } from "../scripts/data/tamer-records.js";

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



const failed = results.filter(result => !result.passed);
globalThis.__TAMER_MANAGER_STORE_TESTS__ = { passed: results.length - failed.length, failed: failed.length, tests: results };
if (failed.length) throw new Error(JSON.stringify(globalThis.__TAMER_MANAGER_STORE_TESTS__));
