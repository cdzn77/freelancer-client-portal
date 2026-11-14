export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
export function validateProfilePhoto(file: Pick<File, "type" | "size">) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("Choose a JPG, PNG, or WebP photo.");
  if (!file.size || file.size > MAX_PROFILE_PHOTO_BYTES)
    throw Error("Choose a photo up to 5 MB.");
}
export async function prepareProfilePhoto(file: File): Promise<Blob> {
  validateProfilePhoto(file);
  const bitmap = await createImageBitmap(file);
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width > 16384 ||
      bitmap.height > 16384
    )
      throw Error("Choose a smaller photo.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Your browser could not prepare this photo.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 512, 512);
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      512,
      512,
    );
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(Error("This photo could not be processed.")),
        "image/jpeg",
        0.88,
      ),
    );
  } finally {
    bitmap.close();
  }
}
