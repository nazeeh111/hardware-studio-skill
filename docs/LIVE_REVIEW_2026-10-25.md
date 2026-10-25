# Live application review · 25 October 2026

A fresh browser review used the current source, a separate localhost origin for trial projects, the public Pages app and GitHub's rendered README. Original projects were preserved. This is a scoped software acceptance review, not a claim of universal perfection or physical hardware validation.

## Gaps fixed

- **Unfinished input lost during CAD sync.** Loading an example in a separate linked modeler erased an unblurred working note. Replayed before and after the fix. Geometry sync now refreshes CAD-dependent views and review state without replacing unrelated inline fields. A pending power value and the note's text/focus survived the replay.
- **Keyboard and screen-reader navigation.** Design tabs now support Left/Right, Home/End, one selected tab in the keyboard sequence, and explicit tab/panel relationships. The part/connection editor dialog has a programmatic name. Keyboard movement and a named part editor were exercised in the browser.
- **Tray return context.** The tray's header links now return to its linked project instead of whichever project was last selected elsewhere. The actual encoded links were checked after reload.

The original local tab was still running cached app version 42. After exporting its current project and checking for unfinished inputs, it was refreshed to the current source. All three original projects remained; before/after exported project fields were identical.

## Fresh results

| Workflow | Observed outcome |
| --- | --- |
| Public application | All six views opened; source ZIP downloaded and passed archive CRC checks |
| Manual project editing | Added a part with quantity/cost; set exact wire pins; entered a 1200 mA supply and 250 mA load, producing 950 mA / 79.2% headroom |
| History | Restored a prior state; completion/review marks reset as described |
| Sketch reference | Added a label, undid/redid it, attached the editable sketch and retained the request through recovery |
| Storage conflict | Another tab's newer save blocked the stale write; downloaded its attempted-workspace backup before reloading |
| Local draft | qwen3:4b produced a reviewed mechanical-only stand with three parts, two mounting links and four linked steps; explicitly accepted into the isolated workspace |
| JSON roundtrip | Exported, imported and exported again; only ID, timestamps and starter classification changed. Notes, parts and procedures were retained; the skill's structural checker passed |
| Curved solid | Fresh 40×20×6 mm part, one bore and top edge rounds; 4292 triangles; checked STEP/STL ZIP, GLB and three-view ZIP downloaded |
| Independent nominal inspection | Reopened the newly downloaded STEP through the separate analytic inspector; checked its faces, nominal volume and ten explicit material/void regions |
| Tray and cover | Fresh 80×55×18 mm tray and separate cover; two meshes/64 triangles; CAD ZIP downloaded |
| Placed assembly | Two instances of the curved source at X0/X50; 8584 triangles, zero nominal overlap and 10 mm minimum distance; checked assembly ZIP downloaded |
| Captured project + CAD | Downloaded 17-entry shared-solid handoff; every manifest hash/length and nested source byte matched; captured solid source equaled the separately downloaded browser CAD source |
| Local vision | qwen3-vl:4b-instruct returned observations of captured views; downloaded image, geometry manifest, model identity and raw response in its observation ZIP |
| Narrow layouts | Exercised 390 px main tabs and part editor; main and assembly viewer had no page overflow in those captures. Other layout observations retain their actual viewport dimensions |
| GitHub | README rendered, its three images loaded, metadata/homepage matched the product and latest deployment was inspected |
| Browser errors | No recorded JavaScript errors on the main trial app, original app, public app or three generated viewers |

The full final Node suite passed **311 tests**. An independent reviewer passed **22 focused tests** and found no consequential regression in the exact sync/accessibility patch. The tray navigation change was also independently reviewed. No native generator logic changed in this release.

## Failures retained in the review

The image-assisted 27B draft timed out at the app's limit. A smaller vision draft was rejected for omitting a linked Test step. A stand request mentioning a temperature display without explicit mechanical-only scope was rejected by the function-coverage guard; explicitly stating that the existing electronics were outside scope produced the accepted draft. These cases preserved the request and did not replace the working project. This is not an AI accuracy benchmark.

Vision's successful response remains qualitative model text. For example, its description of a smooth outline across all views is not an analytic shape check. Nominal software readback does not establish physical fit, fabrication tolerances, strength, electrical operation or safety. The public site continues to use manual drafts; AI and native CAD require the documented local services.

Detailed browser receipts, before/after input captures, original-project backup, model trials, downloaded archives and current-source screenshots are retained in the task-local review folder. User workspace backups are not included in this public repository.
