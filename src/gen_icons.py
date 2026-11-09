"""Generate the Elpris icon SVGs: amber gradient tile, white lightning bolt over soft price bars."""
import os
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024
BOLT = "M604 128 L282 586 L488 586 L414 900 L752 424 L540 424 Z"

def icon(rounded=False, scale=1.0, bars=True, bolt_scale=1.0):
    rr = 228 if rounded else 0
    off = (S - S * scale) / 2
    tr = f"translate({off:.1f},{off:.1f}) scale({scale})"
    bs = bolt_scale
    btr = f"translate({512*(1-bs):.1f},{512*(1-bs):.1f}) scale({bs})"
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">',
    """<defs>
 <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#fef08a"/><stop offset="0.38" stop-color="#facc15"/><stop offset="0.75" stop-color="#f59e0b"/><stop offset="1" stop-color="#d97706"/></linearGradient>
 <radialGradient id="glow" cx="0.25" cy="0.18" r="0.7">
  <stop offset="0" stop-color="#ffffff" stop-opacity="0.45"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
 <radialGradient id="vig" cx="0.5" cy="0.5" r="0.72">
  <stop offset="0.7" stop-color="#78350f" stop-opacity="0"/><stop offset="1" stop-color="#78350f" stop-opacity="0.22"/></radialGradient>
 <linearGradient id="bolt" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#fff7d6"/></linearGradient>
 <linearGradient id="barg" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.18"/></linearGradient>
</defs>"""]
    o.append(f'<rect width="{S}" height="{S}" rx="{rr}" fill="url(#bg)"/>')
    o.append(f'<rect width="{S}" height="{S}" rx="{rr}" fill="url(#glow)"/>')
    o.append(f'<rect width="{S}" height="{S}" rx="{rr}" fill="url(#vig)"/>')
    o.append(f'<g transform="{tr}">')
    if bars:  # quarter-hour price bars along the bottom
        hs = [150, 230, 190, 300, 250, 170, 120]
        w, gap = 86, 30
        x0 = (S - (len(hs) * w + (len(hs) - 1) * gap)) / 2
        for i, h in enumerate(hs):
            x = x0 + i * (w + gap)
            o.append(f'<rect x="{x:.1f}" y="{872-h}" width="{w}" height="{h}" rx="22" fill="url(#barg)"/>')
    o.append(f'<g transform="{btr}">')
    for i in range(1, 12):  # soft shadow (cairosvg has no blur)
        o.append(f'<path d="{BOLT}" transform="translate({i*1.2:.1f},{i*3.0:.1f})" fill="#92400e" opacity="0.03" stroke="#92400e" stroke-width="{36+i*2}" stroke-linejoin="round"/>')
    o.append(f'<path d="{BOLT}" fill="url(#bolt)" stroke="url(#bolt)" stroke-width="36" stroke-linejoin="round"/>')
    o.append('</g></g></svg>')
    return "\n".join(o)

open(f"{D}/icon.svg", "w").write(icon())
open(f"{D}/icon-rounded.svg", "w").write(icon(rounded=True))
open(f"{D}/icon-maskable.svg", "w").write(icon(scale=0.8))
open(f"{D}/icon-small.svg", "w").write(icon(rounded=True, bars=False, bolt_scale=1.12))
print("svgs written")
