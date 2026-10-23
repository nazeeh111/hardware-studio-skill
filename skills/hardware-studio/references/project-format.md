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
