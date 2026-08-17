#!/bin/bash
set -euxo pipefail

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

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
