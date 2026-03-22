import type { SceneDocument, SceneNode } from './types'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function styleToString(style: Record<string, string | number | undefined>) {
  return Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}:${value}`)
    .join(';')
}

function radiusToCss(node: SceneNode) {
  const radius = node.clip?.radius
  if (!radius?.length) {
    return undefined
  }

  return radius.map((value) => `${value}px`).join(' ')
}

function nodeFill(node: SceneNode) {
  return node.style?.fills?.[0] ?? node.style?.background ?? 'transparent'
}

function shouldUseVerticalText(node: SceneNode) {
  if (!node.text) {
    return false
  }

  if (node.text.direction === 'vertical') {
    return true
  }

  const compactText = node.text.content.replace(/\s+/g, '')
  const isMostlyCjk = [...compactText].every((char) => /[\u3040-\u30ff\u3400-\u9fff]/.test(char))
  return isMostlyCjk && node.frame.height >= node.frame.width * 2.4
}

function textTransform(node: SceneNode) {
  if (node.text?.direction === 'rotate-ccw') {
    return 'rotate(-90deg)'
  }

  if (node.text?.direction === 'rotate-cw') {
    return 'rotate(90deg)'
  }

  return undefined
}

function layoutFrame(node: SceneNode) {
  const transform = textTransform(node)
  if (!transform || !node.text) {
    return node.frame
  }

  const width = node.text.box.width
  const height = node.text.box.height
  return {
    ...node.frame,
    x: node.frame.x + (node.frame.width - width) / 2,
    y: node.frame.y + (node.frame.height - height) / 2,
    width,
    height,
  }
}

function hasCanvasNodes(scene: SceneDocument) {
  return scene.nodes.some((node) => node.render === 'canvas' && node.canvas)
}

function renderNode(node: SceneNode) {
  const useVerticalText = shouldUseVerticalText(node)
  const transform = textTransform(node)
  const frame = layoutFrame(node)
  const baseStyle = styleToString({
    position: 'absolute',
    left: `${frame.x}px`,
    top: `${frame.y}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
    'z-index': node.zIndex,
    opacity: node.opacity ?? 1,
    overflow: node.clip?.enabled ? 'hidden' : 'visible',
    'border-radius': radiusToCss(node),
    background: node.type === 'text' ? 'transparent' : nodeFill(node),
    color: node.text?.color,
    'font-family': node.text?.fontFamily,
    'font-size': node.text ? `${node.text.fontSize}px` : undefined,
    'font-weight': node.text?.fontWeight,
    'line-height': node.text ? `${node.text.lineHeight}px` : undefined,
    'letter-spacing': node.text ? `${node.text.letterSpacing}px` : undefined,
    'white-space': useVerticalText ? 'normal' : node.text?.wrap === 'normal' ? 'normal' : 'nowrap',
    'writing-mode': useVerticalText ? 'vertical-rl' : undefined,
    'text-orientation': useVerticalText ? 'mixed' : undefined,
    'text-align': node.text?.align,
    display: transform ? 'flex' : undefined,
    'align-items': transform ? 'center' : undefined,
    'justify-content': transform ? 'center' : undefined,
    transform,
    'transform-origin': transform ? 'center center' : undefined,
  })

  if (node.render === 'canvas' && node.canvas) {
    return `<canvas data-node-id="${node.id}" :ref="setCanvasRef('${node.id}')" width="${Math.max(1, Math.round(frame.width))}" height="${Math.max(1, Math.round(frame.height))}" style="${baseStyle}"></canvas>`
  }

  if (node.render === 'svg' && node.type === 'ellipse') {
    return `
      <svg data-node-id="${node.id}" viewBox="0 0 ${frame.width} ${frame.height}" style="${baseStyle}">
        <ellipse cx="${frame.width / 2}" cy="${frame.height / 2}" rx="${frame.width / 2}" ry="${frame.height / 2}" fill="${nodeFill(node)}" />
      </svg>
    `.trim()
  }

  if (node.render === 'svg' && typeof node.svg === 'string' && node.svg.includes('<svg')) {
    return node.svg.replace('<svg', `<svg data-node-id="${node.id}" style="${baseStyle}"`)
  }

  if (node.type === 'image' && node.asset?.src) {
    return `<img data-node-id="${node.id}" src="/${node.asset.src}" alt="${escapeHtml(node.name ?? node.id)}" style="${baseStyle};object-fit:contain" />`
  }

  if (node.text) {
    return `<div data-node-id="${node.id}" style="${baseStyle}">${escapeHtml(node.text.content)}</div>`
  }

  return `<div data-node-id="${node.id}" style="${baseStyle}"></div>`
}

export function isRenderableSfc(source: string) {
  return /<template[\s>]/i.test(source) || /<script[\s>]/i.test(source)
}

export function buildFallbackComponent(scene: SceneDocument) {
  const nodesMarkup = [...scene.nodes]
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((node) => renderNode(node))
    .join('\n')
  const canvasNodes = scene.nodes.filter((node) => node.render === 'canvas' && node.canvas)
  const canvasSpecsLiteral = JSON.stringify(
    Object.fromEntries(canvasNodes.map((node) => [node.id, node.canvas])),
    null,
    2,
  )
  const scriptBlock = hasCanvasNodes(scene)
    ? `
<script setup>
import { onMounted } from 'vue'
import { createCanvasBindings } from '../canvas-runtime'

const canvasSpecs = ${canvasSpecsLiteral}
const { setCanvasRef, drawAll } = createCanvasBindings()

onMounted(() => {
  drawAll(canvasSpecs)
})
</script>
    `.trim()
    : ''

  return `
${scriptBlock}

<template>
  <div
    data-artboard-root="true"
    style="${styleToString({
      position: 'relative',
      width: `${scene.artboard.width}px`,
      height: `${scene.artboard.height}px`,
      background: scene.artboard.background,
      overflow: scene.artboard.clip ? 'hidden' : 'visible',
      'border-radius': '24px',
      'box-sizing': 'border-box',
    })}"
  >
    ${nodesMarkup}
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
</style>
  `.trim()
}
