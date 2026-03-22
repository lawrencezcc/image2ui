import fs from 'node:fs/promises'

import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import { ssim } from 'ssim.js'

import type {
  Constraint,
  RepairIntent,
  RepairIssue,
  RepairReport,
  RenderCapture,
  RenderedNodeSnapshot,
  SceneDocument,
  StageMetrics,
} from './types'
import { loadRawImageSampler, traceLineSeries } from './image-sampler'
import { hashValue, percentile } from './utils'

async function toSizedPngBuffer(imagePath: string, width: number, height: number) {
  return sharp(imagePath)
    .resize({
      width,
      height,
      fit: 'fill',
    })
    .png()
    .toBuffer()
}

function sampleBackground(png: PNG) {
  const samplePoints = [
    [0, 0],
    [png.width - 1, 0],
    [0, png.height - 1],
    [png.width - 1, png.height - 1],
    [Math.floor(png.width / 2), 0],
    [Math.floor(png.width / 2), png.height - 1],
  ]
  const totals = { r: 0, g: 0, b: 0 }

  for (const [x, y] of samplePoints) {
    const index = (y * png.width + x) * 4
    totals.r += png.data[index] ?? 0
    totals.g += png.data[index + 1] ?? 0
    totals.b += png.data[index + 2] ?? 0
  }

  const count = samplePoints.length
  return {
    r: totals.r / count,
    g: totals.g / count,
    b: totals.b / count,
  }
}

function colorDistance(
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number },
) {
  return Math.sqrt(
    (left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2,
  )
}

function computeForegroundBounds(png: PNG, threshold = 18) {
  const background = sampleBackground(png)
  let minX = png.width
  let minY = png.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (y * png.width + x) * 4
      const alpha = png.data[index + 3] ?? 0
      if (alpha < 16) {
        continue
      }

      const pixel = {
        r: png.data[index] ?? 0,
        g: png.data[index + 1] ?? 0,
        b: png.data[index + 2] ?? 0,
      }

      if (colorDistance(pixel, background) <= threshold) {
        continue
      }

      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < 0 || maxY < 0) {
    return undefined
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

function mergeBounds(
  boundsList: Array<{ x: number; y: number; width: number; height: number } | undefined>,
  width: number,
  height: number,
) {
  const visibleBounds = boundsList.filter(Boolean) as Array<{
    x: number
    y: number
    width: number
    height: number
  }>

  if (!visibleBounds.length) {
    return { x: 0, y: 0, width, height }
  }

  const minX = Math.max(0, Math.min(...visibleBounds.map((bounds) => bounds.x)) - 24)
  const minY = Math.max(0, Math.min(...visibleBounds.map((bounds) => bounds.y)) - 24)
  const maxX = Math.min(
    width,
    Math.max(...visibleBounds.map((bounds) => bounds.x + bounds.width)) + 24,
  )
  const maxY = Math.min(
    height,
    Math.max(...visibleBounds.map((bounds) => bounds.y + bounds.height)) + 24,
  )

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function cropPng(
  png: PNG,
  bounds: { x: number; y: number; width: number; height: number },
) {
  const cropped = new PNG({ width: bounds.width, height: bounds.height })

  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const sourceIndex = ((bounds.y + y) * png.width + (bounds.x + x)) * 4
      const targetIndex = (y * bounds.width + x) * 4
      cropped.data[targetIndex] = png.data[sourceIndex] ?? 0
      cropped.data[targetIndex + 1] = png.data[sourceIndex + 1] ?? 0
      cropped.data[targetIndex + 2] = png.data[sourceIndex + 2] ?? 0
      cropped.data[targetIndex + 3] = png.data[sourceIndex + 3] ?? 0
    }
  }

  return cropped
}

function toGrayscaleData(png: PNG) {
  const data = new Uint8ClampedArray(png.width * png.height * 4)

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const sourceIndex = (y * png.width + x) * 4
      const targetIndex = sourceIndex
      const value = Math.round(
        (png.data[sourceIndex] ?? 0) * 0.299 +
          (png.data[sourceIndex + 1] ?? 0) * 0.587 +
          (png.data[sourceIndex + 2] ?? 0) * 0.114,
      )

      data[targetIndex] = value
      data[targetIndex + 1] = value
      data[targetIndex + 2] = value
      data[targetIndex + 3] = 255
    }
  }

  return {
    data,
    width: png.width,
    height: png.height,
  }
}

function buildForegroundMask(png: PNG, threshold = 18) {
  const background = sampleBackground(png)
  const mask = new Uint8Array(png.width * png.height)

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (y * png.width + x) * 4
      const alpha = png.data[index + 3] ?? 0
      if (alpha < 16) {
        continue
      }

      const pixel = {
        r: png.data[index] ?? 0,
        g: png.data[index + 1] ?? 0,
        b: png.data[index + 2] ?? 0,
      }

      if (colorDistance(pixel, background) > threshold) {
        mask[y * png.width + x] = 1
      }
    }
  }

  return mask
}

function computeMaskIoU(referenceMask: Uint8Array, candidateMask: Uint8Array) {
  let intersection = 0
  let union = 0

  for (let index = 0; index < referenceMask.length; index += 1) {
    const ref = referenceMask[index] ?? 0
    const cand = candidateMask[index] ?? 0
    if (ref || cand) {
      union += 1
    }
    if (ref && cand) {
      intersection += 1
    }
  }

  if (union === 0) {
    return 1
  }

  return intersection / union
}

function buildEdgeMask(png: PNG, threshold = 36) {
  const edgeMask = new Uint8Array(png.width * png.height)

  for (let y = 1; y < png.height - 1; y += 1) {
    for (let x = 1; x < png.width - 1; x += 1) {
      const index = (y * png.width + x) * 4
      const rightIndex = (y * png.width + (x + 1)) * 4
      const downIndex = ((y + 1) * png.width + x) * 4
      const luma = (png.data[index] ?? 0) * 0.299 + (png.data[index + 1] ?? 0) * 0.587 + (png.data[index + 2] ?? 0) * 0.114
      const rightLuma =
        (png.data[rightIndex] ?? 0) * 0.299 +
        (png.data[rightIndex + 1] ?? 0) * 0.587 +
        (png.data[rightIndex + 2] ?? 0) * 0.114
      const downLuma =
        (png.data[downIndex] ?? 0) * 0.299 +
        (png.data[downIndex + 1] ?? 0) * 0.587 +
        (png.data[downIndex + 2] ?? 0) * 0.114
      const gradient = Math.abs(luma - rightLuma) + Math.abs(luma - downLuma)

      if (gradient >= threshold) {
        edgeMask[y * png.width + x] = 1
      }
    }
  }

  return edgeMask
}

function computeEdgeSimilarity(referenceMask: Uint8Array, candidateMask: Uint8Array) {
  let intersection = 0
  let union = 0

  for (let index = 0; index < referenceMask.length; index += 1) {
    const ref = referenceMask[index] ?? 0
    const cand = candidateMask[index] ?? 0
    if (ref || cand) {
      union += 1
    }
    if (ref && cand) {
      intersection += 1
    }
  }

  if (union === 0) {
    return 1
  }

  return intersection / union
}

function computeColorSimilarity(reference: PNG, candidate: PNG, focusMask: Uint8Array) {
  let compared = 0
  let totalDistance = 0

  for (let index = 0; index < focusMask.length; index += 1) {
    if (!focusMask[index]) {
      continue
    }

    const rgbaIndex = index * 4
    const left = {
      r: reference.data[rgbaIndex] ?? 0,
      g: reference.data[rgbaIndex + 1] ?? 0,
      b: reference.data[rgbaIndex + 2] ?? 0,
    }
    const right = {
      r: candidate.data[rgbaIndex] ?? 0,
      g: candidate.data[rgbaIndex + 1] ?? 0,
      b: candidate.data[rgbaIndex + 2] ?? 0,
    }

    compared += 1
    totalDistance += colorDistance(left, right)
  }

  if (!compared) {
    return 1
  }

  const averageDistance = totalDistance / compared
  return Math.max(0, 1 - averageDistance / 255)
}

function extractTraceAtX(points: Array<{ x: number; y: number }>, targetX: number) {
  if (!points.length) {
    return undefined
  }

  const nearest = points.reduce(
    (best, point) => {
      const distance = Math.abs(point.x - targetX)
      if (!best || distance < best.distance) {
        return {
          point,
          distance,
        }
      }

      return best
    },
    undefined as { point: { x: number; y: number }; distance: number } | undefined,
  )

  return nearest?.distance !== undefined && nearest.distance <= 0.08 ? nearest.point.y : undefined
}

function compareTraceSeries(
  referencePoints: Array<{ x: number; y: number }>,
  candidatePoints: Array<{ x: number; y: number }>,
) {
  if (referencePoints.length < 8 || candidatePoints.length < 8) {
    return undefined
  }

  const samples = 32
  const referenceSeries: number[] = []
  const candidateSeries: number[] = []

  for (let index = 0; index < samples; index += 1) {
    const x = index / Math.max(samples - 1, 1)
    const left = extractTraceAtX(referencePoints, x)
    const right = extractTraceAtX(candidatePoints, x)
    if (typeof left !== 'number' || typeof right !== 'number') {
      continue
    }

    referenceSeries.push(left)
    candidateSeries.push(right)
  }

  if (referenceSeries.length < 8 || candidateSeries.length < 8) {
    return undefined
  }

  let squaredError = 0
  let trendMatches = 0
  let trendSamples = 0

  for (let index = 0; index < referenceSeries.length; index += 1) {
    const delta = Math.abs(referenceSeries[index] - candidateSeries[index])
    squaredError += delta * delta

    if (index === 0) {
      continue
    }

    const leftSlope = referenceSeries[index] - referenceSeries[index - 1]
    const rightSlope = candidateSeries[index] - candidateSeries[index - 1]
    trendSamples += 1
    if (Math.sign(leftSlope) === Math.sign(rightSlope) || Math.abs(leftSlope - rightSlope) < 0.02) {
      trendMatches += 1
    }
  }

  const rmse = Math.sqrt(squaredError / referenceSeries.length)
  const shapeScore = Math.max(0, 1 - rmse / 0.4)
  const trendScore = trendSamples > 0 ? trendMatches / trendSamples : 1
  return shapeScore * 0.7 + trendScore * 0.3
}

async function computeChartShapeSimilarity(
  scene: SceneDocument,
  referenceImagePath: string,
  candidateImagePath: string,
) {
  const canvasChartNode = scene.nodes.find((node) =>
    Boolean(node.canvas && (node.canvas.kind === 'line' || node.canvas.kind === 'area')),
  )
  const svgChartNode = scene.nodes.find(
    (node) =>
      node.render === 'svg' &&
      typeof node.svg === 'string' &&
      (node.svg.includes('<polyline') || node.svg.includes('<path')) &&
      !node.svg.includes('<rect'),
  )

  const chartNode = canvasChartNode ?? svgChartNode
  if (!chartNode) {
    return undefined
  }

  const seriesColors =
    canvasChartNode?.canvas?.series.map((series) => series.color) ??
    scene.nodes
      .filter((node) => node.type === 'swatch')
      .map((node) => node.style?.background ?? node.style?.fills?.[0])
      .filter((value): value is string => Boolean(value))

  if (!seriesColors.length) {
    return undefined
  }

  const referenceSampler = await loadRawImageSampler(referenceImagePath)
  const candidateSampler = await loadRawImageSampler(candidateImagePath)
  const scores = seriesColors
    .map((color) => {
      const referenceTrace = traceLineSeries(referenceSampler, chartNode.frame, color, 96)
      const candidateTrace = traceLineSeries(candidateSampler, chartNode.frame, color, 96)
      return compareTraceSeries(referenceTrace, candidateTrace)
    })
    .filter((value): value is number => typeof value === 'number')

  if (!scores.length) {
    return undefined
  }

  return scores.reduce((sum, value) => sum + value, 0) / scores.length
}

async function compareImages(referencePath: string, candidatePath: string, diffPath: string) {
  const metadata = await sharp(referencePath).metadata()
  const width = metadata.width ?? 1
  const height = metadata.height ?? 1
  const [referenceBuffer, candidateBuffer] = await Promise.all([
    toSizedPngBuffer(referencePath, width, height),
    toSizedPngBuffer(candidatePath, width, height),
  ])

  const reference = PNG.sync.read(referenceBuffer)
  const candidate = PNG.sync.read(candidateBuffer)
  const diff = new PNG({ width, height })
  const diffPixels = pixelmatch(reference.data, candidate.data, diff.data, width, height, {
    threshold: 0.12,
  })

  const focusBounds = mergeBounds(
    [computeForegroundBounds(reference), computeForegroundBounds(candidate)],
    width,
    height,
  )
  const focusedReference = cropPng(reference, focusBounds)
  const focusedCandidate = cropPng(candidate, focusBounds)
  const focusedDiff = new PNG({ width: focusBounds.width, height: focusBounds.height })
  const focusedDiffPixels = pixelmatch(
    focusedReference.data,
    focusedCandidate.data,
    focusedDiff.data,
    focusBounds.width,
    focusBounds.height,
    {
      threshold: 0.12,
    },
  )

  await fs.writeFile(diffPath, PNG.sync.write(diff))

  const globalVisualSimilarity = 1 - diffPixels / (width * height)
  const focusedVisualSimilarity =
    1 - focusedDiffPixels / (focusBounds.width * focusBounds.height)
  const structuralSimilarity = ssim(
    toGrayscaleData(focusedReference),
    toGrayscaleData(focusedCandidate),
  ).mssim
  const referenceForegroundMask = buildForegroundMask(focusedReference)
  const candidateForegroundMask = buildForegroundMask(focusedCandidate)
  const foregroundIoU = computeMaskIoU(referenceForegroundMask, candidateForegroundMask)
  const edgeSimilarity = computeEdgeSimilarity(
    buildEdgeMask(focusedReference),
    buildEdgeMask(focusedCandidate),
  )
  const focusMask = new Uint8Array(referenceForegroundMask.length)
  for (let index = 0; index < focusMask.length; index += 1) {
    focusMask[index] =
      (referenceForegroundMask[index] ?? 0) || (candidateForegroundMask[index] ?? 0) ? 1 : 0
  }
  const colorSimilarity = computeColorSimilarity(focusedReference, focusedCandidate, focusMask)
  const activeRegionCoverage = (focusBounds.width * focusBounds.height) / (width * height)
  const visualSimilarity =
    globalVisualSimilarity * 0.1 +
    focusedVisualSimilarity * 0.28 +
    structuralSimilarity * 0.24 +
    foregroundIoU * 0.16 +
    edgeSimilarity * 0.1 +
    colorSimilarity * 0.12

  return {
    width,
    height,
    diffPixels,
    pixelDiffRatio: diffPixels / (width * height),
    visualSimilarity,
    globalVisualSimilarity,
    focusedVisualSimilarity,
    structuralSimilarity,
    foregroundIoU,
    edgeSimilarity,
    colorSimilarity,
    activeRegionCoverage,
  }
}

function buildIssue(
  issue: Omit<RepairIssue, 'issueId' | 'signature'> & {
    signature: string
  },
): RepairIssue {
  return {
    issueId: hashValue(issue.signature).slice(0, 12),
    signature: issue.signature,
    nodeId: issue.nodeId,
    type: issue.type,
    severity: issue.severity,
    description: issue.description,
    repair: issue.repair,
    expected: issue.expected,
    actual: issue.actual,
  }
}

function findPrimaryVisualNode(scene: SceneDocument) {
  const chartNodes = scene.nodes
    .filter(
      (node) =>
        node.canvas ||
        node.type.includes('chart') ||
        (node.render === 'svg' && (node.type === 'svg' || node.type === 'path')),
    )
    .sort(
      (left, right) =>
        right.frame.width * right.frame.height - left.frame.width * left.frame.height,
    )

  if (chartNodes.length) {
    return chartNodes[0]
  }

  return (
    [...scene.nodes]
      .filter((node) => node.id !== 'card')
      .sort(
        (left, right) =>
          right.frame.width * right.frame.height - left.frame.width * left.frame.height,
      )[0] ?? scene.nodes[0]
  )
}

function intentFromIssue(issue: RepairIssue): RepairIntent {
  switch (issue.type) {
    case 'missing_node':
      return {
        issueId: issue.issueId,
        nodeId: issue.nodeId,
        changeClass: 'add',
        intentType: 'add_node',
        priority: issue.severity,
        repair: issue.repair,
      }
    case 'text_overflow':
      return {
        issueId: issue.issueId,
        nodeId: issue.nodeId,
        changeClass: 'modify',
        intentType: 'change_text_box',
        priority: issue.severity,
        direction: 'expand',
        repair: issue.repair,
      }
    case 'occluded':
      return {
        issueId: issue.issueId,
        nodeId: issue.nodeId,
        changeClass: 'modify',
        intentType: 'change_z_index',
        priority: issue.severity,
        repair: issue.repair,
      }
    case 'misaligned':
      return {
        issueId: issue.issueId,
        nodeId: issue.nodeId,
        changeClass: 'modify',
        intentType: 'change_alignment',
        priority: issue.severity,
        repair: issue.repair,
      }
    case 'layout_overflow':
      return {
        issueId: issue.issueId,
        nodeId: issue.nodeId,
        changeClass: 'modify',
        intentType: 'change_clip',
        priority: issue.severity,
        repair: issue.repair,
      }
    case 'color_mismatch':
      return {
        issueId: issue.issueId,
        nodeId: issue.nodeId,
        changeClass: 'modify',
        intentType: 'change_color_style',
        priority: issue.severity,
        repair: issue.repair,
      }
    case 'chart_shape_mismatch':
    case 'stage_regression':
      return {
        issueId: issue.issueId,
        nodeId: issue.nodeId,
        changeClass: 'modify',
        intentType: 'change_chart_geometry',
        priority: issue.severity,
        repair: issue.repair,
      }
    default:
      return {
        issueId: issue.issueId,
        nodeId: issue.nodeId,
        changeClass: 'modify',
        intentType:
          issue.expected?.width || issue.expected?.height ? 'resize_node' : 'move_node',
        priority: issue.severity,
        repair: issue.repair,
      }
  }
}

function createSnapshotMap(nodes: RenderedNodeSnapshot[]) {
  return new Map(nodes.map((node) => [node.nodeId, node]))
}

function createConstraintIssue(
  nodeId: string | undefined,
  description: string,
  repair: string,
  severity: RepairIssue['severity'],
  signature: string,
): RepairIssue {
  return buildIssue({
    signature,
    nodeId,
    type: 'misaligned',
    severity,
    description,
    repair,
  })
}

function evaluateConstraints(
  constraints: Constraint[],
  snapshots: Map<string, RenderedNodeSnapshot>,
): RepairIssue[] {
  const issues: RepairIssue[] = []

  for (const constraint of constraints) {
    const tolerance = constraint.tolerance ?? 1

    if (constraint.type === 'inside-parent' && constraint.nodeId && constraint.parentId) {
      const node = snapshots.get(constraint.nodeId)
      const parent = snapshots.get(constraint.parentId)
      if (!node || !parent) {
        continue
      }

      const overflow =
        node.rect.x < parent.rect.x - tolerance ||
        node.rect.y < parent.rect.y - tolerance ||
        node.rect.x + node.rect.width > parent.rect.x + parent.rect.width + tolerance ||
        node.rect.y + node.rect.height > parent.rect.y + parent.rect.height + tolerance

      if (overflow) {
        issues.push(
          buildIssue({
            signature: `layout-overflow:${constraint.nodeId}:${constraint.parentId}`,
            nodeId: constraint.nodeId,
            type: 'layout_overflow',
            severity: 'high',
            description: `${constraint.nodeId} 超出父容器 ${constraint.parentId} 的可见区域`,
            repair: `保持 ${constraint.nodeId} 在 ${constraint.parentId} 内部，必要时调整位置、尺寸或裁切。`,
          }),
        )
      }
      continue
    }

    if (!constraint.nodes?.length) {
      continue
    }

    if (constraint.type === 'no-text-overflow') {
      continue
    }

    const liveNodes = constraint.nodes.map((nodeId) => snapshots.get(nodeId)).filter(Boolean) as RenderedNodeSnapshot[]
    if (liveNodes.length < 2) {
      continue
    }

    const values =
      constraint.type === 'align-left'
        ? liveNodes.map((node) => node.rect.x)
        : constraint.type === 'align-top'
          ? liveNodes.map((node) => node.rect.y)
          : constraint.type === 'align-bottom'
            ? liveNodes.map((node) => node.rect.y + node.rect.height)
            : constraint.type === 'align-center-x'
              ? liveNodes.map((node) => node.rect.x + node.rect.width / 2)
              : liveNodes.map((node) => node.rect.y + node.rect.height / 2)

    const min = Math.min(...values)
    const max = Math.max(...values)

    if (max - min > tolerance) {
      issues.push(
        createConstraintIssue(
          constraint.nodes[0],
          `约束 ${constraint.type} 误差为 ${(max - min).toFixed(1)}px`,
          `按 ${constraint.type} 重新对齐相关节点，误差控制在 ${tolerance}px 内。`,
          max - min > tolerance * 2 ? 'high' : 'medium',
          `constraint:${constraint.type}:${constraint.nodes.join(',')}`,
        ),
      )
    }
  }

  return issues
}

function createChildNodeSet(scene: SceneDocument) {
  const childNodeIds = new Set<string>()

  for (const node of scene.nodes) {
    if (node.parentId) {
      childNodeIds.add(node.parentId)
    }
  }

  return childNodeIds
}

export async function analyzeStage(options: {
  scene: SceneDocument
  referenceImagePath: string
  render: RenderCapture
  diffTargetPath: string
  diffPrevPath?: string
  previousScreenshotPath?: string
  previousMetrics?: StageMetrics
}) {
  const comparison = await compareImages(
    options.referenceImagePath,
    options.render.screenshotPath,
    options.diffTargetPath,
  )

  let previousComparison:
    | Awaited<ReturnType<typeof compareImages>>
    | undefined
  let previousChartShapeSimilarity: number | undefined
  if (options.diffPrevPath && options.previousScreenshotPath) {
    previousComparison = await compareImages(
      options.previousScreenshotPath,
      options.render.screenshotPath,
      options.diffPrevPath,
    )
    previousChartShapeSimilarity = await computeChartShapeSimilarity(
      options.scene,
      options.previousScreenshotPath,
      options.render.screenshotPath,
    )
  }

  const chartShapeSimilarity = await computeChartShapeSimilarity(
    options.scene,
    options.referenceImagePath,
    options.render.screenshotPath,
  )

  const issues: RepairIssue[] = []
  const bboxErrors: number[] = []
  const snapshots = createSnapshotMap(options.render.nodes)
  const parentNodeIds = createChildNodeSet(options.scene)
  const primaryVisualNode = findPrimaryVisualNode(options.scene)

  for (const node of options.scene.nodes) {
    const snapshot = snapshots.get(node.id)

    if (!snapshot) {
      issues.push(
        buildIssue({
          signature: `missing:${node.id}`,
          nodeId: node.id,
          type: 'missing_node',
          severity: node.type === 'text' ? 'critical' : 'high',
          description: `节点 ${node.id} 缺失，页面中没有找到对应元素。`,
          repair: `补回节点 ${node.id}，保留原始层级、尺寸和位置。`,
        }),
      )
      continue
    }

    const xError = Math.abs(snapshot.rect.x - node.frame.x)
    const yError = Math.abs(snapshot.rect.y - node.frame.y)
    const widthError = Math.abs(snapshot.rect.width - node.frame.width)
    const heightError = Math.abs(snapshot.rect.height - node.frame.height)
    const maxError = Math.max(xError, yError, widthError, heightError)
    bboxErrors.push(maxError)

    if (maxError > 2) {
      issues.push(
        buildIssue({
          signature: `bbox:${node.id}:${xError}:${yError}:${widthError}:${heightError}`,
          nodeId: node.id,
          type: 'bbox_offset',
          severity: maxError > 12 ? 'high' : 'medium',
          description: `${node.id} 与目标框偏差过大，最大误差 ${maxError.toFixed(1)}px。`,
          repair: `校正 ${node.id} 的位置与尺寸，使其贴近 scene 中的 frame。`,
          expected: {
            x: node.frame.x,
            y: node.frame.y,
            width: node.frame.width,
            height: node.frame.height,
          },
          actual: {
            x: snapshot.rect.x,
            y: snapshot.rect.y,
            width: snapshot.rect.width,
            height: snapshot.rect.height,
          },
        }),
      )
    }

    let hasOverflow = false
    if (node.text) {
      const isRotatedText =
        node.text.direction === 'rotate-ccw' || node.text.direction === 'rotate-cw'
      hasOverflow =
        snapshot.scrollWidth > snapshot.clientWidth + 1 ||
        snapshot.scrollHeight > snapshot.clientHeight + 1

      if (
        isRotatedText &&
        maxError <= 2 &&
        snapshot.textContent === node.text.content.trim()
      ) {
        hasOverflow = false
      }

      if (hasOverflow) {
        issues.push(
          buildIssue({
            signature: `overflow:${node.id}`,
            nodeId: node.id,
            type: 'text_overflow',
            severity: 'critical',
            description: `${node.id} 存在文本溢出或裁切。`,
            repair: `扩大文本盒子或调整字号/行高，确保 ${node.id} 不溢出。`,
          }),
        )
      }

      if (snapshot.textContent !== node.text.content.trim()) {
        issues.push(
          buildIssue({
            signature: `text:${node.id}:${snapshot.textContent}`,
            nodeId: node.id,
            type: 'text_mismatch',
            severity: 'high',
            description: `${node.id} 的文本内容与规划不一致。`,
            repair: `修正 ${node.id} 的文本内容，确保与 scene 一致。`,
            expected: {
              content: node.text.content,
            },
            actual: {
              content: snapshot.textContent,
            },
          }),
        )
      }
    }

    const isStableTextNode =
      node.type === 'text' &&
      snapshot.textContent === node.text?.content.trim() &&
      maxError <= 2 &&
      !hasOverflow

    const shouldCheckOcclusion =
      !parentNodeIds.has(node.id) &&
      node.type !== 'frame' &&
      node.type !== 'group' &&
      !isStableTextNode

    if (shouldCheckOcclusion && snapshot.occluded) {
      issues.push(
        buildIssue({
          signature: `occluded:${node.id}`,
          nodeId: node.id,
          type: 'occluded',
          severity: 'high',
          description: `${node.id} 被其他元素遮挡。`,
          repair: `调整 ${node.id} 与相关元素的层级或位置，解除遮挡。`,
        }),
      )
    }
  }

  const constraintIssues = evaluateConstraints(options.scene.constraints, snapshots)
  issues.push(...constraintIssues)

  if (
    typeof chartShapeSimilarity === 'number' &&
    chartShapeSimilarity < 0.82 &&
    primaryVisualNode
  ) {
    issues.push(
      buildIssue({
        signature: `chart-shape:${primaryVisualNode.id}`,
        nodeId: primaryVisualNode.id,
        type: 'chart_shape_mismatch',
        severity: chartShapeSimilarity < 0.6 ? 'critical' : 'high',
        description: `图表主趋势与原图差异明显，当前图形相似度为 ${(chartShapeSimilarity * 100).toFixed(1)}%。`,
        repair: `重新校正 ${primaryVisualNode.id} 的图表几何，优先修复折线/面积/雷达等主 marks 的走势、拐点、峰谷位置和相对波动幅度，使其更贴近原图。`,
      }),
    )
  }

  if (
    previousComparison &&
    options.previousMetrics &&
    primaryVisualNode &&
    comparison.visualSimilarity <= options.previousMetrics.visualSimilarity + 0.002 &&
    previousComparison.structuralSimilarity < 0.78 &&
    (
      typeof previousChartShapeSimilarity !== 'number' ||
      previousChartShapeSimilarity < 0.62
    )
  ) {
    issues.push(
      buildIssue({
        signature: `stage-regression:${primaryVisualNode.id}:${Math.round(previousComparison.structuralSimilarity * 100)}`,
        nodeId: primaryVisualNode.id,
        type: 'stage_regression',
        severity:
          previousComparison.structuralSimilarity < 0.6 ||
          (typeof previousChartShapeSimilarity === 'number' && previousChartShapeSimilarity < 0.45)
            ? 'critical'
            : 'high',
        description:
          `与上一阶段相比，主视觉结构变化过大但目标相似度没有提升。当前对上一阶段的结构相似度 ${(previousComparison.structuralSimilarity * 100).toFixed(1)}%` +
          (typeof previousChartShapeSimilarity === 'number'
            ? `，走势相似度 ${(previousChartShapeSimilarity * 100).toFixed(1)}%。`
            : '。'),
        repair:
          `避免继续沿错误方向漂移，重新校正 ${primaryVisualNode.id} 的主图形布局与走势；若本轮变更导致趋势翻转、系列错位或局部镜像，优先回退到更接近上一阶段且更接近原图的几何。`,
      }),
    )
  }

  if (comparison.colorSimilarity < 0.82 && primaryVisualNode) {
    issues.push(
      buildIssue({
        signature: `color-mismatch:${primaryVisualNode.id}`,
        nodeId: primaryVisualNode.id,
        type: 'color_mismatch',
        severity: comparison.colorSimilarity < 0.7 ? 'high' : 'medium',
        description: `关键前景颜色与原图存在明显色差，当前颜色相似度为 ${(comparison.colorSimilarity * 100).toFixed(1)}%。`,
        repair: `重新校准 ${primaryVisualNode.id} 及相关图例/主图形的颜色，优先贴近原图的主色、辅助色和透明度，不要只保持语义接近。`,
      }),
    )
  }

  if (
    issues.length === 0 &&
    (comparison.structuralSimilarity < 0.78 || comparison.focusedVisualSimilarity < 0.9)
  ) {
    issues.push(
      buildIssue({
        signature: `visual-mismatch:${primaryVisualNode?.id ?? 'artboard'}`,
        nodeId: primaryVisualNode?.id,
        type: 'visual_mismatch',
        severity:
          comparison.structuralSimilarity < 0.68 || comparison.focusedVisualSimilarity < 0.84
            ? 'high'
            : 'medium',
        description: `虽然节点级约束基本满足，但整体视觉结构仍与原图不一致。当前结构相似度 ${(comparison.structuralSimilarity * 100).toFixed(1)}%，聚焦相似度 ${(comparison.focusedVisualSimilarity * 100).toFixed(1)}%。`,
        repair: `保持已正确的文本与布局节点不变，重点调整 ${primaryVisualNode?.id ?? '主要内容区域'} 的局部几何、间距、线条或留白，使整体视觉结构更贴近原图。`,
      }),
    )
  }

  const metrics: StageMetrics = {
    visualSimilarity:
      typeof chartShapeSimilarity === 'number'
        ? comparison.visualSimilarity * 0.72 + chartShapeSimilarity * 0.28
        : comparison.visualSimilarity,
    pixelDiffRatio: comparison.pixelDiffRatio,
    globalVisualSimilarity: comparison.globalVisualSimilarity,
    focusedVisualSimilarity: comparison.focusedVisualSimilarity,
    structuralSimilarity: comparison.structuralSimilarity,
    foregroundIoU: comparison.foregroundIoU,
    edgeSimilarity: comparison.edgeSimilarity,
    colorSimilarity: comparison.colorSimilarity,
    chartShapeSimilarity,
    previousStageVisualSimilarity: previousComparison?.visualSimilarity,
    previousStageStructuralSimilarity: previousComparison?.structuralSimilarity,
    previousStageColorSimilarity: previousComparison?.colorSimilarity,
    previousStageChartShapeSimilarity: previousChartShapeSimilarity,
    activeRegionCoverage: comparison.activeRegionCoverage,
    overflowCount: issues.filter((issue) => issue.type === 'text_overflow').length,
    occlusionCount: issues.filter((issue) => issue.type === 'occluded').length,
    textMismatchCount: issues.filter((issue) => issue.type === 'text_mismatch').length,
    missingNodeCount: issues.filter((issue) => issue.type === 'missing_node').length,
    criticalIssueCount: issues.filter((issue) => issue.severity === 'critical').length,
    bboxErrorP95: percentile(bboxErrors, 0.95),
    alignmentErrorP95: percentile(
      constraintIssues
        .map((issue) => Number.parseFloat(issue.description.match(/([0-9.]+)px/)?.[1] ?? '0'))
        .filter((value) => !Number.isNaN(value)),
      0.95,
    ),
  }

  const report: RepairReport = {
    summary:
      issues.length > 0
        ? `发现 ${issues.length} 个问题，优先处理 ${metrics.criticalIssueCount} 个严重问题。`
        : '当前阶段未检测到需要修复的问题。',
    nextAction:
      metrics.criticalIssueCount > 0
        ? 'repair-critical-first'
        : issues.length > 0
          ? 'repair-high-priority'
          : 'stop',
    issues,
    intents: issues.map(intentFromIssue),
  }

  return {
    metrics,
    repairReport: report,
  }
}
