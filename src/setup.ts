#!/usr/bin/env bun
/**
 * Yemeksepeti CLI — Hesap Kurulumu
 *
 * Tarayıcıdan token'ları alıp .env dosyasına kaydeder.
 * Kullanım: bun run src/setup.ts
 */

import { existsSync } from "fs";

// ─── Helpers ─────────────────────────────────────────────

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function print(msg: string): void {
  console.log(msg);
}

function header(msg: string): void {
  print(`\n${BOLD}${RED}${msg}${RESET}`);
}

function step(n: number, msg: string): void {
  print(`\n${BOLD}${CYAN}  [${n}]${RESET} ${msg}`);
}

function info(msg: string): void {
  print(`${DIM}      ${msg}${RESET}`);
}

function success(msg: string): void {
  print(`${GREEN}  ✅ ${msg}${RESET}`);
}

function error(msg: string): void {
  print(`${RED}  ❌ ${msg}${RESET}`);
}

async function prompt(question: string): Promise<string> {
  process.stdout.write(`${YELLOW}  > ${question}: ${RESET}`);
  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  return new TextDecoder().decode(value).trim();
}

// ─── Console Script ──────────────────────────────────────

const CONSOLE_SCRIPT = `
(function() {
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  const data = {
    token: getCookie('token'),
    refresh_token: getCookie('refresh_token'),
    device_token: getCookie('device_token'),
    perseus_client_id: getCookie('dhhPerseusGuestId'),
    perseus_session_id: getCookie('dhhPerseusSessionId'),
    user_id: '',
    customer_hash: ''
  };

  // Try to get user_id from localStorage
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('TR_')) {
        data.user_id = key;
        break;
      }
    }
  } catch(e) {}

  // Try to extract from JWT
  if (data.token) {
    try {
      const payload = JSON.parse(atob(data.token.split('.')[1]));
      if (payload.user_id) data.user_id = payload.user_id;
    } catch(e) {}
  }

  const json = JSON.stringify(data);
  console.log('%c Token verisi kopyalandı! Terminal\\'e yapıştırın.', 'color: #fa0050; font-size: 14px; font-weight: bold');
  console.log(json);

  // Copy to clipboard
  navigator.clipboard.writeText(json).then(
    () => console.log('%c ✅ Panoya kopyalandı!', 'color: green; font-weight: bold'),
    () => console.log('%c ⚠️ Pano erişimi yok, yukarıdaki JSON\\'ı manuel kopyalayın', 'color: orange')
  );

  return json;
})();
`.trim();

// ─── Token Validation ────────────────────────────────────

interface TokenData {
  token: string;
  refresh_token: string;
  device_token?: string;
  perseus_client_id: string;
  perseus_session_id: string;
  user_id: string;
  customer_hash?: string;
}

function parseTokenData(input: string): TokenData | null {
  try {
    const data = JSON.parse(input);
    if (!data.token) return null;
    return data as TokenData;
  } catch {
    return null;
  }
}

function extractUserIdFromJwt(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.user_id ?? "";
  } catch {
    return "";
  }
}

async function validateToken(token: string): Promise<{ valid: boolean; userId?: string }> {
  try {
    const resp = await fetch("https://tr.fd-api.com/api/v5/customers/addresses", {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-fp-api-key": "volo",
        Accept: "application/json",
        "x-disco-client-id": "web",
      },
    });
    if (resp.ok) {
      return { valid: true };
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

async function findCustomerHash(token: string, userId: string, lat: number, lng: number): Promise<string> {
  // customer_hash is needed for vendor listing — try common patterns
  // It's an MD5 hash that's set server-side. We can try to get it from a vendors request
  // that returns data even without it.
  try {
    const resp = await fetch(
      `https://tr.fd-api.com/vendors-gateway/api/v1/pandora/vendors?latitude=${lat}&longitude=${lng}&language_id=2&include=characteristics&configuration=Original&country=tr&customer_id=${userId}&customer_type=regular&limit=1&vertical=restaurants`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-fp-api-key": "volo",
          Accept: "application/json",
          "x-disco-client-id": "web",
        },
      }
    );
    if (resp.ok) return ""; // Works without hash
  } catch {}
  return "";
}

// ─── .env Writer ─────────────────────────────────────────

function buildEnvContent(data: TokenData): string {
  const lines = [
    `YS_TOKEN=${data.token}`,
    `YS_REFRESH_TOKEN=${data.refresh_token}`,
    `YS_USER_ID=${data.user_id}`,
    `YS_CUSTOMER_HASH=${data.customer_hash ?? ""}`,
    `YS_PERSEUS_CLIENT_ID=${data.perseus_client_id}`,
    `YS_PERSEUS_SESSION_ID=${data.perseus_session_id}`,
  ];
  return lines.join("\n") + "\n";
}

// ─── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  print("");
  header("  🍔 Yemeksepeti CLI — Hesap Kurulumu");
  print(`${DIM}  ─────────────────────────────────────${RESET}`);

  // Check existing .env
  if (existsSync(".env")) {
    print(`\n${YELLOW}  ⚠️  .env dosyası zaten mevcut.${RESET}`);
    const answer = await prompt("Üzerine yazmak istiyor musunuz? (e/h)");
    if (answer.toLowerCase() !== "e") {
      print(`\n${DIM}  İptal edildi.${RESET}\n`);
      process.exit(0);
    }
  }

  // Step 1: Open browser
  step(1, "Tarayıcıda Yemeksepeti'ye giriş yapın");
  info("Aşağıdaki adres tarayıcınızda açılacak:");
  info(`${BOLD}https://www.yemeksepeti.com${RESET}`);
  info("Giriş yapın veya zaten giriş yaptıysanız devam edin.");

  // Try to open browser
  try {
    const cmd = process.platform === "win32" ? "start" :
                process.platform === "darwin" ? "open" : "xdg-open";
    Bun.spawnSync([cmd, "https://www.yemeksepeti.com"], { stdout: "ignore", stderr: "ignore" });
  } catch {}

  await prompt("Giriş yaptıktan sonra Enter'a basın");

  // Step 2: Console script
  step(2, "Tarayıcı Console'unda script çalıştırın");
  info("Tarayıcıda F12 tuşuna basın → Console sekmesine gidin");
  info("Aşağıdaki kodu kopyalayıp Console'a yapıştırın ve Enter'a basın:\n");

  print(`${DIM}  ┌─────────────────────────────────────────┐${RESET}`);
  // Print the script in a compact form
  const compactScript = CONSOLE_SCRIPT.replace(/\n\s*/g, " ").trim();
  const scriptLines = [];
  let remaining = compactScript;
  while (remaining.length > 0) {
    scriptLines.push(remaining.substring(0, 76));
    remaining = remaining.substring(76);
  }
  for (const line of scriptLines) {
    print(`${DIM}  │${RESET} ${CYAN}${line}${RESET}`);
  }
  print(`${DIM}  └─────────────────────────────────────────┐${RESET}`);

  print(`\n${DIM}      Script çalıştırınca JSON otomatik panoya kopyalanır.${RESET}`);

  // Step 3: Paste
  step(3, "JSON verisini buraya yapıştırın");
  const input = await prompt("JSON");

  if (!input) {
    error("Boş girdi. Kurulum iptal edildi.");
    process.exit(1);
  }

  const tokenData = parseTokenData(input);
  if (!tokenData) {
    error("Geçersiz JSON formatı. Script'in çıktısını aynen yapıştırın.");
    process.exit(1);
  }

  if (!tokenData.token) {
    error("Token bulunamadı. Yemeksepeti'ye giriş yaptığınızdan emin olun.");
    process.exit(1);
  }

  // Extract user_id from JWT if not found
  if (!tokenData.user_id) {
    tokenData.user_id = extractUserIdFromJwt(tokenData.token);
  }

  // Step 4: Validate
  step(4, "Token doğrulanıyor...");
  const validation = await validateToken(tokenData.token);

  if (!validation.valid) {
    error("Token geçersiz veya süresi dolmuş. Yeniden giriş yapıp tekrar deneyin.");
    process.exit(1);
  }

  success("Token geçerli!");

  // Step 5: Save
  step(5, ".env dosyası oluşturuluyor...");
  await Bun.write(".env", buildEnvContent(tokenData));

  success(".env dosyası kaydedildi!\n");

  // Summary
  print(`${DIM}  ─────────────────────────────────────${RESET}`);
  print(`  ${BOLD}Kayıtlı bilgiler:${RESET}`);
  print(`  ${DIM}Token:${RESET}      ${tokenData.token.substring(0, 30)}...`);
  print(`  ${DIM}User ID:${RESET}    ${tokenData.user_id}`);
  print(`  ${DIM}Perseus:${RESET}    ${tokenData.perseus_client_id ? "✅" : "❌"}`);
  print(`  ${DIM}Refresh:${RESET}    ${tokenData.refresh_token ? "✅" : "❌"}`);

  print(`\n${GREEN}${BOLD}  🎉 Kurulum tamamlandı!${RESET}`);
  print(`${DIM}  Uygulamayı başlatmak için: ${RESET}${BOLD}bun dev${RESET}\n`);
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
