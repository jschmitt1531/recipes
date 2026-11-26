import { firebaseConfig } from './config.js';
import { LocalStore, FirebaseStore, ROLES, ROLE_INFO, can } from './store.js';
import { UNITS, massOf, formatGrams, formatQty, parseNumber, unitLabel } from './units.js';
import { parseIngredientLine, parseRecipeText, splitCookbook } from './parse.js';
import { addToList, combineQty, AISLE_ORDER, listToText } from './grocery.js';
import { COURSES, PROTEINS, courseLabel, courseIcon, proteinLabel, proteinIcon, proteinOf, detectProtein, detectCourse } from './categories.js';
import { compressImage, ocrImage, readWordDocument, readTextFile } from './importers.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

const S = {
  store: null, me: null, recipes: [], grocery: [], draft: null,
  filter: { q: '', show: 'all', cat: '', protein: '', by: '', sort: 'new' },
  scale: {}, gramsOnly: false, unsub: [],
};

// ---------------------------------------------------------------- utils ---
export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function when(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = Date.now(), diff = (now - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + ' h ago';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' d ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const initials = (n) => (String(n || '').match(/\p{L}[\p{L}'’-]*/gu) || ['?']).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
function avatar(name) {
  let h = 0; for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) % 5;
  return `<span class="avatar a${h}" aria-hidden="true">${esc(initials(name))}</span>`;
}
async function guard(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { console.error(e); toast(friendlyError(e), 5000); return undefined; }
}
function friendlyError(e) {
  const c = (e && e.code) || '';
  if (/permission-denied/.test(c)) return "You don't have permission to do that. Ask the family owner.";
  if (/unavailable|network/.test(c)) return "You're offline. It will sync when you're back online.";
  if (/wrong-password|invalid-credential|user-not-found|invalid-login/.test(c)) return 'That email and password don\'t match. Try again, or tap "Forgot password?".';
  if (/email-already-in-use/.test(c)) return 'There is already an account with that email — tap "Sign in" instead.';
  if (/weak-password/.test(c)) return 'Please use a password with at least 6 characters.';
  if (/invalid-email/.test(c)) return 'That email address doesn\'t look right.';
  if (/too-many-requests/.test(c)) return 'Too many tries. Wait a minute and try again.';
  if (/popup-closed|cancelled-popup/.test(c)) return 'Sign-in was closed before it finished.';
  if (/unauthorized-domain/.test(c)) return 'This web address isn\'t allowed to sign in yet. The owner needs to add it in Firebase → Authentication → Settings → Authorized domains.';
  if (/operation-not-allowed/.test(c)) return 'This sign-in method is turned off. The owner needs to enable it in Firebase → Authentication → Sign-in method.';
  return (e && e.message) || 'Something went wrong.';
}
function pickFile(accept, capture) {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; if (capture) i.capture = 'environment';
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}
const qtyText = (q, qMax, unit, scale = 1) => {
  if (q == null || q === '') return '';
  let s = formatQty(q * scale, unit);
  if (qMax != null && qMax !== '') s += '–' + formatQty(qMax * scale, unit);
  return s;
};
const fromNames = (r) => String(r.from || '').split(/\s*(?:\/|&|,|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
const favNames = (r) => Object.values(r.favorites || {});
const isFav = (r) => !!(r.favorites && S.me && r.favorites[S.me.uid]);

// --------------------------------------------------------------- router ---
function route() {
  S.unsub.forEach((f) => f()); S.unsub = [];
  const h = location.hash.replace(/^#/, '') || '/';
  const [, a, b] = h.split('/');
  if (a !== 'new' && a !== 'edit') S.draft = null;
  $$('.tabs a').forEach((el) => el.classList.toggle('on', el.dataset.tab === (a || 'recipes') || (a === 'r' && el.dataset.tab === 'recipes') || ((a === 'new' || a === 'edit' || a === 'import') && el.dataset.tab === 'add')));
  window.scrollTo(0, 0);
  if (!a) return renderList();
  if (a === 'r' && b) return renderRecipe(b);
  if (a === 'edit' && b) return renderEditor(b);
  if (a === 'new') return renderEditor(null);
  if (a === 'add' || a === 'import') return renderAdd();
  if (a === 'grocery') return renderGrocery();
  if (a === 'family') return renderFamily();
  renderList();
}
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };

// ----------------------------------------------------------------- list ---
function renderList() {
  const f = S.filter;
  const people = [...new Set(S.recipes.flatMap((r) => [...fromNames(r), r.createdBy && r.createdBy.name]).filter(Boolean))].sort();
  view.innerHTML = `
    <section class="list-head">
      <div class="search"><span aria-hidden="true">🔍</span><input id="q" type="search" placeholder="Search recipes, ingredients, notes…" value="${esc(f.q)}" aria-label="Search recipes"></div>
      <div class="chips" role="group" aria-label="Show">
        ${[['all', 'All'], ['fav', '♥ My favorites'], ['loved', '★ Family favorites'], ['mine', 'Added by me']].map(([k, l]) => `<button class="chip ${f.show === k ? 'on' : ''}" data-show="${k}">${l}</button>`).join('')}
      </div>
      <div class="chip-row"><span class="chip-label">Course</span><div class="chips" role="group" aria-label="Course" id="cat-chips"></div></div>
      <div class="chip-row"><span class="chip-label">Main ingredient</span><div class="chips" role="group" aria-label="Main ingredient" id="pro-chips"></div></div>
      <div class="filters">
        <select id="by" aria-label="Whose recipe"><option value="">Everyone's recipes</option>${people.map((p) => `<option ${f.by === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <select id="sort" aria-label="Sort"><option value="new" ${f.sort === 'new' ? 'selected' : ''}>Newest</option><option value="az" ${f.sort === 'az' ? 'selected' : ''}>A–Z</option><option value="loved" ${f.sort === 'loved' ? 'selected' : ''}>Most loved</option><option value="updated" ${f.sort === 'updated' ? 'selected' : ''}>Recently changed</option><option value="g-course" ${f.sort === 'g-course' ? 'selected' : ''}>Group by course</option><option value="g-protein" ${f.sort === 'g-protein' ? 'selected' : ''}>Group by main ingredient</option></select>
      </div>
    </section>
    <section id="cards" class="cards"></section>`;
  const draw = () => {
    const q = f.q.trim().toLowerCase();
    let rs = S.recipes.filter((r) => {
      if (f.show === 'fav' && !isFav(r)) return false;
      if (f.show === 'loved' && favNames(r).length < 2) return false;
      if (f.show === 'mine' && !(r.createdBy && r.createdBy.uid === S.me.uid)) return false;
      if (f.cat && r.category !== f.cat) return false;
      if (f.protein && proteinOf(r) !== f.protein) return false;
      if (f.by && !fromNames(r).includes(f.by) && !(r.createdBy && r.createdBy.name === f.by)) return false;
      if (q) {
        const hay = [r.title, r.from, r.description, r.notes, r.category, courseLabel(r.category), proteinLabel(proteinOf(r)), (r.tags || []).join(' '), r.source, r.createdBy && r.createdBy.name, ...(r.ingredients || []).map((i) => i.item)].join(' ').toLowerCase();
        return q.split(/\s+/).every((w) => hay.includes(w));
      }
      return true;
    });
    const by = { new: (a, b) => (b.createdAt || 0) - (a.createdAt || 0), az: (a, b) => (a.title || '').localeCompare(b.title || ''), loved: (a, b) => favNames(b).length - favNames(a).length, updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) };
    rs.sort(by[f.sort] || by.az);
    drawChips();
    const el = $('#cards');
    if (!S.recipes.length) {
      el.innerHTML = `<div class="empty"><div class="empty-leaf" aria-hidden="true">🍂</div><h2>No recipes yet</h2><p>Snap a photo of a recipe card, open a Word document, or type one in.</p>${can(S.me, 'addRecipe') ? '<a class="btn primary" href="#/add">Add the first recipe</a>' : ''}</div>`;
      return;
    }
    if (!rs.length) { el.innerHTML = '<p class="muted center">No recipes match.</p>'; return; }
    if (f.sort === 'g-course' || f.sort === 'g-protein') {
      const course = f.sort === 'g-course';
      const groups = course ? COURSES.map(([v]) => v) : PROTEINS.map(([v]) => v);
      const keyOf = (r) => (course ? r.category : proteinOf(r)) || '';
      const html = [];
      for (const g of groups.concat([''])) {
        const items = rs.filter((r) => keyOf(r) === g);
        if (!items.length) continue;
        const label = g ? (course ? courseIcon(g) + ' ' + courseLabel(g) : proteinIcon(g) + ' ' + proteinLabel(g)) : (course ? 'No course' : 'No main ingredient');
        html.push(`<h2 class="group-h">${esc(label)} <span>${items.length}</span></h2>`, ...items.map(card));
      }
      el.innerHTML = html.join('');
    } else el.innerHTML = rs.map(card).join('');
  };
  // Chip rows show only the courses / main ingredients that have recipes, with counts.
  const drawChips = () => {
    const count = (fn) => S.recipes.reduce((m, r) => { const k = fn(r); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
    const cc = count((r) => r.category), pc = count(proteinOf);
    const chip = (attr, val, on, label, n) => `<button class="chip ${on ? 'on' : ''}" data-${attr}="${esc(val)}">${label}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`;
    $('#cat-chips').innerHTML = chip('cat', '', !f.cat, 'All') + COURSES.filter(([v]) => cc[v] || f.cat === v).map(([v, l, i]) => chip('cat', v, f.cat === v, `${i} ${esc(l)}`, cc[v] || 0)).join('');
    $('#pro-chips').innerHTML = chip('pro', '', !f.protein, 'All') + PROTEINS.filter(([v]) => pc[v] || f.protein === v).map(([v, l, i]) => chip('pro', v, f.protein === v, `${i} ${esc(l)}`, pc[v] || 0)).join('');
    $$('[data-cat]').forEach((b) => b.onclick = () => { f.cat = b.dataset.cat; draw(); });
    $$('[data-pro]').forEach((b) => b.onclick = () => { f.protein = b.dataset.pro; draw(); });
    $('#cat-chips').parentElement.hidden = !Object.keys(cc).length && !f.cat;
    $('#pro-chips').parentElement.hidden = !Object.keys(pc).length && !f.protein;
  };
  draw();
  $('#q').addEventListener('input', (e) => { f.q = e.target.value; draw(); });
  $$('[data-show]').forEach((b) => b.addEventListener('click', () => { f.show = b.dataset.show; $$('[data-show]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  $('#by').onchange = (e) => { f.by = e.target.value; draw(); };
  $('#sort').onchange = (e) => { f.sort = e.target.value; draw(); };
  renderList.redraw = draw;
}
function card(r) {
  const names = favNames(r);
  const mine = isFav(r);
  return `<a class="card ${mine ? 'is-fav' : ''}" href="#/r/${esc(r.id)}">
    <div class="thumb" ${r.thumb ? `style="background-image:url('${esc(r.thumb)}')"` : ''}>${r.thumb ? '' : '<span aria-hidden="true">🍁</span>'}
      ${names.length >= 2 ? '<span class="ribbon">★ Family favorite</span>' : ''}</div>
    <div class="card-body">
      <h3>${esc(r.title || 'Untitled recipe')}</h3>
      <p class="meta">${r.category ? `<span class="tag">${esc(courseIcon(r.category) + ' ' + courseLabel(r.category))}</span>` : ''} ${proteinOf(r) ? `<span class="tag alt">${esc(proteinIcon(proteinOf(r)) + ' ' + proteinLabel(proteinOf(r)))}</span>` : ''} ${r.from ? `from <b>${esc(r.from)}</b>` : r.createdBy ? `by <b>${esc(r.createdBy.name)}</b>` : ''}</p>
      ${names.length ? `<p class="loved"><span class="heart ${mine ? 'on' : ''}" aria-hidden="true">♥</span> ${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ` +${names.length - 3}` : ''}</p>` : ''}
    </div></a>`;
}

// --------------------------------------------------------------- recipe ---
function renderRecipe(id) {
  S.unsub.forEach((f) => f()); S.unsub = [];
  const r = S.recipes.find((x) => x.id === id);
  if (!r) { view.innerHTML = '<p class="center muted">Loading… (or this recipe was deleted)</p><p class="center"><a href="#/">Back to recipes</a></p>'; return; }
  const scale = S.scale[id] || 1;
  const baseServ = +r.servings || 0;
  const names = favNames(r);
  const ings = r.ingredients || [];
  let total = 0, totalKnown = true;
  let lastSection = null;
  const ingHtml = ings.map((ing, i) => {
    const m = massOf(ing, scale);
    if (m.grams != null) total += m.grams; else if (ing.qty != null && ing.qty !== '') totalKnown = false;
    const qt = qtyText(ing.qty, ing.qtyMax, ing.unit, scale);
    const ul = ing.unit ? unitLabel(ing.unit, (ing.qtyMax || ing.qty) * scale) : '';
    const massCls = m.grams == null ? 'mass none' : m.guess ? 'mass guess' : m.exact ? 'mass exact' : 'mass';
    const massTxt = m.grams == null ? (ing.qty == null || ing.qty === '' ? '' : '+ g') : (m.exact ? '' : '≈') + formatGrams(m.grams);
    const sec = ing.section && ing.section !== lastSection ? `<li class="ing-sec">${esc(ing.section)}</li>` : '';
    lastSection = ing.section || lastSection;
    const amount = S.gramsOnly && m.grams != null ? `<b>${(m.exact ? '' : '≈') + formatGrams(m.grams)}</b>` : `<b>${esc(qt)} ${esc(ul)}</b>`;
    return `${sec}<li class="ing"><label><input type="checkbox" data-ing="${i}" checked><span class="amt">${amount}</span> <span class="item">${esc(ing.item)}</span>${ing.note ? ` <span class="note">${esc(ing.note)}</span>` : ''}</label>
      ${S.gramsOnly && m.grams != null ? `<span class="mass orig">${esc(qt)} ${esc(ul)}</span>` : massTxt ? `<button class="${massCls}" data-mass="${i}" title="${esc(m.basis || '')}">${esc(massTxt)}</button>` : ''}</li>`;
  }).join('');
  const canEdit = can(S.me, 'editRecipe', r);
  view.innerHTML = `
    <article class="recipe">
      <div class="hero" ${r.thumb ? `style="background-image:url('${esc(r.thumb)}')"` : ''}>
        <a class="back" href="#/" aria-label="Back to recipes">‹</a>
      </div>
      <header class="r-head">
        <p class="eyebrow">${esc([r.category && courseLabel(r.category), proteinOf(r) && proteinLabel(proteinOf(r))].filter(Boolean).join(' · '))}${(r.tags || []).length ? ' · ' + (r.tags || []).map(esc).join(', ') : ''}</p>
        <h1>${esc(r.title)}</h1>
        ${r.description ? `<p class="lede">${esc(r.description)}</p>` : ''}
        ${r.from ? `<p class="from">${avatar(r.from)} <b>${esc(r.from)}'s recipe</b></p>` : ''}
        <p class="byline">${r.from ? '' : avatar(r.createdBy && r.createdBy.name)} Shared by <b>${esc(r.createdBy ? r.createdBy.name : 'someone')}</b> · ${esc(when(r.createdAt))}${r.updatedBy && r.updatedAt !== r.createdAt ? ` · edited by ${esc(r.updatedBy.name)} ${esc(when(r.updatedAt))}` : ''}</p>
        ${r.source ? `<p class="muted small">Source: ${esc(r.source)}</p>` : ''}
        <div class="r-actions">
          <button class="btn fav ${isFav(r) ? 'on' : ''}" id="fav" aria-pressed="${isFav(r)}"><span class="heart" aria-hidden="true">♥</span> ${isFav(r) ? 'Favorited' : 'Favorite'}</button>
          ${canEdit ? `<a class="btn" href="#/edit/${esc(r.id)}">✎ Edit</a>` : ''}
          <button class="btn" id="share">Share</button>
          <button class="btn" id="print">Print</button>
        </div>
        ${names.length ? `<p class="loved big"><span class="heart on" aria-hidden="true">♥</span> Loved by ${esc(names.join(', '))}</p>` : ''}
        <dl class="facts">
          ${r.prepTime ? `<div><dt>Prep</dt><dd>${esc(r.prepTime)}</dd></div>` : ''}
          ${r.cookTime ? `<div><dt>Cook</dt><dd>${esc(r.cookTime)}</dd></div>` : ''}
          <div><dt>Servings</dt><dd class="scaler"><button id="sdown" aria-label="Fewer servings">−</button><span id="serv">${baseServ ? Math.round(baseServ * scale * 10) / 10 : (scale === 1 ? '1×' : formatQty(scale) + '×')}</span><button id="sup" aria-label="More servings">+</button></dd></div>
          ${total ? `<div><dt>Total weight</dt><dd>${totalKnown ? '' : '≥ '}≈${formatGrams(total)}</dd></div>` : ''}
        </dl>
      </header>

      <section class="panel">
        <div class="panel-head"><h2>Ingredients</h2>
          <div class="seg" role="group" aria-label="Units"><button class="${S.gramsOnly ? '' : 'on'}" data-units="orig">Cups &amp; spoons</button><button class="${S.gramsOnly ? 'on' : ''}" data-units="g">Grams</button></div>
        </div>
        <ul class="ings">${ingHtml || '<li class="muted">No ingredients yet.</li>'}</ul>
        <p class="muted small">Weights marked ≈ are estimates from standard kitchen charts. ${canEdit ? 'Tap a weight to set the exact one.' : ''}</p>
        ${ings.length ? '<button class="btn primary" id="togrocery">🛒 Add checked items to grocery list</button>' : ''}
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Steps</h2>${(r.steps || []).length ? '<button class="btn primary" id="cook">▶ Cook mode</button>' : ''}</div>
        <ol class="steps">${(r.steps || []).map((s, i) => `<li><button class="step" data-step="${i}" aria-pressed="false"><span class="n">${i + 1}</span><span>${esc(s)}</span></button></li>`).join('') || '<li class="muted">No steps yet.</li>'}</ol>
      </section>

      ${r.notes ? `<section class="panel notes"><h2>Notes</h2><p class="pre">${esc(r.notes)}</p></section>` : ''}

      <section class="panel">
        <div class="panel-head"><h2>Photos</h2>${can(S.me, 'addPhoto') ? '<button class="btn" id="addphoto">📷 Add photo</button>' : ''}</div>
        <div id="photos" class="photos"><p class="muted small">Loading…</p></div>
      </section>

      <section class="panel">
        <h2>Comments</h2>
        <div id="comments" class="comments"></div>
        ${can(S.me, 'comment') ? `<form id="cform" class="cform"><textarea id="ctext" rows="2" placeholder="Made this last night — added extra cinnamon…" aria-label="Write a comment" required></textarea><button class="btn primary">Post</button></form>` : ''}
      </section>

      ${(r.history || []).length ? `<details class="panel history"><summary>Change history</summary><ul>${r.history.map((h) => `<li>${esc(h.by)} ${esc(h.what)} · ${esc(new Date(h.at).toLocaleString())}</li>`).join('')}</ul></details>` : ''}
      ${can(S.me, 'deleteRecipe', r) ? '<p class="center"><button class="btn danger" id="del">Delete recipe</button></p>' : ''}
    </article>`;

  $('#fav').onclick = () => guard(() => S.store.toggleFavorite(r));
  $('#print').onclick = () => window.print();
  $('#share').onclick = () => shareRecipe(r, scale);
  const setScale = (k) => { S.scale[id] = Math.max(0.25, k); renderRecipe(id); };
  const step = baseServ ? 1 / baseServ : 0.5;
  $('#sdown').onclick = () => setScale(Math.round((scale - step) * 1000) / 1000);
  $('#sup').onclick = () => setScale(Math.round((scale + step) * 1000) / 1000);
  $$('[data-units]').forEach((b) => b.onclick = () => { S.gramsOnly = b.dataset.units === 'g'; renderRecipe(id); });
  $$('[data-step]').forEach((b) => b.onclick = () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); });
  $$('[data-mass]').forEach((b) => b.onclick = async () => {
    const i = +b.dataset.mass, ing = ings[i];
    const m = massOf(ing, 1);
    if (!canEdit) { toast(m.basis || ''); return; }
    const v = prompt(`Exact weight in grams for "${ing.qty != null ? qtyText(ing.qty, ing.qtyMax, ing.unit) + ' ' + (ing.unit ? unitLabel(ing.unit, ing.qty) : '') : ''} ${ing.item}" (for the original recipe amount).\n${m.basis ? 'Current: ' + (m.grams != null ? formatGrams(m.grams) + ' — ' : '') + m.basis : ''}\nLeave empty to use the estimate.`, ing.grams ?? (m.grams != null ? Math.round(m.grams) : ''));
    if (v === null) return;
    const g = v.trim() === '' ? null : parseFloat(v);
    if (v.trim() !== '' && !isFinite(g)) return toast('Please enter a number of grams.');
    const next = ings.map((x, k) => (k === i ? { ...x, grams: g } : x));
    await guard(() => S.store.saveRecipe({ ...r, ingredients: next }), 'Weight saved');
  });
  const tg = $('#togrocery');
  if (tg) tg.onclick = async () => {
    const chosen = $$('[data-ing]').filter((c) => c.checked).map((c) => ings[+c.dataset.ing]);
    S.grocery = addToList(S.grocery, chosen, r.title, scale);
    await guard(() => S.store.saveGrocery(S.grocery));
    toast(`Added ${chosen.length} item${chosen.length === 1 ? '' : 's'} to your grocery list`);
  };
  const cook = $('#cook'); if (cook) cook.onclick = () => cookMode(r, scale);
  const del = $('#del');
  if (del) del.onclick = async () => { if (confirm(`Delete "${r.title}" for everyone? This can't be undone.`)) { await guard(() => S.store.deleteRecipe(r.id), 'Recipe deleted'); go('#/'); } };
  const ap = $('#addphoto');
  if (ap) ap.onclick = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    const caption = prompt('Add a caption (optional)', '') || '';
    toast('Uploading photo…');
    const data = await guard(() => compressImage(file));
    if (!data) return;
    const pid = await guard(() => S.store.addPhoto(r.id, { data, caption, kind: 'dish' }), 'Photo added');
    if (pid && !r.thumb) { const thumb = await compressImage(data, 640, 0.7); await guard(() => S.store.patchRecipe(r.id, { thumb, coverPhotoId: pid })); }
  };

  S.unsub.push(S.store.subscribePhotos(r.id, (ps) => {
    const el = $('#photos'); if (!el) return;
    el.innerHTML = ps.length ? ps.map((p) => `<figure><button class="ph" data-ph="${esc(p.id)}" aria-label="Open photo"><img src="${esc(p.data)}" alt="${esc(p.caption || (p.kind === 'original' ? 'Original recipe' : 'Photo of ' + r.title))}" loading="lazy"></button>
      <figcaption>${p.kind === 'original' ? '<span class="tag">Original</span> ' : ''}${esc(p.caption)} <span class="muted">— ${esc(p.by && p.by.name)}, ${esc(when(p.at))}</span>
      ${r.coverPhotoId !== p.id && canEdit ? `<button class="link" data-cover="${esc(p.id)}">Make cover</button>` : ''}
      ${can(S.me, 'deletePhoto', p) ? `<button class="link danger" data-delph="${esc(p.id)}">Delete</button>` : ''}</figcaption></figure>`).join('') : '<p class="muted small">No photos yet. Add one of the finished dish!</p>';
    $$('[data-ph]', el).forEach((b) => b.onclick = () => lightbox(ps.find((p) => p.id === b.dataset.ph)));
    $$('[data-delph]', el).forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this photo?')) return;
      await guard(() => S.store.deletePhoto(r.id, b.dataset.delph));
      if (r.coverPhotoId === b.dataset.delph) guard(() => S.store.patchRecipe(r.id, { thumb: '', coverPhotoId: '' }));
    });
    $$('[data-cover]', el).forEach((b) => b.onclick = async () => {
      const p = ps.find((x) => x.id === b.dataset.cover);
      const thumb = await compressImage(p.data, 640, 0.7);
      guard(() => S.store.patchRecipe(r.id, { thumb, coverPhotoId: p.id }), 'Cover photo updated');
    });
  }));
  S.unsub.push(S.store.subscribeComments(r.id, (cs) => {
    const el = $('#comments'); if (!el) return;
    el.innerHTML = cs.length ? cs.map((c) => `<div class="comment">${avatar(c.by && c.by.name)}<div><p><b>${esc(c.by && c.by.name)}</b> <span class="muted small">${esc(when(c.at))}</span></p><p class="pre">${esc(c.text)}</p>
      ${can(S.me, 'deleteComment', c) ? `<button class="link danger small" data-delc="${esc(c.id)}">Delete</button>` : ''}</div></div>`).join('') : '<p class="muted small">No comments yet.</p>';
    $$('[data-delc]', el).forEach((b) => b.onclick = () => confirm('Delete this comment?') && guard(() => S.store.deleteComment(r.id, b.dataset.delc)));
  }));
  const cf = $('#cform');
  if (cf) cf.onsubmit = async (e) => {
    e.preventDefault();
    const t = $('#ctext').value.trim(); if (!t) return;
    $('#ctext').value = '';
    await guard(() => S.store.addComment(r.id, t));
  };
  renderRecipe.current = id;
}

function recipeAsText(r, scale = 1) {
  const lines = [r.title.toUpperCase(), ''];
  if (r.description) lines.push(r.description, '');
  if (r.servings) lines.push(`Serves ${Math.round(r.servings * scale * 10) / 10}`, '');
  lines.push('INGREDIENTS');
  for (const i of r.ingredients || []) {
    const m = massOf(i, scale);
    lines.push(`• ${qtyText(i.qty, i.qtyMax, i.unit, scale)} ${i.unit ? unitLabel(i.unit, i.qty * scale) : ''} ${i.item}${i.note ? ' (' + i.note + ')' : ''}${m.grams != null ? ` — ${m.exact ? '' : '≈'}${formatGrams(m.grams)}` : ''}`.replace(/\s+/g, ' '));
  }
  lines.push('', 'STEPS');
  (r.steps || []).forEach((s, k) => lines.push(`${k + 1}. ${s}`));
  if (r.notes) lines.push('', 'NOTES', r.notes);
  lines.push('', `— shared by ${r.createdBy ? r.createdBy.name : 'family'}`);
  return lines.join('\n');
}
async function shareRecipe(r, scale) {
  const text = recipeAsText(r, scale);
  const url = location.href;
  if (navigator.share) { try { await navigator.share({ title: r.title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text + '\n\n' + url); toast('Recipe copied — paste it in a text or email'); }
  catch { prompt('Copy this recipe:', text); }
}

function lightbox(p) {
  const d = $('#modal');
  d.innerHTML = `<form method="dialog" class="lightbox"><img src="${esc(p.data)}" alt="${esc(p.caption || 'Photo')}"><p>${esc(p.caption)} <span class="muted">— ${esc(p.by && p.by.name)}</span></p><button class="btn">Close</button></form>`;
  d.showModal();
}

async function cookMode(r, scale) {
  const d = $('#modal');
  let i = 0, lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
  const draw = () => {
    const steps = r.steps || [];
    d.innerHTML = `<div class="cook">
      <header><span>Step ${i + 1} of ${steps.length}</span><button class="btn" data-x>Done cooking</button></header>
      <p class="cook-step">${esc(steps[i])}</p>
      <details><summary>Ingredients</summary><ul>${(r.ingredients || []).map((g) => { const m = massOf(g, scale); return `<li><b>${esc(qtyText(g.qty, g.qtyMax, g.unit, scale))} ${esc(g.unit ? unitLabel(g.unit, g.qty * scale) : '')}</b> ${esc(g.item)} ${m.grams != null ? `<span class="muted">(${m.exact ? '' : '≈'}${formatGrams(m.grams)})</span>` : ''}</li>`; }).join('')}</ul></details>
      <footer><button class="btn big" data-prev ${i === 0 ? 'disabled' : ''}>‹ Back</button><button class="btn primary big" data-next>${i === steps.length - 1 ? 'Finish' : 'Next ›'}</button></footer>
      <p class="muted small center">${lock ? 'Screen will stay on while cooking.' : ''}</p></div>`;
    $('[data-x]', d).onclick = close;
    $('[data-prev]', d).onclick = () => { i--; draw(); };
    $('[data-next]', d).onclick = () => { if (i === steps.length - 1) close(); else { i++; draw(); } };
  };
  const close = () => { d.close(); };
  d.addEventListener('close', () => { lock && lock.release().catch(() => {}); }, { once: true });
  draw(); d.showModal();
}

// --------------------------------------------------------------- add ------
function renderAdd() {
  if (!can(S.me, 'addRecipe')) { view.innerHTML = '<p class="center muted">Your family role is Viewer, so you can\'t add recipes. Ask the family owner to make you a Contributor.</p>'; return; }
  view.innerHTML = `
    <h1 class="page-title">Add a recipe</h1>
    <div class="add-grid">
      <button class="add-tile" id="a-photo"><span aria-hidden="true">📸</span><b>Photo of a recipe</b><small>Recipe card, cookbook page, screenshot. The text is read for you.</small></button>
      <button class="add-tile" id="a-word"><span aria-hidden="true">📄</span><b>Word or recipe file</b><small>A Word cookbook (.docx), or a recipe file someone sent you</small></button>
      <button class="add-tile" id="a-paste"><span aria-hidden="true">📋</span><b>Paste text</b><small>From an email, website or note</small></button>
      <a class="add-tile" href="#/new"><span aria-hidden="true">✍️</span><b>Type it in</b><small>Start with a blank recipe</small></a>
    </div>
    <section id="extract" class="panel" hidden>
      <h2>Check the text</h2>
      <p class="muted small" id="ex-help">Fix anything that was misread, then press <b>Make recipe</b>. Headings like “Ingredients” and “Directions” help it sort things out.</p>
      <div id="ex-progress" class="progress" hidden><div></div><span></span></div>
      <img id="ex-img" class="ex-img" alt="The photo being read" hidden>
      <textarea id="ex-text" rows="14" aria-label="Recipe text"></textarea>
      <p><button class="btn primary" id="ex-go">Make recipe ›</button></p>
    </section>`;
  let original = null;
  const show = (img) => { $('#extract').hidden = false; if (img) { $('#ex-img').src = img; $('#ex-img').hidden = false; } $('#extract').scrollIntoView({ behavior: 'smooth' }); };
  const prog = (p, msg) => { const el = $('#ex-progress'); el.hidden = false; $('div', el).style.width = Math.round(p * 100) + '%'; $('span', el).textContent = msg + (p ? ` ${Math.round(p * 100)}%` : ''); };
  $('#a-photo').onclick = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    original = await guard(() => compressImage(file, 1600, 0.8));
    show(original);
    $('#ex-text').value = '';
    const text = await guard(() => ocrImage(file, prog));
    $('#ex-progress').hidden = true;
    if (text != null) {
      $('#ex-text').value = text.trim();
      if (text.trim().length < 20) toast('Not much text was found. Handwriting is hard to read — you can type it in below.', 6000);
    }
  };
  $('#a-word').onclick = async () => {
    const file = await pickFile('.docx,.doc,.txt,.md,.json,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain');
    if (!file) return;
    original = null;
    if (/\.json$/i.test(file.name)) {
      let pack; try { pack = JSON.parse(await file.text()); } catch { return toast('That file could not be read.'); }
      if (!pack || pack.app !== 'family-recipes' || !Array.isArray(pack.recipes)) return toast('That is not a Family Recipes file.');
      return renderCookbook(pack, file.name);
    }
    if (/\.(txt|md)$/i.test(file.name)) {
      const text = await guard(() => readTextFile(file));
      if (text != null) { show(); $('#ex-img').hidden = true; $('#ex-text').value = text.trim(); }
      return;
    }
    toast('Reading ' + file.name + '…');
    const doc = await guard(() => readWordDocument(file));
    if (!doc) return;
    const book = splitCookbook(doc.blocks);
    if (book.length >= 2) return renderCookbook(book, file.name);
    show(); $('#ex-img').hidden = true; $('#ex-text').value = doc.text.trim();
  };
  $('#a-paste').onclick = () => { original = null; show(); $('#ex-img').hidden = true; $('#ex-text').focus(); };
  $('#ex-go').onclick = () => {
    const parsed = parseRecipeText($('#ex-text').value);
    S.draft = { ...blankRecipe(), ...parsed, category: detectCourse(parsed), _original: original };
    delete S.draft.courseHint;
    if (!S.draft.title) S.draft.title = 'New recipe';
    go('#/new');
  };
}

// A Word file with many recipes: review the list, then import them all at once.
// `source` is either the recipes split out of a Word file, or a recipe file (JSON pack with photos).
function renderCookbook(source, fileName) {
  const have = new Set(S.recipes.map((r) => (r.title || '').trim().toLowerCase()));
  const isPack = !Array.isArray(source);
  const items = (isPack ? source.recipes : source).map((c) => {
    let r, photos = [];
    if (isPack) {
      const { id, createdAt, createdBy, updatedAt, updatedBy, history, favorites, coverPhotoId, ...rest } = c;
      r = { ...rest, ingredients: rest.ingredients || [], steps: rest.steps || [] };
      photos = (source.photos || []).filter((p) => p.recipeId === id).map(({ data, caption, kind }) => ({ data, caption: caption || '', kind: kind || 'dish' }));
      if (!r.category) r.category = detectCourse(r);
    } else {
      r = parseRecipeText(c.text, { title: c.title, paragraphs: true });
      r.category = detectCourse(r);
      delete r.courseHint;
    }
    const empty = !r.ingredients.length && !r.steps.length;
    const dupe = have.has(String(r.title || '').trim().toLowerCase());
    return { r: { ...blankRecipe(), ...r, servings: r.servings || null }, photos, empty, dupe, on: !dupe };
  });
  const courseOpts = (v) => `<option value="">—</option>${COURSES.map(([c, l]) => `<option value="${c}" ${v === c ? 'selected' : ''}>${l}</option>`).join('')}`;
  const draw = () => {
    const n = items.filter((x) => x.on).length;
    view.innerHTML = `
      <div class="page-head"><h1 class="page-title">${isPack ? 'Import recipes' : 'Import cookbook'}</h1><a class="link" href="#/add">Cancel</a></div>
      <p>Found <b>${items.length} recipes</b> in <b>${esc(fileName)}</b>. Check the course and whose recipe each one is. You can fix the details of any recipe later with <b>Edit</b>.</p>
      <p class="btn-row"><button class="btn primary big" id="cb-go" ${n ? '' : 'disabled'}>Import ${n} recipe${n === 1 ? '' : 's'}</button> <button class="btn" id="cb-all">${n === items.length ? 'Select none' : 'Select all'}</button></p>
      <ul class="cb-list">${items.map((x, i) => `<li class="cb ${x.on ? '' : 'off'}">
        <label class="cb-check"><input type="checkbox" data-on="${i}" ${x.on ? 'checked' : ''} aria-label="Import ${esc(x.r.title)}"></label>
        <div class="cb-body">
          <input class="cb-title" data-f="title" data-i="${i}" value="${esc(x.r.title)}" aria-label="Title">
          <div class="cb-row">
            <select data-f="category" data-i="${i}" aria-label="Course">${courseOpts(x.r.category)}</select>
            <input data-f="from" data-i="${i}" value="${esc(x.r.from)}" placeholder="Whose recipe?" aria-label="Whose recipe">
          </div>
          ${x.r.thumb ? `<img class="cb-thumb" src="${esc(x.r.thumb)}" alt="">` : ''}
          <p class="small muted">${x.photos.length ? `📷 ${x.photos.length} photo${x.photos.length === 1 ? '' : 's'} · ` : ''}${proteinOf(x.r) ? esc(proteinIcon(proteinOf(x.r)) + ' ' + proteinLabel(proteinOf(x.r))) + ' · ' : ''}${x.r.ingredients.length} ingredients · ${x.r.steps.length} step${x.r.steps.length === 1 ? '' : 's'}
            ${x.empty ? ' · <b class="warn-t">only a title so far — saved as a placeholder to fill in</b>' : ''}${x.dupe ? ' · <b class="warn-t">already in your recipes</b>' : ''}</p>
          <details><summary class="small">Preview</summary><div class="cb-prev small">
            ${x.r.ingredients.length ? `<ul>${x.r.ingredients.map((g) => `<li>${esc(qtyText(g.qty, g.qtyMax, g.unit))} ${esc(g.unit ? unitLabel(g.unit, g.qty) : '')} ${esc(g.item)}${g.note ? ` <span class="muted">(${esc(g.note)})</span>` : ''}</li>`).join('')}</ul>` : ''}
            ${x.r.steps.length ? `<ol>${x.r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
            ${x.r.notes ? `<p class="pre">${esc(x.r.notes)}</p>` : ''}</div></details>
        </div></li>`).join('')}</ul>`;
    $$('[data-on]').forEach((c) => c.onchange = () => { items[+c.dataset.on].on = c.checked; draw(); });
    $$('.cb [data-f]').forEach((el) => el.onchange = () => { items[+el.dataset.i].r[el.dataset.f] = el.value.trim(); });
    $('#cb-all').onclick = () => { const all = items.every((x) => x.on); items.forEach((x) => (x.on = !all)); draw(); };
    $('#cb-go').onclick = async () => {
      const chosen = items.filter((x) => x.on);
      const btn = $('#cb-go'); btn.disabled = true;
      let done = 0;
      for (const x of chosen) {
        const rec = { ...x.r, favorites: {} };
        if (x.empty && !rec.notes) rec.notes = 'Only the name was in the cookbook. Tap Edit to add the ingredients and steps.';
        rec.ingredients = rec.ingredients.map(({ raw, ...g }) => g);
        if (!rec.source && !isPack) rec.source = fileName.replace(/\.docx$/i, '');
        const rid = await guard(() => S.store.saveRecipe(rec));
        if (rid) {
          done++;
          let first = null;
          for (const ph of x.photos) { const pid = await guard(() => S.store.addPhoto(rid, ph)); if (pid && !first) first = pid; }
          if (first && rec.thumb) await guard(() => S.store.patchRecipe(rid, { coverPhotoId: first }));
        }
        btn.textContent = `Importing… ${done}/${chosen.length}`;
      }
      toast(`Imported ${done} recipe${done === 1 ? '' : 's'}`);
      S.filter = { ...S.filter, q: '', show: 'all', cat: '', protein: '', by: '', sort: 'g-course' };
      go('#/');
    };
  };
  draw();
}

// ------------------------------------------------------------- editor -----
function blankRecipe() {
  return { title: '', from: '', description: '', category: '', tags: [], servings: 4, prepTime: '', cookTime: '', source: '', ingredients: [], steps: [], notes: '' };
}
function renderEditor(id) {
  let r;
  if (id) {
    const orig = S.recipes.find((x) => x.id === id);
    if (!orig) { view.innerHTML = '<p class="center muted">Recipe not found.</p>'; return; }
    if (!can(S.me, 'editRecipe', orig)) { view.innerHTML = '<p class="center muted">You can only edit recipes you added. Ask an Editor or the family owner.</p>'; return; }
    r = S.draft && S.draft.id === id ? S.draft : JSON.parse(JSON.stringify(orig));
  } else {
    if (!can(S.me, 'addRecipe')) { view.innerHTML = '<p class="center muted">Viewers can\'t add recipes.</p>'; return; }
    r = S.draft && !S.draft.id ? S.draft : blankRecipe();
  }
  if (!r.ingredients.length) r.ingredients.push({ qty: null, unit: '', item: '', note: '' });
  if (!r.steps.length) r.steps.push('');
  S.draft = r;
  const unitOpts = (sel) => `<option value="">—</option>${Object.keys(UNITS).map((u) => `<option value="${u}" ${sel === u ? 'selected' : ''}>${UNITS[u].label}</option>`).join('')}`;
  view.innerHTML = `
    <form id="ed" class="editor" novalidate>
      <div class="ed-top"><a href="${id ? '#/r/' + esc(id) : '#/add'}" class="link" id="cancel">Cancel</a><h1>${id ? 'Edit recipe' : 'New recipe'}</h1><button class="btn primary">Save</button></div>
      ${r._original ? `<details class="panel" open><summary>Original photo (will be kept with the recipe)</summary><img class="ex-img" src="${esc(r._original)}" alt="Original recipe photo"></details>` : ''}
      <section class="panel">
        <label>Title<input name="title" required value="${esc(r.title)}" placeholder="Grandma's Apple Pie"></label>
        <label>Short description<textarea name="description" rows="2" placeholder="The one we make every Thanksgiving">${esc(r.description)}</textarea></label>
        <div class="row3">
          <label>Course<select name="category"><option value="">—</option>${COURSES.map(([v, l]) => `<option value="${v}" ${r.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Main ingredient<select name="protein"><option value="">Auto${detectProtein(r) ? ' (' + esc(proteinLabel(detectProtein(r))) + ')' : ''}</option>${PROTEINS.map(([v, l, i]) => `<option value="${v}" ${r.protein === v ? 'selected' : ''}>${i} ${l}</option>`).join('')}</select></label>
          <label>Servings<input name="servings" inputmode="decimal" value="${esc(r.servings ?? '')}"></label>
        </div>
        <div>
          <label>Tags<input name="tags" value="${esc((r.tags || []).join(', '))}" placeholder="pie, fall"></label>
        </div>
        <div class="row3">
          <label>Prep time<input name="prepTime" value="${esc(r.prepTime)}" placeholder="20 min"></label>
          <label>Cook time<input name="cookTime" value="${esc(r.cookTime)}" placeholder="1 hr"></label>
          <label>Source<input name="source" value="${esc(r.source)}" placeholder="Aunt May's card, a website…"></label>
        </div>
        <div class="row3">
          <label>Whose recipe<input name="from" value="${esc(r.from || '')}" placeholder="Nanny, Dad, Aunt May…"></label>
        </div>
        <div class="cover-row">
          ${r.thumb ? `<img class="cover-prev" src="${esc(r.thumb)}" alt="Cover photo">` : ''}
          <button type="button" class="btn" id="cover">${r.thumb ? 'Change cover photo' : '📷 Add cover photo'}</button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Ingredients</h2><span class="muted small">Weight (g) fills in automatically — type one to override</span></div>
        <div id="ing-rows">${r.ingredients.map((g, i) => {
          const m = massOf({ ...g, grams: null });
          return `<div class="ing-row" data-i="${i}">
            <input class="q" data-f="qty" value="${esc(g.qty == null ? '' : formatQty(g.qty, g.unit) + (g.qtyMax ? '-' + formatQty(g.qtyMax, g.unit) : ''))}" placeholder="1½" aria-label="Amount" inputmode="text">
            <select data-f="unit" aria-label="Unit">${unitOpts(g.unit)}</select>
            <input class="it" data-f="item" value="${esc(g.item)}" placeholder="flour" aria-label="Ingredient">
            <input class="nt" data-f="note" value="${esc(g.note)}" placeholder="note (sifted…)" aria-label="Note">
            <input class="gr" data-f="grams" value="${esc(g.grams ?? '')}" placeholder="${m.grams != null ? '≈' + Math.round(m.grams) : 'g'}" aria-label="Weight in grams" inputmode="decimal">
            <input class="sc" data-f="section" value="${esc(g.section || '')}" placeholder="group (crust…)" aria-label="Group">
            <span class="row-btns"><button type="button" data-mv="-1" aria-label="Move up">↑</button><button type="button" data-mv="1" aria-label="Move down">↓</button><button type="button" data-rm aria-label="Remove">✕</button></span>
          </div>`;
        }).join('')}</div>
        <p class="btn-row"><button type="button" class="btn" id="add-ing">+ Ingredient</button> <button type="button" class="btn" id="bulk-ing">Paste a list…</button></p>
      </section>

      <section class="panel">
        <h2>Steps</h2>
        <div id="step-rows">${r.steps.map((s, i) => `<div class="step-row" data-i="${i}"><span class="n">${i + 1}</span><textarea data-f="step" rows="2" aria-label="Step ${i + 1}">${esc(s)}</textarea><span class="row-btns"><button type="button" data-mv="-1" aria-label="Move up">↑</button><button type="button" data-mv="1" aria-label="Move down">↓</button><button type="button" data-rm aria-label="Remove">✕</button></span></div>`).join('')}</div>
        <p><button type="button" class="btn" id="add-step">+ Step</button></p>
      </section>

      <section class="panel">
        <h2>Notes</h2>
        <textarea name="notes" rows="4" placeholder="Tips, substitutions, family stories…">${esc(r.notes)}</textarea>
      </section>
      <p class="center"><button class="btn primary big">Save recipe</button></p>
    </form>`;

  const form = $('#ed');
  const sync = () => {
    const fd = new FormData(form);
    for (const k of ['title', 'from', 'description', 'category', 'prepTime', 'cookTime', 'source', 'notes']) r[k] = (fd.get(k) || '').toString();
    r.servings = parseNumber(fd.get('servings')) || null;
    r.protein = (fd.get('protein') || '').toString();
    r.tags = (fd.get('tags') || '').toString().split(',').map((s) => s.trim()).filter(Boolean);
    r.ingredients = $$('.ing-row', form).map((row) => {
      const v = (f) => $(`[data-f="${f}"]`, row).value.trim();
      const qs = v('qty').split(/\s*(?:-|–|to)\s*/);
      const g = v('grams');
      return { qty: parseNumber(qs[0]), qtyMax: qs[1] ? parseNumber(qs[1]) : null, unit: v('unit'), item: v('item'), note: v('note'), grams: g === '' ? null : parseFloat(g), section: v('section') };
    });
    r.steps = $$('[data-f="step"]', form).map((t) => t.value.trim());
  };
  const rerender = () => { sync(); renderEditor(id); };
  // live weight estimate as you type
  form.addEventListener('input', (e) => {
    const row = e.target.closest('.ing-row');
    if (!row) return;
    const v = (f) => $(`[data-f="${f}"]`, row).value;
    const m = massOf({ qty: parseNumber(v('qty').split(/\s*(?:-|–|to)\s*/)[0]), unit: v('unit'), item: v('item'), note: v('note') });
    $('[data-f="grams"]', row).placeholder = m.grams != null ? '≈' + Math.round(m.grams) : 'g';
  });
  // keep the "Auto (…)" main-ingredient guess current as the course, title or ingredients change
  form.addEventListener('change', () => {
    sync();
    const d = detectProtein(r);
    $('select[name=protein] option[value=""]', form).textContent = 'Auto' + (d ? ` (${proteinLabel(d)})` : '');
  });
  // a quick-typed full line in the item box ("2 cups sugar") gets split up
  form.addEventListener('change', (e) => {
    if (e.target.dataset.f !== 'item') return;
    const row = e.target.closest('.ing-row');
    const q = $('[data-f="qty"]', row);
    if (q.value.trim()) return;
    const p = parseIngredientLine(e.target.value);
    if (p.qty == null) return;
    sync();
    const i = +row.dataset.i;
    r.ingredients[i] = { ...r.ingredients[i], ...p, section: r.ingredients[i].section };
    renderEditor(id);
  });
  $$('.ing-row [data-mv], .step-row [data-mv]', form).forEach((b) => b.onclick = () => {
    sync();
    const row = b.closest('[data-i]'); const i = +row.dataset.i; const arr = row.classList.contains('ing-row') ? r.ingredients : r.steps;
    const j = i + +b.dataset.mv; if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]]; renderEditor(id);
  });
  $$('[data-rm]', form).forEach((b) => b.onclick = () => {
    sync();
    const row = b.closest('[data-i]'); const arr = row.classList.contains('ing-row') ? r.ingredients : r.steps;
    arr.splice(+row.dataset.i, 1); renderEditor(id);
  });
  $('#add-ing').onclick = () => { sync(); r.ingredients.push({ qty: null, unit: '', item: '', note: '', section: (r.ingredients[r.ingredients.length - 1] || {}).section || '' }); renderEditor(id); $$('.ing-row .q').pop().focus(); };
  $('#add-step').onclick = () => { sync(); r.steps.push(''); renderEditor(id); $$('[data-f="step"]').pop().focus(); };
  $('#bulk-ing').onclick = () => {
    const d = $('#modal');
    d.innerHTML = `<form method="dialog" class="bulk"><h2>Paste ingredients</h2><p class="muted small">One per line, e.g. “2 cups flour, sifted”.</p><textarea rows="10" id="bulk-t" aria-label="Ingredient lines"></textarea><p class="btn-row"><button class="btn" value="cancel">Cancel</button> <button class="btn primary" value="ok">Add</button></p></form>`;
    d.showModal();
    d.addEventListener('close', () => {
      if (d.returnValue !== 'ok') return;
      sync();
      const lines = $('#bulk-t', d).value.split('\n').map((l) => l.trim()).filter(Boolean);
      r.ingredients = r.ingredients.filter((g) => g.item || g.qty != null).concat(lines.map(parseIngredientLine));
      renderEditor(id);
    }, { once: true });
  };
  $('#cover').onclick = async () => {
    const f = await pickFile('image/*'); if (!f) return;
    sync();
    r._cover = await guard(() => compressImage(f));
    if (r._cover) { r.thumb = await compressImage(r._cover, 640, 0.7); renderEditor(id); }
  };
  $('#cancel').onclick = () => { S.draft = null; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    sync();
    if (!r.title.trim()) { toast('Please give the recipe a title.'); $('[name=title]').focus(); return; }
    const clean = { ...r };
    clean.ingredients = r.ingredients.filter((g) => g.item || g.qty != null).map(({ raw, ...g }) => g);
    clean.steps = r.steps.filter(Boolean);
    const { _original, _cover } = clean; delete clean._original; delete clean._cover;
    if (!clean.favorites) clean.favorites = {};
    const btns = $$('button', form); btns.forEach((b) => (b.disabled = true));
    const rid = await guard(() => S.store.saveRecipe(clean));
    btns.forEach((b) => (b.disabled = false));
    if (!rid) return;
    if (_cover) { const pid = await guard(() => S.store.addPhoto(rid, { data: _cover, kind: 'dish', caption: '' })); if (pid) await guard(() => S.store.patchRecipe(rid, { coverPhotoId: pid })); }
    if (_original) {
      const pid = await guard(() => S.store.addPhoto(rid, { data: _original, kind: 'original', caption: 'Original recipe' }));
      if (pid && !clean.thumb) await guard(async () => S.store.patchRecipe(rid, { thumb: await compressImage(_original, 640, 0.7), coverPhotoId: pid }));
    }
    S.draft = null;
    toast('Saved');
    go('#/r/' + rid);
  };
}

// ------------------------------------------------------------- grocery ----
function renderGrocery() {
  const list = S.grocery;
  const groups = {};
  for (const e of list) (groups[e.aisle] = groups[e.aisle] || []).push(e);
  const left = list.filter((e) => !e.checked).length;
  view.innerHTML = `
    <div class="page-head"><h1 class="page-title">Grocery list</h1><span class="muted">${left} to buy</span></div>
    <form id="gadd" class="gadd"><input id="gnew" placeholder="Add an item — e.g. 2 lb apples" aria-label="Add grocery item"><button class="btn primary">Add</button></form>
    ${list.length ? '' : '<div class="empty"><div class="empty-leaf" aria-hidden="true">🛒</div><p>Open a recipe and tap <b>Add checked items to grocery list</b>. Items from different recipes are combined.</p></div>'}
    ${AISLE_ORDER.filter((a) => groups[a]).map((a) => `<section class="panel aisle"><h2>${esc(a)}</h2><ul>${groups[a].map((e) => {
      const q = Object.entries(combineQty(e.qtyByUnit)).filter(([u]) => u !== 'to taste').map(([u, n]) => `${formatQty(n, u)} ${u === 'each' ? '' : unitLabel(u, n)}`.trim()).join(' + ');
      return `<li class="g ${e.checked ? 'done' : ''}"><label><input type="checkbox" data-g="${esc(e.id)}" ${e.checked ? 'checked' : ''}><span><b>${esc(q)}</b> ${esc(e.name)}${e.gramsKnown && e.grams ? ` <span class="mass">${esc(formatGrams(e.grams))}</span>` : ''}${e.from.length ? `<small class="muted">for ${esc(e.from.join(', '))}</small>` : ''}</span></label><button class="link" data-gdel="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">✕</button></li>`;
    }).join('')}</ul></section>`).join('')}
    ${list.length ? `<p class="btn-row center"><button class="btn primary" id="gshare">Share / copy list</button> <button class="btn" id="gclear">Remove checked</button> <button class="btn danger" id="gall">Clear all</button></p>` : ''}`;
  const save = async () => { await guard(() => S.store.saveGrocery(S.grocery)); renderGrocery(); };
  $('#gadd').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#gnew').value.trim(); if (!v) return;
    S.grocery = addToList(S.grocery, [parseIngredientLine(v)], '');
    save();
  };
  $$('[data-g]').forEach((c) => c.onchange = () => { const e = S.grocery.find((x) => x.id === c.dataset.g); e.checked = c.checked; save(); });
  $$('[data-gdel]').forEach((b) => b.onclick = () => { S.grocery = S.grocery.filter((x) => x.id !== b.dataset.gdel); save(); });
  const gs = $('#gshare');
  if (gs) gs.onclick = async () => {
    const text = listToText(S.grocery, formatQty, unitLabel, formatGrams);
    if (navigator.share) { try { await navigator.share({ title: 'Grocery list', text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(text); toast('List copied'); } catch { prompt('Copy your list:', text); }
  };
  const gc = $('#gclear'); if (gc) gc.onclick = () => { S.grocery = S.grocery.filter((x) => !x.checked); save(); };
  const ga = $('#gall'); if (ga) ga.onclick = () => { if (confirm('Clear the whole grocery list?')) { S.grocery = []; save(); } };
}

// -------------------------------------------------------------- family ----
function renderFamily() {
  const st = S.store, me = S.me;
  const shared = st.mode === 'firebase';
  const appUrl = location.href.split('#')[0];
  view.innerHTML = `
    <h1 class="page-title">${esc(st.family.name)}</h1>
    <section class="panel">
      <h2>You</h2>
      <p>${avatar(me.name)} <b>${esc(me.name)}</b> ${me.email ? `<span class="muted">${esc(me.email)}</span>` : ''} <span class="role">${esc(me.role)}</span></p>
      <p class="btn-row"><button class="btn" id="rename-me">Change my name</button>${me.role === 'owner' ? ' <button class="btn" id="rename-fam">Rename family</button>' : ''}${shared ? ' <button class="btn" id="signout">Sign out</button>' : ''}</p>
    </section>
    ${shared ? `
    <section class="panel">
      <h2>Family members</h2>
      <div id="members"></div>
      ${can(me, 'manageMembers') ? `
        <div class="invite">
          <h3>Invite family with a link</h3>
          <p class="small muted">Each person gets their own link. They tap it, sign in with any email, and they're in. Each link works once, so nobody else can join.</p>
          <div id="invites"></div>
          <form id="mkinv">
            <label>Names, one per line<textarea name="names" rows="4" placeholder="Nanny (Lisa)&#10;Granddad (Karl)&#10;Mom (Jennifer)"></textarea></label>
            <label>What can they do?<select name="role">${ROLES.filter((r) => r !== 'owner').map((r) => `<option value="${r}" ${r === 'editor' ? 'selected' : ''}>${cap(r)} — ${esc(ROLE_INFO[r])}</option>`).join('')}</select></label>
            <button class="btn primary">Make invite links</button>
          </form>
        </div>
        <details class="invite"><summary>Or add someone by email address</summary>
        <form id="invite">
          <div class="row3">
            <label>Their email<input name="email" type="email" required placeholder="aunt.may@gmail.com"></label>
            <label>Name shown in the app<input name="name" placeholder="Aunt May"></label>
            <label>Access<select name="role">${ROLES.map((r) => `<option value="${r}" ${r === 'contributor' ? 'selected' : ''}>${cap(r)}</option>`).join('')}</select></label>
          </div>
          <p><button class="btn primary">Add member</button> <button type="button" class="btn" id="copy-invite">Copy invite message</button></p>
        </form></details>` : ''}
      <details><summary>What each access level can do</summary><dl class="roles">${ROLES.map((r) => `<dt>${cap(r)}</dt><dd>${esc(ROLE_INFO[r])}</dd>`).join('')}</dl></details>
    </section>` : `
    <section class="panel warn">
      <h2>Only on this device</h2>
      <p>Recipes are saved in this browser only. To share with the family — so everyone can sign in, add, edit and comment — connect a free Firebase database. It takes about 10 minutes, once. The steps are in <b>family-recipes/README.md</b> (“Share with the family”).</p>
      <p class="muted small">After it's connected, use <b>Back up</b> here and <b>Restore</b> there to move recipes you've already added.</p>
    </section>`}
    <section class="panel">
      <h2>Install on your phone</h2>
      <p>Open <b>${esc(appUrl)}</b> on your phone, then: <br>iPhone (Safari): tap <b>Share</b> → <b>Add to Home Screen</b>.<br>Android (Chrome): tap <b>⋮</b> → <b>Install app</b> / <b>Add to Home screen</b>.</p>
    </section>
    <section class="panel">
      <h2>Back up</h2>
      <p class="btn-row"><button class="btn" id="export">⬇ Download backup</button> ${atLeastEditor(me) ? '<button class="btn" id="import">⬆ Restore from backup</button>' : ''}</p>
      <p class="muted small">The backup is one file with every recipe, comment and photo.</p>
    </section>`;

  $('#rename-me').onclick = async () => { const n = prompt('Your name as the family sees it:', me.name); if (n && n.trim()) { await guard(() => st.renameMe(n.trim()), 'Name updated'); renderFamily(); } };
  const rf = $('#rename-fam'); if (rf) rf.onclick = async () => { const n = prompt('Family name:', st.family.name); if (n && n.trim()) { await guard(() => st.renameFamily(n.trim()), 'Renamed'); $('#fam-name').textContent = n.trim(); renderFamily(); } };
  const so = $('#signout'); if (so) so.onclick = () => st.signOut();
  $('#export').onclick = async () => {
    const data = await guard(() => st.exportAll()); if (!data) return;
    const blob = new Blob([JSON.stringify({ app: 'family-recipes', version: 1, exportedAt: new Date().toISOString(), ...data })], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `family-recipes-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const im = $('#import');
  if (im) im.onclick = async () => {
    const f = await pickFile('.json,application/json'); if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch { return toast('That file is not a backup.'); }
    if (data.app !== 'family-recipes') return toast('That file is not a Family Recipes backup.');
    if (!confirm(`Restore ${data.recipes.length} recipes? Recipes with the same ID will be replaced.`)) return;
    await guard(() => st.importAll(data), 'Restored');
  };
  if (shared) {
    S.unsub.push(st.subscribeMembers((ms) => {
      const el = $('#members'); if (!el) return;
      ms.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || (a.name || '').localeCompare(b.name || ''));
      const manage = can(me, 'manageMembers');
      el.innerHTML = `<ul class="members">${ms.map((m) => `<li>${avatar(m.name)}<div><b>${esc(m.name)}</b>${m.you ? ' (you)' : ''}<br><span class="muted small">${esc(m.email)}${m.uid ? '' : ' · hasn’t signed in yet'}</span></div>
        ${manage && !m.you ? `<select data-role="${esc(m.email)}" aria-label="Access for ${esc(m.name)}">${ROLES.map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${cap(r)}</option>`).join('')}</select><button class="link danger" data-rmm="${esc(m.email)}" aria-label="Remove ${esc(m.name)}">Remove</button>` : `<span class="role">${esc(m.role)}</span>`}</li>`).join('')}</ul>`;
      $$('[data-role]', el).forEach((s) => s.onchange = () => { const m = ms.find((x) => x.email === s.dataset.role); guard(() => st.setMember(m.email, { name: m.name, role: s.value }), 'Access updated'); });
      $$('[data-rmm]', el).forEach((b) => b.onclick = () => confirm('Remove this person from the family app?') && guard(() => st.removeMember(b.dataset.rmm), 'Removed'));
    }));
    const mk = $('#mkinv');
    if (mk) {
      const inviteUrl = (code) => `${appUrl}#/join/${code}`;
      const inviteText = (i) => `Hi ${i.name}! You're invited to our family recipe book "${st.family.name}". Tap this link, then sign in or create an account: ${inviteUrl(i.code)}\n\nOn your phone, use "Add to Home Screen" to keep it like an app.`;
      S.unsub.push(st.subscribeInvites((list) => {
        const el = $('#invites'); if (!el) return;
        const open = list.filter((i) => !i.usedBy);
        el.innerHTML = open.length ? `<ul class="members">${open.map((i) => `<li>${avatar(i.name)}<div><b>${esc(i.name)}</b><br><span class="muted small">${esc(cap(i.role))} · not joined yet</span></div>
          <button class="btn" data-share="${esc(i.code)}">Send link</button><button class="link danger" data-delinv="${esc(i.code)}" aria-label="Cancel invite for ${esc(i.name)}">✕</button></li>`).join('')}</ul>` : '';
        $$('[data-share]', el).forEach((btn) => btn.onclick = async () => {
          const i = list.find((x) => x.code === btn.dataset.share);
          if (navigator.share) { try { await navigator.share({ title: 'Family recipes invite', text: inviteText(i) }); return; } catch (e) { if (e.name === 'AbortError') return; } }
          try { await navigator.clipboard.writeText(inviteText(i)); toast(`Invite for ${i.name} copied — paste it into a text`); } catch { prompt('Copy this invite:', inviteText(i)); }
        });
        $$('[data-delinv]', el).forEach((btn) => btn.onclick = () => confirm('Cancel this invite link?') && guard(() => st.deleteInvite(btn.dataset.delinv)));
      }));
      mk.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(mk);
        const people = String(fd.get('names') || '').split('\n').map((s) => s.trim()).filter(Boolean).map((name) => ({ name, role: fd.get('role') }));
        if (!people.length) return toast('Type at least one name.');
        mk.reset();
        const ok = await guard(() => st.createInvites(people), `Made ${people.length} invite link${people.length === 1 ? '' : 's'} — tap "Send link" next to each name`);
        if (!ok) mk.names.value = people.map((p) => p.name).join('\n');
      };
    }
    const inv = $('#invite');
    if (inv) {
      inv.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(inv);
        const v = { email: fd.get('email'), name: fd.get('name'), role: fd.get('role') };
        inv.reset();
        const ok = await guard(() => st.setMember(v.email, { name: v.name, role: v.role }).then(() => true), 'Added! Now send them the invite message.');
        if (!ok) { inv.email.value = v.email; inv.name.value = v.name; inv.role.value = v.role; }
      };
      $('#copy-invite').onclick = async () => {
        const text = `You're invited to our family recipe book "${st.family.name}"! Open ${appUrl} and sign in with your Google account (the email I added). On your phone, use "Add to Home Screen" to keep it like an app.`;
        try { await navigator.clipboard.writeText(text); toast('Invite copied — paste it into a text or email'); } catch { prompt('Copy this invite:', text); }
      };
    }
  }
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const atLeastEditor = (me) => me.role === 'owner' || me.role === 'editor';

// ------------------------------------------------------- auth screens -----
function renderGate(phase) {
  document.body.classList.add('gate');
  const st = S.store;
  if (phase === 'signin') {
    let mode = 'in';
    const draw = () => {
      view.innerHTML = `<div class="gate-card"><div class="logo-big" aria-hidden="true"><img src="icon.svg" alt="" width="72" height="72"></div><h1>Family Recipes</h1>
        <p>${pendingInvite.get() ? "<b>You're invited!</b> Sign in or create an account to join the family recipe book." : "Sign in to see and share the family's recipes."}</p>
        <button class="btn primary big wide" id="gsi">Sign in with Google</button>
        <p class="or"><span>or use your email</span></p>
        <form id="ef" class="ef">
          ${mode === 'up' ? '<label>Your name<input name="name" autocomplete="name" required placeholder="Nanny"></label>' : ''}
          <label>Email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
          <label>Password<input name="pw" type="password" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}" required minlength="6" placeholder="${mode === 'up' ? 'At least 6 characters' : ''}"></label>
          <button class="btn primary wide">${mode === 'up' ? 'Create my account' : 'Sign in'}</button>
        </form>
        <p class="small">${mode === 'up' ? 'Already have an account? <button class="link" id="sw">Sign in</button>' : 'New here? <button class="link" id="sw">Create an account</button> · <button class="link" id="forgot">Forgot password?</button>'}</p>
        <p class="muted small">Use the same email the family owner added for you.</p></div>`;
      $('#gsi').onclick = () => guard(() => st.signIn());
      $('#sw').onclick = () => { mode = mode === 'up' ? 'in' : 'up'; draw(); };
      const fg = $('#forgot');
      if (fg) fg.onclick = () => { const e = $('#ef [name=email]').value.trim(); if (!e) return toast('Type your email first, then tap "Forgot password?"'); guard(() => st.resetPassword(e), 'Password reset email sent'); };
      $('#ef').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        await guard(() => (mode === 'up' ? st.signUpEmail(fd.get('email'), fd.get('pw'), (fd.get('name') || '').trim()) : st.signInEmail(fd.get('email'), fd.get('pw'))));
      };
    };
    draw();
  } else if (phase === 'verify') {
    view.innerHTML = `<div class="gate-card"><div class="logo-big" aria-hidden="true">✉️</div><h1>Check your email</h1>
      <p>We sent a link to <b>${esc(st.me.email)}</b>. Tap it to confirm it's you, then come back here.</p>
      <p class="muted small">Can't find it? Look in Spam or Promotions.</p>
      <p class="btn-row center"><button class="btn primary big" id="vok">I've confirmed my email</button></p>
      <p class="btn-row center"><button class="btn" id="vre">Send it again</button> <button class="btn" id="out">Use another account</button></p></div>`;
    $('#vok').onclick = async () => { const p = await guard(() => st.checkVerified()); if (!p) return; if (p.phase === 'verify') toast('Not confirmed yet — tap the link in the email first.', 4000); else handlePhase(p); };
    $('#vre').onclick = () => guard(() => st.resendVerification(), 'Sent again');
    $('#out').onclick = () => st.signOut();
  } else if (phase === 'notmember') {
    view.innerHTML = `<div class="gate-card"><div class="logo-big" aria-hidden="true">🔒</div><h1>Almost there</h1><p>You're signed in as <b>${esc(st.me.email)}</b>, but you haven't been added to ${st.family ? '<b>' + esc(st.family.name) + '</b>' : 'the family'} yet.</p><p>Ask the family owner to add this email in the <b>Family</b> tab, then tap below.</p><p class="btn-row"><button class="btn primary" id="retry">I've been added — try again</button> <button class="btn" id="out">Use another account</button></p></div>`;
    $('#retry').onclick = () => location.reload();
    if (!st.family) $('.gate-card p').insertAdjacentHTML('afterend', '<p class="small muted">If someone sent you an invite link, open that link again.</p>');
    $('#out').onclick = () => st.signOut();
  } else if (phase === 'setup') {
    const local = st.mode === 'local';
    view.innerHTML = `<form class="gate-card" id="setup"><div class="logo-big" aria-hidden="true">🍁</div><h1>Welcome!</h1>
      <p>${local ? 'Let\'s set up your recipe book.' : 'You\'re the first one here, so you\'ll be the family <b>owner</b> — you decide who can see and edit recipes.'}</p>
      <label>Family name<input name="fam" required value="${(st.me.name || '').trim().split(/\s+/).length > 1 ? 'The ' + esc(st.me.name.trim().split(/\s+/).pop()) + ' Family Kitchen' : 'Our Family Kitchen'}"></label>
      <label>Your name (shown on recipes you share)<input name="me" required value="${esc(st.me.name || '')}" placeholder="Mom"></label>
      <button class="btn primary big">Start</button></form>`;
    $('#setup').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const ok = await guard(() => st.setupFamily(fd.get('fam').trim(), fd.get('me').trim()).then(() => true));
      if (ok) start();
    };
  }
}

// --------------------------------------------------------------- boot -----
async function start() {
  if (S.started) return;
  S.started = true;
  document.body.classList.remove('gate');
  S.me = S.store.me;
  $('#fam-name').textContent = S.store.family.name;
  $('#mode').textContent = S.store.mode === 'firebase' ? 'Shared' : 'This device';
  $('#mode').className = 'mode ' + S.store.mode;
  $('.tabs').hidden = false;
  S.grocery = await S.store.getGrocery().catch(() => []);
  let first = true;
  S.store.subscribeRecipes((rs) => {
    S.recipes = rs;
    if (first) { first = false; route(); return; }
    // live update: refresh the current screen unless the person is typing in the editor
    const h = location.hash;
    if (h.startsWith('#/r/')) {
      const keep = $('#ctext') && $('#ctext').value, y = window.scrollY;
      renderRecipe(h.slice(4));
      if (keep && $('#ctext')) $('#ctext').value = keep;
      window.scrollTo(0, y);
    } else if ((h === '' || h === '#/' || h === '#') && renderList.redraw) renderList.redraw();
  });
  window.addEventListener('hashchange', route);
}

const INVITE_KEY = 'family-recipes-invite';
const pendingInvite = {
  get() { try { return localStorage.getItem(INVITE_KEY) || ''; } catch { return S.invite || ''; } },
  set(v) { S.invite = v; try { if (v) localStorage.setItem(INVITE_KEY, v); else localStorage.removeItem(INVITE_KEY); } catch { /* private mode */ } },
};
async function handlePhase(p) {
  if (p.phase === 'notmember' && pendingInvite.get()) {
    const code = pendingInvite.get();
    view.innerHTML = '<p class="center muted loading">Joining the family…</p>';
    try { p = await S.store.claimInvite(code); pendingInvite.set(''); toast(`Welcome to ${S.store.family ? S.store.family.name : 'the family'}!`, 4000); }
    catch (e) { console.error(e); pendingInvite.set(''); toast(friendlyError(e), 7000); }
  }
  if (p.phase === 'ready') { pendingInvite.set(''); start(); } else renderGate(p.phase);
}
async function boot() {
  const m = location.hash.match(/^#\/join\/([a-z0-9]{10,40})$/i);
  if (m) { pendingInvite.set(m[1]); history.replaceState(null, '', location.pathname + location.search + '#/'); }
  S.store = firebaseConfig ? new FirebaseStore(firebaseConfig) : new LocalStore();
  let phase;
  try { phase = await S.store.init((p) => handlePhase(p)); }
  catch (e) { console.error(e); view.innerHTML = `<div class="gate-card"><h1>Can't connect</h1><p>${esc(friendlyError(e))}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; return; }
  handlePhase(phase);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
