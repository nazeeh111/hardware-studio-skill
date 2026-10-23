# Text-to-CAD routes for Hardware Studio

23 October 2026. This compares public source with this Mac's existing OpenCascade generator. Source inspection is distinguished from local execution. No third-party model or CAD repository was installed or executed during this comparison.

## Findings that change the implementation

| Route | Decisive evidence | Decision |
| --- | --- | --- |
| 3mindsales/text-to-cad | At revision `0d76f91daef501f187311022452f69bf79c29469`, the README and project metadata declare a proprietary license and Python 3.11 constraint. The README status still describes an early shell, while source already contains a parameter pipeline, geometry builders, correction and validation. Marketing text alone understates and overstates different aspects. | Study its architecture; do not copy its code or treat it as a free open-source dependency. |
| SadilKhan/Text2CAD | Revision `669a81472ede2269837c22a4d00070eaac360c82` documents Linux and a pinned CUDA environment. Its user-input script selects CPU when CUDA is absent, but immediately calls `torch.cuda.get_device_properties(device)`. It converts predicted sequences to STEP and catches invalid-model exceptions. | Useful sequential CAD research, with a concrete non-CUDA adaptation issue. No supported working Mac path or local generation result was established. |
| Text-to-CadQuery | Revision `4f7f50176f3c642f6d897c4a8670f7a83acb31bd` describes model-generated CadQuery Python, code execution, Blender rendering and Gemini evaluation. | Useful research on editable programs and visual feedback. Its described evaluation uses a cloud service, and generated Python requires execution isolation. Do not connect it directly to the browser CAD endpoint. |
| KittyCAD/text-to-cad-ui | The repository is archived and describes a SvelteKit client for the Zoo Text-to-CAD API. | An interface example, not a downloadable local CAD model. It does not establish a free offline generation route. |
| Existing Hardware Studio | Validated millimeter JSON already drives local OCP geometry, separate-process STEP/STL readback, mesh checks and a browser viewer. | Add text proposals to the existing parameter boundary, with review and stale-input checks. Retain manual editing and exports. |

Primary sources: [3mindsales README](https://github.com/3mindsales/text-to-cad/blob/0d76f91daef501f187311022452f69bf79c29469/README.md), [project metadata](https://github.com/3mindsales/text-to-cad/blob/0d76f91daef501f187311022452f69bf79c29469/pyproject.toml), [Text2CAD environment](https://github.com/SadilKhan/Text2CAD/blob/669a81472ede2269837c22a4d00070eaac360c82/environment.yml), [Text2CAD user-input implementation](https://github.com/SadilKhan/Text2CAD/blob/669a81472ede2269837c22a4d00070eaac360c82/Cad_VLM/test_user_input.py), [Text-to-CadQuery README](https://github.com/Text-to-CadQuery/Text-to-CadQuery/blob/4f7f50176f3c642f6d897c4a8670f7a83acb31bd/README.md), [Zoo UI](https://github.com/KittyCAD/text-to-cad-ui).

## What transfers

The inspected [generation pipeline](https://github.com/3mindsales/text-to-cad/blob/0d76f91daef501f187311022452f69bf79c29469/src/texttocad/pipeline/generate.py) normalizes the model's parameters before construction and returns no solid after its repair budget is exhausted. Its [correction implementation](https://github.com/3mindsales/text-to-cad/blob/0d76f91daef501f187311022452f69bf79c29469/src/texttocad/pipeline/correct.py) rebuilds from a parameter patch and retains the caller's previous specification on failure. These support the design choice to keep an editable specification as the source of truth. No code was copied.

Its [geometry validation](https://github.com/3mindsales/text-to-cad/blob/0d76f91daef501f187311022452f69bf79c29469/src/texttocad/geometry/validate.py) checks solid count, B-rep validity, volume and envelope. Its thin-wall warning uses the smallest overall bounding-box dimension. That is not a measurement of every local wall thickness. Hardware Studio should keep semantic requirements, dimensions, local clearances, readback integrity and physical fabrication as distinct checks.

A process timeout and Python syntax filter do not, by themselves, establish filesystem or network isolation for generated code. Hardware Studio's new text route accepts parameter JSON only and does not execute model-authored programs. More general geometry needs a separate, demonstrated execution boundary and meaningful shape/feature tests before exposure through a browser.

## Original implementation

`tray-intent.js` proposes changes to the current supported tray spec using a selected installed Ollama model. It rejects unsupported response fields, malformed geometry, unresolved required information and unchanged proposals. The complete proposed spec and model assumptions are visible before acceptance. Acceptance refuses a proposal if the form changed since generation. Cancel, timeout, rejection and discard retain the form. The local CAD service still builds and checks actual geometry only after a separate generation action.

This is text editing of a constrained tray model. It does not establish arbitrary text-to-CAD, correct interpretation of every instruction, automatic feature preservation, maker-part fit, strength, tolerances or fabrication readiness. Public Pages cannot reach the local CAD route; text edits are enabled only on a loopback-hosted workbench with Ollama available.

## Local trial

The [retained trial package](../examples/text-edited-tray/README.md) records the actual prompt, installed model digest, one rejected free-form JSON response, accepted schema-constrained parameters and fresh-process CAD readback. The resulting 120 × 80 × 25 mm tray had one solid and matching STEP/STL spans. This verifies one simple local edit through browser export and the CAD generator, without a general model-quality claim.
