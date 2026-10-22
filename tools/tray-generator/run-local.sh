#!/bin/sh
set -eu

if [ -n "${HARDWARE_STUDIO_PYTHON:-}" ]; then
  cad_python=$HARDWARE_STUDIO_PYTHON
elif [ -n "${HOME:-}" ] && [ -x "$HOME/.local/share/codex-tools/engineering-ocp8-sympy1.14/venv/bin/python" ]; then
  cad_python="$HOME/.local/share/codex-tools/engineering-ocp8-sympy1.14/venv/bin/python"
elif command -v python3 >/dev/null 2>&1 && python3 -c 'import OCP' >/dev/null 2>&1; then
  cad_python=$(command -v python3)
else
  printf '%s\n' 'OpenCascade Python bindings are unavailable. Run with HARDWARE_STUDIO_PYTHON=/path/to/ocp-python or install cadquery-ocp-novtk in a Python environment.' >&2
  exit 1
fi

if ! "$cad_python" -c 'import OCP' >/dev/null 2>&1; then
  printf '%s\n' 'The selected Python interpreter cannot import OCP. Set HARDWARE_STUDIO_PYTHON to an OCP-enabled Python interpreter.' >&2
  exit 1
fi

exec "$cad_python" "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/server.py" "$@"
