export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type RenderMode = 'html' | 'svg' | 'canvas'
export type RenderPreference = 'auto' | 'svg' | 'canvas'
export type ExitReason =
  | 'success'
  | 'max_iterations'
  | 'max_duration'
  | 'no_progress'
  | 'oscillation_detected'
  | 'same_issue_repeated'
  | 'regression_detected'
  | 'model_error'
  | 'render_error'

export interface Frame {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

export interface ShadowStyle {
  x: number
  y: number
  blur: number
  color: string
}

export interface ClipSpec {
  enabled: boolean
  overflow?: 'visible' | 'hidden'
  radius?: number[]
}

export interface TextSpec {
  content: string
  fontFamily: string
  fontWeight: number
  fontSize: number
  lineHeight: number
  letterSpacing: number
  color: string
  align: 'left' | 'center' | 'right'
  wrap: 'nowrap' | 'normal'
  overflow: 'clip' | 'visible'
  direction?: 'horizontal' | 'vertical' | 'rotate-ccw' | 'rotate-cw'
  box: {
    width: number
    height: number
  }
}

export interface ChartPoint {
  x: number
  y: number
  value?: number
  label?: string
}

export interface CanvasChartSeries {
  name: string
  color: string
  fillColor?: string
  data: number[]
  points?: ChartPoint[]
  areaOpacity?: number
  lineDash?: number[]
}

export interface CanvasChartOverlay {
  type: 'step-line' | 'line' | 'leader-line'
  color: string
  dash?: number[]
  data?: number[]
  points?: ChartPoint[]
  dotRadius?: number
}

export interface CanvasChartSpec {
  kind:
    | 'grouped-bar'
    | 'stacked-bar'
    | 'line'
    | 'area'
    | 'radar'
    | 'donut'
    | 'pie'
    | 'scatter'
  width: number
  height: number
  plot: Frame
  categories: string[]
  min: number
  max: number
  step: number
  innerRadiusRatio?: number
  startAngle?: number
  legendItems?: Array<{
    name: string
    color: string
  }>
  series: CanvasChartSeries[]
  overlays?: CanvasChartOverlay[]
}

export interface SceneNode {
  id: string
  name?: string
  type: string
  render: RenderMode
  parentId: string | null
  frame: Frame
  zIndex: number
  opacity?: number
  clip?: ClipSpec
  style?: {
    fills?: string[]
    strokes?: string[]
    shadows?: ShadowStyle[]
    background?: string
  }
  text?: TextSpec
  svg?: {
    viewBox: string
    preserveAspectRatio?: string
  } | string
  canvas?: CanvasChartSpec
  notes?: string
}

export interface Constraint {
  type:
    | 'align-left'
    | 'align-center-x'
    | 'align-center-y'
    | 'align-top'
    | 'align-bottom'
    | 'inside-parent'
    | 'no-text-overflow'
  nodeId?: string
  nodes?: string[]
  parentId?: string
  value?: number
  tolerance?: number
}

export interface SceneDocument {
  version: string
  mode: 'clone-static'
  summary?: string
  source: {
    image: string
    width: number
    height: number
    dpr: number
  }
  artboard: {
    width: number
    height: number
    background: string
    clip: boolean
  }
  nodes: SceneNode[]
  constraints: Constraint[]
}

export interface ComponentResponse {
  component: string
  summary: string
  assumptions: string[]
}

export interface RenderedNodeSnapshot {
  nodeId: string
  rect: Frame
  scrollWidth: number
  clientWidth: number
  scrollHeight: number
  clientHeight: number
  textContent: string
  zIndex: number
  visible: boolean
  occluded: boolean
  fontSize: number
  lineHeight: number
}

export interface RenderCapture {
  screenshotPath: string
  domSnapshotPath: string
  nodes: RenderedNodeSnapshot[]
  renderHash: string
  layoutHash: string
}

export interface RepairIssue {
  issueId: string
  signature: string
  nodeId?: string
  type:
    | 'missing_node'
    | 'bbox_offset'
    | 'text_overflow'
    | 'text_mismatch'
    | 'occluded'
    | 'misaligned'
    | 'layout_overflow'
  severity: Severity
  description: string
  repair: string
  expected?: Record<string, number | string>
  actual?: Record<string, number | string>
}

export interface RepairIntent {
  issueId: string
  nodeId?: string
  changeClass: 'add' | 'modify'
  intentType:
    | 'add_node'
    | 'move_node'
    | 'resize_node'
    | 'change_text_box'
    | 'change_font_style'
    | 'change_z_index'
    | 'change_alignment'
    | 'change_clip'
  priority: Severity
  direction?: 'left' | 'right' | 'up' | 'down' | 'expand' | 'shrink'
  expectedDelta?: Partial<Record<'x' | 'y' | 'width' | 'height' | 'zIndex', number>>
  repair: string
}

export interface RepairReport {
  summary: string
  nextAction: string
  issues: RepairIssue[]
  intents: RepairIntent[]
}

export interface StageMetrics {
  visualSimilarity: number
  pixelDiffRatio: number
  globalVisualSimilarity: number
  focusedVisualSimilarity: number
  activeRegionCoverage: number
  overflowCount: number
  occlusionCount: number
  textMismatchCount: number
  missingNodeCount: number
  criticalIssueCount: number
  bboxErrorP95: number
  alignmentErrorP95: number
}

export interface StageDebugStats {
  overallAdherenceRate: number
  addExecutionRate: number
  addEffectiveRate: number
  modifyExecutionRate: number
  modifyEffectiveRate: number
  overEditCount: number
  regressionCount: number
  newIssueCount: number
}

export interface StageArtifact {
  index: number
  name: string
  directory: string
  componentPath: string
  screenshotPath: string
  diffTargetPath: string
  diffPrevPath?: string
  repairReportPath: string
  metricsPath: string
  debugPath: string
  domSnapshotPath: string
  componentSource: string
  render: RenderCapture
  repairReport: RepairReport
  metrics: StageMetrics
  renderMode: {
    preference: RenderPreference
    actual: RenderMode
  }
  debugStats?: StageDebugStats
  score: number
}

export interface TaskSummaryStage {
  index: number
  name: string
  status: 'running' | 'completed'
  screenshot?: string
  deltaSummary: string
  placeholderMessage?: string
  renderMode?: {
    preference: RenderPreference
    actual: RenderMode
  }
  metrics?: StageMetrics
  debug?: StageDebugStats
  hidden?: {
    code: string
    repairReport: string
    diffTarget: string
    diffPrev?: string
    domSnapshot: string
  }
}

export interface TaskTimelineSummary {
  taskId: string
  createdAt: string
  updatedAt: string
  status: 'running' | 'completed'
  inputImage: string
  finalComponent?: string
  exitReason?: ExitReason
  activeStepLabel?: string
  bestStageIndex: number
  finalStageIndex: number
  comparisonGroupId?: string
  comparisonGroupLabel?: string
  caseId?: string
  caseLabel?: string
  versionLabel?: string
  versionTag?: string
  branchKind?: 'dom-svg' | 'canvas' | 'adhoc'
  stages: TaskSummaryStage[]
}

export interface TimelineDocument {
  version: string
  tasks: TaskTimelineSummary[]
}

export interface TaskResult {
  taskId: string
  exitReason: ExitReason
  summary: TaskTimelineSummary
  bestStage: StageArtifact
  stages: StageArtifact[]
  metExpectation: boolean
  reasons: string[]
}
