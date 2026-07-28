# SKT Campaign Workspace — Setup Guide

## Cache-busting is automatic (nothing to remember)

A git pre-commit hook runs `tools/stamp-build.js` for you whenever a commit touches JS or CSS. It hashes every JS/CSS file, writes that hash into its `?v=` in `skt-workspace.html`, stamps `sw.js` with a matching build id + precache list, and stages those two files with your commit. Commits that don't touch JS/CSS are left alone.

**This replaces hand-bumping `?v=` dates** — forgetting that was silent, and meant browsers kept running old code while you wondered why a fix "didn't work."

**After a fresh clone, or on a second machine, install the hook once:**

```bash
sh tools/hooks/install.sh
```

(`.git/hooks` isn't version-controlled, so the hook lives in `tools/hooks/` and is copied into place by that script.)

You never need to run the stamper by hand, but these still work if you want them:

```bash
node tools/stamp-build.js          # stamp now
node tools/stamp-build.js --check  # exit 1 if stamping is needed (CI gate)
```

If node is missing on a machine, the hook warns and lets the commit through rather than blocking you. `git commit --no-verify` bypasses it for one commit.

## Where images come from

Image URLs are built by `assetUrl()` / `assetThumbUrl()` in `js/utils.js`, and the base is set in **`js/asset-config.js`**:

- `imgBase: ''` → local files (`img/…`). This is the current setting; everything works exactly as before.
- `imgBase: 'https://…'` → object storage. The **bucket root must mirror the contents of `img/`** (it contains `adventure/`, `bestiary/`, … directly), with thumbnails under a `thumbs/` prefix.

Switching hosts is a one-line change. Nothing else hardcodes an image path — and image paths saved in your campaign data stay *relative*, so they never bake in a hostname and keep working across devices and hosts.

**If you set a cross-origin base, two things are mandatory or images break in subtle ways:**
1. **CORS on the bucket** (allow `GET` from the site origin). Without it the battle map's adaptive grid-contrast silently stops working (the canvas gets tainted) and the service worker can't cache images at all.
2. **Add the origin to `IMG_ORIGINS` in `sw.js`** — otherwise images bypass the offline cache entirely.

### Thumbnails

`tools/make-thumbs.py` (needs `pip install Pillow`) generates 400 px browse thumbnails into `thumbs/`, mirroring the `img/` tree. It scopes itself to exactly the images the grid UIs show — anything tagged `imageType: map`/`mapPlayer` in the adventure/book data, plus covers — by applying the same filter the map picker uses.

```bash
python tools/make-thumbs.py            # generate (skips up-to-date)
python tools/make-thumbs.py --dry-run  # report scope only
```

Current output: 1,702 thumbnails, 46 MB — versus 1,884 MB for the same images at full size. A map-picker card is ~28 KB instead of ~2.5 MB. Missing thumbnails are harmless: every consumer falls back to the full-size image.

`img/` and `thumbs/` are both gitignored.

## Offline support

`sw.js` is a service worker that precaches the app shell, so the workspace **boots and runs with no network** — your campaign comes from localStorage and the 5e index from IndexedDB. Firebase reconnects on its own when you're back online.

When you deploy a new build, open tabs show a **"A new version is available — Reload"** toast rather than swapping code mid-session. That prompt is also the fix for version skew: a device running old code writes old-shaped sync data, and nothing used to tell anyone they were behind.

Caching rules, if you need to reason about them: HTML is network-first (so fresh asset hashes always win when online), hashed JS/CSS are cache-first (safe — a changed file is a different URL), `data/*.json` is stale-while-revalidate (edits self-heal on the next load), `img/` is cached on use and capped at 120 entries, and **anything cross-origin — Firebase, gstatic — is never intercepted**.

To wipe caches during development: DevTools → Application → Service Workers → Unregister, or tick "Update on reload".

## Locking Down the Database (auth + rules) — RECOMMENDED

Out of the box the database runs in "test mode": anyone who finds the URL can read or wipe the whole campaign. The app now signs every client in anonymously, which lets you lock the database to app users only. Two console steps, ~2 minutes:

1. **Enable anonymous sign-in:** Firebase console → **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save.**
2. **Apply the rules:** Firebase console → **Build → Realtime Database → Rules** tab → replace the contents with the contents of [`firebase-rules.json`](firebase-rules.json) from this repo → **Publish.**

Order matters: deploy the current site code first and have every device reload it (so all clients are signing in), THEN publish the rules. A device still running old code when the rules land will show "Offline" until it reloads. To verify it worked: the app's console logs `[SKT] signed in anonymously (uid …)` and the Live pill stays green, while opening the database URL raw in a browser gets permission-denied.

---

## Sharing with Friends (Real-Time Sync)

To let friends access the app and sync changes in real time, you need to:
1. Set up a free Firebase database (~5 minutes)
2. Host the files online (~5 minutes)

---

## Step 1 — Create Firebase Database

1. Go to **https://console.firebase.google.com** and sign in with a Google account
2. Click **"Add project"** → give it any name → Continue (disable Analytics if you want, it doesn't matter)
3. In the left sidebar: **Build → Realtime Database → Create database**
   - Choose any region
   - Select **"Start in test mode"** → Enable
4. In the left sidebar: **Project Settings** (gear icon) → **Your apps**
   - Click the **`</>`** (Web) button → Register app (any nickname) → **Register app**
   - Copy the `firebaseConfig` object — it looks like:
     ```js
     const firebaseConfig = {
       apiKey: "AIza...",
       authDomain: "your-project.firebaseapp.com",
       databaseURL: "https://your-project-default-rtdb.firebaseio.com",
       projectId: "your-project",
       storageBucket: "your-project.appspot.com",
       messagingSenderId: "123456789",
       appId: "1:123456789:web:abc123"
     };
     ```

5. Open `js/realtime.js` and replace the 7 `'REPLACE_ME'` values with the values from your config

---

## Step 2 — Host the Files Online

Pick any free hosting option:

### Option A: GitHub Pages (recommended, free forever)
1. Create a free account at **github.com**
2. Create a new repository (any name) — set it to **Public**
3. Upload all the files in this folder to the repository
4. Go to **Settings → Pages → Source → main branch → Save**
5. Your URL will be: `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/skt-workspace.html`

### Option B: Netlify (drag and drop, no account needed)
1. Go to **https://app.netlify.com/drop**
2. Drag the entire `DND_Site` folder onto the page
3. Done — Netlify gives you a URL instantly

### Option C: Vercel
1. Go to **https://vercel.com** and sign in with GitHub
2. Click **"Add New Project"** → import your GitHub repository
3. Deploy → get a URL

---

## Step 3 — Share the URL

Send your friends the URL. That's it.

- Everyone who opens the URL will share the same data in real time
- Changes sync within ~1 second
- The green dot in the top bar means everyone is connected

---

## Installing as an App (Optional)

On any device, open the URL in Chrome or Edge:
- **Desktop**: Click the install icon (⊕) in the address bar → Install
- **Android**: Tap the browser menu → "Add to Home Screen"
- **iPhone/iPad**: Tap the Share button → "Add to Home Screen"

This makes it feel like a native app — it opens in its own window with no browser chrome.

---

## Notes

- **Battle map background image**: Each user must upload their own map image. Images are not synced (they're too large for the database).
- **Sound board audio**: Each user uploads their own audio files locally.
- **Panel positions**: Each user's window layout is their own — positions don't sync.
- **Security**: The database is open to anyone with the URL. This is fine for a private friend group. If you want to lock it down, add Firebase Authentication later.
- **Data limit**: Firebase free tier allows 1 GB stored and 10 GB/month transferred — far more than this app will ever use.
