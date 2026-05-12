// ============================================================
// DROPBOX CONFIG — shared, public, single account
// ============================================================
// Anyone who loads the site can read this file and use the token.
// That is intentional — every player connects to the same Dropbox
// account with no per-user login. App-folder scope limits the blast
// radius to one isolated folder in the chosen Dropbox account.
//
// To enable:
//   1. Go to https://www.dropbox.com/developers/apps and create a
//      Scoped-access / App-folder app.
//   2. Settings tab: set "Access token expiration" to "No expiration".
//   3. Permissions tab: tick files.content.read/write,
//      files.metadata.read/write. Submit.
//   4. Settings tab → Generated access token → click Generate. Copy.
//   5. Paste below, commit, push. Done.
//
// To revoke at any time: same Settings page → click Disable on the
// generated token. The site will immediately fail to read/write.
window.DROPBOX_CONFIG = {
  // Long-lived access token. Replace the placeholder below.
  accessToken: 'PASTE_YOUR_TOKEN_HERE',

  // Optional subfolder inside the App folder where notes live. Leave
  // empty for the root of the App folder. Must start with '/' if set.
  // Example: '/sessions'
  notesPath: '',
};
