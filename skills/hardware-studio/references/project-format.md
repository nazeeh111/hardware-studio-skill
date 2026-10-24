# Hardware Studio project JSON

Use this format when handing a Codex-designed project to the browser app. The app imports JSON, assigns a new local ID, and resets review marks. Keep IDs stable within the file and unique for each part. A connection's `from` and `to` must match part IDs. Costs are per unit in USD and should be marked as estimates unless checked against current listings. Write useful part details, not just generic names.

Connections can also carry `fromPin` and `toPin` strings for exact pins or terminals. Keep them empty when the chosen part is not exact or its pinout has not been checked. The app flags every connection missing either endpoint, so a part-level arrow cannot masquerade as a complete wiring instruction. A connection entry should describe one conductor or a clearly named bus; split combined power and ground runs before physical wiring.
For a selected part, optional `pins` is an array of unique pin or terminal names copied from that exact revision's maker documentation. If a selected connector has unlabeled positions, or a carrier has a shared rail without exact hole addresses, an `ASSIGNED`-prefixed assembly label may be recorded instead. State explicitly in the part detail and wiring plan that it is a project assignment, count physical positions, and map and continuity-check the actual holes before assembly. The app and CSV exporter flag these assembly labels separately from maker pin names. The connection editor also flags a named endpoint missing from the recorded inventory. These checks do not establish correct function, voltage, direction, current rating or physical connection.

`mechanicalConnections` is optional for older projects. Each entry links two existing part IDs using `from`, `to`, a short `label` describing mounting or fit intent, and an optional `note` for dimensions, fasteners or unresolved checks. A same-part relationship needs at least two units of that part. These records are assembly notes, not dimensioned CAD or proof of physical fit.

```json
{
  "title": "USB temperature display",
  "brief": "A desk display for room temperature powered by USB.",
  "summary": "Concept design awaiting component and enclosure review.",
  "cadUrl": "",
  "wiringUrl": "",
  "traySpec": null,
  "solidSpec": null,
  "referenceImage": null,
  "tools": ["Multimeter", "Wire stripper"],
  "assumptions": ["Exact controller and display modules still need selection."],
  "parts": [
    {
      "id": "controller",
      "name": "Exact controller model to select",
      "category": "Control",
      "qty": 1,
      "unitCost": 0,
      "detail": "Select a board with documented I2C pins; add the manufacturer datasheet URL and revision here.",
      "voltage": "unknown",
      "pins": [],
      "sourceUrl": "",
      "specUrl": "",
      "checkedAt": "",
      "verified": false
    }
  ],
  "wires": [],
  "mechanicalConnections": [],
  "powerRails": [
    {
      "id": "rail-5v",
      "name": "USB 5 V input",
      "voltageV": 5,
      "supplyCurrentMa": null,
      "marginPercent": 20,
      "sourcePartId": "",
      "loads": [
        { "partId": "controller", "currentMaEach": null }
      ]
    }
  ],
  "steps": [
    {
      "phase": "Prepare",
      "title": "Choose exact controller",
      "detail": "Confirm USB power, pinout and physical dimensions against the manufacturer's documentation.",
      "partIds": ["controller"],
      "done": false
    }
  ],
  "notes": "Open: display choice, power budget, enclosure dimensions.",
  "review": { "electrical": false, "mechanical": false, "sourcing": false }
}
```

The sample demonstrates the carrier only; it is deliberately incomplete as a build plan. For a real deliverable, include every physical part and required connection, pin and voltage notes, a stepwise bring-up sequence, exact source URLs and dates where verified, and unresolved decisions. Do not mark `verified` or `review` true on a generated draft. If a price is unknown, use `0` and explain in `detail` that it is unpriced; do not present the zero as a quote. `sourceUrl` is a supplier listing; `specUrl` is the exact specification or independent evidence used for part review. A checked part needs both `specUrl` and an ISO `checkedAt` timestamp. The app resets those check marks when importing a file.

`tools` and `assumptions` are optional short-text lists for the whole build. A step's optional `partIds` lists the exact IDs of parts used in that operation. The app shows those names beside the step, rejects duplicate IDs in one step, and reports references to missing parts. Deleting a part in the editor also removes its step links. Older projects without these fields still import. Imported `done` values are always reset to `false`; only the current user's checklist actions record completion. The project ZIP contains a readable `build-plan.txt` as well as these fields in `project.json`; neither is a verified procedure.

`powerRails` is optional for older projects. Each rail's `sourcePartId` and load `partId` must match a part ID. `currentMaEach` is the peak current per unit in milliamps; the app multiplies it by that part's quantity. Use `null` when current or rated supply is unknown, and record the source and operating conditions in the project notes. A computed headroom covers only assigned loads, so check startup surges, voltage compatibility, wires, connectors and regulator heat separately.

`cadUrl` and `wiringUrl` are optional. Link the editable CAD source and its verification package through `cadUrl`, and an electrical plan with its evidence and open checks through `wiringUrl`. The app shows the links beside conceptual drawings; those links do not turn the drawings into verified CAD or a checked schematic. Imported URLs are restricted to HTTP(S), and imported review marks still reset.

`referenceImage` is optional. The browser app can add a local sketch or photo to a brief and stores a resized JPEG in this field as `{ "name": "sketch.png", "dataUrl": "data:image/jpeg;base64,..." }`. The field is capped at 250 KB of encoded text. Keep it `null` in hand-authored project files unless you have an actual image; do not manufacture a visual reference from a description. The ZIP export includes it as `reference.jpg` when present. A picture does not establish exact dimensions, part numbers or electrical ratings.

A reference created with **Draw sketch** also has optional `sketch`: `{ "schema": "hardware-studio-sketch-v1", "width": 768, "height": 480, "strokes": [...] }`. Each action is a `pen` or `eraser` with a color, width (2, 5, 10 or 20) and finite `[x,y]` points, or `text` with a color, label, x and y. Supported colors are `#14211f`, `#9a5f42` and `#61733f`. Coordinates must stay inside the canvas. Limits are 300 actions, 8,000 total points and 80 characters per single-line label. The browser validates this source on import and storage recovery, retains it in project JSON, and exports the same data as `reference-sketch.json`. The JPEG excludes the optional grid. A hand-authored vector source must describe an actual supplied drawing and accompany a real JPEG reference.

The app accepts additional fields but does not use them. Keep full calculations, datasheet links and dimensioned CAD sources beside the JSON when they cannot be represented faithfully in these fields.

The browser tray workbench stores its valid draft with the local project as optional `traySpec`, and the project ZIP includes the same geometry as `tray-spec.json`. The spec may include `lid: {"thickness": 2.5, "skirtDepth": 3, "skirtWall": 2, "clearance": 0.5, "window": {"x": 6, "y": 27, "length": 54, "width": 14}}` for a separate, unretained lift-off cover that wraps outside the tray with a through-plate rectangular opening. Omit `window` or set it to `null` for a solid plate. The opening must leave at least 1 mm of plate inside each tray wall. Project JSON imports retain this field while resetting mechanical review. Download the spec directly from the workbench or use the repository's tray generator to make tray and optional lid STEP/STL; check component fit against both and record the resulting evidence URL in `cadUrl` when published.
The skill checker validates `traySpec` against the same input rules as the browser editor. This only checks that the requested geometry is internally well formed; it does not compare it to manufacturer models or a physical assembly.


### Editable feature part

Optional `solidSpec` stores one connected feature part, validated by the browser and skill checker with the same rules. Schema is `hardware-studio-solid-v1`, units `mm`, with a short `title`, 1–32 ordered `features` and up to 16 `probes`. Features have unique `id`, `operation` (`add` or `cut`) and `shape`. A box uses `origin: [x,y,z]` at the minimum corner and `size: [x,y,z]`; a cylinder uses a base-center `origin`, positive `axis` (`x`, `y` or `z`), `radius` and `height`. A `profile` uses a base `origin`, positive `axis`, `height` and `points: [[u,v],...]` with 3–64 simple polygon corners and implicit closure. Local U/V axes are X/Y for +Z, Y/Z for +X, Z/X for +Y. All edges must be at least 0.01 mm, without crossings, non-adjacent touches, repeated vertices or adjacent collinear corners. Clockwise input is normalized counterclockwise. Use separate cut features for holes; one profile has no inner rings. Probes use the same primitive fields with `expect: "material"` or `"void"` instead of operation. Coordinates are bounded to ±500 mm and positive lengths to 0.01–500 mm. The first feature must add material. See the repository’s `tools/solid-generator/README.md` for generation constraints and the worked `examples/feature-bracket/` for source/readback.

A `curve` primitive has `origin`, positive `axis`, `height`, `start:[u,v]` and 2–64 ordered line/three-point-arc `segments`: `{kind:"line",end:[u,v]}` or `{kind:"arc",via:[u,v],end:[u,v]}`. The previous endpoint starts the next segment. Final closure is explicit within 1e-7 mm. Winding is preserved. One simple loop only; crossings, touches, degenerate arcs and repeated portions reject. Radius is 0.01–500 mm; coordinate and local-axis rules above apply. Holes remain separate cuts.

A fillet feature is `{id,operation:"fillet",radius,edges:[[x,y,z],...],tolerance:0.01}` without `shape` or `origin`. It cannot be the first feature or a probe. Use 1–16 seed points, each resolving to exactly one current edge away from vertices, without selecting the same physical edge twice. Tolerance is 1e-6–0.1 mm. The kernel may extend across connected tangent edges. Radius/effect/solid validity checks can reject a source that passes structural validation. Curves and fillets need the optional pinned build123d runtime; model data is never executed as Python. The JS checker mirrors the browser's structural rules.

The project modeler saves applied source in a project-specific cache; the main app merges the latest valid source into project data and resets mechanical review after changes. **Export source ZIP** contains matching `solid-spec.json` without generated STEP/STL. The local **Build project + CAD ZIP** action explicitly compiles and includes checked geometry for all recorded CAD branches, as described below; individual modeler downloads also remain available. Imports allocate independent IDs. History restores project and cache source together using captured-byte checks; an unreadable or intervening newer cache cancels replacement. Deleted recovery retains valid newer workbench source. The direct `solid.html` URL is a separate standalone workspace. Projects without saved source open empty; examples are loaded only by explicit choice. These fields do not map one feature part to an entire physical assembly and do not prove strength, tolerance or fit.


### Per-part CAD and rigid placements

Optional `assemblySpec` is `{schema:"hardware-studio-assembly-v1",title,units:"mm",assets,instances}`. `assets` contains up to 8 unique `{partId,source}` records; `source` follows the feature format above. There are at most 128 features total. `instances` contains up to 16 `{id,partId,position:[x,y,z],rotation:[rx,ry,rz]}` records. IDs are exact, nonempty strings up to80 characters, including any leading/trailing spaces; control characters reject. Every instance references an existing asset. The JSON limit is262144 UTF-8 bytes. Drafts can have empty sources/placements; generation needs at least one placed instance. Title is1–100 characters.

Position is millimeters within ±500; rotation is degrees within ±360. The transform is `T*Rz*Ry*Rx`, around the source origin: X, then Y, then Z, then translation. No automatic recentering, joint or constraint solve occurs. Repeated part instances share their source. Quantity differences and unplaced assets are open checks. CAD for deleted parts remains structurally valid and preserved; missing parts-list IDs produce an issue until explicitly rebound to an unbound part.

A single assembly sidecar is checked before any per-part or placement save, preventing a stale editor from overwriting a different part’s newer source. Main project synchronization invalidates mechanical review; benign embedding of the current sidecar is recognized without invalidating the same editor’s next save. Import allocates a new project identity. History/cache restore compares captured bytes and rolls back only its own writes; unreadable originals stay preserved. Project ZIP contains matching `assembly-spec.json` and local source files named in asset order, `cad-sources/part-001.json`. The sources map to exact part IDs in `assemblySpec`; these safe filenames never use user text as paths.

Local checked assembly ZIP contains `spec.json`, `assembly.step`, `build-report.json`, `verification.json`, local `assets/part-001/{spec.json,solid.step,solid.stl}` and transformed `instances/instance-001.{step,stl}`. Its manifest maps instance IDs to filenames, bounds, volume and hashes. Fresh source reconstruction and STEP readback check rigid placement. Pair overlap above0.01 mm³ is INTERFERENCE; smaller overlaps and zero-distance contact remain reported. These same-kernel nominal checks do not validate physical fit, materials, tolerances or motion.


### Project source and CAD handoff

The studio has two explicit exports. **Export source ZIP** retains project data and editable CAD source without running a generator. **Build project + CAD ZIP** captures the current project with merged valid saved CAD sources, creates that source ZIP once, then submits its exact bytes to the current loopback server. It does not apply unfinished workbench edits or change review/completion marks. Public Pages and the basic static server cannot generate this package. Curves/fillets in shared source or any assembly asset also require the optional advanced runtime.

The local request is `POST ./api/project-cad` with `{schema:"hardware-studio-project-cad-v1",sourceZipBase64}`. The response must be an `application/zip` archive with `X-Hardware-Studio-Source-SHA256` matching the captured source ZIP and `X-Hardware-Studio-CAD-Status` equal to `passed` or `interference`. The browser bounds requests to 12 MiB source ZIP and responses to 64 MiB. CLI entry point is `tools/project-generator/project.py --source-zip /absolute/source.zip --out /absolute/absent-output.zip`; use a separate output path with an existing parent. The compiler refuses to overwrite an existing destination and publishes only a complete result.

At least one non-null `traySpec`, `solidSpec` or `assemblySpec` is required. Every supplied branch must build and pass readback; a failure returns no partial project package. Assembly generation requires at least one placed instance and every asset/instance part ID must exist in the project parts list. A known unplaced asset remains present and checked as local geometry, with `placed: false` in the manifest, but is excluded from placement/pair checks. Source-only editing/export still preserves orphan CAD for explicit recovery/rebinding. Tray and shared solid are unbound project-level source; the compiler does not assign them to arbitrary parts.

The input requires the studio export's nine root files: `project.json`, `README.md`, `bill-of-materials.csv`, `connections.csv`, `mounting.csv`, `build-plan.txt`, `wiring.svg`, `assembly.svg` and `review.txt`. Optional CAD sidecars, ordered `cad-sources/part-NNN.json` files, JPEG and editable sketch must match their project fields. Original root entries retain their exact bytes in the result. `captured-source.zip` also retains the exact input archive, including its ZIP metadata. Added artifacts live under `generated-cad/tray/`, `generated-cad/shared-solid/` and `generated-cad/assembly/`. Retain reports, sources and raw STL/normalization receipts when produced.

`cad-package-manifest.json` uses schema `hardware-studio-project-cad-v1` and records `source_archive_sha256`, `source_archive_entry: "captured-source.zip"`, `project_json_sha256`, exact source entry hashes/lengths, branch source hashes/report paths, part bindings and hashes/lengths for every other output entry. It excludes its own hash. Status `interference` records completed readback with nominal assembly overlap; it does not mean the overlap is acceptable. Read pair reports before using the geometry. The [project generator guide](https://github.com/nazeeh111/hardware-studio-skill/tree/main/tools/project-generator) defines archive and process bounds; the [actual handoff example](https://github.com/nazeeh111/hardware-studio-skill/tree/main/examples/project-cad-handoff) retains replayable evidence.

A project edit or switch after capture does not change the finished artifact. The last completed package remains downloadable in tab memory after failure, timeout or cancellation; download it before reload. Cancellation stops the client request, while the local server may continue its bounded build. Captured source and hash agreement establish package identity. Same-kernel STEP readback and sampled mesh comparisons do not establish complete semantic correctness, exhaustive surface equivalence, physical fit, manufacturing tolerances, electrical behavior or the truth of supplied planning records.
