# Three-hole mounting bracket

Original 23 October 2026 feature-solid example. No vendor geometry is included.

Two overlapping boxes form a 60 × 30 × 40 mm bracket with 4 mm base and upright. Two Z-axis holes and one X-axis hole have 2.5 mm radius. They are geometry studies, not a selected fastener fit or structurally validated bracket.

The independently calculated nominal volume is:

`60×30×4 + 4×30×40 − 4×30×4 − 3×π×2.5²×4 = 11,284.38055098 mm³`.

Fresh-process STEP readback agreed with that volume, one solid and the 60 × 30 × 40 mm span. STL readback found 1,048 triangles and matching spans. Two selected hole regions were empty and a selected base region retained material. A negative test removes the hole-cut operations and confirms that the expected-void probe fails. Disconnected additions and cuts that miss the part are rejected.

- [Editable feature source](generated/spec.json)
- [Analytic STEP solid](generated/solid.step)
- [STL surface](generated/solid.stl)
- [Per-operation build history](generated/build-report.json)
- [Fresh-process readback and hashes](generated/verification.json)
- [Source schema and commands](../../tools/solid-generator/README.md)

The supplied probes only cover named regions. There is no physical fabrication, material selection, load case, stress test, local wall-thickness analysis, tolerance study, mating-part check or certification.


## Local text-edit trial

The installed `qwen3-vl:4b-instruct` model was asked to increase all three cut radii to 3 mm while keeping every other field and all probes unchanged. The proposed normalized source matched exactly that edit. The browser accepted it, undo/redo and reload retained the expected states, and its actual downloaded CAD ZIP passed CRC and all recorded file hashes.

The edited expected volume is `11,520 − 3×π×3²×4 = 11,180.70799341 mm³`; fresh STEP readback returned 11,180.707993412225 mm³ with unchanged 60 × 30 × 40 mm spans, one solid and passing supplied probes. The browser viewer displayed the checked 1,048-triangle mesh. An earlier qwen3:4b response wrongly put a no-missing-information sentence into its missing list and was rejected; the source remained unchanged. This records two observed attempts, not a benchmark or model ranking.

Retained actual download: [edited source](model-edit/spec.json), [STEP](model-edit/solid.step), [STL](model-edit/solid.stl), [build history](model-edit/build-report.json), [readback](model-edit/verification.json), [trial record](model-edit/trial.json).
