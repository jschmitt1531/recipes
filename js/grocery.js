// Grocery list: merge ingredients from several recipes and group them by store aisle.
import { UNITS, massOf, normalizeItem } from './units.js';

const AISLES = [
  ['Oils, Vinegars & Condiments', /\bvinegar/],
  ['Drinks', /\b(cider|juice)\b/],
  ['Produce', /\b(apple|banana|lemon|lime|orange|berr|grape|peach|pear|plum|cherr|melon|avocado|tomato|potato|onion|shallot|garlic|ginger root|fresh ginger|carrot|celery|lettuce|spinach|kale|cabbage|broccoli|cauliflower|pepper(s)? \(bell|bell pepper|jalape|zucchini|squash|pumpkin(?! puree| pie)|cucumber|mushroom|herb|parsley|cilantro|basil leaves|fresh basil|thyme sprig|rosemary|mint|scallion|green onion|leek|corn on|sweet potato|yam|beet|radish|asparagus|green beans|cranberr(y|ies)(?! sauce))/],
  ['Meat & Seafood', /\b(chicken|beef|pork|turkey|sausage|bacon|ham|lamb|steak|ground|fish|salmon|tuna(?! can)|shrimp|crab|prosciutto|pepperoni|meatball)/],
  ['Dairy & Eggs', /\b(milk|butter|cream|cheese|yogurt|egg|sour cream|half and half|half-and-half|ricotta|mozzarella|parmesan|cheddar|margarine)/],
  ['Bakery & Bread', /\b(bread|bun|roll|tortilla|bagel|pita|croissant|pie crust|pastry)/],
  ['Baking', /\b(flour|sugar|baking|yeast|cocoa|chocolate|vanilla|extract|cornstarch|molasses|syrup|honey|sprinkles|chips|marshmallow|gelatin|pudding|shortening|cornmeal|oats|coconut|cream of tartar|condensed|evaporated)/],
  ['Spices & Seasonings', /\b(salt|pepper|cinnamon|nutmeg|clove|allspice|paprika|cumin|oregano|thyme|basil|bay lea|chili powder|seasoning|spice|garlic powder|onion powder|ginger|curry|turmeric|cayenne|red pepper flakes)/],
  ['Canned & Jarred', /\b(can|canned|broth|stock|sauce|paste|puree|beans|soup|salsa|jam|jelly|preserves|peanut butter|pickles|olives)/],
  ['Pasta, Rice & Grains', /\b(pasta|spaghetti|noodle|macaroni|penne|rice|quinoa|couscous|lentil|barley|breadcrumbs|bread crumbs|panko|crackers|cereal)/],
  ['Oils, Vinegars & Condiments', /\b(oil|vinegar|ketchup|mustard|mayo|soy sauce|worcestershire|hot sauce|dressing|bbq)/],
  ['Nuts & Dried Fruit', /\b(nut|almond|pecan|walnut|peanut|cashew|pistachio|raisin|dried|date|seed)/],
  ['Frozen', /\b(frozen|ice cream)/],
  ['Drinks', /\b(water|juice|wine|beer|coffee|tea|soda)/],
];
export const AISLE_ORDER = ['Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery & Bread', 'Baking', 'Spices & Seasonings', 'Canned & Jarred', 'Pasta, Rice & Grains', 'Oils, Vinegars & Condiments', 'Nuts & Dried Fruit', 'Frozen', 'Drinks', 'Other'];

export function aisleFor(item) {
  const n = ' ' + normalizeItem(item) + ' ';
  for (const [name, re] of AISLES) if (re.test(n)) return name;
  return 'Other';
}

// Strip preparation words so "chopped onion" and "onions, diced" merge.
export function itemKey(item) {
  return normalizeItem(item)
    .replace(/\b(all-purpose|all purpose|ap|plain|fresh|large|medium|small|extra-large|chopped|diced|minced|sliced|grated|shredded|melted|softened|cold|room temperature|packed|sifted|divided|finely|roughly|thinly|ground|whole|unsalted|salted|light|dark|optional|peeled|cored)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/(ies)$/, 'y').replace(/(oes)$/, 'o').replace(/([^s])s$/, '$1');
}

// One grocery entry per item. qtyByUnit keeps what to buy in the recipe's units;
// grams is the summed mass (when every line had a known mass).
export function addToList(list, ingredients, recipeTitle, scale = 1) {
  const items = list.slice();
  for (const ing of ingredients) {
    if (!ing || !ing.item) continue;
    const key = itemKey(ing.item);
    if (!key) continue;
    const m = massOf(ing, scale);
    let e = items.find((x) => x.key === key && !x.checked);
    if (!e) {
      e = { id: Math.random().toString(36).slice(2, 10), key, name: ing.item, aisle: aisleFor(ing.item), qtyByUnit: {}, grams: 0, gramsKnown: true, from: [], checked: false };
      items.push(e);
    }
    if (ing.qty != null && ing.qty !== '' && isFinite(+ing.qty)) {
      const u = ing.unit || 'each';
      e.qtyByUnit[u] = (e.qtyByUnit[u] || 0) + +ing.qty * scale;
    } else if (!e.qtyByUnit['to taste']) e.qtyByUnit['to taste'] = 0;
    if (m.grams != null) e.grams += m.grams; else if (ing.qty != null && ing.qty !== '') e.gramsKnown = false;
    if (recipeTitle && !e.from.includes(recipeTitle)) e.from.push(recipeTitle);
  }
  return items;
}

// Collapse volume units into the largest sensible one for display ("3 tsp" + "1 tbsp" -> "2 tbsp").
export function combineQty(qtyByUnit) {
  const out = {};
  let ml = 0, volCount = 0, g = 0, massCount = 0;
  for (const [u, q] of Object.entries(qtyByUnit || {})) {
    const def = UNITS[u];
    if (def && def.kind === 'volume' && !['ml', 'l'].includes(u)) { ml += q * def.ml; volCount++; }
    else if (def && def.kind === 'mass' && !['g', 'kg', 'mg'].includes(u)) { g += q * def.g; massCount++; }
    else out[u] = (out[u] || 0) + q;
  }
  if (volCount) {
    const pick = ml >= 236.588 / 4 ? 'cup' : ml >= 14.7868 ? 'tbsp' : 'tsp';
    out[pick] = (out[pick] || 0) + ml / UNITS[pick].ml;
  }
  if (massCount) {
    const pick = g >= 453.592 ? 'lb' : 'oz';
    out[pick] = (out[pick] || 0) + g / UNITS[pick].g;
  }
  return out;
}

export function listToText(list, fmtQty, unitLabel, fmtGrams) {
  const groups = {};
  for (const e of list.filter((x) => !x.checked)) (groups[e.aisle] = groups[e.aisle] || []).push(e);
  const lines = [];
  for (const a of AISLE_ORDER) {
    if (!groups[a]) continue;
    lines.push(a.toUpperCase());
    for (const e of groups[a]) {
      const q = Object.entries(combineQty(e.qtyByUnit)).filter(([u]) => u !== 'to taste')
        .map(([u, n]) => `${fmtQty(n, u)} ${u === 'each' ? '' : unitLabel(u, n)}`.trim()).join(' + ');
      const g = e.gramsKnown && e.grams ? ` (${fmtGrams(e.grams)})` : '';
      lines.push(`☐ ${q ? q + ' ' : ''}${e.name}${g}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}
