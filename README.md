# Elpris

Small installable web app (PWA) for electricity in Skövde, **elområde SE3**, on **Telinet Kvartspris** (“2 års dynamiskt pris”).
Plain HTML/CSS/JS, no build step. Works under any sub-path (e.g. `https://fambeho75.github.io/elpris/`).

- Today's and tomorrow's quarter-hour prices (tomorrow appears ~13:00), bar chart with 15 min / hour toggle, now highlighted, min / avg / max.
- **Total** price per kWh incl. moms = spot + Skövde Energi grid transfer (peak/off-peak) + energiskatt + Telinet påslag; **Spot** toggle shows spot incl. moms.
- Cheapest continuous window for 1 / 2 (Miele, 1 kWh) / 3 / 4 h or any duration, in the remaining known prices, with cost vs starting now.
- This month's bill estimate (typical heat-pump villa load profile × annual kWh × month weight, real prices for the days so far), override with the actual kWh from the bill, and a comparison with GodEl Kvartspris.
- Dark by default, sun/moon toggle remembered. Settings (gear) are saved in `localStorage`.

## Data

Prices: [Elpriset just nu.se](https://www.elprisetjustnu.se/elpris-api) —
`https://www.elprisetjustnu.se/api/v1/prices/YYYY/MM-DD_SE3.json`, an array of
`{ SEK_per_kWh, EUR_per_kWh, EXR, time_start, time_end }`, 96 quarter-hour rows per day (since Oct 2025), prices **excl. moms**.
CORS-open, free; attribution link is in the footer. Days already fetched are kept in `localStorage` (current + previous month).

## Tariff figures (defaults, all editable in Settings)

| Item | Value | Source |
|---|---|---|
| Energiskatt 2026 | 36,0 öre/kWh excl. moms (45,0 incl.) | [Skatteverket – Skatt på el](https://www.skatteverket.se/foretag/skatterochavdrag/punktskatter/energiskatter/skattpael), [Ei – Energiskatt](https://ei.se/konsument/el/elmarknaden/energiskatt) |
| Skövde Energi Elnät, 20 A (N15E) fixed fee | 2 150 kr/yr excl. moms | [Skövde Energi – Elnätstaxa utan moms](https://skovdeenergi.se/elnat/elnatstaxa-utan-moms/) (valid from 2026-01-01) |
| Grid transfer, off-peak (låglast) | 4,9 öre/kWh excl. moms | same |
| Grid transfer, peak (höglast, 16–25 A) | 22 öre/kWh excl. moms | same |
| Månadseffekt (effekttariff, 16–25 A) | 66 kr/kW/month excl. moms, Nov–Mar only, on the highest hourly kW in peak time; ≤1 kW free | same |
| Peak time | Nov–Mar, Mon–Fri 06–22; weekends, red days, julafton, nyårsafton, skärtorsdagen are off-peak | same |
| Other fuse sizes | 16 A 1 285 kr · 25 A 2 425 kr · 35 A 2 985 · 50 A 3 490 · 63 A 4 450 kr/yr; 35–63 A: peak 19 öre, 110 kr/kW | same |
| Telinet “2 års dynamiskt pris” (from 1 Dec 2026) | 0 kr/month for 24 months, then 69 kr; no bindningstid, 30 days uppsägning | Jürgen's contract |
| Telinet påslag elcertifikat | 2,24 öre/kWh — **unconfirmed** whether this includes moms, until the next invoice | same |
| GodEl Kvartspris (comparison) | 49 kr/month incl. moms, påslag 0 | [GodEl – Förstå elpriset](https://godel.se/elavtal-priser/forsta-elpriset/), [GodEl – Elavtal](https://godel.se/elavtal-priser/elavtal/) |
| GodEl "other costs" (elcertifikat, ursprungsgarantier, balance etc.), SE3 | ≈ 6,0 öre/kWh incl. moms (Sep 2026) | [Elternativ – GodEl](https://elternativ.se/elbolag/godel) (changes monthly) |
| Moms | 25 % | |

Skövde Energi changes the model on **1 Jan 2027** (effekt fee from the average of the 3 highest peaks on 3 different days, and an optional
"traditionell taxa" without effekt fee). New prices are announced end of Nov 2026 — update Settings then:
[Traditionell taxa](https://skovdeenergi.se/elnat/traditionell-taxa/).

## Estimate model

- Month kWh = annual kWh (default 8 500) × month weight (Jan 13 %, Feb 11,5, Mar 10,5, Apr 8,5, May 6, Jun 4,5, Jul 4, Aug 4,5, Sep 6, Oct 8,5, Nov 10,5, Dec 12,5 %), or the actual kWh you enter.
- Each day gets month kWh / days, spread over the hours with a typical villa profile (night low, peaks 07–08 and 17–20).
- Days with known prices use the real quarter prices; the rest of the month uses the profile-weighted average of the known days.
- Grid power fee uses the "peak kW" setting (default 4,5 kW, a guess — check the bill / Mina sidor).

## Files

`index.html`, `styles.css`, `app.js` (UI), `tariff.js` (pure logic, also used by the Node tests), `sw.js` (app shell cache-first, price API network-first with cached fallback), `manifest.webmanifest`, icons (`icon.svg`, `icon-rounded.svg`, `icon-maskable.svg`, `apple-touch-icon.png` 180, `icon-192.png`, `icon-512.png`, `icon-maskable-192/512.png`, `favicon-32.png`), `src/` icon generator + renderer (cairosvg), `test/`.

Bump `CACHE` in `sw.js` and the `?v=` query strings when shipping changes.

## Run / test

```sh
python3 -m http.server 8787        # then open http://127.0.0.1:8787/
node --check app.js tariff.js sw.js
node test/tariff.test.js           # unit + live-API sanity
node test/browser.test.js          # headless Chrome (playwright-core), writes screenshots/
python3 src/gen_icons.py && python3 src/render_icons.py
```
