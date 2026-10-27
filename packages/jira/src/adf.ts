import type { AdfNode } from './entities.js'
import { escapeHtml } from '@emulators/core'

export function isAdfDoc(value: unknown): value is AdfNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const doc = value as AdfNode
  return doc.type === 'doc' && doc.version === 1 && Array.isArray(doc.content) && doc.content.every(isAdfNode)
}

function isAdfNode(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const node = value as AdfNode
  if (typeof node.type !== 'string') {
    return false
  }
  if (node.text !== undefined && typeof node.text !== 'string') {
    return false
  }
  if (node.attrs !== undefined && !isPlainObject(node.attrs)) {
    return false
  }
  if (node.marks !== undefined && !(Array.isArray(node.marks) && node.marks.every(isAdfMark))) {
    return false
  }
  return node.content === undefined || (Array.isArray(node.content) && node.content.every(isAdfNode))
}

function isAdfMark(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const mark = value as { type?: unknown, attrs?: unknown }
  if (typeof mark.type !== 'string') {
    return false
  }
  return mark.attrs === undefined || isPlainObject(mark.attrs)
}

function isPlainObject(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function textToAdf(text: string): AdfNode {
  return {
    type: 'doc',
    version: 1,
    content: text.split('\n').map(line => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  }
}

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])

function inlineText(node: AdfNode): string {
  switch (node.type) {
    case 'text':
      return node.text ?? ''
    case 'hardBreak':
      return '\n'
    case 'mention':
    case 'emoji':
      return String(node.attrs?.text ?? node.attrs?.shortName ?? node.attrs?.id ?? '')
    case 'inlineCard':
      return String(node.attrs?.url ?? '')
    case 'status':
    case 'placeholder':
      return String(node.attrs?.text ?? '')
    default:
      return (node.content ?? []).map(inlineText).join('')
  }
}

export function adfToText(node: AdfNode | null | undefined): string {
  if (!node) {
    return ''
  }
  const lines: string[] = []
  const walk = (current: AdfNode): void => {
    if (TEXT_BLOCKS.has(current.type)) {
      lines.push(inlineText(current))
    }
    else if (current.type === 'text' || current.type === 'hardBreak') {
      lines.push(inlineText(current))
    }
    else {
      for (const child of current.content ?? []) {
        walk(child)
      }
    }
  }
  walk(node)
  return lines.join('\n')
}

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto'])

function isSafeHref(href: string): boolean {
  const compact = [...href].filter(ch => ch.charCodeAt(0) > 0x20 && ch.charCodeAt(0) !== 0x7F).join('')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)
  return !scheme || SAFE_SCHEMES.has(scheme[1].toLowerCase())
}

export function adfToHtml(node: AdfNode | null | undefined): string {
  if (!node) {
    return ''
  }
  const render = (current: AdfNode): string => {
    const children = (current.content ?? []).map(render).join('')
    switch (current.type) {
      case 'doc':
        return children
      case 'paragraph':
        return `<p>${children}</p>`
      case 'heading': {
        const level = Math.min(6, Math.max(1, Number(current.attrs?.level ?? 1)))
        return `<h${level}>${children}</h${level}>`
      }
      case 'bulletList':
        return `<ul>${children}</ul>`
      case 'orderedList':
        return `<ol>${children}</ol>`
      case 'listItem':
        return `<li>${children}</li>`
      case 'codeBlock':
        return `<pre><code>${children}</code></pre>`
      case 'blockquote':
        return `<blockquote>${children}</blockquote>`
      case 'rule':
        return '<hr />'
      case 'hardBreak':
        return '<br />'
      case 'text': {
        let text = escapeHtml(current.text ?? '')
        for (const mark of current.marks ?? []) {
          if (mark.type === 'strong') {
            text = `<b>${text}</b>`
          }
          else if (mark.type === 'em') {
            text = `<em>${text}</em>`
          }
          else if (mark.type === 'code') {
            text = `<tt>${text}</tt>`
          }
          else if (mark.type === 'link') {
            const href = String(mark.attrs?.href ?? '')
            text = isSafeHref(href) ? `<a href="${escapeHtml(href)}">${text}</a>` : text
          }
        }
        return text
      }
      default:
        return children || escapeHtml(adfToText(current))
    }
  }
  return render(node)
}
