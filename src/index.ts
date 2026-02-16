import {
  createCliRenderer,
  TextAttributes,
  SelectRenderable,
  SelectRenderableEvents,
  InputRenderable,
  InputRenderableEvents,
  BoxRenderable,
  TextRenderable,
  t,
  bold,
  fg,
} from "@opentui/core";
import {
  YemeksepetiAPI,
  Cart,
  formatPrice,
  stars,
  budgetLabel,
  setStatusCallback,
  type Address,
  type Restaurant,
  type MenuItem,
  type VendorDetail,
} from "./api.ts";

// ─── Theme ───────────────────────────────────────────────
const C = {
  brand:     "#fa0050",
  bgDark:    "#1a1a1a",
  bgMid:     "#2a2a2a",
  bgLight:   "#333333",
  text:      "#ffffff",
  muted:     "#888888",
  dim:       "#555555",
  separator: "#444444",
  green:     "#4ade80",
  yellow:    "#facc15",
};

// ─── Config ──────────────────────────────────────────────
const TOKEN = process.env.YS_TOKEN;
if (!TOKEN) {
  console.error("❌ YS_TOKEN bulunamadı. Lütfen .env dosyasını kontrol edin.");
  process.exit(1);
}

const api = new YemeksepetiAPI({
  token: TOKEN,
  userId: process.env.YS_USER_ID ?? "",
  customerHash: process.env.YS_CUSTOMER_HASH ?? "",
  perseusClientId: process.env.YS_PERSEUS_CLIENT_ID ?? "",
  perseusSessionId: process.env.YS_PERSEUS_SESSION_ID ?? "",
});

const cart = new Cart();

// ─── State ───────────────────────────────────────────────
type Screen = "address" | "home" | "menu" | "cart" | "search";
let currentScreen: Screen = "address";
let selectedAddress: Address | null = null;
let restaurants: Restaurant[] = [];
let currentVendor: VendorDetail | null = null;

// ─── Renderer ────────────────────────────────────────────
const renderer = await createCliRenderer({ exitOnCtrlC: true });

// ─── Layout ──────────────────────────────────────────────
const rootBox = new BoxRenderable(renderer, {
  id: "root",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  backgroundColor: C.bgDark,
});

const headerBox = new BoxRenderable(renderer, {
  id: "header",
  width: "100%",
  height: 3,
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingLeft: 2,
  paddingRight: 2,
  backgroundColor: C.brand,
});

const headerTitle = new TextRenderable(renderer, {
  id: "h-title",
  content: " 🍔 Yemeksepeti ",
  fg: C.text,
  attributes: TextAttributes.BOLD,
});

const headerRight = new TextRenderable(renderer, {
  id: "h-right",
  content: "",
  fg: C.text,
});

headerBox.add(headerTitle);
headerBox.add(headerRight);

const contentBox = new BoxRenderable(renderer, {
  id: "content",
  flexGrow: 1,
  flexDirection: "column",
  padding: 1,
  width: "100%",
});

const statusBar = new TextRenderable(renderer, {
  id: "status",
  content: "",
  fg: C.text,
  width: "100%",
  backgroundColor: C.bgLight,
});

rootBox.add(headerBox);
rootBox.add(contentBox);
rootBox.add(statusBar);
renderer.root.add(rootBox);

// ─── Content Management ──────────────────────────────────
let contentChildren: any[] = [];

function setStatus(msg: string): void {
  statusBar.content = ` ${msg}`;
}

setStatusCallback(setStatus);

function handleError(err: any, context: string): void {
  if (err.name === "PerimeterXError") {
    setStatus(` 🛡️ CAPTCHA koruması aşılamadı (${context}). Birkaç dakika bekleyip tekrar deneyin.`);
  } else {
    setStatus(` ❌ ${context}: ${err.message}`);
  }
}

function updateHeader(): void {
  const cartInfo = cart.totalItems > 0 ? `🛒 ${cart.totalItems} ürün (${formatPrice(cart.totalPrice)})` : "";
  const addrInfo = selectedAddress ? `📍 ${selectedAddress.city}` : "";
  headerRight.content = `${cartInfo}  ${addrInfo} `;
}

function addChild(child: any): void {
  contentChildren.push(child);
  contentBox.add(child);
}

function clearContent(): void {
  for (const child of contentChildren) {
    try { contentBox.remove(child); } catch {}
    try { child.destroy(); } catch {}
  }
  contentChildren = [];
}

function makeSeparator(): TextRenderable {
  return new TextRenderable(renderer, {
    content: "─".repeat(Math.min(renderer.width - 4, 120)),
    fg: C.separator,
  });
}

// Shortcut key hint helper
function key(k: string): ReturnType<typeof fg> {
  return fg(C.brand)(bold(k));
}

function hint(text: string): ReturnType<typeof fg> {
  return fg(C.muted)(text);
}

// Shared select config
function selectConfig(id: string, height: number) {
  return {
    id,
    width: "100%" as const,
    height,
    selectedBackgroundColor: C.bgMid,
    selectedTextColor: C.brand,
    highlightBackgroundColor: C.bgLight,
  };
}

// ─── Joker Box (shared between home & joker screens) ────
function createJokerBox(id: string, titleText: string, footerText: string): BoxRenderable {
  const box = new BoxRenderable(renderer, {
    id,
    width: "100%",
    flexDirection: "column",
    backgroundColor: C.bgMid,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
    border: true,
    borderStyle: "rounded",
    borderColor: C.brand,
  });

  box.add(new TextRenderable(renderer, {
    content: t`${fg(C.brand)(bold(titleText))}`,
  }));

  box.add(new TextRenderable(renderer, {
    content: t`  ${fg(C.green)(bold("100 ₺"))} ${hint("(min 225 ₺)")}  │  ${fg(C.yellow)(bold("150 ₺"))} ${hint("(min 400 ₺)")}  │  ${fg(C.brand)(bold("200 ₺"))} ${hint("(min 550 ₺)")}`,
  }));

  box.add(new TextRenderable(renderer, {
    content: t`  ${fg(C.muted)(footerText)}`,
  }));

  return box;
}

// ─── Address Screen ──────────────────────────────────────
async function showAddressScreen(): Promise<void> {
  currentScreen = "address";
  clearContent();
  setStatus(" Adresler yükleniyor...");
  updateHeader();

  addChild(new TextRenderable(renderer, {
    content: "📍 Adres Seçin",
    fg: C.brand,
    attributes: TextAttributes.BOLD,
  }));

  addChild(new TextRenderable(renderer, {
    content: "  Sipariş vermek istediğiniz adresi seçin",
    fg: C.dim,
  }));

  try {
    const addresses = await api.getAddresses();
    setStatus(` ${addresses.length} adres bulundu  |  ↑↓ Seç  |  Enter: Onayla  |  q: Çıkış`);

    const options = addresses.map((a) => ({
      name: `  ${a.label || a.title || a.city}`,
      description: `    ${a.formatted_customer_address}`,
      value: a,
    }));

    const select = new SelectRenderable(renderer, {
      ...selectConfig("addr-sel", renderer.height - 10),
      options,
    });

    select.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, opt: any) => {
      selectedAddress = opt.value;
      showHomeScreen();
    });

    addChild(select);
    select.focus();
  } catch (err: any) {
    handleError(err, "Adresler");
  }
}

// ─── Home Screen ─────────────────────────────────────────
const JOKER_ID = "300916482767";

function formatRestaurantOption(r: Restaurant) {
  const icon = r.is_open ? "🟢" : "🔴";
  const rating = `${stars(r.rating)} ${r.rating}`;
  const discount = r.discounts_info.length > 0 ? `  🃏 %${r.discounts_info[0].value}` : "";
  const deal = r.deals.length > 0 ? `  🏷️ ${r.deals[0].title || r.deals[0].description}` : "";
  const delivery = r.delivery_fee_label ? `  🚚 ${r.delivery_fee_label}` : "";

  return {
    name: `${icon} ${r.name}  ${rating}  ${budgetLabel(r.budget)}${discount}${deal}`,
    description: `    ${r.cuisines.join(", ")}  |  Min: ${formatPrice(r.minimum_order_amount)}${delivery}  |  ${r.delivery_time}`,
    value: r,
  };
}

async function showHomeScreen(): Promise<void> {
  currentScreen = "home";
  clearContent();
  if (!selectedAddress) return;
  updateHeader();

  const { latitude: lat, longitude: lng } = selectedAddress;
  setStatus(` Restoranlar yükleniyor...`);

  addChild(new TextRenderable(renderer, {
    content: t`  ${key("↑↓")} ${hint("Seç")}  ${key("Enter")} ${hint("Menü")}  ${key("/")} ${hint("Ara")}  ${key("c")} ${hint("Sepet")}  ${key("j")} ${hint("Joker")}  ${key("t")} ${hint("Tümü")}  ${key("ESC")} ${hint("Adres")}  ${key("q")} ${hint("Çıkış")}`,
  }));

  try {
    restaurants = await api.getRestaurants(lat, lng, { limit: 100, joker_id: JOKER_ID });
    const jokerCount = restaurants.filter((r) => r.discounts_info.length > 0).length;

    addChild(createJokerBox(
      "joker-box",
      "🃏 Joker İndirimleri  — İndirimini katla, siparişini ver!",
      `${jokerCount} restoranda Joker indirimi mevcut — j: Sadece Jokerli  t: Tümünü gör`,
    ));

    addChild(makeSeparator());

    addChild(new TextRenderable(renderer, {
      content: t`${fg(C.brand)(bold("🏪 Tüm Restoranlar"))}  ${fg(C.dim)(`— ${selectedAddress!.formatted_customer_address}`)}`,
    }));

    setStatus(
      ` ${restaurants.length} restoran (${jokerCount} Jokerli)  |  ↑↓ Seç  |  Enter: Menü  |  j: Joker  |  /: Ara  |  c: Sepet (${cart.totalItems})`
    );

    const select = new SelectRenderable(renderer, {
      ...selectConfig("rest-sel", renderer.height - 16),
      options: restaurants.map(formatRestaurantOption),
    });

    select.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, opt: any) => {
      showMenuScreen(opt.value);
    });

    addChild(select);
    select.focus();
  } catch (err: any) {
    handleError(err, "Restoranlar");
  }
}

// ─── Joker-Only Screen ───────────────────────────────────
function showJokerScreen(): void {
  currentScreen = "home";
  clearContent();
  if (!selectedAddress) return;
  updateHeader();

  const jokerRestaurants = restaurants
    .filter((r) => r.discounts_info.length > 0)
    .sort((a, b) => (b.discounts_info[0]?.value ?? 0) - (a.discounts_info[0]?.value ?? 0));

  addChild(createJokerBox(
    "joker-hdr",
    `🃏 Joker İndirimli Restoranlar  (${jokerRestaurants.length} restoran)`,
    "Joker ile bu restoranlardaki siparişlerinizde ekstra indirim kazanın!",
  ));

  addChild(new TextRenderable(renderer, {
    content: t`  ${key("↑↓")} ${hint("Seç")}  ${key("Enter")} ${hint("Menü")}  ${key("t")} ${hint("Tüm restoranlar")}  ${key("ESC")} ${hint("Geri")}`,
  }));

  addChild(makeSeparator());

  setStatus(
    ` 🃏 ${jokerRestaurants.length} Joker indirimli restoran  |  ↑↓ Seç  |  Enter: Menü  |  t: Tüm restoranlar  |  ESC: Geri`
  );

  const select = new SelectRenderable(renderer, {
    ...selectConfig("joker-sel", renderer.height - 14),
    options: jokerRestaurants.map(formatRestaurantOption),
  });

  select.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, opt: any) => {
    showMenuScreen(opt.value);
  });

  addChild(select);
  select.focus();
}

// ─── Menu Screen ─────────────────────────────────────────
async function showMenuScreen(restaurant: Restaurant): Promise<void> {
  currentScreen = "menu";
  clearContent();
  if (!selectedAddress) return;
  updateHeader();

  const { latitude: lat, longitude: lng } = selectedAddress;
  setStatus(` ${restaurant.name} menüsü yükleniyor...`);

  try {
    currentVendor = await api.getVendorDetail(restaurant.code, lat, lng);
    const { menus, deals } = currentVendor;

    // Restaurant header
    const header = new BoxRenderable(renderer, {
      id: "rest-hdr",
      width: "100%",
      flexDirection: "column",
      backgroundColor: C.bgMid,
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      paddingBottom: 1,
      border: true,
      borderStyle: "rounded",
      borderColor: C.brand,
    });

    header.add(new TextRenderable(renderer, {
      content: t`${fg(C.brand)(bold(`📋 ${currentVendor.name}`))}  ${fg(C.yellow)(stars(currentVendor.rating))} ${fg(C.muted)(`(${currentVendor.review_number} değerlendirme)`)}`,
    }));

    if (deals.length > 0) {
      const dealTexts = deals.slice(0, 3).map((d) => {
        if (d.offer_type === "percentage") return `🏷️ ${d.title || `%${d.value} indirim`}`;
        if (d.offer_type === "amount") return `🏷️ ${formatPrice(d.value)} indirim`;
        return `🏷️ ${d.title || d.description}`;
      });
      header.add(new TextRenderable(renderer, {
        content: t`  ${fg(C.green)(dealTexts.join("  |  "))}`,
      }));
    }

    header.add(new TextRenderable(renderer, {
      content: t`  ${fg(C.muted)(`Min sepet: ${formatPrice(currentVendor.minimum_order_amount)}  |  Teslimat: ${restaurant.delivery_time}`)}`,
    }));

    addChild(header);

    addChild(new TextRenderable(renderer, {
      content: t`  ${key("Enter")} ${hint("Sepete ekle")}  ${key("c")} ${hint("Sepet")}  ${key("ESC")} ${hint("Geri")}  ${key("/")} ${hint("Ara")}`,
    }));

    addChild(makeSeparator());

    // Menu items
    const options: any[] = [];
    for (const cat of menus) {
      options.push({
        name: t`${fg(C.brand)(bold(`━━━ ${cat.name.toUpperCase()} ━━━`))}`,
        description: "",
        value: { type: "category" },
      });
      for (const item of cat.items) {
        const priceStr = item.discounted_price
          ? t`${fg(C.green)(bold(formatPrice(item.price)))} ${fg(C.dim)(`(eski: ${formatPrice(item.discounted_price)})`)}`
          : t`${fg(C.text)(bold(formatPrice(item.price)))}`;
        options.push({
          name: `  ${item.name}  —  ${priceStr}`,
          description: item.description ? `    ${item.description.substring(0, 80)}` : "",
          value: { type: "item", item },
        });
      }
    }

    const totalItems = menus.reduce((s, c) => s + c.items.length, 0);
    setStatus(
      ` ${currentVendor.name}  |  ${menus.length} kategori  |  ${totalItems} ürün  |  Sepet: ${cart.totalItems} (${formatPrice(cart.totalPrice)})  |  Enter: Ekle  |  c: Sepet  |  ESC: Geri`
    );

    const select = new SelectRenderable(renderer, {
      ...selectConfig("menu-sel", renderer.height - 14),
      options,
    });

    select.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, opt: any) => {
      if (opt.value.type === "item") {
        const item: MenuItem = opt.value.item;
        cart.add(item, restaurant.code, restaurant.name);
        updateHeader();
        setStatus(
          ` ✅ "${item.name}" sepete eklendi!  |  Sepet: ${cart.totalItems} ürün (${formatPrice(cart.totalPrice)})  |  c: Sepete git`
        );
      }
    });

    addChild(select);
    select.focus();
  } catch (err: any) {
    handleError(err, "Menü");
  }
}

// ─── Cart Screen ─────────────────────────────────────────
function showCartScreen(): void {
  currentScreen = "cart";
  clearContent();
  updateHeader();

  addChild(new TextRenderable(renderer, {
    content: t`${fg(C.brand)(bold("🛒 Sepetiniz"))}`,
  }));

  if (cart.items.length === 0) {
    addChild(new TextRenderable(renderer, {
      content: "\n  Sepetiniz boş. Menüden ürün ekleyin!\n",
      fg: C.muted,
    }));
    setStatus(" Sepet boş  |  ESC: Geri");
    return;
  }

  addChild(new TextRenderable(renderer, {
    content: t`  ${fg(C.text)(bold(`📍 ${cart.vendorName}`))}`,
  }));

  addChild(makeSeparator());

  const options: any[] = cart.items.map((ci) => ({
    name: t`  ${fg(C.text)(bold(`${ci.quantity}x`))} ${ci.menuItem.name}  —  ${fg(C.text)(bold(formatPrice(ci.menuItem.price * ci.quantity)))}`,
    description: `    Birim: ${formatPrice(ci.menuItem.price)}  |  Enter: Çıkar`,
    value: { item: ci },
  }));

  // Separator + total
  options.push({ name: "", description: "", value: {} });
  options.push({
    name: t`  ${fg(C.brand)(bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))}`,
    description: "",
    value: {},
  });
  options.push({
    name: t`  ${fg(C.green)(bold(`TOPLAM: ${formatPrice(cart.totalPrice)}`))}  ${fg(C.muted)(`(${cart.totalItems} ürün)`)}`,
    description: "",
    value: {},
  });

  const select = new SelectRenderable(renderer, {
    ...selectConfig("cart-sel", renderer.height - 12),
    options,
  });

  select.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, opt: any) => {
    if (opt.value.item) {
      cart.remove(opt.value.item.menuItem.id);
      showCartScreen();
    }
  });

  addChild(select);
  select.focus();

  addChild(new TextRenderable(renderer, {
    content: t`\n  ${key("Enter")} ${hint("Ürün çıkar")}  ${key("x")} ${hint("Sepeti temizle")}  ${key("ESC")} ${hint("Geri")}`,
  }));

  setStatus(
    ` Sepet: ${cart.totalItems} ürün  |  Toplam: ${formatPrice(cart.totalPrice)}  |  Enter: Çıkar  |  x: Temizle  |  ESC: Geri`
  );
}

// ─── Search Screen ───────────────────────────────────────
async function showSearchScreen(): Promise<void> {
  currentScreen = "search";
  clearContent();
  if (!selectedAddress) return;
  updateHeader();

  const { latitude: lat, longitude: lng } = selectedAddress;

  addChild(new TextRenderable(renderer, {
    content: t`${fg(C.brand)(bold("🔍 Tüm Restoranlarda Ürün Ara"))}`,
  }));

  const inputBox = new BoxRenderable(renderer, {
    id: "search-box",
    flexDirection: "row",
    gap: 1,
    width: "100%",
    height: 1,
    marginTop: 1,
  });

  const label = new TextRenderable(renderer, {
    content: "Ara: ",
    fg: C.brand,
    attributes: TextAttributes.BOLD,
  });

  const input = new InputRenderable(renderer, {
    id: "search-in",
    width: 40,
    placeholder: "ürün adı (burger, pizza, döner)...",
    backgroundColor: C.bgLight,
    textColor: C.text,
    cursorColor: C.brand,
    focusedBackgroundColor: C.bgMid,
  });

  inputBox.add(label);
  inputBox.add(input);
  addChild(inputBox);

  const resultsBox = new BoxRenderable(renderer, {
    id: "search-res",
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
    marginTop: 1,
  });
  addChild(resultsBox);

  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  let currentSelect: SelectRenderable | null = null;
  let isInputFocused = true;

  async function doSearch(query: string) {
    if (currentSelect) {
      try { resultsBox.remove(currentSelect); } catch {}
      currentSelect = null;
    }

    if (query.length < 2) {
      setStatus(" En az 2 karakter girin  |  TAB: Sonuçlara geç  |  ESC: Geri");
      return;
    }

    setStatus(` "${query}" aranıyor...`);

    try {
      const rests = restaurants.length > 0 ? restaurants : await api.getRestaurants(lat, lng, { limit: 30 });
      if (restaurants.length === 0) restaurants = rests;

      const results: { restaurant: Restaurant; item: MenuItem }[] = [];
      const q = query.toLowerCase();

      for (const rest of rests.slice(0, 10)) {
        try {
          const vendor = await api.getVendorDetail(rest.code, lat, lng);
          for (const cat of vendor.menus) {
            for (const item of cat.items) {
              if (item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)) {
                results.push({ restaurant: rest, item });
              }
            }
          }
        } catch {}
      }

      if (results.length === 0) {
        setStatus(` "${query}" için sonuç bulunamadı`);
        return;
      }

      results.sort((a, b) => a.item.price - b.item.price);

      setStatus(` ${results.length} sonuç  |  TAB: Giriş/Sonuçlar arası geç  |  Enter: Sepete ekle  |  ESC: Geri`);

      currentSelect = new SelectRenderable(renderer, {
        ...selectConfig("search-sel", renderer.height - 14),
        options: results.map((r) => ({
          name: t`  ${r.item.name}  —  ${fg(C.text)(bold(formatPrice(r.item.price)))}`,
          description: `    📍 ${r.restaurant.name}  |  ${r.item.category}`,
          value: r,
        })),
      });

      currentSelect.on(SelectRenderableEvents.ITEM_SELECTED, (_i: number, opt: any) => {
        const { restaurant, item } = opt.value;
        cart.add(item, restaurant.code, restaurant.name);
        updateHeader();
        setStatus(` ✅ "${item.name}" sepete eklendi! (${formatPrice(cart.totalPrice)})  |  c: Sepete git`);
      });

      resultsBox.add(currentSelect);
    } catch (err: any) {
      handleError(err, "Arama");
    }
  }

  input.on(InputRenderableEvents.CHANGE, (value: string) => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => doSearch(value), 800);
  });

  input.focus();
  isInputFocused = true;
  setStatus(" Ürün adı yazarak arama yapın  |  TAB: Sonuçlara geç  |  ESC: Geri");

  renderer.keyInput.on("keypress", (k) => {
    if (currentScreen !== "search") return;
    if (k.name === "tab") {
      if (isInputFocused && currentSelect) {
        input.blur();
        currentSelect.focus();
        isInputFocused = false;
      } else {
        currentSelect?.blur();
        input.focus();
        isInputFocused = true;
      }
    }
  });
}

// ─── Global Key Handling ─────────────────────────────────
renderer.keyInput.on("keypress", (k) => {
  if (k.name === "q" && currentScreen !== "search") {
    renderer.destroy();
    process.exit(0);
  }

  if (k.name === "escape") {
    switch (currentScreen) {
      case "home":    showAddressScreen(); break;
      case "menu":    showHomeScreen(); break;
      case "search":  showHomeScreen(); break;
      case "cart":    showHomeScreen(); break;
    }
  }

  if (k.name === "/" && (currentScreen === "home" || currentScreen === "menu")) {
    showSearchScreen();
  }

  if (k.name === "c" && currentScreen !== "search" && currentScreen !== "address") {
    showCartScreen();
  }

  if (k.name === "x" && currentScreen === "cart") {
    cart.clear();
    showCartScreen();
  }

  if (k.name === "j" && currentScreen === "home") {
    showJokerScreen();
  }

  if (k.name === "t" && currentScreen === "home") {
    showHomeScreen();
  }
});

// ─── Start ───────────────────────────────────────────────
showAddressScreen();
