#!/bin/sh
# Rebuild the machines' models: mesh and skeleton only (the page animates them live), and
# their measurements into src/typewriter/typewriter.json and src/teleprinter/teleprinter.json.
# Needs Blender (built with 5.1); set BLENDER if it isn't in /Applications. Name a machine to
# build only that one.
#
#   blender/build.sh [typewriter|teleprinter]
set -e
cd "$(dirname "$0")"
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
mkdir -p build ../public/models
for machine in ${1:-typewriter teleprinter}; do
  "$BLENDER" -b --factory-startup -P export.py -- "build/$machine.raw.glb" "$machine" 2>&1 | grep -E '^EXPORTED|Error|Traceback' || true
  npx -y @gltf-transform/cli@4.5.1 meshopt "build/$machine.raw.glb" "../public/models/$machine.glb" --level medium >/dev/null
  echo "$machine: $(wc -c < "../public/models/$machine.glb" | tr -d ' ') bytes"
done
