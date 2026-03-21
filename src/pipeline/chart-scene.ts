import {
  loadRawImageSampler,
  sampleBarColor,
  sampleLegendSwatchColor,
  traceLineSeries,
} from './image-sampler'
import type {
  CanvasChartOverlay,
  CanvasChartSeries,
  CanvasChartSpec,
  ChartPoint,
  Constraint,
  Frame,
  RenderPreference,
  SceneDocument,
  SceneNode,
} from './types'
import { clamp, slugify } from './utils'

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

interface RawChartPoint {
  x?: number
  y?: number
  label?: string
  value?: number
}

interface ChartSeries {
  name: string
  data: number[]
  color?: string
  fillColor?: string
  points?: RawChartPoint[]
  areaOpacity?: number
  lineDash?: number[]
}

interface ChartLegend {
  items?: Array<{
    name: string
    color?: string
  }>
}

interface ChartPlotHint {
  shape?: 'cartesian' | 'polar'
  innerRadiusRatio?: number
  stacked?: boolean
  stepLine?: boolean
}

interface ChartSpec {
  type: string
  subtype?: string
  title?: string
  xAxis?: ChartAxis
  yAxis?: ChartAxis
  series?: ChartSeries[]
  legend?: ChartLegend
  plotHint?: ChartPlotHint
}

interface NormalizedChartSeries {
  name: string
  data: number[]
  color: string
  fillColor?: string
  points?: ChartPoint[]
  areaOpacity?: number
  lineDash?: number[]
}

interface NormalizedChartSpec {
  kind:
    | 'grouped-bar'
    | 'stacked-bar'
    | 'line'
    | 'area'
    | 'radar'
    | 'donut'
    | 'pie'
    | 'scatter'
  title: string
  categories: string[]
  xAxisLabel: string
  yAxisLabel: string
  min: number
  max: number
  step: number
  innerRadiusRatio: number
  series: NormalizedChartSeries[]
  legendItems: Array<{
    name: string
    color: string
  }>
  overlays: CanvasChartOverlay[]
}

const defaultSeriesPalette = ['#2F80ED', '#39C1C9', '#FFC83D', '#34C759', '#9B59B6', '#FF7A1A']

function normalizeHexColor(color: string | undefined, index: number) {
  const normalized = color?.trim().toLowerCase()
  if (!normalized) {
    return defaultSeriesPalette[index % defaultSeriesPalette.length]
  }

  const aliases: Record<string, string> = {
    '#1f77b4': '#2F80ED',
    '#007bff': '#2F80ED',
    '#17becf': '#39C1C9',
    '#28a745': '#34C759',
    '#ffc107': '#FFC83D',
    '#f4a261': '#F6C58D',
    '#e9c46d': '#FF8A18',
  }

  if (aliases[normalized]) {
    return aliases[normalized]
  }

  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    return normalized.toUpperCase()
  }

  return defaultSeriesPalette[index % defaultSeriesPalette.length]
}

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

function normalizeToken(value: string) {
  return value.replace(/\s+/g, '').replace(/[.。:：,，]/g, '').toLowerCase()
}

function wordMatches(word: OcrWordHint, target: string) {
  const normalizedWord = normalizeToken(word.text)
  const normalizedTarget = normalizeToken(target)

  const numericLike = /^-?\d+(?:\.\d+)?$/.test(normalizedWord) || /^-?\d+(?:\.\d+)?$/.test(normalizedTarget)
  if (numericLike) {
    return normalizedWord === normalizedTarget
  }

  return (
    normalizedWord === normalizedTarget ||
    normalizedWord.includes(normalizedTarget) ||
    normalizedTarget.includes(normalizedWord)
  )
}

function findWord(words: OcrWordHint[], target: string) {
  return words.find((word) => wordMatches(word, target))
}

function findOutsidePlotWord(words: OcrWordHint[], target: string, plot: Frame) {
  const matches = words.filter((word) => wordMatches(word, target))
  if (!matches.length) {
    return undefined
  }

  const scored = matches
    .map((word) => {
      const frame = locationToFrame(word.location)
      if (!frame) {
        return undefined
      }

      const outsidePlot =
        frame.x + frame.width < plot.x - 8 ||
        frame.x > plot.x + plot.width + 8 ||
        frame.y + frame.height < plot.y - 8 ||
        frame.y > plot.y + plot.height + 8
      const centerX = frame.x + frame.width / 2
      const centerY = frame.y + frame.height / 2
      const plotCenterX = plot.x + plot.width / 2
      const plotCenterY = plot.y + plot.height / 2
      const distance = Math.abs(centerX - plotCenterX) + Math.abs(centerY - plotCenterY)

      return {
        word,
        frame,
        outsidePlot,
        score: (outsidePlot ? 0 : 10000) + distance,
      }
    })
    .filter(Boolean) as Array<{
    word: OcrWordHint
    frame: Frame
    outsidePlot: boolean
    score: number
  }>

  scored.sort((left, right) => left.score - right.score)
  return scored[0]?.word
}

function isMostlyCjk(content: string) {
  const compact = content.replace(/\s+/g, '')
  return compact.length > 0 && [...compact].every((char) => /[\u3040-\u30ff\u3400-\u9fff]/.test(char))
}

function estimateFontSize(
  frame: Frame,
  content: string,
  direction: 'horizontal' | 'vertical' | 'rotate-ccw' | 'rotate-cw' = 'horizontal',
) {
  const sizingFrame =
    direction === 'rotate-ccw' || direction === 'rotate-cw'
      ? {
          ...frame,
          width: frame.height,
          height: frame.width,
        }
      : frame
  const compact = content.replace(/\s+/g, '')
  const charCount = Math.max(compact.length, 1)
  const heightBased = sizingFrame.height * 0.74
  const widthBased = sizingFrame.width / Math.max(charCount * 0.62, 1)

  return Math.max(12, Math.min(28, Math.round(Math.min(heightBased, widthBased * 1.18))))
}

function createTextNode(
  id: string,
  frame: Frame,
  content: string,
  zIndex: number,
  options?: {
    direction?: 'horizontal' | 'vertical' | 'rotate-ccw' | 'rotate-cw'
    color?: string
    fontWeight?: number
    align?: 'left' | 'center' | 'right'
  },
): SceneNode {
  const direction = options?.direction ?? 'horizontal'
  const fontSize = estimateFontSize(frame, content, direction)
  const textBox =
    direction === 'rotate-ccw' || direction === 'rotate-cw'
      ? {
          width: frame.height,
          height: frame.width,
        }
      : {
          width: frame.width,
          height: frame.height,
        }

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
      fontWeight: options?.fontWeight ?? (/^[0-9.]+$/.test(content) ? 400 : 500),
      fontSize,
      lineHeight: Math.round(fontSize * 1.22),
      letterSpacing: 0,
      color: options?.color ?? (/^[0-9.]+$/.test(content) ? '#98A2B3' : '#4B5563'),
      align: options?.align ?? 'left',
      wrap: 'nowrap',
      overflow: 'clip',
      direction,
      box: textBox,
    },
  }
}

function buildLegendItems(spec: ChartSpec, series: NormalizedChartSeries[]) {
  if (spec.legend?.items?.length) {
    return spec.legend.items.map((item, index) => ({
      name: item.name || series[index]?.name || `Series ${index + 1}`,
      color: normalizeHexColor(item.color ?? series[index]?.color, index),
    }))
  }

  return series.map((entry) => ({
    name: entry.name,
    color: entry.color,
  }))
}

function resolveKind(spec: ChartSpec, promptText?: string) {
  const subtype = (spec.subtype ?? '').toLowerCase()
  const prompt = (promptText ?? '').toLowerCase()
  const categories = spec.xAxis?.categories ?? []

  if (subtype.includes('donut') || /环形|donut|ring/.test(prompt)) {
    return 'donut'
  }

  if (subtype.includes('pie') || (spec.series?.every((series) => series.data.length <= 1) ?? false)) {
    return /环形|donut|ring/.test(prompt) ? 'donut' : 'pie'
  }

  if (subtype.includes('radar') || (subtype === 'other' && categories.length >= 5 && (spec.series?.length ?? 0) >= 2)) {
    return 'radar'
  }

  if (subtype.includes('area')) {
    return 'area'
  }

  if (subtype.includes('scatter') || subtype.includes('point')) {
    return 'scatter'
  }

  if (subtype.includes('line')) {
    return 'line'
  }

  if (subtype.includes('bar') || subtype.includes('interval') || subtype.includes('column')) {
    return spec.plotHint?.stacked || categories.every((category) => !category.trim()) ? 'stacked-bar' : 'grouped-bar'
  }

  if (categories.length && (spec.series?.length ?? 0) <= 2 && categories.every((category) => !category.trim())) {
    return 'stacked-bar'
  }

  if (categories.length && /(折线|line)/.test(prompt)) {
    return 'line'
  }

  return 'grouped-bar'
}

function normalizeSeries(spec: ChartSpec): NormalizedChartSeries[] {
  return (spec.series ?? []).map((entry, index) => ({
    name: entry.name || `Series ${index + 1}`,
    data: Array.isArray(entry.data) ? entry.data.map((value) => Number(value) || 0) : [],
    color: normalizeHexColor(entry.color, index),
    fillColor: entry.fillColor ? normalizeHexColor(entry.fillColor, index) : undefined,
    points: Array.isArray(entry.points)
      ? entry.points
          .map((point) => ({
            x: clamp(Number(point.x ?? 0), 0, 1),
            y: clamp(Number(point.y ?? 0), 0, 1),
            value: typeof point.value === 'number' ? point.value : undefined,
            label: point.label,
          }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : undefined,
    areaOpacity: Number(entry.areaOpacity ?? 0.18),
    lineDash: Array.isArray(entry.lineDash) ? entry.lineDash.map((value) => Number(value) || 0) : undefined,
  }))
}

function normalizeChartSpec(spec: ChartSpec, promptText?: string): NormalizedChartSpec | undefined {
  const series = normalizeSeries(spec)
  if (!series.length) {
    return undefined
  }

  const categories = spec.xAxis?.categories?.map((value) => String(value)) ?? []
  const flatValues = series.flatMap((entry) => entry.data).filter((value) => Number.isFinite(value))
  const min = Number.isFinite(spec.yAxis?.min) ? Number(spec.yAxis?.min) : Math.min(0, ...flatValues, 0)
  const max = Number.isFinite(spec.yAxis?.max) ? Number(spec.yAxis?.max) : Math.max(...flatValues, 100)
  const step =
    Number.isFinite(spec.yAxis?.step) && Number(spec.yAxis?.step) > 0
      ? Number(spec.yAxis?.step)
      : Math.max(10, Math.round((max - min || 100) / 4 / 10) * 10)
  const kind = resolveKind(spec, promptText)
  const overlays: CanvasChartOverlay[] = []

  if (kind === 'stacked-bar' && series.length >= 2) {
    overlays.push({
      type: 'step-line',
      color: series[1]?.color ?? '#FF8A18',
      dash: [8, 6],
      data: [...series[0].data],
    })
  }

  return {
    kind,
    title: spec.title ?? '',
    categories,
    xAxisLabel: spec.xAxis?.label ?? '',
    yAxisLabel: spec.yAxis?.label ?? '',
    min,
    max: max <= min ? min + step * 4 : max,
    step,
    innerRadiusRatio: clamp(
      Number(spec.plotHint?.innerRadiusRatio ?? (kind === 'donut' ? 0.36 : 0.58)),
      0.22,
      0.78,
    ),
    series,
    legendItems: buildLegendItems(spec, series),
    overlays,
  }
}

function inferCartesianPlotFrame(
  width: number,
  height: number,
  spec: NormalizedChartSpec,
  words: OcrWordHint[],
) {
  const categorySet = new Set(spec.categories.filter(Boolean))
  const categoryFrames = words
    .filter((word) => categorySet.has(word.text))
    .map((word) => locationToFrame(word.location))
    .filter(Boolean) as Frame[]
  const valueFrames = words
    .filter((word) => /^-?\d+(?:\.\d+)?$/.test(word.text))
    .map((word) => locationToFrame(word.location))
    .filter(Boolean) as Frame[]
  const legendFrames = spec.legendItems
    .map((item) => findWord(words, item.name))
    .map((word) => locationToFrame(word?.location))
    .filter(Boolean) as Frame[]

  const left = valueFrames.length
    ? Math.max(...valueFrames.map((frame) => frame.x + frame.width)) + 24
    : Math.round(width * 0.1)
  const right = width - Math.round(width * 0.06)
  const bottom = categoryFrames.length
    ? Math.min(...categoryFrames.map((frame) => frame.y)) - 20
    : height - Math.round(height * 0.12)
  const top = legendFrames.length
    ? Math.max(...legendFrames.map((frame) => frame.y + frame.height)) + 30
    : Math.round(height * 0.12)

  return {
    x: clamp(left, 32, width - 160),
    y: clamp(top, 32, height - 180),
    width: Math.max(160, right - clamp(left, 32, width - 160)),
    height: Math.max(160, bottom - clamp(top, 32, height - 180)),
    rotation: 0,
  }
}

function inferPolarPlotFrame(width: number, height: number, spec: NormalizedChartSpec, words: OcrWordHint[]) {
  const legendFrames = spec.legendItems
    .map((item) => findWord(words, item.name))
    .map((word) => locationToFrame(word?.location))
    .filter(Boolean) as Frame[]
  const titleFrames = [spec.title]
    .filter(Boolean)
    .map((title) => findWord(words, title))
    .map((word) => locationToFrame(word?.location))
    .filter(Boolean) as Frame[]
  const topAnchor = [...legendFrames, ...titleFrames]
  const top = topAnchor.length ? Math.max(...topAnchor.map((frame) => frame.y + frame.height)) + 28 : 48
  const labelFrames = [
    ...spec.series
      .map((entry) =>
        findOutsidePlotWord(words, entry.name, {
          x: width * 0.26,
          y: height * 0.2,
          width: width * 0.48,
          height: height * 0.58,
          rotation: 0,
        }),
      )
      .map((word) => locationToFrame(word?.location))
      .filter(Boolean) as Frame[],
    ...spec.series
      .map((entry) => {
        const value = entry.data[0]
        if (!Number.isFinite(value)) {
          return undefined
        }
        const amount = `$${Number(value).toFixed(2)}`
        return (
          findOutsidePlotWord(words, amount, {
            x: width * 0.26,
            y: height * 0.2,
            width: width * 0.48,
            height: height * 0.58,
            rotation: 0,
          }) ??
          findOutsidePlotWord(words, amount.replace('.00', ''), {
            x: width * 0.26,
            y: height * 0.2,
            width: width * 0.48,
            height: height * 0.58,
            rotation: 0,
          })
        )
      })
      .map((word) => locationToFrame(word?.location))
      .filter(Boolean) as Frame[],
  ]
  const leftLabelMax = labelFrames.length
    ? Math.max(
        0,
        ...labelFrames
          .filter((frame) => frame.x + frame.width / 2 <= width / 2)
          .map((frame) => frame.x + frame.width),
      )
    : Math.round(width * 0.12)
  const rightLabelMin = labelFrames.length
    ? Math.min(
        width,
        ...labelFrames
          .filter((frame) => frame.x + frame.width / 2 >= width / 2)
          .map((frame) => frame.x),
      )
    : width - Math.round(width * 0.12)
  const left = clamp(leftLabelMax + 28, 48, width - 220)
  const right = clamp(rightLabelMin - 28, left + 180, width - 48)
  const bottom = height - 40
  const size = Math.max(180, Math.min(right - left, bottom - top))

  return {
    x: Math.round(left + Math.max(0, right - left - size) / 2),
    y: Math.round(top + Math.max(0, bottom - top - size) / 2),
    width: Math.round(size),
    height: Math.round(size),
    rotation: 0,
  }
}

function buildGridLines(plot: Frame, min: number, max: number, step: number) {
  const values: number[] = []
  for (let value = min; value <= max + 0.0001; value += step) {
    values.push(value)
  }

  return values
    .map((value) => {
      const ratio = max === min ? 0 : (value - min) / (max - min)
      const y = plot.height - ratio * plot.height
      return `<line x1="0" y1="${y}" x2="${plot.width}" y2="${y}" stroke="#E8EDF5" stroke-dasharray="4 8" stroke-width="1" />`
    })
    .join('\n')
}

function cartesianPoint(plot: Frame, xRatio: number, yRatio: number) {
  return {
    x: xRatio * plot.width,
    y: plot.height - yRatio * plot.height,
  }
}

function buildGroupedBarGeometry(plot: Frame, spec: NormalizedChartSpec) {
  const categories = spec.categories.length
    ? spec.categories
    : Array.from({ length: Math.max(...spec.series.map((entry) => entry.data.length), 0) }, () => '')
  const groupWidth = plot.width / Math.max(categories.length, 1)
  const seriesCount = Math.max(spec.series.length, 1)
  const barWidth = Math.max(12, Math.min(56, groupWidth / Math.max(seriesCount + 0.85, 1.8)))

  return categories.flatMap((_, categoryIndex) =>
    spec.series.map((entry, seriesIndex) => {
      const value = entry.data[categoryIndex] ?? 0
      const ratio = spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min)
      const barHeight = Math.max(0, ratio * plot.height)
      const x =
        categoryIndex * groupWidth +
        (groupWidth - seriesCount * barWidth) / 2 +
        seriesIndex * barWidth
      const y = plot.height - barHeight

      return {
        seriesIndex,
        value,
        x,
        y,
        width: barWidth - 4,
        height: barHeight,
      }
    }),
  )
}

function buildStackedBarGeometry(plot: Frame, spec: NormalizedChartSpec) {
  const categories = spec.categories.length
    ? spec.categories
    : Array.from({ length: Math.max(...spec.series.map((entry) => entry.data.length), 0) }, () => '')
  const groupWidth = plot.width / Math.max(categories.length, 1)
  const barWidth = Math.max(26, Math.min(120, groupWidth * 0.48))

  return categories.flatMap((_, categoryIndex) => {
    let runningHeight = 0

    return spec.series.map((entry, seriesIndex) => {
      const value = entry.data[categoryIndex] ?? 0
      const ratio = spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min)
      const barHeight = Math.max(0, ratio * plot.height)
      const x = categoryIndex * groupWidth + (groupWidth - barWidth) / 2
      const y = plot.height - runningHeight - barHeight
      runningHeight += barHeight

      return {
        seriesIndex,
        value,
        x,
        y,
        width: barWidth,
        height: barHeight,
      }
    })
  })
}

function resolveLinePoints(plot: Frame, spec: NormalizedChartSpec, series: NormalizedChartSeries) {
  if (series.points?.length) {
    return series.points.map((point) => cartesianPoint(plot, point.x, point.y))
  }

  const total = Math.max(series.data.length - 1, 1)
  return series.data.map((value, index) => {
    const xRatio = total === 0 ? 0 : index / total
    const yRatio = spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min)
    return cartesianPoint(plot, xRatio, yRatio)
  })
}

function buildLineSvg(plot: Frame, spec: NormalizedChartSpec, area = false) {
  return spec.series
    .map((entry) => {
      const points = resolveLinePoints(plot, spec, entry)
      if (!points.length) {
        return ''
      }

      const pointString = points.map((point) => `${point.x},${point.y}`).join(' ')
      const path =
        `M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')}`
      const circles = points
        .filter((_, index) => index % Math.max(1, Math.floor(points.length / 12)) === 0)
        .map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3" fill="${entry.color}" />`)
        .join('\n')

      const areaPath = area
        ? `<path d="${path} L ${points.at(-1)?.x ?? 0} ${plot.height} L ${points[0]?.x ?? 0} ${plot.height} Z" fill="${entry.fillColor ?? entry.color}" fill-opacity="${entry.areaOpacity ?? 0.18}" />`
        : ''

      return `
        ${areaPath}
        <polyline fill="none" stroke="${entry.color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" ${entry.lineDash?.length ? `stroke-dasharray="${entry.lineDash.join(' ')}"` : ''} points="${pointString}" />
        ${circles}
      `
    })
    .join('\n')
}

function buildRadarSvg(plot: Frame, spec: NormalizedChartSpec) {
  const cx = plot.width / 2
  const cy = plot.height / 2
  const radius = Math.min(plot.width, plot.height) / 2 - 18
  const ringCount = Math.max(3, Math.ceil((spec.max - spec.min) / spec.step))
  const categoryCount = Math.max(spec.categories.length, 3)

  const polygonPoints = (ratio: number) =>
    Array.from({ length: categoryCount }, (_, index) => {
      const angle = (-Math.PI / 2) + (index / categoryCount) * Math.PI * 2
      const x = cx + Math.cos(angle) * radius * ratio
      const y = cy + Math.sin(angle) * radius * ratio
      return `${x},${y}`
    }).join(' ')

  const rings = Array.from({ length: ringCount }, (_, index) => {
    const ratio = (index + 1) / ringCount
    return `<polygon points="${polygonPoints(ratio)}" fill="none" stroke="#E8EDF5" stroke-width="1" />`
  }).join('\n')

  const spokes = Array.from({ length: categoryCount }, (_, index) => {
    const angle = (-Math.PI / 2) + (index / categoryCount) * Math.PI * 2
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#E8EDF5" stroke-width="1" />`
  }).join('\n')

  const seriesMarkup = spec.series
    .map((entry) => {
      const points = entry.data
        .map((value, index) => {
          const angle = (-Math.PI / 2) + (index / categoryCount) * Math.PI * 2
          const ratio = spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min)
          const x = cx + Math.cos(angle) * radius * ratio
          const y = cy + Math.sin(angle) * radius * ratio
          return { x, y }
        })
      const pointString = points.map((point) => `${point.x},${point.y}`).join(' ')
      const circles = points
        .map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3.5" fill="${entry.color}" />`)
        .join('\n')

      return `
        <polygon points="${pointString}" fill="${entry.fillColor ?? entry.color}" fill-opacity="${entry.areaOpacity ?? 0.16}" stroke="${entry.color}" stroke-width="3" />
        ${circles}
      `
    })
    .join('\n')

  return `
    ${rings}
    ${spokes}
    ${seriesMarkup}
  `.trim()
}

function arcPath(cx: number, cy: number, outerRadius: number, innerRadius: number, startAngle: number, endAngle: number) {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  const startOuter = {
    x: cx + Math.cos(startAngle) * outerRadius,
    y: cy + Math.sin(startAngle) * outerRadius,
  }
  const endOuter = {
    x: cx + Math.cos(endAngle) * outerRadius,
    y: cy + Math.sin(endAngle) * outerRadius,
  }
  const endInner = {
    x: cx + Math.cos(endAngle) * innerRadius,
    y: cy + Math.sin(endAngle) * innerRadius,
  }
  const startInner = {
    x: cx + Math.cos(startAngle) * innerRadius,
    y: cy + Math.sin(startAngle) * innerRadius,
  }

  if (innerRadius <= 0) {
    return `M ${cx} ${cy} L ${startOuter.x} ${startOuter.y} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y} Z`
  }

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${startInner.x} ${startInner.y}`,
    'Z',
  ].join(' ')
}

function buildPieSvg(plot: Frame, spec: NormalizedChartSpec, donut = false) {
  const cx = plot.width / 2
  const cy = plot.height / 2
  const outerRadius = Math.min(plot.width, plot.height) / 2 - 10
  const innerRadius = donut ? outerRadius * spec.innerRadiusRatio : 0
  const total = Math.max(
    1,
    spec.series.reduce((sum, entry) => sum + Math.max(entry.data[0] ?? 0, 0), 0),
  )

  let angle = -Math.PI / 2
  return spec.series
    .map((entry) => {
      const value = Math.max(entry.data[0] ?? 0, 0)
      const delta = (value / total) * Math.PI * 2
      const nextAngle = angle + delta
      const path = arcPath(cx, cy, outerRadius, innerRadius, angle, nextAngle)
      angle = nextAngle
      return `<path d="${path}" fill="${entry.color}" />`
    })
    .join('\n')
}

function buildPieLeaderNodes(
  spec: NormalizedChartSpec,
  plot: Frame,
  words: OcrWordHint[],
  zIndexStart: number,
): SceneNode[] {
  if (!(spec.kind === 'pie' || spec.kind === 'donut')) {
    return []
  }

  const nodes: SceneNode[] = []
  const outerRadius = Math.min(plot.width, plot.height) / 2 - 10
  const cx = plot.x + plot.width / 2
  const cy = plot.y + plot.height / 2
  const total = Math.max(
    1,
    spec.series.reduce((sum, entry) => sum + Math.max(entry.data[0] ?? 0, 0), 0),
  )

  let angle = -Math.PI / 2
  let zIndex = zIndexStart

  spec.series.forEach((entry, index) => {
    const value = Math.max(entry.data[0] ?? 0, 0)
    const delta = (value / total) * Math.PI * 2
    const nextAngle = angle + delta
    const midAngle = angle + delta / 2
    angle = nextAngle

    const labelWord = findOutsidePlotWord(words, entry.name, plot)
    const labelFrame = locationToFrame(labelWord?.location)
    if (!labelFrame) {
      return
    }

    const start = {
      x: cx + Math.cos(midAngle) * (outerRadius + 6),
      y: cy + Math.sin(midAngle) * (outerRadius + 6),
    }
    const side = labelFrame.x + labelFrame.width / 2 < cx ? 'left' : 'right'
    const endY = labelFrame.y + labelFrame.height + 4
    const bend = {
      x: side === 'left' ? start.x - 28 : start.x + 28,
      y: endY,
    }
    const end = {
      x: side === 'left' ? labelFrame.x + labelFrame.width + 10 : labelFrame.x - 10,
      y: endY,
    }

    const minX = Math.min(start.x, bend.x, end.x) - 8
    const minY = Math.min(start.y, bend.y, end.y) - 8
    const width = Math.max(start.x, bend.x, end.x) - minX + 8
    const height = Math.max(start.y, bend.y, end.y) - minY + 8
    const points = [start, bend, end].map((point) => `${point.x - minX},${point.y - minY}`).join(' ')

    nodes.push({
      id: `callout-${index}-${slugify(entry.name)}`,
      type: 'callout',
      render: 'svg',
      parentId: 'card',
      frame: {
        x: minX,
        y: minY,
        width,
        height,
        rotation: 0,
      },
      zIndex,
      opacity: 1,
      svg: `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <polyline fill="none" stroke="${entry.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${points}" />
  <circle cx="${start.x - minX}" cy="${start.y - minY}" r="5" fill="${entry.color}" />
</svg>
      `.trim(),
    })

    zIndex += 1
  })

  return nodes
}

function buildScatterSvg(plot: Frame, spec: NormalizedChartSpec) {
  return spec.series
    .map((entry) =>
      (entry.points ?? [])
        .map((point) => {
          const local = cartesianPoint(plot, point.x, point.y)
          return `<circle cx="${local.x}" cy="${local.y}" r="5" fill="${entry.color}" fill-opacity="0.88" />`
        })
        .join('\n'),
    )
    .join('\n')
}

function buildSvgNode(plot: Frame, spec: NormalizedChartSpec) {
  const content =
    spec.kind === 'grouped-bar'
      ? [
          buildGridLines(plot, spec.min, spec.max, spec.step),
          buildGroupedBarGeometry(plot, spec)
            .map((bar) => `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" rx="1.5" fill="${spec.series[bar.seriesIndex]?.color ?? '#2F80ED'}" />`)
            .join('\n'),
        ].join('\n')
      : spec.kind === 'stacked-bar'
        ? [
            buildStackedBarGeometry(plot, spec)
              .map((bar) => {
                const fill =
                  bar.seriesIndex === 0
                    ? spec.series[bar.seriesIndex]?.color ?? '#F6C58D'
                    : spec.series[bar.seriesIndex]?.color ?? '#FF8A18'
                return `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" fill="${fill}" />`
              })
              .join('\n'),
            ...spec.overlays.map((overlay) => {
              const values = overlay.data ?? []
              const categories = Math.max(values.length, 1)
              const groupWidth = plot.width / categories
              const points = values.map((value, index) => {
                const yRatio = spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min)
                const x = index * groupWidth
                const y = plot.height - yRatio * plot.height
                return `${x},${y} ${x + groupWidth},${y}`
              })
              return `<polyline fill="none" stroke="${overlay.color}" stroke-width="2.5" stroke-dasharray="${overlay.dash?.join(' ') ?? '8 6'}" points="${points.join(' ')}" />`
            }),
          ].join('\n')
        : spec.kind === 'line'
          ? [buildGridLines(plot, spec.min, spec.max, spec.step), buildLineSvg(plot, spec, false)].join('\n')
          : spec.kind === 'area'
            ? [buildGridLines(plot, spec.min, spec.max, spec.step), buildLineSvg(plot, spec, true)].join('\n')
            : spec.kind === 'radar'
              ? buildRadarSvg(plot, spec)
              : spec.kind === 'scatter'
                ? [buildGridLines(plot, spec.min, spec.max, spec.step), buildScatterSvg(plot, spec)].join('\n')
                : buildPieSvg(plot, spec, spec.kind === 'donut')

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${plot.width} ${plot.height}">
  <g>
    ${content}
  </g>
</svg>
  `.trim()
}

function toCanvasSeries(spec: NormalizedChartSpec) {
  return spec.series.map<CanvasChartSeries>((entry) => ({
    name: entry.name,
    color: entry.color,
    fillColor: entry.fillColor,
    data: [...entry.data],
    points: entry.points ? [...entry.points] : undefined,
    areaOpacity: entry.areaOpacity,
    lineDash: entry.lineDash,
  }))
}

function buildCanvasSpec(plot: Frame, spec: NormalizedChartSpec): CanvasChartSpec {
  return {
    kind: spec.kind,
    width: Math.round(plot.width),
    height: Math.round(plot.height),
    plot: {
      x: 0,
      y: 0,
      width: Math.round(plot.width),
      height: Math.round(plot.height),
      rotation: 0,
    },
    categories: [...spec.categories],
    min: spec.min,
    max: spec.max,
    step: spec.step,
    innerRadiusRatio: spec.innerRadiusRatio,
    legendItems: [...spec.legendItems],
    series: toCanvasSeries(spec),
    overlays: spec.overlays.map((overlay) => ({
      ...overlay,
      data: overlay.data ? [...overlay.data] : undefined,
      points: overlay.points ? [...overlay.points] : undefined,
    })),
  }
}

async function resolveSeriesColors(
  spec: NormalizedChartSpec,
  words: OcrWordHint[],
  imagePath: string | undefined,
  plot: Frame,
) {
  if (!imagePath) {
    return spec
  }

  const sampler = await loadRawImageSampler(imagePath)
  const series = spec.series.map((entry, index) => {
    const legendWord = findWord(words, entry.name)
    const legendFrame = locationToFrame(legendWord?.location)
    let color = entry.color

    if (legendFrame) {
      color = sampleLegendSwatchColor(sampler, legendFrame, color)
    } else if (spec.kind === 'grouped-bar') {
      const bars = buildGroupedBarGeometry(plot, spec).filter((bar) => bar.seriesIndex === index)
      const bestBar = [...bars].sort((left, right) => right.height - left.height)[0]
      if (bestBar && bestBar.height > 8) {
        color = sampleBarColor(
          sampler,
          {
            x: plot.x + bestBar.x,
            y: plot.y + bestBar.y,
            width: bestBar.width,
            height: bestBar.height,
            rotation: 0,
          },
          color,
        )
      }
    } else if (spec.kind === 'stacked-bar') {
      const bars = buildStackedBarGeometry(plot, spec).filter((bar) => bar.seriesIndex === index)
      const bestBar = [...bars].sort((left, right) => right.height - left.height)[0]
      if (bestBar && bestBar.height > 8) {
        color = sampleBarColor(
          sampler,
          {
            x: plot.x + bestBar.x,
            y: plot.y + bestBar.y,
            width: bestBar.width,
            height: bestBar.height,
            rotation: 0,
          },
          color,
        )
      }
    }

    let points = entry.points
    if ((spec.kind === 'line' || spec.kind === 'area') && (!points || points.length < 8)) {
      const tracedPoints = traceLineSeries(sampler, plot, color)
      if (tracedPoints.length >= 8) {
        points = tracedPoints.map((point) => ({
          x: point.x,
          y: point.y,
        }))
      }
    }

    return {
      ...entry,
      color,
      fillColor: entry.fillColor ?? (spec.kind === 'area' ? color : undefined),
      points,
    }
  })

  return {
    ...spec,
    series,
    legendItems: spec.legendItems.map((item, index) => ({
      ...item,
      color: series[index]?.color ?? item.color,
    })),
    overlays: spec.overlays.map((overlay, index) => ({
      ...overlay,
      color: overlay.color || series[index]?.color || '#FF8A18',
    })),
  }
}

function buildAxisNodes(
  spec: NormalizedChartSpec,
  plot: Frame,
  words: OcrWordHint[],
  zIndexStart: number,
) {
  const nodes: SceneNode[] = []
  let zIndex = zIndexStart

  for (const [legendIndex, item] of spec.legendItems.entries()) {
    const word = findWord(words, item.name)
    const frame = locationToFrame(word?.location)
    if (!frame) {
      continue
    }

    nodes.push({
      id: `legend-${legendIndex}-${slugify(item.name)}-swatch`,
      type: 'swatch',
      render: 'html',
      parentId: 'card',
      frame: {
        x: Math.max(8, frame.x - 26),
        y: frame.y + Math.round(frame.height / 2) - 8,
        width: 14,
        height: 14,
        rotation: 0,
      },
      zIndex,
      opacity: 1,
      style: {
        fills: [item.color],
        background: item.color,
      },
      clip: {
        enabled: true,
        overflow: 'hidden',
        radius: [8, 8, 8, 8],
      },
    })
    nodes.push(
      createTextNode(`legend-${legendIndex}-${slugify(item.name)}-text`, frame, item.name, zIndex + 1),
    )
    zIndex += 2
  }

  for (const [categoryIndex, category] of spec.categories.entries()) {
    if (!category.trim()) {
      continue
    }

    const word = findWord(words, category)
    const frame = locationToFrame(word?.location)
    if (!frame) {
      continue
    }

    nodes.push(createTextNode(`x-${categoryIndex}-${slugify(category)}`, frame, category, zIndex))
    zIndex += 1
  }

  if (spec.yAxisLabel) {
    const word = findWord(words, spec.yAxisLabel)
    const frame = locationToFrame(word?.location)
    if (frame) {
      nodes.push(
        createTextNode('y-axis-title', frame, spec.yAxisLabel, zIndex, {
          direction: frame.height >= frame.width * 1.8 && isMostlyCjk(spec.yAxisLabel) ? 'rotate-ccw' : 'horizontal',
        }),
      )
      zIndex += 1
    }
  }

  if (spec.xAxisLabel) {
    const word = findWord(words, spec.xAxisLabel)
    const frame = locationToFrame(word?.location)
    if (frame) {
      nodes.push(createTextNode('x-axis-title', frame, spec.xAxisLabel, zIndex))
      zIndex += 1
    }
  }

  let tickIndex = 0
  for (let value = spec.min; value <= spec.max + 0.0001; value += spec.step) {
    const token = Number.isInteger(value) ? String(value) : value.toFixed(2)
    const word = findWord(words, token)
    const frame = locationToFrame(word?.location)
    if (!frame) {
      continue
    }

    nodes.push(createTextNode(`tick-${tickIndex}-${slugify(token)}`, frame, token, zIndex))
    zIndex += 1
    tickIndex += 1
  }

  if (spec.kind === 'radar') {
    for (const [radarIndex, category] of spec.categories.entries()) {
      const word = findWord(words, category)
      const frame = locationToFrame(word?.location)
      if (!frame) {
        continue
      }

      nodes.push(createTextNode(`radar-${radarIndex}-${slugify(category)}`, frame, category, zIndex))
      zIndex += 1
    }
  }

  if (spec.kind === 'pie' || spec.kind === 'donut') {
    const plotRight = plot.x + plot.width
    const plotBottom = plot.y + plot.height

    words.forEach((word, index) => {
      const frame = locationToFrame(word.location)
      if (!frame) {
        return
      }

      const outsidePlot =
        frame.x + frame.width < plot.x - 8 ||
        frame.x > plotRight + 8 ||
        frame.y + frame.height < plot.y - 8 ||
        frame.y > plotBottom + 8

      if (!outsidePlot) {
        return
      }

      const isDuplicate = nodes.some(
        (node) =>
          node.text?.content === word.text &&
          Math.abs(node.frame.x - frame.x) < 4 &&
          Math.abs(node.frame.y - frame.y) < 4,
      )

      if (isDuplicate) {
        return
      }

      nodes.push(
        createTextNode(`ocr-${index}-${slugify(word.text)}`, frame, word.text, zIndex, {
          color: /^\$/.test(word.text) ? '#475467' : '#4B5563',
          fontWeight: /^\$/.test(word.text) ? 600 : 500,
        }),
      )
      zIndex += 1
    })
  }

  return [...nodes, ...buildPieLeaderNodes(spec, plot, words, zIndex)]
}

export async function buildSceneFromChartSpec(options: {
  rawSpec: unknown
  imagePath: string
  sampleImagePath?: string
  width: number
  height: number
  words: OcrWordHint[]
  renderPreference?: RenderPreference
  promptText?: string
}) {
  const rawSpec = asChartSpec(options.rawSpec)
  if (!rawSpec) {
    return undefined
  }

  let spec = normalizeChartSpec(rawSpec, options.promptText)
  if (!spec) {
    return undefined
  }

  const plot =
    spec.kind === 'pie' || spec.kind === 'donut' || spec.kind === 'radar'
      ? inferPolarPlotFrame(options.width, options.height, spec, options.words)
      : inferCartesianPlotFrame(options.width, options.height, spec, options.words)

  spec = await resolveSeriesColors(spec, options.words, options.sampleImagePath, plot)

  const chartNode: SceneNode =
    options.renderPreference === 'canvas'
      ? {
          id: 'chart-canvas',
          type: 'chart-canvas',
          render: 'canvas',
          parentId: 'card',
          frame: plot,
          zIndex: 10,
          opacity: 1,
          canvas: buildCanvasSpec(plot, spec),
          notes: `${spec.kind} chart rendered via canvas`,
        }
      : {
          id: 'chart-svg',
          type: 'chart-svg',
          render: 'svg',
          parentId: 'card',
          frame: plot,
          zIndex: 10,
          opacity: 1,
          svg: buildSvgNode(plot, spec),
          notes: `${spec.kind} chart rendered via svg`,
        }

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
    chartNode,
    ...buildAxisNodes(spec, plot, options.words, 20),
  ]

  const constraints: Constraint[] = nodes
    .filter((node) => node.id !== 'card')
    .map((node) => ({
      type: 'inside-parent',
      nodeId: node.id,
      parentId: 'card',
      tolerance: 2,
    }))

  for (const node of nodes) {
    if (node.text) {
      constraints.push({
        type: 'no-text-overflow',
        nodeId: node.id,
        tolerance: 1,
      })
    }
  }

  return {
    version: '1.0',
    mode: 'clone-static',
    summary: rawSpec.title ?? `${spec.kind} chart`,
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
