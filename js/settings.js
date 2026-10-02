/*
 * Story Outline Tool — per-browser settings (currently just the theme).
 * The theme is applied before first paint by a small inline script in
 * index.html; this module handles changing it.
 */
(function (global) {
  'use strict';

  var SETTINGS_KEY = 'storyOutlineTool.settings';
  var THEMES = [
    { id: 'light', label: 'Light', preview: ['#f3efe7', '#fffdf9', '#3b5bdb'] },
    { id: 'dark', label: 'Dark', preview: ['#151311', '#26231f', '#748ffc'] },
    { id: 'summer', label: 'Summer Waves', preview: ['#56738c', '#f6eedc', '#56738c'] },
    { id: 'sketch', label: 'Sketch', preview: ['#fbfbf6', '#ffffff', '#262626'] }
  ];

  function read() {
    try { return JSON.parse(global.localStorage.getItem(SETTINGS_KEY)) || {}; } catch (err) { return {}; }
  }

  function write(settings) {
    try { global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (err) { /* not persisted */ }
  }

  function systemTheme() {
    return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function isTheme(id) { return THEMES.some(function (t) { return t.id === id; }); }

  /** The chosen theme, or the light/dark one matching the system if none was chosen. */
  function theme() {
    var t = read().theme;
    return isTheme(t) ? t : systemTheme();
  }

  function apply() { document.documentElement.setAttribute('data-theme', theme()); }

  function setTheme(id) {
    if (!isTheme(id)) return;
    var s = read();
    s.theme = id;
    write(s);
    apply();
  }

  // Follow system light/dark changes until a theme has been picked.
  if (global.matchMedia) {
    var mq = global.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { if (!isTheme(read().theme)) apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
  }

  /**
   * Board layout on wide screens: "columns" (every subplot a column), "cards"
   * (one subplot a column, the rest cards) or "matrix" (the outline only, as a
   * snake of cards).
   */
  var VIEWS = ['columns', 'cards', 'matrix'];
  function view() { var v = read().view; return VIEWS.indexOf(v) >= 0 ? v : 'columns'; }

  function setView(v) {
    var s = read();
    s.view = VIEWS.indexOf(v) >= 0 ? v : 'columns';
    write(s);
  }

  /** In cards view, the subplot shown as a full column, per story tab. */
  function focusedSubplot(tabId) {
    var f = read().focus;
    return f && typeof f[tabId] === 'string' ? f[tabId] : null;
  }

  function setFocusedSubplot(tabId, subplotId) {
    var s = read();
    s.focus = s.focus && typeof s.focus === 'object' ? s.focus : {};
    s.focus[tabId] = subplotId;
    write(s);
  }

  global.SOT = global.SOT || {};
  global.SOT.settings = {
    SETTINGS_KEY: SETTINGS_KEY,
    THEMES: THEMES,
    theme: theme,
    setTheme: setTheme,
    apply: apply,
    view: view,
    setView: setView,
    focusedSubplot: focusedSubplot,
    setFocusedSubplot: setFocusedSubplot
  };
})(window);
