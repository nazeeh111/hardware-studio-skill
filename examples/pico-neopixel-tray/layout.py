"""Write a dimensioned SVG top view from design.json (board envelopes only)."""

import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    out = args.out.expanduser().resolve()
    if out.exists() or not out.parent.is_dir():
        parser.error("--out must be a new file in an existing directory")
    spec = json.loads((ROOT / "design.json").read_text())
    t, p, s = spec["tray"], spec["placements"]["pico"], spec["placements"]["stick"]
    x0, y0, scale = 104, 100, 10
    x = lambda n: x0 + n * scale
    y = lambda n: y0 + n * scale
    pico = (p["x_offset"] - 52.3, p["y_offset"], 52.3, 21)
    stick = (s["x_offset"], s["y_offset"], 51.1, 10.2)
    circles = []
    for px, py in ((11, 8.8), (11, 20.2), (58, 8.8), (58, 20.2)):
        circles.append(f'<circle cx="{x(px)}" cy="{y(py)}" r="9" fill="#dcef75" stroke="#1b342c" stroke-width="2"/>')
    for px, py in ((20.3, 36.628), (45.7, 36.628)):
        circles.append(f'<circle cx="{x(px)}" cy="{y(py)}" r="9" fill="#dcef75" stroke="#1b342c" stroke-width="2"/>')
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 650" role="img" aria-labelledby="title desc">
<title id="title">Pico and NeoPixel prototype tray top layout</title>
<desc id="desc">66 by 45 millimeter tray with two reference board envelopes and six locator bosses. Component bodies, cables and print tolerances are not shown.</desc>
<rect width="900" height="650" fill="#f0efe8"/>
<text x="103" y="42" fill="#1a3029" font-family="Arial,sans-serif" font-size="24" font-weight="700">PICO + NEOPIXEL / TRAY 01</text>
<text x="104" y="66" fill="#647568" font-family="monospace" font-size="11" letter-spacing="2">TOP VIEW · DIMENSIONS IN MM · BOARD ENVELOPES ONLY</text>
<rect x="{x(0)}" y="{y(0)}" width="{t['length']*scale}" height="{t['width']*scale}" fill="#19332b" stroke="#19332b" stroke-width="2"/>
<rect x="{x(t['wall'])}" y="{y(t['wall'])}" width="{(t['length']-2*t['wall'])*scale}" height="{(t['width']-2*t['wall'])*scale}" fill="#e2e8da"/>
<rect x="{x(0)-1}" y="{y(t['usb_notch_y'][0])}" width="{(t['wall']+1)*scale}" height="{(t['usb_notch_y'][1]-t['usb_notch_y'][0])*scale}" fill="#f0efe8"/>
<rect x="{x(pico[0])}" y="{y(pico[1])}" width="{pico[2]*scale}" height="{pico[3]*scale}" fill="#8da99a" fill-opacity=".88" stroke="#2c5142" stroke-width="2" stroke-dasharray="6 4"/>
<text x="{x(pico[0])+18}" y="{y(pico[1])+42}" fill="#163329" font-family="Arial,sans-serif" font-size="20" font-weight="700">Raspberry Pi Pico R3</text>
<text x="{x(pico[0])+18}" y="{y(pico[1])+67}" fill="#2d5445" font-family="monospace" font-size="13">STEP ENVELOPE 52.3 × 21.0</text>
<rect x="{x(stick[0])}" y="{y(stick[1])}" width="{stick[2]*scale}" height="{stick[3]*scale}" fill="#dcef75" fill-opacity=".9" stroke="#6c872b" stroke-width="2" stroke-dasharray="6 4"/>
<text x="{x(stick[0])+15}" y="{y(stick[1])+40}" fill="#253d22" font-family="Arial,sans-serif" font-size="18" font-weight="700">Adafruit NeoPixel Stick #1426</text>
<text x="{x(stick[0])+15}" y="{y(stick[1])+63}" fill="#4f6929" font-family="monospace" font-size="12">PUBLISHED ENVELOPE 51.1 × 10.2</text>
{''.join(circles)}
<path d="M{x(0)} 95V78 M{x(t['length'])} 95V78 M{x(0)} 88H{x(t['length'])}" stroke="#789078" stroke-width="1.5"/>
<text x="{x(t['length']/2)}" y="84" fill="#375a42" font-family="monospace" font-size="13" text-anchor="middle">66</text>
<path d="M70 {y(0)}H88 M70 {y(t['width'])}H88 M79 {y(0)}V{y(t['width'])}" stroke="#789078" stroke-width="1.5"/>
<text x="63" y="{y(t['width']/2)}" fill="#375a42" font-family="monospace" font-size="13" text-anchor="middle" transform="rotate(-90 63 {y(t['width']/2)})">45</text>
<text x="104" y="584" fill="#526b54" font-family="monospace" font-size="12">● LOCATOR PINS: 1.6 MM DIA · 0.25 / 0.30 MM NOMINAL RADIAL HOLE CLEARANCE</text>
<text x="104" y="610" fill="#778478" font-family="Arial,sans-serif" font-size="12">USB notch, cable plug, component height and fastening require physical validation.</text>
</svg>'''
    out.write_text(svg + "\n")
    print(out)


if __name__ == "__main__":
    main()
