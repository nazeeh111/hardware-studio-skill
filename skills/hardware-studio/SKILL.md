---
name: hardware-studio
description: Plan and review small physical hardware builds from an idea through parts, wiring, mechanical fit, sourcing, instructions and verification. Use for electronics or maker-project design packages; skip pure software and cosmetic renders.
---

# Hardware Studio

Turn the requested device into an engineering work package whose claims can be checked. Start from the function, environment, dimensions, power source, budget and fabrication access. Ask for a missing constraint only when it changes the architecture; proceed with explicit assumptions otherwise.

Build a connected design record: requirements, chosen architecture, exact parts with quantities and source dates, interfaces and pin-level connections, power and thermal budgets, mechanical dimensions and clearances, assembly and bring-up steps, test criteria, cost estimate, and unresolved risks. Keep IDs consistent across artifacts. Give unknowns a visible status at the point where they matter. For each power rail, record the supply rating and each assigned part's peak current per unit, then calculate demand using quantity and compare headroom with an explicit target. Leave unknown currents blank; a partial worksheet cannot pass a whole-device power review.

Verify decisive properties against original manufacturer datasheets and current supplier listings. Record the specific document URL and check date for each part marked verified; supplier listings serve a different purpose from specifications. Check voltage ranges, pin functions, logic levels, peak and continuous current, connector and cable ratings, orientation, dimensions and mounting patterns. Calculate margins rather than relying on a generated diagram. A search result, marketing render or approximate price does not validate a component.

Use a schematic tool or other suitable format for actual electrical documentation. For geometry that must fit or be manufactured, make an editable dimensioned model and verify clearances. Use a conceptual illustration only to explain arrangement, labeled as such. Select local CAD or Blender by the artifact the user needs; neither is mandatory for a text-only design question. Physical energizing, fabrication and purchasing require the user's separate authority and a design review proportionate to the hazard.

Deliver the editable sources and a plain-language build and test guide. Separate verified, estimated, inferred and untested items. If a constraint or source cannot be checked, make the next required check concrete instead of calling the design ready to build.

When the user wants an interactive project, produce a Hardware Studio JSON file using [the project format](references/project-format.md). Validate its structural links with `node scripts/check-project.mjs /absolute/path/to/project.json` from this skill folder, then direct the user to import the file in the [Hardware Studio app](https://github.com/nazeeh111/hardware-studio-skill). That checker verifies data shape and cross-references; it does not validate electrical or mechanical engineering.

For the public product pattern that inspired this workflow, read [Blueprint observations](references/blueprint-observations.md) only when comparing features or interpreting that website. It is not an API or an engineering standard.
