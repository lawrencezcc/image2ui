import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const projectRoot = process.cwd()

const localEnvPaths = [path.join(projectRoot, '.env.local'), path.join(projectRoot, '.env')]

for (const envPath of localEnvPaths) {
  if (!existsSync(envPath) || typeof process.loadEnvFile !== 'function') {
    continue
  }

  process.loadEnvFile(envPath)
}

export const paths = {
  root: projectRoot,
  publicRoot: path.join(projectRoot, 'public'),
  artifactsRoot: path.join(projectRoot, 'public', 'artifacts'),
  tasksRoot: path.join(projectRoot, 'public', 'artifacts', 'tasks'),
  evalsRoot: path.join(projectRoot, 'public', 'artifacts', 'evals'),
  evalHistoryPath: path.join(projectRoot, 'public', 'artifacts', 'evals', 'history.json'),
  generatedAssetsRoot: path.join(projectRoot, 'public', 'artifacts', 'generated-assets'),
  runtimeRoot: path.join(projectRoot, 'public', 'artifacts', 'runtime'),
  runtimeMetaPath: path.join(projectRoot, 'public', 'artifacts', 'runtime', 'current-stage.json'),
  runtimeComponentPath: path.join(projectRoot, 'src', 'runtime', 'generated', 'CurrentStage.vue'),
  timelinePath: path.join(projectRoot, 'public', 'artifacts', 'timeline.json'),
}

export const renderServer = {
  host: '127.0.0.1',
  port: Number(process.env.RENDER_PORT ?? '4173'),
}

export const pipelineDefaults = {
  maxIterations: Number(process.env.MAX_ITERATIONS ?? '8'),
  maxDurationMs: Number(process.env.MAX_DURATION_MS ?? `${15 * 60 * 1000}`),
  maxNoProgressRounds: Number(process.env.MAX_NO_PROGRESS_ROUNDS ?? '2'),
  maxSameIssueRepeats: Number(process.env.MAX_SAME_ISSUE_REPEATS ?? '3'),
  minVisualGain: Number(process.env.MIN_VISUAL_GAIN ?? '0.002'),
  minSuccessSimilarity: Number(process.env.MIN_SUCCESS_SIMILARITY ?? '0.93'),
}

export const projectMemory = {
  projectGoal:
    '将 UI 参考图的效果 100% 还原复刻为可视化 UI 组件，支持 dom、svg、canvas 等主流的底层技术。',
  designPrinciple:
    '遵守软件设计的 SOLID 原则，优先保证系统具备清晰职责边界、可扩展性、可替换性、低耦合和可维护性。',
  currentPhase:
    '当前阶段优先把 dom + svg 做到最稳、最可验证、最可修复，同时必须在架构设计上保留 canvas 扩展位，且不能因此影响其他类型的效果。',
}

export const codexConfig = {
  bin: process.env.CODEX_BIN ?? 'codex',
  model: process.env.CODEX_MODEL ?? 'gpt-5.4-mini',
  timeoutMs: Number(process.env.CODEX_TIMEOUT_MS ?? '90000'),
}

export const qwenVlConfig = {
  apiKeyEnv: 'DASHSCOPE_API_KEY',
  baseURL: process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: process.env.QWEN_VL_MODEL ?? 'qwen3-vl-235b-a22b-instruct',
  timeoutMs: Number(process.env.QWEN_VL_TIMEOUT_MS ?? '120000'),
}

export const qwenOcrConfig = {
  apiKeyEnv: 'DASHSCOPE_API_KEY',
  baseURL:
    process.env.QWEN_OCR_BASE_URL ??
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  model: process.env.QWEN_OCR_MODEL ?? 'qwen-vl-ocr',
  timeoutMs: Number(process.env.QWEN_OCR_TIMEOUT_MS ?? '120000'),
  minPixels: Number(process.env.QWEN_OCR_MIN_PIXELS ?? `${32 * 32 * 3}`),
  maxPixels: Number(process.env.QWEN_OCR_MAX_PIXELS ?? `${32 * 32 * 8192}`),
}

export const kimiConfig = {
  apiKeyEnv: 'KIMI_API_KEY',
  baseURL: process.env.KIMI_BASE_URL ?? 'https://api.kimi.com/coding/v1',
  model: process.env.KIMI_MODEL ?? 'kimi-for-coding',
  timeoutMs: Number(process.env.KIMI_TIMEOUT_MS ?? '120000'),
  enabled: process.env.ENABLE_KIMI_FALLBACK === 'true',
}

export const qwenImageConfig = {
  apiKeyEnv: 'DASHSCOPE_API_KEY',
  baseURL:
    process.env.QWEN_IMAGE_BASE_URL ??
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  model: process.env.QWEN_IMAGE_MODEL ?? 'qwen-image-2.0',
  proModel: process.env.QWEN_IMAGE_PRO_MODEL ?? 'qwen-image-2.0-pro',
  timeoutMs: Number(process.env.QWEN_IMAGE_TIMEOUT_MS ?? '180000'),
  allowGeneratedFallback: process.env.ALLOW_GENERATED_ASSET_FALLBACK === 'true',
}
