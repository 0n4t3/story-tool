# Vendored libraries

## nostr-tools.min.js

A browser build of [nostr-tools](https://github.com/nbd-wtf/nostr-tools)
2.25.2 (Unlicense), plus the `@noble` / `@scure` crypto libraries it depends on
(MIT). The app uses it for Nostr keys, NIP-44 encryption, relay connections and
NIP-46 remote signers. It's committed to the repo so the app keeps working
offline from `file://` with no build step.

The file only includes what [`nostr-tools.entry.js`](nostr-tools.entry.js)
exports, and exposes it as `window.NostrTools`. To rebuild it:

```sh
npm i nostr-tools@2.25.2 esbuild
npx esbuild vendor/nostr-tools.entry.js --bundle --minify --format=iife \
  --global-name=NostrTools --target=es2019 --legal-comments=eof \
  --outfile=vendor/nostr-tools.min.js
```

Then put the header comment from the current file back at the top.

## fonts/patrick-hand.woff2

[Patrick Hand](https://fonts.google.com/specimen/Patrick+Hand) by Patrick
Wagesreiter, Latin subset, from `@fontsource/patrick-hand`. Licensed under the
SIL Open Font License 1.1 ([`fonts/patrick-hand-OFL.txt`](fonts/patrick-hand-OFL.txt)).
The Sketch theme uses it.

## fonts/sorts-mill-goudy*.woff2

[Sorts Mill Goudy](https://github.com/theleagueof/sorts-mill-goudy) by Barry
Schwartz, regular and italic, Latin subset, from `@fontsource/sorts-mill-goudy`.
It's the font that Ditto's "Summer Waves" theme calls "GoudyStM webfont".
Licensed under the SIL Open Font License 1.1
([`fonts/sorts-mill-goudy-OFL.txt`](fonts/sorts-mill-goudy-OFL.txt)). The
Summer Waves theme uses it.
