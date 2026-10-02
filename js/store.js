/*
 * Story Outline Tool — data store.
 *
 * Holds the whole database in memory, persists it to localStorage, and keeps
 * an undo/redo history. Every change goes through `commit()` so that saving,
 * history and re-rendering happen in one place.
 *
 * Database shape (schemaVersion 1):
 *
 *   {
 *     schemaVersion: 1,
 *     activeTabId: "<tab id>",
 *     tabOrderUpdatedAt: "<ISO time>",          // last time tabs were added/removed/reordered
 *     deletedTabs: { "<tab id>": "<ISO time>" }, // tombstones, so sync can propagate deletions
 *     tabs: [{
 *       id, name, createdAt, updatedAt,
 *       chapters: { "<chapter id>": { id, name, state, description, summary, createdAt, updatedAt } },
 *                   // description: one sentence shown on the card; summary: longer notes
 *       order:    ["<chapter id>", ...],            // chronological outline
 *       subplots: [{ id, name, color, chapterIds: ["<chapter id>", ...] }]
 *     }]
 *   }
 *
 * A chapter exists once per tab (in `chapters`) and is referenced by id from
 * the chronological `order` and from any number of subplots, so editing it in
 * one place updates it everywhere. Chapter numbers are never stored: they are
 * derived from positions in `order` / `chapterIds`.
 *
 * Each tab's `updatedAt` changes on every edit inside it. Sync (js/sync.js)
 * merges whole tabs by comparing these timestamps.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'storyOutlineTool.db';
  var SCHEMA_VERSION = 1;
  var HISTORY_LIMIT = 100;

  var STATES = [
    { id: 'idea', label: 'Idea' },
    { id: 'outlined', label: 'Outlined' },
    { id: 'drafting', label: 'Drafting' },
    { id: 'drafted', label: 'Drafted' },
    { id: 'revising', label: 'Revising' },
    { id: 'done', label: 'Done' }
  ];
  var STATE_IDS = STATES.map(function (s) { return s.id; });

  var SUBPLOT_COLORS = ['#e4572e', '#2e86ab', '#2f9e44', '#a05ec4', '#e8a33d', '#17a398', '#d1495b', '#5c6bc0'];

  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function now() { return new Date().toISOString(); }

  /** 0 -> "A", 25 -> "Z", 26 -> "AA" */
  function letterFor(index) {
    var s = '';
    var n = index + 1;
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  // Ids come from this app (UUIDs), but imported files and synced data are
  // validated too: ids end up in CSS selectors and object keys.
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  function isId(id) { return typeof id === 'string' && ID_RE.test(id) && id !== '__proto__'; }
  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isoOr(value, fallback) { return typeof value === 'string' && value ? value : fallback; }

  var DESCRIPTION_MAX = 300;

  /** A one-line description: single spaces, no line breaks, capped in length. */
  function cleanDescription(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX);
  }

  function cleanName(name, fallback) {
    var s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    return s || fallback;
  }

  function createTab(name) {
    var t = now();
    return { id: uid(), name: cleanName(name, 'Untitled story'), createdAt: t, updatedAt: t, chapters: {}, order: [], subplots: [] };
  }

  function createDatabase() {
    var tab = createTab('My Story');
    return { schemaVersion: SCHEMA_VERSION, activeTabId: tab.id, tabOrderUpdatedAt: now(), deletedTabs: {}, tabs: [tab] };
  }

  /**
   * Validate and repair a database object. Drops dangling references and
   * duplicates so that the rest of the app can trust the shape. Intended to
   * also be the entry point for imported databases.
   */
  function normalize(db) {
    if (!db || typeof db !== 'object' || !Array.isArray(db.tabs)) return createDatabase();
    var out = {
      schemaVersion: SCHEMA_VERSION,
      activeTabId: db.activeTabId,
      tabOrderUpdatedAt: isoOr(db.tabOrderUpdatedAt, now()),
      deletedTabs: {},
      tabs: []
    };
    if (db.deletedTabs && typeof db.deletedTabs === 'object') {
      Object.keys(db.deletedTabs).forEach(function (id) {
        if (isId(id) && typeof db.deletedTabs[id] === 'string') out.deletedTabs[id] = db.deletedTabs[id];
      });
    }
    var seenTabs = Object.create(null);
    db.tabs.forEach(function (rawTab) {
      if (!rawTab || typeof rawTab !== 'object') return;
      var tab = createTab(rawTab.name);
      if (isId(rawTab.id) && !seenTabs[rawTab.id]) tab.id = rawTab.id;
      seenTabs[tab.id] = true;
      tab.createdAt = isoOr(rawTab.createdAt, tab.createdAt);
      tab.updatedAt = isoOr(rawTab.updatedAt, tab.updatedAt);

      var rawChapters = rawTab.chapters && typeof rawTab.chapters === 'object' ? rawTab.chapters : {};
      Object.keys(rawChapters).forEach(function (key) {
        var c = rawChapters[key];
        if (!isId(key) || !c || typeof c !== 'object') return;
        tab.chapters[key] = {
          id: key,
          name: cleanName(c.name, 'Untitled chapter'),
          state: STATE_IDS.indexOf(c.state) >= 0 ? c.state : STATE_IDS[0],
          description: cleanDescription(c.description),
          summary: typeof c.summary === 'string' ? c.summary : '',
          createdAt: isoOr(c.createdAt, now()),
          updatedAt: isoOr(c.updatedAt, now())
        };
      });

      var seen = Object.create(null);
      (Array.isArray(rawTab.order) ? rawTab.order : []).forEach(function (id) {
        if (typeof id === 'string' && has(tab.chapters, id) && !seen[id]) { seen[id] = true; tab.order.push(id); }
      });
      // Chapters missing from the outline are appended rather than lost.
      Object.keys(tab.chapters).forEach(function (id) { if (!seen[id]) tab.order.push(id); });

      var seenSubplots = Object.create(null);
      (Array.isArray(rawTab.subplots) ? rawTab.subplots : []).forEach(function (sp, i) {
        if (!sp || typeof sp !== 'object') return;
        var spSeen = Object.create(null);
        var spId = isId(sp.id) && !seenSubplots[sp.id] ? sp.id : uid();
        seenSubplots[spId] = true;
        tab.subplots.push({
          id: spId,
          name: cleanName(sp.name, 'Subplot ' + letterFor(i)),
          color: /^#[0-9a-f]{6}$/i.test(sp.color) ? sp.color : SUBPLOT_COLORS[i % SUBPLOT_COLORS.length],
          chapterIds: (Array.isArray(sp.chapterIds) ? sp.chapterIds : []).filter(function (id) {
            if (typeof id !== 'string' || !has(tab.chapters, id) || spSeen[id]) return false;
            spSeen[id] = true;
            return true;
          })
        });
      });

      out.tabs.push(tab);
    });
    if (!out.tabs.length) {
      var fresh = createDatabase();
      fresh.deletedTabs = out.deletedTabs;
      return fresh;
    }
    out.tabs.forEach(function (t) { delete out.deletedTabs[t.id]; });
    if (!seenTabs[out.activeTabId]) out.activeTabId = out.tabs[0].id;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Store

  var db = null;
  var undoStack = [];
  var redoStack = [];
  var listeners = [];
  var lastSaveError = null;

  function emit(meta) {
    listeners.forEach(function (fn) { fn(meta || {}); });
  }

  function persist() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      lastSaveError = null;
    } catch (err) {
      lastSaveError = err;
    }
  }

  function load() {
    var raw = null;
    try { raw = global.localStorage.getItem(STORAGE_KEY); } catch (err) { lastSaveError = err; }
    var parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); } catch (err) { parsed = null; }
    }
    db = normalize(parsed);
    if (!raw) persist();
  }

  /**
   * Apply `mutator` to the database. If anything changed, record an undo step
   * (unless options.history === false), save, and notify listeners.
   */
  function commit(mutator, options) {
    options = options || {};
    var before = JSON.stringify(db);
    var result = mutator(db);
    var after = JSON.stringify(db);
    if (before === after) return result;
    if (options.history !== false) {
      undoStack.push(before);
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      redoStack = [];
    }
    persist();
    emit({ label: options.label, navigation: !!options.navigation });
    return result;
  }

  function restore(fromStack, toStack) {
    if (!fromStack.length) return false;
    toStack.push(JSON.stringify(db));
    var prev = db;
    db = normalize(JSON.parse(fromStack.pop()));
    markRestored(prev, db);
    persist();
    emit({ history: true });
    return true;
  }

  /**
   * Undo/redo bring back older snapshots, including their old timestamps.
   * Re-stamp whatever the restore changed so sync treats it as a new edit
   * instead of letting the (newer) synced copy win.
   */
  function markRestored(prev, next) {
    var t = now();
    var prevTabs = Object.create(null);
    prev.tabs.forEach(function (tab) { prevTabs[tab.id] = tab; });
    next.tabs.forEach(function (tab) {
      var before = prevTabs[tab.id];
      if (!before || JSON.stringify(before) !== JSON.stringify(tab)) tab.updatedAt = t;
      delete next.deletedTabs[tab.id];
    });
    var nextIds = next.tabs.map(function (tab) { return tab.id; });
    prev.tabs.forEach(function (tab) {
      if (nextIds.indexOf(tab.id) < 0) next.deletedTabs[tab.id] = t;
    });
    var prevIds = prev.tabs.map(function (tab) { return tab.id; });
    if (prevIds.join() !== nextIds.join()) next.tabOrderUpdatedAt = t;
  }

  function tabById(d, id) {
    for (var i = 0; i < d.tabs.length; i++) if (d.tabs[i].id === id) return d.tabs[i];
    return null;
  }

  function subplotById(tab, id) {
    for (var i = 0; i < tab.subplots.length; i++) if (tab.subplots[i].id === id) return tab.subplots[i];
    return null;
  }

  function touch(tab) { tab.updatedAt = now(); }

  function moveInArray(arr, item, toIndex) {
    var from = arr.indexOf(item);
    if (from >= 0) arr.splice(from, 1);
    arr.splice(clamp(toIndex, 0, arr.length), 0, item);
  }

  /** Index at which `chapterId` should go in a subplot to respect chronological order. */
  function chronologicalSlot(tab, sp, chapterId) {
    var pos = tab.order.indexOf(chapterId);
    for (var i = 0; i < sp.chapterIds.length; i++) {
      if (tab.order.indexOf(sp.chapterIds[i]) > pos) return i;
    }
    return sp.chapterIds.length;
  }

  function applySubplots(tab, chapterId, spIds) {
    tab.subplots.forEach(function (sp) {
      var want = spIds.indexOf(sp.id) >= 0;
      var has = sp.chapterIds.indexOf(chapterId) >= 0;
      if (want && !has) sp.chapterIds.splice(chronologicalSlot(tab, sp, chapterId), 0, chapterId);
      if (!want && has) sp.chapterIds = sp.chapterIds.filter(function (id) { return id !== chapterId; });
    });
  }

  // Wrap a tab-scoped mutation so it is a no-op if the tab has disappeared.
  function onTab(tabId, fn, options) {
    return commit(function (d) {
      var tab = tabById(d, tabId);
      if (!tab) return undefined;
      var result = fn(tab, d);
      touch(tab);
      return result;
    }, options);
  }

  var Store = {
    STORAGE_KEY: STORAGE_KEY,
    STATES: STATES,
    DESCRIPTION_MAX: DESCRIPTION_MAX,
    SUBPLOT_COLORS: SUBPLOT_COLORS,
    letterFor: letterFor,
    normalize: normalize,

    init: function () {
      load();
      // Keep several open browser tabs of the app in sync.
      global.addEventListener('storage', function (e) {
        if (e.key !== STORAGE_KEY && e.key !== null) return;
        // Another tab changed the data: undo history here no longer matches it.
        undoStack = [];
        redoStack = [];
        if (e.key === null || !e.newValue) {
          // Data was deleted in another tab: don't keep (and later re-save) the old copy.
          db = createDatabase();
          persist();
          emit({ reset: true });
          return;
        }
        try {
          db = normalize(JSON.parse(e.newValue));
          emit({ external: true });
        } catch (err) { /* ignore malformed writes */ }
      });
    },

    subscribe: function (fn) { listeners.push(fn); },
    getDb: function () { return db; },
    saveError: function () { return lastSaveError; },

    activeTab: function () { return tabById(db, db.activeTabId) || db.tabs[0]; },
    getTab: function (id) { return tabById(db, id); },
    getSubplot: function (tabId, spId) {
      var tab = tabById(db, tabId);
      return tab ? subplotById(tab, spId) : null;
    },

    canUndo: function () { return undoStack.length > 0; },
    canRedo: function () { return redoStack.length > 0; },
    undo: function () { return restore(undoStack, redoStack); },
    redo: function () { return restore(redoStack, undoStack); },

    // --- tabs ---------------------------------------------------------------

    addTab: function (name) {
      return commit(function (d) {
        var tab = createTab(name || 'Story ' + (d.tabs.length + 1));
        d.tabs.push(tab);
        d.activeTabId = tab.id;
        d.tabOrderUpdatedAt = now();
        return tab.id;
      });
    },

    renameTab: function (tabId, name) {
      onTab(tabId, function (tab) { tab.name = cleanName(name, tab.name); });
    },

    deleteTab: function (tabId) {
      commit(function (d) {
        var i = d.tabs.findIndex(function (t) { return t.id === tabId; });
        if (i < 0) return;
        d.tabs.splice(i, 1);
        d.deletedTabs[tabId] = now();
        d.tabOrderUpdatedAt = now();
        if (!d.tabs.length) d.tabs.push(createTab('My Story'));
        if (d.activeTabId === tabId) d.activeTabId = d.tabs[Math.min(i, d.tabs.length - 1)].id;
      });
    },

    moveTab: function (tabId, toIndex) {
      commit(function (d) {
        var tab = tabById(d, tabId);
        if (!tab) return;
        moveInArray(d.tabs, tab, toIndex);
        d.tabOrderUpdatedAt = now();
      });
    },

    setActiveTab: function (tabId) {
      commit(function (d) { if (tabById(d, tabId)) d.activeTabId = tabId; }, { history: false, navigation: true });
    },

    // --- chapters -----------------------------------------------------------

    /** Create a chapter. options.index places it in the outline; options.subplotId also adds it to a subplot. */
    addChapter: function (tabId, fields, options) {
      options = options || {};
      return onTab(tabId, function (tab) {
        var t = now();
        var ch = {
          id: uid(),
          name: cleanName(fields && fields.name, 'Untitled chapter'),
          state: fields && STATE_IDS.indexOf(fields.state) >= 0 ? fields.state : STATE_IDS[0],
          description: cleanDescription(fields && fields.description),
          summary: (fields && fields.summary) || '',
          createdAt: t,
          updatedAt: t
        };
        tab.chapters[ch.id] = ch;
        var index = options.index == null ? tab.order.length : options.index;
        tab.order.splice(clamp(index, 0, tab.order.length), 0, ch.id);
        var sp = options.subplotId && subplotById(tab, options.subplotId);
        if (sp) sp.chapterIds.push(ch.id);
        return ch.id;
      });
    },

    /** Update name/state/description/summary, and optionally subplot membership via patch.subplotIds. */
    updateChapter: function (tabId, chapterId, patch) {
      onTab(tabId, function (tab) {
        var ch = tab.chapters[chapterId];
        if (!ch) return;
        if ('name' in patch) ch.name = cleanName(patch.name, ch.name);
        if ('state' in patch && STATE_IDS.indexOf(patch.state) >= 0) ch.state = patch.state;
        if ('description' in patch) ch.description = cleanDescription(patch.description);
        if ('summary' in patch) ch.summary = String(patch.summary || '');
        if (Array.isArray(patch.subplotIds)) applySubplots(tab, chapterId, patch.subplotIds);
        ch.updatedAt = now();
      });
    },

    deleteChapter: function (tabId, chapterId) {
      onTab(tabId, function (tab) {
        delete tab.chapters[chapterId];
        tab.order = tab.order.filter(function (id) { return id !== chapterId; });
        tab.subplots.forEach(function (sp) {
          sp.chapterIds = sp.chapterIds.filter(function (id) { return id !== chapterId; });
        });
      });
    },

    /** Move a chapter within the chronological outline. `toIndex` is its final position. */
    moveChapter: function (tabId, chapterId, toIndex) {
      onTab(tabId, function (tab) {
        if (tab.chapters[chapterId]) moveInArray(tab.order, chapterId, toIndex);
      });
    },

    // --- subplots -----------------------------------------------------------

    addSubplot: function (tabId, name) {
      return onTab(tabId, function (tab) {
        var n = tab.subplots.length;
        var used = tab.subplots.map(function (s) { return s.color; });
        var color = SUBPLOT_COLORS.filter(function (c) { return used.indexOf(c) < 0; })[0] ||
          SUBPLOT_COLORS[n % SUBPLOT_COLORS.length];
        var sp = { id: uid(), name: cleanName(name, 'Subplot ' + letterFor(n)), color: color, chapterIds: [] };
        tab.subplots.push(sp);
        return sp.id;
      });
    },

    updateSubplot: function (tabId, spId, patch) {
      onTab(tabId, function (tab) {
        var sp = subplotById(tab, spId);
        if (!sp) return;
        if ('name' in patch) sp.name = cleanName(patch.name, sp.name);
        if ('color' in patch && /^#[0-9a-f]{6}$/i.test(patch.color)) sp.color = patch.color;
      });
    },

    deleteSubplot: function (tabId, spId) {
      onTab(tabId, function (tab) {
        tab.subplots = tab.subplots.filter(function (s) { return s.id !== spId; });
      });
    },

    moveSubplot: function (tabId, spId, toIndex) {
      onTab(tabId, function (tab) {
        var sp = subplotById(tab, spId);
        if (sp) moveInArray(tab.subplots, sp, toIndex);
      });
    },

    /**
     * Put a chapter at `toIndex` in a subplot (reordering it if it is already
     * there). If `fromSubplotId` names a different subplot, the chapter is
     * removed from that one, i.e. it is moved rather than copied.
     */
    placeInSubplot: function (tabId, spId, chapterId, toIndex, fromSubplotId) {
      onTab(tabId, function (tab) {
        var sp = subplotById(tab, spId);
        if (!sp || !tab.chapters[chapterId]) return;
        moveInArray(sp.chapterIds, chapterId, toIndex);
        if (fromSubplotId && fromSubplotId !== spId) {
          var from = subplotById(tab, fromSubplotId);
          if (from) from.chapterIds = from.chapterIds.filter(function (id) { return id !== chapterId; });
        }
      });
    },

    /**
     * Add a chapter to a subplot at its chronological position. If
     * `fromSubplotId` names another subplot, the chapter moves from there.
     */
    addToSubplot: function (tabId, spId, chapterId, fromSubplotId) {
      onTab(tabId, function (tab) {
        var sp = subplotById(tab, spId);
        if (!sp || !tab.chapters[chapterId]) return;
        if (sp.chapterIds.indexOf(chapterId) < 0) {
          sp.chapterIds.splice(chronologicalSlot(tab, sp, chapterId), 0, chapterId);
        }
        var from = fromSubplotId && fromSubplotId !== spId && subplotById(tab, fromSubplotId);
        if (from) from.chapterIds = from.chapterIds.filter(function (id) { return id !== chapterId; });
      });
    },

    removeFromSubplot: function (tabId, spId, chapterId) {
      onTab(tabId, function (tab) {
        var sp = subplotById(tab, spId);
        if (sp) sp.chapterIds = sp.chapterIds.filter(function (id) { return id !== chapterId; });
      });
    },

    /** Make a chapter's subplot membership match `spIds` exactly (as one undo step). */
    setChapterSubplots: function (tabId, chapterId, spIds) {
      onTab(tabId, function (tab) {
        if (tab.chapters[chapterId]) applySubplots(tab, chapterId, spIds);
      });
    },

    /** Reorder a subplot to match the chronological outline. */
    sortSubplot: function (tabId, spId) {
      onTab(tabId, function (tab) {
        var sp = subplotById(tab, spId);
        if (!sp) return;
        sp.chapterIds.sort(function (a, b) { return tab.order.indexOf(a) - tab.order.indexOf(b); });
      });
    },

    /**
     * Replace all local data with an imported database (undoable). Imported
     * tabs are stamped as just edited and the tabs they replace are marked
     * deleted, so that if sync is on, the imported data wins.
     */
    importDatabase: function (raw) {
      commit(function (d) {
        var next = normalize(raw);
        var t = now();
        next.tabs.forEach(function (tab) { tab.updatedAt = t; delete d.deletedTabs[tab.id]; });
        var keep = next.tabs.map(function (tab) { return tab.id; });
        Object.keys(d.deletedTabs).forEach(function (id) {
          if (!next.deletedTabs[id] && keep.indexOf(id) < 0) next.deletedTabs[id] = d.deletedTabs[id];
        });
        d.tabs.forEach(function (tab) { if (keep.indexOf(tab.id) < 0) next.deletedTabs[tab.id] = t; });
        next.tabOrderUpdatedAt = t;
        replaceContents(d, next);
      });
    },

    /**
     * Apply a database produced by sync. Not undoable: older undo snapshots
     * would no longer line up with the merged data, so history is cleared.
     */
    applySynced: function (raw, keepActiveTab) {
      var next = normalize(raw);
      if (keepActiveTab && tabById(next, db.activeTabId)) next.activeTabId = db.activeTabId;
      if (JSON.stringify(next) === JSON.stringify(db)) return false;
      db = next;
      undoStack = [];
      redoStack = [];
      persist();
      emit({ synced: true });
      return true;
    },

    /** Start over with an empty database, or with `raw` if given (not undoable). */
    resetDatabase: function (raw) {
      db = raw ? normalize(raw) : createDatabase();
      undoStack = [];
      redoStack = [];
      persist();
      emit({ reset: true });
    }
  };

  function replaceContents(target, source) {
    Object.keys(target).forEach(function (k) { delete target[k]; });
    Object.keys(source).forEach(function (k) { target[k] = source[k]; });
  }

  global.SOT = global.SOT || {};
  global.SOT.store = Store;
})(window);
