(function () {
  'use strict';

  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatViewCount(num) {
    if (num >= 1e6) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(num);
  }

  var listEl = document.getElementById('trending-list');
  if (listEl) {
    fetch('/api/trending', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Yüklenemedi')); })
      .then(function (data) {
        var list = Array.isArray(data) ? data : [];
        listEl.innerHTML = '';
        if (list.length === 0) {
          listEl.innerHTML = '<li class="px-6 py-8 text-center text-[var(--color-text)]">Henüz veri yok.</li>';
        } else {
          list.forEach(function (album, index) {
            var views = formatViewCount(album.view_count || 0);
            var url = '/haber/' + encodeURIComponent(album.id);
            var date = album.created_at ? new Date(album.created_at).toLocaleDateString('tr-TR') : '';
            var html =
              '<li class="trend-item px-6 py-4">' +
              '<a href="' + escapeHtml(url) + '" class="block group">' +
              '<span class="text-sm font-semibold text-gray-400 tabular-nums">' + (index + 1) + '.</span> ' +
              '<span class="text-base font-medium text-[var(--color-heading)] group-hover:text-[var(--color-accent)] transition-colors">' + escapeHtml(album.title) + '</span>' +
              '<div class="flex items-center gap-4 mt-1 text-sm text-[var(--color-text)]">' +
              '<span>👁️ ' + views + ' görüntülenme</span>' +
              (date ? '<time datetime="' + escapeHtml(album.created_at) + '">' + escapeHtml(date) + '</time>' : '') +
              '</div>' +
              '</a>' +
              '</li>';
            listEl.insertAdjacentHTML('beforeend', html);
          });
        }
      })
      .catch(function () {
        listEl.innerHTML = '<li class="px-6 py-8 text-center text-red-600">Liste yüklenemedi. Lütfen tekrar deneyin.</li>';
      });
  }
})();
