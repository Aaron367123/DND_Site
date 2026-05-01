# SKT Campaign Workspace — Setup Guide

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
