#!/bin/bash
set -euxo pipefail

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

echo "Validate product database"
DUPES=$(sed -n 's/^[[:space:]]*"\([^"]*\)":.*/\1/p' "$SCRIPT_DIR/content/js/products.js" | sort | uniq -d)
if [ -n "$DUPES" ]; then
  echo "Duplicate product IDs found: $DUPES"
  exit 1
fi
echo "OK: no duplicate product IDs"

echo "Sort product database by product names"
{
  echo "const PRODUCTS_DB = {"

  sed '1s/^const PRODUCTS_DB = //' "$SCRIPT_DIR/content/js/products.js" |
  sed '$s/;$//' |
  jq -cr '
    to_entries
    | sort_by(.value.n)
    | .[]
    | "  \"\(.key)\": \(.value|tojson),"
  ' | sed '$ s/,$//'

  echo "};"
} > products.sorted.js
mv products.sorted.js "$SCRIPT_DIR/content/js/products.js"

echo "Cache-bust assets"
CACHE_BUST_ASSETS=(
  "css/style.css"
  "js/products.js"
  "js/zxing.min.js"
  "js/app.js"
)
REWRITE_FILES=(
  "$SCRIPT_DIR/content/index.html"
  "$SCRIPT_DIR/content/terms.html"
  "$SCRIPT_DIR/content/js/app.js"
)
for asset in "${CACHE_BUST_ASSETS[@]}"; do
  HASH=$(shasum -a 256 "$SCRIPT_DIR/content/$asset" | cut -c1-8)
  for f in "${REWRITE_FILES[@]}"; do
    # Strip any existing ?v=... then append the new hash
    sed -i '' "s|${asset}?v=[^\"']*|${asset}|g" "$f"
    sed -i '' "s|${asset}\"|${asset}?v=${HASH}\"|g" "$f"
    sed -i '' "s|${asset}'|${asset}?v=${HASH}'|g" "$f"
  done
done

echo "Adjust deployment name"
cd "$SCRIPT_DIR/.github/workflows"
shopt -s nullglob
files=(deployment*.yml)
FILENAME="${files[0]}"
TIMESTAMP=$(date +"%Y_%m_%d-%H_%M")
NEWNAME="deployment_${TIMESTAMP}.yml"
mv "$FILENAME" "$NEWNAME"

echo "Commit pages changes"
cd "$SCRIPT_DIR"
git checkout --orphan tmp_branch
git add -A
git commit -m "add content"
git branch -D main
git branch -m main
git push --force origin main
git branch --set-upstream-to=origin/main main
