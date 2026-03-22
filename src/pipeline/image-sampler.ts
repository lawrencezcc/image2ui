import sharp from 'sharp'

import type { Frame } from './types'
import { clamp } from './utils'

export interface RawImageSampler {
  width: number
  height: number
  channels: number
  data: Buffer
}

interface RgbColor {
  r: number
  g: number
  b: number
}

function normalizeRect(rect: Frame, sampler: RawImageSampler) {
  const x = clamp(Math.floor(rect.x), 0, sampler.width - 1)
  const y = clamp(Math.floor(rect.y), 0, sampler.height - 1)
  const maxWidth = sampler.width - x
  const maxHeight = sampler.height - y

  return {
    x,
    y,
    width: clamp(Math.ceil(rect.width), 1, maxWidth),
    height: clamp(Math.ceil(rect.height), 1, maxHeight),
  }
}

function getPixel(sampler: RawImageSampler, x: number, y: number) {
  const clampedX = clamp(Math.round(x), 0, sampler.width - 1)
  const clampedY = clamp(Math.round(y), 0, sampler.height - 1)
  const index = (clampedY * sampler.width + clampedX) * sampler.channels

  return {
    r: sampler.data[index] ?? 0,
    g: sampler.data[index + 1] ?? 0,
    b: sampler.data[index + 2] ?? 0,
    a: sampler.channels > 3 ? (sampler.data[index + 3] ?? 255) : 255,
  }
}

function quantizeRgb(color: RgbColor) {
  const step = 16
  const r = Math.round(color.r / step) * step
  const g = Math.round(color.g / step) * step
  const b = Math.round(color.b / step) * step
  return `${r}-${g}-${b}`
}

function hexToRgb(hex: string): RgbColor | undefined {
  const normalized = hex.trim().replace(/^#/, '')
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((part) => part.repeat(2))
          .join('')
      : normalized

  if (!/^[0-9a-f]{6}$/i.test(value)) {
    return undefined
  }

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

function rgbToHex(color: RgbColor) {
  return `#${[color.r, color.g, color.b]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`
}

function colorDistance(left: RgbColor, right: RgbColor) {
  return Math.sqrt((left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2)
}

function isNearWhite(color: RgbColor, alpha: number) {
  return alpha < 32 || (color.r > 244 && color.g > 244 && color.b > 244)
}

export async function loadRawImageSampler(imagePath: string): Promise<RawImageSampler> {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  return {
    width: info.width,
    height: info.height,
    channels: info.channels,
    data,
  }
}

export function sampleDominantColor(
  sampler: RawImageSampler,
  rect: Frame,
  fallback: string,
  options?: {
    ignoreWhite?: boolean
  },
) {
  const normalized = normalizeRect(rect, sampler)
  const buckets = new Map<
    string,
    {
      count: number
      sum: RgbColor
    }
  >()

  for (let y = normalized.y; y < normalized.y + normalized.height; y += 1) {
    for (let x = normalized.x; x < normalized.x + normalized.width; x += 1) {
      const pixel = getPixel(sampler, x, y)
      const color = { r: pixel.r, g: pixel.g, b: pixel.b }
      if (options?.ignoreWhite !== false && isNearWhite(color, pixel.a)) {
        continue
      }

      const bucketKey = quantizeRgb(color)
      const bucket = buckets.get(bucketKey) ?? {
        count: 0,
        sum: { r: 0, g: 0, b: 0 },
      }

      bucket.count += 1
      bucket.sum.r += color.r
      bucket.sum.g += color.g
      bucket.sum.b += color.b
      buckets.set(bucketKey, bucket)
    }
  }

  const dominant = [...buckets.values()].sort((left, right) => right.count - left.count)[0]
  if (!dominant || dominant.count < 8) {
    return fallback
  }

  return rgbToHex({
    r: dominant.sum.r / dominant.count,
    g: dominant.sum.g / dominant.count,
    b: dominant.sum.b / dominant.count,
  })
}

export function sampleLegendSwatchColor(
  sampler: RawImageSampler,
  textFrame: Frame,
  fallback: string,
) {
  const swatchRect = {
    x: Math.max(0, textFrame.x - Math.max(20, textFrame.height * 1.6)),
    y: Math.max(0, textFrame.y + textFrame.height * 0.15),
    width: Math.max(12, textFrame.height * 1.1),
    height: Math.max(12, textFrame.height * 0.9),
    rotation: 0,
  }

  return sampleDominantColor(sampler, swatchRect, fallback)
}

export function sampleBarColor(
  sampler: RawImageSampler,
  rect: Frame,
  fallback: string,
) {
  const inset = Math.max(2, Math.min(rect.width, rect.height) * 0.16)
  return sampleDominantColor(
    sampler,
    {
      x: rect.x + inset,
      y: rect.y + inset,
      width: Math.max(4, rect.width - inset * 2),
      height: Math.max(4, rect.height - inset * 2),
      rotation: 0,
    },
    fallback,
  )
}

export function traceLineSeries(
  sampler: RawImageSampler,
  plotRect: Frame,
  colorHex: string,
  sampleCount = 96,
) {
  const target = hexToRgb(colorHex)
  if (!target) {
    return []
  }

  const normalized = normalizeRect(plotRect, sampler)
  const threshold = 72
  const points: Array<{ x: number; y: number }> = []

  for (let index = 0; index < sampleCount; index += 1) {
    const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1)
    const x = normalized.x + ratio * (normalized.width - 1)
    const matches: number[] = []

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const sampleX = clamp(Math.round(x + offsetX), normalized.x, normalized.x + normalized.width - 1)
      for (let y = normalized.y; y < normalized.y + normalized.height; y += 1) {
        const pixel = getPixel(sampler, sampleX, y)
        const color = { r: pixel.r, g: pixel.g, b: pixel.b }
        if (pixel.a < 48 || isNearWhite(color, pixel.a)) {
          continue
        }

        if (colorDistance(color, target) <= threshold) {
          matches.push(y)
        }
      }
    }

    if (!matches.length) {
      continue
    }

    matches.sort((left, right) => left - right)
    const medianY = matches[Math.floor(matches.length / 2)] ?? matches[0]
    points.push({
      x: ratio,
      y: 1 - (medianY - normalized.y) / normalized.height,
    })
  }

  return points.filter((point, index, array) => {
    const previous = array[index - 1]
    if (!previous) {
      return true
    }

    return Math.abs(point.x - previous.x) > 0.002 || Math.abs(point.y - previous.y) > 0.002
  })
}

export function resolveNearestColor(hexColors: string[], sampler: RawImageSampler, rect: Frame) {
  const sampled = sampleDominantColor(sampler, rect, hexColors[0] ?? '#2F80ED')
  const sampledRgb = hexToRgb(sampled)
  if (!sampledRgb) {
    return sampled
  }

  const nearest = hexColors
    .map((hex) => ({
      hex,
      distance: colorDistance(sampledRgb, hexToRgb(hex) ?? sampledRgb),
    }))
    .sort((left, right) => left.distance - right.distance)[0]

  return nearest?.hex ?? sampled
}
