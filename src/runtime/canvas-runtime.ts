import type { CanvasChartSpec } from '../pipeline/types'

function resolveLinePoints(spec: CanvasChartSpec, series: CanvasChartSpec['series'][number]) {
  if (series.points?.length) {
    return series.points.map((point) => ({
      x: point.x * spec.plot.width,
      y: spec.plot.height - point.y * spec.plot.height,
    }))
  }

  const total = Math.max(series.data.length - 1, 1)
  return series.data.map((value, index) => {
    const xRatio = total === 0 ? 0 : index / total
    const yRatio = spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min)
    return {
      x: xRatio * spec.plot.width,
      y: spec.plot.height - yRatio * spec.plot.height,
    }
  })
}

function drawCartesianGrid(ctx: CanvasRenderingContext2D, spec: CanvasChartSpec) {
  ctx.save()
  ctx.strokeStyle = '#E8EDF5'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 8])

  for (let value = spec.min; value <= spec.max + 0.0001; value += spec.step) {
    const ratio = spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min)
    const y = spec.plot.height - ratio * spec.plot.height
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(spec.plot.width, y)
    ctx.stroke()
  }

  ctx.restore()
}

function drawGroupedBars(ctx: CanvasRenderingContext2D, spec: CanvasChartSpec) {
  const categories = spec.categories.length
    ? spec.categories
    : Array.from({ length: Math.max(...spec.series.map((series) => series.data.length), 0) }, () => '')
  const groupWidth = spec.plot.width / Math.max(categories.length, 1)
  const seriesCount = Math.max(spec.series.length, 1)
  const barWidth = Math.max(12, Math.min(56, groupWidth / Math.max(seriesCount + 0.85, 1.8)))

  spec.series.forEach((series, seriesIndex) => {
    ctx.save()
    ctx.fillStyle = series.color

    series.data.forEach((value, categoryIndex) => {
      const ratio = spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min)
      const height = Math.max(0, ratio * spec.plot.height)
      const x =
        categoryIndex * groupWidth +
        (groupWidth - seriesCount * barWidth) / 2 +
        seriesIndex * barWidth
      const y = spec.plot.height - height
      ctx.beginPath()
      ctx.roundRect(x, y, Math.max(4, barWidth - 4), height, 2)
      ctx.fill()
    })

    ctx.restore()
  })
}

function drawStackedBars(ctx: CanvasRenderingContext2D, spec: CanvasChartSpec) {
  const categories = spec.categories.length
    ? spec.categories
    : Array.from({ length: Math.max(...spec.series.map((series) => series.data.length), 0) }, () => '')
  const groupWidth = spec.plot.width / Math.max(categories.length, 1)
  const barWidth = Math.max(26, Math.min(120, groupWidth * 0.48))

  categories.forEach((_, categoryIndex) => {
    let runningHeight = 0

    spec.series.forEach((series) => {
      const value = series.data[categoryIndex] ?? 0
      const ratio = spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min)
      const height = Math.max(0, ratio * spec.plot.height)
      const x = categoryIndex * groupWidth + (groupWidth - barWidth) / 2
      const y = spec.plot.height - runningHeight - height
      runningHeight += height

      ctx.save()
      ctx.fillStyle = series.color
      ctx.fillRect(x, y, barWidth, height)
      ctx.restore()
    })
  })
}

function drawOverlays(ctx: CanvasRenderingContext2D, spec: CanvasChartSpec) {
  spec.overlays?.forEach((overlay) => {
    if (!overlay.data?.length && !overlay.points?.length) {
      return
    }

    ctx.save()
    ctx.strokeStyle = overlay.color
    ctx.lineWidth = 2.5
    ctx.setLineDash(overlay.dash ?? [])
    ctx.beginPath()

    if (overlay.type === 'leader-line' && overlay.points?.length) {
      overlay.points.forEach((point, index) => {
        const x = point.x * spec.plot.width
        const y = point.y * spec.plot.height
        if (index === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      })

      ctx.stroke()
      const first = overlay.points[0]
      if (first) {
        ctx.fillStyle = overlay.color
        ctx.beginPath()
        ctx.arc(first.x * spec.plot.width, first.y * spec.plot.height, overlay.dotRadius ?? 4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      return
    }

    if (overlay.points?.length) {
      overlay.points.forEach((point, index) => {
        const x = point.x * spec.plot.width
        const y = spec.plot.height - point.y * spec.plot.height
        if (index === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      })
    } else if (overlay.data?.length) {
      const groupWidth = spec.plot.width / Math.max(overlay.data.length, 1)
      overlay.data.forEach((value, index) => {
        const ratio = spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min)
        const y = spec.plot.height - ratio * spec.plot.height
        const x = index * groupWidth
        if (index === 0) {
          ctx.moveTo(x, y)
        }
        ctx.lineTo(x + groupWidth, y)
      })
    }

    ctx.stroke()
    ctx.restore()
  })
}

function drawLineSeries(ctx: CanvasRenderingContext2D, spec: CanvasChartSpec, area = false) {
  spec.series.forEach((series) => {
    const points = resolveLinePoints(spec, series)
    if (!points.length) {
      return
    }

    if (area) {
      ctx.save()
      ctx.fillStyle = series.fillColor ?? series.color
      ctx.globalAlpha = series.areaOpacity ?? 0.18
      ctx.beginPath()
      ctx.moveTo(points[0]?.x ?? 0, spec.plot.height)
      points.forEach((point) => ctx.lineTo(point.x, point.y))
      ctx.lineTo(points.at(-1)?.x ?? spec.plot.width, spec.plot.height)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    ctx.save()
    ctx.strokeStyle = series.color
    ctx.lineWidth = 4
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.setLineDash(series.lineDash ?? [])
    ctx.beginPath()
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y)
      } else {
        ctx.lineTo(point.x, point.y)
      }
    })
    ctx.stroke()

    ctx.fillStyle = series.color
    points
      .filter((_, index) => index % Math.max(1, Math.floor(points.length / 12)) === 0)
      .forEach((point) => {
        ctx.beginPath()
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2)
        ctx.fill()
      })
    ctx.restore()
  })
}

function drawPieLike(ctx: CanvasRenderingContext2D, spec: CanvasChartSpec, donut = false) {
  const cx = spec.plot.width / 2
  const cy = spec.plot.height / 2
  const outerRadius = Math.min(spec.plot.width, spec.plot.height) / 2 - 10
  const innerRadius = donut ? outerRadius * (spec.innerRadiusRatio ?? 0.36) : 0
  const total = Math.max(
    1,
    spec.series.reduce((sum, series) => sum + Math.max(series.data[0] ?? 0, 0), 0),
  )
  let angle = -Math.PI / 2

  spec.series.forEach((series) => {
    const value = Math.max(series.data[0] ?? 0, 0)
    const delta = (value / total) * Math.PI * 2
    const nextAngle = angle + delta

    ctx.save()
    ctx.fillStyle = series.color
    ctx.beginPath()
    ctx.arc(cx, cy, outerRadius, angle, nextAngle)
    if (innerRadius > 0) {
      ctx.arc(cx, cy, innerRadius, nextAngle, angle, true)
    } else {
      ctx.lineTo(cx, cy)
    }
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    angle = nextAngle
  })
}

function drawRadar(ctx: CanvasRenderingContext2D, spec: CanvasChartSpec) {
  const spokes = Math.max(spec.categories.length, 3)
  const cx = spec.plot.width / 2
  const cy = spec.plot.height / 2
  const radius = Math.min(spec.plot.width, spec.plot.height) / 2 - 18
  const ringCount = Math.max(3, Math.ceil((spec.max - spec.min) / spec.step))

  ctx.save()
  ctx.strokeStyle = '#E8EDF5'
  ctx.lineWidth = 1
  for (let ring = 1; ring <= ringCount; ring += 1) {
    const ratio = ring / ringCount
    ctx.beginPath()
    for (let index = 0; index < spokes; index += 1) {
      const angle = -Math.PI / 2 + (index / spokes) * Math.PI * 2
      const x = cx + Math.cos(angle) * radius * ratio
      const y = cy + Math.sin(angle) * radius * ratio
      if (index === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.closePath()
    ctx.stroke()
  }

  for (let index = 0; index < spokes; index += 1) {
    const angle = -Math.PI / 2 + (index / spokes) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
    ctx.stroke()
  }
  ctx.restore()

  spec.series.forEach((series) => {
    ctx.save()
    ctx.fillStyle = series.fillColor ?? series.color
    ctx.globalAlpha = series.areaOpacity ?? 0.16
    ctx.strokeStyle = series.color
    ctx.lineWidth = 3
    ctx.beginPath()
    series.data.forEach((value, index) => {
      const angle = -Math.PI / 2 + (index / spokes) * Math.PI * 2
      const ratio = spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min)
      const x = cx + Math.cos(angle) * radius * ratio
      const y = cy + Math.sin(angle) * radius * ratio
      if (index === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.stroke()
    ctx.restore()
  })
}

function drawScatter(ctx: CanvasRenderingContext2D, spec: CanvasChartSpec) {
  spec.series.forEach((series) => {
    ctx.save()
    ctx.fillStyle = series.color
    series.points?.forEach((point) => {
      const x = point.x * spec.plot.width
      const y = spec.plot.height - point.y * spec.plot.height
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fill()
    })
    ctx.restore()
  })
}

export function drawCanvasChart(canvas: HTMLCanvasElement, spec: CanvasChartSpec) {
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.save()
  context.translate(spec.plot.x, spec.plot.y)

  if (spec.kind === 'grouped-bar') {
    drawCartesianGrid(context, spec)
    drawGroupedBars(context, spec)
  } else if (spec.kind === 'stacked-bar') {
    drawStackedBars(context, spec)
    drawOverlays(context, spec)
  } else if (spec.kind === 'line') {
    drawCartesianGrid(context, spec)
    drawLineSeries(context, spec, false)
  } else if (spec.kind === 'area') {
    drawCartesianGrid(context, spec)
    drawLineSeries(context, spec, true)
  } else if (spec.kind === 'donut') {
    drawPieLike(context, spec, true)
    drawOverlays(context, spec)
  } else if (spec.kind === 'pie') {
    drawPieLike(context, spec, false)
    drawOverlays(context, spec)
  } else if (spec.kind === 'radar') {
    drawRadar(context, spec)
  } else if (spec.kind === 'scatter') {
    drawCartesianGrid(context, spec)
    drawScatter(context, spec)
  }

  context.restore()
}

export function createCanvasBindings() {
  const canvasRefs = new Map<string, HTMLCanvasElement>()

  return {
    setCanvasRef: (id: string) => (element: HTMLCanvasElement | null) => {
      if (element) {
        canvasRefs.set(id, element)
      } else {
        canvasRefs.delete(id)
      }
    },
    drawAll: (specs: Record<string, CanvasChartSpec>) => {
      for (const [id, spec] of Object.entries(specs)) {
        const canvas = canvasRefs.get(id)
        if (canvas) {
          drawCanvasChart(canvas, spec)
        }
      }
    },
  }
}
