"use client";

/**
 * The simulation switch — bottom-right, and the desk's only live/simulated indicator.
 *
 * ## Why this one control carries the whole signal
 *
 * The stage headers are deliberately *not* marked, so a simulated run and a live run
 * look identical in the trace. That was a considered choice, and it puts the entire
 * burden of honesty on this control. So it is built to be unmistakable rather than
 * subtle: the state is carried three ways at once — the radio dot fills, the word
 * changes, and the colour changes — because colour alone is not an accessible signal.
 *
 * ## Opt-in, never automatic
 *
 * A failed live run surfaces its own error and does **not** flip this. Switching is
 * the operator's decision, made with the failure visible. Auto-falling back would
 * produce a desk that always looks populated while the real path is broken, which is
 * the one failure mode worth engineering against in a demo.
 *
 * ## Semantics
 *
 * Rendered as a radio per the design brief, but a single binary setting is a
 * `switch` to assistive tech, not a radio group (a radio group needs two or more
 * mutually exclusive named options, and would announce "1 of 1"). So the shape is a
 * radio and the role is `switch` — the look the brief asked for, the semantics that
 * actually describe it.
 */
import * as React from "react";
import { useDemo } from "@/lib/demo/state";

const TIP_ID = "simulation-toggle-tip";

export function SimulationToggle() {
  const { state, dispatch } = useDemo();
  const simulated = state.simulated;
  const [tipOpen, setTipOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Dismiss the tip on Escape and on a click outside, so it never becomes a modal
  // the operator has to hunt for a way out of.
  React.useEffect(() => {
    if (!tipOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTipOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setTipOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [tipOpen]);

  const toggle = () => {
    dispatch({ type: "set-simulated", simulated: !simulated });
    // The brief asks a click to raise the tip, so it opens whether turning on or off.
    setTipOpen(true);
  };

  return (
    <div ref={containerRef} className="fixed bottom-4 right-4 z-50 print:hidden">
      {tipOpen && (
        <div
          id={TIP_ID}
          role="note"
          className="absolute bottom-full right-0 mb-2 w-80 border border-edge-2 bg-panel p-3 shadow-lg"
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber">
              Simulation
            </p>
            <button
              type="button"
              onClick={() => setTipOpen(false)}
              aria-label="Dismiss simulation note"
              className="-mr-1 -mt-1 px-1 font-mono text-[11px] leading-none text-fg-faint hover:text-amber focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
            >
              ✕
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-fg-dim">
            Replays the recorded pipeline instead of calling the inference service.
            Steps, timings and outputs are fixed, so nothing on screen is live.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-dim">
            Use it when Vertex AI or the service is unreachable. A failed live run
            shows its own error and will not switch over on its own.
          </p>
        </div>
      )}

      <button
        type="button"
        role="switch"
        aria-checked={simulated}
        aria-describedby={tipOpen ? TIP_ID : undefined}
        onClick={toggle}
        onMouseEnter={() => setTipOpen(true)}
        className={[
          "flex min-h-11 items-center gap-2.5 border bg-panel px-3 py-2",
          "font-mono text-[10px] uppercase tracking-[0.16em]",
          "transition-colors duration-150 motion-reduce:transition-none",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber",
          simulated
            ? "border-amber/70 text-amber"
            : "border-edge-2 text-fg-faint hover:border-amber/60 hover:text-amber",
        ].join(" ")}
      >
        <span
          aria-hidden
          className={[
            "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border",
            simulated ? "border-amber" : "border-edge-2",
          ].join(" ")}
        >
          {simulated && <span className="h-1.5 w-1.5 rounded-full bg-amber" />}
        </span>
        <span>Simulation</span>
        <span className={simulated ? "text-amber" : "text-fg-faint"}>
          {simulated ? "on" : "off"}
        </span>
      </button>
    </div>
  );
}
