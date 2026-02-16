# 🍔 yemeksepeti-cli

Yemeksepeti'yi terminalden kullanmak için TUI (Terminal User Interface) uygulaması.

[OpenTUI](https://github.com/mariozechner/opentui) + [Bun](https://bun.sh) ile geliştirilmiştir.

## Özellikler

- **📍 Adres seçimi** — Kayıtlı adresleriniz arasından seçim yapın
- **🏪 Restoran listesi** — Puan, mutfak türü, minimum sepet, teslimat ücreti bilgileriyle
- **🃏 Joker indirimleri** — Joker indirimli restoranları filtreleyin ve indirim yüzdelerini görün
- **📋 Menü görüntüleme** — Kategoriler halinde ürünler, fiyatlar ve kampanyalar
- **🛒 Sepet** — Ürün ekle/çıkar, toplam hesaplama
- **🔍 Arama** — Birden fazla restoranın menüsünde aynı anda ürün arayın
- **🛡️ CAPTCHA koruması** — PerimeterX blokajlarında otomatik retry + cache

## Kurulum

```bash
# Bun gerekli (https://bun.sh)
curl -fsSL https://bun.sh/install | bash

# Klonla ve bağımlılıkları yükle
git clone https://github.com/byigitt/yemeksepeti-cli.git
cd yemeksepeti-cli
bun install
```

## Yapılandırma

Proje kök dizinine `.env` dosyası oluşturun:

```env
YS_TOKEN=your_bearer_token
YS_REFRESH_TOKEN=your_refresh_token
YS_USER_ID=your_user_id
YS_CUSTOMER_HASH=your_customer_hash
YS_PERSEUS_CLIENT_ID=your_perseus_client_id
YS_PERSEUS_SESSION_ID=your_perseus_session_id
```

### Token nasıl alınır?

1. Tarayıcıda [yemeksepeti.com](https://www.yemeksepeti.com)'a giriş yapın
2. DevTools (F12) → Application → Cookies → `www.yemeksepeti.com`
3. Aşağıdaki cookie'leri `.env`'ye kopyalayın:

| Cookie | .env değişkeni |
|--------|----------------|
| `token` | `YS_TOKEN` |
| `refresh_token` | `YS_REFRESH_TOKEN` |
| `dhhPerseusGuestId` | `YS_PERSEUS_CLIENT_ID` |
| `dhhPerseusSessionId` | `YS_PERSEUS_SESSION_ID` |

4. `YS_USER_ID` ve `YS_CUSTOMER_HASH` için DevTools → Network'te herhangi bir API isteğinin parametrelerine bakın (`customer_id` ve `customer_hash`).

## Kullanım

```bash
bun dev
```

## Kısayol Tuşları

| Tuş | Aksiyon |
|-----|---------|
| `↑` `↓` | Listede gezin |
| `Enter` | Seç / Sepete ekle |
| `ESC` | Geri dön |
| `/` | Ürün ara |
| `c` | Sepeti aç |
| `j` | Joker indirimli restoranları göster |
| `t` | Tüm restoranları göster |
| `x` | Sepeti temizle (sepet ekranında) |
| `q` | Çıkış |

## Ekranlar

```
Adres Seçimi → Anasayfa (Restoranlar) → Menü → Sepet
                    │                           ↑
                    └── Joker Filtre             │
                    └── Arama ──────────────────┘
```

## Teknik Detaylar

- **API**: `tr.fd-api.com` (DeliveryHero/Foodora altyapısı)
- **TUI**: [@opentui/core](https://github.com/mariozechner/opentui) imperative API
- **Runtime**: Bun (`.env` otomatik yüklenir)
- **Cache**: Vendor detayları 10 dakika önbelleklenir
- **Anti-bot**: PerimeterX 403 yanıtlarında 3s → 8s → 20s → 45s backoff ile retry

## Proje Yapısı

```
src/
├── api.ts      # API client, cache, retry, cart, yardımcı fonksiyonlar
└── index.ts    # TUI ekranları ve navigasyon
```

## Lisans

MIT
