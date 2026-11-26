// Data layer. Two interchangeable backends with the same methods:
//   LocalStore    - this device only (IndexedDB). Used until Firebase is configured.
//   FirebaseStore - shared with the family (Firestore + Google sign-in), live-syncing, works offline.
//
// Roles, highest first. Each role can do everything the ones below it can.
//   owner       - manage family members and roles; everything else
//   editor      - edit or delete any recipe, photo or comment
//   contributor - add recipes; edit/delete their own
//   viewer      - read, favorite, comment, add photos
export const ROLES = ['owner', 'editor', 'contributor', 'viewer'];
export const ROLE_INFO = {
  owner: 'Manages the family list and everyone\'s access. Can do everything.',
  editor: 'Can add, change or delete any recipe, photo or comment.',
  contributor: 'Can add recipes and change their own. Can comment and add photos on any.',
  viewer: 'Can read recipes, favorite them, comment and add photos.',
};
const RANK = { owner: 4, editor: 3, contributor: 2, viewer: 1 };
export const atLeast = (role, need) => (RANK[role] || 0) >= (RANK[need] || 0);

export function can(me, action, obj) {
  if (!me) return false;
  const mine = obj && ((obj.createdBy && obj.createdBy.uid === me.uid) || (obj.by && obj.by.uid === me.uid));
  switch (action) {
    case 'addRecipe': return atLeast(me.role, 'contributor');
    case 'editRecipe':
    case 'deleteRecipe': return atLeast(me.role, 'editor') || (atLeast(me.role, 'contributor') && mine);
    case 'comment':
    case 'addPhoto':
    case 'favorite': return atLeast(me.role, 'viewer');
    case 'deleteComment':
    case 'deletePhoto': return atLeast(me.role, 'editor') || mine;
    case 'manageMembers': return me.role === 'owner';
    default: return false;
  }
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function emitter() {
  const subs = new Map();
  return {
    on(k, fn) { (subs.get(k) || subs.set(k, new Set()).get(k)).add(fn); return () => subs.get(k).delete(fn); },
    emit(k, v) { (subs.get(k) || []).forEach((fn) => fn(v)); },
  };
}

// ---------------------------------------------------------------- Local ---
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('family-recipes', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of ['recipes', 'comments', 'photos', 'kv']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(db, store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  });
}

export class LocalStore {
  constructor() { this.mode = 'local'; this.ev = emitter(); }
  async init() {
    this.db = await idb();
    const me = await this._kv('me');
    this.me = me || { uid: 'local', name: '', email: '', role: 'owner' };
    const fam = await this._kv('family');
    this.family = fam || { name: 'Our Family' };
    return { phase: this.me.name ? 'ready' : 'setup' };
  }
  async _kv(k, v) {
    if (v === undefined) { const r = await tx(this.db, 'kv', 'readonly', (s) => s.get(k)); return r ? r.v : null; }
    return tx(this.db, 'kv', 'readwrite', (s) => s.put({ id: k, v }));
  }
  async _all(store) { return tx(this.db, store, 'readonly', (s) => s.getAll()); }
  async setupFamily(familyName, myName) {
    this.family = { name: familyName || 'Our Family' };
    this.me = { ...this.me, name: myName };
    await this._kv('family', this.family); await this._kv('me', this.me);
  }
  async renameFamily(name) { this.family.name = name; await this._kv('family', this.family); }
  async renameMe(name) { this.me.name = name; await this._kv('me', this.me); }
  async _emitRecipes() { this.ev.emit('recipes', await this._all('recipes')); }
  subscribeRecipes(cb) { const off = this.ev.on('recipes', cb); this._emitRecipes(); return off; }
  async saveRecipe(r) {
    const now = Date.now();
    const rec = { ...r, id: r.id || newId(), updatedAt: now, updatedBy: { uid: this.me.uid, name: this.me.name } };
    if (!r.createdAt) { rec.createdAt = now; rec.createdBy = { uid: this.me.uid, name: this.me.name }; }
    rec.history = [{ at: now, by: this.me.name, what: r.id ? 'edited' : 'added' }, ...(r.history || [])].slice(0, 25);
    await tx(this.db, 'recipes', 'readwrite', (s) => s.put(rec));
    this._emitRecipes();
    return rec.id;
  }
  async patchRecipe(id, patch) {
    const r = await tx(this.db, 'recipes', 'readonly', (s) => s.get(id));
    if (!r) return;
    await tx(this.db, 'recipes', 'readwrite', (s) => s.put({ ...r, ...patch }));
    this._emitRecipes();
  }
  async deleteRecipe(id) {
    await tx(this.db, 'recipes', 'readwrite', (s) => s.delete(id));
    for (const c of (await this._all('comments')).filter((c) => c.recipeId === id)) await tx(this.db, 'comments', 'readwrite', (s) => s.delete(c.id));
    for (const p of (await this._all('photos')).filter((p) => p.recipeId === id)) await tx(this.db, 'photos', 'readwrite', (s) => s.delete(p.id));
    this._emitRecipes();
  }
  async toggleFavorite(recipe) {
    const fav = { ...(recipe.favorites || {}) };
    if (fav[this.me.uid]) delete fav[this.me.uid]; else fav[this.me.uid] = this.me.name;
    await this.patchRecipe(recipe.id, { favorites: fav });
  }
  async _emitSub(store, rid) { this.ev.emit(store + ':' + rid, (await this._all(store)).filter((x) => x.recipeId === rid).sort((a, b) => a.at - b.at)); }
  subscribeComments(rid, cb) { const off = this.ev.on('comments:' + rid, cb); this._emitSub('comments', rid); return off; }
  async addComment(rid, text) {
    await tx(this.db, 'comments', 'readwrite', (s) => s.put({ id: newId(), recipeId: rid, text, at: Date.now(), by: { uid: this.me.uid, name: this.me.name } }));
    this._emitSub('comments', rid);
  }
  async deleteComment(rid, cid) { await tx(this.db, 'comments', 'readwrite', (s) => s.delete(cid)); this._emitSub('comments', rid); }
  subscribePhotos(rid, cb) { const off = this.ev.on('photos:' + rid, cb); this._emitSub('photos', rid); return off; }
  async addPhoto(rid, { data, caption = '', kind = 'dish' }) {
    const id = newId();
    await tx(this.db, 'photos', 'readwrite', (s) => s.put({ id, recipeId: rid, data, caption, kind, at: Date.now(), by: { uid: this.me.uid, name: this.me.name } }));
    this._emitSub('photos', rid);
    return id;
  }
  async deletePhoto(rid, pid) { await tx(this.db, 'photos', 'readwrite', (s) => s.delete(pid)); this._emitSub('photos', rid); }
  subscribeMembers(cb) { cb([{ email: '', name: this.me.name, role: 'owner', you: true }]); return () => {}; }
  async setMember() { throw new Error('Connect Firebase (see the Family tab) to invite family members.'); }
  subscribeInvites(cb) { cb([]); return () => {}; }
  async createInvites() { throw new Error('Connect Firebase (see the Family tab) to invite family members.'); }
  async deleteInvite() {}
  async claimInvite() { return { phase: 'ready' }; }
  async removeMember() {}
  async getGrocery() { return (await this._kv('grocery')) || []; }
  async saveGrocery(list) { await this._kv('grocery', list); }
  async exportAll() { return { recipes: await this._all('recipes'), comments: await this._all('comments'), photos: await this._all('photos') }; }
  async importAll(data) {
    for (const store of ['recipes', 'comments', 'photos']) for (const x of data[store] || []) await tx(this.db, store, 'readwrite', (s) => s.put(x));
    this._emitRecipes();
  }
  async signOut() {}
}

// ------------------------------------------------------------- Firebase ---
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

export class FirebaseStore {
  constructor(config) { this.mode = 'firebase'; this.config = config; this.recipes = []; }
  async init(onPhase) {
    const [appM, authM, fsM] = await Promise.all([
      import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js'),
    ]);
    this.A = authM; this.F = fsM;
    const app = appM.initializeApp(this.config);
    this.auth = authM.getAuth(app);
    try {
      this.db = fsM.initializeFirestore(app, { localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }) });
    } catch { this.db = fsM.getFirestore(app); }
    // Local testing against the Firebase emulators (set emulator: true in config).
    if (this.config.emulator) {
      authM.connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      fsM.connectFirestoreEmulator(this.db, '127.0.0.1', 8080);
    }
    authM.getRedirectResult(this.auth).catch(() => {});
    this.onPhase = onPhase;
    return new Promise((resolve) => {
      let first = true;
      authM.onAuthStateChanged(this.auth, async (user) => {
        const phase = await this._phaseFor(user);
        if (first) { first = false; resolve(phase); } else onPhase && onPhase(phase);
      });
    });
  }
  async _phaseFor(user) {
    this.user = user;
    if (!user) return { phase: 'signin' };
    // Email + password accounts must confirm their address once, so nobody can
    // sign up with a relative's email and get their access.
    if (!user.emailVerified) { this.me = { uid: user.uid, email: user.email, name: user.displayName || '', role: null }; return { phase: 'verify' }; }
    const { doc, getDoc, setDoc } = this.F;
    const email = (user.email || '').toLowerCase();
    let famSnap;
    try { famSnap = await getDoc(doc(this.db, 'meta', 'family')); } catch { famSnap = null; }
    let memSnap;
    try { memSnap = await getDoc(doc(this.db, 'members', email)); } catch { memSnap = null; }
    if (memSnap && memSnap.exists()) {
      const m = memSnap.data();
      this.me = { uid: user.uid, email, name: m.name || user.displayName || email, role: m.role, photo: user.photoURL || '' };
      this.family = famSnap && famSnap.exists() ? famSnap.data() : { name: 'Our Family' };
      if (m.uid !== user.uid) setDoc(doc(this.db, 'members', email), { uid: user.uid }, { merge: true }).catch(() => {});
      return { phase: 'ready' };
    }
    this.me = { uid: user.uid, email, name: user.displayName || '', role: null };
    this.family = famSnap && famSnap.exists() ? famSnap.data() : null;
    // No family yet -> whoever signs in first sets it up and becomes the owner.
    if (famSnap && !famSnap.exists()) return { phase: 'setup' };
    return { phase: 'notmember' };
  }
  async signIn() {
    const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = this.A;
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    try { await signInWithPopup(this.auth, p); }
    catch (e) {
      if (/popup-blocked|operation-not-supported|popup-closed-by-user/.test(e.code || '') && e.code !== 'auth/popup-closed-by-user') return signInWithRedirect(this.auth, p);
      throw e;
    }
  }
  // ---- email + password (works everywhere, including iPhone home-screen apps)
  async signInEmail(email, password) {
    await this.A.signInWithEmailAndPassword(this.auth, String(email).trim(), password);
  }
  async signUpEmail(email, password, name) {
    const cred = await this.A.createUserWithEmailAndPassword(this.auth, String(email).trim(), password);
    if (name) await this.A.updateProfile(cred.user, { displayName: name });
    await this.A.sendEmailVerification(cred.user, { url: location.href.split('#')[0] });
  }
  async resendVerification() { await this.A.sendEmailVerification(this.auth.currentUser, { url: location.href.split('#')[0] }); }
  async resetPassword(email) { await this.A.sendPasswordResetEmail(this.auth, String(email).trim()); }
  // After tapping the link in the email: refresh the account and carry on.
  async checkVerified() {
    const u = this.auth.currentUser;
    if (!u) return { phase: 'signin' };
    await u.reload();
    if (!this.auth.currentUser.emailVerified) return { phase: 'verify' };
    await this.auth.currentUser.getIdToken(true);
    return this._phaseFor(this.auth.currentUser);
  }
  async signOut() { await this.A.signOut(this.auth); location.hash = '#/'; location.reload(); }
  async setupFamily(familyName, myName) {
    const { doc, writeBatch } = this.F;
    const b = writeBatch(this.db);
    b.set(doc(this.db, 'meta', 'family'), { name: familyName || 'Our Family', createdAt: Date.now() });
    b.set(doc(this.db, 'members', this.me.email), { name: myName, role: 'owner', uid: this.me.uid, addedBy: myName, addedAt: Date.now() });
    await b.commit();
    this.me = { ...this.me, name: myName, role: 'owner' };
    this.family = { name: familyName };
  }
  async renameFamily(name) { await this.F.updateDoc(this.F.doc(this.db, 'meta', 'family'), { name }); this.family.name = name; }
  async renameMe(name) { await this.F.updateDoc(this.F.doc(this.db, 'members', this.me.email), { name }); this.me.name = name; }
  subscribeRecipes(cb) {
    const { collection, onSnapshot } = this.F;
    return onSnapshot(collection(this.db, 'recipes'), (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), (e) => console.error(e));
  }
  async saveRecipe(r) {
    const { doc, setDoc } = this.F;
    const now = Date.now();
    const rec = JSON.parse(JSON.stringify({ ...r, updatedAt: now, updatedBy: { uid: this.me.uid, name: this.me.name } }));
    if (!r.createdAt) { rec.createdAt = now; rec.createdBy = { uid: this.me.uid, name: this.me.name }; }
    rec.history = [{ at: now, by: this.me.name, what: r.id ? 'edited' : 'added' }, ...(r.history || [])].slice(0, 25);
    const id = r.id || newId();
    delete rec.id;
    await setDoc(doc(this.db, 'recipes', id), rec);
    return id;
  }
  async patchRecipe(id, patch) { await this.F.updateDoc(this.F.doc(this.db, 'recipes', id), patch); }
  async deleteRecipe(id) {
    const { collection, doc, getDocs, query, where, writeBatch } = this.F;
    const b = writeBatch(this.db);
    (await getDocs(collection(this.db, 'recipes', id, 'comments'))).forEach((d) => b.delete(d.ref));
    (await getDocs(query(collection(this.db, 'photos'), where('recipeId', '==', id)))).forEach((d) => b.delete(d.ref));
    b.delete(doc(this.db, 'recipes', id));
    await b.commit();
  }
  async toggleFavorite(recipe) {
    const { doc, updateDoc, deleteField } = this.F;
    const on = recipe.favorites && recipe.favorites[this.me.uid];
    await updateDoc(doc(this.db, 'recipes', recipe.id), { ['favorites.' + this.me.uid]: on ? deleteField() : this.me.name });
  }
  subscribeComments(rid, cb) {
    const { collection, onSnapshot } = this.F;
    return onSnapshot(collection(this.db, 'recipes', rid, 'comments'), (s) => cb(s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => a.at - b.at)), (e) => { console.error('comments', e); cb([]); });
  }
  async addComment(rid, text) {
    await this.F.addDoc(this.F.collection(this.db, 'recipes', rid, 'comments'), { text, at: Date.now(), by: { uid: this.me.uid, name: this.me.name } });
  }
  async deleteComment(rid, cid) { await this.F.deleteDoc(this.F.doc(this.db, 'recipes', rid, 'comments', cid)); }
  subscribePhotos(rid, cb) {
    const { collection, onSnapshot, query, where } = this.F;
    return onSnapshot(query(collection(this.db, 'photos'), where('recipeId', '==', rid)), (s) => cb(s.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => a.at - b.at)), (e) => { console.error('photos', e); cb([]); });
  }
  async addPhoto(rid, { data, caption = '', kind = 'dish' }) {
    const ref = await this.F.addDoc(this.F.collection(this.db, 'photos'), { recipeId: rid, data, caption, kind, at: Date.now(), by: { uid: this.me.uid, name: this.me.name } });
    return ref.id;
  }
  async deletePhoto(rid, pid) { await this.F.deleteDoc(this.F.doc(this.db, 'photos', pid)); }
  subscribeMembers(cb) {
    const { collection, onSnapshot } = this.F;
    return onSnapshot(collection(this.db, 'members'), (s) => cb(s.docs.map((d) => ({ ...d.data(), email: d.id, you: d.id === this.me.email }))));
  }
  async setMember(email, { name, role }) {
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Please enter a valid email address.');
    if (!ROLES.includes(role)) throw new Error('Pick a role.');
    await this.F.setDoc(this.F.doc(this.db, 'members', e), { name: name || e.split('@')[0], role, addedBy: this.me.name, addedAt: Date.now() }, { merge: true });
  }
  async removeMember(email) { await this.F.deleteDoc(this.F.doc(this.db, 'members', email)); }
  // ---- invite links
  subscribeInvites(cb) {
    const { collection, onSnapshot } = this.F;
    return onSnapshot(collection(this.db, 'invites'), (s) => cb(s.docs.map((d) => ({ ...d.data(), code: d.id })).sort((a, b) => a.createdAt - b.createdAt)));
  }
  async createInvites(people) {
    const { doc, writeBatch } = this.F;
    const b = writeBatch(this.db);
    const codes = [];
    const now = Date.now();
    for (const [i, p] of people.entries()) {
      if (!ROLES.includes(p.role) || p.role === 'owner') throw new Error('Invite links can be Editor, Contributor or Viewer.');
      const code = Array.from(crypto.getRandomValues(new Uint8Array(15)), (x) => 'abcdefghjkmnpqrstuvwxyz23456789'[x % 31]).join('');
      b.set(doc(this.db, 'invites', code), { name: p.name, role: p.role, createdBy: this.me.name, createdAt: now + i, usedBy: null });
      codes.push(code);
    }
    await b.commit();
    return codes;
  }
  async deleteInvite(code) { await this.F.deleteDoc(this.F.doc(this.db, 'invites', code)); }
  // Signed in but not on the family list yet: join with an invite code.
  async claimInvite(code) {
    const { doc, getDoc, writeBatch } = this.F;
    const snap = await getDoc(doc(this.db, 'invites', code)).catch(() => null);
    if (!snap || !snap.exists()) throw new Error('That invite link isn\'t valid any more. Ask for a new one.');
    const inv = snap.data();
    if (inv.usedBy && inv.usedBy !== this.me.email) throw new Error('That invite link was already used. Ask for a new one.');
    const b = writeBatch(this.db);
    b.set(doc(this.db, 'members', this.me.email), { name: inv.name, role: inv.role, uid: this.me.uid, invite: code, addedBy: inv.createdBy || '', addedAt: Date.now() });
    b.update(doc(this.db, 'invites', code), { usedBy: this.me.email, usedAt: Date.now() });
    await b.commit();
    return this._phaseFor(this.auth.currentUser);
  }
  async getGrocery() {
    const s = await this.F.getDoc(this.F.doc(this.db, 'grocery', this.me.uid));
    return s.exists() ? s.data().items || [] : [];
  }
  async saveGrocery(items) { await this.F.setDoc(this.F.doc(this.db, 'grocery', this.me.uid), { items: JSON.parse(JSON.stringify(items)) }); }
  async exportAll() {
    const { collection, getDocs } = this.F;
    const recipes = (await getDocs(collection(this.db, 'recipes'))).docs.map((d) => ({ ...d.data(), id: d.id }));
    const photos = (await getDocs(collection(this.db, 'photos'))).docs.map((d) => ({ ...d.data(), id: d.id }));
    const comments = [];
    for (const r of recipes) (await getDocs(collection(this.db, 'recipes', r.id, 'comments'))).forEach((d) => comments.push({ ...d.data(), id: d.id, recipeId: r.id }));
    return { recipes, comments, photos };
  }
  async importAll(data) {
    const { doc, setDoc } = this.F;
    for (const r of data.recipes || []) { const { id, ...rest } = r; await setDoc(doc(this.db, 'recipes', id), rest); }
    for (const p of data.photos || []) { const { id, ...rest } = p; await setDoc(doc(this.db, 'photos', id), { ...rest, by: rest.by && rest.by.uid ? { ...rest.by, uid: this.me.uid } : { uid: this.me.uid, name: this.me.name } }); }
    for (const c of data.comments || []) { const { id, recipeId, ...rest } = c; await setDoc(doc(this.db, 'recipes', recipeId, 'comments', id), { ...rest, by: { ...(rest.by || {}), uid: this.me.uid } }); }
  }
}
