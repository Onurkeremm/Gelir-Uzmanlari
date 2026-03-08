/**
 * Admin kullanıcısını ayarlar: kullanıcı adı "admin", şifre "Admin159357852"
 * Kullanım: node scripts/set-admin.js
 */
const path = require('path');
const fs = require('fs').promises;
const bcrypt = require('bcrypt');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'Admin159357852';
const ADMIN_EMAIL = 'admin@geliruzmanlari.gov.tr';

async function main() {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  let users = [];
  try {
    const data = await fs.readFile(USERS_FILE, 'utf-8');
    users = JSON.parse(data);
    if (!Array.isArray(users)) users = [];
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const adminPayload = {
    id: 1,
    kullaniciAdi: ADMIN_USERNAME,
    email: ADMIN_EMAIL,
    sifreHash: hash,
    sifreGecmisi: [],
    rol: 'admin',
    aktif: true,
    sonGiris: null,
    kilitliUntil: null,
    kilitNedeni: '',
    olusturmaTarihi: new Date().toISOString(),
  };

  const idx = users.findIndex((u) => u.id === 1 || u.kullaniciAdi === ADMIN_USERNAME);
  if (idx !== -1) {
    adminPayload.olusturmaTarihi = users[idx].olusturmaTarihi || adminPayload.olusturmaTarihi;
    users[idx] = adminPayload;
  } else {
    users.unshift(adminPayload);
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  console.log('Admin ayarlandı: kullanıcı adı = %s, şifre = %s', ADMIN_USERNAME, ADMIN_PASSWORD);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
