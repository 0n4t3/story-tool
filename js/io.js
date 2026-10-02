/*
 * Story Outline Tool — database files and Markdown export.
 */
(function (global) {
  'use strict';

  var store = global.SOT.store;
  var APP_ID = 'story-outline-tool';
  var FILE_FORMAT = 1;

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function dateStamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function slug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'story';
  }

  /** Download every story as a JSON file that `readDatabaseFile` can load again. */
  function exportDatabase() {
    var payload = { app: APP_ID, format: FILE_FORMAT, exportedAt: new Date().toISOString(), data: store.getDb() };
    download('story-outline-' + dateStamp() + '.json', JSON.stringify(payload, null, 2), 'application/json');
  }

  /**
   * Read and validate a database file. Resolves to { data, tabCount, chapterCount }
   * or rejects with a user-readable Error.
   */
  function readDatabaseFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('The file could not be read.')); };
      reader.onload = function () {
        var parsed;
        try { parsed = JSON.parse(reader.result); } catch (err) {
          reject(new Error('That file isn’t a Story Outline Tool database (it isn’t valid JSON).'));
          return;
        }
        // Accept both the wrapped export format and a bare database object.
        var data = parsed && parsed.app === APP_ID ? parsed.data : parsed;
        if (!data || !Array.isArray(data.tabs)) {
          reject(new Error('That file isn’t a Story Outline Tool database.'));
          return;
        }
        var normalized = store.normalize(data);
        var chapters = normalized.tabs.reduce(function (n, t) { return n + t.order.length; }, 0);
        resolve({ data: data, tabCount: normalized.tabs.length, chapterCount: chapters });
      };
      reader.readAsText(file);
    });
  }

  // --- Markdown -------------------------------------------------------------

  /** Escape characters that would otherwise be read as Markdown formatting. */
  function md(text) {
    return String(text).replace(/([\\`*_[\]#<>|])/g, '\\$1');
  }

  function quote(text) {
    return String(text).split(/\r?\n/).map(function (line) { return '> ' + md(line); }).join('\n');
  }

  function tabToMarkdown(tab) {
    var labels = {};
    store.STATES.forEach(function (s) { labels[s.id] = s.label; });
    var out = ['# ' + md(tab.name), ''];

    out.push('## Chronological outline', '');
    if (!tab.order.length) out.push('_No chapters yet._', '');
    tab.order.forEach(function (id, i) {
      var ch = tab.chapters[id];
      var subplots = [];
      tab.subplots.forEach(function (sp, j) {
        if (sp.chapterIds.indexOf(id) >= 0) subplots.push(store.letterFor(j));
      });
      out.push('### ' + (i + 1) + '. ' + md(ch.name));
      out.push('');
      out.push('**State:** ' + labels[ch.state] + (subplots.length ? ' · **Subplots:** ' + subplots.join(', ') : ''));
      if (ch.summary) out.push('', quote(ch.summary));
      out.push('');
    });

    if (tab.subplots.length) {
      out.push('## Subplots', '');
      tab.subplots.forEach(function (sp, j) {
        var letter = store.letterFor(j);
        out.push('### ' + letter + ': ' + md(sp.name), '');
        if (!sp.chapterIds.length) out.push('_No chapters._');
        sp.chapterIds.forEach(function (id, k) {
          out.push((k + 1) + '. ' + md(tab.chapters[id].name) + ' (Chapter ' + (tab.order.indexOf(id) + 1) + ')');
        });
        out.push('');
      });
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /** Download the current story as a human-readable Markdown file. */
  function exportMarkdown() {
    var tab = store.activeTab();
    download(slug(tab.name) + '.md', tabToMarkdown(tab), 'text/markdown');
  }

  global.SOT = global.SOT || {};
  global.SOT.io = {
    exportDatabase: exportDatabase,
    readDatabaseFile: readDatabaseFile,
    exportMarkdown: exportMarkdown,
    tabToMarkdown: tabToMarkdown
  };
})(window);
