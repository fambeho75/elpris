"""Generate the flat Elpris icon SVGs.

White tile, a single centered electrical plug (thin rectangular pins,
mildly tapered rounded body, thin cord). No price bars.

Colour:
  background  #ffffff
  plug        #EA580C
"""
import os

D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024
WHITE = "#ffffff"
PLUG_COLOR = "#EA580C"

# Thin rectangular pins with slightly rounded tips, smaller mildly
# tapered body, thin cord. Same refined geometry as the previous
# revision; scaled and optically centered per variant.
PLUG = dict(
    y_top=118, pw=52, ph=178, gap=128, tip_r=10,
    bw_top=318, bw_bot=278, bh=178, brx=48,
    cw=40, ch=78, fr=18, overlap=18,
)

# Regular / rounded / small: fill the tile well (~12% vertical pad).
# Maskable: slightly smaller so the plug stays inside the 80% safe circle
# (radius 409.6; at 1.8 the half-height is 374).
SCALE = 1.85
SCALE_MASKABLE = 1.8


def plug_geom():
    """Return (elements, y_top, y_bottom). Elements have no fill/stroke."""
    p = PLUG
    cx = 512
    y_top, pw, ph, gap = p["y_top"], p["pw"], p["ph"], p["gap"]
    bw_top, bw_bot, bh, brx = p["bw_top"], p["bw_bot"], p["bh"], p["brx"]
    cw, ch, fr = p["cw"], p["ch"], p["fr"]
    body_top = y_top + ph - p["overlap"]
    body_bot = body_top + bh
    Lt, Rt = cx - bw_top / 2, cx + bw_top / 2
    Lb, Rb = cx - bw_bot / 2, cx + bw_bot / 2
    cl, cr = cx - cw / 2, cx + cw / 2
    cap = cw / 2
    y_cap = body_bot + ch - cap
    brb = min(brx, (bw_bot - cw) / 2 - fr - 4, bh / 2)
    path = (
        f"M {Lt + brx:.1f} {body_top:.1f} "
        f"H {Rt - brx:.1f} "
        f"A {brx:.1f} {brx:.1f} 0 0 1 {Rt:.1f} {body_top + brx:.1f} "
        f"L {Rb:.1f} {body_bot - brb:.1f} "
        f"A {brb:.1f} {brb:.1f} 0 0 1 {Rb - brb:.1f} {body_bot:.1f} "
        f"H {cr + fr:.1f} "
        f"A {fr:.1f} {fr:.1f} 0 0 1 {cr:.1f} {body_bot + fr:.1f} "
        f"V {y_cap:.1f} "
        f"A {cap:.1f} {cap:.1f} 0 0 1 {cl:.1f} {y_cap:.1f} "
        f"V {body_bot + fr:.1f} "
        f"A {fr:.1f} {fr:.1f} 0 0 1 {cl - fr:.1f} {body_bot:.1f} "
        f"H {Lb + brb:.1f} "
        f"A {brb:.1f} {brb:.1f} 0 0 1 {Lb:.1f} {body_bot - brb:.1f} "
        f"L {Lt:.1f} {body_top + brx:.1f} "
        f"A {brx:.1f} {brx:.1f} 0 0 1 {Lt + brx:.1f} {body_top:.1f} "
        f"Z"
    )
    tip_r = p["tip_r"]
    left_p = cx - gap / 2 - pw
    right_p = cx + gap / 2

    def pin(x):
        r = tip_r
        return (
            f'<path d="M {x:.1f} {y_top + r:.1f} '
            f"A {r:.1f} {r:.1f} 0 0 1 {x + r:.1f} {y_top:.1f} "
            f"H {x + pw - r:.1f} "
            f"A {r:.1f} {r:.1f} 0 0 1 {x + pw:.1f} {y_top + r:.1f} "
            f'V {y_top + ph:.1f} H {x:.1f} Z"/>'
        )

    elems = [
        f'<path d="{path}"/>',
        pin(left_p),
        pin(right_p),
    ]
    return elems, y_top, y_cap + cap


def icon(rounded=False, plug_scale=SCALE):
    rr = 228 if rounded else 0
    elems, y_top, y_bot = plug_geom()
    mid = (y_top + y_bot) / 2
    ptr = f"translate(512 512) scale({plug_scale}) translate(-512 {-mid})"
    body = "\n".join(elems)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" '
        f'width="{S}" height="{S}">\n'
        f'<rect width="{S}" height="{S}" rx="{rr}" fill="{WHITE}"/>\n'
        f'<g transform="{ptr}" fill="{PLUG_COLOR}">\n{body}\n</g>\n'
        f'</svg>\n'
    )


def main():
    open(f"{D}/icon.svg", "w").write(icon())
    open(f"{D}/icon-rounded.svg", "w").write(icon(rounded=True))
    open(f"{D}/icon-maskable.svg", "w").write(icon(plug_scale=SCALE_MASKABLE))
    open(f"{D}/icon-small.svg", "w").write(icon(rounded=True))
    print("svgs written")


if __name__ == "__main__":
    main()
