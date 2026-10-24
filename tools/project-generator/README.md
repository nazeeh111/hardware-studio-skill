# One project and CAD handoff

This local compiler takes the studio's existing **project source ZIP** and adds
actual checked STEP/STL artifacts for every non-null CAD branch. It preserves
every original source entry byte for byte, including project JSON, planning
documents, CSV files, diagrams and optional reference image/sketch.

```sh
.cad-runtime/bin/python tools/project-generator/project.py \
  --source-zip /absolute/path/to/project-package.zip \
  --out /absolute/path/to/absent-project-cad.zip
```

The destination must be absent and its parent must exist. Success publishes the
complete ZIP atomically without overwriting a destination created during the
build. Any rejected branch prevents the complete output. Input files and prior
outputs remain unchanged.

## Source and binding checks

The input must contain the existing export's nine required files:
`project.json`, `README.md`, `bill-of-materials.csv`, `connections.csv`,
`mounting.csv`, `build-plan.txt`, `wiring.svg`, `assembly.svg` and `review.txt`.
Optional `tray-spec.json`, `solid-spec.json` and `assembly-spec.json` must match
their respective project CAD fields. Ordered `cad-sources/part-001.json` through
`part-008.json` must match the assembly assets. Missing, mismatched or orphan
sidecars reject. At least one CAD branch is required.

Every assembly asset and instance must reference an actual project part, with
the existing generator's valid bounded placements. At least one instance is
required. Unplaced assets are preserved and checked as local solids, explicitly
marked `placed: false` in the manifest, and excluded from placement/pair checks.
Tray and shared feature solid are project-level source with no per-part binding;
the compiler does not invent one. Optional JPEG and editable sketch entries
must match the project's retained reference bytes/data.

Archive limits are 12 MiB compressed, 16 MiB uncompressed and 32 source entries.
Only the known export names are accepted. Duplicate paths, traversal, absolute
paths, symlinks, special files, directories, encryption, unsupported compression,
bad CRCs, duplicate JSON keys and nonfinite numbers reject. No archive path is
extracted. Generated artifacts use fixed trusted destinations. No external URL,
model, supplied Python or other supplied code is fetched or executed.

## Output and evidence

Original source entries retain their names and exact bytes. Added folders are:

- `generated-cad/tray/`, including optional cover and a separate strict mesh
  verification receipt.
- `generated-cad/shared-solid/` for the shared feature solid.
- `generated-cad/assembly/`, including local asset sources, placed instances,
  assembly STEP and pairwise interference report.

`captured-source.zip` also retains the exact original uploaded archive bytes,
including ZIP metadata. This allows the delivered bundle alone to replay the
captured source archive hash; rebuilding a ZIP from its entries would change
that hash. The original root source entries remain directly accessible too.

Every actual file produced by the trusted generators is retained, including raw
STL when numerical zero-area export facets were removed, normalization records,
build reports and fresh-process verification reports. Tray and cover receive the
same bounded strict mesh checks as feature solids: closed oriented topology,
signed volume, triangle-center agreement with trimmed STEP faces and reverse
face witnesses. Only trusted exports receive zero-area normalization. Original
raw exports are preserved if changed; the existing tray verifier is rerun after
the final STL bytes are established.

`cad-package-manifest.json` records schema `hardware-studio-project-cad-v1`,
machine status `passed` or `interference`, `source_archive_sha256`,
`source_archive_entry: "captured-source.zip"`, `project_json_sha256`, exact raw source entry hashes/lengths, branch source
hashes/report paths, asset/instance part bindings and hashes/lengths for every
other ZIP entry. The manifest excludes its own digest to avoid a circular hash.
`interference` is a completed readback with recorded nominal overlap, not a
claim that the interference is acceptable. Maximum final ZIP and uncompressed
handoff size are each 64 MiB.

STEP readback and source reconstruction use the same OpenCascade kernel. Mesh
checks sample boundaries and do not prove exhaustive surface distance or absence
of all self-intersections. Physical fit, manufacturing, materials, loads,
electrical behavior and the supplied planning claims remain unverified.

## Supervision and tests

The default CLI supervises a dedicated worker process group for at most 480
seconds and kills remaining descendants on every terminal outcome. It never
signals the caller's process group. Individual branches have a 240-second
generation limit; strict tray/cover checks have a 160-second limit. For the
local server only, `--worker` inherits its external supervisor's group. The
server must terminate that group on timeout, cancellation **and normal worker
exit**, so a failed native subprocess cannot leave its verifier behind. Branch
logs use temporary files rather than inherited output pipes.

```sh
.cad-runtime/bin/python -m unittest discover -s tools/project-generator/tests -v
```

The suite builds an actual three-branch archive with optional cover, preserves
source hashes and original bytes, checks placed and unplaced asset bindings,
rejects malformed archives and mismatched sources, preserves an existing output,
and verifies descendant termination after both exit and timeout.
