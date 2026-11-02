// English by default (same as the game); Italian on request. The choice is remembered on this device only.
(function () {
  var KEY = 'ss.site.lang';
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
  var q = new URLSearchParams(location.search).get('lang');
  var lang = q === 'it' || q === 'en' ? q : saved === 'it' ? 'it' : 'en';
  function apply(l) {
    document.documentElement.lang = l;
    var dict = window.SS_I18N || {};
    document.querySelectorAll('[data-i]').forEach(function (el) {
      var k = el.getAttribute('data-i');
      var v = dict[l] && dict[l][k];
      if (typeof v === 'string') el.innerHTML = v;
    });
    var t = document.querySelector('meta[name="ss-title-' + l + '"]');
    if (t) document.title = t.content;
    document.querySelectorAll('.lang button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.l === l)); });
  }
  document.addEventListener('DOMContentLoaded', function () {
    apply(lang);
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.addEventListener('click', function () {
        lang = b.dataset.l;
        try { localStorage.setItem(KEY, lang); } catch (e) { /* storage blocked */ }
        apply(lang);
      });
    });
  });
})();
