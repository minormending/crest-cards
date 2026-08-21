// ─────────────────────────────────────────────────────────────────────────────
//  THE ONLY FILE YOU EVER EDIT PER-DEPLOYMENT.
//
//  Copied from the `kids-games-sync` project, which the other games in this
//  suite already point at. That is the documented way to add a game rather than
//  a shortcut: kidsync namespaces every room by the `game` name in
//  js/sync-host.js ('crest-cards'), so one Firebase project serves any number
//  of games and a code here can never collide with a code over there.
//
//  These values are PUBLIC BY DESIGN. Firebase expects them to ship in client
//  code, and committing them to a public repo is correct — they are an address,
//  not a secret. The protection is sync/firebase-rules.json plus the room code
//  itself, never the secrecy of these strings.
//
//  What this file switches on is only the shared half: Play a friend, Join with
//  a code, and the spectator view. Solo play against the standalone opponent and
//  every replay are local and work with this file broken, missing, or full of
//  placeholders.
// ─────────────────────────────────────────────────────────────────────────────

export const firebaseConfig = {
  apiKey: "AIzaSyBdBfTvwhULgnS8-JCO6cmfPxmSlmhdZ9A",
  authDomain: "kids-games-sync.firebaseapp.com",
  databaseURL: "https://kids-games-sync-default-rtdb.firebaseio.com",
  projectId: "kids-games-sync",
  storageBucket: "kids-games-sync.firebasestorage.app",
  messagingSenderId: "740391976396",
  appId: "1:740391976396:web:02f8e31c9161c4a6a23169"
};

// Sanity check so a forgotten paste fails loudly instead of silently not syncing.
if (firebaseConfig.apiKey === "PASTE_ME") {
  console.warn(
    "[crest-cards] sync/firebase-config.js still has placeholder values. " +
    "Shared rooms are disabled; solo play and replays work as normal. " +
    "See the top of this file."
  );
}
