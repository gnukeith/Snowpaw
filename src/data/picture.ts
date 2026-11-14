/** Pictures are stored at this many pixels a side: sharp at every avatar size, small in storage. */
const side = 128;

/** Refuse files this large before decoding them: a huge image costs memory just to open. */
const maxBytes = 20 * 1024 * 1024;

/**
 * Makes an avatar from an image file: the middle square, scaled down, as a
 * data URL. Redrawing the image keeps its pixels only, so whatever else the
 * file carried (location, camera, date) is left behind.
 */
export async function toPicture(file: Blob): Promise<string> {
  if (file.size > maxBytes) throw new Error("too large");
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = side;
    const crop = Math.min(image.width, image.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.drawImage(
      image,
      (image.width - crop) / 2,
      (image.height - crop) / 2,
      crop,
      crop,
      0,
      0,
      side,
      side,
    );
    // Falls back to PNG where WebP cannot be written.
    return canvas.toDataURL("image/webp", 0.9);
  } finally {
    image.close();
  }
}

/**
 * Decodes a stored picture, for drawing on a canvas. The app's content
 * security policy allows images from the app itself only, so a picture is
 * decoded from its bytes here and never handed to an `<img>`. The caller
 * closes the bitmap.
 */
export function decodePicture(picture: string): Promise<ImageBitmap> {
  const binary = atob(picture.slice(picture.indexOf(",") + 1));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return createImageBitmap(new Blob([bytes]));
}
