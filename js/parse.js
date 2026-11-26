// Turn free text (typed, pasted, OCR'd from a photo, or pulled from a Word file)
// into a structured recipe. Pure module: no DOM.
import { normalizeUnit, parseNumber, VULGAR_CHARS } from './units.js';

const NUM = `(?:\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*\\/\\s*\\d+|\\d+(?:[.,]\\d+)?\\s*[${VULGAR_CHARS}]?|[${VULGAR_CHARS}]|\\.\\d+)`;
const QTY_RE = new RegExp(`^(${NUM})(?:\\s*(?:-|–|—|to|or)\\s*(${NUM}))?`, 'i');
const BULLET_RE = /^\s*(?:[-•*·▪●○◦–—]|\d+[.)]\s+(?=\D)|\[\s?\]|☐)\s*/;

export function cleanLine(s) {
  return String(s || '')
    .replace(/ /g, ' ')
    .replace(/⁄/g, '/')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// "1 1/2 cups all-purpose flour, sifted" -> { qty: 1.5, unit: 'cup', item: 'all-purpose flour', note: 'sifted' }
export function parseIngredientLine(line) {
  let s = cleanLine(line).replace(/^\s*(?:[-•*·▪●○◦–—]|\[\s?\]|☐)\s*/, '');
  const out = { qty: null, qtyMax: null, unit: '', item: '', note: '', raw: cleanLine(line) };
  if (!s) return out;
  s = s.replace(/^(\d+(?:\/\d+)?)\s*(?:"|-?\s*inch(?:es)?\b)\s*(piece|knob|chunk|stick)s?\s+(?:of\s+)?(.+)$/i, '1 $2 $3 ($1 inch)');
  // "a pinch of", "an onion"
  const art = s.match(/^(a|an|one|two|three|four|five|six|half|a half|half a)\s+(?=\S)/i);
  const WORDNUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, 'a half': 0.5, 'half a': 0.5 };
  const m = s.match(QTY_RE);
  if (m) {
    out.qty = parseNumber(m[1]);
    if (m[2]) out.qtyMax = parseNumber(m[2]);
    s = s.slice(m[0].length).trim();
  } else if (art) {
    out.qty = WORDNUM[art[1].toLowerCase()]; s = s.slice(art[0].length);
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
  if (out.qty == null) {
    const k = notes.findIndex((n) => QTY_RE.test(n) && /^\S+\s*\S*\s*[a-z.]+$/i.test(n));
    if (k >= 0) {
      const p = parseIngredientLine(notes[k] + ' x');
      if (p.qty != null && p.unit) { out.qty = p.qty; out.qtyMax = p.qtyMax; out.unit = p.unit; notes.splice(k, 1); }
    }
  }
  if (out.qty == null && ['pinch', 'dash'].includes(out.unit)) out.qty = 1;
  out.note = notes.filter(Boolean).join('; ');
  return out;
}

export function looksLikeIngredient(line) {
  const s = cleanLine(line).replace(/^\s*(?:[-•*·▪●○◦–—]|\[\s?\]|☐)\s*/, '');
  if (!s || s.length > 90) return false;
  if (/^\d{3}\s*(°|degrees|deg\b|f\b|for\b)/i.test(s)) return false;
  if (/[a-z]\.\s+[A-Z]/.test(s) && s.split(' ').length > 6) return false;
  if (QTY_RE.test(s) && !/^\d+[.)]\s/.test(s) && !/^\d+\s*(minutes?|mins?|hours?|hrs?|degrees|°)/i.test(s)) return true;
  if (/^(a|an)\s+(pinch|dash|handful|few)\b/i.test(s) || /^(pinch|dash|handful)\s+of\b/i.test(s)) return true;
  if (/^(one|two|three|four|half)\s+(cups?|tbsp|tsp|tablespoons?|teaspoons?|lbs?|pounds?|cans?|large|medium|small)\b/i.test(s)) return true;
  if (/\b(to taste|as needed)\b/i.test(s) && s.split(' ').length <= 8) return true;
  return false;
}

const H_ING = /^(ingredients?|what you('|’)?ll need|you('|’)?ll need|you will need|shopping list)(\s*nutrition)?\s*:?\s*$/i;
const H_STEPS = /^(directions?|instructions?|method|preparation|prep(aration)? steps|steps|how to make( it)?|procedure)\s*:?\s*$/i;
const H_NOTES = /^(notes?|tips?|cook'?s notes?|variations?|serving suggestions?|storage)\s*:?\s*$/i;
const META = [
  ['servings', /^(?:serves|servings?|makes)\s*:?\s*(?:about\s*)?(\d+)(?:\s*(?:-|to)\s*\d+)?\b.*$/i],
  ['yield', /^yields?\s*:?\s*(\d+)\s*(?:servings?|people|portions?)?\s*$/i],
  ['makes', /^yields?\s*:?\s*(\d.+)$/i],
  ['prepTime', /^prep(?:aration)?\s*time\s*:?\s*(\d.*)$|^prep\s*:\s*(.+)$/i],
  ['cookTime', /^(?:cook(?:ing)?|bake|baking)\s*time\s*:?\s*(\d.*)$|^(?:cook|bake)\s*:\s*(.+)$/i],
  ['totalTime', /^(?:total(?:\s*time)?|ready in)\s*:?\s*(\d.*)$/i],
  ['course', /^course\s*:?\s*([a-z][a-z ,&]*)$/i],
  ['source', /^(?:source|recipe from|author|adapted from|reference|read more|from|by)\s*:\s*(.+)$|^(?:author|adapted from)\s+(.+)$/i],
  ['skip', /^(?:cuisine|keyword|units|calories|nutrition|print|pin|jump to recipe)\b.*$/i],
];
const URL_RE = /(https?:\/\/\S+|www\.\S+)/i;

// Verbs that usually start an instruction ("Add the…", "Bake 20 min").
const STEP_VERB = /^(add|mix|stir|put|place|cook|bake|heat|pour|cut|chop|slice|dice|mince|dip|whisk|beat|combine|bring|boil|simmer|fry|saute|sauté|brown|roast|grill|broil|preheat|serve|let|remove|cover|refrigerate|chill|freeze|wrap|spread|sprinkle|season|blend|puree|purée|fold|melt|cream|line|fill|top|drain|transfer|repeat|then|now|in a|in the|once|when|while|after|before|take|wash|rinse|soak|pull|rub|toss|marinate|divide|set|use|make|keep|store|layer|arrange|form|roll|shape|knead|whip|mash|peel|trim|cube|grease|spray|scoop|press|bring|reduce|return|flip|turn|garnish|enjoy|eat)\b/i;
const OVEN = /^\d{3}\s*(°|degrees|deg\b|f\b|for\b)/i;

export function looksLikeStep(line) {
  const s = cleanLine(line);
  if (!s) return false;
  const words = s.split(' ').length;
  if (/^(?:step\s*)?\d+\s*[.)]\s+\D/i.test(s)) return true; // "1. Slice the…"
  if (OVEN.test(s)) return true;
  if (looksLikeIngredient(s)) return false;
  if (s.length > 75) return true;
  if (STEP_VERB.test(s) && words >= 2) return true;
  if (/[.!]$/.test(s) && words >= 4) return true;
  return false;
}

// "Stuffing-mom/dad" -> { title: 'Stuffing', from: 'Mom/Dad' }; "Grandma's Pie" keeps its title, from 'Grandma'.
const REL = "(?:mom|mommy|mother|dad|daddy|father|nanny|nana|nan|nonna|grandma|grandmother|grandpa|grandfather|granny|gram|gramps|papa|pop|pops|mimi|meemaw|memaw|aunt(?:ie)?\\s+[a-z]+|uncle\\s+[a-z]+)";
const FROM_SUFFIX = new RegExp(`^(.*?\\S)\\s*[-–—(]\\s*(${REL}(?:\\s*(?:/|&|and|,)\\s*${REL})*)(?:['’]s)?\\s*\\)?\\s*$`, 'i');
const FROM_PREFIX = new RegExp(`^(${REL})['’]s\\s+\\S`, 'i');
const capWords = (s) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
export function splitTitle(raw) {
  let title = cleanLine(raw).replace(/^recipe\s*(?:for|:)\s*/i, '');
  let from = '';
  const m = title.match(FROM_SUFFIX);
  if (m) { title = m[1].trim(); from = capWords(m[2].replace(/\s*(\/|&|and|,)\s*/gi, (x, sep) => (sep === '/' ? '/' : ' & '))); }
  else { const p = title.match(FROM_PREFIX); if (p) from = capWords(p[1]); }
  if (/^[A-Z0-9 '&-]+$/.test(title) && title.length > 3) title = titleCase(title);
  if (title) title = title[0].toUpperCase() + title.slice(1);
  return { title, from };
}

// Split OCR/Word text into a recipe draft. opts.title: title already known (e.g. a Word heading).
export function parseRecipeText(text, opts = {}) {
  const rawLines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const r = { title: '', from: '', description: '', servings: null, prepTime: '', cookTime: '', source: '', courseHint: '', ingredients: [], steps: [], notes: '' };
  const lines = rawLines.map(cleanLine);
  const hasTitle = !!opts.title;
  let section = hasTitle ? 'start' : 'head';
  let ingSection = '';
  let stepPrefix = '';
  const head = [], stepLines = [], noteLines = [];
  const hasHeaders = lines.some((l) => H_ING.test(l) || H_STEPS.test(l));
  const pushStep = (l) => { stepLines.push(stepPrefix ? stepPrefix + ' ' + l : l); stepPrefix = ''; };

  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (!l) { if (section === 'steps') stepLines.push(''); if (section === 'notes') noteLines.push(''); continue; }
    if (H_ING.test(l)) { section = 'ing'; continue; }
    if (H_STEPS.test(l)) { section = 'steps'; continue; }
    if (H_NOTES.test(l)) { section = 'notes'; continue; }
    // links: "Read more: http://…", "Banana Bread https://…" -> source
    const url = l.match(URL_RE);
    if (url && (l.length - url[0].length < 60 || /^(read more|reference|source)/i.test(l))) { if (!r.source) r.source = url[0].replace(/[).,]+$/, ''); continue; }
    const meta = META.find(([, re]) => re.test(l));
    if (meta && section !== 'steps' && section !== 'notes') {
      const mm = l.match(meta[1]);
      const v = (mm[1] || mm[2] || '').trim();
      if (meta[0] === 'servings') r.servings = r.servings || parseInt(v, 10);
      else if (meta[0] === 'yield') r.servings = r.servings || parseInt(v, 10);
      else if (meta[0] === 'totalTime') { if (!r.cookTime) r.cookTime = v; }
      else if (meta[0] === 'course') r.courseHint = v;
      else if (meta[0] === 'makes') r.description = (r.description ? r.description + ' ' : '') + 'Makes ' + v + '.';
      else if (meta[0] !== 'skip') r[meta[0]] = v;
      continue;
    }
    // inline "Notes: blah"
    const inlineNote = l.match(/^(?:notes?|tip)\s*:\s*(.+)$/i);
    if (inlineNote) { section = 'notes'; noteLines.push(inlineNote[1]); continue; }

    if (section === 'start') {
      // Title is known: a long sentence first is the description, otherwise the body starts.
      if (!looksLikeIngredient(l) && l.length > 60 && /[.!]$/.test(l) && !r.ingredients.length) { head.push(l); continue; }
      section = hasHeaders ? (looksLikeIngredient(l) ? 'ing' : 'head') : (looksLikeStep(l) ? 'steps' : 'ing');
    } else if (section === 'head' && (hasTitle || head.length) && looksLikeIngredient(l)) section = 'ing';

    if (!hasHeaders) {
      // No headings: ingredients until the first instruction, then instructions.
      if (section === 'head' && head.length && looksLikeIngredient(l)) section = 'ing';
      else if (section === 'ing' && looksLikeStep(l)) section = 'steps';
      else if (section === 'ing' && /^to make\b.*:$/i.test(l)) { section = 'steps'; stepPrefix = l; continue; }
    }

    if (section === 'head') head.push(l);
    else if (section === 'ing') {
      if (/:$/.test(l) && !looksLikeIngredient(l) && l.split(' ').length <= 6) { ingSection = l.replace(/:$/, '').replace(/^for (the )?/i, '').trim(); continue; }
      const prev = r.ingredients[r.ingredients.length - 1];
      // wrapped line: starts lowercase / "(" and has no amount -> continues the previous ingredient
      const wrap = opts.paragraphs ? /^(\(|or\s|and\s)/i.test(l) : /^[a-z(]/.test(l);
      if (prev && wrap && !looksLikeIngredient(l) && l.split(' ').length <= 5) {
        const merged = parseIngredientLine(prev.raw + ' ' + l);
        Object.assign(prev, merged, { section: prev.section });
        continue;
      }
      const ing = parseIngredientLine(l);
      ing.section = ingSection;
      r.ingredients.push(ing);
    } else if (section === 'steps') {
      if (/:$/.test(l) && l.split(' ').length <= 6) { stepPrefix = l; continue; }
      pushStep(l);
    } else noteLines.push(l);
  }

  const headClean = head.filter((l) => !/^(recipe|page \d+)$/i.test(l));
  const t = splitTitle(hasTitle ? opts.title : headClean.shift() || '');
  r.title = t.title;
  r.from = t.from;
  r.description = [headClean.join(' '), r.description].filter(Boolean).join(' ');
  r.steps = splitSteps(stepLines, opts.paragraphs);
  r.notes = noteLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return r;
}

// A Word file with several recipes: blocks [{ level: 1-6 for headings or 0, text }].
// Recipes start at the most-used top heading level; returns [{ title, text }].
export function splitCookbook(blocks) {
  const counts = {};
  for (const b of blocks) if (b.level && cleanLine(b.text)) counts[b.level] = (counts[b.level] || 0) + 1;
  const level = Object.keys(counts).map(Number).sort((a, b) => a - b).find((lv) => counts[lv] >= 2);
  if (!level) return [];
  const out = [];
  let cur = null;
  for (const b of blocks) {
    const t = cleanLine(b.text);
    if (b.level === level && t) { cur = { title: t, lines: [] }; out.push(cur); continue; }
    if (cur) cur.lines.push(t);
  }
  return out.map((c) => ({ title: c.title, text: c.lines.join('\n').replace(/^\n+|\n+$/g, '') }));
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/'S\b/g, "'s");
}

// Steps: numbered ("1.", "Step 2:") or paragraphs. Wrapped lines are joined.
export function splitSteps(lines, paragraphs = false) {
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
      const joins = paragraphs ? /^[a-z]/.test(l) && !/[.!?)]$/.test(cur) : /^[a-z]/.test(l) || !/[.!?)]$/.test(cur);
      if (cur && joins) cur += ' ' + l;
      else { push(); cur = l; }
    }
  }
  push();
  return steps;
}
