# Editable feature solids

This original generator builds one connected part from an ordered list of axis-aligned boxes, cylinders and simple polygon extrusions. Each operation adds or removes material. It supports brackets, bored spacers, mounting blocks and similar parts that fit these primitives. It does not support fillets, threads, curved or multiply connected sketches, lofts or assemblies.

## Browser

Run the existing local server from the repository root:

```sh
sh tools/tray-generator/run-local.sh --port 4174
```

Open `http://127.0.0.1:4174/solid.html`. Edit sizes, positions, operations and polygon points in the dimension editor, or expand **Editable source / JSON**, then choose **Apply changes**, then generate a 3D preview or checked CAD ZIP. The complete source remains editable; the feature summary is a source view, not generated geometry. An optional installed Ollama model creates a new part from explicit dimensions or edits the current source. New projects open without inherited example geometry. Select a target project part when opened from the studio; the captured brief and part description provide design context, without a per-part CAD binding. The model returns ready, needs-input or unsupported data. Review the full source before acceptance. A changed request, mode, model, target, project or saved source blocks application. Numeric intent still needs comparison against actual generated geometry. Download the captured proposal before reloading; request choices are retained in tab storage when available. Model output is data and is never executed as Python.

The public static site can edit, import and export source; generation requires the local CAD runtime. Optional text proposals send source and instructions to the loopback Ollama service. Browser storage is origin-scoped, including the public Pages host. Export files for backups and use the local app for sensitive work.

The editor retains up to 20 applied states in memory for undo/redo, plus the latest applied source in browser storage and unapplied source (including incomplete numeric fields) in the tab session when storage is available. A stale or unreadable stored record is preserved until its original bytes are downloaded and replacement is explicitly chosen. It is not simultaneous collaborative editing. Opening the modeler from the project’s Assembly tab keeps applied source as `solidSpec` in project JSON, ZIP and history. Its direct URL retains a separate standalone draft. Checked STEP/STL packages remain separate downloads. Incomplete dimensions block Apply and generation; discard unapplied changes to return to the latest applied source.

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
- A `profile` has `points: [[u,v],...]`, `height`, `axis` and base `origin`. It extrudes one simple implicitly closed outline in the positive axis direction. Local U/V axes are X/Y for +Z, Y/Z for +X, Z/X for +Y, relative to origin. Use 3–64 corners with edges at least 0.01 mm; crossings, non-adjacent touches, repeated vertices and adjacent collinear corners are rejected. Clockwise input is normalized counterclockwise while preserving the first vertex. The [profile plate source](examples/profile-plate.json) demonstrates a concave outline with a cylinder hole and polygon region checks. Add holes through separate cut features; a single profile has no inner rings.
- `probes`: up to 16 records with unique IDs, `expect` (`material` or `void`), and the same primitive fields. A material probe requires at least 99.9% overlap; a void probe permits at most 0.1%. These are selected-region checks, not full wall-thickness or strength tests.

Numbers must be finite. Coordinates are bounded to ±500 mm; positive lengths range from 0.01 to 500 mm. Each result span must be at most 500 mm. The result volume and each operation’s absolute volume change must exceed 0.001 cubic millimeters. Unsupported fields, disconnected solids, changes below that threshold, invalid shapes and failing probes are rejected. The generator does not silently repair them.

## Export and evidence

The package contains `spec.json`, `solid.step`, `solid.stl`, `build-report.json` and `verification.json`. The build report records each operation's resulting volume and volume change. A separate process reopens STEP and checks one valid solid, dimensions and volume against the build report, repeats the supplied probes, and checks STL dimensions and finite coordinates. STEP preserves surfaces; only the feature JSON retains this operation sequence. The writer and reader use the same OpenCascade kernel, so this is not independent CAD-system interoperability.

The [profile plate](../../examples/profile-plate/README.md) also verifies a concave outline and an analytical volume expectation. Triangular prisms can have eight STL triangles, so readback no longer assumes the twelve-triangle box minimum. The [worked bracket](../../examples/feature-bracket/README.md) also has an independently calculated expected volume. Physical fit, actual materials, fasteners, manufacturing tolerances, strength and measured behavior remain untested.
