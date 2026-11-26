// Turn free text (typed, pasted, OCR'd from a photo, or pulled from a Word file)
// into a structured recipe. Pure module: no DOM.
import { normalizeUnit, parseNumber, VULGAR_CHARS } from './units.js';

const NUM = `(?:\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*\\/\\s*\\d+|\\d+(?:[.,]\\d+)?\\s*[${VULGAR_CHARS}]?|[${VULGAR_CHARS}]|\\.\\d+)`;
const QTY_RE = new RegExp(`^(${NUM})(?:\\s*(?:-|–|—|to|or)\\s*(${NUM}))?`, 'i');
const BULLET_RE = /^\s*(?:[-•*·▪●○◦–—]|\d+[.)]\s+(?=\D)|\[\s?\]|☐)\s*/;

export function cleanLine(s) {
  return String(s || '')
    .replace(/ /g, ' ')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// "1 1/2 cups all-purpose flour, sifted" -> { qty: 1.5, unit: 'cup', item: 'all-purpose flour', note: 'sifted' }
export function parseIngredientLine(line) {
  let s = cleanLine(line).replace(/^\s*(?:[-•*·▪●○◦–—]|\[\s?\]|☐)\s*/, '');
  const out = { qty: null, qtyMax: null, unit: '', item: '', note: '', raw: cleanLine(line) };
  if (!s) return out;
  // "a pinch of", "an onion"
  const art = s.match(/^(a|an|one)\s+(?=\S)/i);
  const m = s.match(QTY_RE);
  if (m) {
    out.qty = parseNumber(m[1]);
    if (m[2]) out.qtyMax = parseNumber(m[2]);
    s = s.slice(m[0].length).trim();
  } else if (art) {
    out.qty = 1; s = s.slice(art[0].length);
  }
  // package size right after the number: "1 (14 oz) can tomatoes"
  let pre = '';
  const pm = s.match(/^\(([^)]*)\)\s*/);
  if (pm) { pre = pm[1].trim(); s = s.slice(pm[0].length); }
  // unit: try two words ("fl oz", "fluid ounces") then one word
  const words = s.split(' ');
  const two = words.slice(0, 2).join(' ');
  let u = '';
  if (words.length > 1 && normalizeUnit(two) && /\s/.test(two)) { u = normalizeUnit(two); words.splice(0, 2); }
  else if (words[0]) {
    const w = words[0].replace(/[.,]$/, '');
    // don't eat the first word if it's the whole ingredient ("2 cans" is ok, "1 c" needs an item after)
    if (normalizeUnit(w) && words.length > 1) { u = normalizeUnit(w); words.shift(); }
    else if (normalizeUnit(w) && out.qty != null && ['g', 'kg', 'ml', 'l', 'oz', 'lb'].includes(normalizeUnit(w))) { u = normalizeUnit(w); words.shift(); }
  }
  // "250g flour" -> number glued to unit
  if (!u && out.qty == null) {
    const g = s.match(/^(\d+(?:[.,]\d+)?)([a-zA-Z]+)\b\s*(.*)$/);
    if (g && normalizeUnit(g[2])) { out.qty = parseNumber(g[1]); u = normalizeUnit(g[2]); words.length = 0; words.push(...g[3].split(' ')); }
  }
  out.unit = u;
  let rest = words.join(' ').replace(/^of\s+/i, '').trim();
  // notes: parentheses and text after the first comma
  const notes = [];
  if (pre) notes.push(pre);
  rest = rest.replace(/\(([^)]*)\)/g, (_, n) => { notes.push(n.trim()); return ' '; }).replace(/\s+/g, ' ').trim();
  const comma = rest.indexOf(',');
  if (comma > 0) { notes.push(rest.slice(comma + 1).trim()); rest = rest.slice(0, comma).trim(); }
  const taste = rest.match(/\s+(to taste|as needed|for serving|for garnish|optional)$/i);
  if (taste) { notes.push(taste[1]); rest = rest.slice(0, taste.index).trim(); }
  out.item = rest;
  out.note = notes.filter(Boolean).join('; ');
  return out;
}

export function looksLikeIngredient(line) {
  const s = cleanLine(line).replace(/^\s*(?:[-•*·▪●○◦–—]|\[\s?\]|☐)\s*/, '');
  if (!s || s.length > 90) return false;
  if (QTY_RE.test(s) && !/^\d+[.)]\s/.test(s) && !/^\d+\s*(minutes?|mins?|hours?|hrs?|degrees|°)/i.test(s)) return true;
  if (/^(a|an)\s+(pinch|dash|handful|few)\b/i.test(s)) return true;
  if (/\b(to taste|as needed)\b/i.test(s) && s.split(' ').length <= 8) return true;
  return false;
}

const H_ING = /^(ingredients?|what you('|’)?ll need|you('|’)?ll need|you will need|shopping list)\b\s*:?\s*$/i;
const H_STEPS = /^(directions?|instructions?|method|preparation|prep(aration)? steps|steps|how to make( it)?|procedure|to make)\b\s*:?\s*$/i;
const H_NOTES = /^(notes?|tips?|cook'?s notes?|variations?|serving suggestions?|storage)\b\s*:?\s*$/i;
const META = [
  ['servings', /^(?:serves|servings?|yield|yields|makes)\s*:?\s*(?:about\s*)?(\d+)(?:\s*(?:-|to)\s*\d+)?\b.*$/i],
  ['prepTime', /^prep(?:aration)?(?:\s*time)?\s*:\s*(.+)$/i],
  ['cookTime', /^(?:cook(?:ing)?|bake|baking)(?:\s*time)?\s*:\s*(.+)$/i],
  ['totalTime', /^total(?:\s*time)?\s*:\s*(.+)$/i],
  ['source', /^(?:from|source|recipe from|by)\s*:\s*(.+)$/i],
];

// Split OCR/Word text into a recipe draft.
export function parseRecipeText(text) {
  const rawLines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const r = { title: '', description: '', servings: null, prepTime: '', cookTime: '', source: '', ingredients: [], steps: [], notes: '' };
  const lines = rawLines.map(cleanLine);
  let section = 'head';
  let ingSection = '';
  const head = [], stepLines = [], noteLines = [];
  const hasHeaders = lines.some((l) => H_ING.test(l) || H_STEPS.test(l));

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) { if (section === 'steps') stepLines.push(''); if (section === 'notes') noteLines.push(''); continue; }
    if (H_ING.test(l)) { section = 'ing'; continue; }
    if (H_STEPS.test(l)) { section = 'steps'; continue; }
    if (H_NOTES.test(l)) { section = 'notes'; continue; }
    const meta = META.find(([, re]) => re.test(l));
    if (meta && section !== 'steps' && section !== 'notes') {
      const v = l.match(meta[1])[1].trim();
      if (meta[0] === 'servings') r.servings = parseInt(v, 10);
      else if (meta[0] === 'totalTime') { if (!r.cookTime) r.cookTime = v; }
      else r[meta[0]] = v;
      continue;
    }
    // inline "Notes: blah"
    const inlineNote = l.match(/^(?:notes?|tip)\s*:\s*(.+)$/i);
    if (inlineNote) { section = 'notes'; noteLines.push(inlineNote[1]); continue; }

    if (!hasHeaders) {
      // No headings: decide line by line.
      if (looksLikeIngredient(l) && section !== 'steps') { section = 'ing'; }
      else if (section === 'ing' && !/:$/.test(l)) { section = 'steps'; }
    }

    if (section === 'head') head.push(l);
    else if (section === 'ing') {
      if (/:$/.test(l) && !looksLikeIngredient(l)) { ingSection = l.replace(/:$/, '').replace(/^for (the )?/i, '').trim(); continue; }
      const prev = r.ingredients[r.ingredients.length - 1];
      // OCR wrap: a line starting lowercase with no amount continues the previous ingredient
      if (prev && /^[a-z(]/.test(l) && !looksLikeIngredient(l) && l.split(' ').length <= 5) {
        const merged = parseIngredientLine(prev.raw + ' ' + l);
        Object.assign(prev, merged, { section: prev.section });
        continue;
      }
      const ing = parseIngredientLine(l);
      ing.section = ingSection;
      r.ingredients.push(ing);
    } else if (section === 'steps') stepLines.push(l);
    else noteLines.push(l);
  }

  // Title + description from the head.
  const headClean = head.filter((l) => !/^(recipe|page \d+)$/i.test(l));
  r.title = (headClean.shift() || '').replace(/^recipe\s*:\s*/i, '');
  if (/^[A-Z0-9 '&-]+$/.test(r.title) && r.title.length > 3) r.title = titleCase(r.title);
  r.description = headClean.join(' ');
  r.steps = splitSteps(stepLines);
  r.notes = noteLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return r;
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/'S\b/g, "'s");
}

// Steps: numbered ("1.", "Step 2:") or paragraphs. Wrapped lines are joined.
export function splitSteps(lines) {
  const steps = [];
  const numbered = lines.filter((l) => /^\s*(?:step\s*)?\d+\s*[.):-]\s*/i.test(l)).length;
  let cur = '';
  const push = () => { const t = cur.trim(); if (t) steps.push(t); cur = ''; };
  for (const l of lines) {
    if (!l) { if (!numbered) push(); continue; }
    const m = l.match(/^\s*(?:step\s*)?\d+\s*[.):-]\s*(.*)$/i);
    const bullet = l.match(/^\s*[-•*·▪●]\s*(.*)$/);
    if (numbered >= 2 && m) { push(); cur = m[1]; }
    else if (bullet) { push(); cur = bullet[1]; }
    else if (numbered >= 2) cur += (cur ? ' ' : '') + l;
    else {
      // paragraph mode: join lines that look like a wrap (previous doesn't end a sentence or next starts lowercase)
      if (cur && (/^[a-z]/.test(l) || !/[.!?)]$/.test(cur))) cur += ' ' + l;
      else { push(); cur = l; }
    }
  }
  push();
  return steps;
}
