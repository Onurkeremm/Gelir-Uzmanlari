(function () {
  'use strict';

  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  var socialPaths = {
    linkedin: 'M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z',
    twitter: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
    facebook: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z',
    instagram: 'M6 2L18 2Q22 2 22 6L22 18Q22 22 18 22L6 22Q2 22 2 18L2 6Q2 2 6 2ZM16 12A4 4 0 1 0 8 12A4 4 0 1 0 16 12ZM19.5 6A1.5 1.5 0 1 0 16.5 6A1.5 1.5 0 1 0 19.5 6Z'
  };
  var socialFillRule = { instagram: 'evenodd' };
  var socialLabels = { linkedin: 'LinkedIn', twitter: 'Twitter', facebook: 'Facebook', instagram: 'Instagram' };

  Promise.all([
    fetch('/api/iletisim').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    fetch('/api/sosyal').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
  ]).then(function (arr) {
    var iletisim = arr[0] || {};
    var sosyal = arr[1] || {};
    var loading = document.getElementById('contact-loading');
    var content = document.getElementById('contact-content');
    var empty = document.getElementById('contact-empty');
    if (loading) loading.classList.add('hidden');

    var hasAny = (iletisim.adres || iletisim.telefon || iletisim.email || sosyal.linkedin || sosyal.twitter || sosyal.facebook || sosyal.instagram);
    if (!hasAny) {
      if (empty) empty.classList.remove('hidden');
      return;
    }

    if (content) content.classList.remove('hidden');
    var adresEl = document.getElementById('contact-adres');
    var telEl = document.getElementById('contact-telefon');
    var emailEl = document.getElementById('contact-email');
    if (adresEl) adresEl.textContent = iletisim.adres || '—';
    if (telEl) telEl.textContent = iletisim.telefon || '—';
    if (emailEl) {
      emailEl.textContent = iletisim.email || '—';
      if (iletisim.email) {
        emailEl.innerHTML = '<a href="mailto:' + escapeHtml(iletisim.email) + '" class="text-[var(--color-accent)] hover:underline">' + escapeHtml(iletisim.email) + '</a>';
      }
    }

    var socialWrap = document.getElementById('contact-social-wrap');
    var socialEl = document.getElementById('contact-social');
    if (socialWrap && socialEl) {
      var links = [
        { key: 'linkedin', url: sosyal.linkedin },
        { key: 'twitter', url: sosyal.twitter },
        { key: 'facebook', url: sosyal.facebook },
        { key: 'instagram', url: sosyal.instagram }
      ].filter(function (l) { return l.url; });
      if (links.length > 0) {
        socialWrap.classList.remove('hidden');
        links.forEach(function (l) {
          var path = socialPaths[l.key];
          if (!path) return;
          var pathAttr = ' d="' + path + '"';
          if (socialFillRule[l.key]) pathAttr += ' fill-rule="' + escapeHtml(socialFillRule[l.key]) + '"';
          socialEl.insertAdjacentHTML('beforeend',
            '<a href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#f8faff] border border-gray-100 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors" aria-label="' + escapeHtml(socialLabels[l.key]) + '">' +
            '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path' + pathAttr + '/></svg>' +
            '<span class="text-sm font-medium">' + escapeHtml(socialLabels[l.key]) + '</span>' +
            '</a>'
          );
        });
      }
    }
  }).catch(function () {
    var loading = document.getElementById('contact-loading');
    var empty = document.getElementById('contact-empty');
    if (loading) loading.classList.add('hidden');
    if (empty) {
      empty.classList.remove('hidden');
      empty.textContent = 'İletişim bilgileri yüklenemedi.';
    }
  });
})();
