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

  const compactText = node.text.content.replace(/\s+/g, '')
  const isMostlyCjk = [...compactText].every((char) => /[\u3040-\u30ff\u3400-\u9fff]/.test(char))
  return isMostlyCjk && node.frame.height >= node.frame.width * 2.4
}

function renderNode(node: SceneNode) {
  const useVerticalText = shouldUseVerticalText(node)
  const baseStyle = styleToString({
    position: 'absolute',
    left: `${node.frame.x}px`,
    top: `${node.frame.y}px`,
    width: `${node.frame.width}px`,
    height: `${node.frame.height}px`,
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
  })

  if (node.render === 'svg' && node.type === 'ellipse') {
    return `
      <svg data-node-id="${node.id}" viewBox="0 0 ${node.frame.width} ${node.frame.height}" style="${baseStyle}">
        <ellipse cx="${node.frame.width / 2}" cy="${node.frame.height / 2}" rx="${node.frame.width / 2}" ry="${node.frame.height / 2}" fill="${nodeFill(node)}" />
      </svg>
    `.trim()
  }

  if (node.render === 'svg' && typeof node.svg === 'string' && node.svg.includes('<svg')) {
    return node.svg.replace('<svg', `<svg data-node-id="${node.id}" style="${baseStyle}"`)
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

  return `
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
