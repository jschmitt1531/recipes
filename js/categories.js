// Recipe groupings: course (what part of the meal) and main ingredient (chicken, steak, fish...).
// Pure module, no DOM.
import { normalizeItem } from './units.js';

// Course. Stored value -> label shown in the app. (Values stay stable so old recipes keep working.)
export const COURSES = [
  ['Appetizer', 'Appetizers', '🧀'],
  ['Breakfast', 'Breakfast', '🍳'],
  ['Bread', 'Breads', '🍞'],
  ['Soup', 'Soups', '🍲'],
  ['Salad', 'Salads', '🥗'],
  ['Main', 'Mains', '🍽️'],
  ['Side', 'Sides', '🥔'],
  ['Dessert', 'Desserts', '🥧'],
  ['Baking', 'Baking', '🍪'],
  ['Sauce', 'Sauces', '🥫'],
  ['Snack', 'Snacks', '🥨'],
  ['Drinks', 'Drinks', '🍹'],
  ['Holiday', 'Holiday', '🦃'],
  ['Other', 'Other', '📝'],
];
export const courseLabel = (v) => (COURSES.find((c) => c[0] === v) || [v, v || ''])[1];
export const courseIcon = (v) => (COURSES.find((c) => c[0] === v) || [])[2] || '';

// Main ingredient. Order matters for auto-detect ties: earlier wins.
export const PROTEINS = [
  ['chicken', 'Chicken', '🍗', /\b(chicken|hen|poultry)\b/],
  ['beef', 'Beef & Steak', '🥩', /\b(beef|steak|sirloin|ribeye|rib-eye|brisket|chuck|flank|tenderloin|filet mignon|ground round|veal|short ribs?|roast beef|pot roast|hamburger|burger)\b/],
  ['pork', 'Pork', '🐖', /\b(pork|bacon|ham|sausage|chorizo|prosciutto|pancetta|pepperoni|salami|ribs|carnitas|kielbasa|bratwurst)\b/],
  ['fish', 'Fish & Seafood', '🐟', /\b(fish|salmon|tuna|cod|tilapia|halibut|trout|haddock|catfish|mahi|snapper|sole|anchov(y|ies)|sardines?|shrimp|prawns?|crab|lobster|scallops?|clams?|mussels?|oysters?|calamari|squid|seafood)\b/],
  ['turkey', 'Turkey', '🦃', /\bturkey\b/],
  ['lamb', 'Lamb', '🐑', /\b(lamb|mutton)\b/],
  ['game', 'Game', '🦌', /\b(venison|duck|goose|pheasant|quail|rabbit|elk|bison)\b/],
  ['vegetarian', 'Vegetarian', '🥦', null],
  ['other', 'Other', '📝', null],
];
export const proteinLabel = (v) => (PROTEINS.find((p) => p[0] === v) || [v, ''])[1];
export const proteinIcon = (v) => (PROTEINS.find((p) => p[0] === v) || [])[2] || '';

// Ingredients that mention a meat word but aren't meat.
const NOT_MEAT = /\b(broth|stock|bouillon|base|gravy mix|fish sauce|oyster sauce|worcestershire|anchovy paste)\b/;

// Guess the main ingredient from the title and ingredients.
// Meat in the title wins; otherwise the meat with the most weight-ish mentions.
// No meat or meat broth at all -> vegetarian, except desserts/drinks/sauces which get '' (not meaningful).
export function detectProtein(recipe) {
  if (!recipe) return '';
  const title = normalizeItem(recipe.title || '');
  for (const [k, , , re] of PROTEINS) if (re && re.test(title)) return k;
  const score = {};
  let trace = false; // e.g. chicken broth, fish sauce: not the main ingredient, but not vegetarian either
  for (const ing of recipe.ingredients || []) {
    const n = normalizeItem(ing.item || '');
    if (!n) continue;
    if (NOT_MEAT.test(n)) { if (/fish sauce|oyster sauce|worcestershire|anchovy/.test(n) || PROTEINS.some(([, , , re]) => re && re.test(n))) trace = true; continue; }
    if (/\bgelatin\b/.test(n)) trace = true;
    for (const [k, , , re] of PROTEINS) if (re && re.test(n)) { score[k] = (score[k] || 0) + 1; break; }
  }
  const best = PROTEINS.filter(([k]) => score[k]).sort((a, b) => score[b[0]] - score[a[0]])[0];
  if (best) return best[0];
  if (['Dessert', 'Baking', 'Drinks', 'Sauce', 'Bread'].includes(recipe.category)) return '';
  return (recipe.ingredients || []).length && !trace ? 'vegetarian' : '';
}

// The value used for filtering: the family's choice if set, else the detected one.
export const proteinOf = (r) => r.protein || detectProtein(r);
