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
        item.hint ? h('span', { class: 'menu-hint', text: item.hint }) : null,
        item.badge ? h('span', { class: 'menu-badge', text: item.badge }) : null
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
    if (focusKey) {
      var el = document.querySelector('[data-focus-key="' + CSS.escape(focusKey) + '"]');
      if (el) el.focus({ preventScroll: false });
    }

    $('undo-btn').disabled = !store.canUndo();
    $('redo-btn').disabled = !store.canRedo();
    var err = store.saveError();
    var status = $('save-status');
    status.textContent = err ? 'Not saved — storage unavailable' : 'Saved in this browser';
    status.classList.toggle('is-error', !!err);

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
    board.textContent = '';
    board.dataset.tabId = tab.id;

    // Which subplots each chapter belongs to, for the tags on outline cards.
    var memberOf = {};
    tab.subplots.forEach(function (sp, i) {
      sp.chapterIds.forEach(function (id) {
        (memberOf[id] = memberOf[id] || []).push({ sp: sp, letter: store.letterFor(i) });
      });
    });

    board.appendChild(renderMainColumn(tab, memberOf));
    var subplots = h('div', { class: 'subplots' });
    tab.subplots.forEach(function (sp, i) { subplots.appendChild(renderSubplotColumn(tab, sp, i)); });
    subplots.appendChild(h('button', {
      type: 'button', class: 'add-subplot', dataset: { focusKey: 'add-subplot' },
      onclick: function () {
        var id = store.addSubplot(tab.id);
        var col = board.querySelector('[data-subplot-id="' + id + '"]');
        if (col) col.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
        announce('Subplot added');
      }
    }, [icon(ICONS.plus), h('span', { text: 'Add subplot' })]));
    board.appendChild(subplots);
  }

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
        h('div', { class: 'column-sub', text: summary })
      ]),
      list,
      h('footer', { class: 'column-footer' }, [quickAdd(tab, null)])
    ]);
  }

  function renderSubplotColumn(tab, sp, index) {
    var letter = store.letterFor(index);
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
        number: letter + (i + 1),
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
      style: '--accent:' + sp.color, 'aria-label': 'Subplot ' + letter + ': ' + sp.name
    }, [
      h('header', { class: 'column-header' }, [
        h('div', { class: 'column-title-row' }, [
          h('span', { class: 'subplot-badge', text: letter, 'aria-hidden': 'true' }),
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
    if (ctx.tags && ctx.tags.length) {
      meta.push(h('span', { class: 'card-tags' }, ctx.tags.map(function (t) {
        return h('span', { class: 'tag', style: '--tag:' + t.sp.color, title: t.sp.name, text: t.letter });
      })));
    }

    var label = (inSubplot ? ctx.number + ', chapter ' + ctx.chapterNumber : 'Chapter ' + ctx.number) +
      ': ' + ch.name + ', ' + STATE_LABELS[ch.state];

    return h('li', {
      class: 'card', tabindex: '0', role: 'button', 'aria-label': label,
      'aria-keyshortcuts': 'Enter Alt+ArrowUp Alt+ArrowDown',
      dataset: { chapterId: ch.id, state: ch.state, focusKey: 'card:' + ctx.list + ':' + ch.id },
      onclick: function () { openChapterDialog(tab.id, ch.id); },
      onkeydown: function (e) { cardKeydown(e, tab, ch, ctx); }
    }, [
      h('span', { class: 'card-grip', title: 'Drag to move' }, [icon(ICONS.grip)]),
      h('span', { class: 'card-num', text: ctx.number }),
      h('div', { class: 'card-body' }, [
        h('div', { class: 'card-title', text: ch.name }),
        h('div', { class: 'card-meta' }, meta),
        ch.summary ? h('p', { class: 'card-summary', text: ch.summary }) : null
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
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openChapterDialog(tab.id, ch.id);
      return;
    }
    if (ctx.subplotId && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      var next = e.currentTarget.nextElementSibling || e.currentTarget.previousElementSibling;
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
    var ch = tab.chapters[d.chapterId];
    if (!ch) return;
    if (d.to === 'main') {
      store.moveChapter(tab.id, d.chapterId, d.index);
      announce('Moved “' + ch.name + '” to chapter ' + (d.index + 1));
      return;
    }
    var toId = d.to.slice(4);
    var fromId = d.from.indexOf('sub:') === 0 ? d.from.slice(4) : null;
    var sp = store.getSubplot(tab.id, toId);
    var wasIn = sp && sp.chapterIds.indexOf(d.chapterId) >= 0;
    // Between subplots a drag moves the chapter; hold Ctrl/⌘/Alt to copy it instead.
    store.placeInSubplot(tab.id, toId, d.chapterId, d.index, d.copy ? null : fromId);
    if (sp) announce((wasIn ? 'Moved “' : 'Added “') + ch.name + '” in ' + sp.name);
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
    // Click on the backdrop closes the dialog.
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
  })();

  function openChapterDialog(tabId, chapterId) {
    var tab = store.getTab(tabId);
    var ch = tab && tab.chapters[chapterId];
    if (!ch) return;
    editing = { tabId: tabId, chapterId: chapterId, returnFocus: document.activeElement };

    $('chapter-dialog-number').textContent = 'Chapter ' + (tab.order.indexOf(chapterId) + 1) + ' of ' + tab.order.length;
    $('chapter-name').value = ch.name;
    $('chapter-state').value = ch.state;
    $('chapter-summary').value = ch.summary || '';

    var checks = $('chapter-subplots');
    checks.textContent = '';
    if (!tab.subplots.length) {
      checks.appendChild(h('p', { class: 'field-hint', text: 'No subplots yet. Add one from the board.' }));
    }
    tab.subplots.forEach(function (sp, i) {
      var pos = sp.chapterIds.indexOf(chapterId);
      checks.appendChild(h('label', { class: 'subplot-check', style: '--accent:' + sp.color }, [
        h('input', { type: 'checkbox', value: sp.id, checked: pos >= 0 }),
        h('span', { class: 'subplot-badge', text: store.letterFor(i), 'aria-hidden': 'true' }),
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

  $('data-btn').addEventListener('click', function (e) {
    var items = [{ note: 'Your stories are saved automatically in this browser’s local storage.' }, { separator: true }];
    io.features.forEach(function (f) {
      items.push({ label: f.label, title: f.description, badge: 'Soon', disabled: true, onSelect: function () {} });
    });
    openMenu(e.currentTarget, items);
  });

  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || isTyping(document.activeElement) || document.querySelector('dialog[open]')) return;
    var k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); if (store.undo()) announce('Undone'); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); if (store.redo()) announce('Redone'); }
  });

  // Highlight every appearance of a chapter (outline + subplots) on hover/focus.
  function linkHighlight(e) {
    var card = e.target.closest && e.target.closest('.card');
    var id = card && e.type !== 'mouseout' && e.type !== 'focusout' ? card.dataset.chapterId : null;
    board.querySelectorAll('.card.is-linked').forEach(function (c) {
      if (c.dataset.chapterId !== id) c.classList.remove('is-linked');
    });
    if (!id || document.body.classList.contains('is-dragging')) return;
    var all = board.querySelectorAll('.card[data-chapter-id="' + id + '"]');
    if (all.length > 1) all.forEach(function (c) { c.classList.add('is-linked'); });
  }
  ['mouseover', 'mouseout', 'focusin', 'focusout'].forEach(function (t) { board.addEventListener(t, linkHighlight); });

  // ---------------------------------------------------------------------------
  // Boot

  store.init();
  store.subscribe(function () { closeMenu(); render(); });
  global.SOT.initDrag(board, { onDrop: handleDrop });
  render();
})(window);
