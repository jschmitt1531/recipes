// node family-recipes/tests/run.mjs
import { parseNumber, formatQty, massOf, normalizeUnit, formatGrams } from '../js/units.js';
import { parseIngredientLine, parseRecipeText, splitSteps, splitCookbook, splitTitle } from '../js/parse.js';
import { detectProtein, detectCourse, proteinOf, COURSES, PROTEINS } from '../js/categories.js';
import { addToList, combineQty, aisleFor, itemKey, AISLE_ORDER } from '../js/grocery.js';

let pass = 0, fail = 0;
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log(' FAIL ' + name + '\n       ' + e.message); }
}
function eq(a, b, msg = '') { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c, msg) { if (!c) throw new Error(msg); }

t('parseNumber handles fractions, mixed numbers and unicode', () => {
  eq(parseNumber('1/2'), 0.5); eq(parseNumber('1 1/2'), 1.5); eq(parseNumber('1½'), 1.5);
  eq(parseNumber('¾'), 0.75); eq(parseNumber('2,5'), 2.5); eq(parseNumber('abc'), null); eq(parseNumber('1/0'), null);
});
t('formatQty uses kitchen fractions', () => {
  eq(formatQty(1.5, 'cup'), '1½'); eq(formatQty(0.333, 'cup'), '⅓'); eq(formatQty(2, 'tbsp'), '2');
  eq(formatQty(0.99, 'cup'), '1'); eq(formatQty(250, 'g'), '250'); eq(formatQty(1.44, 'cup'), '1.44');
});
t('unit aliases incl. T vs t', () => {
  eq(normalizeUnit('T'), 'tbsp'); eq(normalizeUnit('t'), 'tsp'); eq(normalizeUnit('Cups'), 'cup'); eq(normalizeUnit('lbs.'), 'lb');
});
t('ingredient line: basic', () => {
  const i = parseIngredientLine('1 1/2 cups all-purpose flour, sifted');
  eq([i.qty, i.unit, i.item, i.note], [1.5, 'cup', 'all-purpose flour', 'sifted']);
});
t('ingredient line: range, bullets, unicode', () => {
  const i = parseIngredientLine('• 2-3 Tbsp. olive oil');
  eq([i.qty, i.qtyMax, i.unit, i.item], [2, 3, 'tbsp', 'olive oil']);
  const j = parseIngredientLine('½ tsp kosher salt');
  eq([j.qty, j.unit, j.item], [0.5, 'tsp', 'kosher salt']);
});
t('ingredient line: package size and glued units', () => {
  const i = parseIngredientLine('1 (14.5 oz) can diced tomatoes');
  eq([i.qty, i.unit, i.item, i.note], [1, 'can', 'diced tomatoes', '14.5 oz']);
  const g = parseIngredientLine('250g butter');
  eq([g.qty, g.unit, g.item], [250, 'g', 'butter']);
});
t('ingredient line: no amount', () => {
  const i = parseIngredientLine('Salt and pepper to taste');
  eq([i.qty, i.item, i.note], [null, 'Salt and pepper', 'to taste']);
  const e = parseIngredientLine('3 large eggs');
  eq([e.qty, e.unit, e.item], [3, '', 'large eggs']);
  const a = parseIngredientLine('a pinch of nutmeg');
  eq([a.qty, a.unit, a.item], [1, 'pinch', 'nutmeg']);
});
t('mass: weight units are exact', () => {
  const m = massOf({ qty: 1, unit: 'lb', item: 'ground beef' });
  ok(near(m.grams, 453.6) && m.exact, 'lb');
});
t('mass: volume uses ingredient density', () => {
  ok(near(massOf({ qty: 1, unit: 'cup', item: 'all-purpose flour' }).grams, 125, 0.02), 'flour 125 g/cup');
  ok(near(massOf({ qty: 1, unit: 'cup', item: 'granulated sugar' }).grams, 200, 0.02), 'sugar 200 g/cup');
  ok(near(massOf({ qty: 1, unit: 'cup', item: 'packed brown sugar' }).grams, 213, 0.03), 'brown sugar');
  ok(near(massOf({ qty: 1, unit: 'tbsp', item: 'butter, melted' }).grams, 14.2, 0.03), 'butter');
  ok(near(massOf({ qty: 1, unit: 'tsp', item: 'baking soda' }).grams, 4.6, 0.03), 'baking soda');
  ok(near(massOf({ qty: 1, unit: 'cup', item: 'peanut butter' }).grams, 258, 0.03), 'peanut butter beats butter');
});
t('mass: counts and packages', () => {
  eq(massOf({ qty: 3, unit: '', item: 'large eggs' }).grams, 150);
  eq(massOf({ qty: 1, unit: 'stick', item: 'butter' }).grams, 113);
  ok(near(massOf({ qty: 2, unit: 'can', item: 'diced tomatoes', note: '14.5 oz' }).grams, 822, 0.01), 'note weight');
  eq(massOf({ qty: null, unit: '', item: 'salt' }).grams, null);
  eq(massOf({ qty: 2, unit: 'cup', item: 'flour', grams: 260 }).grams, 260);
  eq(massOf({ qty: 2, unit: 'cup', item: 'flour', grams: 260 }, 2).grams, 520);
});
t('mass: unknown volume falls back to water and is flagged', () => {
  const m = massOf({ qty: 1, unit: 'cup', item: 'zxqv mix' });
  ok(m.guess && near(m.grams, 236.6), 'guess');
});
t('formatGrams', () => { eq(formatGrams(1250), '1.25 kg'); eq(formatGrams(4.62), '4.6 g'); eq(formatGrams(125.4), '125 g'); });

const CARD = `GRANDMA JO'S APPLE CRISP
A fall favorite from the farm.
Serves 8
Prep time: 20 min

Ingredients
6 medium apples, peeled and sliced
1 tbsp lemon juice
For the topping:
1 cup rolled oats
3/4 cup packed brown sugar
½ cup all-purpose flour
1 tsp cinnamon
1/2 cup cold butter, cubed

Directions
1. Heat oven to 350°F. Butter a 9x13
pan.
2. Toss apples with lemon juice and spread in the pan.
3. Mix topping until crumbly; sprinkle over apples.
4. Bake 45 minutes until golden.

Notes
Great with vanilla ice cream.`;

t('recipe text with headings', () => {
  const r = parseRecipeText(CARD);
  eq(r.title, "Grandma Jo's Apple Crisp");
  eq(r.description, 'A fall favorite from the farm.');
  eq(r.servings, 8); eq(r.prepTime, '20 min');
  eq(r.ingredients.length, 7);
  eq(r.ingredients[2].section, 'topping');
  eq(r.ingredients[3].item, 'packed brown sugar');
  eq(r.steps.length, 4);
  eq(r.steps[0], 'Heat oven to 350°F. Butter a 9x13 pan.');
  eq(r.notes, 'Great with vanilla ice cream.');
});
t('recipe text without headings', () => {
  const r = parseRecipeText(`Easy Pancakes\n1 cup flour\n2 tbsp sugar\n1 egg\n1 cup milk\nWhisk everything together.\nCook on a hot griddle until bubbly, then flip.`);
  eq(r.title, 'Easy Pancakes'); eq(r.ingredients.length, 4); eq(r.steps.length, 2);
});
t('splitSteps paragraphs', () => {
  eq(splitSteps(['Mix the dry', 'ingredients well.', '', 'Bake.']), ['Mix the dry ingredients well.', 'Bake.']);
});
t('grocery merges across recipes and units', () => {
  let l = addToList([], [{ qty: 1, unit: 'cup', item: 'all-purpose flour' }, { qty: 2, unit: '', item: 'eggs' }], 'Pancakes');
  l = addToList(l, [{ qty: 2, unit: 'tbsp', item: 'all-purpose flour, sifted' }, { qty: 1, unit: '', item: 'large egg' }], 'Gravy', 2);
  const flour = l.find((e) => e.key === itemKey('flour') || e.name.includes('flour'));
  eq(l.length, 2);
  ok(near(flour.grams, 125 + 4 * 14.7868 * 0.528, 0.02), 'flour grams');
  const c = combineQty(flour.qtyByUnit); ok(near(c.cup, 1.25, 0.01), 'cups combined');
  eq(flour.from, ['Pancakes', 'Gravy']);
  eq(l[1].qtyByUnit.each, 4);
});
t('aisles', () => { eq(aisleFor('cold butter'), 'Dairy & Eggs'); eq(aisleFor('apples'), 'Produce'); eq(aisleFor('cinnamon'), 'Spices & Seasonings'); eq(aisleFor('brown sugar'), 'Baking'); eq(aisleFor('apple cider'), 'Drinks'); eq(aisleFor('apple cider vinegar'), 'Oils, Vinegars & Condiments'); eq(itemKey('all-purpose flour'), itemKey('flour')); });
t('aisle order covers every aisle once', () => { eq(new Set(AISLE_ORDER).size, AISLE_ORDER.length); });

t('main ingredient auto-detect', () => {
  eq(detectProtein({ title: 'Lemon Herb Chicken', ingredients: [] }), 'chicken');
  eq(detectProtein({ title: 'Sunday Dinner', ingredients: [{ item: '2 lb chuck roast' }, { item: 'beef broth' }] }), 'beef');
  eq(detectProtein({ title: 'Grilled Ribeye', ingredients: [{ item: 'butter' }] }), 'beef');
  eq(detectProtein({ title: 'Garlic Shrimp Pasta', ingredients: [] }), 'fish');
  eq(detectProtein({ title: 'Risotto', ingredients: [{ item: 'arborio rice' }, { item: 'chicken broth' }] }), '');
  eq(detectProtein({ title: 'Veggie Chili', ingredients: [{ item: 'black beans' }, { item: 'vegetable broth' }] }), 'vegetarian');
  eq(detectProtein({ title: 'Apple Crisp', category: 'Dessert', ingredients: [{ item: 'apples' }] }), '');
  eq(detectProtein({ title: 'Carbonara', ingredients: [{ item: 'spaghetti' }, { item: 'pancetta' }] }), 'pork');
  eq(proteinOf({ protein: 'turkey', title: 'Chicken Soup' }), 'turkey');
});
t('course and ingredient lists have unique values', () => {
  eq(new Set(COURSES.map((c) => c[0])).size, COURSES.length); eq(new Set(PROTEINS.map((c) => c[0])).size, PROTEINS.length);
});

t('whose recipe from the title', () => {
  eq(splitTitle('Stuffing-mom/dad'), { title: 'Stuffing', from: 'Mom/Dad' });
  eq(splitTitle('Potato pie-nanny’s'), { title: 'Potato pie', from: 'Nanny' });
  eq(splitTitle('Pot Roast (Aunt May)'), { title: 'Pot Roast', from: 'Aunt May' });
  eq(splitTitle('Avocado-grilled'), { title: 'Avocado-grilled', from: '' });
  eq(splitTitle('Recipe for Lentil Soup'), { title: 'Lentil Soup', from: '' });
  eq(splitTitle("Grandma's Apple Pie"), { title: "Grandma's Apple Pie", from: 'Grandma' });
});
t('ingredient shorthand from family cookbooks', () => {
  const a = parseIngredientLine('1t. salt'); eq([a.qty, a.unit, a.item], [1, 'tsp', 'salt']);
  const b = parseIngredientLine('1/4c. melted butter'); eq([b.qty, b.unit, b.item], [0.25, 'cup', 'melted butter']);
  const c = parseIngredientLine('Heavy cream (1/2 cup)'); eq([c.qty, c.unit, c.item], [0.5, 'cup', 'Heavy cream']);
  const d = parseIngredientLine('Half cup of rice'); eq([d.qty, d.unit, d.item], [0.5, 'cup', 'rice']);
  const e = parseIngredientLine('1” piece ginger, grated'); eq([e.qty, e.unit, e.item], [1, 'piece', 'ginger']);
  const f = parseIngredientLine('Pinch of salt'); eq([f.qty, f.unit], [1, 'pinch']);
  const g = parseIngredientLine('¼ tp pepper'); eq([g.qty, g.unit], [0.25, 'tsp']);
});
t('cookbook: split by headings, sort each recipe', () => {
  const blocks = [
    { level: 0, text: '' },
    { level: 1, text: 'Pot roast-dad' }, { level: 0, text: '3 lb chuck roast' }, { level: 0, text: 'Carrots' }, { level: 0, text: 'Onion' }, { level: 0, text: '' },
    { level: 0, text: 'Brown the roast on all sides' }, { level: 0, text: 'Cook 3 hours at 300' },
    { level: 1, text: 'Sugar cookies' }, { level: 4, text: 'INGREDIENTS' }, { level: 0, text: '1 cup butter' }, { level: 0, text: '2 cups flour' },
    { level: 4, text: 'DIRECTIONS' }, { level: 0, text: 'Cream the butter.' }, { level: 0, text: 'Read more: http://example.com/cookies' },
    { level: 1, text: 'Chili' },
  ];
  const book = splitCookbook(blocks);
  eq(book.map((b) => b.title), ['Pot roast-dad', 'Sugar cookies', 'Chili']);
  const roast = parseRecipeText(book[0].text, { title: book[0].title, paragraphs: true });
  eq([roast.title, roast.from, roast.ingredients.length, roast.steps.length], ['Pot roast', 'Dad', 3, 2]);
  eq([detectCourse(roast), detectProtein(roast)], ['Main', 'beef']);
  const cookies = parseRecipeText(book[1].text, { title: book[1].title, paragraphs: true });
  eq([cookies.ingredients.length, cookies.steps, cookies.source], [2, ['Cream the butter.'], 'http://example.com/cookies']);
  eq(detectCourse(cookies), 'Dessert');
  const chili = parseRecipeText(book[2].text, { title: book[2].title, paragraphs: true });
  eq([chili.ingredients.length, chili.steps.length, detectCourse(chili)], [0, 0, 'Soup']);
  eq(splitCookbook([{ level: 0, text: 'one recipe' }]), []);
});
t('meat only in the steps is not vegetarian', () => {
  eq(detectProtein({ title: 'Stuffing', ingredients: [{ item: 'bread' }], steps: ['brown 1/2 lb pork sausage'] }), '');
});
t('course detection', () => {
  eq(detectCourse({ title: 'Potato pie' }), 'Side'); eq(detectCourse({ title: 'Fruit tart' }), 'Dessert');
  eq(detectCourse({ title: 'Banana Bread' }), 'Bread'); eq(detectCourse({ title: 'Gravy' }), 'Sauce');
  eq(detectCourse({ title: 'Chocolate Pretzels' }), 'Snack'); eq(detectCourse({ title: 'Red coconut curry' }), 'Main');
  eq(detectCourse({ title: 'Something', courseHint: 'Main' }), 'Main');
});

console.log(`\n${pass}/${pass + fail} tests passed`);
process.exit(fail ? 1 : 0);
