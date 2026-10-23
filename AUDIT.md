# Hardware Studio review

22 October 2026. This records checks of the original Hardware Studio implementation and the Pico + NeoPixel worked example. It does not certify a physical device or claim feature parity with Blueprint.io.

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

These additions have not received a new Codex Security scan or final independent reviewer pass. Feature models remain standalone from main project JSON/ZIP; fillets, threads, arbitrary sketch extrusion, assemblies, fabrication tolerances, loads and physical fit remain outside the demonstrated result.
