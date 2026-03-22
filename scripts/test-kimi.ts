import { KimiCodingClient } from '../src/pipeline/kimi-client'

async function main() {
  const client = new KimiCodingClient()
  const response = await client.complete({
    systemPrompt: '你是一个严谨的前端工程助手。',
    prompt: '请只输出一个 Vue 3 SFC 组件文件名建议，不要解释。',
  })

  console.log(
    JSON.stringify(
      {
        model: response.model,
        text: response.text,
        usage: response.usage,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
