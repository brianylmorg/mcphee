# Local caretaker OCR assets

These files are served from McPhee's own origin. The caretaker screenshot OCR
client does not use a CDN or send the screenshot to an OCR provider.

- `worker.min.js`: `tesseract.js` 7.0.0 browser worker.
- `tesseract-core/*.wasm.js`: the six runtime-selected builds from
  `tesseract.js-core` 7.0.0.
- `lang/eng.traineddata.gz`: English model used by the local sample trial,
  SHA-256 of the uncompressed file
  `5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747`.
- `licenses/`: Apache-2.0 license files for Tesseract.js, its core, and tessdata.

The browser may cache these public executable/model assets. Screenshots, OCR
results, and caretaker import API responses are private data and must never be
added to a service-worker cache.
