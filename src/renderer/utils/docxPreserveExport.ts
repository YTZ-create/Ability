/**
 * docxPreserveExport — 「格式保留式编辑」导出。
 *
 * 目标：导入 docx 后，无论用 Ethan / 手动 / 混合方式编辑，导出时除「改动处」外其余内容
 * 与原始文件逐字节一致。
 *
 * 原理：不整体重建。保留原始 document.xml，只对「确实改动过」的 <w:p> 段落做局部替换——
 * 保留该段的段落属性 <w:pPr>，仅重写其 run 内容；未改动的 <w:p> 及整个包的其余部分
 * （styles、页眉页脚、设置、媒体）原样保留。再用 PizZip 重新打包。
 *
 * 定位策略：把当前富文本与导入时的原始富文本逐段比对，找出文本发生变化的段落；
 * 用「原始段落文本」在 document.xml 中唯一定位对应 <w:p>。若无法唯一定位（重复文本/缺失），
 * 返回 null，由调用方回退到 docxRichToBlob 整体重建（保证结果不更坏）。
 */

import PizZip from 'pizzip'
import type { DocxRichDocument, DocxRichBlock, DocxParagraph, DocxRun } from './docxParagraphs'

const DOCX_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function paraText(p: DocxParagraph | undefined): string {
  if (!p) return ''
  return (p.runs || []).map((r) => String(r.text || '')).join('')
}

/**
 * 将富结构 blocks 平铺为「段落数组」。要求 current 与 original 传入的结构完全一致
 * （编辑只改 run 文本，不改块结构），保证平铺顺序一一对应。
 */
function flattenParagraphs(rich: DocxRichDocument | null): DocxParagraph[] {
  const out: DocxParagraph[] = []
  if (!rich) return out
  const pushBlock = (b: DocxRichBlock) => {
    if (b.type === 'paragraph') {
      out.push(b.paragraph)
    } else if (b.type === 'table' && b.table) {
      for (const row of b.table.rows) {
        for (const cell of row) {
          if (cell) cell.paragraphs?.forEach((cp) => out.push(cp))
        }
      }
    }
  }
  for (const b of rich.blocks) pushBlock(b)
  return out
}

/** 生成 <w:r> 元素（保留常见的 run 排版：粗/斜/删/颜色/字号/字体/下划线/底纹/上下标/字距/空心）。 */
function buildRunXml(xmlDoc: XMLDocument, r: DocxRun): Element {
  const ns = (name: string, attrs?: Record<string, string>) => {
    const el = xmlDoc.createElementNS(DOCX_NS, name)
    if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(`w:${k}`, attrs[k])
    return el
  }

  const rEl = ns('r')
  const rPr = ns('rPr')

  const font = r.fontFamily
  if (font) {
    const rf = ns('rFonts', {
      ascii: font,
      hAnsi: font,
      eastAsia: font,
      cs: font,
    })
    rPr.appendChild(rf)
  }
  if (r.fontSize) {
    rPr.appendChild(ns('sz', { val: String(r.fontSize) }))
    rPr.appendChild(ns('szCs', { val: String(r.fontSize) }))
  }
  if (r.bold) {
    rPr.appendChild(ns('b'))
    rPr.appendChild(ns('bCs'))
  }
  if (r.italic) {
    rPr.appendChild(ns('i'))
    rPr.appendChild(ns('iCs'))
  }
  if (r.strike) rPr.appendChild(ns('strike'))
  if (r.outline) rPr.appendChild(ns('outline'))
  if (r.color) rPr.appendChild(ns('color', { val: r.color.replace(/^#/, '') }))
  if (r.highlight) rPr.appendChild(ns('highlight', { val: r.highlight }))
  if (r.characterSpacing) rPr.appendChild(ns('spacing', { val: String(Math.round(r.characterSpacing)) }))
  if (r.vertAlign) {
    const v = r.vertAlign === 'super' ? 'superscript' : 'subscript'
    rPr.appendChild(ns('vertAlign', { val: v }))
  }
  if (r.underline) {
    rPr.appendChild(ns('u', { val: r.underline === 'double' ? 'double' : 'single' }))
  }

  if (rPr.childNodes.length) rEl.appendChild(rPr)

  if (r.pageNumber) {
    rEl.appendChild(ns('fldChar', { fldCharType: 'begin' }))
    const instr = ns('instrText', { 'xml:space': 'preserve' } as Record<string, string>)
    instr.textContent = ' PAGE '
    rEl.appendChild(instr)
    rEl.appendChild(ns('fldChar', { fldCharType: 'end' }))
  } else {
    const t = ns('t', { 'xml:space': 'preserve' } as Record<string, string>)
    t.textContent = r.text || ''
    rEl.appendChild(t)
  }
  return rEl
}

/** 提取一个 <w:p> 段落的文本（拼接所有 <w:t>，制表符→空格）。 */
function xmlParaText(pEl: Element): string {
  let s = ''
  for (const t of Array.from(pEl.getElementsByTagName('w:t'))) {
    s += t.textContent ?? ''
  }
  return s.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 与 xmlParaText 相同归一化，但作用于富段落对象（用于把改动段命中到 document.xml）。 */
function paraMatchKey(p: DocxParagraph | undefined): string {
  if (!p) return ''
  return (p.runs || []).map((r) => String(r.text || '')).join('').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * 用当前富文本打补丁到原始 docx。返回新 Blob；若无法唯一定位改动处，返回 null（调用方回退）。
 */
export async function patchDocxPreserve(
  originalBytes: ArrayBuffer,
  currentRich: DocxRichDocument | null,
  originalRich: DocxRichDocument | null,
): Promise<Blob | null> {
  if (!currentRich || !originalRich) return null

  const zip = new PizZip(originalBytes)
  const docXmlFile = zip.file('word/document.xml')
  if (!docXmlFile) return null
  const docXml = docXmlFile.asText()

  const xmlDoc = new DOMParser().parseFromString(docXml, 'text/xml')
  const body = xmlDoc.getElementsByTagName('w:body')[0]
  if (!body) return null

  // 原始 <w:p> 列表（含表格内段落/文本框内段落），按文本建立「文本 → w:p 下标」索引
  const allPs = Array.from(body.getElementsByTagName('w:p')) as Element[]
  const xmlTextToIdx = new Map<string, number[]>()
  allPs.forEach((pEl, idx) => {
    const t = xmlParaText(pEl)
    const arr = xmlTextToIdx.get(t) ?? []
    arr.push(idx)
    xmlTextToIdx.set(t, arr)
  })

  // 当前富文本 vs 原始富文本按结构索引逐段比对（编辑只改 run 文本，结构不变 → 顺序对齐）
  const curPs = flattenParagraphs(currentRich)
  const origPs = flattenParagraphs(originalRich)
  if (curPs.length !== origPs.length) return null

  // 归一化比较；收集「确实改动」的当前段的下标
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  const changedCur: number[] = []
  for (let i = 0; i < curPs.length; i++) {
    if (norm(paraText(curPs[i])) !== norm(paraText(origPs[i]))) changedCur.push(i)
  }
  if (changedCur.length === 0) return null

  // 每个改动段：原始文本必须能在 document.xml 中【唯一】命中一个 <w:p>；
  // 且不同改动段不得命中同一个 <w:p>（否则无法安全只改一处，回退整体重建）。
  const usedXmlIdx = new Set<number>()
  const xmlIdxToCurPara = new Map<number, DocxParagraph>()
  for (const i of changedCur) {
    const origText = paraMatchKey(origPs[i])
    const candidates = xmlTextToIdx.get(origText) ?? []
    if (candidates.length !== 1) return null // 重复/缺失 → 无法唯一命中，回退整体重建
    const xmlIdx = candidates[0]
    if (usedXmlIdx.has(xmlIdx)) return null // 两处改动打到同一个 w:p（分页符拆分段等）
    usedXmlIdx.add(xmlIdx)
    xmlIdxToCurPara.set(xmlIdx, curPs[i])
  }

  // 应用补丁：改写对应 <w:p> 的 run（保留其 <w:pPr> 与其余非 run 子元素）
  for (const xmlIdx of usedXmlIdx) {
    const pEl = allPs[xmlIdx]
    const targetPara = xmlIdxToCurPara.get(xmlIdx)
    if (!pEl || !targetPara) return null

    // 移除 run 相关子元素（<w:r>、超链接、修订包裹等），保留 w:pPr 及书签等
    const toRemove: Element[] = []
    for (const child of Array.from(pEl.children)) {
      const tag = child.tagName
      if (
        tag === 'w:r' ||
        tag === 'w:hyperlink' ||
        tag === 'w:ins' ||
        tag === 'w:del' ||
        tag === 'w:proofErr' ||
        tag === 'w:bookmarkStart' ||
        tag === 'w:bookmarkEnd' ||
        tag === 'w:commentRangeStart' ||
        tag === 'w:commentRangeEnd'
      ) {
        toRemove.push(child)
      }
    }
    toRemove.forEach((el) => el.remove())

    // 追加新的 run（保留原段落属性 w:pPr 不动）
    const runs = targetPara.runs && targetPara.runs.length ? targetPara.runs : []
    if (runs.length === 0) {
      pEl.appendChild(buildRunXml(xmlDoc, { text: '' }))
    } else {
      for (const r of runs) pEl.appendChild(buildRunXml(xmlDoc, r))
    }
  }

  const serializer = new XMLSerializer()
  const newDocXml = serializer.serializeToString(xmlDoc)
  zip.file('word/document.xml', newDocXml)
  const blob = await zip.generateAsync({ type: 'blob' })
  return blob
}