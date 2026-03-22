import OpenAI from 'openai'

import { kimiConfig } from './config'

export interface KimiCodingRequest {
  prompt: string
  systemPrompt?: string
  model?: string
  timeoutMs?: number
}

interface AnthropicTextContent {
  type: 'text'
  text: string
}

interface AnthropicMessageResponse {
  id: string
  type: string
  role: string
  model: string
  content: AnthropicTextContent[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    [key: string]: unknown
  }
}

function normalizeTextContent(
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

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export class KimiCodingClient {
  private readonly openAiClient?: OpenAI
  private readonly apiKey: string
  private readonly defaultModel: string
  private readonly baseURL: string
  private readonly timeoutMs: number
  private readonly protocol: string

  constructor(options?: {
    apiKey?: string
    baseURL?: string
    model?: string
    protocol?: string
  }) {
    const apiKey = options?.apiKey ?? process.env[kimiConfig.apiKeyEnv]
    if (!apiKey) {
      throw new Error(`缺少 ${kimiConfig.apiKeyEnv}，无法调用 Kimi Coding 服务。`)
    }

    this.apiKey = apiKey
    this.baseURL = stripTrailingSlash(options?.baseURL ?? kimiConfig.baseURL)
    this.defaultModel = options?.model ?? kimiConfig.model
    this.timeoutMs = kimiConfig.timeoutMs
    this.protocol = (options?.protocol ?? kimiConfig.protocol ?? 'anthropic').toLowerCase()

    if (this.protocol === 'openai') {
      this.openAiClient = new OpenAI({
        apiKey,
        baseURL: this.baseURL,
        timeout: this.timeoutMs,
      })
    }
  }

  private async completeWithAnthropic(request: KimiCodingRequest) {
    const controller = new AbortController()
    const requestTimeoutMs = request.timeoutMs ?? this.timeoutMs
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs)

    try {
      const response = await fetch(`${this.baseURL}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': kimiConfig.anthropicVersion,
        },
        body: JSON.stringify({
          model: request.model ?? this.defaultModel,
          max_tokens: kimiConfig.maxOutputTokens,
          system: request.systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: request.prompt,
                },
              ],
            },
          ],
        }),
      })

      const text = await response.text()
      if (!response.ok) {
        throw new Error(`Kimi Anthropic 调用失败 (${response.status}): ${text}`)
      }

      const payload = JSON.parse(text) as AnthropicMessageResponse
      const normalized = normalizeTextContent(payload.content)
      if (!normalized) {
        throw new Error('Kimi Anthropic 返回为空，未获得可用文本响应。')
      }

      const usage = payload.usage
        ? {
            prompt_tokens:
              payload.usage.prompt_tokens ??
              payload.usage.input_tokens ??
              0,
            completion_tokens:
              payload.usage.completion_tokens ??
              payload.usage.output_tokens ??
              0,
            total_tokens:
              payload.usage.total_tokens ??
              (payload.usage.input_tokens ?? payload.usage.prompt_tokens ?? 0) +
                (payload.usage.output_tokens ?? payload.usage.completion_tokens ?? 0),
          }
        : undefined

      return {
        text: normalized,
        model: payload.model,
        usage,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private async completeWithOpenAI(request: KimiCodingRequest) {
    if (!this.openAiClient) {
      throw new Error('Kimi OpenAI 客户端未初始化。')
    }

    const completion = await this.openAiClient.chat.completions.create(
      {
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
      },
      {
        timeout: request.timeoutMs ?? this.timeoutMs,
      },
    )

    const text = normalizeTextContent(completion.choices[0]?.message?.content)
    if (!text) {
      throw new Error('Kimi OpenAI 兼容返回为空，未获得可用文本响应。')
    }

    return {
      text,
      model: completion.model,
      usage: completion.usage ?? undefined,
    }
  }

  async complete(request: KimiCodingRequest) {
    if (this.protocol === 'anthropic') {
      return this.completeWithAnthropic(request)
    }

    return this.completeWithOpenAI(request)
  }
}
