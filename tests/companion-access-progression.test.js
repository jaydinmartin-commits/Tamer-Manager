import { CompanionAccessContext } from "../scripts/data/companion-access-context.js";
import { CompanionAccessResolver } from "../scripts/data/companion-access-resolver.js";
import { CompanionProgression } from "../scripts/data/companion-progression.js";
import { CompanionAccessAdapters } from "../scripts/data/companion-access-adapters.js";
import { TamerAccessPreview } from "../scripts/data/tamer-access-preview.js";
import { TamerCompanionSummary } from "../scripts/data/tamer-companion-summary.js";
import { TamerProgressionProvider } from "../scripts/data/tamer-progression-provider.js";
import { CompanionInitialization } from "../scripts/data/companion-initialization.js";

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
      progressionProviderIds: ["tamer-class", "tamer-class"],
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
          progressionProviderIds: ["tamer-class"],
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
  const result = await CompanionProgression.resolveAll({ progressionProviderIds: ["tamer-class"] }, []);
  assert(!result.valid, "Expected missing provider to invalidate result.");
  assert(result.errors.length === 1, "Expected a missing-provider error.");
});

await test("progression accepts matching provider result", async () => {
  const provider = CompanionProgression.createProvider({
    id: "tamer-class",
    resolve: async () => ({ providerId: "tamer-class", valid: true, level: 3 })
  });
  const result = await CompanionProgression.resolveAll({ progressionProviderIds: ["tamer-class"] }, [provider]);
  assert(result.valid, "Expected matching provider result to be valid.");
  assert(result.results[0].level === 3, "Expected provider data to be returned.");
});

await test("progression rejects duplicate provider IDs", async () => {
  const provider = CompanionProgression.createProvider({
    id: "tamer-class",
    resolve: async () => ({ providerId: "tamer-class", valid: true })
  });
  const result = await CompanionProgression.resolveAll({ progressionProviderIds: ["tamer-class"] }, [provider, provider]);
  assert(!result.valid, "Expected duplicate providers to be rejected.");
});

await test("actual Tamer adapter uses the shared progression provider ID", async () => {
  const owner = {
    uuid: "Actor.owner",
    items: [{
      uuid: "Actor.owner.Item.tamer",
      type: "class",
      name: "Tamer",
      system: { identifier: "tamer", levels: 3 }
    }]
  };
  const adapter = CompanionAccessAdapters.tamerClass(owner);
  const result = await adapter.resolve();
  assert(result.valid, "Expected actual Tamer adapter to resolve.");
  assert(result.source.progressionProviderIds.length === 1, "Expected one progression provider.");
  assert(result.source.progressionProviderIds[0] === "tamer-class", "Tamer adapter provider ID mismatch.");
});

await test("Tamer preview does not fabricate progression for invalid class levels", async () => {
  const owner = {
    uuid: "Actor.owner",
    items: [{
      uuid: "Actor.owner.Item.tamer",
      type: "class",
      name: "Tamer",
      system: { identifier: "tamer", levels: 0 }
    }]
  };
  const result = await TamerAccessPreview.resolve(owner);
  assert(result.valid && result.eligible, "Access source should resolve independently of invalid progression.");
  assert(result.progression === null, "Invalid level must not yield progression.");
  assert(result.reason === "invalid-tamer-level", "Expected explicit invalid-level reason.");
});

await test("shared Tamer progression provider resolves only valid levels", async () => {
  const context = {
    progressionProviderIds: ["tamer-class"],
    sources: [{
      id: "tamer-class",
      type: "class",
      documentUuid: "Actor.owner.Item.tamer",
      metadata: { classLevel: 3 }
    }]
  };
  const result = await CompanionProgression.resolveAll(context, [TamerProgressionProvider]);
  assert(result.valid, "Expected shared Tamer provider to resolve.");
  assert(result.results[0].level === 3, "Expected provider to use source metadata level.");
  const invalid = await TamerProgressionProvider.resolve({
    sources: [{ ...context.sources[0], metadata: { classLevel: 0 } }]
  });
  assert(!invalid.valid && invalid.reason === "invalid-tamer-level", "Invalid level must fail closed.");
});

await test("initialization planning requires shared access and matching progression", async () => {
  const owner = {
    uuid: "Actor.owner",
    system: { attributes: { prof: 2 } },
    items: [{
      uuid: "Actor.owner.Item.tamer",
      type: "class",
      name: "Tamer",
      system: { identifier: "tamer", levels: 3 }
    }]
  };
  const companion = {
    system: {
      details: { cr: 0.5 },
      attributes: { hd: { denomination: 8 } },
      abilities: { con: { mod: 2 } },
      identifier: "test-companion"
    }
  };
  const result = await CompanionInitialization.planWithAccess({ owner, companion });
  assert(result.eligible, "Expected valid Tamer access to produce an initialization plan.");
  assert(result.tamerLevel === 3, "Expected plan to preserve Tamer level.");
  assert(result.accessContext.ownerUuid === owner.uuid, "Expected resolved access context in plan.");

  const invalidOwner = {
    ...owner,
    items: [{ ...owner.items[0], system: { identifier: "tamer", levels: 0 } }]
  };
  const invalid = await CompanionInitialization.planWithAccess({ owner: invalidOwner, companion });
  assert(!invalid.eligible && invalid.reason === "invalid-progression", "Invalid progression must block initialization.");

  const unauthorized = await CompanionInitialization.planWithAccess({
    owner: { uuid: "Actor.no-tamer", items: [] },
    companion
  });
  assert(!unauthorized.eligible, "An owner without a supported access source must be blocked.");

  const unsupportedCR = await CompanionInitialization.planWithAccess({
    owner,
    companion: { ...companion, system: { ...companion.system, details: { cr: 1.5 } } }
  });
  assert(!unsupportedCR.eligible, "A CR above the Tamer limit must not create an eligible initialization plan.");
});

await test("Tamer summary rejects out-of-range levels", () => {
  assertThrows(() => TamerCompanionSummary.forLevel(0), "Expected level 0 to be rejected.");
  assertThrows(() => TamerCompanionSummary.forLevel(21), "Expected level 21 to be rejected.");
});

const failed = testResults.filter(result => !result.passed);
const summary = {
  passed: testResults.length - failed.length,
  failed: failed.length,
  tests: testResults
};

globalThis.__TAMER_MANAGER_CONTRACT_TESTS__ = summary;
if (failed.length) throw new Error(JSON.stringify(summary));
