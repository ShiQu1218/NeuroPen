import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { clampToMonitorBounds } from "./windowBounds";

export interface PreviewWindowSize {
  width: number;
  height: number;
}

export const PREVIEW_SIZE_POLICY = Object.freeze({
  minWidth: 480,
  defaultWidth: 560,
  maxWidth: 840,
  minHeight: 340,
  defaultHeight: 340,
  maxHeight: 620,
  monitorMargin: 64,
});

export const PREVIEW_DEFAULT_SIZE: PreviewWindowSize = {
  width: PREVIEW_SIZE_POLICY.defaultWidth,
  height: PREVIEW_SIZE_POLICY.defaultHeight,
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const waitForNextFrame = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

const getPreviewChromeInsets = (viewportEl: HTMLElement | null) => ({
  width: Math.max(0, window.innerWidth - (viewportEl?.clientWidth ?? 0)),
  height: Math.max(0, window.innerHeight - (viewportEl?.clientHeight ?? 0)),
});

const getWidestRenderableContent = (
  contentEl: HTMLElement | null,
  viewportEl: HTMLElement | null,
) => {
  let widest = Math.max(
    contentEl?.scrollWidth ?? 0,
    viewportEl?.scrollWidth ?? 0,
  );
  if (!contentEl) {
    return widest;
  }
  const candidates = contentEl.querySelectorAll<HTMLElement>(
    "pre, .katex-display, .preview-markdown-table-wrap",
  );
  candidates.forEach((element) => {
    widest = Math.max(widest, element.scrollWidth);
  });
  return widest;
};

const getTallestRenderableContent = (
  contentEl: HTMLElement | null,
  viewportEl: HTMLElement | null,
) =>
  Math.max(
    60,
    contentEl?.scrollHeight ?? 0,
    viewportEl?.scrollHeight ?? 0,
  );

export const getPreviewMaxSize = async (): Promise<PreviewWindowSize> => {
  const win = getCurrentWindow();
  const monitor = await currentMonitor().catch(() => null);
  if (!monitor) {
    return {
      width: PREVIEW_SIZE_POLICY.maxWidth,
      height: PREVIEW_SIZE_POLICY.maxHeight,
    };
  }

  const scaleFactor =
    monitor.scaleFactor || (await win.scaleFactor().catch(() => 1)) || 1;
  const logicalWidth = monitor.size.width / scaleFactor;
  const logicalHeight = monitor.size.height / scaleFactor;

  return {
    width: Math.round(
      clampNumber(
        logicalWidth - PREVIEW_SIZE_POLICY.monitorMargin,
        PREVIEW_SIZE_POLICY.minWidth,
        PREVIEW_SIZE_POLICY.maxWidth,
      ),
    ),
    height: Math.round(
      clampNumber(
        logicalHeight - PREVIEW_SIZE_POLICY.monitorMargin,
        PREVIEW_SIZE_POLICY.minHeight,
        PREVIEW_SIZE_POLICY.maxHeight,
      ),
    ),
  };
};

export const keepPreviewWindowInBounds = async () => {
  try {
    const win = getCurrentWindow();
    const [position, size] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
    ]);
    const clamped = await clampToMonitorBounds(
      position.x,
      position.y,
      size.width,
      size.height,
    );
    await win.setPosition(new PhysicalPosition(clamped.x, clamped.y));
  } catch (err) {
    console.warn("[Preview] keepPreviewWindowInBounds failed:", err);
  }
};

const applyPreviewWindowSize = async (size: PreviewWindowSize) => {
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(size.width, size.height));
  await keepPreviewWindowInBounds();
};

export const resetPreviewWindowSize = async () => {
  await applyPreviewWindowSize(PREVIEW_DEFAULT_SIZE);
};

export const fitPreviewWindowToContent = async (
  contentEl: HTMLElement | null,
  viewportEl: HTMLElement | null,
) => {
  if (!viewportEl) {
    await resetPreviewWindowSize();
    return;
  }

  const maxSize = await getPreviewMaxSize();
  const chromeInsets = getPreviewChromeInsets(viewportEl);
  const targetWidth = Math.round(
    clampNumber(
      Math.max(
        PREVIEW_DEFAULT_SIZE.width,
        getWidestRenderableContent(contentEl, viewportEl) + chromeInsets.width,
      ),
      PREVIEW_SIZE_POLICY.minWidth,
      maxSize.width,
    ),
  );

  await applyPreviewWindowSize({
    width: targetWidth,
    height: Math.max(PREVIEW_DEFAULT_SIZE.height, Math.round(window.innerHeight)),
  });

  await waitForNextFrame();

  const nextChromeInsets = getPreviewChromeInsets(viewportEl);
  const targetHeight = Math.round(
    clampNumber(
      Math.max(
        PREVIEW_DEFAULT_SIZE.height,
        getTallestRenderableContent(contentEl, viewportEl) + nextChromeInsets.height,
      ),
      PREVIEW_SIZE_POLICY.minHeight,
      maxSize.height,
    ),
  );

  await applyPreviewWindowSize({
    width: targetWidth,
    height: targetHeight,
  });
};
