import type { TaskTraceSpan, TaskTraceSummary } from './types'

export class TraceRecorder {
  private readonly taskId: string
  private readonly createdAt: string
  private readonly spans = new Map<string, TaskTraceSpan>()
  private latestError: string | undefined

  constructor(taskId: string, createdAt: string) {
    this.taskId = taskId
    this.createdAt = createdAt
  }

  start(
    name: TaskTraceSpan['name'],
    category: TaskTraceSpan['category'],
    options?: {
      stageIndex?: number
      details?: Record<string, unknown>
    },
  ) {
    const id = `${category}:${name}:${this.spans.size + 1}`
    this.spans.set(id, {
      id,
      name,
      category,
      stageIndex: options?.stageIndex,
      status: 'running',
      startedAt: new Date().toISOString(),
      details: options?.details,
    })
    return id
  }

  finish(
    id: string,
    status: 'completed' | 'failed',
    options?: {
      details?: Record<string, unknown>
      error?: string
    },
  ) {
    const span = this.spans.get(id)
    if (!span) {
      return
    }

    const endedAt = new Date().toISOString()
    const durationMs =
      new Date(endedAt).getTime() - new Date(span.startedAt).getTime()
    this.spans.set(id, {
      ...span,
      status,
      endedAt,
      durationMs,
      details: {
        ...span.details,
        ...options?.details,
      },
      error: options?.error,
    })

    if (options?.error) {
      this.latestError = options.error
    }
  }

  snapshot(status: 'running' | 'completed', eventCount = 0): TaskTraceSummary {
    const spans = [...this.spans.values()].sort((left, right) =>
      left.startedAt.localeCompare(right.startedAt),
    )
    const lastEnded = spans
      .map((span) => span.endedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1)
    const totalDurationMs = lastEnded
      ? new Date(lastEnded).getTime() - new Date(this.createdAt).getTime()
      : undefined

    return {
      taskId: this.taskId,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      status,
      spanCount: spans.length,
      eventCount,
      latestError: this.latestError,
      totalDurationMs,
      spans,
    }
  }
}
