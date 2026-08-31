/**
 * docxParagraphs — docx/文本文件结构化解析（从 OfficePanel 抽出的公共工具）
 *
 * 原 OfficePanel 内部函数，Ethan 抽屉同步（formDrawerSyncService）需要复用同一套
 * 解析逻辑，故抽取为独立工具；OfficePanel 改为从此处 import，行为不变。
 *
 * v3.1.1 增强：docx 改用 DOMParser 按 XML 结构解析——
 * - 顶层 <w:p> 与 <w:tbl> 按文档顺序提取，段落与表格不再互相混淆
 * - 表格保留行级结构：每行渲染为一个段落，单元格以「 ｜ 」分隔
 *   （此前正则把表格单元格打散成碎片段落，申报书类表单文档导入后排版全毁）
 * - 单元格内的竖排文字（单字成段/单字换行）自动合并为正常词语
 */

import PizZip from 'pizzip'

export interface DocxBlock {
  type: 'paragraph' | 'table'
  /** type=paragraph 时的文本内容 */
  text?: string
  /** type=table 时的行数据（每行为单元格文本数组） */
  rows?: string[][]
}

/**
 * 解析上传文件为段落数组（供 Univer 文档导入）
 * 支持 .docx（DOMParser 结构化解析，表格保留行结构）及其余格式（按纯文本分行）
 */
export async function parseDocxParagraphs(fileName: string, buffer: ArrayBuffer): Promise<string[]> {
  return convertDocxBlocksToParagraphs(await parseDocxBlocks(fileName, buffer))
}

/**
 * 从 base64 编码的文件内容解析段落数组（Ethan 抽屉同步使用：
 * FormDocument.rawContent 存的是 docx/文本文件的 base64）
 */
export async function parseDocxParagraphsFromBase64(fileName: string, base64: string): Promise<string[]> {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return parseDocxParagraphs(fileName, bytes.buffer)
}

/**
 * 结构化解析：docx 返回段落/表格块序列（按文档顺序），纯文本按行返回段落块
 */
export async function parseDocxBlocks(fileName: string, buffer: ArrayBuffer): Promise<DocxBlock[]> {
  if (!/\.docx$/i.test(fileName)) {
    const text = new TextDecoder().decode(buffer)
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => ({ type: 'paragraph' as const, text: line }))
  }

  const zip = new PizZip(buffer)
  const docXml = zip.file('word/document.xml')?.asText()
  if (!docXml) return []

  // DOMParser 结构化解析：顶层 <w:p>/<w:tbl> 按文档顺序遍历，
  // 表格不再被正则打散（旧实现的乱排版根因）
  const xmlDoc = new DOMParser().parseFromString(docXml, 'text/xml')
  const body = xmlDoc.getElementsByTagName('w:body')[0]
  if (!body) return []

  const blocks: DocxBlock[] = []
  for (const child of Array.from(body.children)) {
    const tag = child.tagName
    if (tag === 'w:p') {
      blocks.push({ type: 'paragraph', text: extractWText(child).trim() })
    } else if (tag === 'w:tbl') {
      blocks.push({ type: 'table', rows: extractWTableRows(child) })
    }
  }
  return blocks
}

/** 把结构化块序列展平为 Univer 文档段落数组 */
export function convertDocxBlocksToParagraphs(blocks: DocxBlock[]): string[] {
  const paragraphs: string[] = []
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      paragraphs.push(block.text ?? '')
      continue
    }
    // 表格：每行一个段落，单元格以「 ｜ 」分隔；行尾空单元格裁掉
    for (const row of block.rows ?? []) {
      const cells = row.map((c) => c.trim())
      while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop()
      if (cells.some((c) => c !== '')) {
        paragraphs.push(cells.join(' ｜ '))
      }
    }
    paragraphs.push('') // 表格后留一空行，视觉上与正文分隔
  }
  return paragraphs
}

/**
 * 提取段落/单元格元素内的文本（按文档顺序遍历 w:t / w:tab / w:br）。
 * 保留 <w:br/> 为 \n，供上层做竖排文字合并。
 */
function extractWText(el: Element): string {
  let text = ''
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (child.tagName === 'w:t') {
        text += child.textContent ?? ''
      } else if (child.tagName === 'w:tab') {
        text += '\t'
      } else if (child.tagName === 'w:br' || child.tagName === 'w:cr') {
        text += '\n'
      } else if (child.tagName === 'w:r') {
        walk(child)
      }
    }
  }
  walk(el)
  return text
}

/**
 * 提取表格的行数据：tbl → tr → tc，逐格取文本。
 * 单元格内多个段落/换行：全部为单字（竖排文字，如「队\n伍\n情\n况」）时合并为词语，
 * 否则以空格连接。只处理一层表格（嵌套表格内的行不会被外层误收）。
 */
function extractWTableRows(tbl: Element): string[][] {
  const rows: string[][] = []
  for (const tr of Array.from(tbl.children)) {
    if (tr.tagName !== 'w:tr') continue
    const row: string[] = []
    for (const tc of Array.from(tr.children)) {
      if (tc.tagName !== 'w:tc') continue
      row.push(normalizeCellText(tc))
    }
    rows.push(row)
  }
  return rows
}

/** 单元格文本归一化：合并竖排单字，压平换行与多余空白 */
function normalizeCellText(tc: Element): string {
  const parts = Array.from(tc.children)
    .filter((c) => c.tagName === 'w:p')
    .map((p) => extractWText(p))
  const allParts = parts
    .join('\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (allParts.length === 0) return ''
  // 竖排文字：每段都只有单字 → 直接拼词
  if (allParts.every((s) => Array.from(s).length === 1)) return allParts.join('')
  return allParts.join(' ')
}
