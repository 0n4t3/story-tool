/*
 * Story Outline Tool — import / export / sync.
 *
 * PLACEHOLDERS ONLY. These features are planned but not implemented yet; the
 * UI lists them as "coming soon". Each entry documents the intended behaviour
 * so a future implementation has a clear target.
 */
(function (global) {
  'use strict';

  function notImplemented(feature) {
    return function () {
      throw new Error(feature + ' is not implemented yet.');
    };
  }

  global.SOT = global.SOT || {};
  global.SOT.io = {
    features: [
      {
        id: 'download-db',
        label: 'Download database',
        description: 'Save every story as a .json file you can re-upload later.'
      },
      {
        id: 'upload-db',
        label: 'Upload database',
        description: 'Restore stories from a previously downloaded .json file.'
      },
      {
        id: 'export-markdown',
        label: 'Export as Markdown',
        description: 'A human-readable outline for notes apps or printing.'
      },
      {
        id: 'nostr-sync',
        label: 'Back up & sync via Nostr',
        description: 'End-to-end encrypted, app-specific data on Nostr relays.'
      }
    ],

    /**
     * Download the full database (`SOT.store.getDb()`) as JSON, e.g.
     * `story-outline-YYYY-MM-DD.json`, wrapped as
     * `{ app: "story-outline-tool", exportedAt, data }`.
     */
    downloadDatabase: notImplemented('Downloading the database'),

    /**
     * Read a file produced by `downloadDatabase`, validate it with
     * `SOT.store.normalize()` and load it via `SOT.store.replaceDatabase()`
     * (which keeps it undoable). Should offer replace vs. merge-as-new-tabs.
     */
    uploadDatabase: notImplemented('Uploading a database'),

    /**
     * Render one tab (or all tabs) as Markdown: a heading per story, the
     * chronological outline as a numbered list with state and summary, then
     * one section per subplot listing its chapters with their outline numbers.
     */
    exportMarkdown: notImplemented('Markdown export'),

    /**
     * Back up and sync via Nostr: serialize the database, encrypt it to the
     * user's own key (NIP-44), and publish it as an application-specific data
     * event (NIP-78, kind 30078, `d` tag "story-outline-tool") to the user's
     * relays. Sync pulls the newest event, decrypts it and merges by
     * `updatedAt`.
     */
    nostr: {
      connect: notImplemented('Nostr sync'),
      backup: notImplemented('Nostr backup'),
      restore: notImplemented('Nostr restore')
    }
  };
})(window);
