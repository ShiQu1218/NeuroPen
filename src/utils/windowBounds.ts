import { availableMonitors } from "@tauri-apps/api/window";

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const clampToMonitorBounds = async (
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const monitors = await availableMonitors();
  if (monitors.length === 0) {
    return { x, y };
  }
  const targetMonitor =
    monitors.find(
      (monitor) =>
        x >= monitor.position.x &&
        x <= monitor.position.x + monitor.size.width &&
        y >= monitor.position.y &&
        y <= monitor.position.y + monitor.size.height,
    ) ?? monitors[0];
  const minX = targetMonitor.position.x;
  const minY = targetMonitor.position.y;
  const maxX = targetMonitor.position.x + targetMonitor.size.width - width;
  const maxY = targetMonitor.position.y + targetMonitor.size.height - height;
  return {
    x: Math.round(clampNumber(x, minX, Math.max(minX, maxX))),
    y: Math.round(clampNumber(y, minY, Math.max(minY, maxY))),
  };
};
