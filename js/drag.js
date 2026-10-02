/*
 * Story Outline Tool — pointer-based drag and drop for chapter cards.
 *
 * Uses pointer events (not the HTML5 drag API) so it works with mouse, pen
 * and touch. With a mouse or pen, a card can be dragged from anywhere; on
 * touch screens it is dragged by its grip so the columns still scroll.
 *
 * Lists are elements with a `data-list` attribute ("main" or "sub:<id>").
 * Cards are `.card` elements with a `data-chapter-id` attribute.
 * Collapsed subplot cards (`.subplot-tile`, `data-drop="tile"`) also accept
 * drops; they have no positions, so the drop is reported with `tile: true`.
 * The matrix view (`data-layout="matrix"`) is a 2-D snake: instead of a gap,
 * the drop position is shown as a bar before or after the nearest card.
 *
 * `options.dragIds(card)` may return several chapter ids (a multi-selection
 * in the card's list); they are dragged together and reported as
 * `chapterIds` in `options.onDrop`.
 */
(function (global) {
  'use strict';

  var THRESHOLD = 5;
  var EDGE = 56;
  var MAX_SPEED = 18;

  function initDrag(board, options) {
    var pending = null;   // pointer is down, drag not started yet
    var drag = null;      // active drag
    var suppressClick = false;

    board.addEventListener('pointerdown', function (e) {
      if (drag || e.button !== 0) return;
      var card = e.target.closest('.card');
      if (!card || !board.contains(card)) return;
      if (e.target.closest('button, input, select, textarea, a')) return;
      if (e.pointerType === 'touch' && !e.target.closest('.card-grip')) return;
      pending = { card: card, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    });

    document.addEventListener('pointermove', function (e) {
      if (pending && e.pointerId === pending.pointerId) {
        if (Math.abs(e.clientX - pending.x) + Math.abs(e.clientY - pending.y) < THRESHOLD) return;
        start(pending.card, e);
        pending = null;
      }
      if (drag && e.pointerId === drag.pointerId) {
        e.preventDefault();
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.copy = e.ctrlKey || e.metaKey || e.altKey;
        moveGhost();
        updateTarget();
      }
    }, { passive: false });

    document.addEventListener('pointerup', function (e) {
      pending = null;
      if (drag && e.pointerId === drag.pointerId) finish(true);
    });
    document.addEventListener('pointercancel', function (e) {
      pending = null;
      if (drag && e.pointerId === drag.pointerId) finish(false);
    });
    document.addEventListener('keydown', function (e) {
      if (drag && e.key === 'Escape') { e.preventDefault(); finish(false); }
      if (drag && (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt')) { drag.copy = true; updateTarget(); }
    });
    document.addEventListener('keyup', function (e) {
      if (drag && (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt')) { drag.copy = false; updateTarget(); }
    });

    // Swallow the click that follows a drag so it doesn't open the editor.
    board.addEventListener('click', function (e) {
      if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
    }, true);

    function start(card, e) {
      var rect = card.getBoundingClientRect();
      var ghost = card.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.classList.remove('is-selected', 'is-linked', 'drop-left', 'drop-right');
      ghost.removeAttribute('id');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = rect.width + 'px';
      document.body.appendChild(ghost);

      var placeholder = document.createElement('li');
      placeholder.className = 'drop-placeholder';
      placeholder.style.height = rect.height + 'px';

      var sourceList = card.closest('[data-list]');
      var ids = (options.dragIds && options.dragIds(card)) || [card.dataset.chapterId];
      if (ids.indexOf(card.dataset.chapterId) < 0) ids = [card.dataset.chapterId];
      var cards = Array.prototype.filter.call(sourceList.querySelectorAll('.card'), function (c) {
        return ids.indexOf(c.dataset.chapterId) >= 0;
      });
      if (ids.length > 1) {
        ghost.classList.add('is-multi');
        var badge = document.createElement('span');
        badge.className = 'drag-count';
        badge.textContent = String(ids.length);
        ghost.appendChild(badge);
      }

      drag = {
        card: card,
        cards: cards,
        ids: ids,
        sourceList: sourceList,
        ghost: ghost,
        placeholder: placeholder,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
        copy: e.ctrlKey || e.metaKey || e.altKey,
        targetList: null,
        index: -1,
        raf: 0
      };
      cards.forEach(function (c) { c.classList.add('is-drag-source'); });
      document.body.classList.add('is-dragging');
      try { card.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ }
      moveGhost();
      updateTarget();
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function moveGhost() {
      drag.ghost.style.transform =
        'translate(' + (drag.x - drag.offsetX) + 'px,' + (drag.y - drag.offsetY) + 'px) rotate(1.5deg)';
    }

    function listAt(x, y) {
      var el = document.elementFromPoint(x, y);
      if (!el || !board.contains(el)) return null;
      var tile = el.closest('.subplot-tile');
      if (tile) return tile;
      var matrix = el.closest('[data-layout="matrix"]');
      if (matrix) return matrix;
      var column = el.closest('.column');
      return column ? column.querySelector('[data-list]') : null;
    }

    /** The element to highlight for a drop target: its column, or the tile itself. */
    function targetBox(list) { return list.closest('.column, .subplot-tile, .matrix') || list; }

    /** Hide the dragged cards (same-list moves, so the gap shows the new spot) or show them again. */
    function hideSources(hidden) {
      drag.cards.forEach(function (c) { c.classList.toggle('is-hidden', hidden); });
    }

    function isDragged(c) { return drag.ids.indexOf(c.dataset.chapterId) >= 0; }

    function clearMarker() {
      if (drag && drag.marker) {
        drag.marker.classList.remove('drop-left', 'drop-right');
        drag.marker = null;
      }
    }

    /** Matrix drop position: before or after the card nearest the pointer, in story order. */
    function matrixTarget(list) {
      drag.placeholder.remove();
      hideSources(false);
      drag.ghost.classList.remove('is-copy');
      var cards = Array.prototype.filter.call(list.querySelectorAll('.card'), function (c) { return !isDragged(c); });
      if (!cards.length) { drag.index = 0; return; }
      var best = 0;
      var bestDist = Infinity;
      cards.forEach(function (c, i) {
        var r = c.getBoundingClientRect();
        var dx = Math.max(r.left - drag.x, 0, drag.x - r.right);
        var dy = Math.max(r.top - drag.y, 0, drag.y - r.bottom);
        var dist = dx * dx + 4 * dy * dy; // prefer the pointer's own row
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      var card = cards[best];
      var r = card.getBoundingClientRect();
      var reversed = !!card.closest('.is-reversed');
      var before = reversed ? drag.x > r.left + r.width / 2 : drag.x < r.left + r.width / 2;
      drag.index = best + (before ? 0 : 1);
      // The bar goes on the side of the card that faces the drop position on screen.
      var leftSide = before !== reversed;
      card.classList.add(leftSide ? 'drop-left' : 'drop-right');
      drag.marker = card;
    }

    function updateTarget() {
      var list = listAt(drag.x, drag.y);
      var src = drag.sourceList.dataset.list;
      clearMarker();

      if (list !== drag.targetList) {
        if (drag.targetList) targetBox(drag.targetList).classList.remove('is-drop-target');
        drag.targetList = list;
        if (list) targetBox(list).classList.add('is-drop-target');
      }

      if (!list) {
        drag.placeholder.remove();
        hideSources(false);
        drag.ghost.classList.remove('is-copy');
        drag.index = -1;
        return;
      }

      var dst = list.dataset.list;
      if (list.dataset.layout === 'matrix') { matrixTarget(list); return; }
      if (list.dataset.drop === 'tile') {
        // A collapsed subplot: no positions to show, just highlight it.
        drag.placeholder.remove();
        hideSources(false);
        drag.ghost.classList.toggle('is-copy', dst !== src && (src === 'main' || drag.copy));
        drag.index = 0;
        return;
      }
      // Moving within the same list: hide the original so the gap shows its new spot.
      var sameList = dst === src;
      // A single card is lifted out so the gap shows its new spot. A group stays
      // in place (dimmed): collapsing several cards would shift the list under
      // the pointer.
      hideSources(sameList && drag.ids.length === 1);
      // Dropping into a subplot from elsewhere adds the chapter there.
      var adds = !sameList && dst !== 'main' && (src === 'main' || drag.copy);
      drag.ghost.classList.toggle('is-copy', adds);

      var cards = Array.prototype.filter.call(list.children, function (c) {
        return c.classList.contains('card') && !isDragged(c);
      });
      var index = cards.length;
      for (var i = 0; i < cards.length; i++) {
        var r = cards[i].getBoundingClientRect();
        if (drag.y < r.top + r.height / 2) { index = i; break; }
      }
      drag.index = index;
      var before = cards[index] || null;
      if (drag.placeholder.parentNode !== list || drag.placeholder.nextSibling !== before) {
        list.insertBefore(drag.placeholder, before);
      }
    }

    function autoScroll() {
      if (!drag) return;
      var b = board.getBoundingClientRect();
      var dx = 0;
      if (drag.x < b.left + EDGE) dx = -speed(b.left + EDGE - drag.x);
      else if (drag.x > b.right - EDGE) dx = speed(drag.x - (b.right - EDGE));
      if (dx) board.scrollLeft += dx;

      var dy = 0;
      var list = drag.targetList;
      if (list && list.dataset.drop !== 'tile') {
        var r = list.getBoundingClientRect();
        if (drag.y < r.top + EDGE) dy = -speed(r.top + EDGE - drag.y);
        else if (drag.y > r.bottom - EDGE) dy = speed(drag.y - (r.bottom - EDGE));
        if (dy) list.scrollTop += dy;
      }
      if (dx || dy) updateTarget();
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function speed(distance) {
      return Math.ceil(Math.min(1, distance / EDGE) * MAX_SPEED);
    }

    function finish(commit) {
      clearMarker();
      var d = drag;
      drag = null;
      cancelAnimationFrame(d.raf);
      d.ghost.remove();
      d.placeholder.remove();
      d.cards.forEach(function (c) { c.classList.remove('is-drag-source', 'is-hidden'); });
      if (d.targetList) targetBox(d.targetList).classList.remove('is-drop-target');
      document.body.classList.remove('is-dragging');
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 0);

      if (commit && d.targetList && d.index >= 0) {
        options.onDrop({
          chapterIds: d.ids,
          from: d.sourceList.dataset.list,
          to: d.targetList.dataset.list,
          index: d.index,
          tile: d.targetList.dataset.drop === 'tile',
          copy: d.copy
        });
      }
    }

    return {
      isDragging: function () { return !!drag; }
    };
  }

  global.SOT = global.SOT || {};
  global.SOT.initDrag = initDrag;
})(window);
