import fs from 'node:fs/promises'

import { qwenImageConfig } from './config'

export interface QwenImageRequest {
  prompt: string
  negativePrompt?: string
  model?: string
  size?: string
  seed?: number
}

type QwenImageApiResponse = {
  request_id?: string
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{
          image?: string
        }>
      }
    }>
  }
  usage?: {
    width?: number
    height?: number
    image_count?: number
  }
  code?: string
  message?: string
}

export class QwenImageClient {
  private readonly apiKey: string
  private readonly baseURL: string

  constructor(options?: { apiKey?: string; baseURL?: string }) {
    const apiKey = options?.apiKey ?? process.env[qwenImageConfig.apiKeyEnv]
    if (!apiKey) {
      throw new Error(`缺少 ${qwenImageConfig.apiKeyEnv}，无法调用 Qwen Image 服务。`)
    }

    this.apiKey = apiKey
    this.baseURL = options?.baseURL ?? qwenImageConfig.baseURL
  }

  async generate(request: QwenImageRequest) {
    const response = await fetch(this.baseURL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model ?? qwenImageConfig.model,
        input: {
          messages: [
            {
              role: 'user',
              content: [
                {
                  text: request.prompt,
                },
              ],
            },
          ],
        },
        parameters: {
          negative_prompt: request.negativePrompt,
          prompt_extend: false,
          watermark: false,
          size: request.size ?? '1024*1024',
          seed: request.seed,
        },
      }),
      signal: AbortSignal.timeout(qwenImageConfig.timeoutMs),
    })

    const payload = (await response.json()) as QwenImageApiResponse
    if (!response.ok || payload.code) {
      throw new Error(
        `Qwen Image 调用失败: ${response.status} ${response.statusText}\n${payload.message ?? ''}`,
      )
    }

    const imageUrl = payload.output?.choices?.[0]?.message?.content?.[0]?.image
    if (!imageUrl) {
      throw new Error('Qwen Image 未返回图像 URL。')
    }

    return {
      requestId: payload.request_id,
      imageUrl,
      usage: payload.usage,
    }
  }

  async downloadImage(imageUrl: string, targetPath: string) {
    const response = await fetch(imageUrl)
    if (!response.ok) {
      throw new Error(`下载生成图片失败: ${response.status} ${response.statusText}`)
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(targetPath, bytes)
  }
}
