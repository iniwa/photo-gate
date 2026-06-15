#!/usr/bin/env bash
# Recreate the throwaway WSL test venv if /tmp was cleared, then run the
# docker test suite. The venv lives in /tmp on purpose (fast, disposable);
# it is gitignored-irrelevant since it is outside the repo.
set -e
cd /mnt/d/Git/photo-gate/docker

VENV=/tmp/pg-venv
if [ ! -x "$VENV/bin/python" ]; then
  echo "== creating venv $VENV"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q -e ".[dev]"
fi

echo "== libvips version"
"$VENV/bin/python" -c 'import pyvips; print(pyvips.version(0), pyvips.version(1), pyvips.version(2))'
echo "== pytest"
exec "$VENV/bin/python" -m pytest "$@"
