# Story Outline Tool

A small, fully local web app for outlining a story's chapters and subplots.
It's plain HTML, CSS and JavaScript: no build step, no server, no dependencies.

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

Everything is saved automatically to the browser's `localStorage` under the key
`storyOutlineTool.db`. The data stays in the browser and profile you used.
Clearing site data deletes it. If you have the app open in more than one tab,
they stay in sync.

The data model is described at the top of [`js/store.js`](js/store.js).

## Planned (not yet implemented)

These appear in the **Data** menu as "Soon". Stubs that describe the intended
behaviour are in [`js/io.js`](js/io.js).

- Download the database as a file, and upload it again to restore.
- Export a human-readable Markdown outline for notes apps or printing.
- Back up and sync using end-to-end encrypted, app-specific data on Nostr
  relays.

## Project layout

```
index.html        page structure and dialogs
css/styles.css    styles (light and dark themes)
js/store.js       data model, localStorage persistence, undo/redo
js/drag.js        pointer-based drag and drop (mouse, pen, touch)
js/app.js         rendering and UI behaviour
js/io.js          placeholders for import/export and Nostr sync
```

## License

GPL-3.0. See [LICENSE](LICENSE).
