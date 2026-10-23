# Parametric tray generator

Generate an original open tray and optional separate lift-off cover from an explicit millimeter JSON specification. The command writes editable input, STEP, STL, a dimensioned top-view SVG, and two machine-readable reports. A separate process reopens each STEP and STL before the output directory is published. This verifies file integrity and modeled dimensions; it does not prove component fit or printability.

## Run

Use Python 3 with `OCP` (OpenCascade Python bindings). This repository was exercised with `cadquery-ocp-novtk` 8.0.1.1.0. From the repository root:

For the browser workbench and one-click CAD download, start the local server:

```sh
sh tools/tray-generator/run-local.sh --port 4174
```

Open `http://127.0.0.1:4174/tray.html`. The server binds only to `127.0.0.1`, accepts JSON only from its own browser origin, processes one CAD build at a time, and returns a ZIP containing the spec, tray STEP/STL, optional cover STEP/STL, SVG, build report and fresh-process verification. Stop it with Ctrl-C. Choose **Generate and inspect in 3D** for a direct viewer preview of the current spec. The `/api/tray-preview` route returns bounded tray/cover STL bytes and their readback report; the browser checks hashes, triangle counts and dimensions before rendering. The frozen input remains in the current tab's session storage for 30 minutes. The viewer's CAD ZIP action regenerates from that same spec. Preview meshes are limited to 16 MB combined and 400,000 triangles. The public GitHub Pages site can prepare and export a spec, but cannot run this local Python service.

The same local workbench can check one to four maker STEP files against its current tray and optional seated cover. Supply each file, a unique part ID, an axis orientation and X/Y/Z translation in millimeters. The browser limits each file to 8 MB and all files to 17 MB; the local server applies its own byte limits, generates the current geometry, runs `fit.py`, and returns a downloadable JSON report. Selected files are stored in a temporary local directory only during the check. The browser offers common quarter-turns and the worked Pico axis mapping; use the CLI manifest below for an arbitrary proper 3D rotation. The browser does not infer placement, mounting-hole alignment or real-world fit.

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

Optional `lid` adds a **separate lift-off cover**: `thickness` is its flat plate, `skirtDepth` is the outside vertical skirt, `skirtWall` is skirt thickness, and `clearance` is the nominal side gap to the tray. The cover plate sits at the tray rim; its skirt wraps outside and inherits openings where they overlap the skirt. The [cover study](examples/pico-neopixel-cover-study.json) uses 2.5 mm plate, 3 mm skirt depth, 2 mm skirt wall and 0.5 mm nominal gap. It has no snap, seal, fastener or verified cable access. A side gap in CAD is not a process tolerance. The opaque plate over this NeoPixel example blocks light and is **not** a functional lamp cover.

Optional `lid.window` cuts a rectangular aperture through the plate using tray X/Y coordinates and `length`/`width` in millimeters. It must leave at least 1 mm of plate inside every tray wall. The [open-window sample](examples/pico-neopixel-window-cover.json) uses `x: 6`, `y: 27`, `length: 54`, `width: 14` to expose the modeled NeoPixel Stick area. The separate-process reader probes the requested aperture and neighboring plate, and the supplied example's removed volume matches aperture area × plate thickness. This models an **open hole**, not a diffuser, gasket, optical path, ingress barrier or finished lighting product.

Each mount has a unique `id`, center `x` and `y`, `bossRadius`, and `bossTopZ`. Add either `locatorRadius` with `locatorHeight` for a pin, or `holeRadius` for a vertical through-hole. A cutout names `left`, `right`, `front`, or `back`, plus a horizontal `start` and `end` and vertical `bottom` and `top`. The generator rejects bosses outside the cavity, overlapping bosses, and cutouts that cross a corner or the floor.

The output includes `spec.json`, `tray.step`, `tray.stl`, `layout.svg`, `build-report.json`, and `verification.json`; with a cover it also includes `lid.step` and `lid.stl`. The report records dimensions, modeled volume, source-spec hash, STEP readback, STL triangles, output hashes and, when present, seated lid/tray overlap plus a deliberately shifted collision. Re-run from the saved `spec.json` to revise geometry. Keep physical part models, clearance/tolerance analysis, connector access, assembly method, material/process constraints, and bench checks in a separate design review. The supplied example has that additional evidence in [`examples/pico-neopixel-tray`](../../examples/pico-neopixel-tray/README.md); the generator does not automatically repeat it for a new spec.
New packages preserve `schema` and `units` in `spec.json`. The generic fit checker can also read earlier packages that omitted those two fields, while clearly marking that legacy normalization in its report.

## Check supplied component STEP models

Use `fit.py` after obtaining exact STEP files from the component makers. Put a manifest beside those files, or use absolute paths:

```json
{
  "schema": "hardware-studio-fit-v1",
  "trayPackage": "/absolute/path/to/generated-tray-package",
  "components": [
    {
      "id": "controller",
      "step": "/absolute/path/to/manufacturer-controller.step",
      "translationMm": [20, 12, 7],
      "rotation": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    }
  ],
  "overlapLimitMm3": 0.01
}
```

`rotation` maps source STEP coordinates into tray X/Y/Z. Its rows must form a proper orthonormal rotation, with no scaling or reflection. `translationMm` is applied after rotation. Inspect and measure the source model's coordinate frame before setting either value. Run with the same OCP-enabled Python used for the generator:

```sh
python tools/tray-generator/fit.py --manifest /absolute/path/to/fit-manifest.json --out /absolute/path/to/new-fit-report
```

The absent output directory receives `fit-report.json` with source hashes, transformed envelopes, cavity margins, tray/model, optional cover/model and model/model intersection volumes, and closest distances. It rejects a tray or cover STEP whose hash no longer matches its verification report. A result with no modeled intersection is **not** physical fit approval: maker CAD may omit connectors or tolerances, a board may be deliberately close to a support, and cable routing, thermal behavior, material shrinkage and assembly access are separate checks. The Pico + NeoPixel worked example adds part-specific checks beyond this generic report.

## Check

```sh
python -m unittest discover -s tools/tray-generator/tests -v
```
