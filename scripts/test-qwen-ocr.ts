import { QwenOcrClient } from '../src/pipeline/qwen-ocr-client'

async function main() {
  const imageSource =
    process.argv[2] ??
    'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241108/ctdzex/biaozhun.jpg'
  const task = (process.argv[3] as Parameters<QwenOcrClient['recognize']>[0]['task']) ?? 'text_recognition'

  const client = new QwenOcrClient()
  const result = await client.recognize({
    task,
    imageUrls: imageSource.startsWith('http') ? [imageSource] : undefined,
    imagePaths: imageSource.startsWith('http') ? undefined : [imageSource],
  })

  console.log(result.text)
  console.error(
    `[qwen-ocr] model=${result.model} task=${task} request_id=${result.requestId ?? 'n/a'} input_tokens=${result.usage?.inputTokens ?? 'n/a'} output_tokens=${result.usage?.outputTokens ?? 'n/a'}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
