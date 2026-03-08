(function () {
  'use strict';

  function getAlbumId() {
    var path = window.location.pathname;
    var match = path.match(/\/haber\/([^/]+)/);
    if (match) return match[1];
    var params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  function formatViewCount(num) {
    if (num >= 1e6) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + ' M';
    if (num >= 1e3) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + ' K';
    return String(num);
  }

  function formatDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (_) {
      return iso;
    }
  }

  function init() {
    var id = getAlbumId();
    var loading = document.getElementById('loading');
    var article = document.getElementById('article');
    var errorEl = document.getElementById('error');

    if (!id) {
      if (loading) loading.classList.add('hidden');
      if (errorEl) { errorEl.classList.remove('hidden'); errorEl.querySelector('p').textContent = 'Geçersiz haber adresi.'; }
      return;
    }

    var idEnc = encodeURIComponent(id);
    var apiUrl = '/api/albums/' + idEnc;
    var viewRecordedThisLoad = false;

    function getArticle() {
      return fetch(apiUrl, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('Haber bulunamadı.');
        var ct = (res.headers.get('Content-Type') || '').toLowerCase();
        if (ct.indexOf('application/json') === -1) {
          return res.text().then(function () { throw new Error('API yanıtı alınamadı. Sunucuyu npm start ile çalıştırın.'); });
        }
        return res.json();
      });
    }

    function recordViewThenGet() {
      if (viewRecordedThisLoad) return getArticle();
      viewRecordedThisLoad = true;
      return fetch(apiUrl + '/view', { method: 'POST', cache: 'no-store' })
        .then(function (r) { return getArticle(); })
        .catch(function () { viewRecordedThisLoad = false; return getArticle(); });
    }

    recordViewThenGet()
      .then(function (data) {
        if (loading) loading.classList.add('hidden');
        if (errorEl) errorEl.classList.add('hidden');
        if (!article) return;

        document.title = data.title + ' - Gelir Uzmanları';
        document.getElementById('article-image').src = data.image_url || '';
        document.getElementById('article-image').alt = data.title || '';
        document.getElementById('article-category').textContent = data.category || '';
        document.getElementById('article-title').textContent = data.title || '';
        document.getElementById('article-views').innerHTML = '👁️ ' + formatViewCount(data.view_count || 0);
        document.getElementById('article-date').textContent = formatDate(data.created_at);
        document.getElementById('article-date').setAttribute('datetime', data.created_at || '');

        var contentEl = document.getElementById('article-content');
        if (data.content) {
          contentEl.innerHTML = data.content;
        } else {
          contentEl.innerHTML = '<p>İçerik mevcut değil.</p>';
        }
        article.classList.remove('hidden');
      })
      .catch(function () {
        if (loading) loading.classList.add('hidden');
        if (article) article.classList.add('hidden');
        if (errorEl) errorEl.classList.remove('hidden');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
