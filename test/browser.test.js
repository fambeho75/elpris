// Headless Chromium check + screenshots.  BASE=http://127.0.0.1:8787/ node test/browser.test.js
const path = require("path");
let pw;
try { pw = require("playwright-core"); } catch (e) { pw = require(process.env.PW_CORE || "/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core"); }
const BASE = process.env.BASE || "http://127.0.0.1:8787/";
const OUT = path.join(__dirname, "..", "screenshots");
const exe = process.env.CHROME || "/usr/bin/google-chrome";
const results = [];
const ok = (name, cond, info = "") => { results.push([cond ? "PASS" : "FAIL", name, info]); };

async function page(browser, opts, theme, routeFn) {
  const ctx = await browser.newContext(Object.assign({ locale: "sv-SE", timezoneId: "Europe/Stockholm", serviceWorkers: "block" }, opts));
  if (theme) await ctx.addInitScript((t) => localStorage.setItem("elpris-theme", t), theme);
  const p = await ctx.newPage();
  const errors = [];
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  p.on("pageerror", (e) => errors.push(String(e)));
  if (routeFn) await routeFn(p);
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  return { p, ctx, errors };
}

(async () => {
  const browser = await pw.chromium.launch({ executablePath: exe, headless: true });
  const iphone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const desktop = { viewport: { width: 1360, height: 1000 } };

  // 1. live data, iPhone dark
  let { p, ctx, errors } = await page(browser, iphone, "dark");
  const bars = await p.locator("[data-test=chart] rect.bar").count();
  ok("chart renders 96 quarter bars", bars >= 92 && bars <= 100, `bars=${bars}`);
  ok("current bar highlighted", (await p.locator("rect.bar.now").count()) === 1);
  const nowPrice = await p.locator("[data-test=now-price]").textContent();
  const avg = await p.locator("[data-test=avg]").textContent();
  ok("now price shown", /\d/.test(nowPrice), nowPrice);
  const winTxt = await p.locator("[data-test=window]").innerText();
  ok("cheapest window shows start + cost", /kr/.test(winTxt), winTxt.replace(/\s+/g, " "));
  const month = await p.locator("[data-test=month-total]").textContent();
  const mnum = +month.replace(/[^\d]/g, "");
  ok("month estimate sane (800–6000 kr)", mnum > 800 && mnum < 6000, month);
  const cmp = (await p.locator("[data-test=compare]").innerText()).replace(/\s+/g, " ");
  ok("comparison shows Telinet vs GodEl", /Telinet/.test(cmp) && /GodEl/.test(cmp), cmp);
  await p.screenshot({ path: `${OUT}/iphone-dark.png` });
  await p.screenshot({ path: `${OUT}/iphone-dark-full.png`, fullPage: true });
  // hourly toggle
  await p.click("button[data-key=res][data-val=h]");
  const hb = await p.locator("[data-test=chart] rect.bar").count();
  ok("hourly toggle → 24 bars", hb >= 23 && hb <= 25, `bars=${hb}`);
  // spot toggle
  await p.click("button[data-key=mode][data-val=spot]");
  const avgSpot = await p.locator("[data-test=avg]").textContent();
  ok("spot mode lowers average", parseFloat(avgSpot.replace(",", ".").replace(/\s/g, "")) < parseFloat(avg.replace(",", ".").replace(/\s/g, "")), `${avg} → ${avgSpot}`);
  // tomorrow tab
  await p.click("button[data-key=day][data-val=tomorrow]");
  ok("tomorrow tab renders chart or 'not yet' note", (await p.locator("[data-test=chart], .chart-empty").count()) === 1);
  // theme toggle remembered
  await p.click("button[data-action=theme]");
  const th = await p.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem("elpris-theme")]);
  ok("theme toggle switches + persists", th[0] === "light" && th[1] === "light", th.join("/"));
  // settings: change fuse to 25 A and annual kWh, value persists
  await p.click("button[data-action=settings]");
  await p.screenshot({ path: `${OUT}/iphone-light-settings.png` });
  await p.selectOption("select[data-cfg=fuse]", "25");
  const fixed = await p.inputValue("input[data-cfg=gridFixedYearEx]");
  ok("fuse preset fills tariff", fixed === "2425", fixed);
  await p.selectOption("select[data-cfg=fuse]", "20");
  await p.click(".sheet button[data-action=close-settings]");
  ok("no console errors (live, iPhone)", errors.length === 0, errors.join(" | "));
  await ctx.close();

  // 2. screenshots: iPhone light, desktop dark + light
  ({ p, ctx, errors } = await page(browser, iphone, "light"));
  await p.screenshot({ path: `${OUT}/iphone-light.png` });
  await p.screenshot({ path: `${OUT}/iphone-light-full.png`, fullPage: true });
  ok("no console errors (iPhone light)", errors.length === 0, errors.join(" | "));
  await ctx.close();
  for (const t of ["dark", "light"]) {
    ({ p, ctx, errors } = await page(browser, desktop, t));
    await p.screenshot({ path: `${OUT}/desktop-${t}.png`, fullPage: true });
    ok(`no console errors (desktop ${t})`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // 3. tomorrow not published (404) → graceful
  ({ p, ctx, errors } = await page(browser, iphone, "dark", async (pg) => {
    const tomorrow = await pg.evaluate(() => 0).then(() => null);
    await pg.route(/elprisetjustnu\.se\/api/, async (route) => {
      const u = route.request().url();
      const d = new Date(Date.now() + 86400000);
      const t = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", month: "2-digit", day: "2-digit" }).format(d).replace("-", "-");
      if (u.includes(`${t}_SE3`)) return route.fulfill({ status: 404, body: "Not found" });
      return route.continue();
    });
  }));
  await p.click("button[data-key=day][data-val=tomorrow]");
  const note = await p.locator(".chart-empty").innerText().catch(() => "");
  ok("tomorrow 404 shows 'not yet' note", /aren't out yet/.test(note), note.replace(/\s+/g, " "));
  ok("cheapest window still works on today only", /kr/.test(await p.locator("[data-test=window]").innerText().catch(() => "")));
  await p.screenshot({ path: `${OUT}/iphone-tomorrow-pending.png` });
  const realErr = errors.filter((e) => !/404/.test(e));
  ok("no JS errors with tomorrow missing (404 resource log ignored)", realErr.length === 0, errors.join(" | "));
  await ctx.close();

  // 4. API down completely, empty cache → error banner + retry, no crash
  ({ p, ctx, errors } = await page(browser, iphone, "dark", async (pg) => {
    await pg.route(/elprisetjustnu\.se\/api/, (route) => route.abort("internetdisconnected"));
  }));
  const banner = await p.locator(".banner.error").innerText().catch(() => "");
  ok("API down → error banner with retry", /Try again/.test(banner), banner.replace(/\s+/g, " "));
  const pageErr = errors.filter((e) => !/Failed to load resource|net::ERR/.test(e));
  ok("API down → no uncaught JS errors", pageErr.length === 0, pageErr.join(" | "));
  await p.screenshot({ path: `${OUT}/iphone-api-down.png` });
  await ctx.close();

  // 5. API down but cached data from earlier visit → still shows prices
  ctx = await browser.newContext(Object.assign({ locale: "sv-SE", timezoneId: "Europe/Stockholm", serviceWorkers: "block" }, iphone));
  p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "networkidle" }); await p.waitForTimeout(500);
  await p.route(/elprisetjustnu\.se\/api/, (route) => route.abort("internetdisconnected"));
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(500);
  ok("offline with cached prices → chart still renders", (await p.locator("[data-test=chart] rect.bar").count()) > 90);
  await ctx.close();

  // 6. tomorrow published (mocked from today's curve, clock fixed at 14:00) → tomorrow chart + window across midnight
  ctx = await browser.newContext(Object.assign({ locale: "sv-SE", timezoneId: "Europe/Stockholm", serviceWorkers: "block" }, desktop));
  p = await ctx.newPage(); errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  const todayIso = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
  await p.clock.setFixedTime(new Date(`${todayIso}T14:00:00+01:00`));
  const tmr = new Date(Date.parse(todayIso + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  const todayRaw = await (await fetch(`https://www.elprisetjustnu.se/api/v1/prices/${todayIso.slice(0, 4)}/${todayIso.slice(5)}_SE3.json`)).json();
  const mock = todayRaw.map((r, i) => {
    const s = Date.parse(r.time_start) + 86400000;
    const iso = (ms) => new Date(ms + 3600000).toISOString().slice(0, 19) + "+01:00";
    return Object.assign({}, r, { SEK_per_kWh: i >= 12 && i < 20 ? 0.05 : r.SEK_per_kWh, time_start: iso(s), time_end: iso(s + 900000) });
  });
  await p.route(new RegExp(`${tmr.slice(5)}_SE3`), (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mock), headers: { "access-control-allow-origin": "*" } }));
  await p.goto(BASE, { waitUntil: "networkidle" }); await p.waitForTimeout(600);
  const ws = await p.locator("[data-test=win-start]").textContent();
  ok("with tomorrow known, cheapest 2h is tomorrow 03:00 (mocked dip)", /Tomorrow 03:00/.test(ws), ws);
  await p.click("button[data-key=day][data-val=tomorrow]");
  ok("tomorrow chart renders", (await p.locator("[data-test=chart] rect.bar").count()) >= 92);
  await p.screenshot({ path: `${OUT}/desktop-dark-tomorrow-mock.png`, fullPage: true });
  ok("no JS errors (tomorrow mocked)", errors.length === 0, errors.join(" | "));
  await ctx.close();

  await browser.close();
  for (const r of results) console.log(r.join("  "));
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(failed ? `${failed} FAILED` : `all ${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
