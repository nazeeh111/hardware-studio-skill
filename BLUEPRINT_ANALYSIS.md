# Blueprint.io public product analysis

Observed on 22 October 2026 through the live, public website. This is an analysis of visible behavior and published claims, not access to Blueprint's private implementation or an endorsement. The Reverse Engineer Anything browser adapter could not connect to a local Chrome DevTools endpoint (`http://127.0.0.1:9222` was unavailable), so there is no REA capture or decompiled code in this study. No account was created, no design credit was used, and no purchase was made.

## What the public interface exposes

| Area | Direct observation | Boundary |
|---|---|---|
| Entry | The [home page](https://www.blueprint.io/) has a text prompt, "Need an idea?", image upload, sketch input, and a model selector. It previews prompt, parts, wiring and mechanical views. | Generation was not run. The output pipeline and models remain unknown. |
| Discovery | The home page links to published community projects. A public [3D printer example](https://www.blueprint.io/s/4HKdHznzhy-I8Gfv61LL0FATpp_CxnKSKkiFw8hQCFw) exposed Info, Parts, Wiring, Mech and Instructions tabs. | One example cannot establish average quality. |
| Parts | The example shows categories, named components, quantities, descriptions, approximate costs and a displayed $445.90 total. | Prices and exact supplier matches were not checked. Part-detail access asked the visitor to copy the project. |
| Wiring | The example displayed a graph with components, pins and labeled connections around an Arduino Mega and RAMPS board. | Graph presence does not establish electrical correctness. The public graph did not show a verified current budget or a complete schematic. |
| Mechanical | The example rendered a 3D view and a notice that nine parts were not attached to the main assembly; the viewer credited [ForgeCAD](https://forgecad.io/). | A visual assembly is not evidence of fit, fabrication geometry or manufacturing readiness. |
| Instructions | The example contained 26 checklist steps across Fabricate, Wire, Bring-up and Assemble, with tools, assumptions and linked parts. | Following steps still requires validated components, firmware configuration and safe electrical practice. |
| Community | Public projects expose copy and star actions. | Account-only creation, editing, export and publishing were not exercised. |

## Blueprint's published feature and plan statements

The [FAQ](https://www.blueprint.io/faq) says a prompt can produce a bill of materials, sourcing links, wiring diagram, build instructions and a 3D mechanical render. It says a design may ask follow-up questions, supports image and sketch references, keeps projects private by default, and can publish them separately. It describes CAD generation with STL, STEP and GLB downloads, version history, and a project ZIP export on Pro and Ultra. It also says there is no public API or manufacturing service at present.

The [pricing page](https://www.blueprint.io/pricing) lists a free Basic tier with design and CAD credit limits, and paid tiers with more generation capacity. These are live page statements that can change, not commitments replicated by this repository.

The FAQ acknowledges that parts, prices, placement and Amazon links may be wrong or region-specific. It recommends checking a design before buying or building. This limitation materially shaped Hardware Studio: it exposes unknowns and review marks rather than labeling its concept output build-ready.

## Inferred workflow, with uncertainty

The visible product sequence suggests: idea or reference → clarifying questions and generation → project record → parts and sourcing → connection graph → mechanical visualization or CAD → instructions → revision or publication. That sequence is an inference from the interface and FAQ. The model orchestration, data schema, CAD generation method, supplier search process, persistence architecture, validation logic, security controls and private account flow were not established.

## Reimplementation decisions

Hardware Studio is intentionally original. It uses two editable, hand-authored starter structures and a local data model so its difficult mechanism, coordinated parts/connections/steps and review state, can be exercised without a billed model API. It adds reference integrity checks, makes uncertainty visible, resets review marks after import, and keeps data local. Its isometric assembly view is conceptual. It does not claim parity with Blueprint's AI generation, 3D CAD, live sourcing, images, account system, collaboration, publishing, payments or manufacturing. The companion skill explains how to reach a validated design through independent sources and suitable engineering tools.

## Evidence and next checks

- Direct site observations: [home](https://www.blueprint.io/), [FAQ](https://www.blueprint.io/faq), [pricing](https://www.blueprint.io/pricing), [public project](https://www.blueprint.io/s/4HKdHznzhy-I8Gfv61LL0FATpp_CxnKSKkiFw8hQCFw).
- Unresolved: authenticated generation quality and failure cases, downloads, true CAD dimensional validity, supplier-link accuracy, privacy behavior, mobile editing, accessibility details beyond the sampled pages, and runtime internals.
- For a future authorized hands-on evaluation, create a disposable project in a free account, retain its input and output, check one part against a manufacturer datasheet, inspect each generated wire, and compare a CAD export's dimensions against actual component measurements. Do not treat a polished render as manufacturing proof.
