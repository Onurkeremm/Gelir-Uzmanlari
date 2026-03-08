(function () {
  'use strict';

  var BASE = (typeof window !== 'undefined' && window.BASE_PATH) ? window.BASE_PATH : '';

  const API = {
    albums: BASE + '/api/albums',
    trending: BASE + '/api/trending',
  };

  function safeJson(res) {
    var ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (ct.indexOf('application/json') === -1) {
      return res.text().then(function () {
        var isLocal = typeof window !== 'undefined' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test((window.location && window.location.origin) || '');
        throw new Error(isLocal
          ? 'API yanıtı alınamadı. Sunucuyu "npm start" ile çalıştırıp http://localhost:3000 adresini kullanın.'
          : 'API yanıtı alınamadı. Sunucunun çalıştığından ve doğru adreste yayınlandığından emin olun.');
      });
    }
    return res.json();
  }

  function formatViewCount(num) {
    if (num >= 1e6) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(num);
  }

  function createAlbumCard(album, index) {
    const views = formatViewCount(album.view_count || 0);
    const url = BASE + '/haber/' + encodeURIComponent(album.id);
    const stagger = 'stagger-' + ((index % 3) + 1);
    return (
      '<a href="' + escapeHtml(url) + '" class="block group opacity-0 animate-fade-in ' + stagger + '">' +
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

  function createTrendingItem(album, index) {
    const views = formatViewCount(album.view_count || 0);
    const url = BASE + '/haber/' + encodeURIComponent(album.id);
    return (
      '<li class="px-5 py-3 hover:bg-[#f8faff] transition-colors">' +
      '<a href="' + escapeHtml(url) + '" class="block group">' +
      '<span class="text-xs font-semibold text-gray-400 tabular-nums">' + (index + 1) + '.</span>' +
      '<span class="text-sm font-medium text-[#1E293B] group-hover:text-[#0066CC] line-clamp-2 ml-1 transition-colors">' + escapeHtml(album.title) + '</span>' +
      '<span class="text-xs text-[#475569] mt-0.5 block">👁️ ' + views + '</span>' +
      '</a>' +
      '</li>'
    );
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async function loadAlbums(isRefresh) {
    const grid = document.getElementById('albums-grid');
    if (!grid) return;
    if (isRefresh) {
      grid.innerHTML = '<div id="loading-cards" class="col-span-full flex justify-center py-16"><div class="animate-pulse flex flex-col items-center gap-3"><div class="w-10 h-10 border-2 border-gray-300 border-t-[var(--color-accent)] rounded-full animate-spin"></div><span class="text-sm text-[#475569]">Güncelleniyor...</span></div></div>';
    }
    const loading = document.getElementById('loading-cards');
    try {
      const res = await fetch(API.albums, { cache: 'no-store' });
      if (!res.ok) throw new Error('Albümler yüklenemedi.');
      const data = await safeJson(res);
      if (loading) loading.remove();
      if (!data.length) {
        grid.insertAdjacentHTML('beforeend', '<p class="col-span-full text-[#475569] text-center py-12">Henüz haber yok.</p>');
        return;
      }
      data.forEach(function (album, index) {
        grid.insertAdjacentHTML('beforeend', createAlbumCard(album, index));
      });
    } catch (err) {
      if (loading) loading.remove();
      grid.insertAdjacentHTML('beforeend', '<p class="col-span-full text-red-600 text-center py-12">İçerik yüklenirken bir hata oluştu.</p>');
      console.error(err);
    }
  }

  async function loadTrending() {
    const list = document.getElementById('trending-list');
    try {
      const res = await fetch(API.trending, { cache: 'no-store' });
      if (!res.ok) throw new Error('Trend verisi yüklenemedi.');
      const data = await safeJson(res);
      list.innerHTML = '';
      if (!data.length) {
        list.innerHTML = '<li class="px-5 py-3 text-sm text-[#475569]">Henüz veri yok.</li>';
        return;
      }
      data.forEach(function (album, i) {
        list.insertAdjacentHTML('beforeend', createTrendingItem(album, i));
      });
    } catch (err) {
      list.innerHTML = '<li class="px-5 py-3 text-sm text-red-600">Yüklenemedi.</li>';
      console.error(err);
    }
  }

  function recordSliderView(id) {
    try {
      var key = 'slider_view_' + id;
      if (sessionStorage.getItem(key)) return;
      fetch(BASE + '/api/slider/' + encodeURIComponent(id) + '/view', { method: 'POST' }).then(function () { try { sessionStorage.setItem(key, '1'); } catch (_) {} });
    } catch (_) {}
  }

  function loadSlider() {
    fetch(BASE + '/api/slider')
      .then(function (r) { return safeJson(r); })
      .then(function (list) {
        if (!list || list.length === 0) return;
        var section = document.getElementById('slider-section');
        if (!section) return;
        var html = '<div class="relative w-full overflow-hidden bg-gray-900" style="height: 400px;">';
        list.forEach(function (s, i) {
          var active = i === 0 ? ' opacity-100' : ' opacity-0';
          html += '<div class="slider-item absolute inset-0 transition-opacity duration-500' + active + '" data-slider-id="' + escapeHtml(s.id) + '"><img src="' + escapeHtml(s.resim || '') + '" alt="' + escapeHtml(s.baslik) + '" class="w-full h-full object-cover"><div class="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white text-center px-4"><h2 class="text-2xl sm:text-3xl font-bold">' + escapeHtml(s.baslik) + '</h2>' + (s.altBaslik ? '<p class="mt-2 text-lg">' + escapeHtml(s.altBaslik) + '</p>' : '') + (s.butonYazisi && s.butonLink ? '<a href="' + escapeHtml(s.butonLink) + '" class="mt-4 px-6 py-2 bg-white text-gray-900 rounded-lg font-medium hover:bg-white/90">' + escapeHtml(s.butonYazisi) + '</a>' : '') + '</div></div>';
        });
        html += '</div>';
        section.innerHTML = html;
        section.classList.remove('hidden');
        if (list[0] && list[0].id) recordSliderView(list[0].id);
        if (list.length > 1) {
          var idx = 0;
          setInterval(function () {
            var items = section.querySelectorAll('.slider-item');
            if (!items.length) return;
            items[idx].classList.add('opacity-0');
            idx = (idx + 1) % items.length;
            items[idx].classList.remove('opacity-0');
            if (list[idx] && list[idx].id) recordSliderView(list[idx].id);
          }, 5000);
        }
      });
  }

  function loadHizmetler() {
    fetch(BASE + '/api/hizmetler')
      .then(function (r) { return safeJson(r); })
      .then(function (list) {
        if (!list || list.length === 0) return;
        var section = document.getElementById('hizmetler-section');
        var grid = document.getElementById('hizmetler-grid');
        if (!section || !grid) return;
        list.forEach(function (h) {
          var detailUrl = BASE + '/hizmet/' + encodeURIComponent(h.id);
          var gorselHtml = (h.gorsel && h.gorsel.trim()) ? '<img src="' + escapeHtml(h.gorsel) + '" alt="' + escapeHtml(h.baslik) + '" class="w-full h-32 object-cover rounded-lg mb-3">' : '';
          var ikonHtml = (h.ikon && !gorselHtml) ? '<span class="text-3xl">' + escapeHtml(h.ikon) + '</span>' : (h.ikon ? '<span class="text-2xl mt-1">' + escapeHtml(h.ikon) + '</span>' : '');
          grid.insertAdjacentHTML('beforeend', '<a href="' + escapeHtml(detailUrl) + '" class="block p-6 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">' + gorselHtml + ikonHtml + '<h3 class="font-bold text-lg text-[#1E293B] mt-2">' + escapeHtml(h.baslik) + '</h3><div class="text-sm text-[#475569] mt-1 line-clamp-3">' + (h.aciklama || '').replace(/<[^>]+>/g, '') + '</div><span class="inline-block mt-2 text-sm text-[var(--color-accent)] font-medium">Detayları görüntüle →</span></a>');
        });
        section.classList.remove('hidden');
      });
  }

  function recordReferansView(id) {
    try {
      var key = 'ref_view_' + id;
      if (sessionStorage.getItem(key)) return;
      fetch(BASE + '/api/referanslar/' + encodeURIComponent(id) + '/view', { method: 'POST' }).then(function () { try { sessionStorage.setItem(key, '1'); } catch (_) {} });
    } catch (_) {}
  }

  function loadReferanslar() {
    fetch(BASE + '/api/referanslar')
      .then(function (r) { return safeJson(r); })
      .then(function (list) {
        if (!list || list.length === 0) return;
        var section = document.getElementById('referanslar-section');
        var grid = document.getElementById('referanslar-grid');
        if (!section || !grid) return;
        list.forEach(function (r) {
          grid.insertAdjacentHTML('beforeend', '<div class="flex flex-col items-center gap-2" data-ref-id="' + escapeHtml(r.id) + '"><img src="' + escapeHtml(r.logo || '') + '" alt="' + escapeHtml(r.firmaAdi) + '" class="h-12 w-auto object-contain opacity-80 hover:opacity-100"><span class="text-xs text-[#475569]">' + escapeHtml(r.firmaAdi) + '</span></div>');
        });
        section.classList.remove('hidden');
        var observed = false;
        function maybeRecordRefViews() {
          if (observed) return;
          list.forEach(function (r) { if (r.id) recordReferansView(r.id); });
          observed = true;
        }
        if (typeof IntersectionObserver !== 'undefined') {
          var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) { if (e.isIntersecting) maybeRecordRefViews(); });
          }, { threshold: 0.2 });
          io.observe(section);
        } else maybeRecordRefViews();
      });
  }

  function loadFooterInfo() {
    Promise.all([fetch(BASE + '/api/iletisim').then(function (r) { return safeJson(r); }), fetch(BASE + '/api/sosyal').then(function (r) { return safeJson(r); })])
      .then(function (arr) {
        var iletisim = arr[0] || {};
        var sosyal = arr[1] || {};
        var adresEl = document.getElementById('footer-adres');
        var telEl = document.getElementById('footer-telefon');
        var emailEl = document.getElementById('footer-email');
        var socialEl = document.getElementById('footer-social');
        if (adresEl) adresEl.textContent = iletisim.adres || '';
        if (telEl) telEl.textContent = iletisim.telefon || '';
        if (emailEl) {
          var email = (iletisim.email || '').trim();
          if (email) {
            emailEl.innerHTML = '<a href="mailto:' + escapeHtml(email) + '" class="hover:underline">' + escapeHtml(email) + '</a>';
          } else {
            emailEl.textContent = '—';
          }
        }
        if (socialEl) {
          var links = [
            { key: 'linkedin', url: sosyal.linkedin, label: 'LinkedIn', path: 'M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z' },
            { key: 'twitter', url: sosyal.twitter, label: 'Twitter', path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' },
            { key: 'facebook', url: sosyal.facebook, label: 'Facebook', path: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' },
            { key: 'instagram', url: sosyal.instagram, label: 'Instagram', path: 'M6 2L18 2Q22 2 22 6L22 18Q22 22 18 22L6 22Q2 22 2 18L2 6Q2 2 6 2ZM16 12A4 4 0 1 0 8 12A4 4 0 1 0 16 12ZM19.5 6A1.5 1.5 0 1 0 16.5 6A1.5 1.5 0 1 0 19.5 6Z', fillRule: 'evenodd' },
          ];
          links.forEach(function (l) {
            var href = l.url || '#';
            var path = l.path || '';
            if (!path) return;
            var pathAttrs = ' d="' + path + '"';
            if (l.fillRule) pathAttrs += ' fill-rule="' + escapeHtml(l.fillRule) + '"';
            socialEl.insertAdjacentHTML('beforeend', '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener" class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors" aria-label="' + escapeHtml(l.label) + '"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path' + pathAttrs + '/></svg></a>');
          });
        }
      });
  }

  var refreshViewCountsInProgress = false;
  function refreshViewCounts() {
    if (refreshViewCountsInProgress) return;
    refreshViewCountsInProgress = true;
    loadTrending();
    loadAlbums(true).then(function () { refreshViewCountsInProgress = false; }, function () { refreshViewCountsInProgress = false; });
  }

  function init() {
    loadAlbums(false);
    loadTrending();
    loadSlider();
    loadHizmetler();
    loadReferanslar();
    loadFooterInfo();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refreshViewCounts();
    });
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) refreshViewCounts();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
