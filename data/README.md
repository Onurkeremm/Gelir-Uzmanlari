# Site ayarları (data/)

Bu klasördeki JSON dosyaları (slider, anasayfa, iletisim, sosyal, haberler vb.) site ayarlarını tutar.

**Her deploy'da ayarların sıfırlanmaması için:** Güncel ayarları repoda tutun.

### Otomatik (önerilen)

1. Render'da ortam değişkenlerini ekleyin: `GITHUB_TOKEN`, `GITHUB_REPO` (örn. `kullanici/repo-adi`), isteğe bağlı `GITHUB_BRANCH` (varsayılan: main).
2. Yönetici paneli → **Ayarları repoya gönder** → Tek tıkla güncel ayarlar repoya commit edilir; bir sonraki deploy bu ayarları kullanır.

### Manuel

1. Panel → **Ayarları dışa aktar** → JSON indir.
2. Yerelde: `node scripts/import-settings.js indirilen-dosya.json`
3. `git add data/` → `git commit` → `git push`
