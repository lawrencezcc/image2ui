import { projectMemory } from './config'
import type { RenderPreference, RepairReport, SceneDocument, StageArtifact } from './types'

function projectMemoryInstructions() {
  return `
项目全局记忆：
- 项目目标：${projectMemory.projectGoal}
- 程序设计原则：${projectMemory.designPrinciple}
- ${projectMemory.currentPhase}
`.trim()
}

function stripRenderMarkers(promptText?: string) {
  return promptText?.replace(/\/(?:svg|canvas)\//gi, '').replace(/\s+/g, ' ').trim()
}

function renderPreferenceInstructions(renderPreference: RenderPreference, promptText?: string) {
  const semanticPrompt = stripRenderMarkers(promptText)
  const promptLine = semanticPrompt
    ? `- 用户生成提示词：${semanticPrompt}`
    : '- 用户未提供显式渲染偏好提示词。'

  if (renderPreference === 'svg') {
    return `
${promptLine}
- 已检测到显式偏好：/svg/。图表主内容优先输出为单个或少量 svg 节点。
- 图表类节点必须尽量提供内联 \`svg\` 字符串，不要只给空容器或只有图例/坐标轴。`
  }

  if (renderPreference === 'canvas') {
    return `
${promptLine}
- 已检测到显式偏好：/canvas/。图表主内容优先输出为 canvas 节点，并在 notes 中写清绘制要点。
- 如果 canvas 难以稳定表达文本与网格，可将轴标签保留为 html/svg，但主图表 marks 仍优先 canvas。`
  }

  return `
${promptLine}
- 未检测到显式偏好时，图表主内容默认优先输出为 svg；只有明显更适合时才选 canvas。`
}

export function createScenePrompt(
  imagePath: string,
  width: number,
  height: number,
  renderPreference: RenderPreference,
  ocrHint?: string,
  promptText?: string,
) {
  return `
你是一个严格的视觉还原规划器。请根据附图输出 scene.json。

${projectMemoryInstructions()}

目标：
- 这是一个 clone-static 模式的固定画板复刻任务。
- v1 只复刻单个卡片或单个面板，不复刻整页拼贴图。
- 输出精确的 artboard、节点、层级、文本盒子和约束。
- 优先为图表、波形、几何形状选择 svg；只有明显需要时才选择 canvas。
- 所有数值使用像素单位，尽量避免猜测性描述。
- 如果输入图包含多个卡片、多个界面或整页拼贴，请只选择最居中或最有代表性的单个卡片/面板来复刻。
- 只提取高价值节点，不要穷举所有细碎装饰。优先识别 6 到 10 个最关键节点。

渲染偏好：
${renderPreferenceInstructions(renderPreference, promptText)}

OCR 辅助信息：
${
  ocrHint
    ? `- 以下信息由 OCR 高置信提取，请优先用于标题、图例、坐标轴、刻度、徽标、标签等可见文本内容与大致位置：
${ocrHint}`
    : '- 本轮没有可用 OCR 结果，请自行识别文本。'
}

硬性要求：
- 只输出符合 schema 的 JSON。
- schema 中的 \`scene_json\` 字段必须是完整 scene 文档的 JSON 字符串，而不是自然语言解释。
- \`summary\` 用一句话概括这张设计图的结构。
- scene.source.image 使用 "${imagePath}"。
- scene.source.width 使用 ${width}。
- scene.source.height 使用 ${height}。
- mode 固定为 "clone-static"。
- nodes 必须覆盖被选中卡片/面板的主要可见元素，至少包含容器、标题、主要内容块、图表/图标和关键文本。
- 如果页面包含重复模块，允许把重复结构抽象成一个代表性模块，不必把每个重复元素都展开。
- text 节点必须提供准确的文本盒子与字体参数。
- constraints 至少包含：inside-parent、no-text-overflow 以及关键对齐约束。
- 对有圆角裁切、遮罩、overflow 的父节点显式填写 clip。
- 如果识别到图表，不能只输出图例和坐标轴，必须覆盖主图表 marks。
- 如果主图表选择 svg，主图表节点必须包含可直接渲染的 \`svg\` 内容。

请保持结构尽量简洁，但不要省略会影响对齐、溢出、遮挡判断的字段。
  `.trim()
}

export function createChartSpecPrompt(
  width: number,
  height: number,
  renderPreference: RenderPreference,
  ocrHint?: string,
  promptText?: string,
) {
  return `
你是一个严格的图表结构提取器。请根据附图提取可用于高保真重建的 chart spec。

${projectMemoryInstructions()}

目标：
- 这一步不是直接生成 Vue 代码，而是提取足够稳定的图表结构，供后续 scene 构建和组件生成使用。
- 重点识别图例、坐标轴、刻度、类别、系列颜色、每个系列的数据点或柱状值。
- 如果是折线图、面积图、散点图、雷达图等，优先提供更细的几何采样点 points，便于高保真重建。
- 如果是环形图、饼图，尽量给出每个扇区的独立值。
- 如果是堆叠柱状图、组合图或带虚线台阶线的图，请在 plotHint 中显式说明 stacked / stepLine。
- 数值允许是视觉估计值，但必须和图中几何关系一致，不能凭空捏造不存在的系列或标签。
- 保持输出紧凑，只输出 JSON。
- 图表主内容优先服务于 ${renderPreference} 重建；如果图中是柱状图、折线图、面积图等，请明确 subtype。

图像尺寸：
- width: ${width}
- height: ${height}

渲染偏好：
${renderPreferenceInstructions(renderPreference, promptText)}

OCR 辅助信息：
${
  ocrHint
    ? `- 以下信息由 OCR 高置信提取，请优先用于图例、轴标签、刻度和类别文本：
${ocrHint}`
    : '- 本轮没有可用 OCR 结果，请自行识别文本。'
}

输出要求：
- 只输出 JSON，不要 markdown，不要解释。
- JSON 字段固定为：
{
  "type": "chart",
  "subtype": "grouped-bar|stacked-bar|bar|line|area|pie|donut|radar|scatter|combo|other",
  "title": "",
  "plotHint": {
    "shape": "cartesian|polar",
    "innerRadiusRatio": 0.58,
    "stacked": false,
    "stepLine": false
  },
  "xAxis": { "label": "", "categories": [] },
  "yAxis": { "label": "", "min": 0, "max": 0, "step": 0 },
  "series": [
    {
      "name": "",
      "color": "#000000",
      "fillColor": "#000000",
      "data": [],
      "points": [{ "x": 0.0, "y": 0.0 }],
      "areaOpacity": 0.18,
      "lineDash": [8, 6]
    }
  ],
  "legend": {
    "items": [
      { "name": "", "color": "#000000" }
    ]
  }
}

硬性要求：
- 所有颜色使用十六进制。
- 如果是常规柱状图/折线图/面积图，series.data 长度必须和 xAxis.categories 长度一致。
- 如果是饼图/环形图，每个 series.data 只保留一个值。
- points 中的 x / y 采用 0 到 1 的归一化坐标，表示相对 plot 区域的位置。
- 如果图中没有 title，title 为空字符串。
- 如果无法确定 min/max/step，请给出最贴近图中刻度的估计值。
- 不要输出 scene.json，不要输出节点树。
  `.trim()
}

export function createInitialComponentPrompt(scene: SceneDocument) {
  return `
根据下面的 scene.json 生成一个完整的 Vue 3 SFC。

${projectMemoryInstructions()}

目标：
- 生成 clone-static 风格的可渲染组件，优先视觉保真。
- 根节点必须带 data-artboard-root="true"。
- 每个 scene node 都必须映射到一个带 data-node-id="<node.id>" 的 DOM 或 SVG 节点。
- 如果 scene 中存在 render 为 canvas 的节点，允许使用 <canvas> + onMounted 绘制，但仍需保留对应 data-node-id。
- 不要依赖任何外部组件库、字体 CDN 或图片 URL。
- 允许使用内联 svg、绝对定位、渐变、阴影、裁切。
- 默认保持 fixed-size artboard，不要擅自改成响应式重排。
- 能确定的内容直接写死，不要引入 props。

实现要求：
- 输出完整 SFC，包含 <template> 和 <style scoped>。
- 可以省略 <script setup>，但如果保留也必须为空逻辑或只做简单常量。
- 不要使用 TypeScript 运行时代码。
- 组件渲染尺寸必须与 scene.artboard 一致。
- 文本必须显式写 font-size、line-height、letter-spacing、white-space、overflow。
- 对 clip 节点使用 overflow / border-radius 明确裁切。
- 对图表优先使用 svg。

scene.json:
${JSON.stringify(scene, null, 2)}
  `.trim()
}

export function createRepairPrompt(
  scene: SceneDocument,
  stage: StageArtifact,
  report: RepairReport,
  renderPreference: RenderPreference,
  ocrHint?: string,
  bestStage?: StageArtifact,
) {
  return `
你在修复一个 Vue 3 SFC 的视觉还原问题。请只做定向修复，不要整页重写。

${projectMemoryInstructions()}

硬性要求：
- 返回完整的 Vue SFC。
- 保持 data-artboard-root="true"。
- 保持所有现有 data-node-id 稳定，不要重命名。
- 优先只修改 repair-report 中涉及的节点。
- 不要改动未被点名的节点，除非为了修复遮挡/层级必须连带调整。
- 不要移除已经正确工作的结构。
- 当前渲染偏好：${renderPreference}。
- 如果 OCR 提供了文本提示，优先保证标题、图例、坐标轴、刻度和标签与 OCR 一致。

修复目标：
- 先处理 critical/high 问题。
- 优先解决：文字溢出、遮挡、错位、对齐、层级。
- 如果某个节点适合从 html 改为 svg，可以这样做，但保留原 node id。
- 如果某个节点是 canvas 图表节点，允许继续使用 <canvas> 绘制并只修复对应绘图逻辑，不要擅自退回空容器。
- 如果本轮结果不如历史最佳，请参考 best-stage 的结构，不要继续在错误方向上放大偏差。

scene.json:
${JSON.stringify(scene, null, 2)}

当前组件:
${stage.componentSource}

repair-report:
${JSON.stringify(report, null, 2)}

${
  ocrHint
    ? `OCR 文本提示（高置信）:
${ocrHint}`
    : '本轮没有可用 OCR 文本提示。'
}

${
  bestStage
    ? `历史最佳组件（如当前版本回归，可局部参考其结构）:
${bestStage.componentSource}`
    : '当前版本就是历史最佳，不需要回滚参考。'
}
  `.trim()
}
