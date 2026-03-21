import { runTask } from '../src/pipeline/orchestrator'
import { getArgValue } from '../src/pipeline/utils'

async function main() {
  const imagePath = getArgValue('--image')

  if (!imagePath) {
    throw new Error('请通过 --image 传入待复刻的效果图路径。')
  }

  const result = await runTask({ imagePath })
  console.log(
    JSON.stringify(
      {
        taskId: result.taskId,
        exitReason: result.exitReason,
        metExpectation: result.metExpectation,
        reasons: result.reasons,
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
