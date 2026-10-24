#!/bin/sh
# Install only into this checkout's dedicated runtime. Existing runtimes stay intact.
set -eu
runtime_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/.cad-runtime
lock_file=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/requirements-macos-arm64-python312.lock
if [ -e "$runtime_dir" ]; then
  if [ ! -x "$runtime_dir/bin/python" ]; then
    printf '%s\n' 'The existing .cad-runtime is incomplete. Its files were preserved. Choose a separate checkout or inspect it before replacing anything.' >&2
    exit 1
  fi
  XDG_CACHE_HOME="$runtime_dir/cache" "$runtime_dir/bin/python" -c 'import importlib.metadata as m; import build123d, OCP; assert m.version("build123d")=="0.13.0"; assert m.version("cadquery-ocp-novtk")=="8.0.1.1.0"'
  printf '%s\n' 'Existing project CAD runtime is ready. No packages changed.'
  exit 0
fi
if [ -n "${HARDWARE_STUDIO_BASE_PYTHON:-}" ]; then
  base_python=$HARDWARE_STUDIO_BASE_PYTHON
elif command -v python3.12 >/dev/null 2>&1; then
  base_python=$(command -v python3.12)
elif [ -n "${HOME:-}" ] && [ -x "$HOME/.local/share/codex-tools/engineering-ocp8-sympy1.14/venv/bin/python" ]; then
  base_python="$HOME/.local/share/codex-tools/engineering-ocp8-sympy1.14/venv/bin/python"
else
  printf '%s\n' 'This tested lock needs macOS arm64 and Python 3.12. Set HARDWARE_STUDIO_BASE_PYTHON to that interpreter. Other platforms need a separately verified environment.' >&2
  exit 1
fi
"$base_python" -c 'import platform,sys; assert sys.version_info[:2]==(3,12) and sys.platform=="darwin" and platform.machine()=="arm64", "The tested lock requires macOS arm64/Python3.12."'
"$base_python" -m venv "$runtime_dir"
"$runtime_dir/bin/python" -m pip install --no-cache-dir --only-binary=:all: --require-hashes --report "$runtime_dir/install-report.json" -r "$lock_file"
XDG_CACHE_HOME="$runtime_dir/cache" "$runtime_dir/bin/python" -c 'import importlib.metadata as m; import build123d,OCP; assert m.version("build123d")=="0.13.0"; assert m.version("cadquery-ocp-novtk")=="8.0.1.1.0"; print("Pinned build123d/OCP runtime ready")'
"$runtime_dir/bin/python" -m pip check
printf '%s\n' 'Run sh tools/tray-generator/run-local.sh --port 4174 from the repository root.'
