# Design2Code Roadmap

This roadmap is subordinate to [PROJECT_MEMORY.md](./PROJECT_MEMORY.md).
It sequences implementation phases without changing the project's two global memories.

## Phase 1: DOM + SVG Stability

Current focus.

- Raise end-to-end success rate for DOM/SVG based component cloning.
- Improve OCR-assisted scene extraction for charts and mixed UI.
- Reduce failures caused by empty scenes, timeout fallbacks, text overflow, and incorrect layering.
- Keep every step measurable through screenshot diff, layout checks, debug stats, and timeline replay.

## Phase 2: Canvas Fidelity

Required project milestone.

- Add a canvas-capable rendering branch without weakening the existing DOM/SVG path.
- Keep a semantic manifest for canvas scenes so repair and diff loops remain observable.
- Support chart and visualization cases that are better expressed through canvas or charting engines.
- Preserve the same project goal: visual 100% restoration as the first principle.

## Phase 3: Infographic Reconstruction

Planned after canvas support is stable.

- Target infographic-style components such as:
  - timeline cards
  - milestone panels
  - calendar + arrow + badge compositions
  - explanatory chart cards with callouts
  - poster-like data storytelling modules
- Use a hybrid strategy:
  - DOM for text-heavy cards and layout shells
  - SVG for arrows, connectors, icons, radar/donut/line/bar geometry where practical
  - Canvas for dense decorative effects or chart engines that benefit from rasterized drawing
- Add dedicated detection and repair rules for:
  - rotated labels versus vertical writing-mode
  - gradient/glow/crown/badge decorations
  - callout connectors and leader lines
  - soft shadow / glassmorphism / blur panels
  - multi-block narrative layouts rather than only standard chart frames

## Implementation Notes

- Every new phase must keep the pipeline compatible with the existing timeline, debug stats, exit conditions, and replay UI.
- New capabilities should be introduced by extension, not by replacing the stable DOM/SVG flow.
- Stable commits should stay shippable; experimental branches can validate ideas before merging.
