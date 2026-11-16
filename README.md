# Hardware Studio

**From an idea to an editable, inspectable hardware package.**

Plan parts, wiring and build steps. Give parts real geometry. Keep the captured sources and check reports with the handoff.

[Open the app](https://nazeeh111.github.io/hardware-studio-skill/) · [Capability guide](docs/CAPABILITY_GUIDE.md) · [Reusable skill](skills/hardware-studio/SKILL.md)

![Current public Hardware Studio workspace](assets/studio-desktop-current.jpg)

Hardware Studio runs without a paid API. Your project stays in browser storage; optional AI and CAD run through local services.

## What you can do

| Stage | Tools | What the result means |
| --- | --- | --- |
| Define | Brief, follow-up questions, photos and editable sketches | Captured constraints and assumptions |
| Plan | Parts, pin/terminal connections, mounting intent and a power worksheet | Editable records with explicit missing evidence |
| Model | Boxes, cylinders, polygon/line/arc extrusions and selected-edge fillets; per-part sources and rigid placements | Bounded geometry with editable operation history |
| Check | Fresh STEP readback, material/void probes, mesh checks, interference and three-view inspection | Nominal software checks with retained reports |
| Revise | Manual edits, local AI proposals, optional geometry check before applying, history and conflict recovery | Captured changes that preserve unrelated work |
| Handoff | Source-only ZIP or one captured project + checked CAD ZIP | Sources, generated files and hashes kept together |

Optional local vision supplies qualitative observations of captured mesh views. Model text is separate from geometry checks and never certifies a project. See [the complete workflow and limits](docs/CAPABILITY_GUIDE.md).

## Run

The app has no frontend build step or package dependencies.

```sh
git clone https://github.com/nazeeh111/hardware-studio-skill.git
cd hardware-studio-skill
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/`. The public site and this static server support manual editing, imports, source exports and mesh inspection. AI proposals require a running local Ollama service and an installed local model.

For native CAD generation on the tested **macOS arm64 / Python 3.12** setup:

```sh
sh tools/cad-runtime/setup.sh
sh tools/tray-generator/run-local.sh --port 4174
```

Open `http://127.0.0.1:4174/`. The optional project runtime occupies about 730 MB. Other platforms need their own verified runtime. Existing OCP environments can support the legacy shapes. See [runtime setup and fallback](tools/cad-runtime/README.md).

## One project and CAD handoff

In **Build**, choose **Build project + CAD ZIP** on the local CAD server. It captures one project, builds every recorded CAD branch, reopens the exports, and packages the result with the original source ZIP and a file-hash manifest. Any rejected branch prevents a new combined package. Recorded interference remains clearly labeled and downloadable.

**Export source ZIP** works without native CAD. Later edits do not change an earlier completed download. Download retained results before reloading the tab.

![Captured project and CAD handoff](assets/project-cad-handoff.jpg)

[Inspect the actual three-branch browser package](examples/project-cad-handoff/README.md) · [Compiler contract](tools/project-generator/README.md)

## Check a proposal before replacing the source

In the local solid modeler, review the model’s proposed source and choose **Check proposed geometry**. The native builder runs against that captured proposal while your working part stays unchanged. The result separates geometry figures from source and evidence details. **Apply** remains a separate action. A changed request or project makes the old proposal stale.

[Read the actual model trial, retained failures and independent checks](examples/proposal-geometry-check/README.md).

## Worked examples

These retain actual artifacts and repeatable checks, including failed or incorrect cases.

| Example | Inspect |
| --- | --- |
| [Curved pull tab](examples/curved-pull-tab/README.md) | Actual local-model proposal, exact arcs and top fillet, independently derived geometry checks, five placed instances and GLB |
| [Placed assembly](examples/placed-assembly/README.md) | Plate and standoffs, rotations, pairwise clearance, wrong-placement controls |
| [Pico + NeoPixel tray](examples/pico-neopixel-tray/README.md) | STEP/STL, manufacturer-model fit checks, Blender source and a provisional electrical plan |
| [Captured handoff](examples/project-cad-handoff/README.md) | All three CAD branches, source identity, failed-build retention and explicit interference |
| [Local vision observation](examples/vision-observation/README.md) | Exact captured views, model request/output, cancellation and accuracy limits |

![Actual curved part and five-instance inspection](assets/curved-five-tabs-result.jpg)

## Limits that matter

Geometry is nominal. Software checks do not establish physical fit, fabrication tolerances, materials, strength, electrical behavior or safety. Parts, prices, ratings and wiring need independent evidence. There is no live sourcing service, firmware generator, joint/motion solver or manufacturing service.

Public drafts share this GitHub host’s browser storage with sibling sites. Use a local origin for sensitive work. GitHub Pages cannot run native CAD or local AI.

### Project revisions and recovery

The studio and its project-linked tray, feature and assembly workbenches save the project, editable CAD sources and bounded history in one versioned record. They use the browser Web Locks API to serialize participating tabs, then compare the captured revision before saving. If another tab wins, download the working backup and reload before reconciling. Unsaved form edits remain exportable. If Web Locks or storage is unavailable, changes cannot be saved safely; use the offered download to retain them. Standalone tray and feature sources use separate locked records.

On first open, valid prior workspace, history and CAD sidecars are copied into the new record; original storage keys are retained. An old tab still running earlier code does not participate in the new lock. A later change to recorded legacy keys is detected and blocks new saves so both versions can be recovered, but no protection is claimed against a change between separate checks by an uncooperative old tab. Download the recovery data and reconcile deliberately. Storage quota and browser data clearing can still prevent persistence; keep independent exports. Notes typed while a save is pending remain as an unsaved draft across editor redraws and project navigation; leave the notes field to save them, or export the project before reloading. A failed feature-source save keeps the edited text unapplied for retry or export.

Project JSON and source ZIPs include a supplied store ID, generation, project ID and saved/draft label. Importing `project.json` makes an independent editable copy, retains the claimed source revision as an unauthenticated record, and resets verification and completion marks. Generated CAD ZIPs preserve the exact source ZIP and hash it. Same-kernel readback and sampled mesh checks do not establish independent CAD interoperability, physical fit or electrical safety.


## Checks

[Live browser review · 25 October 2026](docs/LIVE_REVIEW_2026-10-25.md): editing, recovery, local models, generated geometry, downloads and narrow layouts.

```sh
npm test
```

Run native checks with the corresponding [CAD tool guides](docs/CAPABILITY_GUIDE.md). The [audit](AUDIT.md), [text-to-CAD research](research/TEXT_TO_CAD.md) and example verifiers retain revision-specific evidence and its limits. A passing test is not a hardware validation.

To create an importable project with the [Hardware Studio skill](skills/hardware-studio/SKILL.md), validate its structure before importing:

```sh
node skills/hardware-studio/scripts/check-project.mjs /absolute/path/to/project.json
```

The structural checker does not validate electrical or mechanical engineering.

## License

[MIT](LICENSE).
