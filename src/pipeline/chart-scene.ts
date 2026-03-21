import type { Constraint, Frame, SceneDocument, SceneNode } from './types'

export interface OcrWordHint {
  text: string
  location?: number[]
}

interface ChartAxis {
  label?: string
  categories?: string[]
  min?: number
  max?: number
  step?: number
}

interface ChartSeries {
  name: string
  data: number[]
  color?: string
}

interface ChartLegend {
  items?: Array<{
    name: string
    color?: string
  }>
}

interface ChartSpec {
  type: string
  subtype?: string
  title?: string
  xAxis?: ChartAxis
  yAxis?: ChartAxis
  series?: ChartSeries[]
  legend?: ChartLegend
}

const defaultSeriesPalette = ['#2F80ED', '#39C1C9', '#FFC83D', '#34C759']

function asChartSpec(value: unknown) {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const spec = value as ChartSpec
  if (spec.type !== 'chart' || !Array.isArray(spec.series) || !spec.series.length) {
    return undefined
  }

  return spec
}

function normalizeColor(color: string | undefined, index: number) {
  const normalized = color?.trim().toLowerCase()
  if (!normalized) {
    return defaultSeriesPalette[index % defaultSeriesPalette.length]
  }

  if (normalized === '#1f77b4') {
    return '#2F80ED'
  }

  if (normalized === '#17becf') {
    return '#39C1C9'
  }

  return color ?? defaultSeriesPalette[index % defaultSeriesPalette.length]
}

function locationToFrame(location: number[] | undefined): Frame | undefined {
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

function wordMatches(word: OcrWordHint, target: string) {
  return word.text.replace(/\s+/g, '').toLowerCase() === target.replace(/\s+/g, '').toLowerCase()
}

function findWord(words: OcrWordHint[], target: string) {
  return words.find((word) => wordMatches(word, target))
}

function inferPlotFrame(
  width: number,
  height: number,
  spec: ChartSpec,
  words: OcrWordHint[],
) {
  const categorySet = new Set(spec.xAxis?.categories ?? [])
  const categoryFrames = words
    .filter((word) => categorySet.has(word.text))
    .map((word) => locationToFrame(word.location))
    .filter(Boolean) as Frame[]
  const valueFrames = words
    .filter((word) => /^-?\d+(?:\.\d+)?$/.test(word.text))
    .map((word) => locationToFrame(word.location))
    .filter(Boolean) as Frame[]
  const legendFrames = (spec.legend?.items ?? spec.series ?? [])
    .map((item) => findWord(words, item.name))
    .map((word) => locationToFrame(word?.location))
    .filter(Boolean) as Frame[]

  const left = valueFrames.length
    ? Math.max(...valueFrames.map((frame) => frame.x + frame.width)) + 24
    : Math.round(width * 0.12)
  const right = categoryFrames.length
    ? Math.max(...categoryFrames.map((frame) => frame.x + frame.width / 2)) + 80
    : width - Math.round(width * 0.06)
  const bottom = categoryFrames.length
    ? Math.min(...categoryFrames.map((frame) => frame.y)) - 20
    : height - Math.round(height * 0.12)
  const top = legendFrames.length
    ? Math.max(...legendFrames.map((frame) => frame.y + frame.height)) + 36
    : Math.round(height * 0.1)

  return {
    x: Math.max(32, left),
    y: Math.max(32, top),
    width: Math.max(120, Math.min(width - 32, right) - Math.max(32, left)),
    height: Math.max(120, bottom - Math.max(32, top)),
    rotation: 0,
  }
}

function buildGridLines(plot: Frame, min: number, max: number, step: number) {
  const values: number[] = []
  for (let value = min; value <= max; value += step) {
    values.push(value)
  }

  return values
    .map((value) => {
      const ratio = max === min ? 0 : (value - min) / (max - min)
      const y = plot.height - ratio * plot.height
      return `<line x1="0" y1="${y}" x2="${plot.width}" y2="${y}" stroke="#E8EDF5" stroke-dasharray="4 6" stroke-width="1" />`
    })
    .join('\n')
}

function buildBarMarks(plot: Frame, spec: ChartSpec, min: number, max: number) {
  const categories = spec.xAxis?.categories ?? []
  const series = spec.series ?? []
  const groupWidth = plot.width / Math.max(categories.length, 1)
  const barWidth = Math.max(12, Math.min(56, groupWidth / Math.max(series.length + 0.6, 1.6)))

  return categories
    .flatMap((_, categoryIndex) =>
      series.map((entry, seriesIndex) => {
        const value = entry.data[categoryIndex] ?? 0
        const ratio = max === min ? 0 : (value - min) / (max - min)
        const barHeight = Math.max(0, ratio * plot.height)
        const fill = normalizeColor(entry.color, seriesIndex)
        const x =
          categoryIndex * groupWidth +
          (groupWidth - series.length * barWidth) / 2 +
          seriesIndex * barWidth
        const y = plot.height - barHeight

        return `<rect x="${x}" y="${y}" width="${barWidth - 4}" height="${barHeight}" fill="${fill}" rx="1" />`
      }),
    )
    .join('\n')
}

function buildLineMarks(plot: Frame, spec: ChartSpec, min: number, max: number) {
  const categories = spec.xAxis?.categories ?? []
  const series = spec.series ?? []
  const xStep = categories.length > 1 ? plot.width / (categories.length - 1) : plot.width

  return series
    .map((entry, index) => {
      const stroke = normalizeColor(entry.color, index)
      const points = entry.data
        .map((value, index) => {
          const ratio = max === min ? 0 : (value - min) / (max - min)
          const x = index * xStep
          const y = plot.height - ratio * plot.height
          return `${x},${y}`
        })
        .join(' ')

      const circles = entry.data
        .map((value, index) => {
          const ratio = max === min ? 0 : (value - min) / (max - min)
          const x = index * xStep
          const y = plot.height - ratio * plot.height
          return `<circle cx="${x}" cy="${y}" r="3" fill="${stroke}" />`
        })
        .join('\n')

      return `<polyline fill="none" stroke="${stroke}" stroke-width="4" points="${points}" />\n${circles}`
    })
    .join('\n')
}

function isMostlyCjk(content: string) {
  const compact = content.replace(/\s+/g, '')
  return compact.length > 0 && [...compact].every((char) => /[\u3040-\u30ff\u3400-\u9fff]/.test(char))
}

function estimateFontSize(frame: Frame, content: string) {
  const compact = content.replace(/\s+/g, '')
  const charCount = Math.max(compact.length, 1)
  const verticalCjk = isMostlyCjk(content) && frame.height >= frame.width * 2.4
  const heightBased = frame.height * 0.72
  const widthBased = verticalCjk
    ? frame.width * 0.72
    : frame.width / Math.max(charCount * 0.62, 1)

  return Math.max(12, Math.min(28, Math.round(Math.min(heightBased, widthBased * 1.15))))
}

function createTextNode(id: string, frame: Frame, content: string, zIndex: number): SceneNode {
  const fontSize = estimateFontSize(frame, content)

  return {
    id,
    type: 'text',
    render: 'html',
    parentId: 'card',
    frame,
    zIndex,
    opacity: 1,
    text: {
      content,
      fontFamily: 'Arial',
      fontWeight: /^[0-9.]+$/.test(content) ? 400 : 500,
      fontSize,
      lineHeight: Math.round(fontSize * 1.2),
      letterSpacing: 0,
      color: /^[0-9.]+$/.test(content) ? '#9AA0A6' : '#4B5563',
      align: 'left',
      wrap: 'nowrap',
      overflow: 'clip',
      box: {
        width: frame.width,
        height: frame.height,
      },
    },
  }
}

export function buildSceneFromChartSpec(options: {
  rawSpec: unknown
  imagePath: string
  width: number
  height: number
  words: OcrWordHint[]
}) {
  const spec = asChartSpec(options.rawSpec)
  if (!spec) {
    return undefined
  }

  const categories = spec.xAxis?.categories ?? []
  const series = spec.series ?? []
  const subtype = (spec.subtype ?? '').toLowerCase()
  if (!categories.length || !series.length) {
    return undefined
  }

  const plot = inferPlotFrame(options.width, options.height, spec, options.words)
  const dataValues = series.flatMap((entry) => entry.data)
  const min = Number(spec.yAxis?.min ?? 0)
  const max = Number(spec.yAxis?.max ?? Math.max(...dataValues, 0))
  const step = Number(spec.yAxis?.step ?? Math.max(10, Math.round((max - min) / 4 / 10) * 10))

  const marks =
    subtype.includes('line') || series.length >= 3
      ? buildLineMarks(plot, spec, min, max)
      : buildBarMarks(plot, spec, min, max)

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${plot.width} ${plot.height}">
  <g>
    ${buildGridLines(plot, min, max, step)}
    ${marks}
  </g>
</svg>
  `.trim()

  const nodes: SceneNode[] = [
    {
      id: 'card',
      type: 'container',
      render: 'html',
      parentId: null,
      frame: { x: 0, y: 0, width: options.width, height: options.height, rotation: 0 },
      zIndex: 0,
      opacity: 1,
      style: {
        fills: ['#FFFFFF'],
        background: '#FFFFFF',
      },
    },
    {
      id: 'chart-svg',
      type: 'chart-svg',
      render: 'svg',
      parentId: 'card',
      frame: plot,
      zIndex: 10,
      opacity: 1,
      svg,
    },
  ]

  let zIndex = 20
  const legendItems = spec.legend?.items?.length
    ? spec.legend.items
    : series.map((entry, index) => ({ name: entry.name, color: normalizeColor(entry.color, index) }))

  for (const [legendIndex, item] of legendItems.entries()) {
    const word = findWord(options.words, item.name)
    const frame = locationToFrame(word?.location)
    if (!frame) {
      continue
    }

    nodes.push({
      id: `legend-${item.name.toLowerCase()}-swatch`,
      type: 'swatch',
      render: 'html',
      parentId: 'card',
      frame: {
        x: Math.max(8, frame.x - 28),
        y: frame.y + Math.round(frame.height / 2) - 8,
        width: 16,
        height: 16,
        rotation: 0,
      },
      zIndex: zIndex,
      opacity: 1,
      style: {
        fills: [normalizeColor(item.color, legendIndex)],
        background: normalizeColor(item.color, legendIndex),
      },
      clip: {
        enabled: true,
        overflow: 'hidden',
        radius: [8, 8, 8, 8],
      },
    })
    nodes.push(createTextNode(`legend-${item.name.toLowerCase()}-text`, frame, item.name, zIndex + 1))
    zIndex += 2
  }

  for (const category of categories) {
    const word = findWord(options.words, category)
    const frame = locationToFrame(word?.location)
    if (frame) {
      nodes.push(createTextNode(`x-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, frame, category, zIndex))
      zIndex += 1
    }
  }

  const axisLabelCandidates = [spec.yAxis?.label, spec.xAxis?.label].filter(Boolean) as string[]
  for (const label of axisLabelCandidates) {
    const word = findWord(options.words, label)
    const frame = locationToFrame(word?.location)
    if (frame) {
      nodes.push(createTextNode(`label-${label}`, frame, label, zIndex))
      zIndex += 1
    }
  }

  const yValues: string[] = []
  for (let value = min; value <= max; value += step) {
    yValues.push(String(value))
  }
  for (const value of yValues) {
    const word = findWord(options.words, value)
    const frame = locationToFrame(word?.location)
    if (frame) {
      nodes.push(createTextNode(`tick-${value}`, frame, value, zIndex))
      zIndex += 1
    }
  }

  const constraints: Constraint[] = nodes
    .filter((node) => node.id !== 'card')
    .map((node) => ({
      type: 'inside-parent',
      nodeId: node.id,
      parentId: 'card',
      tolerance: 2,
    }))

  return {
    version: '1.0',
    mode: 'clone-static',
    summary: spec.title ?? `${spec.subtype ?? 'chart'} chart`,
    source: {
      image: options.imagePath,
      width: options.width,
      height: options.height,
      dpr: 1,
    },
    artboard: {
      width: options.width,
      height: options.height,
      background: '#FFFFFF',
      clip: false,
    },
    nodes,
    constraints,
  } satisfies SceneDocument
}
