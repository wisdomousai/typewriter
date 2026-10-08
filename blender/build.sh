#!/bin/sh
# Rebuild the typewriter's model: mesh and skeleton only (the page animates it live), and
# its measurements into src/typewriter/typewriter.json. Needs Blender (built with 5.1); set
# BLENDER if it isn't in /Applications.
#
#   blender/build.sh
set -e
cd "$(dirname "$0")"
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
mkdir -p build ../public/models
"$BLENDER" -b --factory-startup -P export.py -- build/typewriter.raw.glb 2>&1 | grep -E '^EXPORTED|Error|Traceback' || true
npx -y @gltf-transform/cli@4.5.1 meshopt build/typewriter.raw.glb ../public/models/typewriter.glb --level medium >/dev/null
echo "typewriter: $(wc -c < ../public/models/typewriter.glb | tr -d ' ') bytes"
