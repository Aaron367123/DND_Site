// ============================================================
// ASSET CONFIG — where image files are served from
// ============================================================
// The 5etools art pack is ~3.8 GB / 14k files. Committing it made .git
// 5.6 GB and pushed the site past GitHub Pages' 1 GB limit, so the images
// move to object storage (Cloudflare R2) and the repo keeps only code.
//
// `imgBase` replaces the local `img/` directory as the URL prefix:
//
//   ''                          -> 'img/bestiary/MM/Goblin.webp'   (local files, default)
//   'https://xxx.r2.dev'        -> 'https://xxx.r2.dev/bestiary/MM/Goblin.webp'
//
// So the BUCKET ROOT must mirror the CONTENTS of img/ (i.e. it contains
// adventure/, bestiary/, covers/, items/, … directly — not an img/ folder).
// Thumbnails live under a `thumbs/` prefix at the same base, mirroring the
// same tree: '<base>/thumbs/adventure/SKT/foo.webp'.
//
// Leave this empty to run entirely from local files (offline development,
// or before the upload is finished). Nothing else needs to change — every
// image URL in the app is built by assetUrl() / assetThumbUrl() in utils.js.
//
// NOTE: setting a cross-origin base requires (a) CORS on the bucket allowing
// GET from this site's origin, and (b) that origin being in the service
// worker's IMG_ORIGINS allow-list in sw.js — otherwise images bypass the
// offline cache. Both are documented at those call sites.
window.ASSET_CONFIG = {
  // Cloudflare R2 bucket `dnd-img` (15,980 objects: 14,278 images + 1,702
  // thumbnails, content-verified against the local tree).
  // If this ever changes, update IMG_ORIGINS in sw.js to match or images
  // silently stop being cached offline.
  // Set to '' to fall back to local img/ files (offline dev, or to revert).
  imgBase: 'https://pub-4b8864700c38402395c9f9951ed106ce.r2.dev',
};
