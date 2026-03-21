import fs from 'node:fs/promises'

import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import sharp from 'sharp'

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
  const activeRegionCoverage = (focusBounds.width * focusBounds.height) / (width * height)
  const visualSimilarity = globalVisualSimilarity * 0.3 + focusedVisualSimilarity * 0.7

  return {
    width,
    height,
    diffPixels,
    pixelDiffRatio: diffPixels / (width * height),
    visualSimilarity,
    globalVisualSimilarity,
    focusedVisualSimilarity,
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
}) {
  const comparison = await compareImages(
    options.referenceImagePath,
    options.render.screenshotPath,
    options.diffTargetPath,
  )

  if (options.diffPrevPath && options.previousScreenshotPath) {
    await compareImages(options.previousScreenshotPath, options.render.screenshotPath, options.diffPrevPath)
  }

  const issues: RepairIssue[] = []
  const bboxErrors: number[] = []
  const snapshots = createSnapshotMap(options.render.nodes)
  const parentNodeIds = createChildNodeSet(options.scene)

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

    if (node.text) {
      const hasOverflow =
        snapshot.scrollWidth > snapshot.clientWidth + 1 ||
        snapshot.scrollHeight > snapshot.clientHeight + 1

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

    const shouldCheckOcclusion =
      !parentNodeIds.has(node.id) && node.type !== 'frame' && node.type !== 'group'

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

  const metrics: StageMetrics = {
    visualSimilarity: comparison.visualSimilarity,
    pixelDiffRatio: comparison.pixelDiffRatio,
    globalVisualSimilarity: comparison.globalVisualSimilarity,
    focusedVisualSimilarity: comparison.focusedVisualSimilarity,
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
