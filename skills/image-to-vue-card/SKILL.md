---
name: image-to-vue-card
description: Convert a UI screenshot into a Vue SFC card or panel component with a fixed-size clone-static workflow. Use when Codex needs to reproduce a visual design from an image as Vue code, especially when the output must preserve positioning, text boxes, layering, clipping, SVG/chart fidelity, iteration logs, stage screenshots, repair reports, debug adherence stats, and a preview timeline.
---

# Image To Vue Card

Project memory summary:

- See `PROJECT_MEMORY.md` for the single source of truth.
- Project goal: 100% recreate the UI reference into visual UI components across `dom` / `svg` / `canvas`.
- Program design principle: follow SOLID and preserve extension points for future render backends.

Follow this workflow:

1. Parse the input image into a `scene.json`-style structure before writing Vue code.
2. Generate a fixed-size Vue SFC with `data-artboard-root="true"` and stable `data-node-id` values for every scene node.
3. Render the component in the browser and save a stage snapshot:
   stage code, rendered screenshot, diff against target, diff against previous stage, metrics, repair report, debug stats.
4. Build a repair report from measurable issues:
   missing nodes, bbox offsets, text overflow, text mismatch, occlusion, alignment drift, layout overflow.
5. Repair only targeted nodes and keep untargeted areas stable.
6. Exit on success or one of the guardrails:
   max iterations, max duration, no progress, oscillation, repeated issue signatures, regression.
7. Append the task summary to `public/artifacts/timeline.json` only after the task finishes.

Keep visualization pages minimal:

- Use a grayscale-first palette with one subtle accent.
- Prefer spacing, thin borders, and clean typography over decoration.
- Show screenshots, delta summaries, and compact metrics.
- Keep code and detailed logs off the main preview surface.
