import { QwenVlClient } from '../src/pipeline/qwen-vl-client'

async function main() {
  const imageSource =
    process.argv[2] ??
    'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241108/ctdzex/biaozhun.jpg'
  const prompt = process.argv[3] ?? '请仅输出图像中的文本内容。'

  const client = new QwenVlClient()
  const result = await client.complete({
    prompt,
    imageUrls: imageSource.startsWith('http') ? [imageSource] : undefined,
    imagePaths: imageSource.startsWith('http') ? undefined : [imageSource],
  })

  console.log(result.text)
  console.error(
    `[qwen-vl] model=${result.model} prompt_tokens=${result.usage?.prompt_tokens ?? 'n/a'} completion_tokens=${result.usage?.completion_tokens ?? 'n/a'}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
