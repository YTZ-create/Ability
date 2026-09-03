/**
 * docxRichRenderer — DocxRichDocument ↔ HTML / docx 的纯函数转换器
 *
 * 背景：Univer 文档表格展示依赖「DOCX 树状模型 → UDM 线性控制符」的无损转换，
 * 该转换对合并单元格/索引对齐极其脆弱，历经多轮修复仍不稳定。作为替代方案，
 * 本模块直接基于已完整保真的 DocxRichDocument：
 * - 用 HTML 渲染展示（浏览器原生表格，天然稳定，支持 contenteditable 编辑）
 * - 用 docx 库原样导出（保留表格/合并/边框/列宽）
 * 数据源仍在 DocxRichDocument，Ethan 联动/编辑卡片的写入逻辑保持不变。
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  WidthType,
  TableLayoutType,
  AlignmentType,
  BorderStyle,
  VerticalMergeType,
  VerticalAlign,
  PageNumber,
  LineRuleType,
  ShadingType,
  HeightRule,
  UnderlineType,
} from 'docx'
import type {
  DocxRichDocument,
  DocxRichBlock,
  DocxTable,
  DocxCell,
  DocxParagraph,
  DocxRun,
  DocxBorder,
  DocxSection,
} from './docxParagraphs'

/** 转义 HTML 特殊字符，避免内容被当作标签解析 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ──────────────── 顺位字体回退（不改变字体：优先原字体，缺失时按相似触达系统字体） ────────────────
// 中文正文多用宋体/仿宋/楷体/黑体，用户机器可能未装部分字体。
// 命中表内存「原字体名」在最前，随后是「最接近的系统相似字体」回退，最后是通用字族。
const CJK_FONT_FALLBACK: Record<string, string> = {
  '宋体': '"SimSun"',
  'SimSun': '"宋体"',
  'NSimSun': '"新宋体"',
  '仿宋': '"FangSong"',
  '仿宋_GB2312': '"FangSong","仿宋 GB2312"',
  'FangSong': '"仿宋"',
  '楷体': '"KaiTi"',
  '楷体_GB2312': '"KaiTi","楷体 GB2312"',
  'KaiTi': '"楷体"',
  '黑体': '"SimHei"',
  'SimHei': '"黑体"',
  '微软雅黑': '"Microsoft YaHei"',
  'Microsoft YaHei': '"微软雅黑"',
  '等线': '"DengXian"',
  'DengXian': '"等线"',
  '华文宋体': '"STSong"',
  'STSong': '"华文宋体"',
  '华文仿宋': '"STFangsong"',
  '华文楷体': '"STKaiti"',
  '华文细黑': '"STXihei"',
  '华文黑体': '"STHeiti"',
  'Cambria': '"Cambria Math"',
}
// 西文字体回退（若有对应的中文字体更好，否则给通用字族）
const LATIN_FALLBACK_EXTRA: Record<string, string> = {
  'Times New Roman': 'serif',
  Arial: 'sans-serif',
  Calibri: 'sans-serif',
  Verdana: 'sans-serif',
  Tahoma: 'sans-serif',
}

/**
 * 生成 run 的 font-family 回退栈串。
 * 规则：原字体名（转义加引号）→ 命中表中的相似回退 → 汇总到通用字族（serif/sans-serif）。
 * 若无字体，返回 undefined（继承容器默认）。
 */
function fontStack(family?: string): string | undefined {
  if (!family) return undefined
  const quoted = /^[\w\s.#_-]+$/.test(family) ? `"${family}"` : `"${family}"`
  const parts: string[] = [quoted]
  const cjk = CJK_FONT_FALLBACK[family]
  if (cjk) parts.push(cjk)
  const latin = LATIN_FALLBACK_EXTRA[family] ?? (CJK_FONT_FALLBACK[family] ? 'serif' : undefined)
  // 中文/未知字体统一兜底到通用字族，保证西文与特殊字符可渲染
  if (latin) parts.push(latin)
  return parts.join(', ')
}

/** 表格/单元格边框样式名 → CSS。 */
function borderCss(style?: string): string {
  switch (style) {
    case 'double': return 'double'
    case 'dashed': return 'dashed'
    case 'dotted': return 'dotted'
    case 'none': case 'nil': return 'hidden'
    case 'single':
    default: return 'solid'
  }
}

/** twip → px（浏览器 96dpi：1px = 1/72 in；1 twip = 1/20 pt = 1/1440 in），1 twip = 96/1440 px = 1/15 px */
function twipPx(v: number): number {
  return v / 15
}

/** pt → px（96dpi：1pt = 96/72 px = 4/3 px） */
function ptPx(v: number): number {
  return (v * 96) / 72
}

/** run → 内联样式字符串（字体/字号/颜色/粗斜/下划线/删除线/上下标/底纹/空心/字符间距）。 */
function runCss(r: DocxRun): string {
  const parts: string[] = []
  const fs = fontStack(r.fontFamily)
  if (fs) parts.push(`font-family:${fs}`)
  if (r.fontSize) parts.push(`font-size:${r.fontSize / 2}pt`) // fontSize 单位=半点
  if (r.bold) parts.push('font-weight:bold')
  if (r.italic) parts.push('font-style:italic')
  if (r.color) parts.push(`color:#${r.color}`)
  if (r.highlight) parts.push(`background-color:#${r.highlight}`)
  if (r.vertAlign === 'super') parts.push('vertical-align:super;font-size:smaller')
  else if (r.vertAlign === 'sub') parts.push('vertical-align:sub;font-size:smaller')
  if (r.outline) parts.push('-webkit-text-stroke:0.5px currentColor;color:transparent')
  // 字符间距：<w:spacing w:val/> 单位 1/20 pt → letter-spacing: v/20 pt
  if (r.characterSpacing) parts.push(`letter-spacing:${(r.characterSpacing / 20).toFixed(2)}pt`)
  return parts.join(';')
}

/** 段落 → 内联样式字符串（对齐/行距/缩进/段间距/背景）。 */
function paraCss(p: DocxParagraph): string {
  const parts: string[] = []
  if (p.align === 'center') parts.push('text-align:center')
  else if (p.align === 'right') parts.push('text-align:right')
  else if (p.align === 'both') parts.push('text-align:justify')
  else if (p.align === 'left') parts.push('text-align:left')

  // 行距：D ㈠ rule → line-height
  if (p.lineSpacing) {
    const base = p.runs.find((r) => r.fontSize)?.fontSize ?? 21 // 默认 10.5pt=21半号
    const pt = base / 2
    if (p.lineSpacingRule === 'exact') {
      parts.push(`line-height:${twipPx(p.lineSpacing)}px`) // 固定行距
    } else if (p.lineSpacingRule === 'atLeast') {
      parts.push(`line-height:${Math.max(twipPx(p.lineSpacing), pt * 96 / 72 * 1.2)}px`)
    } else {
      // auto / multiple / 缺省：w:line 值（如 360=1.5 倍）
      const mult = Math.max(0.2, p.lineSpacing / 240)
      parts.push(`line-height:${mult}`)
    }
  }
  // 段前后间距（twip → px）
  if (p.spacingBefore) parts.push(`margin-top:${twipPx(p.spacingBefore)}px`)
  if (p.spacingAfter) parts.push(`margin-bottom:${twipPx(p.spacingAfter)}px`)
  // 左右缩进、首行缩进（含字符缩进按字号换算）
  if (p.indentLeft) parts.push(`margin-left:${twipPx(p.indentLeft)}px`)
  if (p.indentRight) parts.push(`margin-right:${twipPx(p.indentRight)}px`)
  if (p.indentFirstLineChars) {
    const fontPt = (p.runs.find((r) => r.fontSize)?.fontSize ?? 21) / 2
    const charPx = ptPx(fontPt)
    parts.push(`text-indent:${(charPx * p.indentFirstLineChars) / 100}px`)
  } else if (p.indentFirstLine) {
    parts.push(`text-indent:${twipPx(p.indentFirstLine)}px`)
  }
  if (p.shading) parts.push(`background:#${p.shading}`)
  // keepLines：段内不跨页 → 用 break-inside
  if (p.keepLines) parts.push('break-inside:avoid')
  if (p.keepNext) parts.push('break-after:avoid')
  return parts.join(';')
}

/** 单个 run → HTML（含样式内联）；PAGE 域输出占位 span，由分页层填当前页码。 */
function runHtml(r: DocxRun): string {
  const css = runCss(r)
  const style = css ? ` style="${css}"` : ''
  const text = r.pageNumber ? '<span class="doc-pagenum" data-page-no></span>' : esc(hydrateBreaks(r.text))
  const cls: string[] = []
  if (r.underline) cls.push('doc-undl')
  if (r.strike) cls.push('doc-strike')
  const clsAttr = cls.length ? ` class="${cls.join(' ')}"` : ''
  return `<span${clsAttr}${style}>${text}</span>`
}

/** 换行/制表符转 HTML；制表符用固定宽空格近似（Word 制表位与正文缩进相关，浏览器无制表位支持）。 */
function hydrateBreaks(s: string): string {
  return s
    .replace(/\t/g, '&emsp;')
    .replace(/\n/g, '<br>')
}

/** 段落 → HTML 内容（含 run 富文本样式）。 */
function paragraphInnerHtml(p: DocxParagraph): string {
  if (p.empty || !p.runs.length) return '<br>'
  return p.runs.map((r: DocxRun) => runHtml(r)).join('')
}

/** 段落块 HTML（含内联段落样式），供内容层/分页层使用。 */
function paragraphHtml(p: DocxParagraph, contentEditable = false): string {
  const css = paraCss(p)
  const style = css ? ` style="${css}"` : ''
  const editable = contentEditable ? ' contenteditable="true"' : ''
  return `<div${editable}${style} class="p">${paragraphInnerHtml(p)}</div>`
}

/**
 * 文档块：分页的最小单元。
 * - paragraph 块：不可拆，整块放一页
 * - table 块：可拆成若干「行组」，每个行组是一个 <table>（跨页时按行拆分）
 */
export type DocBlock =
  | { key: string; kind: 'p'; html: string; forceBreakBefore?: boolean }
  | { key: string; kind: 'table'; rowHtmls: string[]; forceBreakBefore?: boolean }

/**
 * DocxRichDocument → 块列表（供分页器测量/拆分）。
 * - 段落 → 一个块，整段作为 contenteditable div（含段落级样式）
 * - 表格 → 一个块，携带所有行的 html 字符串，分页时可按行拆到多页
 * - 显式分页符（pageBreak）→ 作用于「下一个块」的 forceBreakBefore，分页器换页
 * 每个块/单元格带稳定 data-key，编辑回读索引保持一致。
 */
export function docxRichToBlocks(rich: DocxRichDocument): DocBlock[] {
  const blocks: DocBlock[] = []
  let pKey = 0
  let tKey = 0
  // 前一个遇到 pageBreak 块 → 把下一个产生的块标记为「段前强制分页」
  let pendingBreak = false
  const push = (b: DocBlock) => {
    if (pendingBreak) {
      b.forceBreakBefore = true
      pendingBreak = false
    }
    blocks.push(b)
  }
  for (const block of rich.blocks) {
    if (block.type === 'pageBreak') {
      pendingBreak = true
      continue
    }
    if (block.type === 'paragraph') {
      push({ key: `p-${pKey++}`, kind: 'p', html: paragraphHtml(block.paragraph, true) })
      continue
    }
    if (block.type !== 'table') continue
    const table = block.table as DocxTable
    push({ key: `t-${tKey++}`, kind: 'table', rowHtmls: tableRowsToHtml(table) })
  }
  return blocks
}

/** 表格列宽占比 → 0..1 数组（保留原列宽比例；无信息则均分）。 */
function tableColRatio(table: DocxTable): number[] {
  const cw = table.columnWidths
  if (cw && cw.length === table.colCount) {
    const totalTwip = cw.reduce((a, b) => a + b, 0)
    if (totalTwip > 0) return cw.map((w) => w / totalTwip)
  }
  return Array.from({ length: table.colCount }, () => 1 / table.colCount)
}

/**
 * 行级及单元格级 HTML（含底纹/垂直对齐/边框/列宽/行高/内边距）。
 * 分页时以行字符串为单位拆分。contentEditable=false 用于页眉/页脚（只读）。
 */
function tableRowsToHtml(table: DocxTable, contentEditable = true): string[] {
  const colRatio = tableColRatio(table)
  let si = 0
  return table.rows.map((row, rIdx) => {
    let col = 0
    const cells = row
      .map((c) => {
        if (c.vMerge === 'continue' && !c.rowSpan) return ''
        // 该 td 覆盖的列宽占比之和
        let spanRatio = 0
        for (let k = 0; k < (c.colSpan || 1); k++) spanRatio += colRatio[col + k] ?? 0
        const attrs: string[] = ['class="c"', `data-i="${si}"`]
        if (c.colSpan > 1) attrs.push(`colspan="${c.colSpan}"`)
        if (c.rowSpan && c.rowSpan > 1) attrs.push(`rowspan="${c.rowSpan}"`)
        const css = cellCss(c, spanRatio > 0 ? spanRatio : colRatio[col] ?? 1)
        if (css) attrs.push(`style="${css}"`)
        si++
        col += c.colSpan || 1
        const content = c.paragraphs.map((p) => paragraphHtml(p, contentEditable)).join('\n')
        return `<td ${attrs.join(' ')}>${content}</td>`
      })
      .join('')
    let trStyle = ''
    const rh = table.rowHeights?.[rIdx]
    if (rh) trStyle = ` style="height:${twipPx(rh)}px"`
    return `<tr${trStyle}>${cells}</tr>`
  })
}

/** 单元格内联样式：底纹/垂直对齐/内边距/列宽占比/边框。 */
function cellCss(c: DocxCell, widthRatio: number): string | undefined {
  const parts: string[] = []
  if (c.shading) parts.push(`background-color:#${c.shading}`)
  if (c.vertAlign === 'top') parts.push('vertical-align:top')
  else if (c.vertAlign === 'bottom') parts.push('vertical-align:bottom')
  else parts.push('vertical-align:middle')
  if (widthRatio > 0) parts.push(`width:${(widthRatio * 100).toFixed(4)}%`)
  if (c.margins) {
    const m = c.margins
    if (m.top) parts.push(`padding-top:${twipPx(m.top)}px`)
    if (m.right) parts.push(`padding-right:${twipPx(m.right)}px`)
    if (m.bottom) parts.push(`padding-bottom:${twipPx(m.bottom)}px`)
    if (m.left) parts.push(`padding-left:${twipPx(m.left)}px`)
  }
  // 边框：仅当单元格声明了任何边框时，四边都显式写（未声明边→hidden，覆盖全局默认边框）
  const b = c.borders
  if (b?.top || b?.right || b?.bottom || b?.left) {
    const sideOf = (side?: DocxBorder): string | undefined => {
      if (!side) return 'hidden'
      return `${borderCss(side.style)} ${Math.max(1, twipPx(side.size / 8))}px #${side.color}`
    }
    parts.push(`border-top:${sideOf(b?.top)}`)
    parts.push(`border-right:${sideOf(b?.right)}`)
    parts.push(`border-bottom:${sideOf(b?.bottom)}`)
    parts.push(`border-left:${sideOf(b?.left)}`)
  }
  return parts.length ? parts.join(';') : undefined
}

/**
 * 连续整页 HTML（保留原接口，用于不启用分页时一次渲染）
 */
export function docxRichToHtml(rich: DocxRichDocument): string {
  return docxRichToBlocks(rich)
    .map((b) => (b.kind === 'p' ? b.html : `<table class="t" contenteditable="false" data-editable-cells="true"><tbody>${b.rowHtmls.join('')}</tbody></table>`))
    .join('\n')
}

/** 取段落纯文本（用于比对是否变化） */
function paragraphText(p: DocxParagraph): string {
  return (p.runs || []).map((r) => r.text || '').join('')
}

/**
 * 从可编辑 div 的 DOM 回读 run 富文本（含粗/斜/下划/删除/颜色/字号/字体/上下标/底纹）。
 * 遍历文本/换行叶子节点，向上合并 span 内联样式生成 run，保留原有格式不至于被编辑冲掉。
 */
function runsFromEditable(div: HTMLElement, defaultRun: DocxRun): DocxRun[] {
  const runs: DocxRun[] = []
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        // 忽略空文本与不可见子树（如占位符）
        if (!(node.nodeValue ?? '').length) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
      const el = node as HTMLElement
      if (el.nodeName === 'BR') return NodeFilter.FILTER_ACCEPT
      if (el.nodeName === 'SPAN' || el.nodeName === 'B' || el.nodeName === 'I' || el.nodeName === 'U' || el.nodeName === 'S')
        return NodeFilter.FILTER_ACCEPT
      return NodeFilter.FILTER_REJECT
    },
  })
  let n: Node | null = null
  while ((n = walker.nextNode())) {
    const run: DocxRun = { ...defaultRun }
    if (n.nodeType === Node.TEXT_NODE) {
      run.text = n.nodeValue ?? ''
    } else if ((n as HTMLElement).nodeName === 'BR') {
      run.text = '\n'
    } else {
      continue // span 只作为 style 载体，由下面向上收集
    }
    // 向上合并 span/b/i/u/s 的样式
    let cur = n.parentElement
    while (cur && cur !== div) {
      const cs = cur.style
      if (cs.fontFamily) run.fontFamily = parseCssFont(cur) ?? run.fontFamily
      if (cs.fontSize) {
        const px = parseFloat(cs.fontSize)
        if (!isNaN(px)) run.fontSize = Math.round((px / 96) * 72 * 2) // px→半点
      }
      if (cs.fontWeight === 'bold' || cs.fontWeight === '700' || (parseInt(cs.fontWeight, 10) || 0) >= 700)
        run.bold = true
      if (cs.fontStyle === 'italic') run.italic = true
      if (cs.textDecoration) {
        if (cs.textDecoration.includes('underline') || cur.classList.contains('doc-undl')) run.underline = 'single'
        if (cs.textDecoration.includes('line-through') || cur.classList.contains('doc-strike')) run.strike = true
      }
      if (cs.color) run.color = rgbToHex(cs.color) ?? run.color
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent')
        run.highlight = rgbToHex(cs.backgroundColor) ?? run.highlight
      if (cs.verticalAlign === 'super') run.vertAlign = 'super'
      else if (cs.verticalAlign === 'sub') run.vertAlign = 'sub'
      if (cur.classList.contains('doc-undl')) run.underline = 'single'
      if (cur.classList.contains('doc-strike')) run.strike = true
      // 字符间距：pt → 1/20 pt
      if (cs.letterSpacing) {
        const pt = parseFloat(cs.letterSpacing)
        if (!isNaN(pt)) run.characterSpacing = Math.round(pt * 20)
      }
      // 空心字：CSS 用 -webkit-text-stroke 近似
      if ((cs as any).webkitTextStroke || (cs as any).textStroke) run.outline = true
      cur = cur.parentElement
    }
    if (run.text !== '') runs.push(run)
  }
  return runs
}

/** 解析 font-family 值首段（浏览器会展开为多个字体名，取首个引用字体）。 */
function parseCssFont(el: HTMLElement): string | undefined {
  const fam = el.style.fontFamily || ''
  const m = fam.match(/"([^"]+)"|'([^']+)'|([^,"'\s]+)/)
  return m ? (m[1] || m[2] || m[3]) : undefined
}

/** rgb()/rgba() → 6 位 hex；非该格式返回空。 */
function rgbToHex(v: string): string | undefined {
  const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!m) return undefined
  return [m[1], m[2], m[3]]
    .map((x) => Math.max(0, Math.min(255, parseInt(x, 10))).toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 从编辑后的 HTML DOM 回读用户修改，写回 DocxRichDocument。
 * 更新文本内容与 run 富文本样式（粗/斜/下划/删除/颜色/字号/字体/上下标/底纹），
 * 保留结构（行列/合并/边框/列宽）。
 * 返回被修改的 block 数。
 */
export function syncHtmlBackToRich(rich: DocxRichDocument, root: HTMLElement): number {
  let changed = 0

  // 只作用在「可见」容器上（排除隐藏测量器 .measurer，避免重复匹配）；
  // body 段落是 .doc-block 直接子级、非 <td> 内部的 div.p（分页后嵌套在 .doc-page 内）。
  const scopes = Array.from(root.querySelectorAll('.docx-html:not(.measurer)')) as HTMLElement[]
  if (scopes.length === 0) scopes.push(root)
  const collect = <T extends HTMLElement>(sel: string, includeCells: boolean): T[] => {
    const out: T[] = []
    for (const s of scopes) {
      for (const el of Array.from(s.querySelectorAll(sel)) as T[]) {
        if (!includeCells && el.closest('td')) continue
        out.push(el)
      }
    }
    return out
  }

  // 1) 段落级：按出现顺序映射到 rich 中 paragraph 块
  const pBlocks = rich.blocks.filter((b) => b.type === 'paragraph')
  const paraDivs = collect<HTMLElement>('div.p[contenteditable="true"]', false)
  const maxP = Math.min(pBlocks.length, paraDivs.length)
  for (let i = 0; i < maxP; i++) {
    const div = paraDivs[i]
    const block = pBlocks[i] as DocxRichBlock & { type: 'paragraph' }
    const oldText = paragraphText(block.paragraph)
    const text = div.textContent || ''
    const runs = runsFromEditable(div, block.paragraph.runs[0] || { text: '' })
    if (text !== oldText || (block.paragraph.runs.length !== runs.length)) {
      block.paragraph.runs = runs
      block.paragraph.empty = !text
      changed++
    }
  }

  // 2) 表格单元格：按 data-i 稳定索引定位
  const ctxCells: { cell: DocxCell }[] = []
  for (const block of rich.blocks) {
    if (block.type !== 'table') continue
    for (const row of block.table.rows) {
      for (const c of row) {
        if (c.vMerge === 'continue' && !c.rowSpan) continue
        ctxCells.push({ cell: c })
      }
    }
  }
  const tdEls = collect<HTMLElement>('table td.c[data-i]', true)
  for (const td of tdEls) {
    const i = Number(td.dataset.i)
    if (!(i >= 0) || i >= ctxCells.length) continue
    const cell = ctxCells[i].cell
    const div = td.querySelector(':scope > div.p') as HTMLElement | null
    const oldParagraph = cell.paragraphs[0] || { runs: [], empty: true }
    const text = (div ? div.textContent : td.textContent) || ''
    let changedCell = false
    if (div) {
      const runs = runsFromEditable(div, oldParagraph.runs[0] || { text: '' })
      if (text !== paragraphText(oldParagraph) || (oldParagraph.runs.length !== runs.length)) {
        cell.paragraphs = [{ runs, empty: !text }]
        changedCell = true
      }
    } else if (text !== paragraphText(oldParagraph)) {
      cell.paragraphs = text
        ? [{ runs: [{ text }], empty: false }]
        : [{ runs: [], empty: true }]
      changedCell = true
    }
    if (changedCell) changed++
  }

  return changed
}

// ──────────────── 分节：页面几何 / 页眉页脚 / 分栏 ────────────────

/** 由分节（缺省按 A4）计算页面逻辑尺寸，返回 px（96dpi）。 */
export function docxPagePx(rich: DocxRichDocument): {
  widthPx: number
  heightPx: number
  marginTopPx: number
  marginRightPx: number
  marginBottomPx: number
  marginLeftPx: number
  columns: number
  columnSpacingPx: number
  contentWidthPx: number
  contentHeightPx: number
} {
  const s: DocxSection = rich.section || {
    pageWidth: 595.3,
    pageHeight: 841.9,
    marginTop: 72,
    marginRight: 72,
    marginBottom: 72,
    marginLeft: 72,
    columns: 1,
    columnSpacing: 0,
  }
  const widthPx = ptPx(s.pageWidth)
  const heightPx = ptPx(s.pageHeight)
  const marginTopPx = ptPx(s.marginTop)
  const marginRightPx = ptPx(s.marginRight)
  const marginBottomPx = ptPx(s.marginBottom)
  const marginLeftPx = ptPx(s.marginLeft)
  const contentWidthPx = Math.max(40, widthPx - marginLeftPx - marginRightPx)
  const contentHeightPx = Math.max(80, heightPx - marginTopPx - marginBottomPx)
  return {
    widthPx,
    heightPx,
    marginTopPx,
    marginRightPx,
    marginBottomPx,
    marginLeftPx,
    columns: s.columns || 1,
    columnSpacingPx: twipPx(s.columnSpacing || 0),
    contentWidthPx,
    contentHeightPx,
  }
}

/** 页眉/页脚内容 HTML（只读，不含分页包裹）；无内容返回空串。 */
export function sectionZoneHtml(rich: DocxRichDocument, zone: 'header' | 'footer'): string {
  const blocks = zone === 'header' ? rich.section?.headerBlocks : rich.section?.footerBlocks
  if (!blocks || !blocks.length) return ''
  return blocks
    .map((b) => {
      if (b.type === 'paragraph') return paragraphHtml(b.paragraph, false)
      if (b.type === 'table') return `<table class="t hdr" contenteditable="false"><tbody>${tableRowsToHtml(b.table, false).join('')}</tbody></table>`
      return ''
    })
    .join('\n')
}

/**
 * 兜底页眉 HTML：原文档没声明页眉时使用文档名居中显示。
 * 与 WPS「附件1：xxx.docx」页眉的视觉行为一致——保证总能看到一个页眉条。
 */
export function buildFallbackHeaderHtml(docName: string): string {
  const escName = docName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return `<div class="p" style="text-align:center;font-size:9pt;color:#666;border-bottom:1px solid #d0d0d0;padding-bottom:2px;">${escName}</div>`
}

/** 把 zone HTML 里的页码占位（<span class="doc-pagenum" data-page-no></span>）替换为当前页号。 */
export function zonePageHtml(zoneHtml: string, pageNo: number): string {
  return zoneHtml.replace(
    /<span class="doc-pagenum" data-page-no><\/span>/g,
    `<span class="doc-pagenum">${pageNo}</span>`
  )
}

// ──────────────── docx 原样导出 ────────────────

/** 对齐转 docx AlignmentType */
function docxAlign(a?: string) {
  if (a === 'center') return AlignmentType.CENTER
  if (a === 'right') return AlignmentType.RIGHT
  if (a === 'both') return AlignmentType.BOTH
  return AlignmentType.LEFT
}

/** 边框样式字符串 → docx BorderStyle */
function docxBorderStyle(style?: string): BorderStyle {
  switch (style) {
    case 'double': return BorderStyle.DOUBLE
    case 'dashed': return BorderStyle.DASHED
    case 'dotted': return BorderStyle.DOTTED
    case 'none': return BorderStyle.NIL
    case 'single':
    default: return BorderStyle.SINGLE
  }
}

/** 表格/单元格单边边框 → docx 表示；无边框返回 nil */
function docxSide(side?: { style?: string; size?: number; color?: string }): { style: BorderStyle; size: number; color: string } {
  const style = docxBorderStyle(side?.style)
  return {
    style,
    size: side?.size ? Math.max(1, Math.round(side.size / 8)) : 0,
    color: side?.color || '000000',
  }
}

/** 下划线类型字符串 → docx UnderlineType；未知/自动 → SINGLE。 */
function docxUnderlineType(v?: string) {
  switch (v) {
    case 'double': return UnderlineType.DOUBLE
    case 'thick': return UnderlineType.THICK
    case 'dotted': return UnderlineType.DOTTED
    case 'dash': case 'dashSmallGap': case 'dashDotGap': return UnderlineType.DASH
    case 'wave': return UnderlineType.WAVE
    case 'single':
    default: return UnderlineType.SINGLE
  }
}

/** run → docx TextRun（保留字体/字号/颜色/粗斜/下划/删除线/上下标/底纹；PAGE 域 → 页码域）。 */
function runToTextRun(r: DocxRun, fallbackFont?: string): TextRun {
  const opt: any = { text: r.text || '' }
  if (r.pageNumber) opt.children = [PageNumber.CURRENT]
  if (r.bold) opt.bold = true
  if (r.italic) opt.italics = true
  if (r.strike) opt.strike = true
  // 下划线用单独 createUnderline 语义：仅当显式下划线类型时附颜色（Word 缺省黑色）
  if (r.underline) opt.underline = { type: docxUnderlineType(r.underline), color: r.color ?? '000000' }
  if (r.color) opt.color = r.color
  if (r.fontSize) opt.size = r.fontSize
  const font = r.fontFamily ?? fallbackFont
  if (font) opt.font = font
  if (r.vertAlign === 'super') opt.superScript = true
  else if (r.vertAlign === 'sub') opt.subScript = true
  // 文字底纹：docx highlight 只吃有限调色板，任意色用 shading(clear fill) 保真
  if (r.highlight) opt.shading = { type: ShadingType.CLEAR, fill: r.highlight }
  // 字符间距（<w:spacing w:val/>，单位 1/20 pt）
  if (r.characterSpacing) opt.characterSpacing = r.characterSpacing
  return new TextRun(opt)
}

/** 段落 → docx Paragraph（保留对齐/行距/段间距/缩进/背景/分页控制/run 富文本）。 */
function paraToDocx(p: DocxParagraph, fallbackFont?: string): Paragraph {
  const template = p.runs.find((r) => r.text && r.text.length > 0) || p.runs[0]
  const children = (p.runs.length ? p.runs : [{ text: '' } as DocxRun]).map((r) =>
    runToTextRun(r, template?.fontFamily ?? fallbackFont)
  )
  const opt: any = { children, alignment: docxAlign(p.align) }

  const spacing: any = {}
  if (p.spacingBefore) spacing.before = p.spacingBefore
  if (p.spacingAfter) spacing.after = p.spacingAfter
  if (p.lineSpacing) {
    spacing.line = Math.max(240, p.lineSpacing) // Word 最小 240（=单倍行距）
    if (p.lineSpacingRule === 'exact') spacing.lineRule = LineRuleType.EXACTLY
    else if (p.lineSpacingRule === 'atLeast') spacing.lineRule = LineRuleType.AT_LEAST
    else if (p.lineSpacingRule === 'auto') spacing.lineRule = LineRuleType.AUTO
  }
  if (Object.keys(spacing).length) opt.spacing = spacing

  const indent: any = {}
  if (p.indentLeft) indent.left = p.indentLeft
  if (p.indentRight) indent.right = p.indentRight
  // 首行缩进优先用「字符」表达（docx 原生支持 firstLineChars），可无损还原 Word 的 l 字符缩进
  if (p.indentFirstLineChars) indent.firstLineChars = p.indentFirstLineChars
  else if (p.indentFirstLine) {
    if (p.indentFirstLine > 0) indent.firstLine = p.indentFirstLine
    else indent.hanging = -p.indentFirstLine
  }
  if (Object.keys(indent).length) opt.indent = indent

  if (p.shading) opt.shading = { type: ShadingType.CLEAR, fill: p.shading }
  if (p.keepNext) opt.keepNext = true
  if (p.keepLines) opt.keepLines = true
  if (p.pageBreakBefore) opt.pageBreakBefore = true
  return new Paragraph(opt)
}

/** cell → docx TableCell（原生支持 columnSpan/rowSpan/verticalMerge/borders/width） */
function cellToDocxCell(cell: DocxCell): TableCell {
  const children = cell.paragraphs.length
      ? cell.paragraphs.map((p) => {
          const template = p.runs.find((r) => r.text && r.text.length > 0) || p.runs[0]
          return paraToDocx(p, template?.fontFamily)
        })
      : [new Paragraph({ children: [new TextRun('')] })]

  const opts: any = {
    children,
    verticalAlign: VerticalAlign.CENTER,
  }
  // 单元格宽度：cell.width 单位 = twip = DXA（来自 <w:tcW w:w>），与 tblGrid 的 gridCol 一一对应，
  // 必须 1:1 直写。此前误除以 20 会把单元格宽压成原 1/20，WPS 会遵守 tcW 以至整表挤成细条。
  if (cell.width && cell.width > 0) opts.width = { size: Math.max(50, Math.round(cell.width)), type: WidthType.DXA }
  // 横向合并
  if (cell.colSpan > 1) opts.columnSpan = cell.colSpan
  // 纵向合并：
  // - restart 且 rowSpan>1：导出 RESTART，由下方 continue 格承接语义
  // - continue：导出 CONTINUE（被上方 restart 覆盖，无内容）
  // - continue 且 rowSpan>0（个别解析产物）：矛盾数据，忽略 rowSpan，仅设 CONTINUE
  if (cell.vMerge === 'restart' && cell.rowSpan && cell.rowSpan > 1) {
    opts.rowSpan = cell.rowSpan
    opts.verticalMerge = VerticalMergeType.RESTART
  } else if (cell.vMerge === 'restart') {
    opts.verticalMerge = VerticalMergeType.RESTART
  } else if (cell.vMerge === 'continue') {
    opts.verticalMerge = VerticalMergeType.CONTINUE
  }
  // 边框（存在边框才设置，避免覆盖表格默认边框）
  const b = cell.borders
  if (b?.top || b?.right || b?.bottom || b?.left) {
    opts.borders = {
      top: docxSide(b?.top),
      bottom: docxSide(b?.bottom),
      left: docxSide(b?.left),
      right: docxSide(b?.right),
    }
  }
  // 单元格内边距（<w:tcMar>，twip 直写）
  if (cell.margins) {
    opts.margins = {
      marginUnitType: WidthType.DXA,
      top: cell.margins.top,
      right: cell.margins.right,
      bottom: cell.margins.bottom,
      left: cell.margins.left,
    }
  }
  return new TableCell(opts)
}

/**
 * 页眉/页脚块序列 → docx Paragraph[]/Table[]（供 Header/Footer 使用）。
 * 保留段落级与 run 级样式；表格按行/合并/边框原样还原。
 */
function zoneBlocksToDocx(blocks?: DocxRichBlock[]): (Paragraph | Table)[] {
  if (!blocks || !blocks.length) return []
  const out: (Paragraph | Table)[] = []
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      out.push(paraToDocx(b.paragraph))
      continue
    }
    if (b.type === 'table') {
      out.push(tableToDocx(b.table))
    }
  }
  return out
}

/** DocxTable → docx Table（对齐/列宽/行高/合并/边框/单元格边距一并还原）。 */
function tableToDocx(table: DocxTable): Table {
  const docxRows: TableRow[] = []
  const rowHeights = table.rowHeights
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i]
    const cells: TableCell[] = []
    for (const c of row) {
      // 被纵向合并覆盖的 continue 占位格：在 docx 中用 CONTINUE 合并（内容为空）
      cells.push(cellToDocxCell(c))
    }
    const rowOpts: any = { children: cells }
    const rh = rowHeights?.[i]
    if (rh && rh > 0) rowOpts.height = { value: rh, rule: HeightRule.EXACT }
    docxRows.push(new TableRow(rowOpts))
  }

  // FIX: 必须给 Table 传 columns 数组，否则 docx 在 FIXED 布局下会用默认/平均列宽，
  // 导致原文档列宽信息丢失，整张表列宽错乱、内容挤压。
  // 关键：列宽单位是 DXA（= twip），与 DocxTable.columnWidths（twip）1:1。
  // 同时把 Table 整体宽度也改为按列宽求和的绝对 DXA 而非 PERCENTAGE，避免因
  // A4 内容区与原 docx 页面宽度差异而让列宽被错误缩放。
  // 防御性：columnWidths 数组长度与 colCount 一致才用，否则回退百分比（避免错位）。
  const cw = table.columnWidths
  const cwValid = Array.isArray(cw) && cw.length > 0 && cw.length === table.colCount && cw.every((w) => w > 0)
  const cols = cwValid
    ? cw!.map((w) => ({ width: Math.max(50, Math.round(w)), type: WidthType.DXA }))
    : undefined
  const totalW = cols ? cols.reduce((a, c) => a + (c.width as number), 0) : 0
  const tableOpts: any = { rows: docxRows, layout: TableLayoutType.FIXED }
  if (cols && totalW > 0) {
    tableOpts.columns = cols
    tableOpts.width = { size: totalW, type: WidthType.DXA }
  } else {
    // 无列宽信息时退回百分比，让 docx 自动按内容分配
    tableOpts.width = { size: 100, type: WidthType.PERCENTAGE }
  }
  // 表格水平对齐（<w:tblPr><w:jc>）还原
  if (table.align === 'center') tableOpts.alignment = AlignmentType.CENTER
  else if (table.align === 'right') tableOpts.alignment = AlignmentType.RIGHT
  else tableOpts.alignment = AlignmentType.LEFT
  return new Table(tableOpts)
}

/**
 * DocxRichDocument → .docx Blob（原样导出：块序列 + 分节几何/页眉页脚/分栏 +
 * 表格合并/边框/列宽/行高/单元格边距 + 段落/run 全部样式）。
 */
export async function docxRichToBlob(rich: DocxRichDocument): Promise<Blob> {
  const children: any[] = []

  for (const block of rich.blocks) {
    if (block.type === 'pageBreak') {
      // 原文档里的显式分页符（<w:br w:type="page"/>）转成 docx 库 pageBreakBefore
      children.push(new Paragraph({ children: [new TextRun({ text: '' })], pageBreakBefore: true }))
      continue
    }
    if (block.type === 'paragraph') {
      children.push(paraToDocx(block.paragraph))
      continue
    }
    if (block.type === 'table') {
      children.push(tableToDocx(block.table))
    }
  }

  const section = rich.section
  // 分节：页眉/页脚 + 页面几何（尺寸/边距/分栏）。仅当真有内容块时才挂页眉/页脚引用。
  const hdrChildren = section?.headerBlocks?.length ? zoneBlocksToDocx(section.headerBlocks) : []
  const ftrChildren = section?.footerBlocks?.length ? zoneBlocksToDocx(section.footerBlocks) : []
  const secHeaders = hdrChildren.length ? { default: new Header({ children: hdrChildren }) } : undefined
  const secFooters = ftrChildren.length ? { default: new Footer({ children: ftrChildren }) } : undefined

  const properties: any = {}
  if (section) {
    const size: any = {}
    if (section.pageWidth) size.width = Math.round(section.pageWidth * 20) // pt → twip(=DXA)
    if (section.pageHeight) size.height = Math.round(section.pageHeight * 20)
    properties.page = { size, margin: {} }
    // 边距 pt → twip
    const margin: any = {}
    if (section.marginTop != null) margin.top = Math.round(section.marginTop * 20)
    if (section.marginRight != null) margin.right = Math.round(section.marginRight * 20)
    if (section.marginBottom != null) margin.bottom = Math.round(section.marginBottom * 20)
    if (section.marginLeft != null) margin.left = Math.round(section.marginLeft * 20)
    properties.page.margin = margin
    // 分栏（count/space）
    if (section.columns && section.columns > 1) {
      properties.column = { count: section.columns }
      if (section.columnSpacing) properties.column.space = section.columnSpacing
    }
  }

  const doc = new Document({ sections: [{ children, ...(secHeaders ? { headers: secHeaders } : {}), ...(secFooters ? { footers: secFooters } : {}), ...(Object.keys(properties).length ? { properties } : {}) }] })
  // 用 toBlob 而非 toBuffer：toBuffer 依赖 Node.js Buffer，WebView 环境无全局 Buffer，
  // 会抛 "Buffer is not defined" 导致导出无反应。toBlob 返回原生 Blob，浏览器友好。
  return Packer.toBlob(doc)
}