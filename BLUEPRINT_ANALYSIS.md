# Blueprint.io public product analysis

Observed on 22 October 2026 through the live, public website and a fresh, unauthenticated Chrome session captured with Reverse Engineer Anything (REA). This is an analysis of visible behavior and publicly shipped frontend code, not access to Blueprint's private backend or an endorsement. No account was created, no design credit was used, and no purchase was made.

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

## Public frontend capture

REA launched a temporary Chrome profile on the [home page](https://www.blueprint.io/) and retained its visible page, network events and publicly served JavaScript. The capture is local task evidence `ev_9a8e5db5827f65d69ef711aa3ba5f732b99ac79f79fdd70f7b5cf072e810d70a`; script export evidence is `ev_5480fea654fb43018fc3de596bbfbc8dd25b8d5a27e9d48209758abca25dae2a`. The browser observed successful public requests to `server.blueprint.io` for features, stats, trending projects and community discovery. These requests establish the sampled landing-page network behavior only.

Static inspection of the captured [main frontend bundle](https://www.blueprint.io/assets/index-Bce6DG7-.js) found request-code references to generation runs, uploaded input images, project saves, part canonicalization and sourcing, wiring-rail inference, CAD jobs and part questions, project ZIP export, publishing, and collaboration. The references show planned client/server boundaries in this shipped version. They do **not** prove that any endpoint is available to an unauthenticated visitor, how its backend works, or that a generation succeeds. REA's first-party JavaScript graph (`ev_dcf3f3fe5a06ee4ba4aead54727958a15449a7ba547abf965dd2b3ebe5a7dfa1`) parsed three served scripts but hit a heap limit while building semantic relationships for the 4.6 MB main bundle, so graph coverage is partial. The captured event stream also ended with some requests unfinished. No Blueprint code or assets are reused in Hardware Studio.

## Inferred workflow, with uncertainty

The visible product sequence suggests: idea or reference → clarifying questions and generation → project record → parts and sourcing → connection graph → mechanical visualization or CAD → instructions → revision or publication. That sequence is an inference from the interface, FAQ and shipped frontend references. The model orchestration, private backend data schema, CAD generation method, supplier search process, validation logic, security controls and private account flow were not established.

## Reimplementation decisions

Hardware Studio is intentionally original. It uses two editable, hand-authored starter structures and a local data model so its difficult mechanism, coordinated parts/connections/steps and review state, can be exercised without a billed model API. An optional local Ollama model can draft other ideas, with generated prices and verification marks cleared before saving. A sketch or photo can be resized and retained locally with a project; models reporting vision support can receive that image for drafting, but interpretation remains unverified. It adds reference integrity checks, optional exact pin or terminal fields with missing-endpoint review, a part-linked power-budget worksheet, specification links with check dates, local revision history, a self-contained export of its browser data and conceptual diagrams, visible uncertainty, and reset review marks after import or restoration. Data stays in the browser. Its component index is conceptual. A separate, manually authored [Pico + NeoPixel tray example](examples/pico-neopixel-tray/README.md) includes dimensioned CAD, a manufacturer-model fit report and a provisional, source-backed electrical path; the supply and physical checks remain open. This is not automatic CAD generation or parity with Blueprint's AI quality, live sourcing, account system, collaboration, publishing, payments or manufacturing. The companion skill explains how to reach a validated design through independent sources and suitable engineering tools.

## Evidence and next checks

- Direct site observations: [home](https://www.blueprint.io/), [FAQ](https://www.blueprint.io/faq), [pricing](https://www.blueprint.io/pricing), [public project](https://www.blueprint.io/s/4HKdHznzhy-I8Gfv61LL0FATpp_CxnKSKkiFw8hQCFw).
- Unresolved: authenticated generation quality and failure cases, downloads, true CAD dimensional validity, supplier-link accuracy, privacy behavior, mobile editing, accessibility details beyond the sampled pages, and private backend behavior. The REA capture and partial static graph do not resolve these.
- For a future authorized hands-on evaluation, create a disposable project in a free account, retain its input and output, check one part against a manufacturer datasheet, inspect each generated wire, and compare a CAD export's dimensions against actual component measurements. Do not treat a polished render as manufacturing proof.
