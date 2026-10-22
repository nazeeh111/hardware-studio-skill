# Parametric tray generator

Generate an original open tray from an explicit millimeter JSON specification. The command writes editable input, STEP, STL, a dimensioned top-view SVG, and two machine-readable reports. A separate process reopens the STEP and STL before the output directory is published. This verifies file integrity and modeled dimensions; it does not prove component fit or printability.

## Run

Use Python 3 with `OCP` (OpenCascade Python bindings). This repository was exercised with `cadquery-ocp-novtk` 8.0.1.1.0. From the repository root:

For the browser workbench and one-click CAD download, start the local server:

```sh
sh tools/tray-generator/run-local.sh --port 4174
```

Open `http://127.0.0.1:4174/tray.html`. The server binds only to `127.0.0.1`, accepts JSON only from its own browser origin, processes one CAD build at a time, and returns a ZIP containing the spec, STEP, STL, SVG, build report and fresh-process verification. Stop it with Ctrl-C. The public GitHub Pages site can prepare and export a spec, but cannot run this local Python service.

The launcher selects this Mac's installed OCP environment when present, then checks `python3`. On another machine, set `HARDWARE_STUDIO_PYTHON` to a Python interpreter with the free `cadquery-ocp-novtk` package installed. It exits with a clear error if no usable interpreter is available.

For a command-line build from a saved spec:

```sh
python tools/tray-generator/generate.py \
  --spec tools/tray-generator/examples/pico-neopixel-tray.json \
  --out /absolute/path/to/new-tray-package
```

`--out` must name a directory that does not exist. Its parent must already exist. The command leaves an existing output untouched and removes a failed staging package.

## Spec

The [Pico + NeoPixel example](examples/pico-neopixel-tray.json) is a complete input. Required fields are `schema: "hardware-studio-tray-v1"`, `units: "mm"`, `outer.length`, `outer.width`, `outer.height`, `wall`, and `floor`. Coordinates start at the outer front-left bottom corner: X runs along length, Y along width, Z upward. `mounts` and `cutouts` may be empty arrays.

Each mount has a unique `id`, center `x` and `y`, `bossRadius`, and `bossTopZ`. Add either `locatorRadius` with `locatorHeight` for a pin, or `holeRadius` for a vertical through-hole. A cutout names `left`, `right`, `front`, or `back`, plus a horizontal `start` and `end` and vertical `bottom` and `top`. The generator rejects bosses outside the cavity, overlapping bosses, and cutouts that cross a corner or the floor.

The output includes `spec.json`, `tray.step`, `tray.stl`, `layout.svg`, `build-report.json`, and `verification.json`. The report records dimensions, modeled volume, source-spec hash, STEP readback, STL triangles, and output hashes. Re-run from the saved `spec.json` to revise geometry. Keep physical part models, clearance/tolerance analysis, connector access, assembly method, material/process constraints, and bench checks in a separate design review. The supplied example has that additional evidence in [`examples/pico-neopixel-tray`](../../examples/pico-neopixel-tray/README.md); the generator does not automatically repeat it for a new spec.

## Check

```sh
python -m unittest discover -s tools/tray-generator/tests -v
```
