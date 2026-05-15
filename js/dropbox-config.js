// ============================================================
// DROPBOX CONFIG — shared, public, single account
// ============================================================
// Dropbox no longer issues long-lived access tokens via the UI Generate
// button (they all expire after 4 hours). To get a session that survives
// past 4 h, we use the OAuth refresh-token flow:
//
//   1. You authenticate *once* through dropbox-auth.html (a helper page
//      bundled in this repo) → it gives you a refresh token.
//   2. The refresh token is stored below — it has no expiry.
//   3. On every page load, the app trades that refresh token for a fresh
//      4-hour access token. No user interaction.
//
// The refresh token is publicly visible to anyone who loads the site.
// That is intentional — every player connects to the same Dropbox
// account with no per-user login. App-folder scope limits the blast
// radius to one isolated folder.
//
// To set up (one-time):
//   1. https://www.dropbox.com/developers/apps → your app → Settings.
//   2. Under OAuth 2 → Redirect URIs, add:
//        https://<your-github-pages-domain>/DND_Site/dropbox-auth.html
//      (or whichever URL hosts dropbox-auth.html). Click Add.
//   3. Permissions tab → tick files.metadata.read/write,
//      files.content.read/write → Submit.
//   4. Open dropbox-auth.html in your browser (e.g.
//      https://aaron367123.github.io/DND_Site/dropbox-auth.html).
//      Paste the App key (also from the Settings tab). Click Authorize.
//      Dropbox prompts you, returns to the page, displays the refresh
//      token. Copy.
//   5. Paste the App key and refresh token below, commit, push.
//
// To revoke at any time: in your Dropbox account at
// https://www.dropbox.com/account/connected_apps, find the app and
// disconnect it. The refresh token becomes invalid immediately.
window.DROPBOX_CONFIG = {
  appKey: 'ysu0fsl4fekzne0',
  refreshToken: '5QwLYJGhulsAAAAAAAAAAa2jU2MZ0WMoMwRlEzrpfnYJ1UWLz6IP1d3kBbpSxc2v',
  notesPath: '',
};
