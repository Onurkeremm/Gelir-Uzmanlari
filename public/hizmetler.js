(function () {
  'use strict';

  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function createHizmetCard(h) {
    var url = '/hizmet/' + encodeURIComponent(h.id);
    var gorselHtml = (h.gorsel && h.gorsel.trim()) ? '<img src="' + escapeHtml(h.gorsel) + '" alt="' + escapeHtml(h.baslik) + '" class="w-full h-40 object-cover rounded-t-xl">' : '';
    var ikonHtml = (h.ikon && !gorselHtml) ? '<span class="text-4xl">' + escapeHtml(h.ikon) + '</span>' : (h.ikon ? '<span class="text-2xl">' + escapeHtml(h.ikon) + '</span>' : '');
    var ozet = (h.aciklama || '').replace(/<[^>]+>/g, '').trim().slice(0, 120);
    if (ozet.length === 120) ozet += '…';
    return (
      '<a href="' + escapeHtml(url) + '" class="block hizmet-card bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden transition-all duration-300">' +
      (gorselHtml || '<div class="h-32 bg-[#f8faff] flex items-center justify-center">' + ikonHtml + '</div>') +
      (gorselHtml && ikonHtml ? '<div class="px-4 pt-2 text-2xl">' + ikonHtml + '</div>' : '') +
      '<div class="p-5">' +
      '<h3 class="font-bold text-lg text-[#1E293B]">' + escapeHtml(h.baslik) + '</h3>' +
      '<p class="text-sm text-[#475569] mt-1 line-clamp-3">' + escapeHtml(ozet) + '</p>' +
      '<span class="inline-block mt-3 text-sm text-[var(--color-accent)] font-medium">Detayları görüntüle →</span>' +
      '</div></a>'
    );
  }

  var grid = document.getElementById('hizmetler-grid');
  if (grid) {
    fetch('/api/hizmetler')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Yüklenemedi')); })
      .then(function (data) {
        var list = Array.isArray(data) ? data : [];
        list.sort(function (a, b) { return (a.sira || 0) - (b.sira || 0); });
        var loading = document.getElementById('loading');
        if (loading) loading.remove();
        if (list.length === 0) {
          grid.innerHTML = '<p class="col-span-full text-center text-[var(--color-text)] py-12">Henüz hizmet bulunmuyor.</p>';
        } else {
          list.forEach(function (h) {
            if (h.aktif !== false) grid.insertAdjacentHTML('beforeend', createHizmetCard(h));
          });
        }
      })
      .catch(function () {
        var loading = document.getElementById('loading');
        if (loading) loading.remove();
        grid.innerHTML = '<p class="col-span-full text-center text-red-600 py-12">Hizmetler yüklenemedi. Lütfen tekrar deneyin.</p>';
      });
  }
})();
