import { CompanionAccessContext } from "../scripts/data/companion-access-context.js";
import { CompanionAccessResolver } from "../scripts/data/companion-access-resolver.js";
import { CompanionProgression } from "../scripts/data/companion-progression.js";

if (!globalThis.foundry) {
  globalThis.foundry = { utils: { deepClone: value => structuredClone(value) } };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(callback, message) {
  let threw = false;
  try { callback(); } catch { threw = true; }
  assert(threw, message);
}

const testResults = [];

async function test(name, callback) {
  try {
    await callback();
    testResults.push({ name, passed: true });
  } catch (error) {
    testResults.push({ name, passed: false, error: String(error?.message ?? error) });
  }
}

await test("access context normalizes source data and unique permissions", () => {
  const context = CompanionAccessContext.create({
    ownerUuid: "Actor.owner",
    sources: [{
      id: "tamer-class",
      type: "class",
      documentUuid: "Actor.owner.Item.tamer",
      allowedOperations: ["open", "bond", "open"],
      progressionProviderIds: ["tamer", "tamer"],
      metadata: { level: 3 }
    }]
  });
  assert(context.allowedOperations.length === 2, "Expected duplicate operations to be removed.");
  assert(context.progressionProviderIds.length === 1, "Expected duplicate provider IDs to be removed.");
  assert(CompanionAccessContext.can(context, "bond"), "Expected bond permission.");
  assert(!CompanionAccessContext.can(context, "delete"), "Unexpected delete permission.");
});

await test("access context rejects invalid and duplicate source definitions", () => {
  assertThrows(() => CompanionAccessContext.create({
    ownerUuid: "Actor.owner",
    sources: [{ id: "bad", type: "unknown", documentUuid: "Item.bad", allowedOperations: [], progressionProviderIds: [] }]
  }), "Expected unknown source type to be rejected.");
  assertThrows(() => CompanionAccessContext.create({
    ownerUuid: "Actor.owner",
    sources: [
      { id: "same", type: "feat", documentUuid: "Item.a", allowedOperations: [], progressionProviderIds: [] },
      { id: "same", type: "feat", documentUuid: "Item.b", allowedOperations: [], progressionProviderIds: [] }
    ]
  }), "Expected duplicate source ID to be rejected.");
});

await test("access resolver combines independently validated sources", async () => {
  const result = await CompanionAccessResolver.resolve({
    owner: { uuid: "Actor.owner" },
    adapters: [{
      id: "tamer-class",
      resolve: async () => ({
        valid: true,
        source: {
          id: "tamer-class",
          type: "class",
          documentUuid: "Actor.owner.Item.tamer",
          allowedOperations: [CompanionAccessResolver.operations.OPEN_MANAGER],
          progressionProviderIds: ["tamer"],
          metadata: {}
        }
      })
    }]
  });
  assert(result.valid, "Expected valid access adapter to resolve.");
  assert(CompanionAccessContext.can(result.context, CompanionAccessResolver.operations.OPEN_MANAGER), "Expected manager permission.");
});

await test("access resolver rejects invalid adapter output", async () => {
  const result = await CompanionAccessResolver.resolve({
    owner: { uuid: "Actor.owner" },
    adapters: [{ id: "tamer-class", resolve: async () => ({ valid: true, source: { id: "wrong" } }) }]
  });
  assert(!result.valid && result.context === null, "Expected invalid adapter output to fail closed.");
});

await test("progression fails closed when provider is missing", async () => {
  const result = await CompanionProgression.resolveAll({ progressionProviderIds: ["tamer"] }, []);
  assert(!result.valid, "Expected missing provider to invalidate result.");
  assert(result.errors.length === 1, "Expected a missing-provider error.");
});

await test("progression accepts matching provider result", async () => {
  const provider = CompanionProgression.createProvider({
    id: "tamer",
    resolve: async () => ({ providerId: "tamer", valid: true, level: 3 })
  });
  const result = await CompanionProgression.resolveAll({ progressionProviderIds: ["tamer"] }, [provider]);
  assert(result.valid, "Expected matching provider result to be valid.");
  assert(result.results[0].level === 3, "Expected provider data to be returned.");
});

await test("progression rejects duplicate provider IDs", async () => {
  const provider = CompanionProgression.createProvider({
    id: "tamer",
    resolve: async () => ({ providerId: "tamer", valid: true })
  });
  const result = await CompanionProgression.resolveAll({ progressionProviderIds: ["tamer"] }, [provider, provider]);
  assert(!result.valid, "Expected duplicate providers to be rejected.");
});

const failed = testResults.filter(result => !result.passed);
const summary = {
  passed: testResults.length - failed.length,
  failed: failed.length,
  tests: testResults
};

globalThis.__TAMER_MANAGER_CONTRACT_TESTS__ = summary;
if (failed.length) throw new Error(JSON.stringify(summary));
