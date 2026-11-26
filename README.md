# Family Recipes 🍁

A shared family recipe book that works like an app on phones, tablets and computers, without an App Store, and free.

- **Add recipes from anywhere:** take a photo of a recipe card or cookbook page (the text is read automatically), open a Word document (`.docx`), paste text, or type it in. The original photo is kept with the recipe.
- **Whole cookbooks at once:** open a Word file with many recipes, one heading per recipe. Every recipe is found, sorted into a course, and shown in a list to check before importing all of them. Titles like “Stuffing-mom/dad” or “Potato pie-nanny’s” fill in **whose recipe** it is.
- **Ingredients with weights:** every ingredient shows its amount and its **mass in grams**. Weights come from standard kitchen charts (for example, 1 cup flour ≈ 125 g). Tap any weight to enter the exact one. Switch between *Cups & spoons* and *Grams*.
- **Servings scaler:** use − / + and every amount and weight updates.
- **Step by step:** tap a step to cross it off, or use **Cook mode** to see one large step at a time. The screen stays on while you cook.
- **Notes, photos and comments:** anyone can add a photo of how theirs turned out and leave comments.
- **Favorites:** ♥ a recipe and everyone sees who loves it. Recipes loved by two or more people get a ★ *Family favorite* ribbon.
- **Whose recipe and who shared it:** each recipe can say whose it is (Nanny, Dad…), and you can filter by it. every recipe shows who added it and who last edited it, with a change history.
- **Sort and filter:** tap a **course** (Appetizers, Breads, Mains, Desserts, Soups, Sides…) or a **main ingredient** (Chicken, Beef & Steak, Pork, Fish & Seafood, Turkey, Lamb, Vegetarian…) to filter, or choose *Group by course* / *Group by main ingredient*. The main ingredient is detected automatically from the title and ingredients (chicken broth alone doesn't count as chicken, and doesn't count as vegetarian either). You can change it in the editor.
- **Grocery list:** tick the ingredients you need and tap *Add to grocery list*. Amounts from different recipes are combined (including grams) and sorted by store aisle. Share the list by text.
- **Family access levels:** Owner, Editor, Contributor and Viewer (see below).
- **Works offline** once it has been opened, and can be installed on the home screen.
- **Backup:** download every recipe, comment and photo as one file.

## Try it

Open `index.html` through any web server, for example `python3 -m http.server` in this folder (or `npm start`), then visit http://localhost:8000. Until Firebase is connected, the app runs in **This device** mode: everything works, but recipes stay in that browser.

Every push to `main` tests the app and publishes it with GitHub Pages at
**https://jschmitt1531.github.io/recipes/**

One-time setup: in this repository, open **Settings → Pages** and set **Source** to **GitHub Actions**. (GitHub Pages on the free plan needs the repository to be public. Only the app's code is public. Your family's recipes live in your private Firebase database, which only people you add can read.)

## Share with the family (one time, about 10 minutes, free)

Sharing uses Google's **Firebase** free "Spark" plan: Google sign-in plus a Firestore database. Photos are compressed and stored in the database itself, so no paid Storage bucket is needed. The free quota (1 GB stored, 50,000 reads a day) covers hundreds of recipes with photos for a family.

1. Go to https://console.firebase.google.com and sign in with your Google account → **Create a project** (e.g. `our-family-recipes`). Google Analytics can be turned off.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save.**
3. Still in Authentication: **Settings → Authorized domains → Add domain** → `jschmitt1531.github.io` (and `localhost` is already there for testing).
4. **Build → Firestore Database → Create database** → choose a location near you → start in **production mode**.
5. In Firestore open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**.
6. **Project settings (⚙️) → General → Your apps → Web (`</>`)** → register an app (any nickname, no Hosting needed). Copy the `firebaseConfig = { … }` object it shows.
7. Paste it into [`js/config.js`](js/config.js), replacing `null`, then commit and push. The config is not a secret; your data is protected by sign-in plus the rules.
8. Open the app and **Sign in with Google**. The first person to sign in sets up the family and becomes the **Owner**.
9. In the **Family** tab, add each relative's Google email and choose their access level, then tap **Copy invite message** and text it to them.

> Already added recipes in *This device* mode? Before step 7, open **Family → Download backup**. After connecting Firebase, use **Family → Restore from backup**.

## Access levels

| Level | Read, ♥ favorite, comment, add photos | Add recipes | Edit / delete own recipes | Edit / delete anyone's recipes, photos, comments | Add/remove family, change access |
|---|:-:|:-:|:-:|:-:|:-:|
| **Owner** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Editor** | ✓ | ✓ | ✓ | ✓ | |
| **Contributor** | ✓ | ✓ | ✓ | | |
| **Viewer** | ✓ | | | | |

These are enforced by `firestore.rules` on Google's servers, not just hidden in the app. People who aren't on the family list can't read anything. Owners can change anyone's level at any time, and you can have more than one Owner.

## Installing on a phone

- **iPhone / iPad (Safari):** open the link → **Share** → **Add to Home Screen**.
- **Android (Chrome):** open the link → **⋮** → **Install app** (or *Add to Home screen*).

## Good to know

- **Reading photos:** the text reader (Tesseract) runs on your device and works well on printed recipes and screenshots. Handwritten cards are hit and miss: check the text it finds, fix it, then press *Make recipe*. The original photo is always saved with the recipe.
- **Word files:** `.docx` is supported. Older `.doc` files: open them in Word or Google Docs and *Save as* `.docx`.
- **Weights:** marked ≈ when estimated. A dashed outline means the ingredient wasn't in the chart (it is estimated as water), so tap it to set the real weight. Weights you enter are saved for everyone.
- **Grocery lists** are personal: each person has their own.

## Files

| File | What it does |
|---|---|
| `index.html`, `css/app.css` | App shell and fall theme (burnt orange, cranberry, harvest gold, olive, cream), light and dark |
| `js/app.js` | Screens: recipe list, recipe, editor, add/import, grocery, family |
| `js/store.js` | Data: `LocalStore` (this device) and `FirebaseStore` (shared), roles |
| `js/units.js` | Units, fractions, scaling and the grams engine (ingredient density chart) |
| `js/parse.js` | Turns pasted, OCR or Word text into title, ingredients, steps and notes |
| `js/categories.js` | Courses and main ingredients, with auto-detection |
| `js/grocery.js` | Combining ingredients and sorting them by aisle |
| `js/importers.js` | Photo OCR (Tesseract.js), Word (mammoth.js), image compression |
| `firestore.rules` | Security rules for the shared database |
| `sw.js`, `manifest.webmanifest`, `icon*.{svg,png}` | Offline support and home-screen install |
| `tests/run.mjs` | Tests for parsing, units, weights and the grocery list: `node tests/run.mjs` |
