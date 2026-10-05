/** Translate layout values from the first, unreleased overlay prototype. */
export function applyLegacyLayout(merged: Record<string, any>, layer: Record<string, any>): void {
  if (layer.position === undefined && layer.layout !== undefined) {
    if (layer.layout === "topRightOverlay") {
      merged.position = "topRight";
      if (layer.showInfo === undefined) merged.showInfo = false;
    } else if (layer.layout === "widget") {
      merged.position = "aboveEditor";
      if (layer.showInfo === undefined) merged.showInfo = true;
    }
  }
  delete merged.layout;
}
