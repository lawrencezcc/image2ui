import type { RepairIntent, StageArtifact, StageDebugStats } from './types'
import { clamp, hashJson } from './utils'

function createSnapshotMap(stage: StageArtifact) {
  return new Map(stage.render.nodes.map((node) => [node.nodeId, node]))
}

function actionScore(intent: RepairIntent, previous: StageArtifact, current: StageArtifact) {
  const previousNode = intent.nodeId ? createSnapshotMap(previous).get(intent.nodeId) : undefined
  const currentNode = intent.nodeId ? createSnapshotMap(current).get(intent.nodeId) : undefined

  if (intent.intentType === 'add_node') {
    return currentNode ? 1 : 0
  }

  if (!previousNode || !currentNode) {
    return 0
  }

  switch (intent.intentType) {
    case 'move_node': {
      const deltaX = currentNode.rect.x - previousNode.rect.x
      const deltaY = currentNode.rect.y - previousNode.rect.y
      const expectedX = intent.expectedDelta?.x ?? 0
      const expectedY = intent.expectedDelta?.y ?? 0

      if (expectedX !== 0) {
        return clamp(Math.abs(deltaX / expectedX), 0, 1)
      }

      if (expectedY !== 0) {
        return clamp(Math.abs(deltaY / expectedY), 0, 1)
      }

      return deltaX !== 0 || deltaY !== 0 ? 1 : 0
    }
    case 'resize_node':
    case 'change_text_box': {
      const deltaWidth = currentNode.rect.width - previousNode.rect.width
      const deltaHeight = currentNode.rect.height - previousNode.rect.height
      return deltaWidth !== 0 || deltaHeight !== 0 ? 1 : 0
    }
    case 'change_z_index':
      return currentNode.zIndex !== previousNode.zIndex || !currentNode.occluded ? 1 : 0
    case 'change_font_style':
      return currentNode.fontSize !== previousNode.fontSize || currentNode.lineHeight !== previousNode.lineHeight
        ? 1
        : 0
    default:
      return hashJson(currentNode.rect) !== hashJson(previousNode.rect) ? 1 : 0
  }
}

function outcomeScore(intent: RepairIntent, current: StageArtifact) {
  const matchingIssue = current.repairReport.issues.find((issue) => issue.issueId === intent.issueId)
  return matchingIssue ? 0 : 1
}

export function computeDebugStats(previous: StageArtifact | undefined, current: StageArtifact): StageDebugStats | undefined {
  if (!previous) {
    return undefined
  }

  const intents = previous.repairReport.intents
  const addIntents = intents.filter((intent) => intent.changeClass === 'add')
  const modifyIntents = intents.filter((intent) => intent.changeClass === 'modify')

  const addScores = addIntents.map((intent) => {
    const action = actionScore(intent, previous, current)
    const outcome = outcomeScore(intent, current)
    return {
      action,
      outcome,
      total: 0.4 * action + 0.6 * outcome,
    }
  })

  const modifyScores = modifyIntents.map((intent) => {
    const action = actionScore(intent, previous, current)
    const outcome = outcomeScore(intent, current)
    return {
      action,
      outcome,
      total: 0.4 * action + 0.6 * outcome,
    }
  })

  const previousNodes = createSnapshotMap(previous)
  const currentNodes = createSnapshotMap(current)
  const targetedNodes = new Set(intents.map((intent) => intent.nodeId).filter(Boolean) as string[])
  const changedNodes = [...currentNodes.values()].filter((node) => {
    const previousNode = previousNodes.get(node.nodeId)
    return !previousNode || hashJson(node) !== hashJson(previousNode)
  })
  const componentChanged = previous.componentSource.trim() !== current.componentSource.trim()
  const renderChanged =
    previous.render.renderHash !== current.render.renderHash ||
    previous.render.layoutHash !== current.render.layoutHash
  const visualGain = current.metrics.visualSimilarity - previous.metrics.visualSimilarity
  const focusedVisualGain =
    current.metrics.focusedVisualSimilarity - previous.metrics.focusedVisualSimilarity
  const overEditCount = changedNodes.filter((node) => !targetedNodes.has(node.nodeId)).length

  const previousIssueIds = new Set(previous.repairReport.issues.map((issue) => issue.issueId))
  const newIssueCount = current.repairReport.issues.filter((issue) => !previousIssueIds.has(issue.issueId)).length
  const noOp = !componentChanged && !renderChanged && changedNodes.length === 0

  if (intents.length === 0) {
    return {
      overallAdherenceRate: noOp ? 0 : 1,
      addExecutionRate: 0,
      addEffectiveRate: 0,
      modifyExecutionRate: 0,
      modifyEffectiveRate: 0,
      overEditCount,
      regressionCount: current.metrics.criticalIssueCount > previous.metrics.criticalIssueCount ? 1 : 0,
      newIssueCount,
      repairIntentCount: 0,
      changedNodeCount: changedNodes.length,
      componentChanged,
      renderChanged,
      visualGain,
      focusedVisualGain,
      noOp,
    }
  }

  return {
    overallAdherenceRate:
      [...addScores, ...modifyScores].reduce((sum, entry) => sum + entry.total, 0) / intents.length,
    addExecutionRate:
      addScores.length > 0 ? addScores.reduce((sum, entry) => sum + entry.action, 0) / addScores.length : 1,
    addEffectiveRate:
      addScores.length > 0 ? addScores.reduce((sum, entry) => sum + entry.outcome, 0) / addScores.length : 1,
    modifyExecutionRate:
      modifyScores.length > 0
        ? modifyScores.reduce((sum, entry) => sum + entry.action, 0) / modifyScores.length
        : 1,
    modifyEffectiveRate:
      modifyScores.length > 0
        ? modifyScores.reduce((sum, entry) => sum + entry.outcome, 0) / modifyScores.length
        : 1,
    overEditCount,
    regressionCount: current.metrics.criticalIssueCount > previous.metrics.criticalIssueCount ? 1 : 0,
    newIssueCount,
    repairIntentCount: intents.length,
    changedNodeCount: changedNodes.length,
    componentChanged,
    renderChanged,
    visualGain,
    focusedVisualGain,
    noOp,
  }
}
