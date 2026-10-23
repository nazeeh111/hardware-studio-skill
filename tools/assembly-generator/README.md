# Placed assembly generator

This local OpenCascade generator builds bounded, explicit placements of existing
declarative solid sources. It does not infer placement, solve joints, or prove
physical fit. No submitted code is executed.

Run with the same OCP-enabled Python used by the tray and solid tools:

```sh
python tools/assembly-generator/assembly.py --spec assembly.json --out new-package
python tools/assembly-generator/assembly.py --verify new-package
python -m unittest discover -s tools/assembly-generator/tests -v
```

The output directory must be absent and its parent must exist. Failed builds are
removed from their temporary staging directory; existing output is preserved.
The local CAD server exposes `POST /api/assembly` (ZIP) and
`POST /api/assembly-preview` (JSON) and advertises `placed-assembly-v1`.
Each server build runs in its own POSIX process group with a 180-second limit.
Timeout cleanup kills that group, including the fresh-process verifier, before
reaping the generator, removing temporary files and releasing the CAD build lock.

## Source contract

```json
{
  "schema": "hardware-studio-assembly-v1",
  "title": "Two placed plates",
  "units": "mm",
  "assets": [{"partId": "plate", "source": {"schema": "hardware-studio-solid-v1", "title": "Plate", "units": "mm", "features": [{"id": "body", "operation": "add", "shape": "box", "origin": [0, 0, 0], "size": [20, 10, 2]}], "probes": []}}],
  "instances": [
    {"id": "first", "partId": "plate", "position": [0, 0, 0], "rotation": [0, 0, 0]},
    {"id": "second", "partId": "plate", "position": [25, 0, 0], "rotation": [0, 0, 90]}
  ]
}
```

All shown fields are required. Unknown fields are rejected. There are 1–8 unique
assets, 1–16 unique instances, and at most 128 features across asset sources.
Sources use the existing validated solid contract and each must build one valid
connected solid. IDs contain 1–80 characters, title 1–100, without control
characters. Submitted source is at most 262,144 bytes.
Identifiers are preserved exactly, including leading or trailing spaces; an
identifier made only of whitespace is invalid. Title whitespace is trimmed.
Instance position is XYZ millimeters within ±500. Rotation is XYZ Euler degrees
within ±360: rotate around
the source origin in X, then Y, then Z, then translate (`T*Rz*Ry*Rx`). Geometry
is never silently recentered. Unplaced assets are allowed and clearly reported.

## Package and verification

The ZIP contains normalized `spec.json`, unfused `assembly.step`,
`build-report.json`, `verification.json`, local asset files in
`assets/part-001/{spec.json,solid.step,solid.stl}`, and world-coordinate files in
`instances/instance-001.{step,stl}`. Sequential filenames never use caller IDs as
paths. `verification.json` maps safe filenames back to part and instance IDs,
reports absolute bounds, volumes, mesh counts and SHA-256 hashes.

A fresh process rebuilds each source, reopens its STEP, and checks source probes.
It independently composes sequential axis rotations and translation, then checks
each instance's reopened STEP bounds, volume and common volume against that
placement. Every solid in the combined STEP must match exactly one instance.
STL bounds are checked in world coordinates against STEP. Meshes together are
limited to 16 MB and 400,000 triangles. Preview JSON uses
`hardware-studio-assembly-preview-v1`, normalized `spec`, `verification`, and
`meshes: [{name, id, partId, dataBase64}]`.

Every instance pair reports overlap volume and minimum surface distance. Overlap
above 0.01 mm³ sets `verification.status` to `interference`; the package and
preview remain available for inspection. Touching and zero-distance contact are
allowed, and smaller overlaps are still reported. `passed` means the specified
nominal geometry has no pair above that threshold and passed readback. It does
not establish physical fit, print tolerances, wall adequacy, loads, fasteners,
supplier accuracy or instruction fidelity. STEP writer and verifier share the
same OpenCascade kernel.
