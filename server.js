require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const bcrypt = require('bcrypt');
const session = require('express-session');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const xss = require('xss');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const isProduction = process.env.NODE_ENV === 'production';

const DATA_FILES = {
  albums: path.join(DATA_DIR, 'albums.json'),
  admin: path.join(DATA_DIR, 'admin.json'),
  users: path.join(DATA_DIR, 'users.json'),
  slider: path.join(DATA_DIR, 'slider.json'),
  hizmetler: path.join(DATA_DIR, 'hizmetler.json'),
  referanslar: path.join(DATA_DIR, 'referanslar.json'),
  iletisim: path.join(DATA_DIR, 'iletisim.json'),
  sosyal: path.join(DATA_DIR, 'sosyal.json'),
  authLog: path.join(LOGS_DIR, 'auth.json'),
  auditLog: path.join(LOGS_DIR, 'audit.json'),
  resetTokens: path.join(DATA_DIR, 'reset-tokens.json'),
};

const BRUTE_MAX_ATTEMPTS = 5;
const BRUTE_LOCK_MINUTES = 15;
const BRUTE_CAPTCHA_AFTER = 3;
const IP_BLOCK_AFTER = 15;
const IP_BLOCK_MINUTES = 30;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_WARN_BEFORE_MS = 5 * 60 * 1000;
const bruteForceMap = new Map();
const ipBlockMap = new Map();

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()) || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
}

function validatePassword(pw) {
  if (!pw || typeof pw !== 'string' || pw.length < 8) return false;
  if (!/[A-Z]/.test(pw)) return false;
  if (!/[a-z]/.test(pw)) return false;
  if (!/\d/.test(pw)) return false;
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) return false;
  return true;
}

function sanitizeString(str) {
  if (str == null || typeof str !== 'string') return '';
  return xss(str.trim()).trim();
}

async function readUsers() {
  const data = await readJson(DATA_FILES.users);
  return Array.isArray(data) ? data : [];
}

async function writeUsers(users) {
  await writeJson(DATA_FILES.users, users);
}

async function ensureUsersFile() {
  let users = await readUsers();
  if (users.length === 0) {
    const adminData = await readJson(DATA_FILES.admin);
    const hash = adminData && adminData.passwordHash && adminData.passwordHash.startsWith('$2')
      ? adminData.passwordHash
      : await bcrypt.hash('Admin123!', 10);
    users = [{
      id: 1,
      kullaniciAdi: 'admin',
      email: 'admin@geliruzmanlari.gov.tr',
      sifreHash: hash,
      sifreGecmisi: [],
      rol: 'admin',
      aktif: true,
      sonGiris: null,
      kilitliUntil: null,
      kilitNedeni: '',
      olusturmaTarihi: new Date().toISOString(),
    }];
    await writeUsers(users);
  }
  return users;
}

async function readJson(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function appendAuthLog(entry) {
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
    const file = DATA_FILES.authLog;
    let list = [];
    try {
      const data = await fs.readFile(file, 'utf-8');
      list = JSON.parse(data);
      if (!Array.isArray(list)) list = [];
    } catch (_) {}
    list.push({ ...entry, time: new Date().toISOString() });
    const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
    const filtered = list.filter((e) => new Date(e.time).getTime() > sixMonthsAgo);
    await fs.writeFile(file, JSON.stringify(filtered.slice(-5000), null, 2), 'utf-8');
  } catch (err) {
    console.error('Auth log yazılamadı:', err.message);
  }
}

async function appendAuditLog(req, action, targetType, targetId, details) {
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
    const file = DATA_FILES.auditLog;
    let list = [];
    try {
      const data = await fs.readFile(file, 'utf-8');
      list = JSON.parse(data);
      if (!Array.isArray(list)) list = [];
    } catch (_) {}
    list.push({
      time: new Date().toISOString(),
      ip: getClientIp(req),
      userId: req.session?.userId,
      username: req.session?.kullaniciAdi || '',
      action,
      targetType: targetType || '',
      targetId: targetId != null ? String(targetId) : '',
      details: details || {},
    });
    const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
    const filtered = list.filter((e) => new Date(e.time).getTime() > sixMonthsAgo);
    await fs.writeFile(file, JSON.stringify(filtered.slice(-10000), null, 2), 'utf-8');
  } catch (err) {
    console.error('Audit log yazılamadı:', err.message);
  }
}

async function readResetTokens() {
  try {
    const data = await fs.readFile(DATA_FILES.resetTokens, 'utf-8');
    const list = JSON.parse(data);
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

async function saveResetTokens(list) {
  await fs.mkdir(path.dirname(DATA_FILES.resetTokens), { recursive: true });
  await fs.writeFile(DATA_FILES.resetTokens, JSON.stringify(list, null, 2), 'utf-8');
}

const ALLOWED_EXT = /\.(jpg|jpeg|png|webp|pdf)$/i;
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const match = file.originalname.match(ALLOWED_EXT);
    const ext = match ? match[1].toLowerCase() : 'bin';
    cb(null, uuidv4() + '.' + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_EXT.test(file.originalname)) cb(null, true);
    else cb(new Error('Sadece JPG, JPEG, PNG, WEBP ve PDF (maks. 5MB) yüklenebilir.'));
  },
});

app.use(cors({ origin: true, credentials: true }));

// CSP: CDN, inline script/style ve harici görsellere izin ver (önbellek/proxy CSP’sini geçersiz kılmak için)
app.use(function (req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.quilljs.com https://cdn.jsdelivr.net https://www.google.com https://www.gstatic.com https://www.recaptcha.net; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.quilljs.com https://cdn.jsdelivr.net; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https: blob:; " +
    "connect-src 'self' https://www.google.com https://www.gstatic.com https://cdn.quilljs.com https://cdn.jsdelivr.net; " +
    "frame-src 'self' https://www.google.com https://www.recaptcha.net;"
  );
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  message: { error: 'Çok fazla istek. Lütfen daha sonra tekrar deneyin.' },
  standardHeaders: true,
  keyGenerator: (req) => getClientIp(req),
});
app.use('/api', apiLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.' },
  keyGenerator: (req) => getClientIp(req),
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'cms-secret-key-degistirin',
    resave: true,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: SESSION_TIMEOUT_MS,
    },
  })
);

function maintenanceAndWhitelist(req, res, next) {
  const isAdminRoute = req.path.startsWith('/admin') || req.path.startsWith('/api/admin');
  if (!isAdminRoute) return next();
  const whitelist = (process.env.ADMIN_IP_WHITELIST || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (whitelist.length > 0) {
    const ip = getClientIp(req);
    if (!whitelist.includes(ip)) {
      if (req.path.startsWith('/api')) return res.status(403).json({ error: 'Bu alana erişim yetkiniz yok.' });
      return res.status(403).sendFile(path.join(__dirname, 'public', '403.html'));
    }
  }
  if (process.env.MAINTENANCE === '1') {
    if (req.path === '/api/admin/login' || req.path === '/api/admin/logout') return next();
    if (req.path.startsWith('/api')) return res.status(503).json({ error: 'Bakım modu. Lütfen daha sonra tekrar deneyin.' });
    return res.status(503).set('Retry-After', '300').send(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bakım</title></head><body style="font-family:sans-serif;text-align:center;padding:4rem;"><h1>Bakım Modu</h1><p>Yönetim paneli geçici olarak kapalıdır. Lütfen daha sonra tekrar deneyin.</p></body></html>'
    );
  }
  next();
}
app.use(maintenanceAndWhitelist);

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
  }
  const lastActivity = req.session.lastActivity || req.session.cookie?.originalMaxAge ? Date.now() - (SESSION_TIMEOUT_MS - req.session.cookie.maxAge) : 0;
  if (Date.now() - lastActivity > SESSION_TIMEOUT_MS) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Oturum süresi doldu. Tekrar giriş yapın.' });
  }
  req.session.lastActivity = Date.now();
  next();
}

async function requireAdmin(req, res, next) {
  if (req.session && req.session.rol === 'admin') return next();
  if (req.session && req.session.userId) {
    try {
      const users = await readUsers();
      const user = users.find((u) => String(u.id) === String(req.session.userId));
      if (user && user.rol === 'admin') {
        req.session.rol = user.rol;
        req.session.kullaniciAdi = user.kullaniciAdi;
        return next();
      }
    } catch (_) {}
    return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
  }
  res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
}

function requireEditorOrAdmin(req, res, next) {
  if (req.session && (req.session.rol === 'admin' || req.session.rol === 'editor')) return next();
  if (req.session && req.session.userId) return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
  res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
}

// ----- Public API (ana site için) -----
async function readAlbums() {
  const data = await readJson(DATA_FILES.albums);
  return Array.isArray(data) ? data : [];
}

app.get('/api/albums', async (req, res) => {
  try {
    const albums = await readAlbums();
    const active = (Array.isArray(albums) ? albums : []).filter((a) => a.aktif !== false);
    const sorted = [...active].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(sorted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Albümler yüklenemedi.' });
  }
});

app.get('/api/trending', async (req, res) => {
  try {
    const albums = await readAlbums();
    const active = (Array.isArray(albums) ? albums : []).filter((a) => a.aktif !== false);
    const top5 = [...active].sort((a, b) => (b.view_count || 0) - (a.view_count || 0)).slice(0, 5);
    res.json(top5);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Trend verileri yüklenemedi.' });
  }
});

app.get('/api/albums/:id', async (req, res) => {
  try {
    const albums = await readAlbums();
    const idStr = String(req.params.id || '');
    const album = (Array.isArray(albums) ? albums : []).find((a) => String(a.id) === idStr);
    if (!album || album.aktif === false) return res.status(404).json({ error: 'Haber bulunamadı.' });
    res.json(album);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Haber yüklenemedi.' });
  }
});

app.post('/api/albums/:id/view', async (req, res) => {
  try {
    const albums = await readAlbums();
    const idStr = String(req.params.id || '');
    const idx = (Array.isArray(albums) ? albums : []).findIndex((a) => String(a.id) === idStr);
    if (idx === -1) return res.status(404).json({ error: 'Haber bulunamadı.' });
    albums[idx].view_count = (Number(albums[idx].view_count) || 0) + 1;
    await writeJson(DATA_FILES.albums, albums);
    res.json({ view_count: albums[idx].view_count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Görüntülenme kaydedilemedi.' });
  }
});

app.get('/api/slider', async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.slider);
    if (!Array.isArray(list)) list = [];
    const active = list.filter((x) => x.aktif !== false).sort((a, b) => (a.sira || 0) - (b.sira || 0));
    res.json(active);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

app.post('/api/slider/:id/view', async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.slider);
    if (!Array.isArray(list)) list = [];
    const idx = list.findIndex((x) => x.id === req.params.id);
    if (idx === -1 || list[idx].aktif === false) return res.status(404).json({ error: 'Bulunamadı.' });
    list[idx].view_count = (list[idx].view_count || 0) + 1;
    await writeJson(DATA_FILES.slider, list);
    res.json({ view_count: list[idx].view_count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Kaydedilemedi.' });
  }
});

app.get('/api/hizmetler', async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.hizmetler);
    if (!Array.isArray(list)) list = [];
    const active = list.filter((x) => x.aktif !== false).sort((a, b) => (a.sira || 0) - (b.sira || 0));
    res.json(active);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

app.post('/api/hizmetler/:id/view', async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.hizmetler);
    if (!Array.isArray(list)) list = [];
    const idx = list.findIndex((x) => x.id === req.params.id);
    if (idx === -1 || list[idx].aktif === false) return res.status(404).json({ error: 'Bulunamadı.' });
    list[idx].view_count = (list[idx].view_count || 0) + 1;
    await writeJson(DATA_FILES.hizmetler, list);
    res.json({ view_count: list[idx].view_count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Kaydedilemedi.' });
  }
});

app.get('/api/referanslar', async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.referanslar);
    if (!Array.isArray(list)) list = [];
    const active = list.filter((x) => x.aktif !== false).sort((a, b) => (a.sira || 0) - (b.sira || 0));
    res.json(active);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

app.post('/api/referanslar/:id/view', async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.referanslar);
    if (!Array.isArray(list)) list = [];
    const idx = list.findIndex((x) => x.id === req.params.id);
    if (idx === -1 || list[idx].aktif === false) return res.status(404).json({ error: 'Bulunamadı.' });
    list[idx].view_count = (list[idx].view_count || 0) + 1;
    await writeJson(DATA_FILES.referanslar, list);
    res.json({ view_count: list[idx].view_count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Kaydedilemedi.' });
  }
});

app.get('/api/iletisim', async (req, res) => {
  try {
    let data = await readJson(DATA_FILES.iletisim);
    if (!data || typeof data !== 'object') data = {};
    res.json(data);
  } catch (err) {
    console.error(err);
    res.json({});
  }
});

app.get('/api/sosyal', async (req, res) => {
  try {
    let data = await readJson(DATA_FILES.sosyal);
    if (!data || typeof data !== 'object') data = {};
    res.json(data);
  } catch (err) {
    console.error(err);
    res.json({});
  }
});

// ----- Admin: Auth -----
function getBruteKey(req, username) {
  return getClientIp(req) + ':' + (username || '');
}

async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret || !token) return false;
  try {
    const https = require('https');
    const body = new URLSearchParams({ secret, response: token }).toString();
    const res = await new Promise((resolve, reject) => {
      const req = https.request('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, resolve);
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    let data = '';
    for await (const chunk of res) data += chunk;
    const json = JSON.parse(data);
    return json && json.success === true;
  } catch (_) {
    return false;
  }
}

app.post('/api/admin/login', loginLimiter, async (req, res) => {
  try {
    await ensureUsersFile();
    const username = sanitizeString((req.body && req.body.username) ? String(req.body.username) : '');
    const password = req.body && req.body.password ? String(req.body.password) : '';
    const captchaToken = (req.body && req.body.captchaToken) ? String(req.body.captchaToken).trim() : '';
    const ip = getClientIp(req);

    if (!username || !password) {
      return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
    }

    const key = getBruteKey(req, username);
    const ipKey = 'ip:' + ip;
    const now = Date.now();

    let ipBlock = ipBlockMap.get(ipKey);
    if (ipBlock && ipBlock.lockUntil > now) {
      await appendAuthLog({ ip, username, success: false, reason: 'ip_blocked' });
      const waitMin = Math.ceil((ipBlock.lockUntil - now) / 60000);
      return res.status(429).json({ error: 'Bu IP adresi geçici olarak kilitlendi. ' + waitMin + ' dakika sonra tekrar deneyin.' });
    }
    if (ipBlock && ipBlock.lockUntil <= now) ipBlockMap.delete(ipKey);

    const users = await readUsers();
    const user = users.find((u) => u.kullaniciAdi.toLowerCase() === username.toLowerCase());

    if (user && user.kilitliUntil && new Date(user.kilitliUntil).getTime() > now) {
      await appendAuthLog({ ip, username, success: false, reason: 'account_locked' });
      return res.status(401).json({ error: 'Hesap kilitli. Yönetici ile iletişime geçin veya panelden kilidi açın.' });
    }

    let brute = bruteForceMap.get(key) || { count: 0, lockUntil: 0 };
    if (brute.lockUntil > now) {
      const waitMin = Math.ceil((brute.lockUntil - now) / 60000);
      await appendAuthLog({ ip, username, success: false, reason: 'brute_locked' });
      return res.status(429).json({ error: 'Çok fazla başarısız deneme. ' + waitMin + ' dakika sonra tekrar deneyin.' });
    }
    if (brute.lockUntil <= now) brute = { count: 0, lockUntil: 0 };

    const needCaptcha = brute.count >= BRUTE_CAPTCHA_AFTER;
    if (needCaptcha && process.env.RECAPTCHA_SECRET_KEY) {
      const captchaOk = await verifyRecaptcha(captchaToken);
      if (!captchaOk) {
        await appendAuthLog({ ip, username, success: false, reason: 'captcha_required_or_invalid' });
        return res.status(400).json({ error: 'Lütfen CAPTCHA doğrulamasını tamamlayın.', requireCaptcha: true });
      }
    }

    if (!user) {
      brute.count++;
      if (brute.count >= BRUTE_MAX_ATTEMPTS) brute.lockUntil = now + BRUTE_LOCK_MINUTES * 60 * 1000;
      bruteForceMap.set(key, brute);
      let ipCount = (ipBlockMap.get(ipKey) || { count: 0, lockUntil: 0 });
      ipCount.count++;
      if (ipCount.count >= IP_BLOCK_AFTER) ipCount.lockUntil = now + IP_BLOCK_MINUTES * 60 * 1000;
      ipBlockMap.set(ipKey, ipCount);
      await appendAuthLog({ ip, username, success: false, reason: 'user_not_found' });
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
    }

    if (!user.aktif) {
      await appendAuthLog({ ip, username, success: false, reason: 'inactive' });
      return res.status(401).json({ error: 'Oturumunuz aktif değil. Yönetici ile iletişime geçin.' });
    }

    const ok = await bcrypt.compare(password, user.sifreHash);
    if (!ok) {
      brute.count++;
      if (brute.count >= BRUTE_MAX_ATTEMPTS) {
        brute.lockUntil = now + BRUTE_LOCK_MINUTES * 60 * 1000;
        const uIdx = users.findIndex((u) => u.id === user.id);
        if (uIdx !== -1) {
          users[uIdx].kilitliUntil = new Date(now + BRUTE_LOCK_MINUTES * 60 * 1000).toISOString();
          users[uIdx].kilitNedeni = 'Çok fazla başarısız giriş denemesi';
          await writeUsers(users);
        }
      }
      bruteForceMap.set(key, brute);
      let ipCount = (ipBlockMap.get(ipKey) || { count: 0, lockUntil: 0 });
      ipCount.count++;
      if (ipCount.count >= IP_BLOCK_AFTER) ipCount.lockUntil = now + IP_BLOCK_MINUTES * 60 * 1000;
      ipBlockMap.set(ipKey, ipCount);
      await appendAuthLog({ ip, username, success: false, reason: 'wrong_password' });
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
    }

    bruteForceMap.delete(key);
    ipBlockMap.delete(ipKey);
    await appendAuthLog({ ip, username, success: true, userId: user.id });

    const uIdx = users.findIndex((u) => u.id === user.id);
    if (uIdx !== -1) {
      users[uIdx].sonGiris = new Date().toISOString();
      users[uIdx].kilitliUntil = null;
      users[uIdx].kilitNedeni = '';
      await writeUsers(users);
    }

    req.session.userId = user.id;
    req.session.kullaniciAdi = user.kullaniciAdi;
    req.session.rol = user.rol;
    req.session.lastActivity = Date.now();
    res.json({ success: true, rol: user.rol });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Giriş yapılamadı.' });
  }
});

app.get('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ success: true });
});

app.post('/api/admin/extend-session', requireAuth, (req, res) => {
  req.session.lastActivity = Date.now();
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Oturum yenilenemedi.' });
    res.json({ success: true, expiresIn: SESSION_TIMEOUT_MS });
  });
});

app.get('/api/admin/session-info', requireAuth, (req, res) => {
  const lastActivity = req.session.lastActivity || Date.now();
  const expiresAt = lastActivity + SESSION_TIMEOUT_MS;
  const warnAt = expiresAt - SESSION_WARN_BEFORE_MS;
  res.json({
    expiresAt,
    warnAt,
    timeoutMs: SESSION_TIMEOUT_MS,
    warnBeforeMs: SESSION_WARN_BEFORE_MS,
  });
});

app.get('/api/admin/captcha-config', (req, res) => {
  res.json({ siteKey: process.env.RECAPTCHA_SITE_KEY || '' });
});

const RESET_TOKEN_EXPIRY_MS = 15 * 60 * 1000;
app.post('/api/admin/forgot-password', loginLimiter, async (req, res) => {
  try {
    const email = sanitizeString((req.body && req.body.email) ? String(req.body.email) : '');
    if (!email) return res.status(400).json({ error: 'E-posta gerekli.' });
    const users = await readUsers();
    const user = users.find((u) => u.email && u.email.toLowerCase() === email.toLowerCase());
    const msg = 'E-posta adresiniz kayıtlıysa şifre sıfırlama bağlantısı gönderilmiştir.';
    if (!user) return res.json({ message: msg });
    const tokens = await readResetTokens();
    const existing = tokens.filter((t) => t.userId === user.id);
    for (const t of existing) tokens.splice(tokens.indexOf(t), 1);
    const token = uuidv4();
    const expiry = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS).toISOString();
    tokens.push({ token, userId: user.id, email: user.email, expiry });
    await saveResetTokens(tokens);
    const baseUrl = req.headers.origin || ('http://localhost:' + (process.env.PORT || 3000));
    const link = baseUrl + '/sifre-sifirla?token=' + encodeURIComponent(token);
    const smtpHost = process.env.SMTP_HOST;
    if (smtpHost) {
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT, 10) || 587,
          secure: false,
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        });
        await transporter.sendMail({
          from: process.env.SMTP_FROM || 'noreply@localhost',
          to: user.email,
          subject: 'Şifre Sıfırlama - Yönetim Paneli',
          text: 'Şifrenizi sıfırlamak için aşağıdaki bağlantıya tıklayın (15 dakika geçerlidir):\n\n' + link,
          html: '<p>Şifrenizi sıfırlamak için <a href="' + link + '">bu bağlantıya</a> tıklayın (15 dakika geçerlidir).</p>',
        });
      } catch (mailErr) {
        console.error('Şifre sıfırlama e-postası gönderilemedi:', mailErr.message);
        return res.status(503).json({ error: 'E-posta gönderilemedi. Daha sonra tekrar deneyin.' });
      }
    } else {
      console.log('[Şifre sıfırlama] SMTP yapılandırılmamış. Bağlantı (15 dk geçerli):', link);
    }
    res.json({ message: msg });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'İşlem başarısız.' });
  }
});

app.post('/api/admin/reset-password', async (req, res) => {
  try {
    const token = (req.body && req.body.token) ? String(req.body.token).trim() : '';
    const newPassword = req.body && req.body.newPassword ? String(req.body.newPassword) : '';
    if (!token || !newPassword) return res.status(400).json({ error: 'Token ve yeni şifre gerekli.' });
    if (!validatePassword(newPassword)) {
      return res.status(400).json({ error: 'Şifre en az 8 karakter, 1 büyük harf, 1 küçük harf, 1 rakam ve 1 özel karakter içermelidir.' });
    }
    const tokens = await readResetTokens();
    const idx = tokens.findIndex((t) => t.token === token);
    if (idx === -1) return res.status(400).json({ error: 'Geçersiz veya süresi dolmuş bağlantı.' });
    const rec = tokens[idx];
    if (new Date(rec.expiry).getTime() < Date.now()) {
      tokens.splice(idx, 1);
      await saveResetTokens(tokens);
      return res.status(400).json({ error: 'Bağlantı süresi dolmuş. Lütfen tekrar isteyin.' });
    }
    const users = await readUsers();
    const uIdx = users.findIndex((u) => u.id === rec.userId);
    if (uIdx === -1) { tokens.splice(idx, 1); await saveResetTokens(tokens); return res.status(400).json({ error: 'Geçersiz bağlantı.' }); }
    const newHash = await bcrypt.hash(newPassword, 10);
    const history = Array.isArray(users[uIdx].sifreGecmisi) ? users[uIdx].sifreGecmisi : [];
    const usedBefore = await Promise.all(history.map((h) => bcrypt.compare(newPassword, h)));
    if (usedBefore.some(Boolean)) {
      return res.status(400).json({ error: 'Son 5 şifreden biri tekrar kullanılamaz.' });
    }
    users[uIdx].sifreGecmisi = [users[uIdx].sifreHash, ...history].slice(0, 5);
    users[uIdx].sifreHash = newHash;
    await writeUsers(users);
    tokens.splice(idx, 1);
    await saveResetTokens(tokens);
    res.json({ message: 'Şifre güncellendi. Giriş sayfasından giriş yapabilirsiniz.' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'İşlem başarısız.' });
  }
});

app.get('/api/admin/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({
      user: req.session.kullaniciAdi,
      rol: req.session.rol,
      userId: req.session.userId,
    });
  }
  res.status(401).json({ error: 'Oturum yok.' });
});

app.post('/api/admin/upload', requireAuth, requireEditorOrAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya seçilmedi.' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// ----- Admin: Kullanıcı Yönetimi (sadece Admin) -----
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await readUsers();
    const list = users.map((u) => ({
      id: u.id,
      kullaniciAdi: u.kullaniciAdi,
      email: u.email,
      rol: u.rol,
      aktif: u.aktif,
      sonGiris: u.sonGiris,
      olusturmaTarihi: u.olusturmaTarihi,
      kilitliUntil: u.kilitliUntil || null,
      kilitNedeni: u.kilitNedeni || '',
    }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Yüklenemedi.' });
  }
});

app.put('/api/admin/users/:id/unlock', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await readUsers();
    const id = parseInt(req.params.id, 10);
    const i = users.findIndex((u) => u.id === id);
    if (i === -1) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    users[i].kilitliUntil = null;
    users[i].kilitNedeni = '';
    await writeUsers(users);
    await appendAuditLog(req, 'user_unlock', 'user', id, { kullaniciAdi: users[i].kullaniciAdi });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'İşlem başarısız.' });
  }
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await readUsers();
    const body = req.body || {};
    const kullaniciAdi = String(body.kullaniciAdi || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const sifre = body.sifre || '';
    const rol = body.rol === 'editor' ? 'editor' : 'admin';
    const aktif = body.aktif !== false;
    if (!kullaniciAdi) return res.status(400).json({ error: 'Kullanıcı adı gerekli.' });
    if (!email) return res.status(400).json({ error: 'E-posta gerekli.' });
    if (!sifre) return res.status(400).json({ error: 'Şifre gerekli.' });
    if (!validatePassword(sifre)) {
      return res.status(400).json({ error: 'Şifre en az 8 karakter, 1 büyük harf, 1 küçük harf, 1 rakam ve 1 özel karakter (!@#$%^&* vb.) içermelidir.' });
    }
    if (users.some((u) => u.kullaniciAdi.toLowerCase() === kullaniciAdi.toLowerCase())) {
      return res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanılıyor.' });
    }
    if (users.some((u) => u.email && u.email.toLowerCase() === email)) {
      return res.status(400).json({ error: 'Bu e-posta zaten kayıtlı.' });
    }
    const newId = users.length ? Math.max(...users.map((u) => u.id)) + 1 : 1;
    const sifreHash = await bcrypt.hash(sifre, 10);
    const newUser = {
      id: newId,
      kullaniciAdi,
      email,
      sifreHash,
      sifreGecmisi: [],
      rol,
      aktif,
      sonGiris: null,
      kilitliUntil: null,
      kilitNedeni: '',
      olusturmaTarihi: new Date().toISOString(),
    };
    users.push(newUser);
    await writeUsers(users);
    await appendAuditLog(req, 'user_create', 'user', newId, { kullaniciAdi });
    res.json({
      id: newUser.id,
      kullaniciAdi: newUser.kullaniciAdi,
      email: newUser.email,
      rol: newUser.rol,
      aktif: newUser.aktif,
      olusturmaTarihi: newUser.olusturmaTarihi,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Kaydedilemedi.' });
  }
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await readUsers();
    const id = parseInt(req.params.id, 10);
    const i = users.findIndex((u) => u.id === id);
    if (i === -1) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    const body = req.body || {};
    if (body.sifre !== undefined && body.sifre !== '') {
      if (!validatePassword(body.sifre)) {
        return res.status(400).json({ error: 'Şifre en az 8 karakter, 1 büyük harf, 1 küçük harf, 1 rakam ve 1 özel karakter (!@#$%^&* vb.) içermelidir.' });
      }
      const newHash = await bcrypt.hash(body.sifre, 10);
      const history = Array.isArray(users[i].sifreGecmisi) ? users[i].sifreGecmisi : [];
      const usedBefore = await Promise.all(history.map((h) => bcrypt.compare(body.sifre, h)));
      if (usedBefore.some(Boolean)) {
        return res.status(400).json({ error: 'Son 5 şifreden biri tekrar kullanılamaz.' });
      }
      users[i].sifreGecmisi = [users[i].sifreHash, ...history].slice(0, 5);
      users[i].sifreHash = newHash;
    }
    if (body.rol !== undefined) users[i].rol = body.rol === 'editor' ? 'editor' : 'admin';
    if (body.aktif !== undefined) users[i].aktif = !!body.aktif;
    if (body.email !== undefined) users[i].email = String(body.email).trim().toLowerCase();
    await writeUsers(users);
    await appendAuditLog(req, 'user_update', 'user', users[i].id, { kullaniciAdi: users[i].kullaniciAdi });
    res.json({
      id: users[i].id,
      kullaniciAdi: users[i].kullaniciAdi,
      email: users[i].email,
      rol: users[i].rol,
      aktif: users[i].aktif,
      sonGiris: users[i].sonGiris,
      olusturmaTarihi: users[i].olusturmaTarihi,
    });
  } catch (err) {
    res.status(500).json({ error: 'Güncellenemedi.' });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await readUsers();
    const id = parseInt(req.params.id, 10);
    if (id === req.session.userId) {
      return res.status(400).json({ error: 'Kendinizi silemezsiniz.' });
    }
    const list = users.filter((u) => u.id !== id);
    if (list.length === users.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    const deletedName = users.find((u) => u.id === id)?.kullaniciAdi;
    await writeUsers(list);
    await appendAuditLog(req, 'user_delete', 'user', id, { kullaniciAdi: deletedName });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Silinemedi.' });
  }
});

// ----- Admin: Logs (sadece Admin) -----
app.get('/api/admin/logs/auth', requireAuth, requireAdmin, async (req, res) => {
  try {
    let list = [];
    try {
      const data = await fs.readFile(DATA_FILES.authLog, 'utf-8');
      list = JSON.parse(data);
      if (!Array.isArray(list)) list = [];
    } catch (_) {}
    const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
    list = list.filter((e) => new Date(e.time).getTime() > sixMonthsAgo).reverse().slice(0, 500);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Loglar yüklenemedi.' });
  }
});

app.get('/api/admin/logs/audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    let list = [];
    try {
      const data = await fs.readFile(DATA_FILES.auditLog, 'utf-8');
      list = JSON.parse(data);
      if (!Array.isArray(list)) list = [];
    } catch (_) {}
    const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
    list = list.filter((e) => new Date(e.time).getTime() > sixMonthsAgo).reverse().slice(0, 500);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Loglar yüklenemedi.' });
  }
});

// ----- Admin: Slider -----
app.get('/api/admin/slider', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.slider);
    list = Array.isArray(list) ? list : [];
    if (req.session.rol === 'editor') {
      list = list.filter((x) => String(x.ekleyenKullaniciId) === String(req.session.userId));
    }
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Yüklenemedi.' });
  }
});

app.post('/api/admin/slider', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.slider);
    if (!Array.isArray(list)) list = [];
    const body = req.body || {};
    const item = {
      id: uuidv4(),
      resim: body.resim || '',
      baslik: body.baslik || '',
      altBaslik: body.altBaslik || '',
      butonYazisi: body.butonYazisi || '',
      butonLink: body.butonLink || '',
      sira: typeof body.sira === 'number' ? body.sira : list.length,
      aktif: body.aktif !== false,
      ekleyenKullaniciId: req.session.userId,
      ekleyenKullaniciAdi: req.session.kullaniciAdi || '',
      ekleyenKullaniciRol: req.session.rol || '',
      created_at: new Date().toISOString(),
      view_count: 0,
    };
    list.push(item);
    await writeJson(DATA_FILES.slider, list);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Kaydedilemedi.' });
  }
});

app.put('/api/admin/slider/:id', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.slider);
    if (!Array.isArray(list)) list = [];
    const i = list.findIndex((x) => x.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Bulunamadı.' });
    if (req.session.rol === 'editor' && String(list[i].ekleyenKullaniciId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Sadece kendi eklediğiniz slider öğesini düzenleyebilirsiniz.' });
    }
    const body = req.body || {};
    list[i] = {
      ...list[i],
      resim: body.resim !== undefined ? body.resim : list[i].resim,
      baslik: body.baslik !== undefined ? body.baslik : list[i].baslik,
      altBaslik: body.altBaslik !== undefined ? body.altBaslik : list[i].altBaslik,
      butonYazisi: body.butonYazisi !== undefined ? body.butonYazisi : list[i].butonYazisi,
      butonLink: body.butonLink !== undefined ? body.butonLink : list[i].butonLink,
      sira: body.sira !== undefined ? body.sira : list[i].sira,
      aktif: body.aktif !== undefined ? body.aktif : list[i].aktif,
    };
    await writeJson(DATA_FILES.slider, list);
    res.json(list[i]);
  } catch (err) {
    res.status(500).json({ error: 'Güncellenemedi.' });
  }
});

app.delete('/api/admin/slider/:id', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.slider);
    if (!Array.isArray(list)) list = [];
    const i = list.findIndex((x) => x.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Bulunamadı.' });
    if (req.session.rol === 'editor' && String(list[i].ekleyenKullaniciId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Sadece kendi eklediğiniz slider öğesini silebilirsiniz.' });
    }
    list = list.filter((x) => x.id !== req.params.id);
    await writeJson(DATA_FILES.slider, list);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Silinemedi.' });
  }
});

// ----- Admin: Hizmetler -----
app.get('/api/admin/hizmetler', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.hizmetler);
    list = Array.isArray(list) ? list : [];
    if (req.session.rol === 'editor') {
      list = list.filter((x) => String(x.ekleyenKullaniciId) === String(req.session.userId));
    }
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Yüklenemedi.' });
  }
});

app.post('/api/admin/hizmetler', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.hizmetler);
    if (!Array.isArray(list)) list = [];
    const body = req.body || {};
    const item = {
      id: uuidv4(),
      baslik: typeof body.baslik === 'string' ? body.baslik.trim() : '',
      aciklama: typeof body.aciklama === 'string' ? body.aciklama : '',
      ikon: typeof body.ikon === 'string' ? body.ikon.trim() : '',
      link: typeof body.link === 'string' ? body.link.trim() : '',
      gorsel: typeof body.gorsel === 'string' ? body.gorsel.trim() : '',
      sira: typeof body.sira === 'number' ? body.sira : list.length,
      aktif: body.aktif !== false,
      ekleyenKullaniciId: req.session.userId,
      ekleyenKullaniciAdi: req.session.kullaniciAdi || '',
      ekleyenKullaniciRol: req.session.rol || '',
      created_at: new Date().toISOString(),
      view_count: 0,
    };
    list.push(item);
    await writeJson(DATA_FILES.hizmetler, list);
    res.json(item);
  } catch (err) {
    console.error('Hizmet ekleme hatası:', err.message);
    res.status(500).json({ error: 'Kaydedilemedi. ' + (err.message || '') });
  }
});

app.put('/api/admin/hizmetler/:id', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.hizmetler);
    if (!Array.isArray(list)) list = [];
    const i = list.findIndex((x) => x.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Bulunamadı.' });
    if (req.session.rol === 'editor' && String(list[i].ekleyenKullaniciId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Sadece kendi eklediğiniz hizmeti düzenleyebilirsiniz.' });
    }
    const body = req.body || {};
    list[i] = { ...list[i], ...body };
    if (typeof body.gorsel === 'string') list[i].gorsel = body.gorsel.trim();
    await writeJson(DATA_FILES.hizmetler, list);
    res.json(list[i]);
  } catch (err) {
    res.status(500).json({ error: 'Güncellenemedi.' });
  }
});

app.delete('/api/admin/hizmetler/:id', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.hizmetler);
    if (!Array.isArray(list)) list = [];
    const i = list.findIndex((x) => x.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Bulunamadı.' });
    if (req.session.rol === 'editor' && String(list[i].ekleyenKullaniciId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Sadece kendi eklediğiniz hizmeti silebilirsiniz.' });
    }
    list = list.filter((x) => x.id !== req.params.id);
    await writeJson(DATA_FILES.hizmetler, list);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Silinemedi.' });
  }
});

// ----- Admin: Haberler (albums) - Admin + Editor -----
app.get('/api/admin/haberler', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readAlbums();
    if (req.session.rol === 'editor') {
      list = list.filter((x) => String(x.ekleyenKullaniciId) === String(req.session.userId));
    }
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Yüklenemedi.' });
  }
});

app.post('/api/admin/haberler', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    const list = await readAlbums();
    const body = req.body || {};
    const item = {
      id: uuidv4(),
      title: body.title || '',
      category: body.category || '',
      image_url: body.image_url || '',
      view_count: 0,
      created_at: body.created_at || new Date().toISOString(),
      content: body.content || '',
      aktif: body.aktif !== false,
      ekleyenKullaniciId: req.session.userId,
      ekleyenKullaniciAdi: req.session.kullaniciAdi || '',
      ekleyenKullaniciRol: req.session.rol || '',
    };
    list.push(item);
    await writeJson(DATA_FILES.albums, list);
    await appendAuditLog(req, 'content_create', 'haber', item.id, { title: item.title });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Kaydedilemedi.' });
  }
});

app.put('/api/admin/haberler/:id', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    const list = await readAlbums();
    const i = list.findIndex((x) => x.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Bulunamadı.' });
    if (req.session.rol === 'editor' && String(list[i].ekleyenKullaniciId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Sadece kendi haberinizi düzenleyebilirsiniz.' });
    }
    const body = req.body || {};
    list[i] = {
      ...list[i],
      title: body.title !== undefined ? body.title : list[i].title,
      category: body.category !== undefined ? body.category : list[i].category,
      image_url: body.image_url !== undefined ? body.image_url : list[i].image_url,
      view_count: list[i].view_count,
      created_at: body.created_at !== undefined ? body.created_at : list[i].created_at,
      content: body.content !== undefined ? body.content : list[i].content,
      aktif: body.aktif !== undefined ? body.aktif : list[i].aktif,
    };
    await writeJson(DATA_FILES.albums, list);
    await appendAuditLog(req, 'content_update', 'haber', list[i].id, { title: list[i].title });
    res.json(list[i]);
  } catch (err) {
    res.status(500).json({ error: 'Güncellenemedi.' });
  }
});

app.delete('/api/admin/haberler/:id', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    const list = await readAlbums();
    const i = list.findIndex((x) => x.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Bulunamadı.' });
    if (req.session.rol === 'editor' && String(list[i].ekleyenKullaniciId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Sadece kendi haberinizi silebilirsiniz.' });
    }
    const title = list[i].title;
    const newList = list.filter((x) => x.id !== req.params.id);
    await writeJson(DATA_FILES.albums, newList);
    await appendAuditLog(req, 'content_delete', 'haber', req.params.id, { title });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Silinemedi.' });
  }
});

// ----- Admin: Referanslar -----
app.get('/api/admin/referanslar', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.referanslar);
    list = Array.isArray(list) ? list : [];
    if (req.session.rol === 'editor') {
      list = list.filter((x) => String(x.ekleyenKullaniciId) === String(req.session.userId));
    }
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Yüklenemedi.' });
  }
});

app.post('/api/admin/referanslar', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.referanslar);
    if (!Array.isArray(list)) list = [];
    const body = req.body || {};
    const item = {
      id: uuidv4(),
      logo: body.logo || '',
      firmaAdi: body.firmaAdi || '',
      aciklama: body.aciklama || '',
      sira: typeof body.sira === 'number' ? body.sira : list.length,
      aktif: body.aktif !== false,
      ekleyenKullaniciId: req.session.userId,
      ekleyenKullaniciAdi: req.session.kullaniciAdi || '',
      ekleyenKullaniciRol: req.session.rol || '',
      created_at: new Date().toISOString(),
      view_count: 0,
    };
    list.push(item);
    await writeJson(DATA_FILES.referanslar, list);
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: 'Kaydedilemedi.' });
  }
});

app.put('/api/admin/referanslar/:id', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.referanslar);
    if (!Array.isArray(list)) list = [];
    const i = list.findIndex((x) => x.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Bulunamadı.' });
    if (req.session.rol === 'editor' && String(list[i].ekleyenKullaniciId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Sadece kendi eklediğiniz referansı düzenleyebilirsiniz.' });
    }
    const body = req.body || {};
    list[i] = { ...list[i], ...body };
    await writeJson(DATA_FILES.referanslar, list);
    res.json(list[i]);
  } catch (err) {
    res.status(500).json({ error: 'Güncellenemedi.' });
  }
});

app.delete('/api/admin/referanslar/:id', requireAuth, requireEditorOrAdmin, async (req, res) => {
  try {
    let list = await readJson(DATA_FILES.referanslar);
    if (!Array.isArray(list)) list = [];
    const i = list.findIndex((x) => x.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Bulunamadı.' });
    if (req.session.rol === 'editor' && String(list[i].ekleyenKullaniciId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'Sadece kendi eklediğiniz referansı silebilirsiniz.' });
    }
    list = list.filter((x) => x.id !== req.params.id);
    await writeJson(DATA_FILES.referanslar, list);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Silinemedi.' });
  }
});

// ----- Admin: İletişim (tek kayıt) -----
app.get('/api/admin/iletisim', requireAuth, requireAdmin, async (req, res) => {
  try {
    let data = await readJson(DATA_FILES.iletisim);
    res.json(data || {});
  } catch (err) {
    res.status(500).json({ error: 'Yüklenemedi.' });
  }
});

app.put('/api/admin/iletisim', requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = req.body || {};
    await writeJson(DATA_FILES.iletisim, data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Güncellenemedi.' });
  }
});

// ----- Admin: Sosyal Medya (tek kayıt) -----
app.get('/api/admin/sosyal', requireAuth, requireAdmin, async (req, res) => {
  try {
    let data = await readJson(DATA_FILES.sosyal);
    res.json(data || {});
  } catch (err) {
    res.status(500).json({ error: 'Yüklenemedi.' });
  }
});

app.put('/api/admin/sosyal', requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = req.body || {};
    await writeJson(DATA_FILES.sosyal, data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Güncellenemedi.' });
  }
});

// ----- Sayfalar -----
// favicon 404 hatasını önle (tarayıcı otomatik ister)
app.get('/favicon.ico', (req, res) => {
  const faviconPath = path.join(__dirname, 'public', 'favicon.ico');
  require('fs').access(faviconPath, (err) => {
    if (!err) return res.sendFile(faviconPath);
    res.status(204).end();
  });
});
// Ana sayfa: kök index.html (klasör kökünden veya domain'den çalışır)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
// /public/* statik dosyalar (kök index.html public/app.js kullandığında gerekli)
app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/haber/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'detail.html'));
});

app.get('/haberler', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'haberler.html'));
});

app.get('/hizmetler', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hizmetler.html'));
});

app.get('/hizmet/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hizmet-detay.html'));
});

app.get('/cok-okunanlar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cok-okunanlar.html'));
});

app.get('/iletisim', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'iletisim.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.get('/yonetim', (req, res) => {
  res.redirect('/admin');
});

app.get('/yonetim/giris', (req, res) => {
  res.redirect('/admin');
});

app.get('/admin/login', (req, res) => {
  res.redirect('/admin');
});

app.get('/sifre-sifirla', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sifre-sifirla.html'));
});

// Statik dosyalar (sayfa route'larından sonra)
app.use(express.static(path.join(__dirname, 'public')));

// CORS preflight ve API 404
app.options('/api', (req, res) => res.sendStatus(204));
app.options('/api/*', (req, res) => res.sendStatus(204));
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  res.status(404).json({ error: 'API bulunamadı.' });
});

// Başlangıçta uploads klasörü ve admin dosyası
async function init() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await ensureUsersFile();
}

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log('Portal çalışıyor: http://localhost:' + PORT);
      console.log('Yönetim paneli: http://localhost:' + PORT + '/admin (varsayılan: admin / admin123)');
    });
  })
  .catch((err) => {
    console.error('Başlatma hatası:', err);
    process.exit(1);
  });
