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
- **Subplots.** Each subplot is a column with its own name and colour. A
  chapter can be in any number of subplots and stays in the outline too. Cards
  in the outline show the names of the subplots they belong to. Subplot cards
  are numbered within the subplot (1, 2, …) and also show their outline chapter
  (`Ch. 7`). If a subplot's order disagrees with the outline, the chapter
  reference is highlighted. **Sort by outline order** in the subplot's `⋯` menu
  fixes it.
- **One chapter, many places.** A chapter is stored once. Renaming it or
  changing its state updates every card that shows it. Hover a card to
  highlight its other appearances.
- **Chapter state.** Idea, Outlined, Drafting, Drafted, Revising or Done. Each
  state has a color, shown on the card's edge and in its label.
- **Short description.** About one sentence per chapter, shown on its card
  under the name. Longer **notes** go in the edit popup. A small note icon on
  the card shows that a chapter has notes, and hovering it previews them.
- **Columns, Cards or Matrix (wide screens).** The switch in the header picks
  the board layout:
  - *Columns* shows every subplot as a column.
  - *Cards* keeps one subplot as a column and collapses the others into a grid
    of cards that list their chapters. Click a card to make it the column.
    Drop a chapter on a card to add it to that subplot at its place in the
    outline. From another subplot, the drop moves it; hold Ctrl/⌘/Alt to copy.
  - *Matrix* shows only the chronological outline, as a snake of cards with
    arrows between them.
    - The first row reads left to right. A down arrow leads to the next row,
      which reads right to left, and so on.
    - How many cards fit in a row depends on the window width.
    - Cards show the same details as everywhere else.
    - Drag a card to reorder; a bar shows where it will land. Alt+↑/↓ works
      too.
  - The layout, and which subplot is the column in each story, are remembered
    in this browser.
- **Find a chapter.** The search box at the top of the chronological outline
  (and in the Matrix header) works as you type:
  - It scrolls to the closest-matching chapter name and highlights it. Other
    matches get a lighter highlight.
  - Ranking: an exact name first, then names that start with what you typed,
    then a word that starts with it, then names containing it, then all words
    present, then the letters in order (so "harbor" finds "harbour").
  - Type a number to jump to that chapter.
  - **Enter** and **Shift+Enter** step through matches, and **Esc** clears.
    Press **/** anywhere to jump to the box.
- **Undo / redo** for every change (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z).
- **Themes:** Light, Dark, Summer Waves and Sketch, under Settings (gear icon).
  Until you pick one, the app follows your system's light/dark setting.

- **Phones and small screens.** The board shows one column at a time. Swipe
  sideways to move between columns, or tap a column's name in the bar at the
  bottom.

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

**Moving several chapters at once** (all views):

- **Ctrl+click** (⌘+click on a Mac) cards to select them; click again to
  deselect. **Shift+click** selects a range. A bar at the bottom shows how many
  are selected.
- A selection belongs to one column: the outline or a single subplot.
  Ctrl+clicking in another column starts a new selection there.
- Drag any selected card to move the whole group. The chapters keep their
  relative order and land together where you drop them. Groups follow the same
  rules as single cards (see the table above), including dropping onto a
  subplot card in Cards view.
- With the keyboard: **Ctrl+Space** toggles the focused card, **Alt+↑/↓** moves
  the whole selection one step, and **Delete** removes the selection from a
  subplot.
- **Esc**, **Clear**, a plain click on a card, or clicking empty space clears
  the selection. Every group move is a single undo step.

You can also use the keyboard. Focus a card and press **Enter** to edit it,
**Alt+↑/↓** to move it, or **Delete** to remove it from the subplot it's in.

Click a card to edit its name, short description, state, notes and subplots. You can delete the
chapter from the same dialog.

## Storage

Everything is saved automatically to the browser's `localStorage`. The data
stays in the browser and profile you used, and clearing site data deletes it.
If you have the app open in more than one tab, they stay in sync.

| Key | Contents |
| --- | --- |
| `storyOutlineTool.db` | Your stories (shape described at the top of [`js/store.js`](js/store.js)) |
| `storyOutlineTool.settings` | Theme, board layout (Columns/Cards/Matrix), and which subplot is the column in Cards view |
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
encrypts story data end to end with NIP-44 before it leaves the browser.
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

### Security and privacy

- **Encrypted:** everything about your stories: names, chapters, summaries,
  states, subplots, story order and the list of deleted stories. Each event's
  content is NIP-44 (v2) encrypted to your own key: ChaCha20 with an HMAC-SHA256
  tag, keyed by ECDH of your key with itself. Only the holder of the secret key
  can decrypt it or produce something that decrypts. Events are signed, and the
  app only accepts events signed by your key.
- **Not hidden from relays (metadata):** your public key, when you sync, that
  you use this app (the `d` tags start with `story-outline-tool/`), how many
  stories you have (each has a random id), and roughly how large each one is.
- **Who else can read your data:**
  - Anyone with your sync key.
  - A browser extension or bunker you sign in with. They do the encryption, so
    they see the plaintext.
  - Anyone who can run code in this browser profile. For a generated or entered
    sync key, the secret key is stored in `localStorage` (see Storage).
- **Rollback:** a relay can't forge or alter your data, but it could withhold
  newer versions. Using several relays makes that harder.
- **Hardening:**
  - A Content-Security-Policy allows only the app's own scripts, with no
    inline or remote code.
  - The app never renders data as HTML.
  - Imported and synced data is validated: ids, colours and shapes.
  - Bunker approval links are opened only if they are `https:`.
  - Relays must use `wss://`, except on `localhost`.
  - Secret keys are cleared from the Sync popup when it closes.
  - Exports never include keys.

## Settings

- **Theme:** Light, Dark, Summer Waves, Sketch. Summer Waves is a copy of the
  "Summer Waves" Ditto theme: its colours, font and photo
  (`assets/summer-waves.jpg`).
- **Delete data:** each option asks for confirmation first.
  - *Delete all data* erases the synced copy (if sync is on) and everything the
    app stores in this browser.
  - *Delete synced data* erases the synced copy from the relays and stops
    syncing on this device. Local stories are kept. Other devices that are
    still signed in will upload their copy again the next time they sync.
  - *Delete local data* clears this browser's storage but stays signed in to
    sync, then downloads your synced stories again.
- **Source:** links to this repository.

## Project layout

```
index.html        page structure and popups
css/styles.css    styles and themes
js/theme-init.js  applies the saved theme before first paint
js/settings.js    theme and layout settings
js/store.js       data model, localStorage persistence, undo/redo
js/io.js          database import/export, Markdown export
js/sync.js        encrypted Nostr sync
js/drag.js        pointer-based drag and drop (mouse, pen, touch)
js/app.js         rendering and UI behaviour
assets/           Summer Waves background photo
vendor/           nostr-tools build and theme fonts (see vendor/README.md)
```

## License

GPL-3.0. See [LICENSE](LICENSE). Vendored nostr-tools is Unlicense (its
bundled `@noble`/`@scure` dependencies are MIT). The Patrick Hand and Sorts
Mill Goudy fonts are SIL OFL 1.1.
