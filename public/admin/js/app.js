(function () {
  'use strict';

  var API_BASE = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.protocol !== 'file:')
    ? window.location.origin
    : '';
  const API = API_BASE + '/api/admin';
  let currentSection = null;
  let editingId = null;
  let quillEditor = null;
  let currentUser = { user: '', rol: 'admin', userId: null };
  var grafiklerChartInstance = null;
  var grafiklerChartInstances = [];
  var grafiklerChartMap = {};
  var grafiklerChartData = {};

  function toast(message, type) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'px-4 py-3 rounded-lg shadow-lg text-white text-sm ' + (type === 'error' ? 'bg-red-600' : 'bg-green-600');
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 4000);
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function safeJson(res) {
    var ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (ct.indexOf('application/json') === -1) {
      return res.text().then(function (text) {
        if (text && text.trim().startsWith('<')) {
          throw new Error('API yanıtı HTML döndü. Sunucuyu "npm start" ile çalıştırıp http://localhost:3000/admin adresini kullanın.');
        }
        throw new Error('Beklenmeyen yanıt. Sunucu çalışıyor mu?');
      });
    }
    return res.json();
  }

  function fetchApi(url, options) {
    options = options || {};
    options.credentials = 'include';
    options.headers = options.headers || {};
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    return fetch(url, options).then(function (res) {
      if (res.status === 401) {
        if (url.indexOf('/me') !== -1) {
          throw new Error('Oturum sonlandı.');
        }
        if (url.indexOf('/login') !== -1) {
          return res;
        }
        window.location.reload();
        throw new Error('Oturum sonlandı.');
      }
      if (res.status === 429) {
        return res.json().then(function (d) { throw new Error(d.error || 'Çok fazla deneme.'); });
      }
      if (res.status === 403 && currentUser.rol === 'editor') {
        toast('Yetkisiz erişim. Sadece haberleri yönetebilirsiniz.', 'error');
        loadSection('haberler');
        document.querySelectorAll('.admin-nav').forEach(function (n) { n.classList.remove('bg-gray-700'); });
        var hab = document.querySelector('.admin-nav[data-section="haberler"]');
        if (hab) hab.classList.add('bg-gray-700');
        throw new Error('Yetkisiz erişim');
      }
      return res;
    });
  }

  function checkAuth() {
    return fetchApi(API + '/me').then(function (r) {
      if (r.ok) return safeJson(r);
      throw new Error('Giriş gerekli');
    });
  }

  function showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('panel-screen').classList.add('hidden');
  }

  function showPanel(me) {
    currentUser = { user: (me && me.user) || 'admin', rol: (me && me.rol) || 'admin', userId: (me && me.userId) || null };
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('panel-screen').classList.remove('hidden');
    var un = document.getElementById('admin-username');
    if (un) un.textContent = currentUser.user;
    var badge = document.getElementById('admin-rol-badge');
    if (badge) {
      badge.textContent = currentUser.rol === 'admin' ? '👑 Admin' : '✏️ Editor';
      badge.className = 'text-xs px-1.5 py-0.5 rounded ' + (currentUser.rol === 'admin' ? 'bg-amber-600/80' : 'bg-green-600/80');
    }
    document.querySelectorAll('[data-admin-only]').forEach(function (el) {
      el.style.display = currentUser.rol === 'admin' ? '' : 'none';
    });
    document.body.classList.toggle('editor-panel', currentUser.rol === 'editor');
  }

  var recaptchaSiteKey = '';
  var recaptchaWidgetId = null;
  (function () {
    fetch(API_BASE + '/api/admin/captcha-config', { credentials: 'include' }).then(function (r) { return r.json(); }).then(function (d) {
      recaptchaSiteKey = (d && d.siteKey) ? d.siteKey : '';
      if (recaptchaSiteKey) {
        var s = document.createElement('script');
        s.src = 'https://www.google.com/recaptcha/api.js?onload=__recaptchaReady&render=explicit';
        s.async = true;
        window.__recaptchaReady = function () { /* Widget is rendered when CAPTCHA is required (showLoginCaptcha). */ };
        document.head.appendChild(s);
      }
    }).catch(function () {});
  })();
  function showLoginCaptcha() {
    var wrap = document.getElementById('login-captcha-wrap');
    if (!wrap) return;
    wrap.classList.remove('hidden');
    var container = document.getElementById('recaptcha-container');
    if (recaptchaSiteKey && window.grecaptcha && recaptchaWidgetId == null && container && !container.hasChildNodes()) {
      recaptchaWidgetId = window.grecaptcha.render('recaptcha-container', { sitekey: recaptchaSiteKey, theme: 'light' });
    }
  }
  function getLoginCaptchaToken() {
    if (recaptchaWidgetId != null && window.grecaptcha) return window.grecaptcha.getResponse(recaptchaWidgetId) || '';
    return '';
  }
  function resetLoginCaptcha() {
    if (recaptchaWidgetId != null && window.grecaptcha) window.grecaptcha.reset(recaptchaWidgetId);
  }
  (function () {
    var errEl = document.getElementById('login-error');
    var unEl = document.getElementById('login-username');
    var pwEl = document.getElementById('login-password');
    function clearLoginError() { if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; } }
    if (unEl) unEl.addEventListener('input', clearLoginError);
    if (pwEl) pwEl.addEventListener('input', clearLoginError);
  })();
  document.getElementById('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    var body = { username: username, password: password };
    var token = getLoginCaptchaToken();
    if (token) body.captchaToken = token;
    fetchApi(API + '/login', {
      method: 'POST',
      body: body,
    })
      .then(function (r) {
        if (r.ok) return safeJson(r);
        return r.json().then(function (d) {
          if (d && d.requireCaptcha) showLoginCaptcha();
          var msg = (d && typeof d.error === 'string' && d.error.trim()) ? d.error.trim() : 'Hatalı Kullanıcı Adı veya Şifre';
          throw new Error(msg);
        }).catch(function (e) {
          if (e.message && (e.message.indexOf('API yanıtı') !== -1 || e.message.indexOf('Beklenmeyen') !== -1)) throw e;
          if (e instanceof SyntaxError || (e.message && e.message.indexOf('JSON') !== -1)) throw new Error('Hatalı Kullanıcı Adı veya Şifre');
          throw e;
        });
      })
      .then(function (data) {
        return fetchApi(API + '/me').then(function (r) {
          if (r.ok) return safeJson(r);
          return { user: username, rol: data.rol || 'admin' };
        });
      })
      .then(function (me) {
        showPanel(me);
        if (me.rol === 'editor') {
          loadSection('haberler');
          document.querySelectorAll('.admin-nav').forEach(function (n) { n.classList.remove('bg-gray-700'); });
          var h = document.querySelector('.admin-nav[data-section="haberler"]');
          if (h) h.classList.add('bg-gray-700');
        } else {
          loadSection('slider');
          document.querySelectorAll('.admin-nav').forEach(function (n) { n.classList.remove('bg-gray-700'); });
          var s = document.querySelector('.admin-nav[data-section="slider"]');
          if (s) s.classList.add('bg-gray-700');
        }
      })
      .catch(function (err) {
        errEl.textContent = err.message || 'Hatalı Kullanıcı Adı veya Şifre';
        errEl.classList.remove('hidden');
        if (err.message && err.message.indexOf('15 dakika') !== -1) errEl.classList.add('font-medium');
        if (err.message && (err.message.indexOf('CAPTCHA') !== -1 || err.message.indexOf('captcha') !== -1)) showLoginCaptcha();
      });
  });
  (function forgotPassword() {
    var link = document.getElementById('login-forgot-link');
    var modal = document.getElementById('forgot-modal');
    var emailInput = document.getElementById('forgot-email');
    var submitBtn = document.getElementById('forgot-submit');
    var closeBtn = document.getElementById('forgot-close');
    var msgEl = document.getElementById('forgot-msg');
    if (link) link.addEventListener('click', function (e) { e.preventDefault(); if (modal) { modal.classList.remove('hidden'); msgEl.classList.add('hidden'); } });
    if (closeBtn) closeBtn.addEventListener('click', function () { if (modal) modal.classList.add('hidden'); });
    if (submitBtn) submitBtn.addEventListener('click', function () {
      var email = (emailInput && emailInput.value) ? emailInput.value.trim() : '';
      if (!email) return;
      msgEl.classList.add('hidden');
      submitBtn.disabled = true;
      fetch(API_BASE + '/api/admin/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: email }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          msgEl.textContent = (d && d.message) ? d.message : (d && d.error) ? d.error : 'İşlem tamamlandı.';
          msgEl.classList.remove('hidden');
          msgEl.className = 'text-sm mb-2 ' + (d && d.error ? 'text-red-600' : 'text-green-600');
        })
        .catch(function () { msgEl.textContent = 'Bağlantı hatası.'; msgEl.classList.remove('hidden'); msgEl.classList.add('text-red-600'); })
        .then(function () { submitBtn.disabled = false; });
    });
  })();
  (function sessionWarn() {
    var modal = document.getElementById('session-warn-modal');
    var extendBtn = document.getElementById('session-extend-btn');
    var logoutBtn = document.getElementById('session-logout-btn');
    var sessionCheckInterval = null;
    function checkSession() {
      if (!currentUser.userId) return;
      fetch(API_BASE + '/api/admin/session-info', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (info) {
        if (!info || Date.now() < info.warnAt) return;
        if (modal) modal.classList.remove('hidden');
      }).catch(function () {});
    }
    function hideWarn() { if (modal) modal.classList.add('hidden'); }
    if (extendBtn) extendBtn.addEventListener('click', function () {
      fetch(API_BASE + '/api/admin/extend-session', { method: 'POST', credentials: 'include' }).then(function (r) {
        if (r.ok) hideWarn();
      });
    });
    if (logoutBtn) logoutBtn.addEventListener('click', function () {
      fetch(API_BASE + '/api/admin/logout', { credentials: 'include' }).then(function () { showLogin(); });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && currentUser.userId) checkSession();
    });
    setInterval(function () {
      if (document.getElementById('panel-screen') && !document.getElementById('panel-screen').classList.contains('hidden') && currentUser.userId) checkSession();
    }, 60 * 1000);
  })();

  document.getElementById('btn-logout').addEventListener('click', function () {
    fetchApi(API + '/logout').then(function () {
      showLogin();
    });
  });

  function closeMobileSidebar() {
    var panel = document.getElementById('panel-screen');
    var overlay = document.getElementById('panel-sidebar-overlay');
    if (panel) panel.classList.remove('sidebar-open');
    if (overlay) overlay.classList.add('hidden');
  }

  var panelMenuToggle = document.getElementById('panel-menu-toggle');
  var panelSidebarOverlay = document.getElementById('panel-sidebar-overlay');
  if (panelMenuToggle) {
    panelMenuToggle.addEventListener('click', function () {
      var panel = document.getElementById('panel-screen');
      var overlay = document.getElementById('panel-sidebar-overlay');
      if (panel && overlay) {
        panel.classList.toggle('sidebar-open');
        overlay.classList.toggle('hidden', !panel.classList.contains('sidebar-open'));
      }
    });
  }
  if (panelSidebarOverlay) {
    panelSidebarOverlay.addEventListener('click', closeMobileSidebar);
  }

  document.querySelectorAll('.admin-nav').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var section = this.getAttribute('data-section');
      if (currentUser.rol === 'editor' && this.hasAttribute('data-admin-only')) {
        toast('Bu bölüme erişim yetkiniz yok.', 'error');
        return;
      }
      document.querySelectorAll('.admin-nav').forEach(function (n) {
        n.classList.remove('bg-gray-700');
      });
      this.classList.add('bg-gray-700');
      loadSection(section);
      closeMobileSidebar();
    });
  });

  function loadSection(section) {
    currentSection = section;
    editingId = null;
    if (currentUser.rol === 'editor' && ['anasayfa', 'iletisim', 'sosyal', 'kullanicilar', 'guvenlik-loglari'].indexOf(section) !== -1) {
      section = 'haberler';
    }
    if (section === 'slider') loadSliderList();
    else if (section === 'hizmetler') loadHizmetlerList();
    else if (section === 'haberler') loadHaberlerList();
    else if (section === 'referanslar') loadReferanslarList();
    else if (section === 'anasayfa') loadAnasayfaForm();
    else if (section === 'iletisim') loadIletisimForm();
    else if (section === 'sosyal') loadSosyalForm();
    else if (section === 'kullanicilar') loadKullanicilarList();
    else if (section === 'guvenlik-loglari') loadGuvenlikLoglari();
    else if (section === 'grafikler') loadGrafiklerSection();
  }

  function renderList(content) {
    document.getElementById('admin-content').innerHTML = content;
  }

  function confirmDelete(msg, onConfirm) {
    if (window.confirm(msg || 'Bu içeriği silmek istediğinize emin misiniz?')) onConfirm();
  }

  function showContentViewModal(title, bodyHtml) {
    var overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', title);
    var box = document.createElement('div');
    box.className = 'bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col';
    box.innerHTML = '<div class="p-4 border-b border-gray-200 flex justify-between items-center"><h3 class="text-lg font-bold text-gray-800">' + escapeHtml(title) + '</h3><button type="button" class="modal-view-close px-3 py-1 rounded-lg hover:bg-gray-100 text-gray-600">&times; Kapat</button></div><div class="p-4 overflow-auto flex-1">' + bodyHtml + '</div>';
    overlay.appendChild(box);
    function close() { overlay.remove(); document.body.style.overflow = ''; }
    box.querySelector('.modal-view-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);
  }

  // ---------- Slider ----------
  function loadSliderList() {
    fetchApi(API + '/slider')
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Slider listesi yüklenemedi.'); });
        return safeJson(r);
      })
      .then(function (list) {
        var html = '<div class="flex justify-between items-center mb-4"><h3 class="text-xl font-bold text-gray-800">Slider / Görseller</h3><button type="button" id="btn-new-slider" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Yeni Ekle</button></div>';
        html += '<p class="text-sm text-gray-600 mb-2">Aktif işaretli olanlar yayında görünür; pasif olanlar sitede listelenmez.</p>';
        html += '<div class="bg-white rounded-xl border border-gray-200 overflow-hidden"><table class="w-full"><thead class="bg-gray-50"><tr><th class="text-left p-3 text-sm font-medium text-gray-700">Sıra</th><th class="text-left p-3 text-sm font-medium text-gray-700">Başlık</th><th class="text-left p-3 text-sm font-medium text-gray-700">Görsel</th><th class="text-left p-3 text-sm font-medium text-gray-700">Oluşturan</th><th class="text-left p-3 text-sm font-medium text-gray-700">Oluşturulma zamanı</th><th class="text-center p-3 text-sm font-medium text-gray-700 w-12">Aktif</th><th class="text-right p-3 text-sm font-medium text-gray-700">İşlem</th></tr></thead><tbody>';
        (Array.isArray(list) ? list : []).forEach(function (x) {
          var olusturan = (x.ekleyenKullaniciAdi && x.ekleyenKullaniciAdi.trim()) ? escapeHtml(x.ekleyenKullaniciAdi) : '—';
          if (x.ekleyenKullaniciRol) olusturan += ' <span class="text-xs px-1.5 py-0.5 rounded ' + (x.ekleyenKullaniciRol === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700') + '">' + (x.ekleyenKullaniciRol === 'admin' ? 'Admin' : 'Editor') + '</span>';
          var olusturulma = (x.created_at) ? escapeHtml(new Date(x.created_at).toLocaleString('tr-TR')) : '—';
          var aktChk = (x.aktif !== false) ? ' checked' : '';
          html += '<tr class="border-t border-gray-100"><td class="p-3">' + (x.sira ?? '') + '</td><td class="p-3">' + escapeHtml(x.baslik) + '</td><td class="p-3">' + (x.resim ? '<img src="' + escapeHtml(x.resim) + '" alt="" class="h-10 w-16 object-cover rounded">' : '-') + '</td><td class="p-3 text-gray-600">' + olusturan + '</td><td class="p-3 text-gray-600 text-sm">' + olusturulma + '</td><td class="p-3 text-center"><input type="checkbox" class="toggle-aktif-slider" data-id="' + escapeHtml(x.id) + '" title="Yayında" ' + aktChk + '></td><td class="p-3 text-right"><button type="button" class="view-slider mr-2 text-blue-600 hover:underline" data-id="' + escapeHtml(x.id) + '">Görüntüle</button><button type="button" class="edit-slider mr-2 text-blue-600 hover:underline" data-id="' + escapeHtml(x.id) + '">Düzenle</button><button type="button" class="delete-slider text-red-600 hover:underline" data-id="' + escapeHtml(x.id) + '">Sil</button></td></tr>';
        });
        html += '</tbody></table></div>';
        if (!list || list.length === 0) html += '<p class="text-gray-500 mt-4">Henüz öğe yok. Yeni Ekle ile ekleyin.</p>';
        renderList(html);
        document.querySelectorAll('.toggle-aktif-slider').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var id = this.getAttribute('data-id');
            var chk = this;
            fetchApi(API + '/slider/' + id, { method: 'PUT', body: { aktif: chk.checked } }).then(function (r) {
              if (r.ok) { toast(chk.checked ? 'Yayına alındı.' : 'Yayından kaldırıldı.'); loadSliderList(); } else { chk.checked = !chk.checked; toast('Güncellenemedi.', 'error'); }
            }).catch(function () { chk.checked = !chk.checked; toast('Güncellenemedi.', 'error'); });
          });
        });
        document.getElementById('btn-new-slider').addEventListener('click', function () { editingId = null; showSliderForm(); });
        document.querySelectorAll('.edit-slider').forEach(function (b) {
          b.addEventListener('click', function () { editingId = this.getAttribute('data-id'); showSliderForm(editingId); });
        });
        document.querySelectorAll('.view-slider').forEach(function (b) {
          b.addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            var item = (Array.isArray(list) ? list : []).find(function (x) { return x.id === id; });
            if (!item) return;
            var body = (item.resim ? '<p class="mb-2"><img src="' + escapeHtml(item.resim) + '" alt="" class="max-w-full rounded-lg border max-h-48 object-cover"></p>' : '') + '<p><strong>Başlık:</strong> ' + escapeHtml(item.baslik || '') + '</p><p class="mt-1"><strong>Alt başlık:</strong> ' + escapeHtml(item.altBaslik || '') + '</p><p class="mt-1"><strong>Buton yazısı:</strong> ' + escapeHtml(item.butonYazisi || '') + '</p><p class="mt-1"><strong>Buton linki:</strong> ' + (item.butonLink ? '<a href="' + escapeHtml(item.butonLink) + '" target="_blank" rel="noopener" class="text-blue-600 hover:underline">' + escapeHtml(item.butonLink) + '</a>' : '—') + '</p>';
            showContentViewModal('Slider içeriği', body);
          });
        });
        document.querySelectorAll('.delete-slider').forEach(function (b) {
          b.addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            confirmDelete('Bu slider öğesini silmek istediğinize emin misiniz?', function () {
              fetchApi(API + '/slider/' + id, { method: 'DELETE' }).then(function (r) {
                if (r.ok) { toast('Silindi.'); loadSliderList(); } else toast('Silinemedi.', 'error');
              });
            });
          });
        });
      })
      .catch(function (err) {
        renderList('<div class="p-6 rounded-xl border bg-red-50 text-red-700">' + escapeHtml(err.message) + '</div>');
        toast(err.message, 'error');
      });
  }

  function showSliderForm(id) {
    var title = id ? 'Slider Düzenle' : 'Yeni Slider';
    var html = '<div class="max-w-2xl"><h3 class="text-xl font-bold text-gray-800 mb-4">' + title + '</h3>';
    html += '<form id="form-slider" class="space-y-4 bg-white p-6 rounded-xl border border-gray-200">';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Görsel URL veya yükle</label><input type="text" id="slider-resim" class="w-full px-3 py-2 border rounded-lg" placeholder="/uploads/..."><input type="file" id="slider-file" accept=".jpg,.jpeg,.png,.webp" class="mt-2"><div id="slider-preview" class="mt-2"></div></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Başlık</label><input type="text" id="slider-baslik" class="w-full px-3 py-2 border rounded-lg" required></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Alt başlık</label><input type="text" id="slider-altBaslik" class="w-full px-3 py-2 border rounded-lg"></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Buton yazısı</label><input type="text" id="slider-butonYazisi" class="w-full px-3 py-2 border rounded-lg"></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Buton linki</label><input type="text" id="slider-butonLink" class="w-full px-3 py-2 border rounded-lg"></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Sıra</label><input type="number" id="slider-sira" class="w-full px-3 py-2 border rounded-lg" value="0"></div>';
    html += '<div><label class="flex items-center gap-2"><input type="checkbox" id="slider-aktif" checked> Aktif</label></div>';
    html += '<div class="flex gap-2"><button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Kaydet</button><button type="button" id="slider-iptal" class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">İptal</button></div></form></div>';
    renderList(html);

    if (id) {
      fetchApi(API + '/slider').then(function (r) { return safeJson(r); }).then(function (list) {
        var x = (Array.isArray(list) ? list : []).find(function (i) { return i.id === id; });
        if (x) {
          document.getElementById('slider-resim').value = x.resim || '';
          document.getElementById('slider-baslik').value = x.baslik || '';
          document.getElementById('slider-altBaslik').value = x.altBaslik || '';
          document.getElementById('slider-butonYazisi').value = x.butonYazisi || '';
          document.getElementById('slider-butonLink').value = x.butonLink || '';
          document.getElementById('slider-sira').value = x.sira ?? 0;
          document.getElementById('slider-aktif').checked = x.aktif !== false;
          if (x.resim) document.getElementById('slider-preview').innerHTML = '<img src="' + escapeHtml(x.resim) + '" class="max-h-24 rounded">';
        }
      });
    }

    document.getElementById('slider-file').addEventListener('change', function () {
      var f = this.files[0];
      if (!f) return;
      var fd = new FormData();
      fd.append('file', f);
      fetchApi(API + '/upload', { method: 'POST', body: fd, headers: {} }).then(function (r) {
        if (r.ok) return safeJson(r);
        throw new Error('Yükleme başarısız');
      }).then(function (d) {
        document.getElementById('slider-resim').value = d.url;
        document.getElementById('slider-preview').innerHTML = '<img src="' + d.url + '" class="max-h-24 rounded">';
        toast('Görsel yüklendi.');
      }).catch(function () { toast('Görsel yüklenemedi.', 'error'); });
    });

    document.getElementById('slider-iptal').addEventListener('click', function () { loadSliderList(); });
    document.getElementById('form-slider').addEventListener('submit', function (e) {
      e.preventDefault();
      var body = {
        resim: document.getElementById('slider-resim').value.trim(),
        baslik: document.getElementById('slider-baslik').value.trim(),
        altBaslik: document.getElementById('slider-altBaslik').value.trim(),
        butonYazisi: document.getElementById('slider-butonYazisi').value.trim(),
        butonLink: document.getElementById('slider-butonLink').value.trim(),
        sira: parseInt(document.getElementById('slider-sira').value, 10) || 0,
        aktif: document.getElementById('slider-aktif').checked,
      };
      var url = API + '/slider';
      var method = 'POST';
      if (id) { url += '/' + id; method = 'PUT'; }
      fetchApi(url, { method: method, body: body }).then(function (r) {
        if (r.ok) { toast('Kaydedildi.'); loadSliderList(); } else return safeJson(r).then(function (d) { throw new Error(d.error); });
      }).catch(function (err) { toast(err.message || 'Kaydedilemedi.', 'error'); });
    });
  }

  // ---------- Hizmetler ----------
  function loadHizmetlerList() {
    fetchApi(API + '/hizmetler')
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Hizmetler listesi yüklenemedi.'); });
        return safeJson(r);
      })
      .then(function (list) {
        var html = '<div class="flex justify-between items-center mb-4"><h3 class="text-xl font-bold text-gray-800">Hizmetler</h3><button type="button" id="btn-new-hizmet" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Yeni Ekle</button></div>';
        html += '<p class="text-sm text-gray-600 mb-2">Aktif işaretli olanlar yayında görünür; pasif olanlar sitede listelenmez.</p>';
        html += '<div class="bg-white rounded-xl border overflow-hidden"><table class="w-full"><thead class="bg-gray-50"><tr><th class="text-left p-3 text-sm font-medium text-gray-700">Sıra</th><th class="text-left p-3 text-sm font-medium text-gray-700">Görsel</th><th class="text-left p-3 text-sm font-medium text-gray-700">Başlık</th><th class="text-left p-3 text-sm font-medium text-gray-700">Oluşturan</th><th class="text-left p-3 text-sm font-medium text-gray-700">Oluşturulma zamanı</th><th class="text-center p-3 text-sm font-medium text-gray-700 w-12">Aktif</th><th class="text-right p-3 text-sm font-medium text-gray-700">İşlem</th></tr></thead><tbody>';
        (Array.isArray(list) ? list : []).forEach(function (x) {
          var olusturan = (x.ekleyenKullaniciAdi && x.ekleyenKullaniciAdi.trim()) ? escapeHtml(x.ekleyenKullaniciAdi) : '—';
          if (x.ekleyenKullaniciRol) olusturan += ' <span class="text-xs px-1.5 py-0.5 rounded ' + (x.ekleyenKullaniciRol === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700') + '">' + (x.ekleyenKullaniciRol === 'admin' ? 'Admin' : 'Editor') + '</span>';
          var olusturulma = (x.created_at) ? escapeHtml(new Date(x.created_at).toLocaleString('tr-TR')) : '—';
          var aktChk = (x.aktif !== false) ? ' checked' : '';
          var thumb = (x.gorsel && x.gorsel.trim()) ? '<img src="' + escapeHtml(x.gorsel) + '" alt="" class="w-10 h-10 object-cover rounded">' : '—';
          var viewUrl = '/hizmet/' + encodeURIComponent(x.id);
          html += '<tr class="border-t"><td class="p-3">' + (x.sira ?? '') + '</td><td class="p-3">' + thumb + '</td><td class="p-3">' + escapeHtml(x.baslik) + '</td><td class="p-3 text-gray-600">' + olusturan + '</td><td class="p-3 text-gray-600 text-sm">' + olusturulma + '</td><td class="p-3 text-center"><input type="checkbox" class="toggle-aktif-hizmet" data-id="' + escapeHtml(x.id) + '" title="Yayında" ' + aktChk + '></td><td class="p-3 text-right"><a href="' + escapeHtml(viewUrl) + '" target="_blank" rel="noopener" class="view-hizmet mr-2 text-blue-600 hover:underline">Görüntüle</a><button type="button" class="edit-hizmet mr-2 text-blue-600" data-id="' + escapeHtml(x.id) + '">Düzenle</button><button type="button" class="delete-hizmet text-red-600" data-id="' + escapeHtml(x.id) + '">Sil</button></td></tr>';
        });
        html += '</tbody></table></div>';
        renderList(html);
        document.querySelectorAll('.toggle-aktif-hizmet').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var id = this.getAttribute('data-id');
            var chk = this;
            fetchApi(API + '/hizmetler/' + id, { method: 'PUT', body: { aktif: chk.checked } }).then(function (r) {
              if (r.ok) { toast(chk.checked ? 'Yayına alındı.' : 'Yayından kaldırıldı.'); loadHizmetlerList(); } else { chk.checked = !chk.checked; toast('Güncellenemedi.', 'error'); }
            }).catch(function () { chk.checked = !chk.checked; toast('Güncellenemedi.', 'error'); });
          });
        });
        document.getElementById('btn-new-hizmet').addEventListener('click', function () { editingId = null; showHizmetForm(); });
        document.querySelectorAll('.edit-hizmet').forEach(function (b) {
          b.addEventListener('click', function () { editingId = this.getAttribute('data-id'); showHizmetForm(editingId); });
        });
        document.querySelectorAll('.delete-hizmet').forEach(function (b) {
          b.addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            confirmDelete('Bu hizmeti silmek istediğinize emin misiniz?', function () {
              fetchApi(API + '/hizmetler/' + id, { method: 'DELETE' }).then(function (r) {
                if (r.ok) { toast('Silindi.'); loadHizmetlerList(); } else toast('Silinemedi.', 'error');
              });
            });
          });
        });
      })
      .catch(function (err) {
        renderList('<div class="p-6 rounded-xl border bg-red-50 text-red-700">' + escapeHtml(err.message) + '</div>');
        toast(err.message, 'error');
      });
  }

  function showHizmetForm(id) {
    var title = id ? 'Hizmet Düzenle' : 'Yeni Hizmet';
    var html = '<div class="max-w-2xl"><h3 class="text-xl font-bold text-gray-800 mb-4">' + title + '</h3>';
    html += '<form id="form-hizmet" class="space-y-4 bg-white p-6 rounded-xl border">';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Başlık *</label><input type="text" id="hizmet-baslik" class="w-full px-3 py-2 border rounded-lg" required></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Açıklama</label><div id="hizmet-aciklama-editor" class="border rounded-lg bg-white"></div></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Görsel (URL veya sürükle bırak)</label>';
    html += '<input type="text" id="hizmet-gorsel" class="w-full px-3 py-2 border rounded-lg mb-2" placeholder="https://... veya aşağıya dosya sürükleyin">';
    html += '<div id="hizmet-gorsel-drop" class="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center text-gray-500 text-sm bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer">Dosyayı buraya sürükleyip bırakın veya tıklayın</div>';
    html += '<div id="hizmet-gorsel-preview" class="mt-2 hidden"><img id="hizmet-gorsel-img" src="" alt="Önizleme" class="max-h-32 rounded-lg border object-cover"></div></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">İkon (sınıf veya emoji)</label><input type="text" id="hizmet-ikon" class="w-full px-3 py-2 border rounded-lg" placeholder="Örn: 📋 veya icon-adı"></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Link</label><input type="text" id="hizmet-link" class="w-full px-3 py-2 border rounded-lg"></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Sıra</label><input type="number" id="hizmet-sira" class="w-full px-3 py-2 border rounded-lg" value="0"></div>';
    html += '<div><label class="flex items-center gap-2"><input type="checkbox" id="hizmet-aktif" checked> Aktif</label></div>';
    html += '<div class="flex gap-2"><button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg">Kaydet</button><button type="button" id="hizmet-iptal" class="px-4 py-2 border rounded-lg">İptal</button></div></form></div>';
    renderList(html);

    if (quillEditor) quillEditor = null;
    var editorEl = document.getElementById('hizmet-aciklama-editor');
    quillEditor = new Quill(editorEl, { theme: 'snow', placeholder: 'Açıklama...' });

    function updateGorselPreview() {
      var url = (document.getElementById('hizmet-gorsel') && document.getElementById('hizmet-gorsel').value || '').trim();
      var wrap = document.getElementById('hizmet-gorsel-preview');
      var img = document.getElementById('hizmet-gorsel-img');
      if (wrap && img) {
        if (url) { img.src = url; wrap.classList.remove('hidden'); } else { img.src = ''; wrap.classList.add('hidden'); }
      }
    }
    function uploadGorselFile(file) {
      if (!file || !file.type.match(/^image\/(jpeg|png|gif|webp)$/)) { toast('Sadece JPG, PNG, GIF veya WEBP yükleyebilirsiniz.', 'error'); return; }
      var fd = new FormData();
      fd.append('file', file);
      var input = document.getElementById('hizmet-gorsel');
      fetchApi(API + '/upload', { method: 'POST', body: fd }).then(function (r) {
        if (!r.ok) throw new Error('Yükleme başarısız');
        return r.json();
      }).then(function (d) {
        var url = (d && d.url) ? d.url : '';
        if (url && input) { input.value = url; updateGorselPreview(); toast('Görsel yüklendi.'); }
      }).catch(function () { toast('Görsel yüklenemedi.', 'error'); });
    }
    var dropZone = document.getElementById('hizmet-gorsel-drop');
    if (dropZone) {
      dropZone.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); this.classList.add('border-blue-500', 'bg-blue-50'); });
      dropZone.addEventListener('dragleave', function (e) { e.preventDefault(); this.classList.remove('border-blue-500', 'bg-blue-50'); });
      dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        this.classList.remove('border-blue-500', 'bg-blue-50');
        var file = (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) || null;
        if (file) uploadGorselFile(file);
      });
      dropZone.addEventListener('click', function () {
        var inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/jpeg,image/png,image/gif,image/webp';
        inp.onchange = function () { if (this.files && this.files[0]) uploadGorselFile(this.files[0]); };
        inp.click();
      });
    }
    var gorselInput = document.getElementById('hizmet-gorsel');
    if (gorselInput) gorselInput.addEventListener('input', updateGorselPreview);

    if (id) {
      fetchApi(API + '/hizmetler').then(function (r) { return safeJson(r); }).then(function (list) {
        var x = (Array.isArray(list) ? list : []).find(function (i) { return i.id === id; });
        if (x) {
          document.getElementById('hizmet-baslik').value = x.baslik || '';
          quillEditor.root.innerHTML = x.aciklama || '';
          if (document.getElementById('hizmet-ikon')) document.getElementById('hizmet-ikon').value = x.ikon || '';
          if (document.getElementById('hizmet-link')) document.getElementById('hizmet-link').value = x.link || '';
          if (document.getElementById('hizmet-gorsel')) document.getElementById('hizmet-gorsel').value = x.gorsel || '';
          document.getElementById('hizmet-sira').value = x.sira ?? 0;
          document.getElementById('hizmet-aktif').checked = x.aktif !== false;
          updateGorselPreview();
        }
      });
    }

    document.getElementById('hizmet-iptal').addEventListener('click', function () { loadHizmetlerList(); });
    document.getElementById('form-hizmet').addEventListener('submit', function (e) {
      e.preventDefault();
      var aciklama = (quillEditor && quillEditor.root) ? quillEditor.root.innerHTML : '';
      var body = {
        baslik: (document.getElementById('hizmet-baslik') && document.getElementById('hizmet-baslik').value || '').trim(),
        aciklama: aciklama,
        ikon: (document.getElementById('hizmet-ikon') && document.getElementById('hizmet-ikon').value || '').trim(),
        link: (document.getElementById('hizmet-link') && document.getElementById('hizmet-link').value || '').trim(),
        gorsel: (document.getElementById('hizmet-gorsel') && document.getElementById('hizmet-gorsel').value || '').trim(),
        sira: parseInt(document.getElementById('hizmet-sira') && document.getElementById('hizmet-sira').value, 10) || 0,
        aktif: document.getElementById('hizmet-aktif') ? document.getElementById('hizmet-aktif').checked : true,
      };
      if (!body.baslik) { toast('Başlık gerekli.', 'error'); return; }
      var url = API + '/hizmetler', method = 'POST';
      if (id) { url += '/' + id; method = 'PUT'; }
      fetchApi(url, { method: method, body: body }).then(function (r) {
        if (r.ok) { toast('Kaydedildi.'); loadHizmetlerList(); return; }
        return r.json().then(function (d) { throw new Error(d && d.error ? d.error : 'Kaydedilemedi.'); }).catch(function (parseErr) { throw new Error('Kaydedilemedi.'); });
      }).catch(function (err) { toast(err && err.message ? err.message : 'Kaydedilemedi.', 'error'); });
    });
  }

  // ---------- Haberler ----------
  function loadHaberlerList() {
    fetchApi(API + '/haberler')
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Haber listesi yüklenemedi.'); });
        return safeJson(r);
      })
      .then(function (list) {
        var html = '<div class="flex justify-between items-center mb-4"><h3 class="text-xl font-bold text-gray-800">Haberler / Duyurular</h3><button type="button" id="btn-new-haber" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Yeni Ekle</button></div>';
        html += '<p class="text-sm text-gray-600 mb-2">Aktif işaretli olanlar yayında görünür; pasif olanlar sitede listelenmez.</p>';
        html += '<div class="bg-white rounded-xl border overflow-hidden"><table class="w-full"><thead class="bg-gray-50"><tr><th class="text-left p-3 text-sm font-medium text-gray-700">Tarih</th><th class="text-left p-3 text-sm font-medium text-gray-700">Başlık</th><th class="text-left p-3 text-sm font-medium text-gray-700">Kategori</th><th class="text-left p-3 text-sm font-medium text-gray-700">Oluşturan</th><th class="text-left p-3 text-sm font-medium text-gray-700">Oluşturulma zamanı</th><th class="text-center p-3 text-sm font-medium text-gray-700 w-12">Aktif</th><th class="text-right p-3 text-sm font-medium text-gray-700">İşlem</th></tr></thead><tbody>';
        (Array.isArray(list) ? list : []).forEach(function (x) {
          var date = x.created_at ? new Date(x.created_at).toLocaleDateString('tr-TR') : '';
          var olusturan = (x.ekleyenKullaniciAdi && x.ekleyenKullaniciAdi.trim()) ? escapeHtml(x.ekleyenKullaniciAdi) : '—';
          if (x.ekleyenKullaniciRol) olusturan += ' <span class="text-xs px-1.5 py-0.5 rounded ' + (x.ekleyenKullaniciRol === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700') + '">' + (x.ekleyenKullaniciRol === 'admin' ? 'Admin' : 'Editor') + '</span>';
          var olusturulma = (x.created_at) ? escapeHtml(new Date(x.created_at).toLocaleString('tr-TR')) : '—';
          var aktChk = (x.aktif !== false) ? ' checked' : '';
          html += '<tr class="border-t"><td class="p-3">' + escapeHtml(date) + '</td><td class="p-3">' + escapeHtml(x.title) + '</td><td class="p-3">' + escapeHtml(x.category) + '</td><td class="p-3 text-gray-600">' + olusturan + '</td><td class="p-3 text-gray-600 text-sm">' + olusturulma + '</td><td class="p-3 text-center"><input type="checkbox" class="toggle-aktif-haber" data-id="' + escapeHtml(x.id) + '" title="Yayında" ' + aktChk + '></td><td class="p-3 text-right"><button type="button" class="edit-haber mr-2 text-blue-600" data-id="' + escapeHtml(x.id) + '">Düzenle</button><button type="button" class="delete-haber text-red-600" data-id="' + escapeHtml(x.id) + '">Sil</button></td></tr>';
        });
        html += '</tbody></table></div>';
        renderList(html);
        document.querySelectorAll('.toggle-aktif-haber').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var id = this.getAttribute('data-id');
            var chk = this;
            fetchApi(API + '/haberler/' + id, { method: 'PUT', body: { aktif: chk.checked } }).then(function (r) {
              if (r.ok) { toast(chk.checked ? 'Yayına alındı.' : 'Yayından kaldırıldı.'); loadHaberlerList(); } else { chk.checked = !chk.checked; toast('Güncellenemedi.', 'error'); }
            }).catch(function () { chk.checked = !chk.checked; toast('Güncellenemedi.', 'error'); });
          });
        });
        document.getElementById('btn-new-haber').addEventListener('click', function () { editingId = null; showHaberForm(); });
        document.querySelectorAll('.edit-haber').forEach(function (b) {
          b.addEventListener('click', function () { editingId = this.getAttribute('data-id'); showHaberForm(editingId); });
        });
        document.querySelectorAll('.delete-haber').forEach(function (b) {
          b.addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            confirmDelete('Bu haberi silmek istediğinize emin misiniz?', function () {
              fetchApi(API + '/haberler/' + id, { method: 'DELETE' }).then(function (r) {
                if (r.ok) { toast('Silindi.'); loadHaberlerList(); } else toast('Silinemedi.', 'error');
              });
            });
          });
        });
      })
      .catch(function (err) {
        renderList('<div class="p-6 rounded-xl border bg-red-50 text-red-700">' + escapeHtml(err.message) + '</div>');
        toast(err.message, 'error');
      });
  }

  function showHaberForm(id) {
    var title = id ? 'Haber Düzenle' : 'Yeni Haber';
    var html = '<div class="max-w-3xl"><h3 class="text-xl font-bold text-gray-800 mb-4">' + title + '</h3>';
    html += '<form id="form-haber" class="space-y-4 bg-white p-6 rounded-xl border">';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Başlık *</label><input type="text" id="haber-title" class="w-full px-3 py-2 border rounded-lg" required></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Kategori</label><input type="text" id="haber-category" class="w-full px-3 py-2 border rounded-lg" placeholder="KPSS, ALES, Atamalar, Mevzuat"></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Görsel URL veya yükle</label><input type="text" id="haber-image_url" class="w-full px-3 py-2 border rounded-lg"><input type="file" id="haber-file" accept=".jpg,.jpeg,.png,.webp" class="mt-2"><div id="haber-preview" class="mt-2"></div></div>';
    html += '<div id="haber-view_count-wrap" class="hidden"><p class="text-sm text-gray-600">Görüntülenme: <strong id="haber-view_count_display">0</strong> <span class="text-gray-400">(ziyaretçi sayısına göre otomatik artar)</span></p></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Tarih</label><input type="datetime-local" id="haber-created_at" class="w-full px-3 py-2 border rounded-lg"></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Detay içerik (zengin metin)</label><div id="haber-content-editor" class="border rounded-lg bg-white"></div></div>';
    html += '<div><label class="flex items-center gap-2"><input type="checkbox" id="haber-aktif" checked> Aktif (yayında)</label></div>';
    html += '<div class="flex gap-2"><button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg">Kaydet</button><button type="button" id="haber-iptal" class="px-4 py-2 border rounded-lg">İptal</button></div></form></div>';
    renderList(html);

    if (quillEditor) quillEditor = null;
    var editorEl = document.getElementById('haber-content-editor');
    quillEditor = new Quill(editorEl, { theme: 'snow', placeholder: 'Haber detayı...' });

    var now = new Date();
    var localNow = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + 'T' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    document.getElementById('haber-created_at').value = localNow;

    if (id) {
      fetchApi(API + '/haberler').then(function (r) { return safeJson(r); }).then(function (list) {
        var x = (Array.isArray(list) ? list : []).find(function (i) { return i.id === id; });
        if (x) {
          document.getElementById('haber-title').value = x.title || '';
          document.getElementById('haber-category').value = x.category || '';
          document.getElementById('haber-image_url').value = x.image_url || '';
          var vcWrap = document.getElementById('haber-view_count-wrap');
          var vcDisplay = document.getElementById('haber-view_count_display');
          if (vcWrap && vcDisplay) { vcWrap.classList.remove('hidden'); vcDisplay.textContent = x.view_count ?? 0; }
          if (x.created_at) {
            var d = new Date(x.created_at);
            document.getElementById('haber-created_at').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
          }
          quillEditor.root.innerHTML = x.content || '';
          if (document.getElementById('haber-aktif')) document.getElementById('haber-aktif').checked = x.aktif !== false;
          if (x.image_url) document.getElementById('haber-preview').innerHTML = '<img src="' + escapeHtml(x.image_url) + '" class="max-h-24 rounded">';
        }
      });
    }

    document.getElementById('haber-file').addEventListener('change', function () {
      var f = this.files[0];
      if (!f) return;
      var fd = new FormData();
      fd.append('file', f);
      fetchApi(API + '/upload', { method: 'POST', body: fd, headers: {} }).then(function (r) {
        if (r.ok) return safeJson(r);
        throw new Error('Yükleme başarısız');
      }).then(function (d) {
        document.getElementById('haber-image_url').value = d.url;
        document.getElementById('haber-preview').innerHTML = '<img src="' + d.url + '" class="max-h-24 rounded">';
        toast('Görsel yüklendi.');
      }).catch(function () { toast('Görsel yüklenemedi.', 'error'); });
    });

    document.getElementById('haber-iptal').addEventListener('click', function () { loadHaberlerList(); });
    document.getElementById('form-haber').addEventListener('submit', function (e) {
      e.preventDefault();
      var dateVal = document.getElementById('haber-created_at').value;
      var created_at = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();
      var body = {
        title: document.getElementById('haber-title').value.trim(),
        category: document.getElementById('haber-category').value.trim(),
        image_url: document.getElementById('haber-image_url').value.trim(),
        created_at: created_at,
        content: quillEditor.root.innerHTML,
        aktif: document.getElementById('haber-aktif') ? document.getElementById('haber-aktif').checked : true,
      };
      var url = API + '/haberler', method = 'POST';
      if (id) { url += '/' + id; method = 'PUT'; }
      fetchApi(url, { method: method, body: body }).then(function (r) {
        if (r.ok) { toast('Kaydedildi.'); loadHaberlerList(); } else return safeJson(r).then(function (d) { throw new Error(d.error); });
      }).catch(function (err) { toast(err.message, 'error'); });
    });
  }

  // ---------- Referanslar ----------
  function loadReferanslarList() {
    fetchApi(API + '/referanslar')
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Liste yüklenemedi.'); });
        return safeJson(r);
      })
      .then(function (list) {
      var html = '<div class="flex justify-between items-center mb-4"><h3 class="text-xl font-bold text-gray-800">Referanslar</h3><button type="button" id="btn-new-ref" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Yeni Ekle</button></div>';
      html += '<p class="text-sm text-gray-600 mb-2">Aktif işaretli olanlar yayında görünür; pasif olanlar sitede listelenmez.</p>';
      html += '<div class="bg-white rounded-xl border overflow-hidden"><table class="w-full"><thead class="bg-gray-50"><tr><th class="text-left p-3 text-sm font-medium text-gray-700">Sıra</th><th class="text-left p-3 text-sm font-medium text-gray-700">Firma</th><th class="text-left p-3 text-sm font-medium text-gray-700">Logo</th><th class="text-left p-3 text-sm font-medium text-gray-700">Oluşturan</th><th class="text-left p-3 text-sm font-medium text-gray-700">Oluşturulma zamanı</th><th class="text-center p-3 text-sm font-medium text-gray-700 w-12">Aktif</th><th class="text-right p-3 text-sm font-medium text-gray-700">İşlem</th></tr></thead><tbody>';
      (Array.isArray(list) ? list : []).forEach(function (x) {
        var olusturan = (x.ekleyenKullaniciAdi && x.ekleyenKullaniciAdi.trim()) ? escapeHtml(x.ekleyenKullaniciAdi) : '—';
        if (x.ekleyenKullaniciRol) olusturan += ' <span class="text-xs px-1.5 py-0.5 rounded ' + (x.ekleyenKullaniciRol === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700') + '">' + (x.ekleyenKullaniciRol === 'admin' ? 'Admin' : 'Editor') + '</span>';
        var olusturulma = (x.created_at) ? escapeHtml(new Date(x.created_at).toLocaleString('tr-TR')) : '—';
        var aktChk = (x.aktif !== false) ? ' checked' : '';
        html += '<tr class="border-t"><td class="p-3">' + (x.sira ?? '') + '</td><td class="p-3">' + escapeHtml(x.firmaAdi) + '</td><td class="p-3">' + (x.logo ? '<img src="' + escapeHtml(x.logo) + '" class="h-10 w-16 object-contain">' : '-') + '</td><td class="p-3 text-gray-600">' + olusturan + '</td><td class="p-3 text-gray-600 text-sm">' + olusturulma + '</td><td class="p-3 text-center"><input type="checkbox" class="toggle-aktif-ref" data-id="' + escapeHtml(x.id) + '" title="Yayında" ' + aktChk + '></td><td class="p-3 text-right"><button type="button" class="view-ref mr-2 text-blue-600 hover:underline" data-id="' + escapeHtml(x.id) + '">Görüntüle</button><button type="button" class="edit-ref mr-2 text-blue-600" data-id="' + escapeHtml(x.id) + '">Düzenle</button><button type="button" class="delete-ref text-red-600" data-id="' + escapeHtml(x.id) + '">Sil</button></td></tr>';
      });
      html += '</tbody></table></div>';
      renderList(html);
      document.querySelectorAll('.toggle-aktif-ref').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var id = this.getAttribute('data-id');
          var chk = this;
          fetchApi(API + '/referanslar/' + id, { method: 'PUT', body: { aktif: chk.checked } }).then(function (r) {
            if (r.ok) { toast(chk.checked ? 'Yayına alındı.' : 'Yayından kaldırıldı.'); loadReferanslarList(); } else { chk.checked = !chk.checked; toast('Güncellenemedi.', 'error'); }
          }).catch(function () { chk.checked = !chk.checked; toast('Güncellenemedi.', 'error'); });
        });
      });
      document.getElementById('btn-new-ref').addEventListener('click', function () { editingId = null; showReferansForm(); });
      document.querySelectorAll('.view-ref').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = this.getAttribute('data-id');
          var item = (Array.isArray(list) ? list : []).find(function (r) { return r.id === id; });
          if (!item) return;
          var body = (item.logo ? '<p class="mb-3"><img src="' + escapeHtml(item.logo) + '" alt="" class="max-h-24 object-contain"></p>' : '') + '<p><strong>Firma:</strong> ' + escapeHtml(item.firmaAdi || '') + '</p><p class="mt-2"><strong>Açıklama:</strong></p><div class="text-sm text-gray-700 mt-1">' + (item.aciklama || '—') + '</div>';
          showContentViewModal('Referans içeriği', body);
        });
      });
      document.querySelectorAll('.edit-ref').forEach(function (b) {
        b.addEventListener('click', function () { editingId = this.getAttribute('data-id'); showReferansForm(editingId); });
      });
      document.querySelectorAll('.delete-ref').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = this.getAttribute('data-id');
          confirmDelete('Bu referansı silmek istediğinize emin misiniz?', function () {
            fetchApi(API + '/referanslar/' + id, { method: 'DELETE' }).then(function (r) {
              if (r.ok) { toast('Silindi.'); loadReferanslarList(); } else toast('Silinemedi.', 'error');
            });
          });
        });
      });
    })
      .catch(function (err) {
        renderList('<div class="p-6 rounded-xl border bg-red-50 text-red-700">' + escapeHtml(err.message) + '</div>');
        toast(err.message, 'error');
      });
  }

  function showReferansForm(id) {
    var title = id ? 'Referans Düzenle' : 'Yeni Referans';
    var html = '<div class="max-w-2xl"><h3 class="text-xl font-bold text-gray-800 mb-4">' + title + '</h3>';
    html += '<form id="form-ref" class="space-y-4 bg-white p-6 rounded-xl border">';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Logo URL veya yükle</label><input type="text" id="ref-logo" class="w-full px-3 py-2 border rounded-lg"><input type="file" id="ref-file" accept=".jpg,.jpeg,.png,.webp" class="mt-2"><div id="ref-preview" class="mt-2"></div></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Firma adı *</label><input type="text" id="ref-firmaAdi" class="w-full px-3 py-2 border rounded-lg" required></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Açıklama</label><input type="text" id="ref-aciklama" class="w-full px-3 py-2 border rounded-lg"></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Sıra</label><input type="number" id="ref-sira" class="w-full px-3 py-2 border rounded-lg" value="0"></div>';
    html += '<div><label class="flex items-center gap-2"><input type="checkbox" id="ref-aktif" checked> Aktif</label></div>';
    html += '<div class="flex gap-2"><button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg">Kaydet</button><button type="button" id="ref-iptal" class="px-4 py-2 border rounded-lg">İptal</button></div></form></div>';
    renderList(html);

    if (id) {
      fetchApi(API + '/referanslar').then(function (r) { return safeJson(r); }).then(function (list) {
        var x = (Array.isArray(list) ? list : []).find(function (i) { return i.id === id; });
        if (x) {
          document.getElementById('ref-logo').value = x.logo || '';
          document.getElementById('ref-firmaAdi').value = x.firmaAdi || '';
          document.getElementById('ref-aciklama').value = x.aciklama || '';
          document.getElementById('ref-sira').value = x.sira ?? 0;
          document.getElementById('ref-aktif').checked = x.aktif !== false;
          if (x.logo) document.getElementById('ref-preview').innerHTML = '<img src="' + escapeHtml(x.logo) + '" class="max-h-24 rounded">';
        }
      });
    }

    document.getElementById('ref-file').addEventListener('change', function () {
      var f = this.files[0];
      if (!f) return;
      var fd = new FormData();
      fd.append('file', f);
      fetchApi(API + '/upload', { method: 'POST', body: fd, headers: {} }).then(function (r) {
        if (r.ok) return safeJson(r);
        throw new Error('Yükleme başarısız');
      }).then(function (d) {
        document.getElementById('ref-logo').value = d.url;
        document.getElementById('ref-preview').innerHTML = '<img src="' + d.url + '" class="max-h-24 rounded">';
        toast('Logo yüklendi.');
      }).catch(function () { toast('Yüklenemedi.', 'error'); });
    });

    document.getElementById('ref-iptal').addEventListener('click', function () { loadReferanslarList(); });
    document.getElementById('form-ref').addEventListener('submit', function (e) {
      e.preventDefault();
      var body = {
        logo: document.getElementById('ref-logo').value.trim(),
        firmaAdi: document.getElementById('ref-firmaAdi').value.trim(),
        aciklama: document.getElementById('ref-aciklama').value.trim(),
        sira: parseInt(document.getElementById('ref-sira').value, 10) || 0,
        aktif: document.getElementById('ref-aktif').checked,
      };
      var url = API + '/referanslar', method = 'POST';
      if (id) { url += '/' + id; method = 'PUT'; }
      fetchApi(url, { method: method, body: body }).then(function (r) {
        if (r.ok) { toast('Kaydedildi.'); loadReferanslarList(); } else return safeJson(r).then(function (d) { throw new Error(d.error); });
      }).catch(function (err) { toast(err.message, 'error'); });
    });
  }

  // ---------- Anasayfa metni (hero) ----------
  function loadAnasayfaForm() {
    fetchApi(API + '/anasayfa')
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Anasayfa metni yüklenemedi.'); });
        return safeJson(r);
      })
      .then(function (data) {
        data = data || {};
        var html = '<div class="max-w-2xl"><h3 class="text-xl font-bold text-gray-800 mb-4">Anasayfa Metni</h3>';
        html += '<p class="text-sm text-gray-600 mb-4">Anasayfadaki hero bölümündeki başlık ve açıklama metnini buradan güncelleyebilirsiniz.</p>';
        html += '<form id="form-anasayfa" class="space-y-4 bg-white p-6 rounded-xl border">';
        html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Başlık</label><input type="text" id="anasayfa-heroBaslik" class="w-full px-3 py-2 border rounded-lg" value="' + escapeHtml(data.heroBaslik || '') + '" placeholder="Resmi Duyurular ve Güncel Haberler"></div>';
        html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Açıklama</label><textarea id="anasayfa-heroAciklama" class="w-full px-3 py-2 border rounded-lg" rows="3" placeholder="KPSS, ALES, atamalar ve mevzuat haberlerine tek adresten ulaşın.">' + escapeHtml(data.heroAciklama || '') + '</textarea></div>';
        html += '<div class="flex gap-2"><button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg">Kaydet</button></div></form></div>';
        renderList(html);
        document.getElementById('form-anasayfa').addEventListener('submit', function (e) {
          e.preventDefault();
          var body = {
            heroBaslik: document.getElementById('anasayfa-heroBaslik').value.trim(),
            heroAciklama: document.getElementById('anasayfa-heroAciklama').value.trim(),
          };
          fetchApi(API + '/anasayfa', { method: 'PUT', body: body }).then(function (r) {
            if (r.ok) { toast('Kaydedildi.'); } else return safeJson(r).then(function (d) { throw new Error(d.error); });
          }).catch(function (err) { toast(err.message, 'error'); });
        });
      })
      .catch(function (err) {
        renderList('<div class="p-6 rounded-xl border bg-red-50 text-red-700">' + escapeHtml(err.message) + '</div>');
        toast(err.message, 'error');
      });
  }

  // ---------- İletişim ----------
  function loadIletisimForm() {
    fetchApi(API + '/iletisim')
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'İletişim bilgileri yüklenemedi.'); });
        return safeJson(r);
      })
      .then(function (data) {
        data = data || {};
        var html = '<div class="max-w-2xl"><h3 class="text-xl font-bold text-gray-800 mb-4">İletişim Bilgileri</h3>';
        html += '<form id="form-iletisim" class="space-y-4 bg-white p-6 rounded-xl border">';
        html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Adres</label><input type="text" id="iletisim-adres" class="w-full px-3 py-2 border rounded-lg" value="' + escapeHtml(data.adres || '') + '"></div>';
        html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Telefon</label><input type="text" id="iletisim-telefon" class="w-full px-3 py-2 border rounded-lg" value="' + escapeHtml(data.telefon || '') + '"></div>';
        html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">E-posta</label><input type="email" id="iletisim-email" class="w-full px-3 py-2 border rounded-lg" value="' + escapeHtml(data.email || '') + '"></div>';
        html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Harita enlem</label><input type="text" id="iletisim-haritaLat" class="w-full px-3 py-2 border rounded-lg" value="' + escapeHtml(data.haritaLat || '') + '" placeholder="41.0082"></div>';
        html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Harita boylam</label><input type="text" id="iletisim-haritaLng" class="w-full px-3 py-2 border rounded-lg" value="' + escapeHtml(data.haritaLng || '') + '" placeholder="28.9784"></div>';
        html += '<div class="flex gap-2"><button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg">Kaydet</button></div></form></div>';
        renderList(html);
        document.getElementById('form-iletisim').addEventListener('submit', function (e) {
          e.preventDefault();
          var body = {
            adres: document.getElementById('iletisim-adres').value.trim(),
            telefon: document.getElementById('iletisim-telefon').value.trim(),
            email: document.getElementById('iletisim-email').value.trim(),
            haritaLat: document.getElementById('iletisim-haritaLat').value.trim(),
            haritaLng: document.getElementById('iletisim-haritaLng').value.trim(),
          };
          fetchApi(API + '/iletisim', { method: 'PUT', body: body }).then(function (r) {
            if (r.ok) { toast('Kaydedildi.'); } else return safeJson(r).then(function (d) { throw new Error(d.error); });
          }).catch(function (err) { toast(err.message, 'error'); });
        });
      })
      .catch(function (err) {
        renderList('<div class="p-6 rounded-xl border bg-red-50 text-red-700">' + escapeHtml(err.message) + '</div>');
        toast(err.message, 'error');
      });
  }

  // ---------- Sosyal Medya ----------
  function loadSosyalForm() {
    fetchApi(API + '/sosyal')
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Sosyal medya yüklenemedi.'); });
        return safeJson(r);
      })
      .then(function (data) {
      data = data || {};
      var html = '<div class="max-w-2xl"><h3 class="text-xl font-bold text-gray-800 mb-4">Sosyal Medya Linkleri</h3>';
      html += '<form id="form-sosyal" class="space-y-4 bg-white p-6 rounded-xl border">';
      html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">LinkedIn</label><input type="url" id="sosyal-linkedin" class="w-full px-3 py-2 border rounded-lg" value="' + escapeHtml(data.linkedin || '') + '"></div>';
      html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Twitter / X</label><input type="url" id="sosyal-twitter" class="w-full px-3 py-2 border rounded-lg" value="' + escapeHtml(data.twitter || '') + '"></div>';
      html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Facebook</label><input type="url" id="sosyal-facebook" class="w-full px-3 py-2 border rounded-lg" value="' + escapeHtml(data.facebook || '') + '"></div>';
      html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Instagram</label><input type="url" id="sosyal-instagram" class="w-full px-3 py-2 border rounded-lg" value="' + escapeHtml(data.instagram || '') + '"></div>';
      html += '<div class="flex gap-2"><button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg">Kaydet</button></div></form></div>';
      renderList(html);
      document.getElementById('form-sosyal').addEventListener('submit', function (e) {
        e.preventDefault();
        var body = {
          linkedin: document.getElementById('sosyal-linkedin').value.trim(),
          twitter: document.getElementById('sosyal-twitter').value.trim(),
          facebook: document.getElementById('sosyal-facebook').value.trim(),
          instagram: document.getElementById('sosyal-instagram').value.trim(),
        };
        fetchApi(API + '/sosyal', { method: 'PUT', body: body }).then(function (r) {
          if (r.ok) { toast('Kaydedildi.'); } else return safeJson(r).then(function (d) { throw new Error(d.error); });
        }).catch(function (err) { toast(err.message, 'error'); });
      });
    })
      .catch(function (err) {
        renderList('<div class="p-6 rounded-xl border bg-red-50 text-red-700">' + escapeHtml(err.message) + '</div>');
        toast(err.message, 'error');
      });
  }

  // ---------- Güvenlik Logları (sadece Admin) ----------
  function loadGuvenlikLoglari() {
    var html = '<div class="mb-4"><h3 class="text-xl font-bold text-gray-800">Güvenlik Logları</h3><p class="text-sm text-gray-600 mt-1">Son 6 ay, son 500 kayıt. Hassas veriler loglanmaz.</p></div>';
    html += '<div class="flex gap-2 mb-4"><button type="button" id="tab-auth-log" class="px-4 py-2 rounded-lg bg-blue-600 text-white">Giriş logları</button><button type="button" id="tab-audit-log" class="px-4 py-2 rounded-lg border bg-white">Denetim logları</button></div>';
    html += '<div id="log-content" class="bg-white rounded-xl border overflow-hidden overflow-x-auto"></div>';
    renderList(html);
    var content = document.getElementById('log-content');
    function renderAuth(list) {
      if (!content) return;
      content.innerHTML = '<table class="w-full text-sm"><thead class="bg-gray-50"><tr><th class="text-left p-2">Zaman</th><th class="text-left p-2">IP</th><th class="text-left p-2">Kullanıcı</th><th class="text-left p-2">Durum</th><th class="text-left p-2">Neden</th></tr></thead><tbody>' +
        (Array.isArray(list) ? list : []).map(function (e) {
          return '<tr class="border-t"><td class="p-2">' + escapeHtml(e.time ? new Date(e.time).toLocaleString('tr-TR') : '') + '</td><td class="p-2">' + escapeHtml(e.ip || '') + '</td><td class="p-2">' + escapeHtml(e.username || '') + '</td><td class="p-2">' + (e.success ? 'Başarılı' : 'Başarısız') + '</td><td class="p-2">' + escapeHtml(e.reason || '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    function renderAudit(list) {
      if (!content) return;
      content.innerHTML = '<table class="w-full text-sm"><thead class="bg-gray-50"><tr><th class="text-left p-2">Zaman</th><th class="text-left p-2">IP</th><th class="text-left p-2">Kullanıcı</th><th class="text-left p-2">İşlem</th><th class="text-left p-2">Hedef</th><th class="text-left p-2">Detay</th></tr></thead><tbody>' +
        (Array.isArray(list) ? list : []).map(function (e) {
          var det = e.details && typeof e.details === 'object' ? JSON.stringify(e.details) : (e.details || '');
          return '<tr class="border-t"><td class="p-2">' + escapeHtml(e.time ? new Date(e.time).toLocaleString('tr-TR') : '') + '</td><td class="p-2">' + escapeHtml(e.ip || '') + '</td><td class="p-2">' + escapeHtml(e.username || '') + '</td><td class="p-2">' + escapeHtml(e.action || '') + '</td><td class="p-2">' + escapeHtml(e.targetType || '') + ' ' + escapeHtml(e.targetId || '') + '</td><td class="p-2 text-gray-600">' + escapeHtml(det) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    fetchApi(API + '/logs/auth').then(function (r) { return r.ok ? safeJson(r) : []; }).then(function (authList) {
      renderAuth(authList);
      document.getElementById('tab-auth-log').classList.add('bg-blue-600', 'text-white');
      document.getElementById('tab-auth-log').classList.remove('border');
      document.getElementById('tab-audit-log').classList.remove('bg-blue-600', 'text-white');
      document.getElementById('tab-audit-log').classList.add('border');
    }).catch(function () { content.innerHTML = '<p class="p-4 text-gray-500">Giriş logları yüklenemedi.</p>'; });
    document.getElementById('tab-auth-log').addEventListener('click', function () {
      fetchApi(API + '/logs/auth').then(function (r) { return r.ok ? safeJson(r) : []; }).then(renderAuth);
      this.classList.add('bg-blue-600', 'text-white'); this.classList.remove('border');
      document.getElementById('tab-audit-log').classList.remove('bg-blue-600', 'text-white'); document.getElementById('tab-audit-log').classList.add('border');
    });
    document.getElementById('tab-audit-log').addEventListener('click', function () {
      fetchApi(API + '/logs/audit').then(function (r) { return r.ok ? safeJson(r) : []; }).then(renderAudit);
      this.classList.add('bg-blue-600', 'text-white'); this.classList.remove('border');
      document.getElementById('tab-auth-log').classList.remove('bg-blue-600', 'text-white'); document.getElementById('tab-auth-log').classList.add('border');
    });
  }

  // ---------- Grafikler (görüntülenme analizi) ----------
  function buildGrafiklerChart(canvasId, list, opts, chartType) {
    if (typeof Chart === 'undefined') return null;
    var ctx = document.getElementById(canvasId);
    if (!ctx || !ctx.getContext) return null;
    chartType = chartType || 'bar';
    opts = opts || {};
    var labelKey = opts.labelKey || 'title';
    var title = opts.title || 'Görüntülenme';
    var listCopy = (Array.isArray(list) ? list : []).slice();
    listCopy.sort(function (a, b) { return (b.view_count || 0) - (a.view_count || 0); });
    var labels = listCopy.map(function (x) {
      var t = (x[labelKey] || '').toString().trim();
      return t.length > 40 ? t.slice(0, 37) + '...' : t || '(Başlıksız)';
    });
    var data = listCopy.map(function (x) { return x.view_count || 0; });
    if (labels.length === 0) { labels = ['Henüz veri yok']; data = [0]; }
    var isBar = chartType === 'bar';
    var dataset = {
      label: 'Görüntülenme',
      data: data,
      backgroundColor: 'rgba(59, 130, 246, 0.6)',
      borderColor: 'rgb(37, 99, 235)',
      borderWidth: 1
    };
    if (!isBar) {
      dataset.fill = true;
      dataset.tension = 0.3;
    }
    var options = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { title: { display: true, text: title } },
      scales: {}
    };
    if (isBar) {
      options.indexAxis = 'y';
      options.scales.x = { beginAtZero: true, title: { display: true, text: 'Görüntülenme sayısı' } };
      options.scales.y = { ticks: { maxRotation: 0, autoSkip: false, font: { size: 11 } } };
    } else {
      options.scales.x = { ticks: { maxRotation: 45, autoSkip: true, font: { size: 10 } } };
      options.scales.y = { beginAtZero: true, title: { display: true, text: 'Görüntülenme sayısı' } };
    }
    var chart = new Chart(ctx, {
      type: isBar ? 'bar' : 'line',
      data: { labels: labels, datasets: [dataset] },
      options: options
    });
    if (grafiklerChartMap[canvasId]) {
      var idx = grafiklerChartInstances.indexOf(grafiklerChartMap[canvasId]);
      if (idx !== -1) grafiklerChartInstances.splice(idx, 1);
    }
    grafiklerChartMap[canvasId] = chart;
    if (canvasId.indexOf('grafikler-') === 0 || canvasId.indexOf('editor-grafik-') === 0) grafiklerChartInstances.push(chart);
    return chart;
  }

  function toggleGrafikType(canvasId, btn) {
    var stored = grafiklerChartData[canvasId];
    if (!stored) return;
    var chart = grafiklerChartMap[canvasId];
    if (chart) {
      chart.destroy();
      grafiklerChartMap[canvasId] = null;
      var idx = grafiklerChartInstances.indexOf(chart);
      if (idx !== -1) grafiklerChartInstances.splice(idx, 1);
    }
    var nextType = stored.currentType === 'bar' ? 'line' : 'bar';
    stored.currentType = nextType;
    buildGrafiklerChart(canvasId, stored.list, stored.opts, nextType);
    if (btn) {
      btn.textContent = nextType === 'bar' ? 'Çizgi grafiğe geç' : 'Çubuk grafiğe geç';
    }
  }

  function loadGrafiklerSection() {
    grafiklerChartInstances.forEach(function (c) { try { c.destroy(); } catch (_) {} });
    grafiklerChartInstances = [];
    grafiklerChartInstance = null;
    grafiklerChartMap = {};
    grafiklerChartData = {};
    var isEditor = currentUser.rol === 'editor';
    var sub = isEditor ? 'Sadece sizin paylaştığınız içeriklerin görüntülenme sayıları.' : 'Tüm paylaşılan içeriklerin görüntülenme analizi.';
    var html = '<div class="mb-4"><h3 class="text-xl font-bold text-gray-800">Grafikler</h3>';
    html += '<p class="text-sm text-gray-600 mt-1">' + sub + '</p></div>';
    html += '<div class="space-y-8">';
    html += '<div class="bg-white rounded-xl border p-6"><div class="flex flex-wrap items-center justify-between gap-2 mb-4"><h4 class="text-lg font-semibold text-gray-800">Duyurular / Haberler</h4><button type="button" class="grafik-toggle-btn px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50" data-canvas-id="grafikler-haberler">Çizgi grafiğe geç</button></div><div class="h-[400px] max-w-4xl"><canvas id="grafikler-haberler"></canvas></div></div>';
    html += '<div class="bg-white rounded-xl border p-6"><div class="flex flex-wrap items-center justify-between gap-2 mb-4"><h4 class="text-lg font-semibold text-gray-800">Slider</h4><button type="button" class="grafik-toggle-btn px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50" data-canvas-id="grafikler-slider">Çizgi grafiğe geç</button></div><div class="h-[400px] max-w-4xl"><canvas id="grafikler-slider"></canvas></div></div>';
    html += '<div class="bg-white rounded-xl border p-6"><div class="flex flex-wrap items-center justify-between gap-2 mb-4"><h4 class="text-lg font-semibold text-gray-800">Hizmetler</h4><button type="button" class="grafik-toggle-btn px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50" data-canvas-id="grafikler-hizmetler">Çizgi grafiğe geç</button></div><div class="h-[400px] max-w-4xl"><canvas id="grafikler-hizmetler"></canvas></div></div>';
    html += '<div class="bg-white rounded-xl border p-6"><div class="flex flex-wrap items-center justify-between gap-2 mb-4"><h4 class="text-lg font-semibold text-gray-800">Referanslar</h4><button type="button" class="grafik-toggle-btn px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50" data-canvas-id="grafikler-referanslar">Çizgi grafiğe geç</button></div><div class="h-[400px] max-w-4xl"><canvas id="grafikler-referanslar"></canvas></div></div>';
    html += '</div>';
    renderList(html);
    var uid = isEditor && currentUser.userId != null ? String(currentUser.userId) : null;
    function filterByUser(arr) {
      if (!uid || !Array.isArray(arr)) return arr || [];
      return arr.filter(function (x) { return String(x.ekleyenKullaniciId) === uid; });
    }
    function attachToggleHandlers() {
      document.querySelectorAll('.grafik-toggle-btn').forEach(function (btn) {
        var canvasId = btn.getAttribute('data-canvas-id');
        if (!canvasId) return;
        btn.addEventListener('click', function () { toggleGrafikType(canvasId, btn); });
      });
    }
    Promise.all([
      fetchApi(API + '/haberler').then(function (r) { return r.ok ? safeJson(r) : []; }),
      fetchApi(API + '/slider').then(function (r) { return r.ok ? safeJson(r) : []; }),
      fetchApi(API + '/hizmetler').then(function (r) { return r.ok ? safeJson(r) : []; }),
      fetchApi(API + '/referanslar').then(function (r) { return r.ok ? safeJson(r) : []; })
    ]).then(function (results) {
      var haberler = filterByUser(results[0]);
      var slider = filterByUser(results[1]);
      var hizmetler = filterByUser(results[2]);
      var referanslar = filterByUser(results[3]);
      var optsH = { labelKey: 'title', title: 'Duyurular — Görüntülenme' };
      var optsS = { labelKey: 'baslik', title: 'Slider — Görüntülenme' };
      var optsHz = { labelKey: 'baslik', title: 'Hizmetler — Görüntülenme' };
      var optsR = { labelKey: 'firmaAdi', title: 'Referanslar — Görüntülenme' };
      grafiklerChartData['grafikler-haberler'] = { list: haberler, opts: optsH, currentType: 'bar' };
      grafiklerChartData['grafikler-slider'] = { list: slider, opts: optsS, currentType: 'bar' };
      grafiklerChartData['grafikler-hizmetler'] = { list: hizmetler, opts: optsHz, currentType: 'bar' };
      grafiklerChartData['grafikler-referanslar'] = { list: referanslar, opts: optsR, currentType: 'bar' };
      buildGrafiklerChart('grafikler-haberler', haberler, optsH, 'bar');
      buildGrafiklerChart('grafikler-slider', slider, optsS, 'bar');
      buildGrafiklerChart('grafikler-hizmetler', hizmetler, optsHz, 'bar');
      buildGrafiklerChart('grafikler-referanslar', referanslar, optsR, 'bar');
      attachToggleHandlers();
    }).catch(function () {
      renderList('<div class="p-6 rounded-xl border bg-red-50 text-red-700">Grafik verisi yüklenemedi.</div>');
    });
  }

  // ---------- Kullanıcı Yönetimi (sadece Admin) ----------
  function showEditorDuyurularModal(editorId, editorName) {
    fetchApi(API + '/haberler').then(function (r) { return r.ok ? safeJson(r) : Promise.reject(); }).then(function (haberler) {
      var list = (Array.isArray(haberler) ? haberler : []).filter(function (h) { return String(h.ekleyenKullaniciId) === String(editorId); });
      list.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      var overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'Editör duyuruları');
      var box = document.createElement('div');
      box.className = 'bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col';
      box.innerHTML =
        '<div class="p-4 border-b border-gray-200 flex justify-between items-center">' +
        '<h3 class="text-lg font-bold text-gray-800">Editör: ' + escapeHtml(editorName) + ' — Eklenen Duyurular (' + list.length + ')</h3>' +
        '<button type="button" class="modal-close px-3 py-1 rounded-lg hover:bg-gray-100 text-gray-600">&times; Kapat</button></div>' +
        '<div class="p-4 overflow-auto flex-1">' +
        (list.length === 0
          ? '<p class="text-gray-500">Bu editör henüz duyuru eklememiş.</p>'
          : '<table class="w-full text-sm"><thead><tr class="text-left border-b"><th class="p-2 text-gray-600">Oluşturulma zamanı</th><th class="p-2 text-gray-600">Başlık</th><th class="p-2 text-gray-600">Kategori</th></tr></thead><tbody>' +
            list.map(function (h) {
              var olusturulma = h.created_at ? new Date(h.created_at).toLocaleString('tr-TR') : '—';
              var haberUrl = '/haber/' + encodeURIComponent(h.id);
              var baslikHtml = '<a href="' + escapeHtml(haberUrl) + '" class="text-blue-600 hover:underline font-medium" target="_blank" rel="noopener">' + escapeHtml(h.title || '') + '</a>';
              return '<tr class="border-b border-gray-100"><td class="p-2 text-gray-600">' + escapeHtml(olusturulma) + '</td><td class="p-2">' + baslikHtml + '</td><td class="p-2">' + escapeHtml(h.category || '') + '</td></tr>';
            }).join('') +
            '</tbody></table>') +
        '</div>';
      overlay.appendChild(box);
      function close() { overlay.remove(); document.body.style.overflow = ''; }
      box.querySelector('.modal-close').addEventListener('click', close);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
      document.body.style.overflow = 'hidden';
      document.body.appendChild(overlay);
    }).catch(function () { toast('Duyurular yüklenemedi.', 'error'); });
  }

  function showEditorHizmetlerModal(editorId, editorName) {
    fetchApi(API + '/hizmetler').then(function (r) { return r.ok ? safeJson(r) : Promise.reject(); }).then(function (all) {
      var list = (Array.isArray(all) ? all : []).filter(function (h) { return String(h.ekleyenKullaniciId) === String(editorId); });
      list.sort(function (a, b) { return (a.sira || 0) - (b.sira || 0); });
      var overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'Editör hizmetleri');
      var box = document.createElement('div');
      box.className = 'bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col';
      box.innerHTML =
        '<div class="p-4 border-b border-gray-200 flex justify-between items-center">' +
        '<h3 class="text-lg font-bold text-gray-800">Editör: ' + escapeHtml(editorName) + ' — Hizmetler (' + list.length + ')</h3>' +
        '<button type="button" class="modal-close px-3 py-1 rounded-lg hover:bg-gray-100 text-gray-600">&times; Kapat</button></div>' +
        '<div class="p-4 overflow-auto flex-1">' +
        (list.length === 0
          ? '<p class="text-gray-500">Bu editör henüz hizmet eklememiş.</p>'
          : '<table class="w-full text-sm"><thead><tr class="text-left border-b"><th class="p-2 text-gray-600">Sıra</th><th class="p-2 text-gray-600">Başlık</th><th class="p-2 text-gray-600">Oluşturulma zamanı</th><th class="p-2 text-gray-600">İşlem</th></tr></thead><tbody>' +
            list.map(function (h) {
              var olusturulma = h.created_at ? new Date(h.created_at).toLocaleString('tr-TR') : '—';
              var url = '/hizmet/' + encodeURIComponent(h.id);
              var linkHtml = '<a href="' + escapeHtml(url) + '" class="text-blue-600 hover:underline font-medium" target="_blank" rel="noopener">' + escapeHtml(h.baslik || '') + '</a>';
              return '<tr class="border-b border-gray-100"><td class="p-2">' + (h.sira ?? '') + '</td><td class="p-2">' + linkHtml + '</td><td class="p-2 text-gray-600">' + escapeHtml(olusturulma) + '</td><td class="p-2"><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" class="text-blue-600 hover:underline">İçeriğe git →</a></td></tr>';
            }).join('') +
            '</tbody></table>') +
        '</div>';
      overlay.appendChild(box);
      function close() { overlay.remove(); document.body.style.overflow = ''; }
      box.querySelector('.modal-close').addEventListener('click', close);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
      document.body.style.overflow = 'hidden';
      document.body.appendChild(overlay);
    }).catch(function () { toast('Hizmetler yüklenemedi.', 'error'); });
  }

  function showEditorReferanslarModal(editorId, editorName) {
    fetchApi(API + '/referanslar').then(function (r) { return r.ok ? safeJson(r) : Promise.reject(); }).then(function (all) {
      var list = (Array.isArray(all) ? all : []).filter(function (r) { return String(r.ekleyenKullaniciId) === String(editorId); });
      list.sort(function (a, b) { return (a.sira || 0) - (b.sira || 0); });
      var overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'Editör referansları');
      var box = document.createElement('div');
      box.className = 'bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col';
      var rows = list.length === 0
        ? '<p class="text-gray-500">Bu editör henüz referans eklememiş.</p>'
        : '<table class="w-full text-sm"><thead><tr class="text-left border-b"><th class="p-2 text-gray-600">Sıra</th><th class="p-2 text-gray-600">Firma</th><th class="p-2 text-gray-600">Oluşturulma zamanı</th><th class="p-2 text-gray-600">İşlem</th></tr></thead><tbody>' +
            list.map(function (r, idx) {
              var olusturulma = r.created_at ? new Date(r.created_at).toLocaleString('tr-TR') : '—';
              return '<tr class="border-b border-gray-100"><td class="p-2">' + (r.sira ?? '') + '</td><td class="p-2">' + escapeHtml(r.firmaAdi || '') + '</td><td class="p-2 text-gray-600">' + escapeHtml(olusturulma) + '</td><td class="p-2"><button type="button" class="view-ref-item text-blue-600 hover:underline" data-idx="' + idx + '">Görüntüle / İçeriğe git</button></td></tr>';
            }).join('') + '</tbody></table>';
      box.innerHTML =
        '<div class="p-4 border-b border-gray-200 flex justify-between items-center">' +
        '<h3 class="text-lg font-bold text-gray-800">Editör: ' + escapeHtml(editorName) + ' — Referanslar (' + list.length + ')</h3>' +
        '<button type="button" class="modal-close px-3 py-1 rounded-lg hover:bg-gray-100 text-gray-600">&times; Kapat</button></div>' +
        '<div class="p-4 overflow-auto flex-1">' + rows + '</div>';
      overlay.appendChild(box);
      list.forEach(function (r, idx) {
        var body = (r.logo ? '<p class="mb-2"><img src="' + escapeHtml(r.logo) + '" alt="" class="max-h-24 object-contain"></p>' : '') + '<p><strong>Firma:</strong> ' + escapeHtml(r.firmaAdi || '') + '</p><div class="text-sm text-gray-700 mt-1">' + (r.aciklama || '—') + '</div>';
        overlay.querySelector('.view-ref-item[data-idx="' + idx + '"]') && overlay.querySelector('.view-ref-item[data-idx="' + idx + '"]').addEventListener('click', function () { showContentViewModal('Referans: ' + (r.firmaAdi || ''), body); });
      });
      function close() { overlay.remove(); document.body.style.overflow = ''; }
      box.querySelector('.modal-close').addEventListener('click', close);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
      document.body.style.overflow = 'hidden';
      document.body.appendChild(overlay);
    }).catch(function () { toast('Referanslar yüklenemedi.', 'error'); });
  }

  function showEditorSliderModal(editorId, editorName) {
    fetchApi(API + '/slider').then(function (r) { return r.ok ? safeJson(r) : Promise.reject(); }).then(function (all) {
      var list = (Array.isArray(all) ? all : []).filter(function (s) { return String(s.ekleyenKullaniciId) === String(editorId); });
      list.sort(function (a, b) { return (a.sira || 0) - (b.sira || 0); });
      var overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'Editör slider');
      var box = document.createElement('div');
      box.className = 'bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col';
      var rows = list.length === 0
        ? '<p class="text-gray-500">Bu editör henüz slider eklememiş.</p>'
        : '<table class="w-full text-sm"><thead><tr class="text-left border-b"><th class="p-2 text-gray-600">Sıra</th><th class="p-2 text-gray-600">Başlık</th><th class="p-2 text-gray-600">Oluşturulma zamanı</th><th class="p-2 text-gray-600">İşlem</th></tr></thead><tbody>' +
            list.map(function (s, idx) {
              var olusturulma = s.created_at ? new Date(s.created_at).toLocaleString('tr-TR') : '—';
              return '<tr class="border-b border-gray-100"><td class="p-2">' + (s.sira ?? '') + '</td><td class="p-2">' + escapeHtml(s.baslik || '') + '</td><td class="p-2 text-gray-600">' + escapeHtml(olusturulma) + '</td><td class="p-2"><button type="button" class="view-slider-item text-blue-600 hover:underline" data-idx="' + idx + '">Görüntüle / İçeriğe git</button></td></tr>';
            }).join('') + '</tbody></table>';
      box.innerHTML =
        '<div class="p-4 border-b border-gray-200 flex justify-between items-center">' +
        '<h3 class="text-lg font-bold text-gray-800">Editör: ' + escapeHtml(editorName) + ' — Slider (' + list.length + ')</h3>' +
        '<button type="button" class="modal-close px-3 py-1 rounded-lg hover:bg-gray-100 text-gray-600">&times; Kapat</button></div>' +
        '<div class="p-4 overflow-auto flex-1">' + rows + '</div>';
      overlay.appendChild(box);
      list.forEach(function (s, idx) {
        var body = (s.resim ? '<p class="mb-2"><img src="' + escapeHtml(s.resim) + '" alt="" class="max-w-full rounded-lg border max-h-48 object-cover"></p>' : '') + '<p><strong>Başlık:</strong> ' + escapeHtml(s.baslik || '') + '</p><p class="mt-1"><strong>Alt başlık:</strong> ' + escapeHtml(s.altBaslik || '') + '</p><p class="mt-1"><strong>Buton yazısı:</strong> ' + escapeHtml(s.butonYazisi || '') + '</p><p class="mt-1"><strong>Buton linki:</strong> ' + (s.butonLink ? '<a href="' + escapeHtml(s.butonLink) + '" target="_blank" rel="noopener" class="text-blue-600 hover:underline">' + escapeHtml(s.butonLink) + '</a>' : '—') + '</p>';
        overlay.querySelector('.view-slider-item[data-idx="' + idx + '"]') && overlay.querySelector('.view-slider-item[data-idx="' + idx + '"]').addEventListener('click', function () { showContentViewModal('Slider: ' + (s.baslik || ''), body); });
      });
      function close() { overlay.remove(); document.body.style.overflow = ''; }
      box.querySelector('.modal-close').addEventListener('click', close);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
      document.body.style.overflow = 'hidden';
      document.body.appendChild(overlay);
    }).catch(function () { toast('Slider yüklenemedi.', 'error'); });
  }

  function showEditorGrafikModal(editorId, editorName) {
    var eid = String(editorId);
    Promise.all([
      fetchApi(API + '/haberler').then(function (r) { return r.ok ? safeJson(r) : []; }),
      fetchApi(API + '/slider').then(function (r) { return r.ok ? safeJson(r) : []; }),
      fetchApi(API + '/hizmetler').then(function (r) { return r.ok ? safeJson(r) : []; }),
      fetchApi(API + '/referanslar').then(function (r) { return r.ok ? safeJson(r) : []; })
    ]).then(function (results) {
      var haberler = (Array.isArray(results[0]) ? results[0] : []).filter(function (x) { return String(x.ekleyenKullaniciId) === eid; });
      var slider = (Array.isArray(results[1]) ? results[1] : []).filter(function (x) { return String(x.ekleyenKullaniciId) === eid; });
      var hizmetler = (Array.isArray(results[2]) ? results[2] : []).filter(function (x) { return String(x.ekleyenKullaniciId) === eid; });
      var referanslar = (Array.isArray(results[3]) ? results[3] : []).filter(function (x) { return String(x.ekleyenKullaniciId) === eid; });
      var overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'Editör görüntülenme grafiği');
      var box = document.createElement('div');
      box.className = 'bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col';
      box.innerHTML =
        '<div class="p-4 border-b border-gray-200 flex justify-between items-center">' +
        '<h3 class="text-lg font-bold text-gray-800">Editör: ' + escapeHtml(editorName) + ' — Görüntülenme grafikleri</h3>' +
        '<button type="button" class="modal-close px-3 py-1 rounded-lg hover:bg-gray-100 text-gray-600">&times; Kapat</button></div>' +
        '<div class="p-4 overflow-auto flex-1 space-y-6">' +
        '<div><div class="flex flex-wrap items-center justify-between gap-2 mb-2"><h4 class="text-sm font-semibold text-gray-700">Duyurular</h4><button type="button" class="grafik-toggle-btn px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50" data-canvas-id="editor-grafik-haberler">Çizgi grafiğe geç</button></div><div class="h-[280px]"><canvas id="editor-grafik-haberler"></canvas></div></div>' +
        '<div><div class="flex flex-wrap items-center justify-between gap-2 mb-2"><h4 class="text-sm font-semibold text-gray-700">Slider</h4><button type="button" class="grafik-toggle-btn px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50" data-canvas-id="editor-grafik-slider">Çizgi grafiğe geç</button></div><div class="h-[280px]"><canvas id="editor-grafik-slider"></canvas></div></div>' +
        '<div><div class="flex flex-wrap items-center justify-between gap-2 mb-2"><h4 class="text-sm font-semibold text-gray-700">Hizmetler</h4><button type="button" class="grafik-toggle-btn px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50" data-canvas-id="editor-grafik-hizmetler">Çizgi grafiğe geç</button></div><div class="h-[280px]"><canvas id="editor-grafik-hizmetler"></canvas></div></div>' +
        '<div><div class="flex flex-wrap items-center justify-between gap-2 mb-2"><h4 class="text-sm font-semibold text-gray-700">Referanslar</h4><button type="button" class="grafik-toggle-btn px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50" data-canvas-id="editor-grafik-referanslar">Çizgi grafiğe geç</button></div><div class="h-[280px]"><canvas id="editor-grafik-referanslar"></canvas></div></div>' +
        '</div>';
      overlay.appendChild(box);
      document.body.style.overflow = 'hidden';
      document.body.appendChild(overlay);
      var optsH = { labelKey: 'title', title: 'Duyurular — Görüntülenme' };
      var optsS = { labelKey: 'baslik', title: 'Slider — Görüntülenme' };
      var optsHz = { labelKey: 'baslik', title: 'Hizmetler — Görüntülenme' };
      var optsR = { labelKey: 'firmaAdi', title: 'Referanslar — Görüntülenme' };
      grafiklerChartData['editor-grafik-haberler'] = { list: haberler, opts: optsH, currentType: 'bar' };
      grafiklerChartData['editor-grafik-slider'] = { list: slider, opts: optsS, currentType: 'bar' };
      grafiklerChartData['editor-grafik-hizmetler'] = { list: hizmetler, opts: optsHz, currentType: 'bar' };
      grafiklerChartData['editor-grafik-referanslar'] = { list: referanslar, opts: optsR, currentType: 'bar' };
      buildGrafiklerChart('editor-grafik-haberler', haberler, optsH, 'bar');
      buildGrafiklerChart('editor-grafik-slider', slider, optsS, 'bar');
      buildGrafiklerChart('editor-grafik-hizmetler', hizmetler, optsHz, 'bar');
      buildGrafiklerChart('editor-grafik-referanslar', referanslar, optsR, 'bar');
      box.querySelectorAll('.grafik-toggle-btn').forEach(function (btn) {
        var canvasId = btn.getAttribute('data-canvas-id');
        if (canvasId) btn.addEventListener('click', function () { toggleGrafikType(canvasId, btn); });
      });
      function close() {
        ['editor-grafik-haberler', 'editor-grafik-slider', 'editor-grafik-hizmetler', 'editor-grafik-referanslar'].forEach(function (id) {
          var ch = grafiklerChartMap[id];
          if (ch) {
            try { ch.destroy(); } catch (_) {}
            var i = grafiklerChartInstances.indexOf(ch);
            if (i !== -1) grafiklerChartInstances.splice(i, 1);
          }
          grafiklerChartMap[id] = null;
          delete grafiklerChartData[id];
        });
        overlay.remove();
        document.body.style.overflow = '';
      }
      box.querySelector('.modal-close').addEventListener('click', close);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    }).catch(function () { toast('Veri yüklenemedi.', 'error'); });
  }

  function loadKullanicilarList() {
    fetchApi(API + '/users')
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Kullanıcı listesi yüklenemedi.'); });
        return safeJson(r);
      })
      .then(function (list) {
        var html = '<div class="flex justify-between items-center mb-4"><h3 class="text-xl font-bold text-gray-800">Kullanıcı Yönetimi</h3><button type="button" id="btn-new-user" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Yeni Kullanıcı Ekle</button></div>';
        html += '<p class="text-sm text-gray-600 mb-3">Admin, editor kullanıcı adı ve e-postasını burada görür; şifre düzenleme için Düzenle kullanılır. Editorlerin eklediği duyuru, hizmet, referans ve slider içeriklerini aşağıdaki linklerle görüntüleyebilir, tıklayarak içeriğe gidebilirsiniz.</p>';
        html += '<div class="bg-white rounded-xl border overflow-hidden"><table class="w-full"><thead class="bg-gray-50"><tr><th class="text-left p-3 text-sm font-medium text-gray-700">Kullanıcı adı</th><th class="text-left p-3 text-sm font-medium text-gray-700">E-posta</th><th class="text-left p-3 text-sm font-medium text-gray-700">Rol</th><th class="text-left p-3 text-sm font-medium text-gray-700">Son giriş</th><th class="text-left p-3 text-sm font-medium text-gray-700">Durum</th><th class="text-left p-3 text-sm font-medium text-gray-700">Kilit</th><th class="text-left p-3 text-sm font-medium text-gray-700">İçerikler</th><th class="text-right p-3 text-sm font-medium text-gray-700">İşlem</th></tr></thead><tbody>';
        (Array.isArray(list) ? list : []).forEach(function (u) {
          var rolBadge = u.rol === 'admin' ? '👑 Admin' : '✏️ Editor';
          var sonGiris = u.sonGiris ? new Date(u.sonGiris).toLocaleString('tr-TR') : '—';
          var kilitli = u.kilitliUntil && new Date(u.kilitliUntil).getTime() > Date.now();
          var kilitCell = kilitli ? '<span class="text-red-600 text-sm">Kilitli</span>' + (u.kilitNedeni ? '<br><span class="text-xs text-gray-500">' + escapeHtml(u.kilitNedeni) + '</span>' : '') + '<br><button type="button" class="btn-unlock-user text-blue-600 hover:underline text-sm mt-1" data-id="' + u.id + '">Kilidi aç</button>' : '—';
          var icerikCell = '—';
          if (u.rol === 'editor') {
            var uid = escapeHtml(String(u.id));
            var uname = escapeHtml(u.kullaniciAdi || '');
            icerikCell = '<div class="flex flex-wrap gap-1 text-sm"><button type="button" class="btn-editor-duyurular text-blue-600 hover:underline" data-id="' + uid + '" data-name="' + uname + '">Duyurular</button><button type="button" class="btn-editor-hizmetler text-blue-600 hover:underline" data-id="' + uid + '" data-name="' + uname + '">Hizmetler</button><button type="button" class="btn-editor-referanslar text-blue-600 hover:underline" data-id="' + uid + '" data-name="' + uname + '">Referanslar</button><button type="button" class="btn-editor-slider text-blue-600 hover:underline" data-id="' + uid + '" data-name="' + uname + '">Slider</button><button type="button" class="btn-editor-grafik text-blue-600 hover:underline font-medium" data-id="' + uid + '" data-name="' + uname + '">📊 Grafikler</button></div>';
          }
          html += '<tr class="border-t"><td class="p-3 font-medium">' + escapeHtml(u.kullaniciAdi) + '</td><td class="p-3">' + escapeHtml(u.email || '') + '</td><td class="p-3">' + rolBadge + '</td><td class="p-3 text-sm text-gray-600">' + sonGiris + '</td><td class="p-3">' + (u.aktif ? 'Aktif' : 'Pasif') + '</td><td class="p-3">' + kilitCell + '</td><td class="p-3">' + icerikCell + '</td><td class="p-3 text-right"><button type="button" class="edit-user mr-2 text-blue-600 hover:underline" data-id="' + u.id + '">Düzenle</button><button type="button" class="delete-user text-red-600 hover:underline" data-id="' + u.id + '">Sil</button></td></tr>';
        });
        html += '</tbody></table></div>';
        renderList(html);
        document.getElementById('btn-new-user').addEventListener('click', function () { editingId = null; showKullaniciForm(); });
        document.querySelectorAll('.edit-user').forEach(function (b) {
          b.addEventListener('click', function () { editingId = parseInt(this.getAttribute('data-id'), 10); showKullaniciForm(editingId); });
        });
        document.querySelectorAll('.delete-user').forEach(function (b) {
          b.addEventListener('click', function () {
            var id = parseInt(this.getAttribute('data-id'), 10);
            confirmDelete('Bu kullanıcıyı silmek istediğinize emin misiniz?', function () {
              fetchApi(API + '/users/' + id, { method: 'DELETE' }).then(function (r) {
                if (r.ok) { toast('Kullanıcı silindi.'); loadKullanicilarList(); } else return safeJson(r).then(function (d) { throw new Error(d.error); });
              }).catch(function (err) { toast(err.message, 'error'); });
            });
          });
        });
        document.querySelectorAll('.btn-editor-duyurular').forEach(function (b) {
          b.addEventListener('click', function () {
            var uid = this.getAttribute('data-id');
            var uname = this.getAttribute('data-name') || 'Editor';
            showEditorDuyurularModal(uid, uname);
          });
        });
        document.querySelectorAll('.btn-editor-hizmetler').forEach(function (b) {
          b.addEventListener('click', function () {
            var uid = this.getAttribute('data-id');
            var uname = this.getAttribute('data-name') || 'Editor';
            showEditorHizmetlerModal(uid, uname);
          });
        });
        document.querySelectorAll('.btn-editor-referanslar').forEach(function (b) {
          b.addEventListener('click', function () {
            var uid = this.getAttribute('data-id');
            var uname = this.getAttribute('data-name') || 'Editor';
            showEditorReferanslarModal(uid, uname);
          });
        });
        document.querySelectorAll('.btn-editor-slider').forEach(function (b) {
          b.addEventListener('click', function () {
            var uid = this.getAttribute('data-id');
            var uname = this.getAttribute('data-name') || 'Editor';
            showEditorSliderModal(uid, uname);
          });
        });
        document.querySelectorAll('.btn-editor-grafik').forEach(function (b) {
          b.addEventListener('click', function () {
            var uid = this.getAttribute('data-id');
            var uname = this.getAttribute('data-name') || 'Editor';
            showEditorGrafikModal(uid, uname);
          });
        });
        document.querySelectorAll('.btn-unlock-user').forEach(function (b) {
          b.addEventListener('click', function () {
            var id = parseInt(this.getAttribute('data-id'), 10);
            fetchApi(API + '/users/' + id + '/unlock', { method: 'PUT' }).then(function (r) {
              if (r.ok) { toast('Hesap kilidi açıldı.'); loadKullanicilarList(); } else return r.json().then(function (d) { throw new Error(d.error); });
            }).catch(function (err) { toast(err.message || 'İşlem başarısız.', 'error'); });
          });
        });
      })
      .catch(function (err) {
        renderList('<div class="p-6 rounded-xl border bg-red-50 text-red-700">' + escapeHtml(err.message) + '</div>');
        toast(err.message, 'error');
      });
  }

  function showKullaniciForm(id) {
    var title = id ? 'Kullanıcı Düzenle' : 'Yeni Kullanıcı Ekle';
    var html = '<div class="max-w-2xl"><h3 class="text-xl font-bold text-gray-800 mb-4">' + title + '</h3>';
    html += '<form id="form-user" class="space-y-4 bg-white p-6 rounded-xl border">';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Kullanıcı adı *</label><input type="text" id="user-kullaniciAdi" class="w-full px-3 py-2 border rounded-lg" required' + (id ? ' readonly' : '') + '></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">E-posta *</label><input type="email" id="user-email" class="w-full px-3 py-2 border rounded-lg" required></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Şifre ' + (id ? '(boş bırakırsanız değişmez)' : '*') + '</label><input type="password" id="user-sifre" class="w-full px-3 py-2 border rounded-lg" ' + (id ? '' : 'required') + ' placeholder="8+ karakter, büyük/küçük harf, rakam, özel karakter"><p id="user-sifre-policy-error" class="text-red-600 text-sm mt-1 hidden" role="alert"></p></div>';
    if (!id) html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Şifre tekrar *</label><input type="password" id="user-sifre2" class="w-full px-3 py-2 border rounded-lg" required><p id="user-sifre-error" class="text-red-600 text-sm mt-1 hidden" role="alert"></p></div>';
    html += '<div><label class="block text-sm font-medium text-gray-700 mb-1">Rol</label><select id="user-rol" class="w-full px-3 py-2 border rounded-lg"><option value="admin">👑 Admin</option><option value="editor">✏️ Editor</option></select></div>';
    html += '<div><label class="flex items-center gap-2"><input type="checkbox" id="user-aktif" checked> Aktif</label></div>';
    html += '<div class="flex gap-2"><button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg">Kaydet</button><button type="button" id="user-iptal" class="px-4 py-2 border rounded-lg">İptal</button></div></form>';
    html += '<div id="user-editor-duyurular" class="mt-6"></div>';
    html += '<div id="user-editor-hizmetler" class="mt-6"></div>';
    html += '<div id="user-editor-referanslar" class="mt-6"></div>';
    html += '<div id="user-editor-slider" class="mt-6"></div></div>';
    renderList(html);

    if (id) {
      fetchApi(API + '/users').then(function (r) { return safeJson(r); }).then(function (list) {
        var u = (Array.isArray(list) ? list : []).find(function (x) { return x.id === id; });
        if (u) {
          document.getElementById('user-kullaniciAdi').value = u.kullaniciAdi || '';
          document.getElementById('user-email').value = u.email || '';
          document.getElementById('user-rol').value = u.rol || 'editor';
          document.getElementById('user-aktif').checked = u.aktif !== false;
          if (u.rol === 'editor') {
            var uid = String(u.id);
            Promise.all([
              fetchApi(API + '/haberler').then(function (r) { return r.ok ? safeJson(r) : []; }),
              fetchApi(API + '/hizmetler').then(function (r) { return r.ok ? safeJson(r) : []; }),
              fetchApi(API + '/referanslar').then(function (r) { return r.ok ? safeJson(r) : []; }),
              fetchApi(API + '/slider').then(function (r) { return r.ok ? safeJson(r) : []; })
            ]).then(function (results) {
              var haberler = (Array.isArray(results[0]) ? results[0] : []).filter(function (h) { return String(h.ekleyenKullaniciId) === uid; });
              var hizmetler = (Array.isArray(results[1]) ? results[1] : []).filter(function (h) { return String(h.ekleyenKullaniciId) === uid; });
              var referanslar = (Array.isArray(results[2]) ? results[2] : []).filter(function (r) { return String(r.ekleyenKullaniciId) === uid; });
              var slider = (Array.isArray(results[3]) ? results[3] : []).filter(function (s) { return String(s.ekleyenKullaniciId) === uid; });
              haberler.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
              hizmetler.sort(function (a, b) { return (a.sira || 0) - (b.sira || 0); });
              referanslar.sort(function (a, b) { return (a.sira || 0) - (b.sira || 0); });
              slider.sort(function (a, b) { return (a.sira || 0) - (b.sira || 0); });

              var cDuy = document.getElementById('user-editor-duyurular');
              if (cDuy) cDuy.innerHTML = '<div class="bg-white rounded-xl border p-4"><h4 class="text-sm font-semibold text-gray-700 mb-3">Bu editörün eklediği duyurular (' + haberler.length + ')</h4>' +
                (haberler.length === 0 ? '<p class="text-gray-500 text-sm">Henüz duyuru eklenmemiş.</p>' :
                  '<table class="w-full text-sm"><thead><tr class="text-left border-b text-gray-600"><th class="p-2">Oluşturulma zamanı</th><th class="p-2">Başlık</th><th class="p-2">Kategori</th></tr></thead><tbody>' +
                  haberler.map(function (h) {
                    var olusturulma = h.created_at ? new Date(h.created_at).toLocaleString('tr-TR') : '—';
                    var haberUrl = '/haber/' + encodeURIComponent(h.id);
                    var baslikHtml = '<a href="' + escapeHtml(haberUrl) + '" class="text-blue-600 hover:underline font-medium" target="_blank" rel="noopener">' + escapeHtml(h.title || '') + '</a>';
                    return '<tr class="border-b border-gray-100"><td class="p-2 text-gray-600">' + escapeHtml(olusturulma) + '</td><td class="p-2">' + baslikHtml + '</td><td class="p-2">' + escapeHtml(h.category || '') + '</td></tr>';
                  }).join('') + '</tbody></table>') + '</div>';

              var cHiz = document.getElementById('user-editor-hizmetler');
              if (cHiz) cHiz.innerHTML = '<div class="bg-white rounded-xl border p-4"><h4 class="text-sm font-semibold text-gray-700 mb-3">Bu editörün eklediği hizmetler (' + hizmetler.length + ')</h4>' +
                (hizmetler.length === 0 ? '<p class="text-gray-500 text-sm">Henüz hizmet eklenmemiş.</p>' :
                  '<table class="w-full text-sm"><thead><tr class="text-left border-b text-gray-600"><th class="p-2">Sıra</th><th class="p-2">Başlık</th><th class="p-2">Oluşturulma zamanı</th><th class="p-2">İşlem</th></tr></thead><tbody>' +
                  hizmetler.map(function (h) {
                    var olusturulma = h.created_at ? new Date(h.created_at).toLocaleString('tr-TR') : '—';
                    var url = '/hizmet/' + encodeURIComponent(h.id);
                    var linkHtml = '<a href="' + escapeHtml(url) + '" class="text-blue-600 hover:underline font-medium" target="_blank" rel="noopener">' + escapeHtml(h.baslik || '') + '</a>';
                    return '<tr class="border-b border-gray-100"><td class="p-2">' + (h.sira ?? '') + '</td><td class="p-2">' + linkHtml + '</td><td class="p-2 text-gray-600">' + escapeHtml(olusturulma) + '</td><td class="p-2"><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" class="text-blue-600 hover:underline">İçeriğe git →</a></td></tr>';
                  }).join('') + '</tbody></table>') + '</div>';

              var cRef = document.getElementById('user-editor-referanslar');
              if (cRef) {
                var refRows = referanslar.length === 0 ? '<p class="text-gray-500 text-sm">Henüz referans eklenmemiş.</p>' :
                  '<table class="w-full text-sm"><thead><tr class="text-left border-b text-gray-600"><th class="p-2">Sıra</th><th class="p-2">Firma</th><th class="p-2">Oluşturulma zamanı</th><th class="p-2">İşlem</th></tr></thead><tbody>' +
                  referanslar.map(function (r, idx) {
                    var olusturulma = r.created_at ? new Date(r.created_at).toLocaleString('tr-TR') : '—';
                    return '<tr class="border-b border-gray-100"><td class="p-2">' + (r.sira ?? '') + '</td><td class="p-2">' + escapeHtml(r.firmaAdi || '') + '</td><td class="p-2 text-gray-600">' + escapeHtml(olusturulma) + '</td><td class="p-2"><button type="button" class="user-form-view-ref text-blue-600 hover:underline" data-idx="' + idx + '">Görüntüle / İçeriğe git</button></td></tr>';
                  }).join('') + '</tbody></table>';
                cRef.innerHTML = '<div class="bg-white rounded-xl border p-4"><h4 class="text-sm font-semibold text-gray-700 mb-3">Bu editörün eklediği referanslar (' + referanslar.length + ')</h4>' + refRows + '</div>';
                referanslar.forEach(function (r, idx) {
                  var btn = cRef.querySelector('.user-form-view-ref[data-idx="' + idx + '"]');
                  if (btn) {
                    var body = (r.logo ? '<p class="mb-2"><img src="' + escapeHtml(r.logo) + '" alt="" class="max-h-24 object-contain"></p>' : '') + '<p><strong>Firma:</strong> ' + escapeHtml(r.firmaAdi || '') + '</p><div class="text-sm text-gray-700 mt-1">' + (r.aciklama || '—') + '</div>';
                    btn.addEventListener('click', function () { showContentViewModal('Referans: ' + (r.firmaAdi || ''), body); });
                  }
                });
              }

              var cSl = document.getElementById('user-editor-slider');
              if (cSl) {
                var slRows = slider.length === 0 ? '<p class="text-gray-500 text-sm">Henüz slider eklenmemiş.</p>' :
                  '<table class="w-full text-sm"><thead><tr class="text-left border-b text-gray-600"><th class="p-2">Sıra</th><th class="p-2">Başlık</th><th class="p-2">Oluşturulma zamanı</th><th class="p-2">İşlem</th></tr></thead><tbody>' +
                  slider.map(function (s, idx) {
                    var olusturulma = s.created_at ? new Date(s.created_at).toLocaleString('tr-TR') : '—';
                    return '<tr class="border-b border-gray-100"><td class="p-2">' + (s.sira ?? '') + '</td><td class="p-2">' + escapeHtml(s.baslik || '') + '</td><td class="p-2 text-gray-600">' + escapeHtml(olusturulma) + '</td><td class="p-2"><button type="button" class="user-form-view-slider text-blue-600 hover:underline" data-idx="' + idx + '">Görüntüle / İçeriğe git</button></td></tr>';
                  }).join('') + '</tbody></table>';
                cSl.innerHTML = '<div class="bg-white rounded-xl border p-4"><h4 class="text-sm font-semibold text-gray-700 mb-3">Bu editörün eklediği slider (' + slider.length + ')</h4>' + slRows + '</div>';
                slider.forEach(function (s, idx) {
                  var btn = cSl.querySelector('.user-form-view-slider[data-idx="' + idx + '"]');
                  if (btn) {
                    var body = (s.resim ? '<p class="mb-2"><img src="' + escapeHtml(s.resim) + '" alt="" class="max-w-full rounded-lg border max-h-48 object-cover"></p>' : '') + '<p><strong>Başlık:</strong> ' + escapeHtml(s.baslik || '') + '</p><p class="mt-1"><strong>Alt başlık:</strong> ' + escapeHtml(s.altBaslik || '') + '</p><p class="mt-1"><strong>Buton yazısı:</strong> ' + escapeHtml(s.butonYazisi || '') + '</p><p class="mt-1"><strong>Buton linki:</strong> ' + (s.butonLink ? '<a href="' + escapeHtml(s.butonLink) + '" target="_blank" rel="noopener" class="text-blue-600 hover:underline">' + escapeHtml(s.butonLink) + '</a>' : '—') + '</p>';
                    btn.addEventListener('click', function () { showContentViewModal('Slider: ' + (s.baslik || ''), body); });
                  }
                });
              }
            }).catch(function () {
              var cDuy = document.getElementById('user-editor-duyurular');
              if (cDuy) cDuy.innerHTML = '<div class="bg-white rounded-xl border p-4 text-red-600 text-sm">İçerikler yüklenemedi.</div>';
            });
          } else {
            ['user-editor-duyurular', 'user-editor-hizmetler', 'user-editor-referanslar', 'user-editor-slider'].forEach(function (cid) {
              var el = document.getElementById(cid);
              if (el) el.innerHTML = '';
            });
          }
        }
      });
    } else {
      ['user-editor-duyurular', 'user-editor-hizmetler', 'user-editor-referanslar', 'user-editor-slider'].forEach(function (cid) {
        var el = document.getElementById(cid);
        if (el) el.innerHTML = '';
      });
    }

    document.getElementById('user-iptal').addEventListener('click', function () { loadKullanicilarList(); });
    function clearSifreErrors() {
      var err = document.getElementById('user-sifre-error');
      if (err) { err.classList.add('hidden'); err.textContent = ''; }
      var policyErr = document.getElementById('user-sifre-policy-error');
      if (policyErr) { policyErr.classList.add('hidden'); policyErr.textContent = ''; }
    }
    var sifreInput = document.getElementById('user-sifre');
    var sifre2Input = document.getElementById('user-sifre2');
    if (sifreInput) sifreInput.addEventListener('input', clearSifreErrors);
    if (sifre2Input) sifre2Input.addEventListener('input', clearSifreErrors);
    document.getElementById('form-user').addEventListener('submit', function (e) {
      e.preventDefault();
      clearSifreErrors();
      var sifre = (document.getElementById('user-sifre').value || '').trim();
      var sifre2El = document.getElementById('user-sifre2');
      if (!id && sifre2El) {
        var sifre2 = (sifre2El.value || '').trim();
        if (sifre !== sifre2) {
          var errEl = document.getElementById('user-sifre-error');
          if (errEl) {
            errEl.textContent = 'Şifreler aynı olmalıdır.';
            errEl.classList.remove('hidden');
          }
          return;
        }
      }
      var body = {
        kullaniciAdi: document.getElementById('user-kullaniciAdi').value.trim(),
        email: document.getElementById('user-email').value.trim(),
        rol: document.getElementById('user-rol').value,
        aktif: document.getElementById('user-aktif').checked,
      };
      if (sifre) body.sifre = sifre;
      var url = API + '/users', method = 'POST';
      if (id) { url += '/' + id; method = 'PUT'; }
      fetchApi(url, { method: method, body: body }).then(function (r) {
        if (r.ok) { toast('Kaydedildi.'); loadKullanicilarList(); } else return safeJson(r).then(function (d) { throw new Error(d.error || 'Kayıt başarısız.'); });
      }).catch(function (err) {
        var msg = err.message || 'Kayıt başarısız.';
        var policyErrEl = document.getElementById('user-sifre-policy-error');
        if (policyErrEl && (msg.indexOf('Şifre') !== -1 || msg.indexOf('büyük harf') !== -1 || msg.indexOf('rakam') !== -1)) {
          policyErrEl.textContent = msg;
          policyErrEl.classList.remove('hidden');
        }
        toast(msg, 'error');
      });
    });
  }

  // Başlangıç
  checkAuth()
    .then(function (me) {
      showPanel(me);
      document.querySelectorAll('.admin-nav').forEach(function (n) { n.classList.remove('bg-gray-700'); });
      var firstNav = me.rol === 'editor' ? document.querySelector('.admin-nav[data-section="haberler"]') : document.querySelector('.admin-nav[data-section="slider"]');
      if (firstNav) firstNav.classList.add('bg-gray-700');
      loadSection(me.rol === 'editor' ? 'haberler' : 'slider');
    })
    .catch(function () {
      showLogin();
    });
})();
