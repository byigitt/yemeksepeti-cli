// Yemeksepeti API Client

const API_BASE = "https://tr.fd-api.com";
const VENDORS_URL = `${API_BASE}/vendors-gateway/api/v1/pandora/vendors`;

// ─── Types ───────────────────────────────────────────────

export interface Address {
  id: number;
  city: string;
  title: string | null;
  label: string | null;
  formatted_customer_address: string;
  latitude: number;
  longitude: number;
}

export interface Deal {
  id: number;
  title: string;
  description: string;
  value: number;
  offer_type: string;
  type: string;
  minimum_order_value: number;
  maximum_discount_amount: number;
}

export interface DiscountInfo {
  id: string;
  value: number;
}

export interface Restaurant {
  code: string;
  name: string;
  rating: number;
  review_number: number;
  minimum_delivery_fee: number;
  minimum_order_amount: number;
  delivery_time: string;
  cuisines: string[];
  is_open: boolean;
  budget: number;
  deals: Deal[];
  delivery_fee_label: string;
  has_discount: boolean;
  discounts_info: DiscountInfo[];
  is_voucher_enabled: boolean;
}

export interface MenuItem {
  id: number;
  name: string;
  description: string;
  price: number;
  discounted_price?: number;
  category: string;
  variation_id: string;
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

export interface VendorDetail {
  code: string;
  name: string;
  rating: number;
  review_number: number;
  deals: Deal[];
  menus: MenuCategory[];
  delivery_fee: number;
  minimum_order_amount: number;
}

// ─── PerimeterX Protection & Retry ──────────────────────

const MAX_RETRIES = 4;
const RETRY_DELAYS = [3000, 8000, 20000, 45000];
const CACHE_TTL = 10 * 60 * 1000;
const PX_COOLDOWN_MS = 60_000;

let pxCooldownUntil = 0;

export type StatusCallback = (msg: string) => void;
let onStatus: StatusCallback = () => {};

export function setStatusCallback(cb: StatusCallback): void {
  onStatus = cb;
}

class PerimeterXError extends Error {
  constructor() {
    super("PerimeterX CAPTCHA tetiklendi");
    this.name = "PerimeterXError";
  }
}

function isPxResponse(text: string): boolean {
  return text.includes("PXlJuB4eTB") || text.includes("blockScript") || text.includes("captcha.js");
}

// ─── Cache ───────────────────────────────────────────────

class ApiCache {
  private store = new Map<string, { data: unknown; timestamp: number }>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set(key: string, data: unknown): void {
    this.store.set(key, { data, timestamp: Date.now() });
  }

  clear(): void {
    this.store.clear();
  }
}

// ─── API Client ──────────────────────────────────────────

export class YemeksepetiAPI {
  private token: string;
  private userId: string;
  private customerHash: string;
  private perseusClientId: string;
  private perseusSessionId: string;
  private cache = new ApiCache();

  constructor(config: {
    token: string;
    userId?: string;
    customerHash?: string;
    perseusClientId?: string;
    perseusSessionId?: string;
  }) {
    this.token = config.token;
    this.userId = config.userId ?? "";
    this.customerHash = config.customerHash ?? "";
    this.perseusClientId = config.perseusClientId ?? "";
    this.perseusSessionId = config.perseusSessionId ?? "";
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "x-fp-api-key": "volo",
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-pd-language-id": "2",
      "x-disco-client-id": "web",
      "perseus-client-id": this.perseusClientId,
      "perseus-session-id": this.perseusSessionId,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    };
  }

  private async fetchWithRetry(url: string): Promise<any> {
    await this.waitForCooldown();

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const resp = await fetch(url, { headers: this.headers });
      const text = await resp.text();

      if (resp.status === 403 && isPxResponse(text)) {
        pxCooldownUntil = Date.now() + PX_COOLDOWN_MS;
        const delay = RETRY_DELAYS[attempt];
        onStatus(` ⏳ CAPTCHA koruması — ${(delay / 1000).toFixed(0)}s bekleniyor... (deneme ${attempt + 2}/${MAX_RETRIES + 1})`);
        await sleep(delay);
        continue;
      }

      pxCooldownUntil = 0;

      if (!resp.ok) {
        throw new Error(`API ${resp.status}: ${text.substring(0, 200)}`);
      }

      return JSON.parse(text);
    }

    throw new PerimeterXError();
  }

  private async waitForCooldown(): Promise<void> {
    const remaining = pxCooldownUntil - Date.now();
    if (remaining <= 0) return;
    onStatus(` 🛡️ CAPTCHA bekleme süresi — ${Math.ceil(remaining / 1000)}s kaldı...`);
    await sleep(remaining);
  }

  private async fetchCached(cacheKey: string, url: string): Promise<any> {
    const cached = this.cache.get<any>(cacheKey);
    if (cached) {
      onStatus(` ⚡ Önbellekten yüklendi`);
      return cached;
    }
    const data = await this.fetchWithRetry(url);
    this.cache.set(cacheKey, data);
    return data;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async getAddresses(): Promise<Address[]> {
    const data = await this.fetchWithRetry(`${API_BASE}/api/v5/customers/addresses`);
    return (data.data?.items ?? []).map((i: any) => ({
      id: i.id,
      city: i.city,
      title: i.title,
      label: i.label,
      formatted_customer_address: i.formatted_customer_address,
      latitude: i.latitude,
      longitude: i.longitude,
    }));
  }

  async getRestaurants(
    lat: number,
    lng: number,
    opts: { cuisine?: string; offset?: number; limit?: number; sort?: string; joker_id?: string } = {}
  ): Promise<Restaurant[]> {
    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lng.toString(),
      language_id: "2",
      include: "characteristics",
      configuration: "Original",
      country: "tr",
      customer_id: this.userId,
      customer_hash: this.customerHash,
      customer_type: "regular",
      use_free_delivery_label: "true",
      limit: (opts.limit ?? 48).toString(),
      offset: (opts.offset ?? 0).toString(),
      vertical: "restaurants",
    });
    if (opts.cuisine) params.set("cuisine", opts.cuisine);
    if (opts.sort) params.set("sort", opts.sort);
    if (opts.joker_id) params.set("joker_id", opts.joker_id);

    const cacheKey = `restaurants:${lat}:${lng}:${opts.joker_id ?? ""}:${opts.offset ?? 0}`;
    const data = await this.fetchCached(cacheKey, `${VENDORS_URL}?${params}`);

    return (data.data?.items ?? []).map(parseRestaurant);
  }

  async getVendorDetail(vendorCode: string, lat: number, lng: number): Promise<VendorDetail> {
    const url = `${API_BASE}/api/v5/vendors/${vendorCode}?include=menus,deals&language_id=2&latitude=${lat}&longitude=${lng}`;
    const data = await this.fetchCached(`vendor:${vendorCode}:${lat}:${lng}`, url);

    const v = data.data;
    const menus: MenuCategory[] = [];

    for (const menu of v?.menus ?? []) {
      for (const cat of menu.menu_categories ?? []) {
        const items = (cat.products ?? []).map((p: any) => parseMenuItem(p, cat.name));
        if (items.length > 0) {
          menus.push({ id: String(cat.id ?? ""), name: cat.name, items });
        }
      }
    }

    return {
      code: v.code,
      name: v.name,
      rating: v.rating?.score ?? 0,
      review_number: v.rating?.total_count ?? 0,
      deals: (v.deals ?? []).map(parseDeal),
      menus,
      delivery_fee: v.dynamic_pricing?.delivery_fee?.total ?? v.minimum_delivery_fee ?? 0,
      minimum_order_amount: v.minimum_order_amount ?? 0,
    };
  }
}

// ─── Response Parsers ────────────────────────────────────

function parseRestaurant(i: any): Restaurant {
  let deliveryFeeLabel = "";
  if (i.delivery_fee_type === "free") {
    deliveryFeeLabel = "Ücretsiz";
  } else if (i.minimum_delivery_fee) {
    deliveryFeeLabel = formatPrice(i.minimum_delivery_fee);
  }

  return {
    code: i.code,
    name: i.name,
    rating: i.rating ?? 0,
    review_number: i.review_number ?? 0,
    minimum_delivery_fee: i.minimum_delivery_fee ?? 0,
    minimum_order_amount: i.minimum_order_amount ?? 0,
    delivery_time: i.delivery_time ?? "",
    cuisines: (i.cuisines ?? []).map((c: any) => c.name),
    is_open: i.is_active !== false,
    budget: i.budget ?? 0,
    deals: (i.deals ?? []).map(parseDeal),
    delivery_fee_label: deliveryFeeLabel,
    has_discount: i.metadata?.has_discount === true,
    discounts_info: (i.discounts_info ?? []).map((d: any) => ({ id: String(d.id), value: d.value ?? 0 })),
    is_voucher_enabled: i.is_voucher_enabled === true,
  };
}

function parseMenuItem(p: any, categoryName: string): MenuItem {
  const variation = p.product_variations?.[0];
  const price = variation?.price ?? 0;
  const priceBefore = variation?.price_before_discount;

  return {
    id: p.id ?? 0,
    name: p.name,
    description: p.description ?? "",
    price,
    discounted_price: priceBefore && priceBefore !== price ? priceBefore : undefined,
    category: categoryName,
    variation_id: variation?.code ?? "",
  };
}

function parseDeal(d: any): Deal {
  return {
    id: d.id,
    title: d.title ?? "",
    description: d.description ?? "",
    value: d.value ?? 0,
    offer_type: d.offer_type ?? "",
    type: d.type ?? "",
    minimum_order_value: d.minimum_order_value ?? 0,
    maximum_discount_amount: d.maximum_discount_amount ?? 0,
  };
}

// ─── Cart ────────────────────────────────────────────────

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  restaurantCode: string;
  restaurantName: string;
}

export class Cart {
  items: CartItem[] = [];
  vendorCode = "";
  vendorName = "";

  add(item: MenuItem, restaurantCode: string, restaurantName: string): void {
    if (this.vendorCode && this.vendorCode !== restaurantCode) {
      this.items = [];
    }
    this.vendorCode = restaurantCode;
    this.vendorName = restaurantName;

    const existing = this.items.find((i) => i.menuItem.id === item.id);
    if (existing) {
      existing.quantity++;
    } else {
      this.items.push({ menuItem: item, quantity: 1, restaurantCode, restaurantName });
    }
  }

  remove(itemId: number): void {
    const idx = this.items.findIndex((i) => i.menuItem.id === itemId);
    if (idx === -1) return;

    this.items[idx].quantity--;
    if (this.items[idx].quantity <= 0) {
      this.items.splice(idx, 1);
    }
    if (this.items.length === 0) {
      this.resetVendor();
    }
  }

  get totalItems(): number {
    return this.items.reduce((s, i) => s + i.quantity, 0);
  }

  get totalPrice(): number {
    return this.items.reduce((s, i) => s + i.menuItem.price * i.quantity, 0);
  }

  clear(): void {
    this.items = [];
    this.resetVendor();
  }

  private resetVendor(): void {
    this.vendorCode = "";
    this.vendorName = "";
  }
}

// ─── Helpers ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatPrice(tl: number): string {
  return tl.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " ₺";
}

export function stars(rating: number): string {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5 ? 1 : 0;
  return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(5 - full - half);
}

export function budgetLabel(b: number): string {
  if (b <= 1) return "₺";
  if (b <= 2) return "₺₺";
  return "₺₺₺";
}
