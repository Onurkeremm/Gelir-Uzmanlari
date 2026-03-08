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

  function createAlbumCard(album, index) {
    var views = formatViewCount(album.view_count || 0);
    var url = '/haber/' + encodeURIComponent(album.id);
    return (
      '<a href="' + escapeHtml(url) + '" class="block group">' +
      '<article class="album-card bg-white overflow-hidden transition-all duration-300 group-hover:shadow-[0_4px_12px_rgba(10,25,41,0.08)]">' +
      '<div class="card-image-wrap overflow-hidden bg-gray-100">' +
      '<img src="' + escapeHtml(album.image_url) + '" alt="' + escapeHtml(album.title) + '" class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" loading="lazy" />' +
      '</div>' +
      '<div class="card-body-wrap">' +
      '<div>' +
      '<span class="inline-block text-xs font-medium px-2.5 py-1 rounded-md bg-[#f8faff] text-[#0066CC] mb-2">' + escapeHtml(album.category) + '</span>' +
      '<h3 class="font-bold text-[#1E293B] leading-snug line-clamp-2 group-hover:text-[#0066CC] transition-colors">' + escapeHtml(album.title) + '</h3>' +
      '</div>' +
      '<div class="flex items-center gap-1 mt-2 text-sm text-[#475569]">' +
      '<span aria-hidden="true">👁️</span>' +
      '<span>' + views + '</span>' +
      '</div>' +
      '</div>' +
      '</article>' +
      '</a>'
    );
  }

  var grid = document.getElementById('albums-grid');
  if (grid) {
    fetch('/api/albums', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Yüklenemedi')); })
      .then(function (data) {
        var list = Array.isArray(data) ? data : [];
        list.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
        var loading = document.getElementById('loading-cards');
        if (loading) loading.remove();
        if (list.length === 0) {
          grid.innerHTML = '<p class="col-span-full text-center text-[var(--color-text)] py-12">Henüz haber bulunmuyor.</p>';
        } else {
          list.forEach(function (album, i) {
            grid.insertAdjacentHTML('beforeend', createAlbumCard(album, i));
          });
        }
      })
      .catch(function () {
        var loading = document.getElementById('loading-cards');
        if (loading) loading.remove();
        grid.innerHTML = '<p class="col-span-full text-center text-red-600 py-12">Haberler yüklenemedi. Lütfen tekrar deneyin.</p>';
      });
  }
})();
