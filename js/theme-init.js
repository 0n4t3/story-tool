// Apply the saved theme before first paint (see js/settings.js). Loaded
// synchronously in <head>; kept as a file so the page can forbid inline scripts.
(function () {
  var themes = ['light', 'dark', 'summer', 'sketch'];
  var t = null;
  try { t = (JSON.parse(localStorage.getItem('storyOutlineTool.settings')) || {}).theme; } catch (e) { t = null; }
  if (themes.indexOf(t) < 0) t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
