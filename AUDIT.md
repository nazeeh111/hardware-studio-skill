# Hardware Studio review

22 October 2026 onward. This records successive checks of the original Hardware Studio implementation and worked examples. Earlier sections describe their recorded revision; later dated sections supersede capability descriptions and test totals. It does not certify a physical device or claim feature parity with Blueprint.io.

## Product and data integrity

| Surface | What was checked | Result |
| --- | --- | --- |
| Browser storage | Filled an isolated browser origin to its storage limit, then edited a part and added a rail | Failed writes showed an error and rolled back the visible edit; the editor retained the attempted field value so it could be copied before closing. |
| Project import | Reviewed the untrusted JSON path, reference-image limits, URLs, review marks and step progress | Imported review and part verification marks reset. Imported step completion now resets too; a supplied file cannot precheck the current user's build checklist. |
| Assembly | Reimported the 15-part example into an isolated origin | All 15 parts appeared in the conceptual view. The project includes two recorded tray-to-board mounting intents. These notes do not prove fit or retention. |
| Connection register | Compared the app's CSV exporter with the example CSV | 28 rows matched exactly. Six lack a named endpoint and 17 use assembly-assigned labels that need a physical port or solder-hole map. |
| Responsive interface | Inspected fresh full-page desktop, narrow and 390-pixel phone previews | The six-view tab strip scrolls horizontally on a phone and now gives an explicit swipe cue. |
| Local image drafting | Tested an attached original render with a local vision model and a separate local draft model | One incomplete vision draft was rejected. The accepted concept remained unverified and the review rail flagged its missing LED supply/return path. |

## CAD and local-server checks

The Pico tray and open-window cover have editable source, STEP and STL exports, fresh-process readback, nominal manufacturer-model fit reports, and Blender scene files. The reports establish modeled dimensions and intersections at recorded poses. They do not establish real-part tolerances, print quality, cable routing, cover retention, light diffusion or electrical safety.

The local CAD server binds to `127.0.0.1`. A security review found that static GET and HEAD responses originally skipped its Host gate and could list directories. The handler now checks Host, Origin and Fetch Metadata before static responses and disables directory listings. The documented basic preview command also binds to `127.0.0.1`.

## Security review

An offline current-source scan covered browser import and rendering, Ollama responses, CSV/SVG/ZIP exports, origin storage, CAD API and STEP uploads, source, tests, docs and generated text artifacts. Binary renders, Blender scenes, CAD solids and bytecode were not decoded as source. Three low-severity findings were recorded against the pre-fix snapshot:

1. Imported JSON could precheck build steps. **Fixed** by resetting imported completion marks; the import test covers truthy values.
2. Local CAD static GET/HEAD skipped the Host gate. **Fixed** by checking both methods and disabling directory listings; loopback integration tests cover foreign and local Host headers.
3. The public GitHub Pages path uses origin-scoped browser storage on `nazeeh111.github.io`. A script on another path of that same host could access drafts if such a script were malicious or compromised. **Disclosed in the app and README.** A dedicated origin would be needed for isolation; use the loopback version for sensitive drafts. No compromised sibling site was established.

The scan did not find a source-backed XSS, CSV formula injection, ZIP traversal, upload path traversal, command injection or embedded credential in the reviewed text. It did not attempt a DNS-rebinding exploit or assess live hosting headers.

## Verification after fixes

- Node app tests: **46 passed**, including binary/ASCII STL parsing, malformed coordinates, real example dimensions and GLB conversion.
- OpenCascade tray/fit/server tests: **13 passed**; feature-solid generator tests: **3 passed**, including the new GET/HEAD Host and directory checks.
- The app's source syntax, example structural checks, Markdown links, live Pages bytes and installed skill copy should be rechecked at each new publication; a successful local test is not a deployed revision.

The 3D viewer was checked in a local browser with the 4,148-triangle tray/cover example, cover lift, local STL file selection and browser GLB download. A 390-pixel viewport had no horizontal overflow. Blender 5.1.2 imported the downloaded GLB with two separate meshes and the correct world-space spans of 66 × 45 × 14 mm and 71 × 50 × 5.5 mm. The GLB excludes the display-only lift. These later viewer files were not part of the earlier sealed security scan.

An independent source reviewer caught silent partial ASCII-STL parsing and an inaccessible file chooser. The parser now validates complete facet records and rejects malformed vertices instead of dropping them; the chooser is a native button. Regression tests passed and the reviewer confirmed both source fixes.

## Open engineering work

The example power worksheet remains incomplete. Current draw, branch ratings, voltage drop, connector and wire fit, exact solder-hole assignment, cable strain relief, physical assembly, measured behavior and fabrication evidence are not supplied. Arbitrary idea-to-CAD, reliable image understanding, live sourcing and authenticated Blueprint workflows remain outside this implementation.


The direct workbench-to-viewer flow generated a custom 90 × 60 × 20 mm tray and 95 × 65 × 5.5 mm window cover in an isolated local browser. The viewer checked mesh hashes, triangle counts and dimensions against the fresh readback, survived reload using the frozen session snapshot, and downloaded a CAD ZIP. Independent inspection of that actual ZIP passed CRC and confirmed the same specification, spans and STL hashes. Snapshot expiry, changed specs, corrupted mesh bytes and mismatched readback dimensions have negative tests. A source reviewer caught an uncovered-tray null-lid error; it was fixed and covered in both client and endpoint tests. All four server tests passed after the fix. This workflow has not been included in a new security scan.


## Editable sketch review

The drawing pad was exercised with nine strokes and three text labels: clear and undo restored the drawing, closing and reopening retained an unfinished draft, saved editing survived reload, and an actual downloaded project ZIP passed CRC. Its 12-action `reference-sketch.json` matched the project source exactly; the 10,591-byte JPEG matched the decoded project reference and visually excluded the drawing grid. The desktop dialog and narrow-width layout were inspected; at a 390-pixel viewport the document and dialog stayed within the viewport. The in-app screenshot capture under mobile emulation was scaled inconsistently, so this is not evidence of physical-device touch testing.

Independent source review found that attaching a sketch before creating a project could lose it on reload. Pending image and vector data now persist in the tab session, and a failed session write retains the unfinished source. Reload before project creation restored the editable pending reference in the browser; a controlled storage check confirmed save, remove and failure behavior. Saved project edits use the existing write rollback and reset review marks. The Node sketch checks cover history branching, deep-copy isolation, malformed and oversized source rejection, and project import. These new files have not undergone another security scan. Image understanding, arbitrary geometry and physical engineering checks remain separate open work.


## Cross-tab and unreadable tray recovery

A fresh source review found two preservation defects: a stale app tab could overwrite the complete workspace saved by another tab, and opening a tray workbench could overwrite an unreadable tray draft with fallback geometry. Both paths now compare saved bytes with the tab's startup/last-save baseline before writing. A mismatch blocks the write. The app offers an attempted-workspace JSON backup before explicit reload; the tray editor preserves original bytes, permits current-spec download, and requires an original-byte download before explicit replacement. Recovery of an unreadable main workspace also refuses to replace changed bytes.

An isolated two-tab browser test created a project in one tab, blocked project creation from the stale second tab, then enabled reload only after a backup download and restored the newer two-project workspace. An unreadable tray fixture stayed protected on open; its actual downloaded backup matched the original `{broken-review-draft` bytes exactly, and explicit replacement persisted valid geometry after reload. Two Node tests cover stale creation/edit/deletion and write failure. All 41 Node tests and all 12 OpenCascade/fit/server tests passed in this review. The guard detects stale reads; localStorage has no cross-tab transaction, so this is not simultaneous collaborative editing. Final cross-tab and tray patches were checked directly after the independent reviewer identified the defects; that reviewer did not complete a final patch pass.


## Local text-to-tray trial

The real installed qwen3:4b model first returned unsupported fields, which were rejected while retaining dimensions. A schema-constrained request returned 120 × 80 × 25 mm with 3 mm wall/floor. The complete proposal was visible; a changed form blocked acceptance. After acceptance, its actual browser-downloaded spec matched those numbers. The original generator built it and a fresh process read back one solid, matching STEP/STL spans, 28 triangles and 54,408 mm³ volume. The model assumption contained a textual width typo while the numeric parameter was correct. See [trial evidence and limits](examples/text-edited-tray/README.md). This is one simple case, not general model-quality or arbitrary CAD verification. Node43/43 passed; unchanged CAD/server12/12 passed earlier in this review.


## Feature-solid modeler

The original data-only box/cylinder builder supports 1–32 ordered add/cut features and up to 16 selected material/void probes. Every operation must change material and leave one valid connected solid within the size bound. Lengths below 0.01 mm, invalid/non-finite values, unsupported keys, missed cuts and disconnected additions are rejected. The local API shares the existing same-origin gate, size limit, build lock, fixed subprocess paths and timeout. An overlong JSON integer now returns a controlled 400 response instead of escaping the parse handler. Submitted records cannot supply Python or output paths.

The base bracket's independently calculated volume agrees with fresh-process STEP readback. A missing-hole negative case fails its void probe; X/Y/Z cylinder fixtures check axis spans. Browser mesh checks require normalized source, hashes, triangle counts, matching STEP/STL spans, positive volume and passing supplied probe results. Tests cover tampered mesh bytes, dimensions, probes, snapshots and invalid source. This is same-kernel readback and selected-region validation, not general semantic or physical verification.

A real local qwen3-vl:4b-instruct trial changed only the requested three radii. Its actual downloaded ZIP passed CRC, normalized source equality, hashes and an independent 11,180.70799341 mm³ volume calculation. The 60 × 30 × 40 mm model rendered as one 1,048-triangle mesh. Undo/redo and reload were exercised. An incomplete unapplied source survived reload and disabled generation; restoring valid source recovered the editor. A stale second tab could not overwrite the latest stored title, and its original-byte backup contained the newer stored record. The first qwen3:4b attempt was rejected for a malformed missing-information list. See [the retained trial](examples/feature-bracket/README.md).

At that review, these additions had not received a new Codex Security scan or final independent reviewer pass. Feature models were retained in project JSON/ZIP and history; fillets, threads, arbitrary sketch extrusion, assemblies, fabrication tolerances, loads and physical fit were outside that demonstrated result. Later sections record subsequent geometry and assembly work.


## Project feature-source integration, 23 October 2026

Applied feature source now travels with its project as optional `solidSpec`. The Assembly link opens a project-bound modeler; direct `solid.html` retains the prior standalone draft. At that revision, the source ZIP included both project.json and matching solid-spec.json, while generated STEP/STL and readback used a separate CAD download. The later project handoff section records the explicit combined export. Imports validate the source and allocate a new project ID. Geometry changes clear the mechanical review mark.

History restore and deleted-project recovery coordinate tray and feature caches with captured-byte conflict checks and compensating rollback. Rollback never replaces an intervening external write; if recovery cannot restore prior bytes, a recovery JSON download preserves those bytes. This is guarded local storage, not atomic multi-tab collaboration. Unreadable geometry cancels restoration instead of being replaced. Opening the example does not save it into a project automatically.

A fresh bounded source reviewer found an intervening-write gap between snapshot and cache replacement. Capturing both original cache values at the initial read fixed it; the reviewer confirmed the correction and found no remaining consequential issue in the reviewed scope. Automated tests cover import/storage/revision retention, malformed source rejection, standalone separation, partial cache failure, rollback conflict and intervening edits. Browser checks confirmed apply, reload, actual JSON/ZIP source equality and ZIP CRC, history restore, reloaded modeler source and import to a distinct project. No new security scan or physical engineering validation is claimed.


## Dimension editor and polygon extrusion, 23 October 2026

Feature source now has ordinary controls for names, operations, shapes, origin/size, radius/height, axis and polygon points; the JSON editor remains available. New features and region checks can be added, removed and reordered where relevant. Incomplete numeric values are retained as editable pending drafts across reload and fail Apply. Pending source cannot be silently discarded through Undo/Redo. Source validity and generated geometry remain separate.

The original `profile` primitive extrudes a bounded simple polygon through the existing static OCP builder. Matching JS/Python rules reject crossings, non-adjacent touches, repeated vertices, adjacent collinear corners and unbounded/nonfinite values; accepted winding normalizes counterclockwise. Local axes are explicit. Existing one-solid, material-effect, probe and fresh-process readback checks apply. A triangular prism regression caught the old shared twelve-triangle STL minimum; four is the minimum closed polyhedron and eight is valid for the prism.

A fresh reviewer found a scalar numeric form conversion bug; it was fixed and verified through actual editor event handlers for cylinder radius/height and profile height, including blank-value recovery. The reviewer reported no remaining consequential finding in the reviewed scope. Node56/56 and the seven solid Python checks passed; five local CAD server tests passed, including origin/Host rejection and existing tray/fit endpoints. Browser tests confirmed incomplete dimension retention/rejection, 70 mm box editing with Undo, scalar profile height editing with Undo, a real local model radius edit preserving all other fields, checked ZIP export and a 360-triangle generated view. Actual downloaded source/CRC/hashes and analytical volume matched. Narrow DOM width and scroll width both390; screenshots were inspected, with no physical-phone claim. No new broad security scan or physical engineering validation is claimed.

The importable profile study also exposed unconditional electrical warnings for a mechanical-only part. Explicit mechanical/structural/enclosure/fastener categories with no electrical-plan URL, voltage, pins, wires or power rails now show no electrical work recorded, without setting an electrical verification mark. Unknown categories or any electrical data retain electrical prompts. Focused tests cover that boundary.

The follow-up reviewer identified the existing electrical-plan URL as additional scope evidence. The mechanical-only condition now retains electrical prompts whenever that URL is present; the regression includes this case.


## Manual changes and dependent evidence, 23 October 2026

A fresh whole-flow review reproduced stale evidence in the manual editor: replacing a supply kept the prior numeric rating and completed linked instructions, while editing a completed instruction kept its completion mark. A missing supply assignment also had no explicit review finding. These were software defects, distinct from unimplemented general CAD or physical engineering work.

The manual save path now compares both versions before persistence. It clears derived current evidence for replaced parts and rewired endpoints, resets affected completion using original and remaining relationships, preserves unrelated branches and opaque CAD/notes, and rolls back the full project on a failed save. Quantity edits retain per-unit current and recalculate demand; new voltage clears the rail’s current figures. Fresh explicit current/rating entries remain recorded. New procedures and changed prerequisites require fresh completion. Pin-inventory/evidence-link-only changes retain endpoint text so mismatch checks stay inspectable. The card shows ASSIGN SUPPLY for unbound or missing sources even when worksheet arithmetic is complete.

The [actual browser case and exports](examples/manual-edit-review/README.md) changed a 3000 mA starter supply name, cleared its inherited rating and five completed steps, retained 100/150 mA load currents, survived reload and produced a ZIP with matching project data and cleared build-plan marks. Independent tests execute production handlers for edits, deletion, power controls and failed-save recovery. They preserve unrelated branch evidence and CAD/notes. No new model run, CAD generation, physical test or broad security scan was performed in this review. The [research update](research/TEXT_TO_CAD.md#final-source-check-what-the-benchmark-and-retries-retain) rechecks textcad’s exact revision, benchmark meaning and attempt-file retention; no upstream code was installed or copied.

Final software checks: 205 Node tests pass, including 14 pure dependency checks and 9 actual-handler/render checks. All 222 relative Markdown paths resolve. The installed skill matches source and validates; prior bytes were backed up and recovered into a separate folder before synchronization.


## Exact curved profiles, fillets and mesh fidelity, 23 October 2026

The current source adds bounded line/three-point-arc extrusion and constant-radius fillets through the pinned project build123d 0.13/OCP 8 runtime. JS/Python normalization agrees on shared cases; noncrossing outlines, explicit closure, unique nonvertex edge selection, tangent-contour behavior and meaningful material effect are checked. Legacy OCP-only sources still build; curves/fillets remain unavailable without the optional library. No model-generated code is executed.

Fresh review reproduced an existing same-bounds wrong-STL acceptance and a fifth-instance viewer color-index crash. Current feature/assembly packages require closed oriented mesh topology, signed volume and fixed 0.0405 mm sampled STEP boundary checks in both directions. Zero-area-only normalization retains actual raw bytes/hashes and replays the exact removal during readback. A tiny filled bore, equal-volume shifted bore and same-bounds box reject. The 16-instance viewer regression preserves the prior preview on GPU allocation failure; an actual five-instance curved assembly, GLB and inspection download were checked.

The [curved trial](examples/curved-pull-tab/README.md) preserves the rejected 4B response, accepted 27B response, browser CAD, independent analytic inventory/probes, equal-volume wrong-feature controls and replayable exports. The native suite has 35 solid/curve/mesh tests, 9 assembly tests and 14 server/process tests; the app has 254 Node tests at this release. Native writer/reader share the kernel. These results do not establish universal language-to-CAD accuracy, joint solving, arbitrary topology, manufacturing tolerances or physical behavior. No new security scan was run for this change.


## Captured project and CAD handoff, 23 October 2026

The local studio now distinguishes **Export source ZIP** from **Build project + CAD ZIP**. The latter captures one project/source snapshot and uses `tools/project-generator` to add checked geometry for every non-null tray, shared-solid and assembly branch. The compiler preserves every original source entry and the exact uploaded ZIP as `captured-source.zip`; the manifest binds raw source, generated files, branch sources and asset/instance IDs through hashes and lengths. Missing/mismatched sidecars, orphan part bindings, invalid placements or a rejected branch prevent the complete output. Known unplaced assets remain checked local solids and are explicit in the manifest. Tray/shared geometry has no invented per-part binding.

The [actual browser handoff](examples/project-cad-handoff/README.md) contains all three branches, including five curved assembly instances. Independent archive checks matched captured-source bytes/hash, original source entries and generated-file hashes. A later notes edit left **Download last package** bound to the earlier captured source. The controller retains a completed artifact across later failures or cancellation and rejects missing/wrong source hash, unknown CAD status, malformed/truncated ZIP, incorrect content type and oversized bodies. Public Pages does not probe the local CAD runtime. No export writes CAD source or sets project review marks. Client cancellation stops waiting and explicitly allows the bounded server build to continue.

At this review, 275 Node tests passed, with 15 native project compiler tests and three project HTTP checks. A fresh bounded reviewer completed the project-package review. The native compiler tests cover actual three-branch construction, exact-source preservation, placed/unplaced bindings, rejection/preservation boundaries and descendant termination after worker exit/timeout. Nine additional existing server/process regressions passed. Actual browser rejection preserved the preceding completed package byte for byte; an overlapping pair produced an explicitly labeled INTERFERENCE package with 4093.542869885118 mm³ overlap in its report. The rejected cut also exposed a nested JSON error message; the compiler now returns a bounded plain message naming its branch and source, checked through actual native rejection and focused tests. Nominal interference remains a completed downloadable result with an explicit warning and pair reports. Same-kernel geometry readback and sampled boundary checks do not certify physical fit, manufacturing, electrical behavior or the supplied planning claims. No new broad security scan was performed for this addition.
