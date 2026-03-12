type CropRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type CropBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

function loadImage(base64Png: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode screenshot image."));
    image.src = `data:image/png;base64,${base64Png}`;
  });
}

export async function cropScreenshotBase64(
  base64Png: string,
  bounds: CropBounds,
  region: CropRegion,
): Promise<string> {
  if (!base64Png.trim()) {
    throw new Error("Missing screenshot source image.");
  }

  const image = await loadImage(base64Png);
  const sourceX = Math.max(0, region.x - bounds.x);
  const sourceY = Math.max(0, region.y - bounds.y);
  const sourceWidth = Math.max(0, Math.min(region.w, image.naturalWidth - sourceX));
  const sourceHeight = Math.max(0, Math.min(region.h, image.naturalHeight - sourceY));

  if (sourceWidth === 0 || sourceHeight === 0) {
    throw new Error("Screenshot crop falls outside the cached desktop snapshot.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is unavailable.");
  }

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );

  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}
