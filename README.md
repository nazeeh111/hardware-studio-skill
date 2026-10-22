# Hardware Studio

An original, local-first hardware design workspace informed by a public study of [Blueprint.io](https://www.blueprint.io/). It helps turn a small electronics idea into an editable project brief, parts list, connection map, conceptual assembly view, build sequence, and review record. It does not copy Blueprint's code, graphics, brand, private data, or generated project packages.

**[Open the live app](https://nazeeh111.github.io/hardware-studio-skill/)** · [Read the design analysis](./BLUEPRINT_ANALYSIS.md) · [Use the Codex skill](./skills/hardware-studio/SKILL.md)

![Hardware Studio desktop interface](assets/studio-desktop.png)

[View the narrow layout](assets/studio-narrow.png).

## Run

From this folder:

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173` in a browser. No account, paid API or server database is required. Projects stay in the browser's local storage. Export JSON regularly if the work matters. The interface fetches Google Fonts when online; it falls back to local system fonts offline.

Optional local AI drafting uses an already installed [Ollama](https://docs.ollama.com/api/generate) model at `127.0.0.1:11434`. Start Ollama before opening the app, select a local model, enter a brief, and choose **Draft with local AI**. If Ollama is unavailable, the editor and starter designs still work. The brief goes only to the local Ollama service; no cloud model is called by this feature. Generation uses local compute and can take a few minutes.

For local AI, run the app at `http://127.0.0.1:4173` so the browser can use Ollama's default local-origin access. The public GitHub Pages version works without Ollama; its AI control stays hidden unless your Ollama installation explicitly allows that site's origin.

## What works

- Start from a plant monitor or ambient-light design, or make a blank concept. A brief mentioning plant/soil/garden/greenhouse or light/lamp/LED picks the respective starter. Other briefs create an editable blank project. This is a rule-based route, not arbitrary AI design.
- Optionally draft an arbitrary low-voltage concept with a local Ollama model. The model output must pass structural checks; the app clears any claimed prices, supplier links and verification marks, then shows the proposed parts for review before adding it to the workspace.
- Add, edit and remove parts, connections and build steps. Removing a part also removes its associated connections.
- Track quantities and planning cost estimates, and export the bill of materials as CSV.
- View and export a connection diagram and a conceptual component index as SVG.
- Record multiple power rails, their rated supply current, assigned part loads and a headroom target. The worksheet multiplies per-unit peak current by part quantity and flags missing values, overloads and low margin.
- Record notes, completion and independent review marks. Errors such as connections to missing parts are highlighted.
- Keep multiple projects locally; import/export project JSON. Imported review marks reset until the imported design is checked again.

## Limits that matter

This app does **not** produce a verified schematic, manufacturing CAD, live prices, supplier stock, firmware or safety certification. Local AI drafts are unverified concepts and may contain wrong or missing parts and connections. Diagrams show relationships and part inventory. The power worksheet covers only the loads assigned to each rail and does not check voltage compatibility, startup surges, cable or connector ratings, or regulator heat. Review the exact component datasheets and supplier listings before buying parts or connecting power. The starter prices are illustrative, not current quotations.

The [Blueprint analysis](./BLUEPRINT_ANALYSIS.md) separates directly observed public behavior from Blueprint's own statements and unknown implementation details. The [hardware design skill](./skills/hardware-studio/SKILL.md) guides Codex through a more rigorous end-to-end design workflow and can use appropriate local CAD tools when a dimensioned model is requested.

For ideas beyond the built-in starters, ask Codex to use the skill to create a project JSON file. Check the file with the skill's `scripts/check-project.mjs`, then import it in the app. The structural check does not replace review of actual hardware.

## Checks

```sh
npm test
```

The Node tests cover cost arithmetic, broken references, CSV quoting, import boundaries, local-model output and power-budget calculations. Visual and interaction checks should be performed in a browser after changes.

## License

MIT. This license applies to this original repository and does not grant rights to Blueprint's site, name, content or product.
