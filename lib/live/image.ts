/** Browser-only helpers. Re-encoding through a canvas drops EXIF/GPS metadata before upload. */

export const MAX_UPLOAD_BYTES = 2_000_000;
const MAX_SIDE = 1280;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Returns a metadata-free JPEG under MAX_UPLOAD_BYTES, or throws with a user-safe message. */
export async function reencodeImage(file: File): Promise<Blob> {
  const img = await loadImage(file);
  let side = MAX_SIDE;
  for (let shrink = 0; shrink < 3; shrink++) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser could not process that image.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.55]) {
      const blob = await toBlob(canvas, quality);
      if (!blob) throw new Error("Your browser could not process that image.");
      if (blob.size < MAX_UPLOAD_BYTES) return blob;
    }
    side = Math.round(side * 0.7);
  }
  throw new Error("That image is too large even after shrinking. Try a smaller one.");
}
