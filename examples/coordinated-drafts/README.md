# Coordinated local draft trials

23 October 2026. These are actual browser outputs from local `qwen3-vl:4b-instruct`, not checked build instructions. Model digest: `84f7ed8042fa7cdbd902f7dcb7d0370e032095047cc3244179f263b77b5bc318`.

The first electrical request asked for a USB temperature display with an ESP32, BME280, OLED, button and enclosure. The app rejected it because a non-preparation step had no part links. No project was added. The generation schema was then tightened to require at least one part ID in every step; the local validator still allows a global preparation step.

The [actual mechanical JSON download](mechanical-trial.json) came from: “Mechanical-only: a single bent plate bookend for a desk. Use one Mechanical part, no electronics, no wires and no power rails. Footprint, load, thickness and material require measurement. Include preparation, fabrication and a stability Test linked to the plate.” The app added its visible open-question text to the request. During generation, the brief was replaced with a newer request. The review dialog disabled acceptance, allowed this JSON download, and the newer request survived discard and reload. The workspace still had only its original starter project.

The proposal had one part, three linked steps, tools and assumptions, no electrical relationships and no completed or verified marks. It also suggested using a file or grinder to make a bend. That fabrication method is inadequate and was not accepted as a valid procedure. Its assumed load capacity is unsupported. Passing the structure gate establishes an editable record, not useful fabrication advice or model quality. No fabrication or physical test was performed.

[The review screenshot](../../assets/draft-stale-review.png) shows the disabled acceptance and preserved-proposal download action. Prompt/question generation and validation remain deterministic local code; semantic engineering review remains necessary.


## Electrical draft and retained fields

A later request for a USB desk temperature display produced the [actual electrical JSON download](electrical-trial.json): five parts, six wires, four mounting relationships, six linked steps, six tools, five assumptions and two proposed rails. Both rail supply ratings and all load currents are null. Prices, sources, verification and completion marks remain cleared. Accepting it as an **unchecked concept** in an isolated test workspace, reloading and exporting ZIP preserved all those fields; ZIP CRC and `build-plan.txt` contents passed inspection. The original starter remained present. No changes were made to the user's canonical workspace.

This output has electrical omissions: no recorded BME280 data path, no identified upstream USB supply, and a 5 V rail assigned to parts with 3.3 V notes, alongside a separate 3.3 V rail. Pin names and all fit/current assumptions lack evidence. The app now flags the absent sensor data path, cable-as-source and simple voltage-note discrepancy for review, without inferring a complete circuit or rejecting a legitimate regulated input automatically. These checks are heuristics; voltage ranges, multiple inputs, pin functions, signal direction, firmware and actual wiring still need independent review. The model proposal was not corrected into an engineering plan in this trial.

The [power review screenshot](../../assets/coordinated-power-review.png) shows retained unknown currents and explicit review findings. All remaining review items can be expanded. The narrow layout was checked at 390 CSS pixels with no horizontal document overflow; this is browser emulation, not a physical-phone test.
