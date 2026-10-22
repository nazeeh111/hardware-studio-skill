# Provisional electrical plan

![Proposed 5 V power and data path](preview/electrical-path.svg)

This is a **source-backed wiring proposal**, separate from the two-board mechanical fit check. No electrical assembly, supply measurement, signal measurement or physical placement of the auxiliary components has been performed. The [importable app project](project.json) records the same parts, connections and incomplete power worksheet.

## Evidence and decisions

| Decision | Evidence | Design consequence |
|---|---|---|
| Power the eight-pixel Stick at nominal 5 V | [Adafruit product #1426](https://www.adafruit.com/product/1426) specifies 5 VDC and warns the shipped LEDs may be WS2812B or SK6812 based. | Select the exact Stick revision before bench work. Use its marked **input** pads, not DOUT. |
| Budget for full-white LED demand | [Adafruit's power guide](https://learn.adafruit.com/adafruit-neopixel-uberguide/powering-neopixels) gives up to 60 mA per RGB pixel. | Eight pixels yield a **480 mA upper-bound estimate**. This is a design estimate, not measured current. Pico, shifter and harness demand remain unknown. |
| Translate Pico's 3.3 V data | [Raspberry Pi Pico documentation](https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html) identifies 3.3 V logic; [Adafruit's connection guide](https://learn.adafruit.com/adafruit-neopixel-uberguide/basic-connections) recommends a 74AHCT125-class shift for 5 V NeoPixels. [TI's SN74AHCT125 datasheet](https://www.ti.com/lit/ds/symlink/sn74ahct125.pdf) accepts a 2 V high at 4.5–5.5 V VCC. | Proposed Pico GP2 → SN74AHCT125N 1A pin 2, 1OE pin 1 held low, 1Y pin 3 → resistor → Stick DIN. Tie the grounds. Check the purchased IC's package marking and pinout. |
| Dampen the data edge and buffer input power | [Adafruit's power and best-practices guide](https://learn.adafruit.com/adafruit-neopixel-uberguide/powering-neopixels) recommends 300–500 Ω near DIN and 500–1000 µF across LED input power, rated at least 6.3 V. [TI's datasheet](https://www.ti.com/lit/ds/symlink/sn74ahct125.pdf) recommends 0.1 µF bypass close to its VCC pin. | Propose 470 Ω series data resistor, 1000 µF polarized capacitor at the Stick input, and 0.1 µF ceramic across IC pins 14/7. Verify capacitor polarity. |
| Keep power distribution explicit | Raspberry Pi identifies Pico `VBUS` as USB's 5 V input at pin 40; its [datasheet](https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf) explains the USB-to-`VSYS` path. | This plan does **not** route LED current through Pico's `VBUS` header. A selected regulated 5 V source and rated distribution harness must provide separate branches to Pico micro-USB, Stick and shifter, all sharing ground. The branch hardware is not specified or modeled yet. |

For the 14-pin PDIP version of SN74AHCT125N, TI shows VCC at pin 14 and GND at pin 7. Its three unused channels must not have floating logic inputs: tie unused `OE` inputs high and unused `A` inputs to a defined level, following the purchased package datasheet; unused outputs can remain disconnected. The data line must never feed 5 V into a Pico GPIO. The Stick's DOUT stays disconnected in this one-Stick design.

## Power worksheet

Known LED estimate: `8 × 60 mA = 480 mA` at full white. The project deliberately leaves the source rating, Pico current and shifter dynamic current blank, so the worksheet reports **incomplete**. Choosing a nominal supply rating alone will not prove cable, connector or branch adequacy. Record exact parts and their ratings, measure actual worst-case behavior, and retain headroom before releasing a build.

## Mechanical interaction still open

Only Pico and Stick are in the current tray STEP fit check. The shifter, two capacitors, resistor, wiring, distribution hardware, micro-USB plug and cable bend are **outside that verified geometry**. The next CAD revision must place them or explicitly keep them external, provide insulation and strain relief, and recheck access, thermal behavior and fit. Do initial unpowered continuity checks before any current-limited bench test.
