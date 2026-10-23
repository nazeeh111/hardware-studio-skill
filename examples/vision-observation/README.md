# Local vision observation trial

This folder retains actual browser downloads from Hardware Studio’s local viewer on 23 October 2026. It uses the original [profile plate](../profile-plate/README.md), not an uploaded personal design. No paid API or cloud model was used.

## Completed observation

[completed/observation.json](completed/observation.json) binds the request, model digest and response to the [exact PNG input](completed/inspection.png) and [geometry manifest](completed/geometry.json). The model was the installed `qwen3-vl:4b-instruct`, digest `84f7ed8042fa7cdbd902f7dcb7d0370e032095047cc3244179f263b77b5bc318`. Local metadata confirmed vision capability and no remote model; its tag digest was checked before and after generation.

The captured requirements were:

1. A concave L-shaped outline.
2. One circular opening.
3. Three separate circular openings, intentionally inconsistent with the supplied plate.

The model labeled the first two visible and the third not visible. The plate’s retained STL has 360 rendered triangles and bounds of 60 × 40 × 4 assumed millimeters. Its parsed Float32 geometry hash was independently recomputed and matched the manifest. The PNG SHA-256 matched the report, and replay through the current strict validator reproduced the saved observations. ZIP integrity checks passed.

This is one qualitative example, not an accuracy benchmark. The [raw response](completed/raw-model-response.json) calls the opening “centered,” which does not establish its actual location. Front and right silhouettes do not independently reveal the concave top outline. Model wording and cited views need human scrutiny even when the broad shape and count observations are useful. No dimensions, material, strength, safety or physical fit were verified.

## Request changes, geometry changes and cancellation

While the model ran, a newer request, “A rectangular outline,” was entered. The UI retained it, marked the capture as earlier, and downloaded the original three captured requirements. Restoring the old request removed that warning; loading the tray/cover example added it again. Downloaded package entries remained byte-for-byte equal to the original completed package. See the [actual stale-request UI](../../assets/vision-observation-stale.png).

A new model run on the tray/cover was then canceled in the browser. [cancelled/observation.json](cancelled/observation.json) records `not-run` with no accepted observations and retains that attempt’s [input image](cancelled/inspection.png) and [geometry](cancelled/geometry.json). The preceding completed observations remained visible and downloadable in **Earlier completed observations**. That earlier download retained the original PNG, model response, request and geometry bytes exactly. See the [actual canceled-retry UI](../../assets/vision-cancel-retention.png).

A numeric diameter request was rejected before generation. After downloading both reports, reloading retained a newly entered qualitative request; observation results themselves stay in tab memory and must be downloaded before reload. No CAD source, project fields or review marks changed.

## Reproduction

Run the [local app](../../README.md#run), open `cad-viewer.html`, choose the profile plate’s `generated/solid.stl`, enter the three lines above and select an installed local vision model. Observe and download the ZIP. A different model, machine or later run may produce different or rejected output. Public Pages exposes the mesh viewer and export but does not call local Ollama.
