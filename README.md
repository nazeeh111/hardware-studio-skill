# Hardware Studio

An original, local-first hardware design workspace informed by a public study of [Blueprint.io](https://www.blueprint.io/). It helps turn a small electronics idea into an editable project brief, parts list, connection map, conceptual assembly view, build sequence, and review record. It does not copy Blueprint's code, graphics, brand, private data, or generated project packages.

## Run

From this folder:

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173` in a browser. No installation, account, paid API or server database is required. Projects stay in the browser's local storage. Export JSON regularly if the work matters. The interface fetches Google Fonts when online; it falls back to local system fonts offline.

## What works

- Start from a plant monitor or ambient-light design, or make a blank concept. A brief mentioning plant/soil/garden/greenhouse or light/lamp/LED picks the respective starter. Other briefs create an editable blank project. This is a rule-based route, not arbitrary AI design.
- Add, edit and remove parts, connections and build steps. Removing a part also removes its associated connections.
- Track quantities and planning cost estimates, and export the bill of materials as CSV.
- View and export a connection diagram and a conceptual exploded parts layout as SVG.
- Record notes, completion and independent review marks. Errors such as connections to missing parts are highlighted.
- Keep multiple projects locally; import/export project JSON. Imported review marks reset until the imported design is checked again.

## Limits that matter

This app does **not** produce a verified schematic, manufacturing CAD, live prices, supplier stock, firmware or safety certification. Diagrams show relationships and part inventory. They do not prove pin compatibility, power capacity, clearances or fit. Review the exact component datasheets and supplier listings before buying parts or connecting power. The example prices are illustrative, not current quotations.

The [Blueprint analysis](./BLUEPRINT_ANALYSIS.md) separates directly observed public behavior from Blueprint's own statements and unknown implementation details. The [hardware design skill](./skills/hardware-studio/SKILL.md) guides Codex through a more rigorous end-to-end design workflow and can use appropriate local CAD tools when a dimensioned model is requested.

## Checks

```sh
npm test
```

The Node tests cover cost arithmetic, broken references, CSV quoting and import boundaries. Visual and interaction checks should be performed in a browser after changes.

## License

MIT. This license applies to this original repository and does not grant rights to Blueprint's site, name, content or product.
