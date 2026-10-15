#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
core_dir="$project_dir/node_modules/.pnpm/tesseract.js-core@7.0.0/node_modules/tesseract.js-core"
output_dir="$project_dir/public/ocr"
language_source="${TESSDATA_ENG_PATH:-}"

if [[ -z "$language_source" || ! -f "$language_source" ]]; then
  echo "Set TESSDATA_ENG_PATH to the reviewed eng.traineddata file." >&2
  exit 1
fi

mkdir -p "$output_dir/tesseract-core" "$output_dir/lang" "$output_dir/licenses"
cp "$project_dir/node_modules/tesseract.js/dist/worker.min.js" "$output_dir/worker.min.js"
for asset in \
  tesseract-core.wasm.js \
  tesseract-core-simd.wasm.js \
  tesseract-core-relaxedsimd.wasm.js \
  tesseract-core-lstm.wasm.js \
  tesseract-core-simd-lstm.wasm.js \
  tesseract-core-relaxedsimd-lstm.wasm.js
do
  cp "$core_dir/$asset" "$output_dir/tesseract-core/$asset"
done
cp "$language_source" "$output_dir/lang/eng.traineddata"
gzip -9 -f "$output_dir/lang/eng.traineddata"
cp "$project_dir/node_modules/tesseract.js/LICENSE.md" "$output_dir/licenses/tesseract.js-LICENSE.md"
cp "$core_dir/LICENSE" "$output_dir/licenses/tesseract.js-core-LICENSE"
