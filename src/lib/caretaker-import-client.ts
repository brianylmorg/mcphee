"use client";

import {
  CARETAKER_IMPORT_IMAGE_TYPES,
  CARETAKER_IMPORT_MAX_IMAGE_BYTES,
  type CaretakerOcrLine,
  type CaretakerOriginEvidence,
} from "./caretaker-import-contract";

export type CaretakerOcrProgress = {
  status: "loading" | "recognizing" | "classifying";
  progress: number;
};

export type CaretakerOcrOptions = {
  onProgress?: (update: CaretakerOcrProgress) => void;
  signal?: AbortSignal;
};

export type CaretakerOcrClientErrorCode =
  | "UNSUPPORTED_TYPE"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_DIMENSIONS"
  | "OCR_FAILED";

export class CaretakerOcrClientError extends Error {
  constructor(public readonly code: CaretakerOcrClientErrorCode, message: string) {
    super(message);
    this.name = "CaretakerOcrClientError";
  }
}

const MAX_IMAGE_EDGE = 12_000;
const MAX_IMAGE_PIXELS = 30_000_000;

function abortError(): DOMException {
  return new DOMException("Caretaker screenshot recognition was cancelled.", "AbortError");
}

function report(options: CaretakerOcrOptions, status: CaretakerOcrProgress["status"], value: number) {
  options.onProgress?.({ status, progress: Math.max(0, Math.min(1, value)) });
}

async function imageSource(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function isSupportedLayout(texts: string[]): boolean {
  const joined = texts.join("\n");
  const knownSection = /past\s+milk\s+feeds?|past\s+diaper\s+changes?|past\s+nap\s+times?|past\s+solid/i.test(joined);
  const activityEvidence = /\b\d{1,2}\s*[:.]\s*\d{2}\s*[ap]\s*\.?\s*m\.?\b|nap\s*(?:start|end)/i.test(joined);
  return knownSection && activityEvidence;
}

function imageHasColour(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 30_000)));
  const data = context.getImageData(0, 0, width, height).data;
  let inspected = 0;
  let chromatic = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      inspected++;
      if (max - min >= 22) chromatic++;
    }
  }
  return chromatic >= Math.max(12, inspected * 0.0005);
}

export function classifyCaretakerOriginPixels(
  pixels: Uint8ClampedArray,
  supportedLayout: boolean,
  colourIntact: boolean,
): CaretakerOriginEvidence {
  let blue = 0;
  let neutralText = 0;
  let otherColour = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] < 100) continue;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blueChannel = pixels[offset + 2];
    const max = Math.max(red, green, blueChannel);
    const min = Math.min(red, green, blueChannel);
    const chroma = max - min;
    const luminance = (red * 0.2126 + green * 0.7152 + blueChannel * 0.0722) / 255;
    if (luminance > 0.92) continue;
    const isBlue = luminance <= 0.85
      && blueChannel - red >= 18
      && blueChannel - green >= 3
      && blueChannel >= 70
      && chroma >= 20;
    if (isBlue) blue++;
    else if (chroma <= 24 && luminance <= 0.78) neutralText++;
    else if (chroma > 24 && luminance <= 0.85) otherColour++;
  }

  const textPixels = blue + neutralText + otherColour;
  const blueRatio = textPixels > 0 ? blue / textPixels : 0;
  const neutralRatio = textPixels > 0 ? neutralText / textPixels : 0;
  const otherRatio = textPixels > 0 ? otherColour / textPixels : 0;
  if (blue >= 10 && blueRatio >= 0.5) {
    return {
      classification: "household",
      confidence: Math.min(1, 0.65 + blueRatio),
      blueRatio,
      evidence: "activity-text-blue",
    };
  }
  if (supportedLayout && colourIntact && neutralText >= 10
      && neutralRatio >= 0.5 && blueRatio <= 0.35 && otherRatio <= 0.3) {
    return {
      classification: "caretaker",
      confidence: Math.min(1, 0.65 + neutralText / Math.max(50, textPixels)),
      blueRatio,
      evidence: "activity-text-neutral-on-supported-colour-layout",
    };
  }
  return {
    classification: "uncertain",
    confidence: supportedLayout && colourIntact ? 0.25 : 0,
    blueRatio,
    evidence: !supportedLayout || !colourIntact
      ? "layout-or-colour-unverified"
      : otherRatio > 0.08
        ? "unknown-activity-text-colour"
        : "insufficient-colour-samples",
  };
}

function classifyLineOrigin(
  context: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  supportedLayout: boolean,
  colourIntact: boolean,
): CaretakerOriginEvidence {
  const padding = Math.max(2, Math.round(bounds.height * 0.12));
  const x = Math.max(0, Math.floor(bounds.x - padding));
  const y = Math.max(0, Math.floor(bounds.y - padding));
  const width = Math.min(context.canvas.width - x, Math.ceil(bounds.width + padding * 2));
  const height = Math.min(context.canvas.height - y, Math.ceil(bounds.height + padding * 2));
  if (width <= 0 || height <= 0) {
    return { classification: "uncertain", confidence: 0, evidence: "layout-or-colour-unverified" };
  }

  const pixels = context.getImageData(x, y, width, height).data;
  return classifyCaretakerOriginPixels(pixels, supportedLayout, colourIntact);
}

export async function recognizeCaretakerScreenshot(
  file: File,
  options: CaretakerOcrOptions = {},
): Promise<CaretakerOcrLine[]> {
  if (options.signal?.aborted) throw abortError();
  if (!(CARETAKER_IMPORT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new CaretakerOcrClientError("UNSUPPORTED_TYPE", "Choose a PNG, JPEG, or WebP screenshot.");
  }
  if (file.size <= 0 || file.size > CARETAKER_IMPORT_MAX_IMAGE_BYTES) {
    throw new CaretakerOcrClientError("IMAGE_TOO_LARGE", "The screenshot must be 3 MiB or smaller.");
  }

  report(options, "loading", 0);
  let decoded: Awaited<ReturnType<typeof imageSource>> | null = null;
  let worker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | null = null;
  let abortListener: (() => void) | null = null;
  try {
    decoded = await imageSource(file);
    if (decoded.width < 200 || decoded.height < 200
        || decoded.width > MAX_IMAGE_EDGE || decoded.height > MAX_IMAGE_EDGE
        || decoded.width * decoded.height > MAX_IMAGE_PIXELS) {
      throw new CaretakerOcrClientError(
        "IMAGE_DIMENSIONS",
        "The screenshot dimensions are unsupported. Use a screenshot under 30 megapixels.",
      );
    }
    if (options.signal?.aborted) throw abortError();

    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new CaretakerOcrClientError("OCR_FAILED", "Image processing is unavailable in this browser.");
    context.drawImage(decoded.source, 0, 0);

    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/tesseract-core",
      langPath: "/ocr/lang",
      gzip: true,
      logger(message) {
        const isRecognition = message.status.toLowerCase().includes("recogniz");
        report(options, isRecognition ? "recognizing" : "loading", message.progress);
      },
    });

    abortListener = () => { void worker?.terminate(); };
    options.signal?.addEventListener("abort", abortListener, { once: true });
    if (options.signal?.aborted) throw abortError();

    const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
    if (options.signal?.aborted) throw abortError();
    const ocrLines = (result.data.blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((paragraph) => paragraph.lines),
    ).filter((line) => line.text.trim());
    const supportedLayout = isSupportedLayout(ocrLines.map((line) => line.text));
    report(options, "classifying", 0);
    const colourIntact = imageHasColour(context, canvas.width, canvas.height);

    const lines = ocrLines.map((line, index): CaretakerOcrLine => {
      const bounds = {
        x: Math.max(0, line.bbox.x0),
        y: Math.max(0, line.bbox.y0),
        width: Math.max(1, line.bbox.x1 - line.bbox.x0),
        height: Math.max(1, line.bbox.y1 - line.bbox.y0),
      };
      const origin = classifyLineOrigin(context, bounds, supportedLayout, colourIntact);
      report(options, "classifying", (index + 1) / Math.max(1, ocrLines.length));
      return {
        id: `line-${index + 1}`,
        text: line.text.trim(),
        confidence: Math.max(0, Math.min(1, line.confidence / 100)),
        bounds,
        origin,
      };
    });
    return lines;
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw abortError();
    }
    if (error instanceof CaretakerOcrClientError) throw error;
    throw new CaretakerOcrClientError("OCR_FAILED", "The screenshot could not be read on this device.");
  } finally {
    if (abortListener) options.signal?.removeEventListener("abort", abortListener);
    try { await worker?.terminate(); } catch {}
    decoded?.dispose();
  }
}
