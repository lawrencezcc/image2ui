import fs from 'node:fs/promises'
import path from 'node:path'

import { jsonrepair } from 'jsonrepair'
import sharp from 'sharp'

import { analyzeStage } from './analyze'
import { materializeSceneAssets } from './assets'
import { buildSceneFromChartSpec } from './chart-scene'
import { kimiConfig, paths, pipelineDefaults } from './config'
import { CodexCliClient } from './codex-client'
import { computeDebugStats } from './debug-stats'
import { buildFallbackComponent, isRenderableSfc } from './fallback'
import { buildInfographicSceneFromOcr } from './infographic-scene'
import { KimiCodingClient } from './kimi-client'
import {
  createChartSpecPrompt,
  createCompactRepairPrompt,
  createInitialComponentPrompt,
  createRepairPrompt,
  createScenePrompt,
} from './prompting'
import { QwenOcrClient } from './qwen-ocr-client'
import { QwenVlClient } from './qwen-vl-client'
import { StageRenderer } from './render'
import { componentResponseSchema, sceneResponseSchema } from './schemas'
import {
  appendEvent,
  ensureArtifactsLayout,
  getStageDirectoryName,
  prepareTaskDirectories,
  toPublicRelative,
  updateTimeline,
  writeTrace,
} from './store'
import type {
  ComponentResponse,
  Constraint,
  ExitReason,
  RenderMode,
  RenderPreference,
  SceneDocument,
  SceneNode,
  StageArtifact,
  StageMetrics,
  TaskResult,
  TaskSummaryStage,
  TaskTimelineSummary,
  TaskTraceSummary,
} from './types'
import { TraceRecorder } from './trace'
import {
  createTaskId,
  ensureDir,
  extractRenderPreference,
  fileExists,
  readJson,
  slugify,
  writeJson,
  writeText,
} from './utils'

let codexQuotaMode = false

function sanitizeSfc(source: string) {
  const fencedMatch = source.match(/```(?:vue)?\s*([\s\S]*?)```/i)
  return (fencedMatch?.[1] ?? source).trim()
}

function ensureRenderableSfc(source: string, scene: SceneDocument) {
  const sanitized = sanitizeSfc(source)
  if (isRenderableSfc(sanitized)) {
    return sanitized
  }

  return buildFallbackComponent(scene)
}

function normalizeRadius(rawNode: Record<string, unknown>) {
  const radius = typeof rawNode.radius === 'number' ? rawNode.radius : undefined
  return radius ? [radius, radius, radius, radius] : undefined
}

function normalizeFill(rawNode: Record<string, unknown>) {
  if (typeof rawNode.fill === 'string') {
    return String(rawNode.fill)
  }

  if (typeof rawNode.stroke === 'string') {
    return String(rawNode.stroke)
  }

  const style = rawNode.style as Record<string, unknown> | undefined
  const fills = Array.isArray(style?.fills) ? (style?.fills as string[]) : undefined
  return fills?.[0]
}

function normalizeNode(rawNode: Record<string, unknown>, index: number): SceneNode {
  const rawType = String(rawNode.type ?? 'frame')
  const rawText =
    typeof rawNode.text === 'string'
      ? rawNode.text
      : typeof rawNode.content === 'string'
        ? rawNode.content
        : typeof rawNode.label === 'string'
          ? rawNode.label
          : rawType === 'text' && typeof rawNode.name === 'string'
            ? rawNode.name
            : undefined
  const fill = normalizeFill(rawNode)
  const x = Number(rawNode.x ?? (rawNode.frame as Record<string, unknown> | undefined)?.x ?? 0)
  const y = Number(rawNode.y ?? (rawNode.frame as Record<string, unknown> | undefined)?.y ?? 0)
  const nodeWidth = Number(
    rawNode.width ?? (rawNode.frame as Record<string, unknown> | undefined)?.width ?? 0,
  )
  const nodeHeight = Number(
    rawNode.height ?? (rawNode.frame as Record<string, unknown> | undefined)?.height ?? 0,
  )

  return {
    id: String(rawNode.id ?? `node-${index + 1}`),
    name: typeof rawNode.name === 'string' ? rawNode.name : undefined,
    type: rawType,
    render:
      rawType === 'canvas'
        ? 'canvas'
        : rawType === 'image'
          ? 'html'
        : rawType === 'svg' || rawType.includes('chart') || rawType === 'path' || rawType === 'ellipse'
        ? 'svg'
        : 'html',
    parentId:
      typeof rawNode.parentId === 'string'
        ? rawNode.parentId
        : String(rawNode.id ?? '') === 'card'
          ? null
          : 'card',
    frame: {
      x,
      y,
      width: nodeWidth,
      height: nodeHeight,
      rotation: Number(rawNode.rotation ?? 0),
    },
    zIndex: Number(rawNode.zIndex ?? index + 1),
    opacity: Number(rawNode.opacity ?? 1),
    clip:
      typeof rawNode.clip === 'boolean'
        ? {
            enabled: rawNode.clip,
            overflow: rawNode.clip ? 'hidden' : 'visible',
            radius: normalizeRadius(rawNode),
          }
        : undefined,
    style: {
      fills: fill ? [fill] : undefined,
      background: fill,
    },
    text:
      typeof rawText === 'string'
        ? {
            content: rawText,
            fontFamily: String(rawNode.fontFamily ?? 'Inter'),
            fontWeight: Number(rawNode.fontWeight ?? 500),
            fontSize: Number(rawNode.fontSize ?? 14),
            lineHeight: Number(rawNode.lineHeight ?? Math.round(Number(rawNode.fontSize ?? 14) * 1.4)),
            letterSpacing: Number(rawNode.letterSpacing ?? 0),
            color: String(rawNode.color ?? '#111111'),
            align:
              rawNode.align === 'center' || rawNode.align === 'right' ? rawNode.align : 'left',
            wrap: 'nowrap',
            overflow: 'clip',
            direction:
              rawNode.direction === 'vertical' ||
              rawNode.direction === 'rotate-ccw' ||
              rawNode.direction === 'rotate-cw'
                ? rawNode.direction
                : 'horizontal',
            box: {
              width: nodeWidth,
              height: nodeHeight,
            },
          }
        : undefined,
    svg: typeof rawNode.svg === 'string' ? String(rawNode.svg) : undefined,
    canvas:
      rawNode.canvas && typeof rawNode.canvas === 'object'
        ? (rawNode.canvas as SceneNode['canvas'])
        : undefined,
    asset:
      rawType === 'image'
        ? {
            source:
              rawNode.asset && typeof rawNode.asset === 'object' && (rawNode.asset as Record<string, unknown>).source === 'generated'
                ? 'generated'
                : 'crop',
            src:
              rawNode.asset && typeof rawNode.asset === 'object' && typeof (rawNode.asset as Record<string, unknown>).src === 'string'
                ? String((rawNode.asset as Record<string, unknown>).src)
                : undefined,
            cacheKey:
              rawNode.asset && typeof rawNode.asset === 'object' && typeof (rawNode.asset as Record<string, unknown>).cacheKey === 'string'
                ? String((rawNode.asset as Record<string, unknown>).cacheKey)
                : undefined,
            prompt:
              rawNode.asset && typeof rawNode.asset === 'object' && typeof (rawNode.asset as Record<string, unknown>).prompt === 'string'
                ? String((rawNode.asset as Record<string, unknown>).prompt)
                : typeof rawNode.notes === 'string'
                  ? rawNode.notes
                  : undefined,
          }
        : undefined,
    notes: typeof rawNode.notes === 'string' ? rawNode.notes : undefined,
  }
}

function flattenNestedNodes(
  nodes: Array<Record<string, unknown>>,
  parentId: string | null,
  acc: Array<Record<string, unknown>>,
) {
  for (const rawNode of nodes) {
    const nodeId = String(rawNode.id ?? `node-${acc.length + 1}`)
    acc.push({
      ...rawNode,
      id: nodeId,
      parentId,
    })

    if (Array.isArray(rawNode.children)) {
      flattenNestedNodes(rawNode.children as Array<Record<string, unknown>>, nodeId, acc)
    }
  }
}

function extractSceneNodes(rawScene: Record<string, unknown>) {
  if (Array.isArray(rawScene.nodes)) {
    const rawNodes = rawScene.nodes as Array<Record<string, unknown>>
    if (rawNodes.some((node) => Array.isArray(node.children))) {
      const flattened: Array<Record<string, unknown>> = []
      flattenNestedNodes(rawNodes, null, flattened)
      return {
        coordinateMode: 'relative' as const,
        artboardRecord: undefined,
        nodes: flattened,
      }
    }

    return {
      coordinateMode: 'relative' as const,
      artboardRecord: undefined,
      nodes: rawNodes,
    }
  }

  const artboards = Array.isArray(rawScene.artboards)
    ? (rawScene.artboards as Array<Record<string, unknown>>)
    : []
  const artboardRecord = artboards[0]
  const flattened: Array<Record<string, unknown>> = []

  if (artboardRecord && Array.isArray(artboardRecord.children)) {
    flattenNestedNodes(artboardRecord.children as Array<Record<string, unknown>>, null, flattened)
  }

  return {
    coordinateMode: 'absolute' as const,
    artboardRecord,
    nodes: flattened,
  }
}

function normalizeConstraints(rawScene: Record<string, unknown>, nodes: SceneNode[]) {
  const fromNodes: Constraint[] = []

  for (const node of nodes) {
    const rawNode = (rawScene.nodes as Array<Record<string, unknown>> | undefined)?.find(
      (candidate) => String(candidate.id ?? '') === node.id,
    )
    const rawConstraints = rawNode?.constraints

    if (!rawConstraints || Array.isArray(rawConstraints) || typeof rawConstraints !== 'object') {
      continue
    }

    for (const [key, value] of Object.entries(rawConstraints as Record<string, unknown>)) {
      if (value === 'inside-parent') {
        fromNodes.push({
          type: 'inside-parent',
          nodeId: node.id,
          parentId: node.parentId ?? 'card',
          tolerance: 2,
        })
        continue
      }

      if (key === 'no-text-overflow' && value === true) {
        fromNodes.push({
          type: 'no-text-overflow',
          nodeId: node.id,
          tolerance: 1,
        })
      }
    }
  }

  const rawConstraints = Array.isArray(rawScene.constraints) ? rawScene.constraints : []
  const normalized: Constraint[] = []

  for (const constraint of rawConstraints) {
    if (!constraint || typeof constraint !== 'object') {
      continue
    }

    const rawConstraint = constraint as Record<string, unknown>
    normalized.push({
      type: String(rawConstraint.type ?? 'inside-parent') as Constraint['type'],
      nodeId: typeof rawConstraint.nodeId === 'string' ? rawConstraint.nodeId : undefined,
      nodes: Array.isArray(rawConstraint.nodes) ? (rawConstraint.nodes as string[]) : undefined,
      parentId: typeof rawConstraint.parentId === 'string' ? rawConstraint.parentId : undefined,
      value: typeof rawConstraint.value === 'number' ? rawConstraint.value : undefined,
      tolerance: typeof rawConstraint.tolerance === 'number' ? rawConstraint.tolerance : 1,
    })
  }

  return [...normalized, ...fromNodes]
}

function createNodeMap(nodes: SceneNode[]) {
  return new Map(nodes.map((node) => [node.id, node]))
}

function inferParentId(node: SceneNode, nodes: SceneNode[]) {
  const candidates = nodes
    .filter((candidate) => candidate.id !== node.id)
    .filter((candidate) => ['frame', 'group', 'rect'].includes(candidate.type))
    .filter(
      (candidate) =>
        node.frame.x >= 0 &&
        node.frame.y >= 0 &&
        node.frame.width <= candidate.frame.width + 2 &&
        node.frame.height <= candidate.frame.height + 2 &&
        node.frame.x + node.frame.width <= candidate.frame.width + 2 &&
        node.frame.y + node.frame.height <= candidate.frame.height + 2,
    )
    .sort(
      (left, right) =>
        left.frame.width * left.frame.height - right.frame.width * right.frame.height,
    )

  return candidates[0]?.id ?? null
}

function repairParentLinks(nodes: SceneNode[]) {
  const existingIds = new Set(nodes.map((node) => node.id))

  return nodes.map((node) => {
    const parentExists = node.parentId ? existingIds.has(node.parentId) : false
    if (parentExists || node.parentId === null) {
      return node
    }

    return {
      ...node,
      parentId: inferParentId(node, nodes),
    }
  })
}

function detectRelativeParents(nodes: SceneNode[]) {
  const nodeMap = createNodeMap(nodes)
  const relativeParents = new Set<string>()

  for (const node of nodes) {
    if (!node.parentId) {
      continue
    }

    const parent = nodeMap.get(node.parentId)
    if (!parent) {
      continue
    }

    if (node.frame.x < parent.frame.x || node.frame.y < parent.frame.y) {
      relativeParents.add(parent.id)
    }
  }

  return relativeParents
}

function resolveAbsoluteFrame(
  node: SceneNode,
  nodeMap: Map<string, SceneNode>,
  relativeParents: Set<string>,
): SceneNode['frame'] {
  if (!node.parentId) {
    return { ...node.frame }
  }

  const parent = nodeMap.get(node.parentId)
  if (!parent) {
    return { ...node.frame }
  }

  const parentFrame = resolveAbsoluteFrame(parent, nodeMap, relativeParents)
  if (!relativeParents.has(parent.id)) {
    return { ...node.frame }
  }

  return {
    ...node.frame,
    x: parentFrame.x + node.frame.x,
    y: parentFrame.y + node.frame.y,
  }
}

function normalizeScene(scene: SceneDocument, imagePath: string, width: number, height: number): SceneDocument {
  const rawScene = scene as unknown as Record<string, unknown>
  const extracted = extractSceneNodes(rawScene)
  const rawNodes = repairParentLinks(extracted.nodes.map((node, index) => normalizeNode(node, index)))
  const relativeParents =
    extracted.coordinateMode === 'relative' ? detectRelativeParents(rawNodes) : new Set<string>()
  const nodeMap = createNodeMap(rawNodes)
  const normalizedNodes = rawNodes.map((node) => ({
    ...node,
    frame:
      extracted.coordinateMode === 'relative'
        ? resolveAbsoluteFrame(node, nodeMap, relativeParents)
        : { ...node.frame },
  }))
  const artboardRecord = extracted.artboardRecord
  const artboardChildren = Array.isArray(artboardRecord?.children)
    ? (artboardRecord.children as Array<Record<string, unknown>>)
    : []
  const normalizedBackground =
    scene.artboard?.background ||
    (typeof artboardRecord?.background === 'string' ? String(artboardRecord.background) : undefined) ||
    normalizeFill(artboardChildren[0] ?? {}) ||
    '#ffffff'
  const normalizedWidth =
    scene.artboard?.width || Number(artboardRecord?.width ?? rawScene.width ?? width)
  const normalizedHeight =
    scene.artboard?.height || Number(artboardRecord?.height ?? rawScene.height ?? height)

  return {
    ...scene,
    version: scene.version || '1.0',
    mode: 'clone-static',
    source: {
      image: imagePath,
      width,
      height,
      dpr: scene.source?.dpr ?? 1,
    },
    artboard: {
      width: normalizedWidth,
      height: normalizedHeight,
      background: normalizedBackground,
      clip:
        scene.artboard?.clip ??
        (typeof artboardRecord?.clip === 'boolean' ? artboardRecord.clip : false),
    },
    nodes: normalizedNodes,
    constraints: normalizeConstraints(rawScene, normalizedNodes),
  }
}

function scaleSceneGeometry(
  scene: SceneDocument,
  scaleX: number,
  scaleY: number,
  targetWidth: number,
  targetHeight: number,
) {
  if (
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX <= 0 ||
    scaleY <= 0 ||
    (Math.abs(scaleX - 1) < 0.02 && Math.abs(scaleY - 1) < 0.02)
  ) {
    return scene
  }

  return {
    ...scene,
    artboard: {
      ...scene.artboard,
      width: targetWidth,
      height: targetHeight,
    },
    nodes: scene.nodes.map((node) => {
      const scaledFrame = {
        ...node.frame,
        x: node.frame.x * scaleX,
        y: node.frame.y * scaleY,
        width: node.frame.width * scaleX,
        height: node.frame.height * scaleY,
      }

      return {
        ...node,
        frame: scaledFrame,
        text: node.text
          ? {
              ...node.text,
              fontSize: node.text.fontSize * scaleY,
              lineHeight: node.text.lineHeight * scaleY,
              letterSpacing: node.text.letterSpacing * scaleX,
              box: {
                width: scaledFrame.width,
                height: scaledFrame.height,
              },
            }
          : undefined,
        clip:
          node.clip?.radius?.length
            ? {
                ...node.clip,
                radius: node.clip.radius.map((value, index) =>
                  value * (index % 2 === 0 ? scaleX : scaleY),
                ),
              }
            : node.clip,
      }
    }),
  }
}

function scaleSceneToSourceIfNeeded(scene: SceneDocument, width: number, height: number) {
  const artboardWidth = scene.artboard.width || width
  const artboardHeight = scene.artboard.height || height
  const scaleX = width / artboardWidth
  const scaleY = height / artboardHeight

  const appearsDownscaled =
    artboardWidth < width * 0.8 &&
    artboardHeight < height * 0.8 &&
    scaleX > 1.1 &&
    scaleY > 1.1 &&
    Math.abs(scaleX - scaleY) < 0.25

  if (!appearsDownscaled) {
    return scene
  }

  return scaleSceneGeometry(scene, scaleX, scaleY, width, height)
}

async function detectForegroundBounds(imagePath: string) {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const samplePoints = [
    [0, 0],
    [info.width - 1, 0],
    [0, info.height - 1],
    [info.width - 1, info.height - 1],
  ]
  const background = samplePoints.reduce(
    (acc, [x, y]) => {
      const index = (y * info.width + x) * info.channels
      acc.r += data[index] ?? 0
      acc.g += data[index + 1] ?? 0
      acc.b += data[index + 2] ?? 0
      return acc
    },
    { r: 0, g: 0, b: 0 },
  )

  background.r /= samplePoints.length
  background.g /= samplePoints.length
  background.b /= samplePoints.length

  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * info.channels
      const distance = Math.sqrt(
        ((data[index] ?? 0) - background.r) ** 2 +
          ((data[index + 1] ?? 0) - background.g) ** 2 +
          ((data[index + 2] ?? 0) - background.b) ** 2,
      )

      if (distance <= 18) {
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

function sceneContentBounds(scene: SceneDocument) {
  const contentNodes = scene.nodes.filter(
    (node) =>
      !(
        node.frame.x === 0 &&
        node.frame.y === 0 &&
        node.frame.width >= scene.artboard.width &&
        node.frame.height >= scene.artboard.height
      ),
  )

  if (!contentNodes.length) {
    return undefined
  }

  const minX = Math.min(...contentNodes.map((node) => node.frame.x))
  const minY = Math.min(...contentNodes.map((node) => node.frame.y))
  const maxX = Math.max(...contentNodes.map((node) => node.frame.x + node.frame.width))
  const maxY = Math.max(...contentNodes.map((node) => node.frame.y + node.frame.height))

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function fitSceneToReferenceBounds(
  scene: SceneDocument,
  referenceBounds?: { x: number; y: number; width: number; height: number },
) {
  if (!referenceBounds) {
    return scene
  }

  const currentBounds = sceneContentBounds(scene)
  if (!currentBounds || !currentBounds.width || !currentBounds.height) {
    return scene
  }

  const scale = Math.min(
    referenceBounds.width / currentBounds.width,
    referenceBounds.height / currentBounds.height,
  )

  if (!Number.isFinite(scale) || scale < 1.08) {
    return scene
  }

  return {
    ...scene,
    nodes: scene.nodes.map((node) => {
      const scaledFrame = {
        ...node.frame,
        x: referenceBounds.x + (node.frame.x - currentBounds.x) * scale,
        y: referenceBounds.y + (node.frame.y - currentBounds.y) * scale,
        width: node.frame.width * scale,
        height: node.frame.height * scale,
      }

      return {
        ...node,
        frame: scaledFrame,
        text: node.text
          ? {
              ...node.text,
              fontSize: node.text.fontSize * scale,
              lineHeight: node.text.lineHeight * scale,
              letterSpacing: node.text.letterSpacing * scale,
              box: {
                width: scaledFrame.width,
                height: scaledFrame.height,
              },
            }
          : undefined,
        clip:
          node.clip?.radius?.length
            ? {
                ...node.clip,
                radius: node.clip.radius.map((value) => value * scale),
              }
            : node.clip,
      }
    }),
  }
}

function ensureSceneFitsArtboard(scene: SceneDocument, padding = 24) {
  const bounds = sceneContentBounds(scene)
  if (!bounds) {
    return scene
  }

  const requiredWidth = Math.max(scene.artboard.width, bounds.x + bounds.width + padding)
  const requiredHeight = Math.max(scene.artboard.height, bounds.y + bounds.height + padding)

  if (
    Math.abs(requiredWidth - scene.artboard.width) < 1 &&
    Math.abs(requiredHeight - scene.artboard.height) < 1
  ) {
    return scene
  }

  return {
    ...scene,
    artboard: {
      ...scene.artboard,
      width: requiredWidth,
      height: requiredHeight,
    },
  }
}

function rebalanceChartLayering(scene: SceneDocument) {
  const chartNode = [...scene.nodes]
    .filter((node) => node.render === 'svg' || node.render === 'canvas')
    .sort(
      (left, right) =>
        right.frame.width * right.frame.height - left.frame.width * left.frame.height,
    )[0]

  if (!chartNode) {
    return scene
  }

  const promotedNodeIds = new Set(
    scene.nodes
      .filter((node) => node.id !== chartNode.id)
      .filter((node) => node.type === 'text' || /(legend|swatch|title|axis)/i.test(`${node.id} ${node.name ?? ''}`))
      .filter((node) => {
        const overlapsChartTop =
          node.frame.y + node.frame.height > chartNode.frame.y &&
          node.frame.y < chartNode.frame.y + 64
        const outsideChartBand =
          node.frame.y < chartNode.frame.y || node.frame.x < chartNode.frame.x - 12
        const belowChart = node.frame.y >= chartNode.frame.y + chartNode.frame.height - 8

        return overlapsChartTop || outsideChartBand || belowChart
      })
      .map((node) => node.id),
  )

  if (!promotedNodeIds.size) {
    return scene
  }

  const baseZIndex = Math.max(chartNode.zIndex + 1, ...scene.nodes.map((node) => node.zIndex))

  return {
    ...scene,
    nodes: scene.nodes.map((node) => {
      if (node.id === chartNode.id) {
        return {
          ...node,
          zIndex: Math.min(node.zIndex, 1),
        }
      }

      if (!promotedNodeIds.has(node.id)) {
        return node
      }

      return {
        ...node,
        zIndex: Math.max(node.zIndex, baseZIndex + 1),
      }
    }),
  }
}

function extractSvgTextContent(svgMarkup: string) {
  const contents = new Set<string>()
  const matches = svgMarkup.matchAll(/<text\b[^>]*>(.*?)<\/text>/gis)

  for (const match of matches) {
    const value = match[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (value) {
      contents.add(value)
    }
  }

  return contents
}

function dedupeChartTextNodes(scene: SceneDocument) {
  const svgTextContents = new Set<string>()

  for (const node of scene.nodes) {
    if (typeof node.svg === 'string') {
      for (const content of extractSvgTextContent(node.svg)) {
        svgTextContents.add(content)
      }
    }
  }

  if (!svgTextContents.size) {
    return scene
  }

  const dedupedNodes = scene.nodes.filter((node) => {
    if (!node.text?.content) {
      return true
    }

    const normalizedText = node.text.content.replace(/\s+/g, ' ').trim()
    if (!svgTextContents.has(normalizedText)) {
      return true
    }

    return !/(axis|tick|label|title|坐标|刻度|标签)/i.test(`${node.id} ${node.name ?? ''}`)
  })

  if (dedupedNodes.length === scene.nodes.length) {
    return scene
  }

  const remainingIds = new Set(dedupedNodes.map((node) => node.id))
  return {
    ...scene,
    nodes: dedupedNodes,
    constraints: scene.constraints.filter((constraint) => {
      if (constraint.nodeId && !remainingIds.has(constraint.nodeId)) {
        return false
      }

      if (constraint.nodes?.length) {
        const filtered = constraint.nodes.filter((nodeId) => remainingIds.has(nodeId))
        constraint.nodes = filtered
        return filtered.length > 0
      }

      return true
    }),
  }
}

function parseScenePayload(sceneJson: string) {
  try {
    return JSON.parse(sceneJson) as unknown
  } catch {
    return JSON.parse(jsonrepair(sceneJson)) as unknown
  }
}

function parseLooseJson<T>(text: string) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch?.[1] ?? text

  try {
    return JSON.parse(candidate) as T
  } catch {
    return JSON.parse(jsonrepair(candidate)) as T
  }
}

function parseJsonEnvelope(text: string) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch?.[1] ?? text

  try {
    return JSON.parse(candidate) as { summary: string; scene_json: string }
  } catch {
    return JSON.parse(jsonrepair(candidate)) as { summary: string; scene_json: string }
  }
}

function buildOcrHint(ocrText: string, words: Array<{ text: string; location?: number[] }>) {
  const lines = ocrText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30)
  const locatedWords = words
    .slice(0, 24)
    .map((word) =>
      word.location?.length
        ? `${word.text} @ [${word.location.join(', ')}]`
        : word.text,
    )

  return [
    lines.length ? `OCR 文本行:\n- ${lines.join('\n- ')}` : '',
    locatedWords.length ? `OCR 位置线索:\n- ${locatedWords.join('\n- ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim()
}

function scoreStage(metrics: StageMetrics) {
  return (
    metrics.visualSimilarity -
    metrics.criticalIssueCount * 0.08 -
    metrics.overflowCount * 0.04 -
    metrics.occlusionCount * 0.04 -
    metrics.missingNodeCount * 0.05 -
    metrics.alignmentErrorP95 * 0.002
  )
}

function isSuccess(metrics: StageMetrics) {
  return (
    metrics.visualSimilarity >= pipelineDefaults.minSuccessSimilarity &&
    metrics.criticalIssueCount === 0 &&
    metrics.overflowCount === 0 &&
    metrics.occlusionCount === 0 &&
    metrics.missingNodeCount === 0
  )
}

function stageDeltaSummary(previous: StageArtifact | undefined, current: StageArtifact) {
  if (!previous) {
    return '初稿渲染'
  }

  const similarityDelta = current.metrics.visualSimilarity - previous.metrics.visualSimilarity
  if (current.debugStats?.noOp) {
    return `无变化 · 相似度 ${
      similarityDelta >= 0 ? '+' : ''
    }${similarityDelta.toFixed(3)}`
  }

  if (current.debugStats) {
    return `变更 ${current.debugStats.changedNodeCount} 节点 · 相似度 ${
      similarityDelta >= 0 ? '+' : ''
    }${similarityDelta.toFixed(3)}`
  }

  const issueDelta = previous.repairReport.issues.length - current.repairReport.issues.length
  return `修复 ${Math.max(issueDelta, 0)} 项 · 相似度 ${
    similarityDelta >= 0 ? '+' : ''
  }${similarityDelta.toFixed(3)}`
}

function buildTaskSummary(params: {
  taskId: string
  createdAt: string
  inputImage: string
  stages: StageArtifact[]
  bestStage?: StageArtifact
  status: 'running' | 'completed'
  exitReason?: ExitReason
  activeStepLabel?: string
  runningStage?: {
    index: number
    name: string
    placeholderMessage: string
  }
  comparisonGroupId?: string
  comparisonGroupLabel?: string
  caseId?: string
  caseLabel?: string
  versionLabel?: string
  versionTag?: string
  branchKind?: 'dom-svg' | 'canvas' | 'adhoc'
  trace?: TaskTraceSummary
}): TaskTimelineSummary {
  const completedStages: TaskSummaryStage[] = params.stages.map((stage, index) => ({
    index: stage.index,
    name: stage.name,
    status: 'completed' as const,
    screenshot: toPublicRelative(stage.screenshotPath),
    deltaSummary: stageDeltaSummary(params.stages[index - 1], stage),
    renderMode: stage.renderMode,
    metrics: stage.metrics,
    debug: stage.debugStats,
    hidden: {
      code: toPublicRelative(stage.componentPath),
      repairReport: toPublicRelative(stage.repairReportPath),
      diffTarget: toPublicRelative(stage.diffTargetPath),
      diffPrev: stage.diffPrevPath ? toPublicRelative(stage.diffPrevPath) : undefined,
      domSnapshot: toPublicRelative(stage.domSnapshotPath),
    },
  }))

  if (params.runningStage) {
    completedStages.push({
      index: params.runningStage.index,
      name: params.runningStage.name,
      status: 'running',
      deltaSummary: params.runningStage.placeholderMessage,
      placeholderMessage: params.runningStage.placeholderMessage,
    })
  }

  return {
    taskId: params.taskId,
    createdAt: params.createdAt,
    updatedAt: new Date().toISOString(),
    status: params.status,
    inputImage: params.inputImage,
    finalComponent: params.bestStage ? toPublicRelative(params.bestStage.componentPath) : undefined,
    exitReason: params.exitReason,
    activeStepLabel: params.activeStepLabel,
    bestStageIndex: params.bestStage?.index ?? 0,
    finalStageIndex: params.stages.at(-1)?.index ?? 0,
    comparisonGroupId: params.comparisonGroupId,
    comparisonGroupLabel: params.comparisonGroupLabel,
    caseId: params.caseId,
    caseLabel: params.caseLabel,
    versionLabel: params.versionLabel,
    versionTag: params.versionTag,
    branchKind: params.branchKind,
    trace: params.trace
      ? {
          path: toPublicRelative(getTaskTracePath(params.taskId)),
          spanCount: params.trace.spanCount,
          eventCount: params.trace.eventCount,
          totalDurationMs: params.trace.totalDurationMs,
          latestError: params.trace.latestError,
        }
      : undefined,
    stages: completedStages,
  }
}

function getTaskTracePath(taskId: string) {
  return path.join(paths.tasksRoot, taskId, 'trace.json')
}

function buildReasons(metrics: StageMetrics, exitReason: ExitReason) {
  if (exitReason === 'success') {
    return ['达到收敛阈值，当前最佳版本满足默认验收标准。']
  }

  const reasons: string[] = [`任务以 ${exitReason} 退出。`]
  if (metrics.visualSimilarity < pipelineDefaults.minSuccessSimilarity) {
    reasons.push(
      `视觉相似度 ${(metrics.visualSimilarity * 100).toFixed(1)}% 低于阈值 ${(pipelineDefaults.minSuccessSimilarity * 100).toFixed(1)}%。`,
    )
  }
  if (metrics.overflowCount > 0) {
    reasons.push(`仍存在 ${metrics.overflowCount} 处文本溢出。`)
  }
  if (metrics.occlusionCount > 0) {
    reasons.push(`仍存在 ${metrics.occlusionCount} 处遮挡问题。`)
  }
  if (metrics.missingNodeCount > 0) {
    reasons.push(`仍缺少 ${metrics.missingNodeCount} 个关键节点。`)
  }
  if (metrics.criticalIssueCount > 0) {
    reasons.push(`仍有 ${metrics.criticalIssueCount} 个严重问题未解决。`)
  }
  return reasons
}

function detectChartLikeScene(scene: SceneDocument, promptText?: string) {
  if (promptText && /(chart|graph|bar|line|pie|柱状图|折线图|图表|坐标轴)/i.test(promptText)) {
    return true
  }

  return scene.nodes.some((node) =>
    /(chart|graph|plot|axis|legend|bar|series|grid|month|图表|图例|坐标轴)/i.test(
      `${node.id} ${node.name ?? ''} ${node.type}`,
    ),
  )
}

function hasRenderableChartPayload(scene: SceneDocument, renderPreference: RenderPreference) {
  const svgNodes = scene.nodes.filter(
    (node) => node.render === 'svg' && typeof node.svg === 'string' && node.svg.includes('<svg'),
  )
  const canvasNodes = scene.nodes.filter((node) => node.render === 'canvas')

  if (renderPreference === 'canvas') {
    return canvasNodes.length > 0
  }

  return svgNodes.length > 0 || canvasNodes.length > 0
}

function detectStageRenderMode(componentSource: string, scene: SceneDocument): RenderMode {
  if (/<canvas[\s>]/i.test(componentSource) || scene.nodes.some((node) => node.render === 'canvas')) {
    return 'canvas'
  }

  if (
    /<svg[\s>]/i.test(componentSource) ||
    scene.nodes.some((node) => node.render === 'svg' || typeof node.svg === 'string')
  ) {
    return 'svg'
  }

  return 'html'
}

function isInfographicInput(promptText?: string) {
  return /(infographic|信息图|流程图|时间线|阶段卡片|训练计划)/i.test(promptText ?? '')
}

function shouldUseCompactRepair(
  scene: SceneDocument,
  stage: StageArtifact,
  renderPreference: RenderPreference,
) {
  if (renderPreference === 'canvas') {
    return true
  }

  const geometrySensitiveIssues = stage.repairReport.issues.some((issue) =>
    ['chart_shape_mismatch', 'color_mismatch', 'visual_mismatch'].includes(issue.type),
  )

  const chartNode = scene.nodes.find((node) => node.render === 'canvas' || node.render === 'svg')
  const lineLikeCanvas =
    chartNode?.canvas &&
    ['line', 'area', 'radar', 'scatter', 'donut', 'pie'].includes(chartNode.canvas.kind)
  const lineLikeSvg =
    chartNode?.render === 'svg' &&
    typeof chartNode.svg === 'string' &&
    (/<polyline/i.test(chartNode.svg) || /<path/i.test(chartNode.svg)) &&
    !/<rect/i.test(chartNode.svg)

  return geometrySensitiveIssues || Boolean(lineLikeCanvas) || Boolean(lineLikeSvg)
}

function shouldUseKimiRepairFallback(
  scene: SceneDocument,
  stage: StageArtifact,
  renderPreference: RenderPreference,
  infographicInput: boolean,
) {
  if (infographicInput || renderPreference === 'canvas') {
    return true
  }

  if (
    stage.repairReport.issues.some((issue) =>
      ['chart_shape_mismatch', 'visual_mismatch'].includes(issue.type),
    )
  ) {
    return true
  }

  const chartNode = scene.nodes.find((node) => node.render === 'canvas' || node.render === 'svg')
  if (chartNode?.canvas) {
    return ['line', 'area', 'radar', 'scatter', 'donut', 'pie'].includes(chartNode.canvas.kind)
  }

  return Boolean(
    chartNode?.render === 'svg' &&
      typeof chartNode.svg === 'string' &&
      (/<polyline/i.test(chartNode.svg) || /<path/i.test(chartNode.svg)) &&
      !/<rect/i.test(chartNode.svg),
  )
}

function isCodexQuotaOrAvailabilityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /(usage limit|purchase more credits|quota|rate limit|service unavailable|temporarily unavailable)/i.test(
    message,
  )
}

function recordCodexQuotaMode(error: unknown) {
  if (isCodexQuotaOrAvailabilityError(error)) {
    codexQuotaMode = true
    return true
  }

  return false
}

function isChartLikeInput(promptText: string | undefined, ocrWords: Array<{ text: string }>) {
  if (promptText && /(infographic|信息图|流程图|时间线|阶段卡片|训练计划)/i.test(promptText)) {
    return false
  }

  if (promptText && /(chart|graph|bar|line|area|pie|柱状图|折线图|面积图|图表|坐标轴)/i.test(promptText)) {
    return true
  }

  const monthCount = ocrWords.filter((word) => /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?$/i.test(word.text)).length
  const numericCount = ocrWords.filter((word) => /^-?\d+(?:\.\d+)?$/.test(word.text)).length
  const axisKeywordCount = ocrWords.filter((word) => /(量|率|值|月份|日期|year|month|day|week)/i.test(word.text)).length

  return monthCount >= 3 || (numericCount >= 3 && axisKeywordCount >= 1)
}

function hasTooManyZeroSizedTextNodes(scene: SceneDocument) {
  const textNodes = scene.nodes.filter((node) => node.type === 'text')
  if (!textNodes.length) {
    return false
  }

  const zeroSizedCount = textNodes.filter((node) => node.frame.width <= 1 || node.frame.height <= 1).length
  return zeroSizedCount / textNodes.length >= 0.6
}

function hasDegenerateRenderableNode(scene: SceneDocument) {
  return scene.nodes.some(
    (node) =>
      (node.render === 'svg' || node.render === 'canvas') &&
      (node.frame.width <= 1 || node.frame.height <= 1),
  )
}

function isUsableScene(scene: SceneDocument, renderPreference: RenderPreference, promptText?: string) {
  const chartLike = detectChartLikeScene(scene, promptText)
  const meaningfulNodes = scene.nodes.filter((node) => node.type !== 'frame')
  const textNodes = scene.nodes.filter((node) => node.type === 'text')
  const baseValidity = chartLike
    ? scene.nodes.length >= 2 && meaningfulNodes.length >= 1
    : scene.nodes.length >= 4 && meaningfulNodes.length >= 2 && textNodes.length >= 1

  if (!baseValidity) {
    return false
  }

  if (hasDegenerateRenderableNode(scene) || hasTooManyZeroSizedTextNodes(scene)) {
    return false
  }

  if (chartLike) {
    return hasRenderableChartPayload(scene, renderPreference)
  }

  return true
}

export async function runTask(options: {
  imagePath: string
  promptText?: string
  comparisonGroupId?: string
  comparisonGroupLabel?: string
  caseId?: string
  caseLabel?: string
  versionLabel?: string
  versionTag?: string
  branchKind?: 'dom-svg' | 'canvas' | 'adhoc'
}): Promise<TaskResult> {
  const sourceImagePath = path.resolve(options.imagePath)
  const renderPreference = extractRenderPreference(options.promptText)
  const infographicInput = isInfographicInput(options.promptText)

  if (!(await fileExists(sourceImagePath))) {
    throw new Error(`输入图片不存在: ${sourceImagePath}`)
  }

  await ensureArtifactsLayout()

  const metadata = await sharp(sourceImagePath).metadata()
  const width = metadata.width ?? 1200
  const height = metadata.height ?? 800
  const extension = path.extname(sourceImagePath) || '.png'
  const taskId = createTaskId()
  const createdAt = new Date().toISOString()
  const taskPaths = await prepareTaskDirectories(taskId)
  const sourceCopyPath = path.join(taskPaths.sourceRoot, `source${extension}`)
  const modelImagePath = path.join(taskPaths.sourceRoot, 'analysis-input.jpg')
  const codex = new CodexCliClient()
  const kimi =
    kimiConfig.enabled && process.env.KIMI_API_KEY && process.env.KIMI_API_KEY.trim()
      ? new KimiCodingClient()
      : undefined
  const kimiTimeoutMs = options.comparisonGroupId?.startsWith('regression:') ? 15000 : undefined
  const qwenOcr = new QwenOcrClient()
  const qwenVl = new QwenVlClient()
  const renderer = new StageRenderer()
  const referenceBounds = await detectForegroundBounds(sourceImagePath)
  const stages: StageArtifact[] = []
  const issueHistory = new Map<string, number>()
  const startTime = Date.now()
  let noProgressRounds = 0
  let exitReason: ExitReason = 'max_iterations'
  let bestStage: StageArtifact | undefined
  let latestStage: StageArtifact | undefined
  let eventCount = 0
  const traceRecorder = new TraceRecorder(taskId, createdAt)
  const taskTraceId = traceRecorder.start('task', 'task')
  const summaryMeta = {
    comparisonGroupId: options.comparisonGroupId,
    comparisonGroupLabel: options.comparisonGroupLabel,
    caseId: options.caseId,
    caseLabel: options.caseLabel,
    versionLabel: options.versionLabel,
    versionTag: options.versionTag,
    branchKind: options.branchKind ?? (renderPreference === 'canvas' ? 'canvas' : 'dom-svg'),
  }
  const appendTrackedEvent = async (event: Record<string, unknown>) => {
    eventCount += 1
    await appendEvent(taskId, event)
  }
  const syncTrace = async (status: 'running' | 'completed') => {
    await writeTrace(taskId, traceRecorder.snapshot(status, eventCount))
  }

  await fs.copyFile(sourceImagePath, sourceCopyPath)
  await sharp(sourceImagePath)
    .resize({
      width: 640,
      height: 640,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 88,
    })
    .toFile(modelImagePath)
  await writeJson(taskPaths.metaPath, {
    taskId,
    createdAt,
    sourceImagePath,
    modelImagePath,
    promptText: options.promptText ?? '',
    renderPreference,
    ...summaryMeta,
    config: pipelineDefaults,
  })
  await updateTimeline(
    buildTaskSummary({
      taskId,
      createdAt,
      inputImage: toPublicRelative(sourceCopyPath),
      stages,
      status: 'running',
      activeStepLabel: 'scene 解析中',
      trace: traceRecorder.snapshot('running', eventCount),
      ...summaryMeta,
    }),
  )
  await appendTrackedEvent({
    type: 'task_started',
    taskId,
    createdAt,
    sourceImagePath,
    renderPreference,
  })
  await syncTrace('running')

  try {
      await renderer.start()

      let scene: SceneDocument | undefined
    let sceneResponseSummary = ''
    let ocrHint = ''
    let ocrWords: Array<{ text: string; location?: number[] }> = []

    let ocrTraceId: string | undefined
    try {
      ocrTraceId = traceRecorder.start('ocr', 'ocr')
      await updateTimeline(
        buildTaskSummary({
          taskId,
          createdAt,
          inputImage: toPublicRelative(sourceCopyPath),
          stages,
          status: 'running',
          activeStepLabel: 'ocr 解析中',
          trace: traceRecorder.snapshot('running', eventCount),
          ...summaryMeta,
        }),
      )
      const ocrResult = await qwenOcr.recognize({
        imagePaths: [sourceCopyPath],
        task: 'advanced_recognition',
      })
      ocrHint = buildOcrHint(ocrResult.text.slice(0, 4000), ocrResult.words)
      ocrWords = ocrResult.words
      await writeJson(path.join(taskPaths.taskRoot, 'ocr.json'), {
        model: ocrResult.model,
        requestId: ocrResult.requestId,
        usage: ocrResult.usage,
        text: ocrResult.text,
        words: ocrResult.words,
      })
      traceRecorder.finish(ocrTraceId, 'completed', {
        details: {
          wordCount: ocrResult.words.length,
          requestId: ocrResult.requestId,
        },
      })
      await appendTrackedEvent({
        type: 'ocr_completed',
        taskId,
        textLength: ocrResult.text.length,
        wordCount: ocrResult.words.length,
        requestId: ocrResult.requestId,
      })
      await syncTrace('running')
    } catch (error) {
      if (ocrTraceId) {
        traceRecorder.finish(ocrTraceId, 'failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      await appendTrackedEvent({
        type: 'ocr_failed',
        taskId,
        error: error instanceof Error ? error.message : String(error),
      })
      await syncTrace('running')
    }

    const isChartInput = !infographicInput && isChartLikeInput(options.promptText, ocrWords)
    const scenePrompt = createScenePrompt(
      toPublicRelative(sourceCopyPath),
      width,
      height,
      renderPreference,
      ocrHint,
      options.promptText,
    )
    const heuristicInfographicScene = buildInfographicSceneFromOcr({
      imagePath: toPublicRelative(sourceCopyPath),
      width,
      height,
      words: ocrWords,
      promptText: options.promptText,
    })

    if (
      heuristicInfographicScene &&
      (infographicInput ||
        isUsableScene(heuristicInfographicScene, renderPreference, options.promptText))
    ) {
      scene = heuristicInfographicScene
      sceneResponseSummary = heuristicInfographicScene.summary ?? 'ocr-infographic-fallback'
      await appendTrackedEvent({
        type: 'scene_selected',
        taskId,
        provider: 'ocr-heuristic',
        label: 'scene-infographic-fallback',
        nodeCount: heuristicInfographicScene.nodes.length,
      })
      await syncTrace('running')
    }

    if (isChartInput && !scene) {
      let chartSpecTraceId: string | undefined
      try {
        chartSpecTraceId = traceRecorder.start('chart-spec', 'chart-spec')
        const chartSpecResponse = await qwenVl.complete({
          imagePaths: [modelImagePath],
          prompt: createChartSpecPrompt(width, height, 'auto', ocrHint, options.promptText),
        })
        const chartScene = await buildSceneFromChartSpec({
          rawSpec: parseLooseJson(chartSpecResponse.text),
          imagePath: toPublicRelative(sourceCopyPath),
          sampleImagePath: sourceCopyPath,
          width,
          height,
          words: ocrWords,
          renderPreference,
          promptText: options.promptText,
        })

        if (chartScene && isUsableScene(chartScene, renderPreference, options.promptText)) {
          scene = chartScene
          sceneResponseSummary = chartScene.summary ?? 'chart-spec'
          traceRecorder.finish(chartSpecTraceId, 'completed', {
            details: {
              nodeCount: chartScene.nodes.length,
            },
          })
          await appendTrackedEvent({
            type: 'scene_selected',
            taskId,
            provider: 'qwen-vl',
            label: 'scene-chart-spec',
            nodeCount: chartScene.nodes.length,
          })
        } else {
          traceRecorder.finish(chartSpecTraceId, 'failed', {
            error: 'scene-chart-spec 不可用',
            details: {
              nodeCount: chartScene?.nodes.length ?? 0,
            },
          })
          await appendTrackedEvent({
            type: 'scene_rejected',
            taskId,
            provider: 'qwen-vl',
            label: 'scene-chart-spec',
            nodeCount: chartScene?.nodes.length ?? 0,
            renderPreference,
          })
        }
        await syncTrace('running')
      } catch (error) {
        if (chartSpecTraceId) {
          traceRecorder.finish(chartSpecTraceId, 'failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
        await appendTrackedEvent({
          type: 'scene_provider_failed',
          taskId,
          provider: 'qwen-vl',
          label: 'scene-chart-spec',
          error: error instanceof Error ? error.message : String(error),
        })
        await syncTrace('running')
      }
    }

    const sceneCandidates = [
      {
        provider: 'qwen-vl',
        label: 'scene-qwen-primary',
        run: async () =>
          parseJsonEnvelope(
            (
              await qwenVl.complete({
                imagePaths: [modelImagePath],
                prompt: `${scenePrompt}\n\n只输出 JSON 对象，格式为 {"summary":"...","scene_json":"..."}。`,
              })
            ).text,
          ),
      },
      ...(
        codexQuotaMode
          ? []
          : [
              {
                provider: 'codex' as const,
                label: 'scene-1',
                run: () =>
                  codex.runStructured<{
                    summary: string
                    scene_json: string
                  }>({
                    label: 'scene-1',
                    prompt: scenePrompt,
                    schema: sceneResponseSchema,
                    imagePaths: [modelImagePath],
                  }),
              },
              {
                provider: 'codex' as const,
                label: 'scene-2',
                run: () =>
                  codex.runStructured<{
                    summary: string
                    scene_json: string
                  }>({
                    label: 'scene-2',
                    prompt: scenePrompt,
                    schema: sceneResponseSchema,
                    imagePaths: [modelImagePath],
                  }),
              },
            ]
      ),
    ]

    for (const candidate of sceneCandidates) {
      if (scene) {
        break
      }

      let sceneTraceId: string | undefined
      try {
        sceneTraceId = traceRecorder.start(candidate.label, 'scene')
        const sceneResponse = await candidate.run()
        const rawScene = parseScenePayload(sceneResponse.scene_json)
        const bridgedScene = await buildSceneFromChartSpec({
          rawSpec: rawScene,
          imagePath: toPublicRelative(sourceCopyPath),
          sampleImagePath: sourceCopyPath,
          width,
          height,
          words: ocrWords,
          renderPreference,
          promptText: options.promptText,
        })

        const candidateScene = bridgedScene
          ? bridgedScene
          : normalizeScene(rawScene as SceneDocument, toPublicRelative(sourceCopyPath), width, height)
        const scaledScene = scaleSceneToSourceIfNeeded(candidateScene, width, height)
        const fittedScene = rebalanceChartLayering(
          dedupeChartTextNodes(
            ensureSceneFitsArtboard(fitSceneToReferenceBounds(scaledScene, referenceBounds)),
          ),
        )

        if (isUsableScene(fittedScene, renderPreference, options.promptText)) {
          scene = fittedScene
          sceneResponseSummary = sceneResponse.summary
          traceRecorder.finish(sceneTraceId, 'completed', {
            details: {
              nodeCount: fittedScene.nodes.length,
              provider: candidate.provider,
            },
          })
          await appendTrackedEvent({
            type: 'scene_selected',
            taskId,
            provider: candidate.provider,
            label: candidate.label,
            nodeCount: fittedScene.nodes.length,
          })
          break
        }

        traceRecorder.finish(sceneTraceId, 'failed', {
          error: 'scene 不可用',
          details: {
            nodeCount: fittedScene.nodes.length,
          },
        })
        await appendTrackedEvent({
          type: 'scene_rejected',
          taskId,
          provider: candidate.provider,
          label: candidate.label,
          nodeCount: fittedScene.nodes.length,
          renderPreference,
        })
        await syncTrace('running')
      } catch (error) {
        const quotaModeChanged = recordCodexQuotaMode(error)
        if (sceneTraceId) {
          traceRecorder.finish(sceneTraceId, 'failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
        await appendTrackedEvent({
          type: 'scene_provider_failed',
          taskId,
          provider: candidate.provider,
          label: candidate.label,
          error: error instanceof Error ? error.message : String(error),
        })
        if (quotaModeChanged) {
          await appendTrackedEvent({
            type: 'provider_state_changed',
            taskId,
            provider: 'codex',
            label: 'quota-mode-enabled',
          })
        }
        await syncTrace('running')
      }
    }

    if (!scene && infographicInput) {
      const infographicScene = buildInfographicSceneFromOcr({
        imagePath: toPublicRelative(sourceCopyPath),
        width,
        height,
        words: ocrWords,
        promptText: options.promptText,
      })

      if (infographicScene && isUsableScene(infographicScene, renderPreference, options.promptText)) {
        scene = infographicScene
        sceneResponseSummary = infographicScene.summary ?? 'ocr-infographic-fallback'
        await appendTrackedEvent({
          type: 'scene_selected',
          taskId,
          provider: 'ocr-heuristic',
          label: 'scene-infographic-fallback',
          nodeCount: infographicScene.nodes.length,
        })
        await syncTrace('running')
      }
    }

    if (!scene) {
      throw new Error('scene 解析未产出有效节点，任务已中止。')
    }

    scene.summary = sceneResponseSummary
    const assetTraceId = traceRecorder.start('materialize-assets', 'asset')
    scene = await materializeSceneAssets({
      scene,
      sourceImagePath: sourceCopyPath,
      assetsRoot: taskPaths.assetsRoot,
    })
    traceRecorder.finish(assetTraceId, 'completed', {
      details: {
        imageNodeCount: scene.nodes.filter((node) => node.type === 'image').length,
      },
    })
    await writeJson(path.join(taskPaths.taskRoot, 'scene.json'), scene)
    await syncTrace('running')

    let workingComponent = buildFallbackComponent(scene)
    const initialPrompt = createInitialComponentPrompt(scene)
    let initialComponentTraceId: string | undefined
    try {
      if (codexQuotaMode) {
        throw new Error('Codex quota mode enabled')
      }
      initialComponentTraceId = traceRecorder.start('initial-component', 'repair')
      const initial = await codex.runStructured<ComponentResponse>({
        label: 'initial-component',
        prompt: initialPrompt,
        schema: componentResponseSchema,
      })
      workingComponent = ensureRenderableSfc(initial.component, scene)
      traceRecorder.finish(initialComponentTraceId, 'completed', {
        details: {
          provider: 'codex',
        },
      })
      await appendTrackedEvent({
        type: 'initial_component_completed',
        taskId,
        provider: 'codex',
      })
      await syncTrace('running')
    } catch (error) {
      if (initialComponentTraceId) {
        traceRecorder.finish(initialComponentTraceId, 'failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      await appendTrackedEvent({
        type: 'initial_component_failed',
        taskId,
        provider: 'codex',
        error: error instanceof Error ? error.message : String(error),
      })
      if (recordCodexQuotaMode(error)) {
        await appendTrackedEvent({
          type: 'provider_state_changed',
          taskId,
          provider: 'codex',
          label: 'quota-mode-enabled',
        })
      }

      if (kimi) {
        let kimiInitialTraceId: string | undefined
        try {
          kimiInitialTraceId = traceRecorder.start('initial-component-kimi', 'repair')
          const kimiInitial = await kimi.complete({
            systemPrompt:
              '你是一个严格的 Vue 3 组件生成器。你只能返回完整 Vue SFC，不要解释，不要 markdown。',
            prompt: `${initialPrompt}\n\n只输出完整 Vue SFC。`,
            timeoutMs: kimiTimeoutMs,
          })
          workingComponent = ensureRenderableSfc(kimiInitial.text, scene)
          traceRecorder.finish(kimiInitialTraceId, 'completed', {
            details: {
              provider: 'kimi',
            },
          })
          await appendTrackedEvent({
            type: 'initial_component_completed',
            taskId,
            provider: 'kimi',
          })
          await syncTrace('running')
        } catch (kimiError) {
          if (kimiInitialTraceId) {
            traceRecorder.finish(kimiInitialTraceId, 'failed', {
              error: kimiError instanceof Error ? kimiError.message : String(kimiError),
            })
          }
          await appendTrackedEvent({
            type: 'initial_component_failed',
            taskId,
            provider: 'kimi',
            error: kimiError instanceof Error ? kimiError.message : String(kimiError),
          })
          await syncTrace('running')
        }
      }
    }
    let nextStageName = 'draft'

    for (let iteration = 1; iteration <= pipelineDefaults.maxIterations; iteration += 1) {
      const stageName = iteration === 1 ? 'draft' : slugify(nextStageName || `repair-${iteration}`)
      const stageDirectory = path.join(taskPaths.stagesRoot, getStageDirectoryName(iteration, stageName))

      await ensureDir(stageDirectory)
      await updateTimeline(
        buildTaskSummary({
          taskId,
          createdAt,
          inputImage: toPublicRelative(sourceCopyPath),
          stages,
          bestStage,
          status: 'running',
          activeStepLabel: `${stageName} 进行中`,
          runningStage: {
            index: iteration,
            name: stageName,
            placeholderMessage: '正在生成组件、渲染截图并执行检测…',
          },
          trace: traceRecorder.snapshot('running', eventCount),
          ...summaryMeta,
        }),
      )

      const componentPath = path.join(stageDirectory, 'component.vue')
      const screenshotPath = path.join(stageDirectory, 'render.png')
      const diffTargetPath = path.join(stageDirectory, 'diff-target.png')
      const diffPrevPath = latestStage ? path.join(stageDirectory, 'diff-prev.png') : undefined
      const repairReportPath = path.join(stageDirectory, 'repair-report.json')
      const metricsPath = path.join(stageDirectory, 'metrics.json')
      const debugPath = path.join(stageDirectory, 'debug-stats.json')
      const domSnapshotPath = path.join(stageDirectory, 'dom-snapshot.json')

      await writeText(componentPath, `${workingComponent}\n`)

      const renderTraceId = traceRecorder.start(stageName, 'render', {
        stageIndex: iteration,
      })
      const render = await renderer.renderStage({
        taskId,
        stageId: getStageDirectoryName(iteration, stageName),
        componentSource: workingComponent,
        scene,
        screenshotPath,
        domSnapshotPath,
      })
      traceRecorder.finish(renderTraceId, 'completed', {
        details: {
          renderHash: render.renderHash,
        },
      })

      const analyzeTraceId = traceRecorder.start(stageName, 'analyze', {
        stageIndex: iteration,
      })
      const analysis = await analyzeStage({
        scene,
        referenceImagePath: sourceCopyPath,
        render,
        diffTargetPath,
        diffPrevPath,
        previousScreenshotPath: latestStage?.screenshotPath,
      })
      traceRecorder.finish(analyzeTraceId, 'completed', {
        details: {
          visualSimilarity: analysis.metrics.visualSimilarity,
          criticalIssueCount: analysis.metrics.criticalIssueCount,
        },
      })

      const stage: StageArtifact = {
        index: iteration,
        name: stageName,
        directory: stageDirectory,
        componentPath,
        screenshotPath,
        diffTargetPath,
        diffPrevPath,
        repairReportPath,
        metricsPath,
        debugPath,
        domSnapshotPath,
        componentSource: workingComponent,
        render,
        repairReport: analysis.repairReport,
        metrics: analysis.metrics,
        renderMode: {
          preference: renderPreference,
          actual: detectStageRenderMode(workingComponent, scene),
        },
        debugStats: undefined,
        score: scoreStage(analysis.metrics),
      }

      stage.debugStats = computeDebugStats(latestStage, stage)

      await writeJson(repairReportPath, stage.repairReport)
      await writeJson(metricsPath, stage.metrics)
      await writeJson(debugPath, stage.debugStats ?? {})

      stages.push(stage)
      latestStage = stage

      if (!bestStage || stage.score > bestStage.score) {
        bestStage = stage
      }

      for (const issue of stage.repairReport.issues) {
        issueHistory.set(issue.signature, (issueHistory.get(issue.signature) ?? 0) + 1)
      }

      await appendTrackedEvent({
        type: 'stage_completed',
        taskId,
        stageIndex: iteration,
        stageName,
        metrics: stage.metrics,
        debug: stage.debugStats,
      })
      await syncTrace('running')
      await updateTimeline(
        buildTaskSummary({
          taskId,
          createdAt,
          inputImage: toPublicRelative(sourceCopyPath),
          stages,
          bestStage,
          status: 'running',
          activeStepLabel: '分析修复建议中',
          trace: traceRecorder.snapshot('running', eventCount),
          ...summaryMeta,
        }),
      )

      if (isSuccess(stage.metrics)) {
        exitReason = 'success'
        break
      }

      if (Date.now() - startTime > pipelineDefaults.maxDurationMs) {
        exitReason = 'max_duration'
        break
      }

      const previousStage = stages[stages.length - 2]
      const visualGain = previousStage
        ? stage.metrics.visualSimilarity - previousStage.metrics.visualSimilarity
        : stage.metrics.visualSimilarity
      const criticalImproved =
        previousStage && previousStage.metrics.criticalIssueCount > stage.metrics.criticalIssueCount

      if (visualGain < pipelineDefaults.minVisualGain && !criticalImproved) {
        noProgressRounds += 1
      } else {
        noProgressRounds = 0
      }

      if (noProgressRounds >= pipelineDefaults.maxNoProgressRounds) {
        exitReason = 'no_progress'
        break
      }

      if (
        stages.length >= 3 &&
        stage.render.renderHash === stages[stages.length - 3]?.render.renderHash
      ) {
        exitReason = 'oscillation_detected'
        break
      }

      if ([...issueHistory.values()].some((count) => count >= pipelineDefaults.maxSameIssueRepeats)) {
        exitReason = 'same_issue_repeated'
        break
      }

      if (
        previousStage &&
        stage.metrics.criticalIssueCount > previousStage.metrics.criticalIssueCount &&
        stage.metrics.visualSimilarity < previousStage.metrics.visualSimilarity - 0.01
      ) {
        exitReason = 'regression_detected'
        break
      }

      if (iteration >= pipelineDefaults.maxIterations) {
        exitReason = 'max_iterations'
        break
      }

      let repairTraceId: string | undefined
      let kimiAttemptedFromNoOp = false
      const allowKimiRepairFallback = Boolean(
        kimi && shouldUseKimiRepairFallback(scene, stage, renderPreference, infographicInput),
      )
      try {
        if (codexQuotaMode) {
          throw new Error('Codex quota mode enabled')
        }
        repairTraceId = traceRecorder.start(`repair-${iteration}`, 'repair', {
          stageIndex: iteration,
        })
        const baseStage = bestStage && bestStage.score > stage.score ? bestStage : stage
        const repairPrompt = shouldUseCompactRepair(scene, stage, renderPreference)
          ? createCompactRepairPrompt(
              scene,
              baseStage,
              stage.repairReport,
              renderPreference,
              ocrHint,
              bestStage,
            )
          : createRepairPrompt(
              scene,
              baseStage,
              stage.repairReport,
              renderPreference,
              ocrHint,
              bestStage,
            )
        const repair = await codex.runStructured<ComponentResponse>({
          label: `repair-${iteration}`,
          prompt: repairPrompt,
          schema: componentResponseSchema,
        })
        const repairedComponent = ensureRenderableSfc(repair.component, scene)
        if (repairedComponent.trim() === workingComponent.trim() && allowKimiRepairFallback && kimi) {
          kimiAttemptedFromNoOp = true
          await appendTrackedEvent({
            type: 'repair_noop_detected',
            taskId,
            stageIndex: iteration,
            provider: 'codex',
          })

          const kimiRepair = await kimi.complete({
            systemPrompt:
              '你是一个严格的 Vue 组件修复器。你只能返回完整 Vue SFC，不要解释，不要 markdown。',
            prompt: `${repairPrompt}\n\n只输出完整 Vue SFC。`,
            timeoutMs: kimiTimeoutMs,
          })
          workingComponent = ensureRenderableSfc(kimiRepair.text, scene)
          nextStageName = `kimi-repair-${iteration + 1}`
          traceRecorder.finish(repairTraceId, 'completed', {
            details: {
              provider: 'kimi',
            },
          })
        } else {
          workingComponent = repairedComponent
          nextStageName = repair.summary || `repair-${iteration + 1}`
          traceRecorder.finish(repairTraceId, 'completed', {
            details: {
              provider: 'codex',
            },
          })
        }
        await syncTrace('running')
      } catch (error) {
        const forceKimiOnCodexFailure = Boolean(kimi && recordCodexQuotaMode(error))
        if (repairTraceId) {
          traceRecorder.finish(repairTraceId, 'failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
        await appendTrackedEvent({
          type: 'repair_failed',
          taskId,
          stageIndex: iteration,
          error: error instanceof Error ? error.message : String(error),
        })
        if (forceKimiOnCodexFailure) {
          await appendTrackedEvent({
            type: 'provider_state_changed',
            taskId,
            provider: 'codex',
            label: 'quota-mode-enabled',
          })
        }
        if ((allowKimiRepairFallback || forceKimiOnCodexFailure) && kimi && !kimiAttemptedFromNoOp) {
          const fallbackBaseStage = bestStage ?? latestStage ?? stage
          const fallbackPrompt = shouldUseCompactRepair(scene, stage, renderPreference)
            ? createCompactRepairPrompt(
                scene,
                fallbackBaseStage,
                stage.repairReport,
                renderPreference,
                ocrHint,
                bestStage,
              )
            : createRepairPrompt(
                scene,
                fallbackBaseStage,
                stage.repairReport,
                renderPreference,
                ocrHint,
                bestStage,
              )
          let kimiFallbackTraceId: string | undefined
          try {
            kimiFallbackTraceId = traceRecorder.start(`repair-kimi-${iteration}`, 'repair', {
              stageIndex: iteration,
            })
            const kimiRepair = await kimi.complete({
              systemPrompt:
                '你是一个严格的 Vue 组件修复器。你只能返回完整 Vue SFC，不要解释，不要 markdown。',
              prompt: `${fallbackPrompt}\n\n只输出完整 Vue SFC。`,
              timeoutMs: kimiTimeoutMs,
            })
            workingComponent = ensureRenderableSfc(kimiRepair.text, scene)
            nextStageName = `kimi-fallback-${iteration + 1}`
            traceRecorder.finish(kimiFallbackTraceId, 'completed', {
              details: {
                provider: 'kimi',
              },
            })
          } catch (kimiError) {
            if (kimiFallbackTraceId) {
              traceRecorder.finish(kimiFallbackTraceId, 'failed', {
                error: kimiError instanceof Error ? kimiError.message : String(kimiError),
              })
            }
            workingComponent = buildFallbackComponent(scene)
            nextStageName = `fallback-${iteration + 1}`
          }
        } else {
          workingComponent = buildFallbackComponent(scene)
          nextStageName = `fallback-${iteration + 1}`
        }
        await syncTrace('running')
      }
    }
  } catch (error) {
    traceRecorder.finish(taskTraceId, 'failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    await appendTrackedEvent({
      type: 'task_failed',
      taskId,
      error: error instanceof Error ? error.message : String(error),
    })

    if (!bestStage) {
      await updateTimeline(
        buildTaskSummary({
          taskId,
          createdAt,
          inputImage: toPublicRelative(sourceCopyPath),
          stages,
          status: 'completed',
          exitReason: 'model_error',
          trace: traceRecorder.snapshot('completed', eventCount),
          ...summaryMeta,
        }),
      )
      await syncTrace('completed')
      throw error
    }

    exitReason = 'render_error'
  } finally {
    await renderer.stop()
  }

  if (!bestStage) {
    throw new Error('任务未能产生任何阶段输出')
  }

  const aggregateDebug = {
    taskId,
    summary: {
      totalStages: stages.length,
      bestStage: bestStage.index,
      overallAdherenceRate: (() => {
        const values = stages
          .map((stage) => stage.debugStats?.overallAdherenceRate)
          .filter((value): value is number => typeof value === 'number')

        if (!values.length) {
          return 0
        }

        return values.reduce((sum, value) => sum + value, 0) / values.length
      })(),
    },
    stages: stages
      .filter((stage) => stage.debugStats)
      .map((stage) => ({
        stageIndex: stage.index,
        fromStage: stage.index - 1,
        toStage: stage.index,
        scores: stage.debugStats,
      })),
  }

  await writeJson(taskPaths.debugStatsPath, aggregateDebug)
  await writeJson(taskPaths.issueHistoryPath, Object.fromEntries(issueHistory.entries()))
  await writeJson(taskPaths.metaPath, {
    ...(await readJson<Record<string, unknown>>(taskPaths.metaPath)),
    exitReason,
    bestStageIndex: bestStage.index,
    finalStageIndex: stages.at(-1)?.index ?? bestStage.index,
    metExpectation: isSuccess(bestStage.metrics),
  })

  traceRecorder.finish(taskTraceId, 'completed', {
    details: {
      exitReason,
      bestStageIndex: bestStage.index,
    },
  })
  const completedTrace = traceRecorder.snapshot('completed', eventCount)
  const summary: TaskTimelineSummary = {
    ...buildTaskSummary({
      taskId,
      createdAt,
      inputImage: toPublicRelative(sourceCopyPath),
      stages,
      bestStage,
      status: 'completed',
      exitReason,
      trace: completedTrace,
      ...summaryMeta,
    }),
  }

  await updateTimeline(summary)
  await writeTrace(taskId, completedTrace)
  await appendTrackedEvent({
    type: 'task_finished',
    taskId,
    exitReason,
    bestStageIndex: bestStage.index,
  })
  await writeTrace(taskId, traceRecorder.snapshot('completed', eventCount))

  return {
    taskId,
    exitReason,
    summary,
    bestStage,
    stages,
    metExpectation: isSuccess(bestStage.metrics),
    reasons: buildReasons(bestStage.metrics, exitReason),
  }
}
