# Render'da Yayınlama

Bu proje **tek bir Node.js (Express) sunucusu** ile hem API hem statik sayfaları sunar. Render'da **mutlaka "Web Service"** olarak deploy edin.

## Önemli: Static Site kullanmayın

- **Static Site** seçerseniz sadece HTML/JS/CSS yayınlanır, `/api/*` route'ları çalışmaz → 404 alırsınız.
- **Web Service** seçin; böylece `npm start` ile `server.js` çalışır ve `/api/slider`, `/api/referanslar` vb. yanıt verir.

## Adımlar

1. Render Dashboard → **New** → **Web Service**
2. Repoyu bağlayın (GitHub/GitLab)
3. Ayarlar:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Root Directory:** (boş bırakın veya proje kökü)
4. **Environment** (isteğe bağlı): `NODE_ENV=production`, `SESSION_SECRET` vb.
5. Deploy edin.

İsterseniz repo kökündeki `render.yaml` ile **Blueprint** kullanarak da aynı servisi tanımlayabilirsiniz.

## Oturum (session)

Oturum bilgisi **cookie** içinde saklanır (sunucu yeniden başlasa da kaybolmaz). Production'da `SESSION_SECRET` ortam değişkenini Render panelinden mutlaka güçlü bir değerle ayarlayın.

## Tailwind CDN uyarısı

"cdn.tailwindcss.com should not be used in production" uyarısı CDN kullanıldığı için görünür. İsterseniz ileride Tailwind'i PostCSS/CLI ile derleyip tek bir CSS kullanarak kaldırabilirsiniz.

## Veri dosyaları

`data/` klasörü (slider.json, referanslar.json, users.json vb.) repoda olmalı. Render’da disk kalıcı değildir; kalıcı veri için ileride bir veritabanı ekleyebilirsiniz.
