/*
 * Story Outline Tool — user interface.
 *
 * Renders the tabs and the board from the store, and turns user actions into
 * store calls. The whole board is re-rendered after each change; outlines are
 * small, so this keeps the UI simple and always consistent with the data.
 */
(function (global) {
  'use strict';

  var store = global.SOT.store;
  var io = global.SOT.io;
  var sync = global.SOT.sync;
  var settings = global.SOT.settings;

  var $ = function (id) { return document.getElementById(id); };
  var board = $('board');
  var tabList = $('tab-list');

  var STATE_LABELS = {};
  store.STATES.forEach(function (s) { STATE_LABELS[s.id] = s.label; });

  // ---------------------------------------------------------------------------
  // Helpers

  /** Tiny element builder: h('div', { class: 'x', onclick: fn }, [children]) */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function icon(path) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = path;
    return svg;
  }

  var ICONS = {
    search: '<circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4.5 4.5"/>',
    notes: '<path d="M5 3h7l3 3v11H5z"/><path d="M8 9h4M8 12h4"/>',
    close: '<path d="m5 5 10 10M15 5 5 15"/>',
    more: '<circle cx="4.5" cy="10" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="15.5" cy="10" r="1.3"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    grip: '<circle cx="7.5" cy="5" r="1.2"/><circle cx="12.5" cy="5" r="1.2"/><circle cx="7.5" cy="10" r="1.2"/><circle cx="12.5" cy="10" r="1.2"/><circle cx="7.5" cy="15" r="1.2"/><circle cx="12.5" cy="15" r="1.2"/>'
  };

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function isTyping(el) {
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  function announce(text) {
    var live = $('live');
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }

  var toastTimer = 0;
  function toast(text, action) {
    var el = $('toast');
    var btn = $('toast-action');
    $('toast-text').textContent = text;
    btn.hidden = !action;
    btn.onclick = null;
    if (action) {
      btn.textContent = action.label;
      btn.onclick = function () { el.hidden = true; action.run(); };
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, action ? 6000 : 3000);
  }

  function undoToast(text) {
    toast(text, { label: 'Undo', run: function () { store.undo(); } });
  }

  /** Replace `target` with a text input; calls onCommit(newValue) on Enter/blur. */
  function inlineEdit(target, value, onCommit) {
    var input = h('input', { type: 'text', class: 'inline-input', maxlength: '200', 'aria-label': 'Name' });
    input.value = value;
    target.replaceWith(input);
    input.focus();
    input.select();
    var done = false;
    function end(save) {
      if (done) return;
      done = true;
      var next = input.value.trim();
      if (save && next && next !== value) onCommit(next);
      else render();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); end(true); }
      if (e.key === 'Escape') { e.preventDefault(); end(false); }
    });
    input.addEventListener('blur', function () { end(true); });
  }

  // ---------------------------------------------------------------------------
  // Popover menu

  var openMenuEl = null;

  function closeMenu() {
    if (!openMenuEl) return;
    var m = openMenuEl;
    openMenuEl = null;
    m.remove();
    if (m._anchor) {
      m._anchor.setAttribute('aria-expanded', 'false');
      if (m._restoreFocus) m._anchor.focus();
    }
  }

  /**
   * items: [{ label, hint, onSelect, disabled, danger }] | { separator: true }
   *        | { swatches: [colors], value, onSelect } | { note: text }
   */
  function openMenu(anchor, items) {
    var reopen = openMenuEl && openMenuEl._anchor === anchor;
    closeMenu();
    if (reopen) return;

    var menu = h('div', { class: 'menu', role: 'menu' });
    items.forEach(function (item) {
      if (item.separator) { menu.appendChild(h('div', { class: 'menu-sep', role: 'separator' })); return; }
      if (item.note) { menu.appendChild(h('div', { class: 'menu-note', text: item.note })); return; }
      if (item.swatches) {
        var row = h('div', { class: 'menu-swatches', role: 'group', 'aria-label': 'Color' });
        item.swatches.forEach(function (c) {
          row.appendChild(h('button', {
            type: 'button', class: 'swatch' + (c === item.value ? ' is-selected' : ''), role: 'menuitemradio',
            'aria-checked': c === item.value ? 'true' : 'false', 'aria-label': 'Color ' + c,
            style: '--swatch:' + c,
            onclick: function () { closeMenu(); item.onSelect(c); }
          }));
        });
        menu.appendChild(row);
        return;
      }
      menu.appendChild(h('button', {
        type: 'button', role: 'menuitem',
        class: 'menu-item' + (item.danger ? ' is-danger' : ''),
        disabled: item.disabled,
        title: item.title,
        onclick: function () { closeMenu(); item.onSelect(); }
      }, [
        h('span', { class: 'menu-label', text: item.label }),
        item.hint ? h('span', { class: 'menu-hint', text: item.hint }) : null
      ]));
    });

    document.body.appendChild(menu);
    menu._anchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');

    var r = anchor.getBoundingClientRect();
    var mw = menu.offsetWidth;
    var mh = menu.offsetHeight;
    var left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8);
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    openMenuEl = menu;

    var first = menu.querySelector('button:not([disabled])');
    if (first) first.focus();
  }

  document.addEventListener('pointerdown', function (e) {
    if (openMenuEl && !openMenuEl.contains(e.target) && !openMenuEl._anchor.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (!openMenuEl) return;
    if (e.key === 'Escape') { openMenuEl._restoreFocus = true; closeMenu(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      var btns = Array.prototype.slice.call(openMenuEl.querySelectorAll('button:not([disabled])'));
      var i = btns.indexOf(document.activeElement);
      var next = btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length];
      if (next) { e.preventDefault(); next.focus(); }
    }
  });
  window.addEventListener('resize', closeMenu);

  // ---------------------------------------------------------------------------
  // Confirm dialog

  function confirmDialog(title, message, okLabel) {
    var dlg = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-ok').textContent = okLabel || 'Delete';
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise(function (resolve) {
      dlg.addEventListener('close', function () { resolve(dlg.returnValue === 'confirm'); }, { once: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Rendering

  function render() {
    var focusKey = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.focusKey : null;
    var scrolls = {};
    board.querySelectorAll('[data-list]').forEach(function (l) { scrolls[l.dataset.list] = l.scrollTop; });

    renderTabs();
    renderBoard();

    board.querySelectorAll('[data-list]').forEach(function (l) {
      if (scrolls[l.dataset.list]) l.scrollTop = scrolls[l.dataset.list];
    });
    applySearch(false);
    if (focusKey) {
      var el = document.querySelector('[data-focus-key="' + CSS.escape(focusKey) + '"]');
      if (el) {
        el.focus({ preventScroll: false });
        // A re-rendered text field (e.g. the search box during a sync) keeps the caret at the end.
        if (el.tagName === 'INPUT' && /^(text|search)$/.test(el.type)) el.setSelectionRange(el.value.length, el.value.length);
      }
    }

    $('undo-btn').disabled = !store.canUndo();
    $('redo-btn').disabled = !store.canRedo();
    updateSaveStatus();
    renderSelectionBar();

    document.title = store.activeTab().name + ' — Story Outline Tool';
  }

  function renderTabs() {
    var db = store.getDb();
    tabList.textContent = '';
    db.tabs.forEach(function (tab) {
      var active = tab.id === db.activeTabId;
      var nameBtn = h('button', {
        type: 'button', class: 'tab-name', role: 'tab',
        'aria-selected': active ? 'true' : 'false',
        tabindex: active ? '0' : '-1',
        title: active ? 'Double-click to rename' : tab.name,
        dataset: { focusKey: 'tab:' + tab.id },
        onclick: function () { if (!active) store.setActiveTab(tab.id); },
        ondblclick: function (e) { renameTab(tab, e.currentTarget); },
        onkeydown: function (e) {
          if (e.key === 'F2') { e.preventDefault(); renameTab(tab, e.currentTarget); }
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            var tabs = store.getDb().tabs;
            var i = tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1);
            if (e.altKey) { store.moveTab(tab.id, i); return; }
            var next = tabs[(i + tabs.length) % tabs.length];
            store.setActiveTab(next.id);
            var btn = document.querySelector('[data-focus-key="tab:' + next.id + '"]');
            if (btn) btn.focus();
          }
        }
      }, [tab.name]);
      var closeBtn = h('button', {
        type: 'button', class: 'tab-close', 'aria-label': 'Delete story “' + tab.name + '”', title: 'Delete story',
        onclick: function () { deleteTab(tab); }
      }, [icon(ICONS.close)]);
      tabList.appendChild(h('div', { class: 'tab' + (active ? ' is-active' : '') }, [nameBtn, closeBtn]));
    });
    var activeEl = tabList.querySelector('.tab.is-active');
    if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renameTab(tab, el) {
    inlineEdit(el, tab.name, function (name) { store.renameTab(tab.id, name); });
  }

  function deleteTab(tab) {
    var count = tab.order.length;
    var msg = '“' + tab.name + '”' + (count ? ' and its ' + plural(count, 'chapter') : '') +
      ' will be removed. You can undo this right after.';
    confirmDialog('Delete this story?', msg, 'Delete story').then(function (ok) {
      if (!ok) return;
      store.deleteTab(tab.id);
      undoToast('Deleted “' + tab.name + '”');
    });
  }

  function renderBoard() {
    var tab = store.activeTab();
    if (board.dataset.tabId !== tab.id) {
      selection = { list: null, ids: [], anchor: null };
      search = { query: '', index: 0 };
    }
    pruneSelection(tab);
    board.textContent = '';
    board.dataset.tabId = tab.id;

    // Which subplots each chapter belongs to, for the tags on outline cards.
    var memberOf = Object.create(null);
    tab.subplots.forEach(function (sp, i) {
      sp.chapterIds.forEach(function (id) {
        (memberOf[id] = memberOf[id] || []).push(sp);
      });
    });

    var view = boardView();
    board.dataset.view = view;
    document.querySelectorAll('.view-switch [data-view]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.dataset.view === settings.view() ? 'true' : 'false');
    });

    if (view === 'matrix') {
      board.appendChild(renderMatrix(tab, memberOf));
      renderColumnNav(tab);
      return;
    }

    board.appendChild(renderMainColumn(tab, memberOf));

    var addButton = h('button', {
      type: 'button', class: 'add-subplot', dataset: { focusKey: 'add-subplot', navKey: 'add' },
      onclick: function () {
        var id = store.addSubplot(tab.id);
        if (boardView() === 'cards') focusSubplot(tab.id, id);
        var col = board.querySelector('[data-subplot-id="' + id + '"]');
        if (col) col.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
        announce('Subplot added');
      }
    }, [icon(ICONS.plus), h('span', { text: 'Add subplot' })]);

    if (view === 'cards' && tab.subplots.length) {
      // One subplot as a full column; the others as cards in a grid.
      var focused = focusedSubplot(tab);
      board.appendChild(renderSubplotColumn(tab, focused, tab.subplots.indexOf(focused)));
      var grid = h('div', { class: 'subplot-grid', role: 'list', 'aria-label': 'Other subplots' });
      tab.subplots.forEach(function (sp, i) {
        if (sp !== focused) grid.appendChild(renderSubplotTile(tab, sp, i));
      });
      grid.appendChild(addButton);
      board.appendChild(grid);
    } else {
      var subplots = h('div', { class: 'subplots' });
      tab.subplots.forEach(function (sp, i) { subplots.appendChild(renderSubplotColumn(tab, sp, i)); });
      subplots.appendChild(addButton);
      board.appendChild(subplots);
    }
    renderColumnNav(tab);
  }

  // --- Cards view (wide screens) -------------------------------------------

  // Narrow screens always use columns (one per screen).
  var narrowQuery = window.matchMedia('(max-width: 760px)');
  function boardView() { return narrowQuery.matches ? 'columns' : settings.view(); }
  if (narrowQuery.addEventListener) narrowQuery.addEventListener('change', function () { render(); });

  /** The subplot shown as a column in cards view (remembered per story). */
  function focusedSubplot(tab) {
    var id = settings.focusedSubplot(tab.id);
    for (var i = 0; i < tab.subplots.length; i++) if (tab.subplots[i].id === id) return tab.subplots[i];
    return tab.subplots[0];
  }

  function focusSubplot(tabId, subplotId) {
    settings.setFocusedSubplot(tabId, subplotId);
    render();
    var sp = store.getSubplot(tabId, subplotId);
    if (sp) announce(sp.name + ' shown as a column');
  }

  var TILE_CHAPTERS = 6;

  /** A collapsed subplot: name, counts and its first few chapters. Click to make it the column. */
  function renderSubplotTile(tab, sp, index) {
    var done = sp.chapterIds.filter(function (id) { return tab.chapters[id].state === 'done'; }).length;
    var rows = sp.chapterIds.slice(0, TILE_CHAPTERS).map(function (id, i) {
      var ch = tab.chapters[id];
      return h('li', { class: 'tile-chapter', 'data-chapter-id': id, 'data-state': ch.state, title: ch.description || ch.name }, [
        h('span', { class: 'tile-chapter-num', text: String(i + 1) }),
        h('span', { class: 'tile-chapter-name', text: ch.name }),
        h('span', { class: 'tile-chapter-ref', text: 'Ch. ' + (tab.order.indexOf(id) + 1) })
      ]);
    });
    var more = sp.chapterIds.length - TILE_CHAPTERS;

    return h('section', {
      class: 'subplot-tile', role: 'listitem', style: '--accent:' + sp.color,
      'data-list': 'sub:' + sp.id, 'data-drop': 'tile', 'data-tile-id': sp.id,
      'aria-label': 'Subplot: ' + sp.name,
      onclick: function (e) {
        if (e.target.closest('.tile-menu')) return;
        focusSubplot(tab.id, sp.id);
      }
    }, [
      h('div', { class: 'tile-head' }, [
        h('span', { class: 'subplot-dot', 'aria-hidden': 'true' }),
        h('button', {
          type: 'button', class: 'tile-name', title: 'Show “' + sp.name + '” as a column',
          dataset: { focusKey: 'tile:' + sp.id }
        }, [sp.name]),
        h('button', {
          type: 'button', class: 'icon-btn icon-btn-small tile-menu', 'aria-label': 'Subplot options', 'aria-haspopup': 'menu',
          title: 'Subplot options', dataset: { focusKey: 'tilemenu:' + sp.id },
          onclick: function (e) { subplotMenu(tab, sp, index, e.currentTarget); }
        }, [icon(ICONS.more)])
      ]),
      h('div', { class: 'column-sub', text: plural(sp.chapterIds.length, 'chapter') + (sp.chapterIds.length ? ' · ' + done + ' done' : '') }),
      rows.length ? h('ol', { class: 'tile-chapters' }, rows) : h('p', { class: 'tile-empty', text: 'No chapters yet. Drop one here.' }),
      more > 0 ? h('div', { class: 'tile-more', text: '+ ' + more + ' more' }) : null
    ]);
  }

  document.querySelectorAll('.view-switch [data-view]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      settings.setView(btn.dataset.view);
      render();
      announce({ cards: 'Cards view', matrix: 'Matrix view' }[btn.dataset.view] || 'Columns view');
    });
  });

  // --- Column switcher (narrow screens) ------------------------------------

  var columnNav = $('column-nav');

  /** Chips for the outline and each subplot; tapping one scrolls the board to it. */
  function renderColumnNav(tab) {
    columnNav.textContent = '';
    var items = [{ key: 'main', label: 'Outline' }].concat(tab.subplots.map(function (sp) {
      return { key: sp.id, label: sp.name, color: sp.color };
    }));
    items.forEach(function (item) {
      columnNav.appendChild(h('button', {
        type: 'button', dataset: { navKey: item.key },
        onclick: function () { scrollToColumn(item.key); }
      }, [
        item.color ? h('span', { class: 'subplot-dot', style: '--accent:' + item.color, 'aria-hidden': 'true' }) : null,
        h('span', { text: item.label })
      ]));
    });
    columnNav.appendChild(h('button', {
      type: 'button', dataset: { navKey: 'add' }, 'aria-label': 'Add subplot',
      onclick: function () { scrollToColumn('add'); }
    }, [h('span', { text: '+' })]));
    updateColumnNav();
  }

  function columnFor(key) {
    if (key === 'main') return board.querySelector('.column-main');
    if (key === 'add') return board.querySelector('.add-subplot');
    return board.querySelector('[data-subplot-id="' + key + '"]');
  }

  function scrollToColumn(key) {
    var el = columnFor(key);
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  /** Mark the chip for whichever column is closest to the middle of the board. */
  function updateColumnNav() {
    if (!columnNav.offsetParent) return; // hidden on wide screens
    var b = board.getBoundingClientRect();
    var mid = b.left + b.width / 2;
    var best = null;
    var bestDist = Infinity;
    columnNav.querySelectorAll('button').forEach(function (btn) {
      var el = columnFor(btn.dataset.navKey);
      if (!el) return;
      var r = el.getBoundingClientRect();
      var dist = Math.abs(r.left + r.width / 2 - mid);
      if (dist < bestDist) { bestDist = dist; best = btn; }
    });
    columnNav.querySelectorAll('button').forEach(function (btn) {
      btn.setAttribute('aria-current', btn === best ? 'true' : 'false');
    });
    if (best) {
      var nr = columnNav.getBoundingClientRect();
      var cr = best.getBoundingClientRect();
      if (cr.left < nr.left || cr.right > nr.right) {
        columnNav.scrollLeft += cr.left - nr.left - (nr.width - cr.width) / 2;
      }
    }
  }

  var navFrame = 0;
  board.addEventListener('scroll', function () {
    cancelAnimationFrame(navFrame);
    navFrame = requestAnimationFrame(updateColumnNav);
  }, { passive: true });
  window.addEventListener('resize', updateColumnNav);

  function renderMainColumn(tab, memberOf) {
    var list = h('ol', {
      class: 'card-list', 'data-list': 'main', 'aria-label': 'Chronological outline',
      'data-empty': 'No chapters yet. Add your first one below.'
    });
    tab.order.forEach(function (id, i) {
      var ch = tab.chapters[id];
      list.appendChild(renderCard(tab, ch, {
        list: 'main',
        number: String(i + 1),
        tags: memberOf[id] || []
      }));
    });

    var done = tab.order.filter(function (id) { return tab.chapters[id].state === 'done'; }).length;
    var summary = plural(tab.order.length, 'chapter') + (tab.order.length ? ' · ' + done + ' done' : '');

    return h('section', { class: 'column column-main', 'aria-labelledby': 'main-title' }, [
      h('header', { class: 'column-header' }, [
        h('div', { class: 'column-title-row' }, [
          h('h2', { class: 'column-title', id: 'main-title', text: 'Chronological outline' })
        ]),
        h('div', { class: 'column-sub', text: summary }),
        searchField()
      ]),
      list,
      h('footer', { class: 'column-footer' }, [quickAdd(tab, null)])
    ]);
  }

  // --- Search in the chronological outline ---------------------------------
  // Typing scrolls to the closest-matching chapter name as you type. Enter /
  // Shift+Enter step through the other matches, Esc clears.

  var search = { query: '', index: 0 };

  /**
   * How well a chapter name matches the query (higher is better, -1 = no match):
   * exact, starts with, a word starts with, contains, all words, letters in order.
   */
  function matchScore(name, query) {
    var n = name.toLowerCase();
    var q = query.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!q) return -1;
    if (n === q) return 100;
    if (n.indexOf(q) === 0) return 90;
    var at = n.indexOf(q);
    if (at > 0) return /[\s\-–—:,.;'"(/]/.test(n.charAt(at - 1)) ? 80 : 70;
    var words = q.split(' ');
    if (words.length > 1 && words.every(function (w) { return n.indexOf(w) >= 0; })) return 60;
    var i = 0;
    for (var k = 0; k < n.length && i < q.length; k++) if (n.charAt(k) === q.charAt(i)) i++;
    return i === q.length && q.length > 1 ? 40 : -1;
  }

  /** Matching chapter ids, best first (ties in story order). A number jumps to that chapter. */
  function searchMatches(tab) {
    var q = search.query.trim();
    if (!q) return [];
    var scored = [];
    tab.order.forEach(function (id, i) {
      var score = matchScore(tab.chapters[id].name, q);
      if (/^\d+$/.test(q) && Number(q) === i + 1) score = Math.max(score, 95);
      if (score >= 0) scored.push({ id: id, score: score, pos: i });
    });
    scored.sort(function (a, b) { return b.score - a.score || a.pos - b.pos; });
    return scored.map(function (s) { return s.id; });
  }

  /** Highlight matches in the outline (and scroll to the current one if `scroll`). */
  function applySearch(scroll) {
    var root = board.querySelector('[data-list="main"]');
    board.querySelectorAll('.is-search-hit, .is-search-match').forEach(function (c) {
      c.classList.remove('is-search-hit', 'is-search-match');
    });
    var count = board.querySelector('.search-count');
    var input = board.querySelector('.search-input');
    if (!root || !count) return;
    var matches = searchMatches(store.activeTab());
    var field = count.parentNode;
    field.classList.toggle('has-query', !!search.query.trim());
    field.classList.toggle('no-match', !!search.query.trim() && !matches.length);
    if (!matches.length) {
      count.textContent = search.query.trim() ? 'No match' : '';
      if (input) input.removeAttribute('aria-activedescendant');
      return;
    }
    search.index = ((search.index % matches.length) + matches.length) % matches.length;
    var hit = null;
    matches.forEach(function (id, i) {
      var card = root.querySelector('.card[data-chapter-id="' + id + '"]');
      if (!card) return;
      card.classList.add(i === search.index ? 'is-search-hit' : 'is-search-match');
      if (i === search.index) hit = card;
    });
    count.textContent = matches.length === 1 ? '1 match' : (search.index + 1) + ' of ' + matches.length;
    if (scroll && hit) {
      hit.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      var ch = store.activeTab().chapters[matches[search.index]];
      if (ch) announce('Chapter ' + (store.activeTab().order.indexOf(ch.id) + 1) + ': ' + ch.name);
    }
  }

  function searchField() {
    var input = h('input', {
      type: 'search', class: 'search-input', placeholder: 'Find a chapter…', autocomplete: 'off', spellcheck: 'false',
      'aria-label': 'Find a chapter in the outline', 'aria-keyshortcuts': 'Enter Shift+Enter Escape',
      dataset: { focusKey: 'search:main' },
      oninput: function (e) {
        search.query = e.target.value;
        search.index = 0;
        applySearch(true);
      },
      onkeydown: function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          search.index += e.shiftKey ? -1 : 1;
          applySearch(true);
        } else if (e.key === 'Escape' && search.query) {
          e.preventDefault();
          e.stopPropagation();
          search.query = '';
          e.target.value = '';
          applySearch(false);
        }
      }
    });
    input.value = search.query;
    return h('div', { class: 'search', role: 'search' }, [
      h('span', { class: 'search-icon', 'aria-hidden': 'true' }, [icon(ICONS.search)]),
      input,
      h('span', { class: 'search-count', 'aria-live': 'polite' }),
      h('button', {
        type: 'button', class: 'search-clear', 'aria-label': 'Clear search', title: 'Clear search (Esc)',
        onclick: function () {
          search.query = '';
          input.value = '';
          applySearch(false);
          input.focus();
        }
      }, [icon(ICONS.close)])
    ]);
  }

  // "/" jumps to the search box (when not typing somewhere else).
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTyping(document.activeElement) || document.querySelector('dialog[open]')) return;
    var input = board.querySelector('.search-input');
    if (!input) return;
    e.preventDefault();
    input.focus();
    input.select();
  });

  // --- Matrix view (wide screens) ------------------------------------------

  var MATRIX_CARD = 264;  // card width, px
  var MATRIX_ARROW = 40;  // space for the arrow between cards
  var MATRIX_PAD = 24;    // padding inside the matrix panel

  /** How many cards fit in one row of the matrix at the current board width. */
  function matrixPerRow() {
    var avail = board.clientWidth - 2 * (16 + MATRIX_PAD);
    return Math.max(1, Math.floor((avail + MATRIX_ARROW) / (MATRIX_CARD + MATRIX_ARROW)));
  }

  function arrow(direction) {
    var paths = {
      right: '<path d="M3 10h13M11 5l5 5-5 5"/>',
      down: '<path d="M10 3v13M5 11l5 5 5-5"/>'
    };
    return h('span', { class: 'matrix-arrow matrix-arrow-' + direction, 'aria-hidden': 'true' }, [icon(paths[direction])]);
  }

  /**
   * The chronological outline as a snake: rows alternate left-to-right and
   * right-to-left, with a down arrow where one row turns into the next. The
   * DOM keeps chronological order (reversed rows use row-reverse), so reading
   * and keyboard order follow the story.
   */
  function renderMatrix(tab, memberOf) {
    var perRow = matrixPerRow();
    var done = tab.order.filter(function (id) { return tab.chapters[id].state === 'done'; }).length;
    var summary = plural(tab.order.length, 'chapter') + (tab.order.length ? ' · ' + done + ' done' : '');

    var snake = h('div', {
      class: 'matrix-snake', 'data-list': 'main', 'data-layout': 'matrix',
      'aria-label': 'Chronological outline', role: 'list',
      style: '--per-row:' + perRow + ';--matrix-card:' + MATRIX_CARD + 'px;--matrix-arrow:' + MATRIX_ARROW + 'px'
    });

    var rows = Math.ceil(tab.order.length / perRow);
    for (var r = 0; r < rows; r++) {
      var reversed = r % 2 === 1;
      var ids = tab.order.slice(r * perRow, (r + 1) * perRow);
      var row = h('div', { class: 'matrix-row' + (reversed ? ' is-reversed' : ''), role: 'presentation' });
      ids.forEach(function (id, j) {
        var i = r * perRow + j;
        row.appendChild(renderCard(tab, tab.chapters[id], { list: 'main', number: String(i + 1), tags: memberOf[id] || [] }));
        if (j < ids.length - 1) row.appendChild(arrow('right'));
      });
      snake.appendChild(row);
      if (r < rows - 1) {
        // The turn: under the last card of this row, which is at the right end
        // of a left-to-right row and the left end of a right-to-left one.
        snake.appendChild(h('div', { class: 'matrix-turn' + (reversed ? ' is-reversed' : ''), 'aria-hidden': 'true' }, [arrow('down')]));
      }
    }
    if (!tab.order.length) snake.appendChild(h('p', { class: 'matrix-empty', text: 'No chapters yet. Add your first one above.' }));

    return h('section', { class: 'matrix', 'aria-labelledby': 'matrix-title' }, [
      h('header', { class: 'matrix-header' }, [
        h('div', { class: 'matrix-heading' }, [
          h('h2', { class: 'column-title', id: 'matrix-title', text: 'Chronological outline' }),
          h('div', { class: 'column-sub', text: summary })
        ]),
        searchField(),
        quickAdd(tab, null)
      ]),
      snake
    ]);
  }

  // Re-flow the matrix when the window size changes the number of cards per row.
  var matrixResizeTimer = 0;
  window.addEventListener('resize', function () {
    if (board.dataset.view !== 'matrix') return;
    clearTimeout(matrixResizeTimer);
    matrixResizeTimer = setTimeout(function () {
      var snake = board.querySelector('.matrix-snake');
      if (snake && Number(snake.style.getPropertyValue('--per-row')) !== matrixPerRow()) render();
    }, 120);
  });

  function renderSubplotColumn(tab, sp, index) {
    var listKey = 'sub:' + sp.id;
    var list = h('ol', {
      class: 'card-list', 'data-list': listKey, 'aria-label': sp.name,
      'data-empty': 'Drag chapters here from the outline, or add one below.'
    });
    var prevPos = -1;
    sp.chapterIds.forEach(function (id, i) {
      var pos = tab.order.indexOf(id);
      list.appendChild(renderCard(tab, tab.chapters[id], {
        list: listKey,
        subplotId: sp.id,
        subplotName: sp.name,
        number: String(i + 1),
        chapterNumber: pos + 1,
        outOfOrder: pos < prevPos
      }));
      prevPos = pos;
    });

    var nameEl = h('button', {
      type: 'button', class: 'column-title column-title-btn', title: 'Rename subplot',
      dataset: { focusKey: 'spname:' + sp.id },
      onclick: function (e) { renameSubplot(sp, e.currentTarget); }
    }, [sp.name]);

    var menuBtn = h('button', {
      type: 'button', class: 'icon-btn icon-btn-small', 'aria-label': 'Subplot options', 'aria-haspopup': 'menu',
      title: 'Subplot options', dataset: { focusKey: 'spmenu:' + sp.id },
      onclick: function (e) { subplotMenu(tab, sp, index, e.currentTarget); }
    }, [icon(ICONS.more)]);

    // Chapters from the outline that aren't in this subplot yet.
    var missing = tab.order.filter(function (id) { return sp.chapterIds.indexOf(id) < 0; });
    var picker = null;
    if (missing.length) {
      picker = h('select', {
        class: 'add-existing', 'aria-label': 'Add an existing chapter to ' + sp.name,
        dataset: { focusKey: 'pick:' + sp.id },
        onchange: function (e) {
          if (!e.target.value) return;
          store.addToSubplot(tab.id, sp.id, e.target.value);
          announce('Added to ' + sp.name);
        }
      }, [h('option', { value: '', text: '+ Add existing chapter…' })].concat(missing.map(function (id) {
        return h('option', { value: id, text: (tab.order.indexOf(id) + 1) + '. ' + tab.chapters[id].name });
      })));
    }

    return h('section', {
      class: 'column column-subplot', 'data-subplot-id': sp.id,
      style: '--accent:' + sp.color, 'aria-label': 'Subplot: ' + sp.name
    }, [
      h('header', { class: 'column-header' }, [
        h('div', { class: 'column-title-row' }, [
          h('span', { class: 'subplot-dot', 'aria-hidden': 'true' }),
          nameEl,
          menuBtn
        ]),
        h('div', { class: 'column-sub', text: plural(sp.chapterIds.length, 'chapter') })
      ]),
      list,
      h('footer', { class: 'column-footer' }, [picker, quickAdd(tab, sp)])
    ]);
  }

  function renderCard(tab, ch, ctx) {
    var inSubplot = !!ctx.subplotId;
    var meta = [
      h('span', { class: 'state-pill', 'data-state': ch.state, text: STATE_LABELS[ch.state] })
    ];
    if (inSubplot) {
      meta.push(h('span', {
        class: 'card-chapter-ref' + (ctx.outOfOrder ? ' is-out-of-order' : ''),
        title: ctx.outOfOrder ? 'Comes earlier in the outline than the previous chapter in this subplot' : 'Position in the chronological outline',
        text: 'Ch. ' + ctx.chapterNumber
      }));
    }
    if (ch.summary) {
      var preview = ch.summary.length > 400 ? ch.summary.slice(0, 400) + '…' : ch.summary;
      meta.push(h('span', { class: 'card-notes', title: preview, 'aria-label': 'Has notes' }, [icon(ICONS.notes)]));
    }
    if (ctx.tags && ctx.tags.length) {
      meta.push(h('span', { class: 'card-tags' }, ctx.tags.map(function (sp) {
        return h('span', { class: 'tag', style: '--tag:' + sp.color, title: 'Subplot: ' + sp.name, text: sp.name });
      })));
    }

    var label = (inSubplot ? ctx.subplotName + ' ' + ctx.number + ', chapter ' + ctx.chapterNumber : 'Chapter ' + ctx.number) +
      ': ' + ch.name + ', ' + STATE_LABELS[ch.state] +
      (ctx.tags && ctx.tags.length ? ', subplots: ' + ctx.tags.map(function (sp) { return sp.name; }).join(', ') : '');

    var selected = isSelected(ctx.list, ch.id);
    return h('li', {
      class: 'card' + (selected ? ' is-selected' : ''), tabindex: '0', role: 'button',
      'aria-label': label + (selected ? ' (selected)' : ''),
      'aria-keyshortcuts': 'Enter Control+Space Alt+ArrowUp Alt+ArrowDown',
      dataset: { chapterId: ch.id, state: ch.state, focusKey: 'card:' + ctx.list + ':' + ch.id },
      onclick: function (e) { cardClick(e, tab, ch, ctx); },
      onkeydown: function (e) { cardKeydown(e, tab, ch, ctx); }
    }, [
      h('span', { class: 'card-grip', title: 'Drag to move' }, [icon(ICONS.grip)]),
      h('span', { class: 'card-num', text: ctx.number }),
      h('div', { class: 'card-body' }, [
        h('div', { class: 'card-title', text: ch.name }),
        ch.description ? h('p', { class: 'card-description', text: ch.description }) : null,
        h('div', { class: 'card-meta' }, meta)
      ]),
      inSubplot ? h('button', {
        type: 'button', class: 'card-remove', title: 'Remove from this subplot',
        'aria-label': 'Remove “' + ch.name + '” from this subplot',
        onclick: function (e) {
          e.stopPropagation();
          removeFromSubplot(tab, ctx.subplotId, ch);
        }
      }, [icon(ICONS.close)]) : null
    ]);
  }

  function quickAdd(tab, sp) {
    var input = h('input', {
      type: 'text', class: 'quick-add-input', maxlength: '200', autocomplete: 'off',
      placeholder: sp ? 'New chapter in this subplot…' : 'New chapter title…',
      'aria-label': sp ? 'New chapter in ' + sp.name : 'New chapter title',
      dataset: { focusKey: 'quick:' + (sp ? sp.id : 'main') }
    });
    return h('form', {
      class: 'quick-add',
      onsubmit: function (e) {
        e.preventDefault();
        var name = input.value.trim();
        if (!name) { input.focus(); return; }
        input.value = '';
        store.addChapter(tab.id, { name: name }, { subplotId: sp ? sp.id : null });
        announce('Added chapter ' + name);
        var list = board.querySelector('[data-list="' + (sp ? 'sub:' + sp.id : 'main') + '"]');
        if (list) list.scrollTop = list.scrollHeight;
      }
    }, [
      input,
      h('button', { type: 'submit', class: 'icon-btn', 'aria-label': 'Add chapter', title: 'Add chapter' }, [icon(ICONS.plus)])
    ]);
  }

  // ---------------------------------------------------------------------------
  // Actions

  function renameSubplot(sp, el) {
    var tabId = store.activeTab().id;
    inlineEdit(el, sp.name, function (name) { store.updateSubplot(tabId, sp.id, { name: name }); });
  }

  function subplotMenu(tab, sp, index, anchor) {
    openMenu(anchor, [
      { label: 'Rename', onSelect: function () {
        var el = board.querySelector('[data-focus-key="spname:' + sp.id + '"]');
        if (el) renameSubplot(sp, el);
      } },
      { label: 'Sort by outline order', onSelect: function () {
        store.sortSubplot(tab.id, sp.id);
        announce(sp.name + ' sorted by outline order');
      } },
      { label: 'Move left', disabled: index === 0, onSelect: function () { store.moveSubplot(tab.id, sp.id, index - 1); } },
      { label: 'Move right', disabled: index === tab.subplots.length - 1, onSelect: function () { store.moveSubplot(tab.id, sp.id, index + 1); } },
      { separator: true },
      { swatches: store.SUBPLOT_COLORS, value: sp.color, onSelect: function (c) { store.updateSubplot(tab.id, sp.id, { color: c }); } },
      { separator: true },
      { label: 'Delete subplot', danger: true, hint: 'Chapters stay in the outline', onSelect: function () {
        store.deleteSubplot(tab.id, sp.id);
        undoToast('Deleted subplot “' + sp.name + '”');
      } }
    ]);
  }

  function removeFromSubplot(tab, spId, ch) {
    var sp = store.getSubplot(tab.id, spId);
    store.removeFromSubplot(tab.id, spId, ch.id);
    undoToast('Removed “' + ch.name + '” from ' + (sp ? sp.name : 'subplot'));
  }

  function cardKeydown(e, tab, ch, ctx) {
    if (e.target !== e.currentTarget) return;
    if (e.key === ' ' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      toggleSelect(ctx.list, ch.id);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openChapterDialog(tab.id, ch.id);
      return;
    }
    if (ctx.subplotId && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      var next = e.currentTarget.nextElementSibling || e.currentTarget.previousElementSibling;
      if (isSelected(ctx.list, ch.id) && selection.ids.length > 1) {
        var group = selectedInOrder(tab);
        var sub = store.getSubplot(tab.id, ctx.subplotId);
        clearSelection();
        store.removeFromSubplot(tab.id, ctx.subplotId, group);
        undoToast('Removed ' + group.length + ' chapters from ' + (sub ? sub.name : 'subplot'));
        return;
      }
      removeFromSubplot(tab, ctx.subplotId, ch);
      if (next && next.dataset.focusKey) {
        var el = document.querySelector('[data-focus-key="' + CSS.escape(next.dataset.focusKey) + '"]');
        if (el) el.focus();
      }
      return;
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      var delta = e.key === 'ArrowUp' ? -1 : 1;
      if (isSelected(ctx.list, ch.id) && selection.ids.length > 1) {
        // Move the whole selection one step, keeping its order.
        store.shiftChapters(tab.id, selectedInOrder(tab), delta, ctx.subplotId || null);
        announce('Moved ' + selection.ids.length + ' chapters ' + (delta < 0 ? 'up' : 'down'));
        return;
      }
      if (ctx.subplotId) {
        var sp = store.getSubplot(tab.id, ctx.subplotId);
        var to = sp.chapterIds.indexOf(ch.id) + delta;
        if (to < 0 || to >= sp.chapterIds.length) return;
        store.placeInSubplot(tab.id, sp.id, ch.id, to);
        announce('Moved to position ' + (to + 1) + ' in ' + sp.name);
      } else {
        var i = tab.order.indexOf(ch.id) + delta;
        if (i < 0 || i >= tab.order.length) return;
        store.moveChapter(tab.id, ch.id, i);
        announce('Moved to chapter ' + (i + 1));
      }
    }
  }

  function handleDrop(d) {
    var tab = store.activeTab();
    var ids = d.chapterIds.filter(function (id) { return tab.chapters[id]; });
    if (!ids.length) return;
    var what = ids.length === 1 ? '“' + tab.chapters[ids[0]].name + '”' : ids.length + ' chapters';
    // A group moved to another column stays selected there; a single card doesn't start a selection.
    var keep = ids.length > 1;

    if (d.to === 'main') {
      store.moveChapter(tab.id, ids, d.index);
      if (keep) setSelection('main', ids);
      announce('Moved ' + what + ' to chapter ' + (d.index + 1));
      return;
    }
    var toId = d.to.slice(4);
    var fromId = d.from.indexOf('sub:') === 0 ? d.from.slice(4) : null;
    var sp = store.getSubplot(tab.id, toId);
    var wasIn = sp && ids.every(function (id) { return sp.chapterIds.indexOf(id) >= 0; });
    if (d.tile) {
      // Dropped on a collapsed subplot card: each goes in at its place in the outline order.
      store.addToSubplot(tab.id, toId, ids, d.copy ? null : fromId);
      clearSelection();
      if (sp) announce(wasIn ? 'Already in ' + sp.name : 'Added ' + what + ' to ' + sp.name);
      return;
    }
    // Between subplots a drag moves; hold Ctrl/⌘/Alt to copy instead.
    store.placeInSubplot(tab.id, toId, ids, d.index, d.copy ? null : fromId);
    if (keep) setSelection(d.to, ids);
    if (sp) announce((wasIn ? 'Moved ' : 'Added ') + what + ' in ' + sp.name);
  }

  // ---------------------------------------------------------------------------
  // Multi-selection: Ctrl/⌘+click (or Ctrl+Space) toggles a card, Shift+click
  // selects a range. A selection lives in one list (the outline or one subplot)
  // and is dragged, or moved with Alt+↑/↓, as a group.

  var selection = { list: null, ids: [], anchor: null };
  var dragApi = null;

  function listIds(tab, listKey) {
    if (listKey === 'main') return tab.order;
    var sp = listKey ? store.getSubplot(tab.id, listKey.slice(4)) : null;
    return sp ? sp.chapterIds : [];
  }

  function isSelected(listKey, id) { return selection.list === listKey && selection.ids.indexOf(id) >= 0; }

  /** The selected ids in the order they appear in their list. */
  function selectedInOrder(tab) {
    return listIds(tab, selection.list).filter(function (id) { return selection.ids.indexOf(id) >= 0; });
  }

  function setSelection(listKey, ids, anchor) {
    selection = { list: ids.length ? listKey : null, ids: ids.slice(), anchor: anchor || ids[ids.length - 1] || null };
    refreshSelection();
  }

  function clearSelection() {
    if (selection.ids.length) setSelection(null, []);
  }

  function toggleSelect(listKey, id) {
    var ids = selection.list === listKey ? selection.ids.slice() : [];
    var i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1); else ids.push(id);
    setSelection(listKey, ids, id);
    announce(ids.length ? ids.length + ' selected' : 'Selection cleared');
  }

  function rangeSelect(tab, listKey, id) {
    var all = listIds(tab, listKey);
    var anchor = selection.list === listKey && selection.anchor ? selection.anchor : id;
    var a = all.indexOf(anchor);
    var b = all.indexOf(id);
    if (a < 0) a = b;
    var range = all.slice(Math.min(a, b), Math.max(a, b) + 1);
    var base = selection.list === listKey ? selection.ids : [];
    var ids = base.concat(range.filter(function (x) { return base.indexOf(x) < 0; }));
    setSelection(listKey, ids, anchor);
    announce(ids.length + ' selected');
  }

  /** Drop ids that are no longer in the selected list (after edits, undo, sync…). */
  function pruneSelection(tab) {
    if (!selection.list) return;
    var all = listIds(tab, selection.list);
    selection.ids = selection.ids.filter(function (id) { return all.indexOf(id) >= 0; });
    if (!selection.ids.length) selection = { list: null, ids: [], anchor: null };
  }

  /** Update the selected look of cards in place (no full re-render). */
  function refreshSelection() {
    board.querySelectorAll('.card').forEach(function (card) {
      var list = card.closest('[data-list]');
      card.classList.toggle('is-selected', !!list && isSelected(list.dataset.list, card.dataset.chapterId));
    });
    renderSelectionBar();
  }

  function renderSelectionBar() {
    var bar = $('selection-bar');
    var n = selection.ids.length;
    bar.hidden = n === 0;
    document.body.classList.toggle('has-selection', n > 0);
    if (!n) return;
    var tab = store.activeTab();
    var where = selection.list === 'main' ? 'the outline' : (store.getSubplot(tab.id, selection.list.slice(4)) || { name: 'a subplot' }).name;
    $('selection-count').textContent = plural(n, 'chapter') + ' selected in ' + where;
  }

  function cardClick(e, tab, ch, ctx) {
    if (e.ctrlKey || e.metaKey) { toggleSelect(ctx.list, ch.id); return; }
    if (e.shiftKey) { rangeSelect(tab, ctx.list, ch.id); return; }
    clearSelection();
    openChapterDialog(tab.id, ch.id);
  }

  $('selection-clear').addEventListener('click', clearSelection);

  // Clicking empty space on the board clears the selection.
  board.addEventListener('click', function (e) {
    if (!e.target.closest('.card, button, input, select, textarea, a, .subplot-tile')) clearSelection();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !selection.ids.length || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]') || openMenuEl || (dragApi && dragApi.isDragging())) return;
    clearSelection();
  });

  /** Which chapters a drag starting on `card` carries: the selection if the card is in it. */
  function dragIds(card) {
    var list = card.closest('[data-list]');
    var key = list ? list.dataset.list : null;
    var id = card.dataset.chapterId;
    if (isSelected(key, id) && selection.ids.length > 1) return selectedInOrder(store.activeTab());
    if (!isSelected(key, id)) clearSelection();
    return [id];
  }

  // ---------------------------------------------------------------------------
  // Chapter dialog

  var dialog = $('chapter-dialog');
  var editing = null;

  (function setupDialog() {
    var select = $('chapter-state');
    store.STATES.forEach(function (s) { select.appendChild(h('option', { value: s.id, text: s.label })); });

    $('chapter-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!editing) return;
      var spIds = Array.prototype.map.call(
        dialog.querySelectorAll('#chapter-subplots input:checked'), function (cb) { return cb.value; });
      store.updateChapter(editing.tabId, editing.chapterId, {
        name: $('chapter-name').value,
        state: select.value,
        description: $('chapter-description').value,
        summary: $('chapter-summary').value.trim(),
        subplotIds: spIds
      });
      dialog.close();
    });
    $('chapter-cancel').addEventListener('click', function () { dialog.close(); });
    $('chapter-delete').addEventListener('click', function () {
      if (!editing) return;
      var tab = store.getTab(editing.tabId);
      var ch = tab && tab.chapters[editing.chapterId];
      dialog.close();
      if (!ch) return;
      store.deleteChapter(tab.id, ch.id);
      undoToast('Deleted “' + ch.name + '”');
    });
    dialog.addEventListener('close', function () {
      var last = editing;
      editing = null;
      if (last && last.returnFocus && document.body.contains(last.returnFocus)) {
        last.returnFocus.focus();
      } else if (last) {
        var el = board.querySelector('.card[data-chapter-id="' + last.chapterId + '"]');
        if (el) el.focus();
      }
    });
  })();

  function openChapterDialog(tabId, chapterId) {
    var tab = store.getTab(tabId);
    var ch = tab && tab.chapters[chapterId];
    if (!ch) return;
    editing = { tabId: tabId, chapterId: chapterId, returnFocus: document.activeElement };

    $('chapter-dialog-number').textContent = 'Chapter ' + (tab.order.indexOf(chapterId) + 1) + ' of ' + tab.order.length;
    $('chapter-name').value = ch.name;
    $('chapter-state').value = ch.state;
    $('chapter-description').value = ch.description || '';
    $('chapter-summary').value = ch.summary || '';

    var checks = $('chapter-subplots');
    checks.textContent = '';
    if (!tab.subplots.length) {
      checks.appendChild(h('p', { class: 'field-hint', text: 'No subplots yet. Add one from the board.' }));
    }
    tab.subplots.forEach(function (sp) {
      var pos = sp.chapterIds.indexOf(chapterId);
      checks.appendChild(h('label', { class: 'subplot-check', style: '--accent:' + sp.color }, [
        h('input', { type: 'checkbox', value: sp.id, checked: pos >= 0 }),
        h('span', { class: 'subplot-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'subplot-check-name', text: sp.name }),
        pos >= 0 ? h('span', { class: 'field-hint', text: '#' + (pos + 1) }) : null
      ]));
    });

    dialog.showModal();
    $('chapter-name').focus();
    $('chapter-name').select();
  }

  // ---------------------------------------------------------------------------
  // Header

  $('tab-add').addEventListener('click', function () {
    store.addTab();
    var btn = tabList.querySelector('.tab.is-active .tab-name');
    if (btn) renameTab(store.activeTab(), btn);
  });
  // Let a regular mouse wheel scroll the tab strip sideways when it overflows.
  tabList.addEventListener('wheel', function (e) {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || tabList.scrollWidth <= tabList.clientWidth) return;
    e.preventDefault();
    tabList.scrollLeft += e.deltaY;
  }, { passive: false });
  $('undo-btn').addEventListener('click', function () { if (store.undo()) announce('Undone'); });
  $('redo-btn').addEventListener('click', function () { if (store.redo()) announce('Redone'); });


  // ---------------------------------------------------------------------------
  // Popups: Data, Sync and Settings

  // Close buttons, and clicking the backdrop, close any of the popups.
  document.querySelectorAll('dialog').forEach(function (dlg) {
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
  });

  // "Copy" buttons next to key fields.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    var input = $(btn.getAttribute('data-copy'));
    var done = function () {
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
    } else {
      input.select();
      try { document.execCommand('copy'); done(); } catch (err) { /* leave it selected */ }
    }
  });

  /** Run an async action with `button` disabled and showing `busyLabel`. */
  function busy(button, busyLabel, promise) {
    var label = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-busy');
    if (busyLabel) button.textContent = busyLabel;
    return promise.finally(function () {
      button.disabled = false;
      button.classList.remove('is-busy');
      button.innerHTML = label;
    });
  }

  function timeAgo(iso) {
    if (!iso) return 'never';
    var s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return 'just now';
    if (s < 90) return 'a minute ago';
    if (s < 3600) return Math.round(s / 60) + ' minutes ago';
    if (s < 5400) return 'an hour ago';
    if (s < 86400) return Math.round(s / 3600) + ' hours ago';
    return new Date(iso).toLocaleString();
  }

  function updateSaveStatus() {
    var el = $('save-status');
    var st = sync.status();
    var text = 'Saved in this browser';
    var title = 'Your outlines are saved in this browser’s local storage';
    var state = '';
    if (store.saveError()) {
      text = 'Not saved: storage unavailable';
      state = 'error';
    } else if (st.connected) {
      if (st.state === 'syncing') { text = 'Syncing…'; state = 'syncing'; }
      else if (st.state === 'error') { text = 'Sync problem'; title = st.message; state = 'error'; }
      else if (st.lastSyncedAt) { text = 'Synced'; title = 'Last synced ' + timeAgo(st.lastSyncedAt); state = 'synced'; }
      else { text = 'Sync on'; }
    }
    el.textContent = text;
    el.title = title;
    el.dataset.state = state;
  }

  $('save-status').addEventListener('click', function () {
    if (sync.status().connected) openSyncDialog();
    else openDataDialog();
  });

  // --- Data ---------------------------------------------------------------

  var dataDialog = $('data-dialog');

  function openDataDialog() {
    renderDataSync();
    $('markdown-help').hidden = true;
    $('markdown-help-btn').setAttribute('aria-expanded', 'false');
    if (!dataDialog.open) dataDialog.showModal();
  }

  function renderDataSync() {
    var st = sync.status();
    $('data-sync-text').textContent = st.connected
      ? (st.state === 'error' ? 'Sync is on, but the last sync failed: ' + st.message
        : 'Sync is on. Last synced ' + timeAgo(st.lastSyncedAt) + '.')
      : 'Keep your stories in sync across devices with end-to-end encryption.';
  }

  $('data-btn').addEventListener('click', openDataDialog);

  $('export-btn').addEventListener('click', function () {
    io.exportDatabase();
    toast('Database exported');
  });

  $('import-btn').addEventListener('click', function () {
    var input = $('import-file');
    input.value = '';
    input.click();
  });

  $('import-file').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    io.readDatabaseFile(file).then(function (result) {
      var msg = 'All local data will be destroyed and replaced with the data in “' + file.name + '” (' +
        (result.tabCount === 1 ? '1 story' : result.tabCount + ' stories') + ', ' +
        plural(result.chapterCount, 'chapter') + ').';
      if (sync.status().connected) msg += ' Your synced data will be updated to match.';
      return confirmDialog('Replace all local data?', msg, 'Replace data').then(function (ok) {
        if (!ok) return;
        store.importDatabase(result.data);
        dataDialog.close();
        undoToast('Database imported');
      });
    }).catch(function (err) {
      toast(err.message);
    });
  });

  $('sync-open').addEventListener('click', openSyncDialog);

  $('markdown-btn').addEventListener('click', function () {
    io.exportMarkdown();
    toast('Exported “' + store.activeTab().name + '” as Markdown');
  });

  $('markdown-help-btn').addEventListener('click', function (e) {
    var help = $('markdown-help');
    help.hidden = !help.hidden;
    e.currentTarget.setAttribute('aria-expanded', help.hidden ? 'false' : 'true');
  });

  // --- Sync ---------------------------------------------------------------

  var syncDialog = $('sync-dialog');
  // Don't leave secret keys sitting in the page after the popup closes.
  syncDialog.addEventListener('close', function () {
    ['sync-generated-key', 'sync-key-input', 'sync-key-value'].forEach(function (id) { $(id).value = ''; });
    $('sync-generated').hidden = true;
    $('sync-key-reveal').hidden = true;
  });
  var METHOD_LABELS = { key: 'Sync key', extension: 'Browser extension', bunker: 'nsec bunker' };

  function openSyncDialog() {
    showSyncError('');
    $('sync-generated').hidden = true;
    $('sync-generated-key').value = '';
    $('sync-key-input').value = '';
    $('sync-key-reveal').hidden = true;
    $('sync-key-value').value = '';
    renderSyncDialog();
    $('sync-relays').value = sync.status().relays.join('\n');
    if (!syncDialog.open) syncDialog.showModal();
  }

  function showSyncError(message) {
    var el = $('sync-error');
    el.textContent = message;
    el.hidden = !message;
  }

  function renderSyncDialog() {
    var st = sync.status();
    $('sync-signed-out').hidden = st.connected;
    $('sync-signed-in').hidden = !st.connected;
    if (!st.connected) return;

    var titles = { syncing: 'Syncing…', synced: 'Synced', error: 'Sync problem', idle: 'Sync on' };
    $('sync-state-title').textContent = titles[st.state] || 'Sync on';
    $('sync-state-detail').textContent = st.state === 'error' ? st.message : 'Last synced ' + timeAgo(st.lastSyncedAt) + '.';
    $('sync-dot').dataset.state = st.state;
    $('sync-method').textContent = METHOD_LABELS[st.method] || st.method;
    $('sync-npub').textContent = st.npub.slice(0, 16) + '…' + st.npub.slice(-6);
    $('sync-npub').title = st.npub;
    $('sync-show-key').hidden = st.method !== 'key';
    $('sync-now').disabled = st.state === 'syncing';
  }

  sync.subscribe(function () {
    updateSaveStatus();
    if (syncDialog.open) renderSyncDialog();
    if (dataDialog.open) renderDataSync();
    if (settingsDialog.open) renderDeleteOptions();
  });

  /** Shared handling for the three ways of turning sync on. */
  function startSync(button, label, promiseFn) {
    showSyncError('');
    var p;
    try { p = promiseFn(); } catch (err) { p = Promise.reject(err); }
    return busy(button, label, p).then(function () {
      renderSyncDialog();
      toast('Sync is on');
    }, function (err) {
      renderSyncDialog();
      showSyncError(err && err.message ? err.message : 'Couldn’t start syncing.');
    });
  }

  $('sync-generate').addEventListener('click', function () {
    var key = sync.generateKey();
    $('sync-generated-key').value = key.nsec;
    $('sync-generated').hidden = false;
    $('sync-generated-key').select();
  });

  $('sync-generated-use').addEventListener('click', function (e) {
    var nsec = $('sync-generated-key').value;
    startSync(e.currentTarget, 'Starting…', function () { return sync.useKey(nsec); });
  });

  $('sync-key-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var value = $('sync-key-input').value;
    if (!value.trim()) { $('sync-key-input').focus(); return; }
    startSync(e.currentTarget.querySelector('button'), 'Connecting…', function () { return sync.useKey(value); })
      .then(function () { $('sync-key-input').value = ''; });
  });

  $('sync-extension').addEventListener('click', function (e) {
    startSync(e.currentTarget, 'Waiting for extension…', function () { return sync.useExtension(); });
  });

  $('sync-bunker-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var value = $('sync-bunker-input').value;
    if (!value.trim()) { $('sync-bunker-input').focus(); return; }
    startSync(e.currentTarget.querySelector('button'), 'Waiting for bunker…', function () { return sync.useBunker(value); });
  });

  $('sync-now').addEventListener('click', function (e) {
    showSyncError('');
    busy(e.currentTarget, 'Syncing…', sync.syncNow()).catch(function () { /* shown in the status */ });
  });

  $('sync-show-key').addEventListener('click', function () {
    var reveal = $('sync-key-reveal');
    reveal.hidden = !reveal.hidden;
    $('sync-key-value').value = reveal.hidden ? '' : sync.getKey();
  });

  $('sync-signout').addEventListener('click', function () {
    var msg = 'This device will stop syncing. Your stories stay in this browser, and your synced data stays on the relays.';
    if (sync.status().method === 'key') msg += ' To sync again you’ll need your sync key, so make sure it’s saved.';
    confirmDialog('Stop syncing?', msg, 'Stop syncing').then(function (ok) {
      if (!ok) return;
      sync.signOut();
      openSyncDialog();
    });
  });

  $('sync-relays-save').addEventListener('click', function () {
    sync.setRelays($('sync-relays').value.split(/\s+/));
    $('sync-relays').value = sync.status().relays.join('\n');
    toast('Relays saved');
  });
  $('sync-relays-reset').addEventListener('click', function () {
    $('sync-relays').value = sync.DEFAULT_RELAYS.join('\n');
  });

  // --- Settings -----------------------------------------------------------

  var settingsDialog = $('settings-dialog');

  function openSettingsDialog() {
    renderThemes();
    renderDeleteOptions();
    if (!settingsDialog.open) settingsDialog.showModal();
  }

  function renderThemes() {
    var grid = $('theme-grid');
    var current = settings.theme();
    grid.textContent = '';
    settings.THEMES.forEach(function (t) {
      var input = h('input', { type: 'radio', name: 'theme', value: t.id, checked: t.id === current, class: 'sr-only' });
      input.addEventListener('change', function () { settings.setTheme(t.id); });
      grid.appendChild(h('label', { class: 'theme-option', 'data-theme-option': t.id }, [
        input,
        h('span', {
          class: 'theme-preview', 'aria-hidden': 'true',
          style: '--p0:' + t.preview[0] + ';--p1:' + t.preview[1] + ';--p2:' + t.preview[2]
        }, [h('span'), h('span'), h('span')]),
        h('span', { class: 'theme-name', text: t.label })
      ]));
    });
  }

  function renderDeleteOptions() {
    var connected = sync.status().connected;
    settingsDialog.querySelector('[data-delete="synced"]').disabled = !connected;
    $('delete-synced-text').textContent = connected
      ? 'Erases the synced copy from the relays and stops syncing on this device. Stories in this browser are kept.'
      : 'Sync isn’t set up on this device, so there’s no synced data to delete from here.';
    $('delete-local-text').textContent = connected
      ? 'Clears this browser’s storage, then downloads your synced data again.'
      : 'Clears this browser’s storage. Sync isn’t set up, so nothing will be downloaded again.';
  }

  $('settings-btn').addEventListener('click', openSettingsDialog);

  var DELETE_TITLES = { all: 'Delete all data?', synced: 'Delete synced data?', local: 'Delete local data?' };

  settingsDialog.querySelector('.delete-list').addEventListener('click', function (e) {
    var button = e.target.closest('[data-delete]');
    if (!button) return;
    var kind = button.getAttribute('data-delete');
    confirmDialog(DELETE_TITLES[kind], 'Note: Deleting data is permanent and irreversible. Continue?', 'Delete').then(function (ok) {
      if (!ok) return;
      var label = button.textContent;
      busy(button, 'Deleting…', deleteData(kind)).catch(function (err) {
        toast((err && err.message) || label + ' failed.');
      });
    });
  });

  /** Remove this app's keys from localStorage, except those listed in `keep`. */
  function clearLocalStorage(keep) {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach(function (k) {
        if (k.indexOf('storyOutlineTool.') === 0 && keep.indexOf(k) < 0) localStorage.removeItem(k);
      });
    } catch (err) { /* storage unavailable */ }
  }

  function deleteData(kind) {
    var connected = sync.status().connected;
    if (kind === 'all') {
      return (connected ? sync.deleteRemote() : Promise.resolve()).then(function () {
        clearLocalStorage([]);
        location.reload();
      });
    }
    if (kind === 'synced') {
      return sync.deleteRemote().then(function () {
        renderDeleteOptions();
        toast('Synced data deleted. This device has stopped syncing.');
      });
    }
    // local
    clearLocalStorage([sync.ACCOUNT_KEY]);
    settings.apply();
    store.resetDatabase();
    renderThemes();
    if (!connected) {
      toast('Local data deleted');
      return Promise.resolve();
    }
    return sync.pull().then(function () {
      toast('Local data deleted and synced data downloaded again');
    }, function (err) {
      throw new Error('Local data was deleted, but downloading your synced data failed: ' +
        ((err && err.message) || 'unknown error') + ' Use “Sync now” to try again.');
    });
  }

  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || isTyping(document.activeElement) || document.querySelector('dialog[open]')) return;
    var k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); if (store.undo()) announce('Undone'); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); if (store.redo()) announce('Redone'); }
  });

  // Highlight every appearance of a chapter (outline + subplots) on hover/focus.
  function linkHighlight(e) {
    var card = e.target.closest && e.target.closest('.card, .tile-chapter');
    var id = card && e.type !== 'mouseout' && e.type !== 'focusout' ? card.dataset.chapterId : null;
    board.querySelectorAll('.is-linked').forEach(function (c) {
      if (c.dataset.chapterId !== id) c.classList.remove('is-linked');
    });
    if (!id || document.body.classList.contains('is-dragging')) return;
    var all = board.querySelectorAll('.card[data-chapter-id="' + id + '"], .tile-chapter[data-chapter-id="' + id + '"]');
    if (all.length > 1) all.forEach(function (c) { c.classList.add('is-linked'); });
  }
  ['mouseover', 'mouseout', 'focusin', 'focusout'].forEach(function (t) { board.addEventListener(t, linkHighlight); });

  // ---------------------------------------------------------------------------
  // Boot

  store.init();
  store.subscribe(function () { closeMenu(); render(); });
  sync.init();
  dragApi = global.SOT.initDrag(board, { onDrop: handleDrop, dragIds: dragIds });
  render();
})(window);
