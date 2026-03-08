# Site ayarları (data/)

Bu klasördeki JSON dosyaları (slider, anasayfa, iletisim, sosyal, haberler vb.) site ayarlarını tutar.

**Her deploy'da ayarların sıfırlanmaması için:** Güncel ayarları repoda tutun.

1. Canlı sitede yönetici paneli → **Ayarları dışa aktar** → JSON indir.
2. Yerelde: `node scripts/import-settings.js indirilen-dosya.json`
3. `git add data/` → `git commit` → `git push`

Böylece bir sonraki deploy repodaki son ayarları kullanır.
