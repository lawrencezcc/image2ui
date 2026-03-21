import { runTask } from '../src/pipeline/orchestrator'
import { getArgValue } from '../src/pipeline/utils'

async function main() {
  const imagePath = getArgValue('--image')
  const promptText = getArgValue('--prompt')

  if (!imagePath) {
    throw new Error('请通过 --image 指定验证图片路径。')
  }

  const result = await runTask({ imagePath, promptText })
  console.log(
    JSON.stringify(
      {
        taskId: result.taskId,
        exitReason: result.exitReason,
        metExpectation: result.metExpectation,
        reasons: result.reasons,
        bestStage: {
          index: result.bestStage.index,
          similarity: result.bestStage.metrics.visualSimilarity,
          focusedSimilarity: result.bestStage.metrics.focusedVisualSimilarity,
          criticalIssueCount: result.bestStage.metrics.criticalIssueCount,
          overflowCount: result.bestStage.metrics.overflowCount,
          occlusionCount: result.bestStage.metrics.occlusionCount,
          renderMode: result.bestStage.renderMode,
        },
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
