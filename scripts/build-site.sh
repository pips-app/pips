#!/bin/sh
# Assembles the published site in _site/ from web/, and the new app from
# web-next/ in _site/next/ (docs/REWRITE.md: a preview, to be tried on a
# phone, until it takes web/'s place at stage 6).
#
# Needs node (for the module list, scripts/module-graph.mjs, and the
# files' hashes).
#
# - Development files stay out: web/dev/ (sample art), the core stub, notes,
#   TypeScript declarations.
# - The service worker gets a version from the commit and the list of
#   exactly the files published, so the offline cache can never miss a
#   module or keep an old one; and the SHA-256 of each, so that it serves
#   from the cache only what was published.
#
#   scripts/build-site.sh [VERSION]      (default: short commit hash)
set -eu
cd "$(dirname "$0")/.."
[ -f web/pkg/pips_wasm_bg.wasm ] || { echo "web/pkg is missing: run scripts/build-wasm.sh first" >&2; exit 1; }
cmp -s web/pkg/pips_wasm_bg.wasm web-next/pkg/pips_wasm_bg.wasm || { echo "web-next/pkg is missing or stale: run scripts/build-wasm.sh" >&2; exit 1; }
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
# Last, once no file changes any more: what each published file must be,
# for the worker to check its cache against (see sw.js). The page itself is
# also asked for as './'.
hashes=$(cd _site && printf '%s\n' $list | grep -v '^sw\.js$' | node -e '
  const { createHash } = require("node:crypto"), { readFileSync } = require("node:fs");
  const h = {};
  for (const f of readFileSync(0, "utf8").split("\n").filter(Boolean)) h[f] = createHash("sha256").update(readFileSync(f)).digest("base64");
  h["./"] = h["index.html"];
  process.stdout.write(JSON.stringify(h));
')
sed -i -e "s|^const HASHES = .*|const HASHES = $hashes;|" _site/sw.js
grep -q '^const HASHES = {"' _site/sw.js || { echo "sw.js template changed: HASHES not set" >&2; exit 1; }

# The new app, as it is: no service worker of its own yet (stage 6), so
# nothing to version or hash. Under web/'s worker's scope, which passes on
# what it does not know to the network. Its dev/ is published too: the
# measuring page, to be opened on a phone.
next=$(cd web-next && find . -type f ! -name 'README.md' ! -name '*.d.ts' ! -name 'jsconfig.json' ! -name '.gitignore' | sed 's|^\./||' | LC_ALL=C sort)
for f in $next; do
    mkdir -p "_site/next/$(dirname "$f")"
    cp "web-next/$f" "_site/next/$f"
done
echo "_site/next: $(printf '%s\n' $next | wc -l) files"
echo "_site: $(printf '%s\n' $list | wc -l) files, $(du -sh _site | cut -f1), cache $version"
