# Curved CAD runtime decision

Checked **23 October 2026** against live official package metadata, tagged source requirements and an isolated native runtime. Search snippets still showed build123d 0.12.0; direct metadata identified the current 0.13.0 release. The earlier notes in [TEXT_TO_CAD.md](TEXT_TO_CAD.md) describe the previous product state.

## Evidence that changed the choice

| Candidate | Current official requirements | Outcome |
| --- | --- | --- |
| build123d 0.13.0 | Python `>=3.11,<3.15`; `cadquery-ocp-novtk>=8.0,<8.1` | Compatible with this Mac's Python 3.12.14/arm64 and OCP 8.0.1.1.0. Exact line/arc profiles and selected fillets executed successfully. |
| CadQuery 2.8.0 | Python `>=3.11`; `cadquery-ocp>=7.9.3.1,<8.0` | Released dependency constraints require a different kernel environment. No dependency override or installation attempted. |
| Direct OCP 8 | Existing runtime supports arc and fillet kernel APIs | Feasible fallback, with more project-owned construction and topology handling. |

Sources: [build123d release metadata](https://pypi.org/pypi/build123d/0.13.0/json), [tagged build123d requirements](https://raw.githubusercontent.com/gumyr/build123d/v0.13.0/pyproject.toml), [CadQuery release metadata](https://pypi.org/pypi/cadquery/2.8.0/json), [OCP release metadata and platform wheels](https://pypi.org/pypi/cadquery-ocp-novtk/8.0.1.1.0/json).

The maintained library is a useful trusted adapter for these operations. It does not supply the product's JSON contract, source preservation, target-part binding, feature correctness or physical validation. It uses the same underlying kernel as direct OCP. Official APIs: [build123d objects](https://build123d.readthedocs.io/en/stable/objects.html), [build123d direct API](https://build123d.readthedocs.io/en/stable/direct_api_reference.html), [OCCT circular arc construction](https://occt3d.com/dev/doc/refman/html/class_g_c___make_arc_of_circle.html), [OCCT edge fillets](https://occt3d.com/dev/doc/refman/html/class_b_rep_fillet_a_p_i___make_fillet.html).

## What actually ran

The isolated trial installed 58 wheels using build123d 0.13.0 and OCP 8.0.1.1.0. Its 728 MB environment passed `pip check`; warm import took 2.754 seconds. Shared native environments were unchanged. Package versions and SHA256 hashes are captured in the [tested platform lock](../tools/cad-runtime/requirements-macos-arm64-python312.lock).

Own fixed prototype code built and exported three parts. Separate processes reopened actual STEP and parsed actual STL files:

| Trial | Actual STEP result |
| --- | --- |
| Capsule from two lines and two three-point circular arcs, 6 mm extrusion | One valid solid; 40 × 20 × 6 mm; R10 circular edges; **4284.955592153959 mm³**, matching an independent analytic formula |
| 40 × 20 × 6 mm box with four selected vertical edges filleted R2 | One valid solid; unchanged outer dimensions; R2 arcs; **4779.398223686171 mm³**, matching an independent analytic formula |
| Capsule with four selected top edges filleted R1 | One valid solid; unchanged outer dimensions; R1/R9/R10 circular edges; **4263.188873178951 mm³**, matching construction readback, without an independent analytic expectation |

An impossible R20 box fillet rejected. Wrapping an existing OCP box as a build123d solid preserved its volume and validity. An open profile rejected; a bowtie produced an invalid face with zero area. These examples support the operation boundary; they do not establish that every malformed sketch or radius is handled correctly. No benchmark of model accuracy or hardware testing was performed.

## Product boundary

Retain bounded JSON and static construction code. Line/arc profiles need explicit ordered closure, finite dimensions and topology checks. Fillets need a positive radius and explicit geometric selectors that match uniquely against the preceding solid; unstable topology indices or ambiguous nearest-edge selection are unsuitable saved intent. Tangent-contour propagation must remain visible in the modeled result.

Keep one valid connected solid, meaningful operation effects, requested-region checks and fresh STEP/STL readback. The mesh check uses a fixed **0.0405 mm sampled distance limit**, not a manufacturing tolerance or exhaustive surface-distance proof. The [runtime guide](../tools/cad-runtime/README.md) records setup, legacy fallback, topology/volume checks and limits.

This decision does not integrate Text2CAD weights or change the earlier [pinned Text2CAD source findings](TEXT_TO_CAD.md#first-part-generation-deeper-implementation-findings). That model pipeline's quantization and global normalization need their own unit adapter and requested-feature checks. A stronger trusted geometry library alone does not establish a stronger language-to-CAD model.
