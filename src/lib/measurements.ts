export type MeasureDimension = "mass" | "volume" | "count" | "unknown";

type UnitDef = {
  canonical: string;
  dimension: MeasureDimension;
  toBase: number;
  aliases: string[];
};

const unitDefs: UnitDef[] = [
  { canonical: "kg", dimension: "mass", toBase: 1000, aliases: ["kg","kgs","kilogram","kilograms"] },
  { canonical: "g", dimension: "mass", toBase: 1, aliases: ["g","gram","grams","gr"] },
  { canonical: "lb", dimension: "mass", toBase: 453.59237, aliases: ["lb","lbs","pound","pounds"] },
  { canonical: "oz", dimension: "mass", toBase: 28.349523125, aliases: ["oz","ounce","ounces"] },

  { canonical: "l", dimension: "volume", toBase: 1000, aliases: ["l","liter","liters","litre","litres"] },
  { canonical: "ml", dimension: "volume", toBase: 1, aliases: ["ml","milliliter","milliliters","millilitre","millilitres"] },
  { canonical: "gal", dimension: "volume", toBase: 3785.411784, aliases: ["gal","gallon","gallons"] },
  { canonical: "qt", dimension: "volume", toBase: 946.352946, aliases: ["qt","qts","quart","quarts"] },
  { canonical: "pt", dimension: "volume", toBase: 473.176473, aliases: ["pt","pts","pint","pints"] },
  { canonical: "cup", dimension: "volume", toBase: 236.5882365, aliases: ["cup","cups","c"] },
  { canonical: "fl oz", dimension: "volume", toBase: 29.5735295625, aliases: ["fl oz","fl. oz","fluid ounce","fluid ounces"] },
  { canonical: "tbsp", dimension: "volume", toBase: 14.78676478125, aliases: ["tbsp","tbs","tablespoon","tablespoons"] },
  { canonical: "tsp", dimension: "volume", toBase: 4.92892159375, aliases: ["tsp","teaspoon","teaspoons"] },

  { canonical: "can", dimension: "count", toBase: 1, aliases: ["can","cans","tin","tins"] },
  { canonical: "jar", dimension: "count", toBase: 1, aliases: ["jar","jars"] },
  { canonical: "bottle", dimension: "count", toBase: 1, aliases: ["bottle","bottles"] },
  { canonical: "pkg", dimension: "count", toBase: 1, aliases: ["pkg","pkgs","package","packages","packet","packets","pack","packs"] },
  { canonical: "box", dimension: "count", toBase: 1, aliases: ["box","boxes"] },
  { canonical: "bag", dimension: "count", toBase: 1, aliases: ["bag","bags"] },
  { canonical: "bunch", dimension: "count", toBase: 1, aliases: ["bunch","bunches"] },
  { canonical: "clove", dimension: "count", toBase: 1, aliases: ["clove","cloves"] },
  { canonical: "slice", dimension: "count", toBase: 1, aliases: ["slice","slices"] },
  { canonical: "piece", dimension: "count", toBase: 1, aliases: ["piece","pieces","pc","pcs"] },
  { canonical: "stalk", dimension: "count", toBase: 1, aliases: ["stalk","stalks"] },
  { canonical: "sprig", dimension: "count", toBase: 1, aliases: ["sprig","sprigs"] },
  { canonical: "head", dimension: "count", toBase: 1, aliases: ["head","heads"] },
  { canonical: "each", dimension: "count", toBase: 1, aliases: ["each","ea","whole","item","items"] },
];

const aliasMap = new Map<string, UnitDef>();
for (const def of unitDefs) for (const alias of def.aliases) aliasMap.set(alias.toLowerCase(), def);

const unicodeFractions: Record<string, string> = {
  "¼": "1/4", "½": "1/2", "¾": "3/4", "⅐": "1/7", "⅑": "1/9", "⅒": "1/10",
  "⅓": "1/3", "⅔": "2/3", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5",
  "⅙": "1/6", "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};

function cleanUnit(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
}

function numberFromToken(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  if (/^\d+\s+\d+\/\d+$/.test(v)) {
    const [whole, fraction] = v.split(/\s+/);
    const [n, d] = fraction.split("/").map(Number);
    return Number(whole) + (d ? n / d : 0);
  }
  if (/^\d+\/\d+$/.test(v)) {
    const [n, d] = v.split("/").map(Number);
    return d ? n / d : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function expandFractions(value: string) {
  let out = value;
  for (const [symbol, fraction] of Object.entries(unicodeFractions)) {
    out = out.replaceAll(symbol, ` ${fraction} `);
  }
  return out.replace(/\s+/g, " ").trim();
}

export function normalizeUnit(value: string | null | undefined): string | null {
  const cleaned = cleanUnit(value);
  if (!cleaned) return null;
  return aliasMap.get(cleaned)?.canonical ?? cleaned;
}

export function unitDimension(value: string | null | undefined): MeasureDimension {
  const cleaned = cleanUnit(value);
  if (!cleaned) return "unknown";
  return aliasMap.get(cleaned)?.dimension ?? "unknown";
}

function unitDef(value: string | null | undefined): UnitDef | null {
  const canonical = normalizeUnit(value);
  if (!canonical) return null;
  return unitDefs.find((d) => d.canonical === canonical) ?? null;
}

export function unitsCompatible(a: string | null | undefined, b: string | null | undefined) {
  const ua = normalizeUnit(a), ub = normalizeUnit(b);
  if (!ua || !ub) return false;
  if (ua === ub) return true;
  const da = unitDef(ua), db = unitDef(ub);
  return Boolean(da && db && da.dimension !== "count" && da.dimension === db.dimension);
}

export function convertQuantity(
  quantity: number,
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined,
): number | null {
  if (!Number.isFinite(quantity)) return null;
  const from = normalizeUnit(fromUnit), to = normalizeUnit(toUnit);
  if (!from || !to) return null;
  if (from === to) return quantity;

  const fromDef = unitDef(from), toDef = unitDef(to);
  if (!fromDef || !toDef || fromDef.dimension !== toDef.dimension) return null;
  if (fromDef.dimension === "count") return null;
  return quantity * fromDef.toBase / toDef.toBase;
}

export function measureGroupKey(unit: string | null | undefined): string {
  const normalized = normalizeUnit(unit);
  if (!normalized) return "unknown";
  const def = unitDef(normalized);
  if (!def) return `unit:${normalized}`;
  if (def.dimension === "count") return `count:${normalized}`;
  return def.dimension;
}

export type ParsedMeasure = {
  quantity: number | null;
  unit: string | null;
  raw: string;
  descriptor: string | null;
  approximate: boolean;
  parsed: boolean;
};

export function parseMeasure(rawValue: string | null | undefined): ParsedMeasure {
  const raw = (rawValue ?? "").trim();
  if (!raw) return { quantity: null, unit: null, raw, descriptor: null, approximate: false, parsed: false };

  const expanded = expandFractions(raw)
    .replace(/^about\s+/i, "")
    .replace(/^approx(?:imately)?\.?\s+/i, "")
    .trim();

  const match = expanded.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?))?\s*(.*)$/i);
  if (!match) return { quantity: null, unit: null, raw, descriptor: raw, approximate: false, parsed: false };

  const first = numberFromToken(match[1]);
  const second = match[2] ? numberFromToken(match[2]) : null;
  if (first == null) return { quantity: null, unit: null, raw, descriptor: raw, approximate: false, parsed: false };

  const quantity = second != null ? Math.max(first, second) : first;
  const approximate = second != null || /^(about|approx)/i.test(raw);
  const remainder = (match[3] ?? "").trim().replace(/^of\s+/i, "");

  if (!remainder) {
    return { quantity, unit: "each", raw, descriptor: null, approximate, parsed: true };
  }

  const cleaned = cleanUnit(remainder);
  const aliases = [...aliasMap.keys()].sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (cleaned === alias || cleaned.startsWith(`${alias} `)) {
      const def = aliasMap.get(alias)!;
      const descriptor = cleaned === alias ? null : remainder.slice(alias.length).trim() || null;
      return { quantity, unit: def.canonical, raw, descriptor, approximate, parsed: true };
    }
  }

  const parentheticalPackage = remainder.match(/^x?\s*\(?\s*(\d+(?:\.\d+)?)\s*(g|kg|oz|lb|ml|l)\s*\)?\s*(can|tin|jar|bottle|pack|package)?/i);
  if (parentheticalPackage) {
    const packUnit = parentheticalPackage[3] ? normalizeUnit(parentheticalPackage[3]) : "each";
    return { quantity, unit: packUnit, raw, descriptor: remainder, approximate, parsed: true };
  }

  // Recipe sources often use measures such as "2 large" for whole eggs/onions.
  // Preserve the descriptor but still make the count usable.
  return { quantity, unit: "each", raw, descriptor: remainder || null, approximate, parsed: true };
}

export function roundMeasure(value: number, precision = 4) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
