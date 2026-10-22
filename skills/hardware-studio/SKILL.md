---
name: hardware-studio
description: Plan and review small physical hardware builds from an idea through parts, wiring, mechanical fit, sourcing, instructions and verification. Use for electronics or maker-project design packages; skip pure software and cosmetic renders.
---

# Hardware Studio

Turn the requested device into an engineering work package whose claims can be checked. Start from the function, environment, dimensions, power source, budget and fabrication access. Ask for a missing constraint only when it changes the architecture; proceed with explicit assumptions otherwise.

If given a sketch or photo, record what is visibly present and what the user wants it to mean. A visual reference can guide layout and appearance, but scale, hidden parts, material, part numbers, pinouts and electrical ratings require separate evidence. Keep the image with the editable project when the user wants that reference preserved.

Build a connected design record: requirements, chosen architecture, exact parts with quantities and source dates, interfaces and pin-level connections, power and thermal budgets, mechanical dimensions and clearances, assembly and bring-up steps, test criteria, cost estimate, and unresolved risks. Keep IDs consistent across artifacts. Give unknowns a visible status at the point where they matter. For each power rail, record the supply rating and each assigned part's peak current per unit, then calculate demand using quantity and compare headroom with an explicit target. Leave unknown currents blank; a partial worksheet cannot pass a whole-device power review.

Verify decisive properties against original manufacturer datasheets and current supplier listings. Record the specific document URL and check date for each part marked verified; supplier listings serve a different purpose from specifications. Check voltage ranges, pin functions, logic levels, peak and continuous current, connector and cable ratings, orientation, dimensions and mounting patterns. Calculate margins rather than relying on a generated diagram. A search result, marketing render or approximate price does not validate a component.

Use a schematic tool or other suitable format for actual electrical documentation. For geometry that must fit or be manufactured, make an editable dimensioned model and verify clearances. Use a conceptual illustration only to explain arrangement, labeled as such. Select local CAD or Blender by the artifact the user needs; neither is mandatory for a text-only design question. Physical energizing, fabrication and purchasing require the user's separate authority and a design review proportionate to the hazard.

For a worked package, the [Pico + NeoPixel tray example](https://github.com/nazeeh111/hardware-studio-skill/tree/main/examples/pico-neopixel-tray) retains parametric source, STEP readback, manufacturer-model fit checks, negative collision cases, a separately rendered Blender view and a source-backed provisional electrical path. Its power worksheet deliberately stays incomplete while supply and auxiliary current data are unknown. It is an example of the evidence chain, not a certified or fabrication-ready device.

For a rectangular prototype tray, use the repository's [parametric tray generator](https://github.com/nazeeh111/hardware-studio-skill/tree/main/tools/tray-generator) when its wall, boss, locator/hole and edge-cutout schema fits the request. Write the millimeter spec from measured or manufacturer dimensions, run `generate.py`, and inspect `verification.json` plus the dimensioned SVG. Keep the spec and CAD files with the project. The generator verifies modeled shape and file readback; run separate exact-part fit, clearance, connector and physical checks before any readiness claim.

When a user wants to set tray geometry in the browser, the app's Assembly view opens a [tray workbench](https://nazeeh111.github.io/hardware-studio-skill/tray.html). It previews dimensions and exports the same JSON input consumed by the local generator. Its project ZIP includes a saved tray spec as `tray-spec.json`; a standalone project JSON does not. The project ZIP and preview do not contain generated STEP/STL or prove physical fit.
To generate STEP/STL from the browser on this Mac, run `sh tools/tray-generator/run-local.sh --port 4174` from the repository root, then open its loopback URL. The launcher selects an OCP-enabled Python interpreter. The local server supplies a readback-checked CAD ZIP; the public Pages origin cannot invoke it. The generated package still needs exact-part fit and fabrication review.

Deliver the editable sources and a plain-language build and test guide. Separate verified, estimated, inferred and untested items. If a constraint or source cannot be checked, make the next required check concrete instead of calling the design ready to build.

When the user wants an interactive project, produce a Hardware Studio JSON file using [the project format](references/project-format.md). Validate its structural links with `node scripts/check-project.mjs /absolute/path/to/project.json` from this skill folder, then direct the user to import the file in the [Hardware Studio app](https://github.com/nazeeh111/hardware-studio-skill). That checker verifies data shape and cross-references; it does not validate electrical or mechanical engineering.

For the public product pattern that inspired this workflow, read [Blueprint observations](references/blueprint-observations.md) only when comparing features or interpreting that website. It is not an API or an engineering standard.
