# Editable feature solids

This original generator builds one connected part from an ordered list of axis-aligned boxes and cylinders. Each operation adds or removes material. It supports brackets, bored spacers, mounting blocks and similar parts that fit these primitives. It does not support fillets, threads, arbitrary sketch extrusions, lofts or assemblies.

## Browser

Run the existing local server from the repository root:

```sh
sh tools/tray-generator/run-local.sh --port 4174
```

Open `http://127.0.0.1:4174/solid.html`. Inspect or edit the feature JSON, choose **Apply edited source**, then generate a 3D preview or checked CAD ZIP. The complete source remains editable; the feature summary is a source view, not generated geometry. An optional installed Ollama model proposes changes, with full-source review before acceptance. A proposal cannot apply over a changed source. Model output is data and is never executed as Python.

The public static site can edit, import and export source; generation requires the local CAD runtime. Optional text proposals send source and instructions to the loopback Ollama service. Browser storage is origin-scoped, including the public Pages host. Export files for backups and use the local app for sensitive work.

The editor retains up to 20 applied states in memory for undo/redo, plus the latest applied source in browser storage and unapplied text in the tab session when storage is available. A stale or unreadable stored record is preserved until its original bytes are downloaded and replacement is explicitly chosen. It is not simultaneous collaborative editing. Standalone feature JSON and CAD packages are separate from the main project JSON/ZIP in this version.

## CLI and source format

Use an OCP-enabled Python interpreter, selected by the existing server launcher on this Mac:

```sh
python tools/solid-generator/solid.py \
  --spec tools/solid-generator/examples/mounting-bracket.json \
  --out /absolute/path/to/new-output-directory
```

The output directory must be absent and its parent must exist. The [bracket source](examples/mounting-bracket.json) demonstrates all fields:

- `schema`: `hardware-studio-solid-v1`; `units`: `mm`; `title`: 1–100 characters.
- `features`: 1–32 ordered records, each with a unique `id`, `operation` (`add` or `cut`), `shape` and `origin` array. The first feature adds material.
- A `box` has `size: [X, Y, Z]`; its origin is the minimum corner.
- A `cylinder` has `radius`, `height` and `axis` (`x`, `y` or `z`); its origin is the base center and its axis points in the positive direction.
- `probes`: up to 16 records with unique IDs, `expect` (`material` or `void`), and the same primitive fields. A material probe requires at least 99.9% overlap; a void probe permits at most 0.1%. These are selected-region checks, not full wall-thickness or strength tests.

Numbers must be finite. Coordinates are bounded to ±500 mm; positive lengths range from 0.01 to 500 mm. Each result span must be at most 500 mm. The result volume and each operation’s absolute volume change must exceed 0.001 cubic millimeters. Unsupported fields, disconnected solids, changes below that threshold, invalid shapes and failing probes are rejected. The generator does not silently repair them.

## Export and evidence

The package contains `spec.json`, `solid.step`, `solid.stl`, `build-report.json` and `verification.json`. The build report records each operation's resulting volume and volume change. A separate process reopens STEP and checks one valid solid, dimensions and volume against the build report, repeats the supplied probes, and checks STL dimensions and finite coordinates. STEP preserves surfaces; only the feature JSON retains this operation sequence. The writer and reader use the same OpenCascade kernel, so this is not independent CAD-system interoperability.

The [worked bracket](../../examples/feature-bracket/README.md) also has an independently calculated expected volume. Physical fit, actual materials, fasteners, manufacturing tolerances, strength and measured behavior remain untested.
