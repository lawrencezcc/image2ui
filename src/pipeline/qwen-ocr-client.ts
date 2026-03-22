import fs from 'node:fs/promises'
import path from 'node:path'

import { qwenOcrConfig } from './config'

export type QwenOcrTask =
  | 'text_recognition'
  | 'advanced_recognition'
  | 'key_information_extraction'
  | 'table_parsing'
  | 'document_parsing'
  | 'formula_recognition'
  | 'multi_lan'

export interface QwenOcrRequest {
  imageUrls?: string[]
  imagePaths?: string[]
  task?: QwenOcrTask
  model?: string
  minPixels?: number
  maxPixels?: number
  enableRotate?: boolean
}

export interface QwenOcrResponse {
  text: string
  model: string
  requestId?: string
  words: Array<{
    text: string
    location?: number[]
  }>
  usage?: {
    totalTokens?: number
    inputTokens?: number
    outputTokens?: number
    imageTokens?: number
  }
  raw: unknown
}

type OcrContentItem = {
  text?: string
  ocr_result?: {
    words_info?: Array<{
      text?: string
      location?: number[]
    }>
  }
}

type EmbeddedOcrItem = {
  text?: string
  rotate_rect?: number[]
}

type OcrApiResponse = {
  request_id?: string
  output?: {
    choices?: Array<{
      message?: {
        content?: OcrContentItem[]
      }
    }>
  }
  usage?: {
    total_tokens?: number
    input_tokens?: number
    output_tokens?: number
    image_tokens?: number
  }
}

function inferMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()

  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    default:
      throw new Error(`暂不支持的 OCR 图像格式: ${extension || 'unknown'}`)
  }
}

async function toDataUrl(filePath: string) {
  const mimeType = inferMimeType(filePath)
  const bytes = await fs.readFile(filePath)
  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

function normalizeText(content: OcrContentItem[] | undefined) {
  return (content ?? [])
    .map((item) => item.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

function normalizeWords(content: OcrContentItem[] | undefined) {
  const explicitWords = (content ?? [])
    .flatMap((item) => item.ocr_result?.words_info ?? [])
    .map((word) => ({
      text: word.text?.trim() ?? '',
      location: Array.isArray(word.location) ? word.location : undefined,
    }))
    .filter((word) => word.text)

  if (explicitWords.length > 0) {
    return explicitWords
  }

  return (content ?? [])
    .flatMap((item) => parseEmbeddedWords(item.text))
    .filter((word) => word.text)
}

function rotateRectToLocation(rotateRect: number[]) {
  if (!Array.isArray(rotateRect) || rotateRect.length < 4) {
    return undefined
  }

  const [x, y, width, height] = rotateRect
  return [
    x,
    y,
    x + width,
    y,
    x + width,
    y + height,
    x,
    y + height,
  ]
}

function parseEmbeddedWords(text: string | undefined) {
  if (!text) {
    return []
  }

  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i)
  const candidate = fencedMatch?.[1] ?? text

  try {
    const parsed = JSON.parse(candidate) as EmbeddedOcrItem[]
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((entry) => ({
        text: entry.text?.trim() ?? '',
        location: Array.isArray(entry.rotate_rect)
          ? rotateRectToLocation(entry.rotate_rect)
          : undefined,
      }))
      .filter((entry) => entry.text)
  } catch {
    return []
  }
}

export class QwenOcrClient {
  private readonly apiKey: string
  private readonly model: string
  private readonly baseURL: string

  constructor(options?: { apiKey?: string; model?: string; baseURL?: string }) {
    const apiKey = options?.apiKey ?? process.env[qwenOcrConfig.apiKeyEnv]
    if (!apiKey) {
      throw new Error(`缺少 ${qwenOcrConfig.apiKeyEnv}，无法调用 Qwen OCR 服务。`)
    }

    this.apiKey = apiKey
    this.model = options?.model ?? qwenOcrConfig.model
    this.baseURL = options?.baseURL ?? qwenOcrConfig.baseURL
  }

  async recognize(request: QwenOcrRequest): Promise<QwenOcrResponse> {
    const requestContent = [
      ...(request.imageUrls ?? []).map((image) => ({
        image,
        min_pixels: request.minPixels ?? qwenOcrConfig.minPixels,
        max_pixels: request.maxPixels ?? qwenOcrConfig.maxPixels,
        enable_rotate: request.enableRotate ?? false,
      })),
      ...(
        await Promise.all(
          (request.imagePaths ?? []).map(async (imagePath) => ({
            image: await toDataUrl(imagePath),
            min_pixels: request.minPixels ?? qwenOcrConfig.minPixels,
            max_pixels: request.maxPixels ?? qwenOcrConfig.maxPixels,
            enable_rotate: request.enableRotate ?? false,
          })),
        )
      ),
    ]

    if (!requestContent.length) {
      throw new Error('Qwen OCR 调用需要至少一张图片。')
    }

    const response = await fetch(this.baseURL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model ?? this.model,
        input: {
          messages: [
            {
              role: 'user',
              content: requestContent,
            },
          ],
        },
        parameters: {
          ocr_options: {
            task: request.task ?? 'text_recognition',
          },
        },
      }),
      signal: AbortSignal.timeout(qwenOcrConfig.timeoutMs),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Qwen OCR 调用失败: ${response.status} ${response.statusText}\n${errorText}`)
    }

    const payload = (await response.json()) as OcrApiResponse
    const responseContent = payload.output?.choices?.[0]?.message?.content
    const text = normalizeText(responseContent)
    const words = normalizeWords(responseContent)

    if (!text) {
      throw new Error('Qwen OCR 返回为空，未获得可用文字结果。')
    }

    return {
      text,
      model: request.model ?? this.model,
      requestId: payload.request_id,
      words,
      usage: {
        totalTokens: payload.usage?.total_tokens,
        inputTokens: payload.usage?.input_tokens,
        outputTokens: payload.usage?.output_tokens,
        imageTokens: payload.usage?.image_tokens,
      },
      raw: payload,
    }
  }
}
