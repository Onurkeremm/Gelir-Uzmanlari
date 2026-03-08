(function () {
  'use strict';

  function getHizmetId() {
    var path = window.location.pathname || '';
    var parts = path.split('/').filter(Boolean);
    if (parts[0] === 'hizmet' && parts[1]) return decodeURIComponent(parts[1]);
    return null;
  }

  var loading = document.getElementById('loading');
  var article = document.getElementById('hizmet-article');
  var errorEl = document.getElementById('hizmet-error');
  var imageWrap = document.getElementById('hizmet-image-wrap');
  var imageEl = document.getElementById('hizmet-image');
  var ikonWrap = document.getElementById('hizmet-ikon-wrap');
  var titleEl = document.getElementById('hizmet-title');
  var contentEl = document.getElementById('hizmet-content');
  var linkBtn = document.getElementById('hizmet-link-btn');

  var id = getHizmetId();
  if (!id) {
    if (loading) loading.classList.add('hidden');
    if (errorEl) errorEl.classList.remove('hidden');
  } else {
    var viewKey = 'hizmet_view_' + id;
    function recordViewThenFetch() {
      try {
        if (sessionStorage.getItem(viewKey)) return fetch('/api/hizmetler').then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Yüklenemedi')); });
        return fetch('/api/hizmetler/' + encodeURIComponent(id) + '/view', { method: 'POST' }).then(function (r) {
          if (r.ok) try { sessionStorage.setItem(viewKey, '1'); } catch (_) {}
          return fetch('/api/hizmetler').then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('Yüklenemedi')); });
        });
      } catch (_) {
        return fetch('/api/hizmetler').then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Yüklenemedi')); });
      }
    }
    recordViewThenFetch()
      .then(function (data) {
        var list = Array.isArray(data) ? data : [];
        var h = list.find(function (x) { return String(x.id) === String(id); });
        if (loading) loading.classList.add('hidden');
        if (!h) {
          if (errorEl) errorEl.classList.remove('hidden');
          return;
        }
        if (article) article.classList.remove('hidden');
        if (document.title) document.title = (h.baslik || 'Hizmet') + ' - Gelir Uzmanları';

        if (h.gorsel && h.gorsel.trim()) {
          imageWrap.classList.remove('hidden');
          imageEl.src = h.gorsel;
          imageEl.alt = h.baslik || '';
        } else {
          imageWrap.classList.add('hidden');
        }

        if (h.ikon && h.ikon.trim()) {
          ikonWrap.innerHTML = '<span class="text-4xl"></span>';
          ikonWrap.querySelector('span').textContent = h.ikon;
          ikonWrap.classList.remove('hidden');
        } else {
          ikonWrap.classList.add('hidden');
        }

        if (titleEl) titleEl.textContent = h.baslik || '';
        if (contentEl) contentEl.innerHTML = h.aciklama || '<p class="text-[var(--color-text)]">İçerik bulunmuyor.</p>';

        if (h.link && h.link.trim()) {
          linkBtn.href = h.link;
          linkBtn.classList.remove('hidden');
        } else {
          linkBtn.classList.add('hidden');
        }
      })
      .catch(function () {
        if (loading) loading.classList.add('hidden');
        if (errorEl) errorEl.classList.remove('hidden');
      });
  }
})();
