// ─────────────────────────────────────────────────────────────────────────────
//  THE ONLY FILE YOU EVER EDIT PER-DEPLOYMENT.
//
//  Crest Cards runs perfectly well with these placeholders in place: the whole
//  game against the standalone opponent, every replay, and hot-seat play are
//  local and need nothing from the network. What the placeholders switch OFF is
//  the shared-room half — Play a friend, and the spectator view.
//
//  To switch that on, paste the config from any app already pointed at the same
//  Firebase project (they live in each app's own sync/firebase-config.js), or
//  read it out of the console:
//    Project settings (gear) → General → scroll to "Your apps" → Config
//
//  Rooms are namespaced by the `game` name in js/sync-host.js, so sharing one
//  Firebase project with the other games cannot collide with them.
//
//  These values are PUBLIC BY DESIGN. Firebase expects them to ship in client
//  code, and committing them to a public repo is correct — they are an address,
//  not a secret. The protection is sync/firebase-rules.json, not their secrecy.
// ─────────────────────────────────────────────────────────────────────────────

export const firebaseConfig = {
  apiKey: "PASTE_ME",
  authDomain: "PASTE_ME.firebaseapp.com",
  databaseURL: "https://PASTE_ME-default-rtdb.firebaseio.com",
  projectId: "PASTE_ME",
  appId: "PASTE_ME",
};

// Sanity check so a forgotten paste fails loudly instead of silently not syncing.
if (firebaseConfig.apiKey === "PASTE_ME") {
  console.warn(
    "[crest-cards] sync/firebase-config.js still has placeholder values. " +
    "Shared rooms are disabled; solo, hot-seat and replays work as normal. " +
    "See the top of that file for the one paste that turns rooms on."
  );
}
