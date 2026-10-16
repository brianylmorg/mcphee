/**
 * Joins several overlapping screenshots of one scrolling page into a single
 * tall image, for phones without a "scrolling screenshot" feature.
 *
 * Alignment works on per-row signatures (the brightness pattern of each pixel
 * row). For each neighbouring pair we find the scroll offset at which the most
 * textured rows line up, then cut inside that identical stretch. Cutting where
 * both images show the same pixels makes the seam invisible and drops the
 * earlier image's bottom bar and the later image's top bar (status bar, app
 * header) on its own, so repeated entries are never read twice.
 */

/** Brightness pattern of one pixel row: column-bucket averages plus summary stats. */
export type RowSignature = {
  mean: number;
  spread: number;
  buckets: number[];
};

export type StitchSegment = { image: number; fromRow: number; toRow: number };

export type StitchPair =
  | { kind: "aligned"; offset: number; seamA: number; seamB: number; matchedRows: number }
  | { kind: "duplicate" }
  | { kind: "unaligned" };

export type StitchPlan = {
  segments: StitchSegment[];
  pairs: StitchPair[];
};

const BUCKETS = 24;
/** Rows flatter than this are blank background and prove nothing about alignment. */
const TEXTURED_SPREAD = 6;
const CHEAP_TOLERANCE = 2.5;
const BUCKET_TOLERANCE = 4;

/** Builds row signatures from greyscale pixels (row-major, one byte per pixel). */
export function rowSignatures(grey: ArrayLike<number>, width: number, height: number): RowSignature[] {
  const rows: RowSignature[] = [];
  const bucketWidth = width / BUCKETS;
  for (let y = 0; y < height; y += 1) {
    const offset = y * width;
    let sum = 0;
    let sumSquares = 0;
    const buckets: number[] = [];
    for (let b = 0; b < BUCKETS; b += 1) {
      const start = Math.floor(b * bucketWidth);
      const end = Math.max(start + 1, Math.floor((b + 1) * bucketWidth));
      let bucketSum = 0;
      for (let x = start; x < end; x += 1) {
        const value = grey[offset + x];
        bucketSum += value;
        sum += value;
        sumSquares += value * value;
      }
      buckets.push(bucketSum / (end - start));
    }
    const mean = sum / width;
    rows.push({ mean, spread: Math.sqrt(Math.max(0, sumSquares / width - mean * mean)), buckets });
  }
  return rows;
}

function cheapMatch(a: RowSignature, b: RowSignature): boolean {
  return Math.abs(a.mean - b.mean) < CHEAP_TOLERANCE && Math.abs(a.spread - b.spread) < CHEAP_TOLERANCE;
}

function strictMatch(a: RowSignature, b: RowSignature): boolean {
  if (!cheapMatch(a, b)) return false;
  let total = 0;
  for (let i = 0; i < a.buckets.length; i += 1) total += Math.abs(a.buckets[i] - b.buckets[i]);
  return total / a.buckets.length < BUCKET_TOLERANCE;
}

/**
 * The same screen captured twice. A changed status-bar clock or a small
 * notification badge must not make it look new, so a few differing rows are
 * tolerated as long as nearly every textured row matches in place.
 */
function sameImage(a: RowSignature[], b: RowSignature[]): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  const rows = Math.min(a.length, b.length);
  let textured = 0;
  let texturedMatches = 0;
  for (let y = 0; y < rows; y += 1) {
    if (a[y].spread < TEXTURED_SPREAD && b[y].spread < TEXTURED_SPREAD) continue;
    textured += 1;
    if (strictMatch(a[y], b[y])) texturedMatches += 1;
  }
  return textured > 0 && texturedMatches / textured >= 0.95;
}

/**
 * Aligns image b below image a. "offset" is how far b is scrolled past a:
 * row j of b shows the same content as row j + offset of a.
 */
export function alignPair(
  a: RowSignature[],
  b: RowSignature[],
  options: { minMatchedRows?: number; candidates?: number } = {},
): StitchPair {
  if (sameImage(a, b)) return { kind: "duplicate" };
  const minMatchedRows = options.minMatchedRows ?? Math.max(12, Math.round(Math.min(a.length, b.length) * 0.04));
  const candidateCount = options.candidates ?? 6;

  // Cheap pass: score every offset by its count of loosely matching textured rows.
  const scored: { offset: number; score: number }[] = [];
  for (let offset = 1; offset < a.length - minMatchedRows; offset += 1) {
    let score = 0;
    const limit = Math.min(b.length, a.length - offset);
    for (let j = 0; j < limit; j += 1) {
      const rowA = a[j + offset];
      if (rowA.spread >= TEXTURED_SPREAD && cheapMatch(rowA, b[j])) score += 1;
    }
    if (score >= minMatchedRows) scored.push({ offset, score });
  }
  scored.sort((x, y) => y.score - x.score);

  // Strict pass: the longest unbroken run of identical rows decides, and must
  // carry enough textured rows to rule out blank-background coincidences.
  let best: { offset: number; runStart: number; runLength: number; textured: number } | null = null;
  for (const { offset } of scored.slice(0, candidateCount)) {
    const limit = Math.min(b.length, a.length - offset);
    let runStart = 0;
    let runLength = 0;
    let textured = 0;
    for (let j = 0; j <= limit; j += 1) {
      const matches = j < limit && strictMatch(a[j + offset], b[j]);
      if (matches) {
        if (runLength === 0) { runStart = j; textured = 0; }
        runLength += 1;
        if (b[j].spread >= TEXTURED_SPREAD) textured += 1;
        continue;
      }
      if (runLength > 0 && textured >= minMatchedRows
          && (!best || textured > best.textured || (textured === best.textured && runLength > best.runLength))) {
        best = { offset, runStart, runLength, textured };
      }
      runLength = 0;
    }
  }
  if (!best) return { kind: "unaligned" };

  // Cut inside the identical stretch, on the blank row nearest its middle, so
  // a pixel of rounding at full resolution can never slice through text.
  const middle = best.runStart + Math.floor(best.runLength / 2);
  let seamB = middle;
  for (let step = 0; step <= best.runLength / 2; step += 1) {
    const below = middle + step;
    const above = middle - step;
    if (below < best.runStart + best.runLength && b[below].spread < TEXTURED_SPREAD) { seamB = below; break; }
    if (above >= best.runStart && b[above].spread < TEXTURED_SPREAD) { seamB = above; break; }
  }
  return { kind: "aligned", offset: best.offset, seamA: seamB + best.offset, seamB, matchedRows: best.textured };
}

/** Plans which row ranges of each image make up the stitched result. */
export function planStitch(images: RowSignature[][]): StitchPlan {
  const segments: StitchSegment[] = [];
  const pairs: StitchPair[] = [];
  if (images.length === 0) return { segments, pairs };

  let current = { image: 0, fromRow: 0 };
  for (let next = 1; next < images.length; next += 1) {
    const pair = alignPair(images[current.image], images[next]);
    pairs.push(pair);
    if (pair.kind === "duplicate") continue;
    if (pair.kind === "aligned" && pair.seamA > current.fromRow) {
      segments.push({ image: current.image, fromRow: current.fromRow, toRow: pair.seamA });
      current = { image: next, fromRow: pair.seamB };
    } else {
      // Could not line these up: keep both whole and let review flag repeats.
      segments.push({ image: current.image, fromRow: current.fromRow, toRow: images[current.image].length });
      current = { image: next, fromRow: 0 };
    }
  }
  segments.push({ image: current.image, fromRow: current.fromRow, toRow: images[current.image].length });
  return { segments, pairs };
}

/**
 * Alignment narrows each row to this width but keeps every pixel row: real
 * scroll distances are arbitrary, and shrinking vertically would put the two
 * screenshots out of phase so identical content no longer matched.
 */
const ANALYSIS_WIDTH = 360;
const MAX_OUTPUT_EDGE = 12_000;
const MAX_OUTPUT_PIXELS = 30_000_000;

export type StitchedScreenshot = {
  file: File;
  imageCount: number;
  duplicates: number;
  /** 1-based positions of screenshots that could not be lined up with the one before. */
  unaligned: number[];
};

async function decode(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Image processing is unavailable in this browser.");
  return { canvas, context };
}

function analysisSignatures(bitmap: ImageBitmap, height: number): RowSignature[] {
  const { context } = canvasOf(ANALYSIS_WIDTH, height);
  context.drawImage(bitmap, 0, 0, ANALYSIS_WIDTH, height);
  const rgba = context.getImageData(0, 0, ANALYSIS_WIDTH, height).data;
  const grey = new Uint8Array(ANALYSIS_WIDTH * height);
  for (let i = 0; i < grey.length; i += 1) {
    grey[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  }
  return rowSignatures(grey, ANALYSIS_WIDTH, height);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Encodes under the byte limit: lossless first, then JPEG, then smaller. */
async function encodeWithin(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob> {
  let source = canvas;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const png = await toBlob(source, "image/png");
    if (png && png.size <= maxBytes) return png;
    for (const quality of [0.92, 0.85, 0.75]) {
      const jpeg = await toBlob(source, "image/jpeg", quality);
      if (jpeg && jpeg.size <= maxBytes) return jpeg;
    }
    const smaller = canvasOf(Math.round(source.width * 0.85), Math.round(source.height * 0.85));
    smaller.context.drawImage(source, 0, 0, smaller.canvas.width, smaller.canvas.height);
    source = smaller.canvas;
  }
  throw new Error("The joined screenshot is too large. Try fewer screenshots.");
}

/**
 * Joins screenshots (in the order given) into one image ready for the normal
 * single-screenshot reading and review flow.
 */
export async function stitchScreenshots(files: File[], maxBytes: number): Promise<StitchedScreenshot> {
  const bitmaps: ImageBitmap[] = [];
  try {
    for (const file of files) bitmaps.push(await decode(file));
    const width = bitmaps[0].width;
    // Every screenshot is laid out at the first one's width.
    const fullHeights = bitmaps.map((bitmap) => Math.round(bitmap.height * width / bitmap.width));
    const signatures = bitmaps.map((bitmap, index) => analysisSignatures(bitmap, fullHeights[index]));
    const plan = planStitch(signatures);

    // Signature rows are full-resolution rows, so segments map across directly.
    const pieces = plan.segments
      .map((segment) => ({ image: segment.image, from: segment.fromRow, to: segment.toRow }))
      .filter((piece) => piece.to > piece.from);

    const totalHeight = pieces.reduce((sum, piece) => sum + piece.to - piece.from, 0);
    const fit = Math.min(1, MAX_OUTPUT_EDGE / totalHeight, Math.sqrt(MAX_OUTPUT_PIXELS / (width * totalHeight)));
    const { canvas, context } = canvasOf(Math.round(width * fit), Math.round(totalHeight * fit));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    for (const piece of pieces) {
      const bitmap = bitmaps[piece.image];
      const sourceScale = bitmap.height / fullHeights[piece.image];
      const height = piece.to - piece.from;
      context.drawImage(
        bitmap,
        0, piece.from * sourceScale, bitmap.width, height * sourceScale,
        0, Math.round(y * fit), canvas.width, Math.round(height * fit),
      );
      y += height;
    }

    const blob = await encodeWithin(canvas, maxBytes);
    const extension = blob.type === "image/png" ? "png" : "jpg";
    return {
      file: new File([blob], `joined-${files.length}-screenshots.${extension}`, { type: blob.type, lastModified: Date.now() }),
      imageCount: files.length,
      duplicates: plan.pairs.filter((pair) => pair.kind === "duplicate").length,
      unaligned: plan.pairs.flatMap((pair, index) => (pair.kind === "unaligned" ? [index + 2] : [])),
    };
  } finally {
    for (const bitmap of bitmaps) bitmap.close();
  }
}
