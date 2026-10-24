# Project CAD runtime

The local curved-profile and edge-fillet builder uses **build123d 0.13.0 with OCP 8.0.1.1.0**, in a separate `.cad-runtime` inside this checkout. The browser submits bounded JSON to trusted construction code. Model-authored Python is not executed.

## Set up and run

The supplied [hash lock](requirements-macos-arm64-python312.lock) was resolved and tested on **macOS arm64, Python 3.12**. From the repository root:

```sh
sh tools/cad-runtime/setup.sh
sh tools/tray-generator/run-local.sh --port 4174
```

Open `http://127.0.0.1:4174/`. If Python 3.12 is not on your path, set `HARDWARE_STUDIO_BASE_PYTHON=/absolute/path/to/python3.12` for setup. The script installs 58 version-pinned, SHA256-checked wheels. Budget about **730 MB**: the isolated trial occupied 728 MB, and the project runtime measured 729 MB after use. The trial had a warm build123d import of 2.754 seconds. These are observations from this Mac, not cross-platform performance guarantees.

Setup leaves an existing runtime intact and checks the required library versions. An incomplete runtime is preserved for inspection. It does not update a shared or system environment. Other operating systems, architectures and Python versions need a separately resolved and verified lock; the included one does not establish their support.

## Interpreter selection and fallback

The launcher uses an explicit `HARDWARE_STUDIO_PYTHON` first, then this checkout's `.cad-runtime`, then an available legacy OCP interpreter. To select another existing environment:

```sh
HARDWARE_STUDIO_PYTHON=/absolute/path/to/ocp-python sh tools/tray-generator/run-local.sh --port 4174
```

An OCP environment without build123d supports existing sources made from boxes, cylinders, polygon profiles, trays and rigid placements of those shapes. Curved profiles and fillets require the project runtime and report unavailable when it is missing. GitHub Pages serves the editor; it cannot execute this local CAD service.

## What checks establish

Actual STEP files are reopened in a fresh process. Shape validity, connected solids, bounds, volume, source reconstruction where applicable and supplied material/void probes are separate checks. Writer and reader use the same OpenCascade kernel.

The [mesh checker](../solid-generator/mesh_check.py) checks binary STL topology, signed volume and sampled agreement with the reopened STEP boundary. Its fixed distance limit is **0.0405 mm**: 0.04 mm mesh deflection plus 0.0005 mm numerical allowance. Every triangle center is checked against trimmed STEP faces, and bounded witnesses from every STEP face are checked back against STL triangles. A time-budget failure rejects the check. The vertex weld tolerance is 0.0002 mm and the binary limit is 400,000 triangles.

Those are sampled surface checks in both directions. They are not an exhaustive maximum-distance or self-intersection proof. Trusted export normalization can remove only numerically zero-area facets, preserving the original `.raw.stl` and both hashes; it does not repair arbitrary imported meshes. Legacy packages can lack cleanup provenance; verification does not invent a receipt. Any retained raw sibling requires its receipt. Neither a successful check nor a plausible render proves fabrication tolerances, strength, fastener fit, connector access or physical safety.

## Why this library

Official metadata checked **23 October 2026** shows [build123d 0.13.0](https://pypi.org/pypi/build123d/json) supports Python 3.11–3.14 and OCP 8.0.x. [CadQuery 2.8.0](https://pypi.org/pypi/cadquery/json) requires OCP below 8. The [decision and actual prototype results](../../research/CAD_RUNTIME.md) explain why this release changed the earlier direct-OCP choice. Both routes still need explicit source validation and checked output.
