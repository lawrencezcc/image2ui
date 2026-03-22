import type { SceneDocument, SceneNode } from './types'
import { slugify } from './utils'

export interface InfographicOcrWord {
  text: string
  location?: number[]
}

function locationToFrame(location: number[] | undefined) {
  if (!location || location.length < 8) {
    return undefined
  }

  const xs = [location[0], location[2], location[4], location[6]]
  const ys = [location[1], location[3], location[5], location[7]]
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    rotation: 0,
  }
}

function unionFrames(
  frames: Array<{
    x: number
    y: number
    width: number
    height: number
    rotation: number
  }>,
) {
  const minX = Math.min(...frames.map((frame) => frame.x))
  const minY = Math.min(...frames.map((frame) => frame.y))
  const maxX = Math.max(...frames.map((frame) => frame.x + frame.width))
  const maxY = Math.max(...frames.map((frame) => frame.y + frame.height))

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    rotation: 0,
  }
}

function expandFrame(
  frame: {
    x: number
    y: number
    width: number
    height: number
    rotation: number
  },
  padding: { top?: number; right?: number; bottom?: number; left?: number },
  width: number,
  height: number,
) {
  const left = Math.max(0, frame.x - (padding.left ?? 0))
  const top = Math.max(0, frame.y - (padding.top ?? 0))
  const right = Math.min(width, frame.x + frame.width + (padding.right ?? 0))
  const bottom = Math.min(height, frame.y + frame.height + (padding.bottom ?? 0))

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    rotation: 0,
  }
}

function groupWordsIntoLines(words: Array<{ text: string; frame: NonNullable<ReturnType<typeof locationToFrame>> }>) {
  const sorted = [...words].sort((left, right) => left.frame.y - right.frame.y || left.frame.x - right.frame.x)
  const lines: Array<typeof sorted> = []

  for (const word of sorted) {
    const existing = lines.find((line) => {
      const centerY = line.reduce((sum, entry) => sum + entry.frame.y + entry.frame.height / 2, 0) / line.length
      const wordCenterY = word.frame.y + word.frame.height / 2
      return Math.abs(centerY - wordCenterY) <= Math.max(18, word.frame.height * 0.8)
    })

    if (existing) {
      existing.push(word)
    } else {
      lines.push([word])
    }
  }

  return lines
    .map((line) => {
      const ordered = [...line].sort((left, right) => left.frame.x - right.frame.x)
      return {
        text: ordered.map((entry) => entry.text).join(''),
        frame: unionFrames(ordered.map((entry) => entry.frame)),
      }
    })
    .filter((line) => line.text.trim())
}

function clusterByColumns(
  words: Array<{ text: string; frame: NonNullable<ReturnType<typeof locationToFrame>> }>,
  width: number,
) {
  const sorted = [...words].sort(
    (left, right) =>
      left.frame.x + left.frame.width / 2 - (right.frame.x + right.frame.width / 2),
  )
  const groups: typeof sorted[] = []
  const threshold = Math.max(56, width * 0.08)

  for (const word of sorted) {
    const centerX = word.frame.x + word.frame.width / 2
    const group = groups.find((entries) => {
      const avgCenter =
        entries.reduce((sum, entry) => sum + entry.frame.x + entry.frame.width / 2, 0) / entries.length
      return Math.abs(avgCenter - centerX) <= threshold
    })

    if (group) {
      group.push(word)
    } else {
      groups.push([word])
    }
  }

  return groups
    .map((group) => group.sort((left, right) => left.frame.y - right.frame.y || left.frame.x - right.frame.x))
    .filter((group) => group.length > 0)
}

function createTextNode(
  id: string,
  frame: {
    x: number
    y: number
    width: number
    height: number
    rotation: number
  },
  text: string,
  zIndex: number,
  options?: {
    fontWeight?: number
    color?: string
    align?: 'left' | 'center' | 'right'
  },
): SceneNode {
  const compact = text.replace(/\s+/g, '')
  const fontSize = Math.max(
    14,
    Math.min(34, Math.round(Math.min(frame.height * 0.82, frame.width / Math.max(compact.length * 0.62, 1)))),
  )

  return {
    id,
    type: 'text',
    render: 'html',
    parentId: 'card',
    frame,
    zIndex,
    opacity: 1,
    text: {
      content: text,
      fontFamily: 'Arial',
      fontWeight: options?.fontWeight ?? 600,
      fontSize,
      lineHeight: Math.round(fontSize * 1.2),
      letterSpacing: 0,
      color: options?.color ?? '#121926',
      align: options?.align ?? 'left',
      wrap: 'nowrap',
      overflow: 'clip',
      direction: 'horizontal',
      box: {
        width: frame.width,
        height: frame.height,
      },
    },
  }
}

export function buildInfographicSceneFromOcr(params: {
  imagePath: string
  width: number
  height: number
  words: InfographicOcrWord[]
  promptText?: string
}) {
  const prompt = params.promptText ?? ''
  if (!/(infographic|信息图|流程图|时间线|阶段卡片|训练计划)/i.test(prompt)) {
    return undefined
  }

  const wordFrames = params.words
    .map((word) => {
      const frame = locationToFrame(word.location)
      return frame ? { text: word.text.trim(), frame } : undefined
    })
    .filter(Boolean) as Array<{
    text: string
    frame: NonNullable<ReturnType<typeof locationToFrame>>
  }>

  if (wordFrames.length < 6) {
    return undefined
  }

  const bodyWords = wordFrames.filter((word) => word.frame.y > params.height * 0.22)
  if (bodyWords.length < 4) {
    return undefined
  }

  const columns = clusterByColumns(bodyWords, params.width)
    .filter((group) => group.length >= 2)
    .slice(0, 4)

  if (!columns.length) {
    return undefined
  }

  const nodes: SceneNode[] = [
    {
      id: 'card',
      type: 'container',
      render: 'html',
      parentId: null,
      frame: {
        x: 0,
        y: 0,
        width: params.width,
        height: params.height,
        rotation: 0,
      },
      zIndex: 0,
      opacity: 1,
      style: {
        fills: ['#FFFFFF'],
        background: '#FFFFFF',
      },
    },
  ]

  const topBoundary = Math.min(...columns.map((group) => group[0]?.frame.y ?? params.height * 0.32))
  if (topBoundary > params.height * 0.18) {
    nodes.push({
      id: 'header-image',
      type: 'image',
      render: 'html',
      parentId: 'card',
      frame: {
        x: 0,
        y: 0,
        width: params.width,
        height: Math.min(params.height * 0.42, topBoundary + 80),
        rotation: 0,
      },
      zIndex: 4,
      opacity: 1,
      asset: {
        source: 'crop',
      },
      notes: '顶部日历、箭头、复杂装饰统一裁剪为原子图片素材',
    })
  }

  let zIndex = 10

  for (const [columnIndex, group] of columns.entries()) {
    const badgeWord =
      group.find((entry) => /天$/.test(entry.text) || /^[0-9]+$/.test(entry.text)) ?? group[0]
    const textWords = group.filter((entry) => entry !== badgeWord)
    const lineEntries = groupWordsIntoLines(textWords)

    if (!lineEntries.length) {
      continue
    }

    const textBounds = unionFrames(lineEntries.map((entry) => entry.frame))
    const cardFrame = expandFrame(
      textBounds,
      { top: 42, right: 36, bottom: 48, left: 36 },
      params.width,
      params.height,
    )

    nodes.push({
      id: `info-card-${columnIndex + 1}`,
      type: 'container',
      render: 'html',
      parentId: 'card',
      frame: cardFrame,
      zIndex,
      opacity: 1,
      style: {
        fills: ['#EEF1FF'],
        background: '#EEF1FF',
      },
      clip: {
        enabled: true,
        overflow: 'hidden',
        radius: [28, 28, 28, 28],
      },
    })

    if (badgeWord) {
      nodes.push({
        id: `badge-image-${columnIndex + 1}`,
        type: 'image',
        render: 'html',
        parentId: 'card',
        frame: expandFrame(
          badgeWord.frame,
          {
            top: 56,
            right: 40,
            bottom: 34,
            left: 40,
          },
          params.width,
          params.height,
        ),
        zIndex: zIndex + 2,
        opacity: 1,
        asset: {
          source: 'crop',
        },
        notes: '复杂徽章、冠冕、渐变圆角标识裁剪为原子图片素材',
      })
    }

    for (const [lineIndex, line] of lineEntries.entries()) {
      nodes.push(
        createTextNode(
          `info-text-${columnIndex + 1}-${lineIndex + 1}-${slugify(line.text)}`,
          line.frame,
          line.text,
          zIndex + 1,
          {
            fontWeight: /天$/.test(line.text) ? 700 : 600,
            color: '#101828',
          },
        ),
      )
    }

    zIndex += 4
  }

  return {
    version: '1.0',
    mode: 'clone-static' as const,
    summary: 'ocr-infographic-fallback',
    source: {
      image: params.imagePath,
      width: params.width,
      height: params.height,
      dpr: 1,
    },
    artboard: {
      width: params.width,
      height: params.height,
      background: '#FFFFFF',
      clip: false,
    },
    nodes,
    constraints: nodes
      .filter((node) => node.parentId === 'card' && node.id !== 'card')
      .map((node) => ({
        type: 'inside-parent' as const,
        nodeId: node.id,
        parentId: 'card',
      })),
  } satisfies SceneDocument
}
