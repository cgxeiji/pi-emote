import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Config } from "./types.js";
import type { Animator } from "./animator.js";
import type { RenderedFrame } from "./renderer.js";

export interface OverlayDeps {
  animator: Animator;
  config: Config;
  getInfoLines: (width: number, avatarWidth: number, theme: any) => string[];
}

/** Build an avatar component for the passive top-right overlay. */
export function createImageOverlayFactory(deps: OverlayDeps) {
  return (tui: any, theme: any) => {
    const { animator, config } = deps;
    animator.setTui(tui);
    return {
      render(width: number): string[] {
        const frame = animator.getRenderedFrame();
        if (!frame) return [];

        const avatarWidth = frame.kind === "text" ? 8 : config.size;
        const infoLines = config.showInfo
          ? deps.getInfoLines(width, avatarWidth, theme)
          : [];
        const imageColumn = Math.max(0, width - avatarWidth);

        if (frame.kind === "image") {
          const rowCount = Math.max(frame.rows, infoLines.length);
          const lines: string[] = [];
          for (let row = 0; row < rowCount; row++) {
            const info = truncateToWidth(infoLines[row] ?? "", imageColumn, "…");
            const gap = " ".repeat(Math.max(0, imageColumn - visibleWidth(info)));
            let line = `${info}${gap}`;

            if (frame.cursorAdvances && row === rowCount - 1) {
              // iTerm2 advances the cursor and paints below its insertion row.
              // Emit it after every overlay row has been cleared, then move back
              // up to the first image row without changing the horizontal cell.
              if (rowCount > 1) line += `\x1b[${rowCount - 1}A`;
              line += frame.sequence;
            } else if (!frame.cursorAdvances && row === 0) {
              line += frame.sequence;
            } else {
              line += " ".repeat(avatarWidth);
            }
            lines.push(line);
          }
          return lines;
        }

        const avatarLines = frame.kind === "text" ? frame.lines : frame.lines.slice(0, frame.rows);
        const rowCount = Math.max(avatarLines.length, infoLines.length);
        return Array.from({ length: rowCount }, (_, row) => {
          const info = truncateToWidth(infoLines[row] ?? "", imageColumn, "…");
          const avatar = truncateToWidth(avatarLines[row] ?? "", avatarWidth, "");
          const avatarPad = Math.max(0, avatarWidth - visibleWidth(avatar));
          const centeredAvatar = `${" ".repeat(Math.floor(avatarPad / 2))}${avatar}${" ".repeat(Math.ceil(avatarPad / 2))}`;
          const gap = " ".repeat(Math.max(0, imageColumn - visibleWidth(info)));
          return `${info}${gap}${centeredAvatar}${" ".repeat(Math.max(0, width - imageColumn - avatarWidth))}`;
        });
      },
      invalidate() {},
      dispose() {
        animator.setTui(null);
      },
    };
  };
}
