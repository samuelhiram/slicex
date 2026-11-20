// The money lane's header cell (left of the green chart, under the corner
// pad): "Plano de eventos" and icon buttons that act on the timeline
// itself — the rows' one (three equal rows + a height arrow) puts every
// event line back to its normal height in one click (one undo step). Short
// lanes keep the buttons and drop the title.
import * as React from "react";
import type { PlaylistCore } from "@slicex/canvas";
import { normalRowHeights, useAtDefaults } from "./ZoomPad";

export interface TimelineCellProps {
  core: PlaylistCore;
  /** The lines' normal height ("Alto normal"). */
  normalHeight: number;
  /** The default zoom (only read to share the pad's defaults hook). */
  defaultPxPerBeat: number;
}

export function TimelineCell({ core, normalHeight, defaultPxPerBeat }: TimelineCellProps) {
  const atDefaults = useAtDefaults(core, normalHeight, defaultPxPerBeat);
  return (
    <div
      className="fin-lanecell"
      role="group"
      aria-label="Plano de eventos"
      data-compact={core.metrics.overviewLaneHeight < 60 ? "true" : undefined}
    >
      <p className="fin-lanecell__title">Plano de eventos</p>
      <div className="fin-lanecell__actions">
        {/* Icon only: three equal rows with the height arrow beside them. */}
        <button
          type="button"
          className="fin-lanecell__button"
          aria-label="Todas las líneas a su alto normal"
          disabled={atDefaults.rows}
          title={`Alto normal: todas las líneas de evento a ${normalHeight} px`}
          onClick={() => normalRowHeights(core, normalHeight)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <rect x="8" y="3" width="9.5" height="3.6" rx="1" />
            <rect x="8" y="8.2" width="9.5" height="3.6" rx="1" />
            <rect x="8" y="13.4" width="9.5" height="3.6" rx="1" />
            <path d="M4 3.5v13M2.2 5.3 4 3.5l1.8 1.8M2.2 14.7 4 16.5l1.8-1.8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
