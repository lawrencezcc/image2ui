import OpenAI from 'openai'

import { kimiConfig } from './config'

export interface KimiCodingRequest {
  prompt: string
  systemPrompt?: string
  model?: string
}

function normalizeContent(
  content:
    | string
    | Array<{
        type?: string
        text?: string
      }>
    | null
    | undefined,
) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text?.trim() ?? '')
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  return ''
}

export class KimiCodingClient {
  private readonly client: OpenAI
  private readonly defaultModel: string

  constructor(options?: { apiKey?: string; baseURL?: string; model?: string }) {
    const apiKey = options?.apiKey ?? process.env[kimiConfig.apiKeyEnv]
    if (!apiKey) {
      throw new Error(`缺少 ${kimiConfig.apiKeyEnv}，无法调用 Kimi Coding 服务。`)
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: options?.baseURL ?? kimiConfig.baseURL,
      timeout: kimiConfig.timeoutMs,
    })
    this.defaultModel = options?.model ?? kimiConfig.model
  }

  async complete(request: KimiCodingRequest) {
    const completion = await this.client.chat.completions.create({
      model: request.model ?? this.defaultModel,
      messages: [
        ...(request.systemPrompt
          ? [
              {
                role: 'system' as const,
                content: request.systemPrompt,
              },
            ]
          : []),
        {
          role: 'user',
          content: request.prompt,
        },
      ],
    })

    const text = normalizeContent(completion.choices[0]?.message?.content)
    if (!text) {
      throw new Error('Kimi Coding 返回为空，未获得可用文本响应。')
    }

    return {
      text,
      model: completion.model,
      usage: completion.usage ?? undefined,
    }
  }
}
