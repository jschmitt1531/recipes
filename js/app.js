import { firebaseConfig } from './config.js';
import { LocalStore, FirebaseStore, ROLES, ROLE_INFO, can } from './store.js';
import { UNITS, massOf, formatGrams, formatQty, parseNumber, unitLabel } from './units.js';
import { parseIngredientLine, parseRecipeText } from './parse.js';
import { addToList, combineQty, AISLE_ORDER, listToText } from './grocery.js';
import { compressImage, ocrImage, readWordFile, readTextFile } from './importers.js';

const CATEGORIES = ['Breakfast', 'Appetizer', 'Soup', 'Salad', 'Main', 'Side', 'Bread', 'Dessert', 'Baking', 'Holiday', 'Drinks', 'Sauce', 'Snack', 'Other'];
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

const S = {
  store: null, me: null, recipes: [], grocery: [], draft: null,
  filter: { q: '', show: 'all', cat: '', by: '', sort: 'new' },
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
const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
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
  const people = [...new Set(S.recipes.map((r) => r.createdBy && r.createdBy.name).filter(Boolean))].sort();
  view.innerHTML = `
    <section class="list-head">
      <div class="search"><span aria-hidden="true">🔍</span><input id="q" type="search" placeholder="Search recipes, ingredients, notes…" value="${esc(f.q)}" aria-label="Search recipes"></div>
      <div class="chips" role="group" aria-label="Show">
        ${[['all', 'All'], ['fav', '♥ My favorites'], ['loved', '★ Family favorites'], ['mine', 'Added by me']].map(([k, l]) => `<button class="chip ${f.show === k ? 'on' : ''}" data-show="${k}">${l}</button>`).join('')}
      </div>
      <div class="filters">
        <select id="cat" aria-label="Category"><option value="">All categories</option>${CATEGORIES.map((c) => `<option ${f.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <select id="by" aria-label="Added by"><option value="">Anyone</option>${people.map((p) => `<option ${f.by === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <select id="sort" aria-label="Sort"><option value="new" ${f.sort === 'new' ? 'selected' : ''}>Newest</option><option value="az" ${f.sort === 'az' ? 'selected' : ''}>A–Z</option><option value="loved" ${f.sort === 'loved' ? 'selected' : ''}>Most loved</option><option value="updated" ${f.sort === 'updated' ? 'selected' : ''}>Recently changed</option></select>
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
      if (f.by && !(r.createdBy && r.createdBy.name === f.by)) return false;
      if (q) {
        const hay = [r.title, r.description, r.notes, r.category, (r.tags || []).join(' '), r.source, r.createdBy && r.createdBy.name, ...(r.ingredients || []).map((i) => i.item)].join(' ').toLowerCase();
        return q.split(/\s+/).every((w) => hay.includes(w));
      }
      return true;
    });
    const by = { new: (a, b) => (b.createdAt || 0) - (a.createdAt || 0), az: (a, b) => (a.title || '').localeCompare(b.title || ''), loved: (a, b) => favNames(b).length - favNames(a).length, updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) };
    rs.sort(by[f.sort]);
    const el = $('#cards');
    if (!S.recipes.length) {
      el.innerHTML = `<div class="empty"><div class="empty-leaf" aria-hidden="true">🍂</div><h2>No recipes yet</h2><p>Snap a photo of a recipe card, open a Word document, or type one in.</p>${can(S.me, 'addRecipe') ? '<a class="btn primary" href="#/add">Add the first recipe</a>' : ''}</div>`;
      return;
    }
    if (!rs.length) { el.innerHTML = '<p class="muted center">No recipes match.</p>'; return; }
    el.innerHTML = rs.map(card).join('');
  };
  draw();
  $('#q').addEventListener('input', (e) => { f.q = e.target.value; draw(); });
  $$('[data-show]').forEach((b) => b.addEventListener('click', () => { f.show = b.dataset.show; $$('[data-show]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  $('#cat').onchange = (e) => { f.cat = e.target.value; draw(); };
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
      <p class="meta">${r.category ? `<span class="tag">${esc(r.category)}</span>` : ''} ${r.createdBy ? `by <b>${esc(r.createdBy.name)}</b>` : ''}</p>
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
        <p class="eyebrow">${esc(r.category || '')}${(r.tags || []).length ? ' · ' + (r.tags || []).map(esc).join(', ') : ''}</p>
        <h1>${esc(r.title)}</h1>
        ${r.description ? `<p class="lede">${esc(r.description)}</p>` : ''}
        <p class="byline">${avatar(r.createdBy && r.createdBy.name)} Shared by <b>${esc(r.createdBy ? r.createdBy.name : 'someone')}</b> · ${esc(when(r.createdAt))}${r.updatedBy && r.updatedAt !== r.createdAt ? ` · edited by ${esc(r.updatedBy.name)} ${esc(when(r.updatedAt))}` : ''}</p>
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
      <button class="add-tile" id="a-word"><span aria-hidden="true">📄</span><b>Word document</b><small>.docx files (also .txt)</small></button>
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
    const file = await pickFile('.docx,.doc,.txt,.md,.rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain');
    if (!file) return;
    original = null;
    const text = await guard(() => (/\.(txt|md)$/i.test(file.name) ? readTextFile(file) : readWordFile(file)));
    if (text != null) { show(); $('#ex-img').hidden = true; $('#ex-text').value = text.trim(); }
  };
  $('#a-paste').onclick = () => { original = null; show(); $('#ex-img').hidden = true; $('#ex-text').focus(); };
  $('#ex-go').onclick = () => {
    const parsed = parseRecipeText($('#ex-text').value);
    S.draft = { ...blankRecipe(), ...parsed, _original: original };
    if (!S.draft.title) S.draft.title = 'New recipe';
    go('#/new');
  };
}

// ------------------------------------------------------------- editor -----
function blankRecipe() {
  return { title: '', description: '', category: '', tags: [], servings: 4, prepTime: '', cookTime: '', source: '', ingredients: [], steps: [], notes: '' };
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
          <label>Category<select name="category"><option value="">—</option>${CATEGORIES.map((c) => `<option ${r.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label>Servings<input name="servings" inputmode="decimal" value="${esc(r.servings ?? '')}"></label>
          <label>Tags<input name="tags" value="${esc((r.tags || []).join(', '))}" placeholder="pie, fall"></label>
        </div>
        <div class="row3">
          <label>Prep time<input name="prepTime" value="${esc(r.prepTime)}" placeholder="20 min"></label>
          <label>Cook time<input name="cookTime" value="${esc(r.cookTime)}" placeholder="1 hr"></label>
          <label>Source<input name="source" value="${esc(r.source)}" placeholder="Aunt May's card"></label>
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
    for (const k of ['title', 'description', 'category', 'prepTime', 'cookTime', 'source', 'notes']) r[k] = (fd.get(k) || '').toString();
    r.servings = parseNumber(fd.get('servings')) || null;
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
        <form id="invite" class="invite">
          <h3>Add a family member</h3>
          <div class="row3">
            <label>Their Google email<input name="email" type="email" required placeholder="aunt.may@gmail.com"></label>
            <label>Name shown in the app<input name="name" placeholder="Aunt May"></label>
            <label>Access<select name="role">${ROLES.map((r) => `<option value="${r}" ${r === 'contributor' ? 'selected' : ''}>${cap(r)}</option>`).join('')}</select></label>
          </div>
          <p><button class="btn primary">Add member</button> <button type="button" class="btn" id="copy-invite">Copy invite message</button></p>
        </form>` : ''}
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
    const inv = $('#invite');
    if (inv) {
      inv.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(inv);
        const ok = await guard(() => st.setMember(fd.get('email'), { name: fd.get('name'), role: fd.get('role') }).then(() => true), 'Added! Now send them the invite message.');
        if (ok) inv.reset();
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
    view.innerHTML = `<div class="gate-card"><div class="logo-big" aria-hidden="true">🍂</div><h1>Family Recipes</h1><p>Sign in with the Google account your family added.</p><button class="btn primary big" id="gsi">Sign in with Google</button></div>`;
    $('#gsi').onclick = () => guard(() => st.signIn());
  } else if (phase === 'notmember') {
    view.innerHTML = `<div class="gate-card"><div class="logo-big" aria-hidden="true">🔒</div><h1>Almost there</h1><p>You're signed in as <b>${esc(st.me.email)}</b>, but you haven't been added to ${st.family ? '<b>' + esc(st.family.name) + '</b>' : 'the family'} yet.</p><p>Ask the family owner to add this email in the <b>Family</b> tab, then tap below.</p><p class="btn-row"><button class="btn primary" id="retry">I've been added — try again</button> <button class="btn" id="out">Use another account</button></p></div>`;
    $('#retry').onclick = () => location.reload();
    $('#out').onclick = () => st.signOut();
  } else if (phase === 'setup') {
    const local = st.mode === 'local';
    view.innerHTML = `<form class="gate-card" id="setup"><div class="logo-big" aria-hidden="true">🍁</div><h1>Welcome!</h1>
      <p>${local ? 'Let\'s set up your recipe book.' : 'You\'re the first one here, so you\'ll be the family <b>owner</b> — you decide who can see and edit recipes.'}</p>
      <label>Family name<input name="fam" required value="The ${esc((st.me.name || '').split(' ').slice(-1)[0] || 'Family')} Family Kitchen"></label>
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

async function boot() {
  S.store = firebaseConfig ? new FirebaseStore(firebaseConfig) : new LocalStore();
  let phase;
  try { phase = await S.store.init((p) => (p.phase === 'ready' ? start() : renderGate(p.phase))); }
  catch (e) { console.error(e); view.innerHTML = `<div class="gate-card"><h1>Can't connect</h1><p>${esc(friendlyError(e))}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; return; }
  if (phase.phase === 'ready') start(); else renderGate(phase.phase);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
