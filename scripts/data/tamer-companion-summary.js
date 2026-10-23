const SIZE_VALUES = new Set(["tiny", "small", "medium", "large", "huge", "gargantuan"]);
const SIZE_ALIASES = Object.freeze({
  tiny: "tiny", sm: "small", small: "small",
  med: "medium", medium: "medium", lg: "large", large: "large",
  huge: "huge", grg: "gargantuan", gargantuan: "gargantuan"
});

function normalizeSize(value) {
  // dnd5e normally stores size as a key, but imported/system-derived data may
  // expose a size configuration object such as { value: "med" }.
  const raw = value && typeof value === "object"
    ? (value.value ?? value.id ?? value.key ?? value.label)
    : value;
  const key = String(raw ?? "").trim().toLowerCase();
  return SIZE_ALIASES[key] ?? null;
}

const SUMMARY = Object.freeze([
  { level: 1,  maxCompanions: 1, maxSize: "small",      maxCR: 0.5, training: { "0.5-1": [0, 0] } },
  { level: 2,  maxCompanions: 1, maxSize: "small",      maxCR: 0.5, training: { "0.5-1": [1, 0] } },
  { level: 3,  maxCompanions: 2, maxSize: "small",      maxCR: 0.5, training: { "0.5-1": [2, 0] } },
  { level: 4,  maxCompanions: 2, maxSize: "small",      maxCR: 1,   training: { "0.5-1": [3, 1], "2": [0, 0] } },
  { level: 5,  maxCompanions: 2, maxSize: "medium",     maxCR: 1,   training: { "0.5-1": [4, 1], "2": [1, 0] } },
  { level: 6,  maxCompanions: 2, maxSize: "medium",     maxCR: 1,   training: { "0.5-1": [5, 1], "2": [2, 0] } },
  { level: 7,  maxCompanions: 3, maxSize: "medium",     maxCR: 2,   training: { "0.5-1": [6, 1], "2": [3, 0], "3": [0, 0] } },
  { level: 8,  maxCompanions: 3, maxSize: "medium",     maxCR: 2,   training: { "0.5-1": [7, 2], "2": [4, 1], "3": [1, 1] } },
  { level: 9,  maxCompanions: 3, maxSize: "medium",     maxCR: 2,   training: { "0.5-1": [8, 2], "2": [5, 1], "3": [2, 1] } },
  { level: 10, maxCompanions: 3, maxSize: "medium",     maxCR: 3,   training: { "0.5-1": [9, 2], "2": [6, 1], "3": [3, 1], "4": [0, 0] } },
  { level: 11, maxCompanions: 4, maxSize: "large",      maxCR: 3,   training: { "0.5-1": [10, 2], "2": [7, 1], "3": [4, 1], "4": [1, 0] } },
  { level: 12, maxCompanions: 4, maxSize: "large",      maxCR: 3,   training: { "0.5-1": [11, 3], "2": [8, 2], "3": [5, 2], "4": [2, 1] } },
  { level: 13, maxCompanions: 4, maxSize: "large",      maxCR: 4,   training: { "0.5-1": [12, 3], "2": [9, 2], "3": [6, 2], "4": [3, 1], "5": [0, 0] } },
  { level: 14, maxCompanions: 4, maxSize: "large",      maxCR: 4,   training: { "0.5-1": [13, 3], "2": [10, 2], "3": [7, 2], "4": [4, 1], "5": [1, 0] } },
  { level: 15, maxCompanions: 5, maxSize: "large",      maxCR: 4,   training: { "0.5-1": [14, 3], "2": [11, 2], "3": [8, 2], "4": [5, 1], "5": [2, 0] } },
  { level: 16, maxCompanions: 5, maxSize: "large",      maxCR: 5,   training: { "0.5-1": [15, 4], "2": [12, 3], "3": [9, 3], "4": [6, 2], "5": [3, 1], "6": [0, 0] } },
  { level: 17, maxCompanions: 5, maxSize: "huge",       maxCR: 5,   training: { "0.5-1": [16, 4], "2": [13, 3], "3": [10, 3], "4": [7, 2], "5": [4, 1], "6": [1, 0] } },
  { level: 18, maxCompanions: 5, maxSize: "huge",       maxCR: 5,   training: { "0.5-1": [17, 4], "2": [14, 3], "3": [11, 3], "4": [8, 2], "5": [5, 1], "6": [2, 0] } },
  { level: 19, maxCompanions: 6, maxSize: "huge",       maxCR: 6,   training: { "0.5-1": [18, 5], "2": [15, 4], "3": [12, 4], "4": [9, 3], "5": [6, 2], "6": [3, 1] } },
  { level: 20, maxCompanions: 6, maxSize: "huge",       maxCR: 6,   training: { "0.5-1": [19, 5], "2": [16, 4], "3": [13, 4], "4": [10, 3], "5": [7, 2], "6": [4, 1] } }
]);

const CR_BANDS = Object.freeze([
  { key: "0.5-1", min: 0.5, max: 1 },
  { key: "2", min: 2, max: 2 },
  { key: "3", min: 3, max: 3 },
  { key: "4", min: 4, max: 4 },
  { key: "5", min: 5, max: 5 },
  { key: "6", min: 6, max: 6 }
]);

function clone(value) {
  return foundry.utils.deepClone(value);
}

function normalizeLevel(level) {
  const value = Number(level);
  return Number.isInteger(value) ? value : 0;
}

function normalizeCR(cr) {
  if (typeof cr === "string" && /^\s*\d+\s*\/\s*\d+\s*$/.test(cr)) {
    const [numerator, denominator] = cr.split("/").map(value => Number(value.trim()));
    if (denominator === 0) return null;
    const value = numerator / denominator;
    return Number.isFinite(value) ? value : null;
  }
  const value = Number(cr);
  return Number.isFinite(value) ? value : null;
}

function getTamerLevel(actor) {
  const tamer = actor?.items?.find(item =>
    item.type === "class" &&
    (
      String(item.name ?? "").trim().toLowerCase() === "tamer" ||
      String(item.system?.identifier ?? "").trim().toLowerCase() === "tamer"
    )
  );
  return normalizeLevel(tamer?.system?.levels);
}

function getCompanionCR(actor) {
  return normalizeCR(actor?.system?.details?.cr ?? actor?.system?.details?.challenge);
}

function getCRBand(cr) {
  const value = normalizeCR(cr);
  // CRs below 1/2 use the same lowest training tier as CR 1/2.
  if (value >= 0 && value < 0.5) return CR_BANDS[0];
  return CR_BANDS.find(band => value >= band.min && value <= band.max) ?? null;
}

function getSummary(level) {
  const normalizedLevel = normalizeLevel(level);
  return SUMMARY.find(entry => entry.level === normalizedLevel) ?? null;
}

function assertSummary(summary) {
  if (!summary) throw new Error("Tamer level must be an integer from 1 through 20.");
  return summary;
}

export const TamerCompanionSummary = Object.freeze({
  table() {
    return clone(SUMMARY);
  },

  forTamer(tamer) {
    return this.forLevel(getTamerLevel(tamer));
  },

  forLevel(level) {
    const summary = assertSummary(getSummary(level));
    return clone({
      level: summary.level,
      maxCompanions: summary.maxCompanions,
      maxSize: summary.maxSize,
      maxCR: summary.maxCR
    });
  },

  training(tamer, cr) {
    return this.trainingFor(getTamerLevel(tamer), cr);
  },

  trainingFor(level, cr) {
    const summary = assertSummary(getSummary(level));
    const value = normalizeCR(cr);

    if (value == null) {
      throw new Error("A companion CR is required.");
    }

    if (value > summary.maxCR) {
      return {
        eligible: false,
        reason: "cr-exceeds-tamer-limit",
        tamerLevel: summary.level,
        companionCR: value,
        maxCR: summary.maxCR,
        improvements: 0,
        hitDice: 0
      };
    }

    const band = getCRBand(value);
    const training = band ? summary.training[band.key] : null;

    if (!training) {
      return {
        eligible: false,
        reason: "cr-band-not-supported-by-summary",
        tamerLevel: summary.level,
        companionCR: value,
        maxCR: summary.maxCR,
        improvements: 0,
        hitDice: 0
      };
    }

    return {
      eligible: true,
      reason: null,
      tamerLevel: summary.level,
      companionCR: value,
      crBand: band.key,
      improvements: training[0],
      hitDice: training[1]
    };
  },

  canTame(tamer, companion) {
    const summary = this.forTamer(tamer);
    const cr = getCompanionCR(companion);
    const size = normalizeSize(companion?.system?.traits?.size);

    if (cr == null) return { eligible: false, reason: "missing-companion-cr" };

    return {
      eligible: cr <= summary.maxCR && (SIZE_VALUES.has(size) ? this.sizeRank(size) <= this.sizeRank(summary.maxSize) : false),
      reason: cr > summary.maxCR
        ? "cr-exceeds-tamer-limit"
        : !SIZE_VALUES.has(size)
          ? "missing-or-invalid-companion-size"
          : this.sizeRank(size) > this.sizeRank(summary.maxSize)
            ? "size-exceeds-tamer-limit"
            : null
    };
  },

  sizeRank(size) {
    const normalized = normalizeSize(size);
    return normalized ? ["tiny", "small", "medium", "large", "huge", "gargantuan"].indexOf(normalized) : -1;
  }
});

export { getTamerLevel, getCompanionCR, getCRBand };
