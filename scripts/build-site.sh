#!/bin/sh
# Assembles the published site in _site/ from web/.
#
# Needs node (for the module list, scripts/module-graph.mjs).
#
# - Development files stay out: web/dev/ (sample art), the core stub, notes,
#   TypeScript declarations.
# - The service worker gets a version from the commit and the list of
#   exactly the files published, so the offline cache can never miss a
#   module or keep an old one.
#
#   scripts/build-site.sh [VERSION]      (default: short commit hash)
set -eu
cd "$(dirname "$0")/.."
[ -f web/pkg/pips_wasm_bg.wasm ] || { echo "web/pkg is missing: run scripts/build-wasm.sh first" >&2; exit 1; }
version="pips-${1:-$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M)}"

rm -rf _site
mkdir _site
list=$(cd web && find . -type f \
    ! -path './dev/*' ! -name 'stub-core.js' ! -name 'README.md' ! -name '*.d.ts' \
    ! -name 'jsconfig.json' ! -name '.gitignore' ! -name 'package.json' | sed 's|^\./||' | LC_ALL=C sort)
for f in $list; do
    mkdir -p "_site/$(dirname "$f")"
    cp "web/$f" "_site/$f"
done

# Every published file except the worker itself, as one JS array line.
files=$(printf '%s\n' $list | grep -v '^sw\.js$' | sed "s/.*/'&'/" | paste -sd, -)
sed -i \
    -e "s|^const VERSION = .*|const VERSION = '$version';|" \
    -e "s|^const FILES = .*|const FILES = ['./', $files];|" \
    _site/sw.js
grep -q "^const VERSION = '$version';" _site/sw.js || { echo "sw.js template changed: VERSION not set" >&2; exit 1; }
# Every module the app needs to start, asked for at once: without this the
# browser finds them one level of imports at a time, a round trip each, on
# the first visit (later ones come from the offline cache).
preload=$( (node scripts/module-graph.mjs web src/main.js; echo pkg/pips_wasm.js) | sed 's|.*|<link rel="modulepreload" href="&">|' | paste -sd '' -)
sed -i -e "s|^<script type=\"module\" src=\"src/main.js\"></script>|$preload\n&|" _site/index.html
grep -q 'rel="modulepreload" href="src/main.js"' _site/index.html || { echo "index.html changed: module preloads not added" >&2; exit 1; }
# The same version, for the app's own reports.
sed -i -e "s|^export const VERSION = .*|export const VERSION = '$version';|" _site/src/version.js
grep -q "^export const VERSION = '$version';" _site/src/version.js || { echo "src/version.js template changed: VERSION not set" >&2; exit 1; }

echo "_site: $(printf '%s\n' $list | wc -l) files, $(du -sh _site | cut -f1), cache $version"
