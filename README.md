# Story Outline Tool

A small, fully local web app for outlining a story's chapters and subplots.
It's plain HTML, CSS and JavaScript, with no build step and no server. The
only libraries are vendored in `vendor/`.

## Running it

Open `index.html` in a browser. Opening it straight from disk (`file://`) works.
You can also serve the folder with any static file server, for example
`python3 -m http.server`.

## Features

- **Story tabs.** Each tab at the top holds its own, completely separate story.
  Click **+** to add one. Double-click a tab (or press F2) to rename it.
- **Chronological outline.** The left column lists every chapter in story
  order. Chapter numbers come from each chapter's position, so they update
  whenever you reorder.
- **Subplots.** Each subplot is a column (A, B, C, …). A chapter can be in any
  number of subplots and stays in the outline too. Subplot cards are numbered
  within the subplot (`A1`, `A2`, …) and also show their outline chapter
  (`Ch. 7`). If a subplot's order disagrees with the outline, the chapter
  reference is highlighted. **Sort by outline order** in the subplot's `⋯` menu
  fixes it.
- **One chapter, many places.** A chapter is stored once. Renaming it or
  changing its state updates every card that shows it. Hover a card to
  highlight its other appearances.
- **Chapter state.** Idea, Outlined, Drafting, Drafted, Revising or Done. Each
  state has a color, shown on the card's edge and in its label.
- **Undo / redo** for every change (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z).
- **Themes:** Light, Dark, Summer Waves and Sketch, under Settings (gear icon).
  Until you pick one, the app follows your system's light/dark setting.

### Moving chapters

| Drag from → to | Result |
| --- | --- |
| Outline → outline | Reorders the outline |
| Outline → subplot | Adds the chapter to the subplot at that spot |
| Subplot → same subplot | Reorders the subplot |
| Subplot → another subplot | Moves it (hold Ctrl/⌘/Alt to copy instead) |
| Subplot → outline | Moves the chapter in the outline; the subplot doesn't change |

With a mouse you can drag a card from anywhere on it. On touch screens, drag it
by the grip (⋮⋮) on its left.

You can also use the keyboard. Focus a card and press **Enter** to edit it,
**Alt+↑/↓** to move it, or **Delete** to remove it from the subplot it's in.

Click a card to edit its name, state, summary and subplots. You can delete the
chapter from the same dialog.

## Storage

Everything is saved automatically to the browser's `localStorage`. The data
stays in the browser and profile you used, and clearing site data deletes it.
If you have the app open in more than one tab, they stay in sync.

| Key | Contents |
| --- | --- |
| `storyOutlineTool.db` | Your stories (shape described at the top of [`js/store.js`](js/store.js)) |
| `storyOutlineTool.settings` | Theme |
| `storyOutlineTool.sync` | Sync sign-in. For a sync key this includes the secret key itself |

## Data menu

- **Import / Export database:** Export downloads every story as a `.json` file.
  Import loads one of those files. It first warns that all local data will be
  destroyed and replaced. Imports can be undone right after. Exports never
  contain your sync key.
- **Sync:** see below.
- **Export as Markdown:** downloads the current story as a readable `.md` file
  for printing or a notes app. It can't be imported back.

## Sync

Sync is optional. It uses [Nostr](https://nostr.org/) relays as storage and
encrypts everything end to end with NIP-44, so relays only ever see ciphertext.
There's no server of our own.

- **Generate Sync Key:** makes a new Nostr secret key (`nsec1…`) and shows it
  once. Save it. It can't be recovered or reset.
- **Enter Sync Key:** paste an existing `nsec1…` to sync another device.
- **Sign in with Nostr:** use a NIP-07 browser extension (it must support
  NIP-44), or paste a NIP-46 `bunker://` address from a remote signer.

How it works ([`js/sync.js`](js/sync.js)):

- Each story is one NIP-78 application-data event (kind `30078`, `d` tag
  `story-outline-tool/tab/<id>`). Its content is gzipped, then encrypted to your
  own key.
- An index event (`story-outline-tool/index`) holds the story order and the
  list of deleted stories.
- Changes sync about 3 seconds after you stop editing, when the page regains
  focus, and every 90 seconds while it's visible.
- Merging works per story: the most recently edited version wins. A deletion
  wins over edits made before it.
- Default relays are `relay.damus.io`, `nos.lol`, `relay.primal.net` and
  `offchain.pub`. You can change them in the Sync popup once sync is on.

## Settings

- **Theme:** Light, Dark, Summer Waves, Sketch.
- **Delete data:** each option asks for confirmation first.
  - *Delete all data* erases the synced copy (if sync is on) and everything the
    app stores in this browser.
  - *Delete synced data* erases the synced copy from the relays and stops
    syncing on this device. Local stories are kept. Other devices that are
    still signed in will upload their copy again the next time they sync.
  - *Delete local data* clears this browser's storage but stays signed in to
    sync, then downloads your synced stories again.

## Project layout

```
index.html        page structure and popups
css/styles.css    styles and themes
js/settings.js    theme setting
js/store.js       data model, localStorage persistence, undo/redo
js/io.js          database import/export, Markdown export
js/sync.js        encrypted Nostr sync
js/drag.js        pointer-based drag and drop (mouse, pen, touch)
js/app.js         rendering and UI behaviour
vendor/           nostr-tools build and the Sketch theme's font (see vendor/README.md)
```

## License

GPL-3.0. See [LICENSE](LICENSE). Vendored nostr-tools is Unlicense (its
bundled `@noble`/`@scure` dependencies are MIT). The Patrick Hand font is SIL
OFL 1.1.
