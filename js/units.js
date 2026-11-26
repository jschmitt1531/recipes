// Units, quantities and mass (grams) for recipe ingredients.
// Pure module: no DOM, so it runs in the browser and in Node tests.

// ---- Units ---------------------------------------------------------------
// kind: 'volume' (ml per unit), 'mass' (g per unit), 'count' (no fixed size)
export const UNITS = {
  tsp:    { kind: 'volume', ml: 4.92892, label: 'tsp',  plural: 'tsp' },
  tbsp:   { kind: 'volume', ml: 14.7868, label: 'tbsp', plural: 'tbsp' },
  cup:    { kind: 'volume', ml: 236.588, label: 'cup',  plural: 'cups' },
  floz:   { kind: 'volume', ml: 29.5735, label: 'fl oz', plural: 'fl oz' },
  pint:   { kind: 'volume', ml: 473.176, label: 'pint', plural: 'pints' },
  quart:  { kind: 'volume', ml: 946.353, label: 'quart', plural: 'quarts' },
  gallon: { kind: 'volume', ml: 3785.41, label: 'gallon', plural: 'gallons' },
  ml:     { kind: 'volume', ml: 1,       label: 'ml',   plural: 'ml' },
  l:      { kind: 'volume', ml: 1000,    label: 'l',    plural: 'l' },
  pinch:  { kind: 'volume', ml: 0.31,    label: 'pinch', plural: 'pinches' },
  dash:   { kind: 'volume', ml: 0.62,    label: 'dash', plural: 'dashes' },
  g:      { kind: 'mass', g: 1,          label: 'g',    plural: 'g' },
  kg:     { kind: 'mass', g: 1000,       label: 'kg',   plural: 'kg' },
  mg:     { kind: 'mass', g: 0.001,      label: 'mg',   plural: 'mg' },
  oz:     { kind: 'mass', g: 28.3495,    label: 'oz',   plural: 'oz' },
  lb:     { kind: 'mass', g: 453.592,    label: 'lb',   plural: 'lb' },
  stick:  { kind: 'count', label: 'stick', plural: 'sticks' },
  clove:  { kind: 'count', label: 'clove', plural: 'cloves' },
  can:    { kind: 'count', label: 'can',   plural: 'cans' },
  jar:    { kind: 'count', label: 'jar',   plural: 'jars' },
  package:{ kind: 'count', label: 'package', plural: 'packages' },
  envelope:{ kind: 'count', label: 'envelope', plural: 'envelopes' },
  slice:  { kind: 'count', label: 'slice', plural: 'slices' },
  piece:  { kind: 'count', label: 'piece', plural: 'pieces' },
  bunch:  { kind: 'count', label: 'bunch', plural: 'bunches' },
  head:   { kind: 'count', label: 'head',  plural: 'heads' },
  sprig:  { kind: 'count', label: 'sprig', plural: 'sprigs' },
  handful:{ kind: 'count', label: 'handful', plural: 'handfuls' },
};

// Words people write -> unit key. Case-sensitive entries first (T vs t).
const CASE_SENSITIVE = { T: 'tbsp', Tbs: 'tbsp', Tb: 'tbsp', t: 'tsp' };
const ALIASES = {
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp', tsps: 'tsp', ts: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', tbls: 'tbsp', tblsp: 'tbsp',
  cup: 'cup', cups: 'cup', c: 'cup',
  'fl oz': 'floz', 'fl. oz': 'floz', 'fl.oz': 'floz', floz: 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz',
  pint: 'pint', pints: 'pint', pt: 'pint', pts: 'pint',
  quart: 'quart', quarts: 'quart', qt: 'quart', qts: 'quart',
  gallon: 'gallon', gallons: 'gallon', gal: 'gallon',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', mls: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  g: 'g', gram: 'g', grams: 'g', gr: 'g', grm: 'g', gm: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', kgs: 'kg',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  oz: 'oz', ounce: 'oz', ounces: 'oz', ozs: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', '#': 'lb',
  pinch: 'pinch', pinches: 'pinch', dash: 'dash', dashes: 'dash',
  stick: 'stick', sticks: 'stick', clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can', tin: 'can', tins: 'can', jar: 'jar', jars: 'jar',
  package: 'package', packages: 'package', pkg: 'package', pkgs: 'package', pkt: 'package', packet: 'package', packets: 'package', box: 'package', boxes: 'package', bag: 'package', bags: 'package',
  envelope: 'envelope', envelopes: 'envelope',
  slice: 'slice', slices: 'slice', piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
  bunch: 'bunch', bunches: 'bunch', head: 'head', heads: 'head', sprig: 'sprig', sprigs: 'sprig',
  handful: 'handful', handfuls: 'handful',
};

export function normalizeUnit(word) {
  if (word == null) return '';
  const w = String(word).trim().replace(/\.$/, '');
  if (!w) return '';
  if (CASE_SENSITIVE[w]) return CASE_SENSITIVE[w];
  const lw = w.toLowerCase();
  return ALIASES[lw] || '';
}

export function unitLabel(unit, qty) {
  const u = UNITS[unit];
  if (!u) return unit || '';
  return qty != null && qty > 1 ? u.plural : u.label;
}

// ---- Quantities ----------------------------------------------------------
const VULGAR = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
export const VULGAR_CHARS = Object.keys(VULGAR).join('');

// Parse "1", "1.5", "1,5", "1/2", "1 1/2", "1½", "½" -> number (or null)
export function parseNumber(s) {
  if (s == null) return null;
  let str = String(s).trim().replace(/⁄/g, '/');
  if (!str) return null;
  let total = 0, found = false;
  // trailing vulgar fraction, e.g. "1½" or "1 ½"
  const vm = str.match(new RegExp('[' + VULGAR_CHARS + ']$'));
  if (vm) { total += VULGAR[vm[0]]; found = true; str = str.slice(0, -1).trim(); if (!str) return total; }
  let m;
  if ((m = str.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/))) { const d = +m[3]; return d ? total + +m[1] + +m[2] / d : null; }
  if ((m = str.match(/^(\d+)\s*\/\s*(\d+)$/))) { const d = +m[2]; return d ? total + +m[1] / d : null; }
  if ((m = str.match(/^\d+(?:[.,]\d+)?$/))) return total + parseFloat(str.replace(',', '.'));
  if ((m = str.match(/^\.\d+$/))) return total + parseFloat(str);
  return found ? total : null;
}

const NICE = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];

// Format a quantity for display. US-style units use fractions, metric uses decimals.
export function formatQty(q, unit) {
  if (q == null || !isFinite(q)) return '';
  const metric = ['g', 'kg', 'mg', 'ml', 'l'].includes(unit);
  if (metric) {
    if (q >= 100) return String(Math.round(q));
    if (q >= 10) return String(Math.round(q * 10) / 10);
    return String(Math.round(q * 100) / 100);
  }
  let whole = Math.floor(q), frac = q - whole;
  let best = NICE[0], err = 1;
  for (const n of NICE) { const e = Math.abs(frac - n[0]); if (e < err) { err = e; best = n; } }
  if (err > 0.04) return String(Math.round(q * 100) / 100); // not close to a kitchen fraction
  if (best[0] === 1) { whole += 1; best = NICE[0]; }
  if (!whole && !best[1]) return '0';
  return (whole ? String(whole) : '') + best[1];
}

// ---- Ingredient knowledge -----------------------------------------------
// Density in g per ml (from standard baking weight charts: grams per US cup / 236.6).
// Ordered list; the longest matching phrase wins, so "brown sugar" beats "sugar".
const DENSITY = [
  ['all-purpose flour', 0.528], ['all purpose flour', 0.528], ['ap flour', 0.528], ['plain flour', 0.528], ['flour', 0.528],
  ['bread flour', 0.55], ['whole wheat flour', 0.507], ['cake flour', 0.486], ['pastry flour', 0.48], ['self-rising flour', 0.507], ['self rising flour', 0.507],
  ['almond flour', 0.406], ['almond meal', 0.406], ['coconut flour', 0.48], ['rye flour', 0.43], ['cornmeal', 0.59], ['corn meal', 0.59], ['cornstarch', 0.54], ['corn starch', 0.54], ['semolina', 0.71],
  ['sugar', 0.845], ['granulated sugar', 0.845], ['white sugar', 0.845], ['caster sugar', 0.845], ['brown sugar', 0.90], ['light brown sugar', 0.90], ['dark brown sugar', 0.90],
  ['powdered sugar', 0.507], ["confectioners' sugar", 0.507], ['confectioners sugar', 0.507], ['icing sugar', 0.507],
  ['honey', 1.44], ['maple syrup', 1.32], ['molasses', 1.42], ['corn syrup', 1.38], ['golden syrup', 1.4], ['agave', 1.39],
  ['butter', 0.96], ['margarine', 0.96], ['shortening', 0.81], ['lard', 0.87], ['oil', 0.92], ['olive oil', 0.91], ['vegetable oil', 0.92], ['coconut oil', 0.92],
  ['water', 1.0], ['broth', 1.01], ['stock', 1.01], ['milk', 1.03], ['whole milk', 1.03], ['buttermilk', 1.03], ['evaporated milk', 1.07], ['sweetened condensed milk', 1.3], ['condensed milk', 1.3],
  ['heavy cream', 0.99], ['whipping cream', 0.99], ['half and half', 1.01], ['half-and-half', 1.01], ['cream', 1.0], ['sour cream', 1.02], ['yogurt', 1.04], ['greek yogurt', 1.06], ['cream cheese', 0.98],
  ['coconut milk', 0.97], ['almond milk', 1.03], ['oat milk', 1.03],
  ['ricotta', 1.04], ['cottage cheese', 0.95], ['shredded cheese', 0.48], ['cheddar', 0.48], ['mozzarella', 0.48], ['parmesan', 0.42], ['grated cheese', 0.42], ['cheese', 0.48],
  ['rolled oats', 0.38], ['oats', 0.38], ['quick oats', 0.38], ['rice', 0.78], ['quinoa', 0.72], ['pasta', 0.42], ['breadcrumbs', 0.46], ['bread crumbs', 0.46], ['panko', 0.25], ['cracker crumbs', 0.5], ['graham cracker crumbs', 0.42],
  ['cocoa', 0.36], ['cocoa powder', 0.36], ['chocolate chips', 0.72], ['chocolate', 0.72], ['raisins', 0.63], ['dried cranberries', 0.51], ['coconut', 0.36], ['shredded coconut', 0.36],
  ['nuts', 0.5], ['walnuts', 0.5], ['pecans', 0.46], ['almonds', 0.6], ['peanuts', 0.6], ['sliced almonds', 0.39],
  ['peanut butter', 1.09], ['nutella', 1.2], ['jam', 1.35], ['jelly', 1.35], ['preserves', 1.35], ['ketchup', 1.13], ['mayonnaise', 0.93], ['mayo', 0.93], ['mustard', 1.05], ['vinegar', 1.01], ['soy sauce', 1.15], ['worcestershire', 1.1], ['hot sauce', 1.05],
  ['lemon juice', 1.03], ['lime juice', 1.03], ['orange juice', 1.04], ['juice', 1.04], ['wine', 0.99], ['beer', 1.01], ['coffee', 1.0],
  ['salt', 1.22], ['table salt', 1.22], ['kosher salt', 0.67], ['sea salt', 1.1], ['baking soda', 0.93], ['bicarbonate of soda', 0.93], ['baking powder', 0.81], ['yeast', 0.64], ['cream of tartar', 0.66], ['gelatin', 0.6],
  ['vanilla', 0.88], ['vanilla extract', 0.88], ['extract', 0.88],
  ['cinnamon', 0.53], ['nutmeg', 0.47], ['ginger', 0.37], ['ground ginger', 0.37], ['cloves', 0.44], ['allspice', 0.4], ['pumpkin pie spice', 0.45], ['paprika', 0.46], ['chili powder', 0.54], ['cumin', 0.42], ['garlic powder', 0.63], ['onion powder', 0.49], ['pepper', 0.49], ['black pepper', 0.49], ['oregano', 0.2], ['basil', 0.15], ['thyme', 0.28], ['parsley', 0.1], ['italian seasoning', 0.2], ['spice', 0.5],
  ['pumpkin', 1.03], ['pumpkin puree', 1.03], ['applesauce', 1.08], ['mashed banana', 0.95], ['tomato sauce', 1.03], ['tomato paste', 1.1], ['salsa', 1.05],
  ['berries', 0.63], ['blueberries', 0.63], ['cranberries', 0.42], ['strawberries', 0.64], ['apples', 0.5], ['chopped onion', 0.67], ['onion', 0.67], ['celery', 0.5], ['carrots', 0.54], ['corn', 0.69], ['peas', 0.6], ['spinach', 0.13], ['beans', 0.75], ['chickpeas', 0.7], ['lentils', 0.81], ['mushrooms', 0.3],
];

// Typical weight of one "piece" in grams.
const EACH = [
  ['egg', 50], ['eggs', 50], ['large egg', 50], ['extra-large egg', 56], ['medium egg', 44], ['egg yolk', 18], ['egg yolks', 18], ['yolk', 18], ['egg white', 33], ['egg whites', 33],
  ['garlic', 5], ['clove garlic', 5], ['onion', 150], ['shallot', 40], ['green onion', 15], ['scallion', 15], ['carrot', 60], ['celery', 40], ['stalk celery', 40], ['potato', 200], ['sweet potato', 200], ['tomato', 120], ['bell pepper', 150], ['jalapeno', 15], ['jalapeño', 15], ['zucchini', 200], ['cucumber', 300], ['avocado', 170],
  ['apple', 180], ['banana', 120], ['lemon', 100], ['lime', 67], ['orange', 140], ['pear', 180], ['peach', 150],
  ['chicken breast', 200], ['chicken thigh', 110], ['bay leaf', 0.2], ['bay leaves', 0.2], ['tortilla', 45], ['bread', 30], ['slice bread', 30], ['bacon', 28], ['slice bacon', 28],
];
// Per-unit weights for count units (when the item doesn't say).
const COUNT_UNIT_G = { stick: 113, clove: 5, can: 411, jar: 450, package: 225, envelope: 7, slice: 25, piece: 50, bunch: 100, head: 500, sprig: 1, handful: 30 };
const COUNT_UNIT_ITEM = [
  ['stick', 'butter', 113], ['stick', 'margarine', 113], ['stick', 'cinnamon', 3],
  ['envelope', 'yeast', 7], ['package', 'yeast', 7], ['package', 'cream cheese', 227], ['package', 'gelatin', 7], ['package', 'pudding', 96],
  ['head', 'garlic', 50], ['head', 'lettuce', 500], ['head', 'cauliflower', 600], ['head', 'broccoli', 400], ['head', 'cabbage', 900],
  ['bunch', 'parsley', 60], ['bunch', 'cilantro', 60], ['bunch', 'green onions', 100], ['bunch', 'kale', 200], ['sprig', 'thyme', 0.5], ['sprig', 'rosemary', 1],
  ['slice', 'bacon', 28], ['slice', 'bread', 30], ['slice', 'cheese', 21],
];

export function normalizeItem(item) {
  return String(item || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[,;].*$/, '')
    .replace(/[^a-z0-9ñé' -]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function wordMatch(hay, needle) {
  const re = new RegExp('(^|\\s)' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(s|es)?($|\\s)');
  return re.test(hay);
}
function lookup(table, item) {
  const n = normalizeItem(item);
  let best = null;
  for (const [k, v] of table) if (wordMatch(n, k) && (!best || k.length > best[0].length)) best = [k, v];
  return best;
}
export const densityFor = (item) => { const b = lookup(DENSITY, item); return b ? b[1] : null; };
export const eachWeightFor = (item) => { const b = lookup(EACH, item); return b ? b[1] : null; };

// Weight in a note such as "(14 oz)" or "(400 g)".
export function weightInText(text) {
  const m = String(text || '').match(/(\d+(?:[.,]\d+)?)\s*-?\s*(oz|ounces?|g|grams?|kg|lbs?|pounds?)\b/i);
  if (!m) return null;
  const u = normalizeUnit(m[2]);
  const n = parseFloat(m[1].replace(',', '.'));
  return UNITS[u] && UNITS[u].kind === 'mass' ? n * UNITS[u].g : null;
}

// Mass for one ingredient line.
// Returns { grams, exact, basis } or { grams: null } when unknowable (e.g. "salt to taste").
// basis explains the number for the UI tooltip.
export function massOf(ing, scale = 1) {
  if (!ing) return { grams: null };
  if (ing.grams != null && ing.grams !== '' && isFinite(+ing.grams)) {
    return { grams: +ing.grams * scale, exact: true, basis: 'entered by family' };
  }
  const q = ing.qty == null || ing.qty === '' ? null : +ing.qty;
  if (q == null || !isFinite(q)) return { grams: null, basis: 'no amount given' };
  const qty = q * scale;
  const unit = ing.unit || '';
  const u = UNITS[unit];
  if (u && u.kind === 'mass') return { grams: qty * u.g, exact: true, basis: 'weight unit' };
  if (u && u.kind === 'volume') {
    const d = densityFor(ing.item);
    if (d) return { grams: qty * u.ml * d, exact: false, basis: `≈ ${Math.round(d * u.ml * 100) / 100} g per ${u.label}` };
    return { grams: qty * u.ml, exact: false, guess: true, basis: 'estimated as water — tap to set the real weight' };
  }
  const noteW = weightInText(ing.note) ?? weightInText(ing.item);
  if (u && u.kind === 'count') {
    if (noteW) return { grams: qty * noteW, exact: true, basis: 'weight printed on package' };
    const n = normalizeItem(ing.item);
    const specific = COUNT_UNIT_ITEM.find(([cu, it]) => cu === unit && n.includes(it));
    if (specific) return { grams: qty * specific[2], exact: false, basis: `≈ ${specific[2]} g per ${u.label}` };
    const g = COUNT_UNIT_G[unit];
    return g ? { grams: qty * g, exact: false, guess: true, basis: `typical ${u.label} ≈ ${g} g` } : { grams: null };
  }
  // bare count: "3 eggs", "2 onions"
  if (noteW) return { grams: qty * noteW, exact: true, basis: 'weight in note' };
  const e = eachWeightFor(ing.item);
  if (e) return { grams: qty * e, exact: false, basis: `≈ ${e} g each` };
  return { grams: null, basis: 'unknown size — tap to set the weight' };
}

export function formatGrams(g) {
  if (g == null || !isFinite(g)) return '';
  if (g >= 1000) return (Math.round(g / 10) / 100) + ' kg';
  if (g >= 10) return Math.round(g) + ' g';
  if (g >= 1) return (Math.round(g * 10) / 10) + ' g';
  return (Math.round(g * 100) / 100) + ' g';
}
