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

- Node app tests: **32 passed**.
- OpenCascade generator, fit and loopback-server tests: **11 passed**, including the new GET/HEAD Host and directory checks.
- The app's source syntax, example structural checks, Markdown links, live Pages bytes and installed skill copy should be rechecked at each new publication; a successful local test is not a deployed revision.

## Open engineering work

The example power worksheet remains incomplete. Current draw, branch ratings, voltage drop, connector and wire fit, exact solder-hole assignment, cable strain relief, physical assembly, measured behavior and fabrication evidence are not supplied. Arbitrary idea-to-CAD, reliable image understanding, live sourcing and authenticated Blueprint workflows remain outside this implementation.
