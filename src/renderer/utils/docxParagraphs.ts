/**
 * docxParagraphs — docx/文本文件结构化解析（从 OfficePanel 抽出的公共工具）
 *
 * 原 OfficePanel 内部函数，Ethan 抽屉同步（formDrawerSyncService）需要复用同一套
 * 解析逻辑，故抽取为独立工具；OfficePanel 改为从此处 import，行为不变。
 *
 * v3.2.0 增强：完整结构化解析（DocxRichDocument）——
 * - 保留顶层 <w:p> / <w:tbl> 的文档顺序
 * - 表格保留：行/列结构、单元格内容、gridSpan（横向合并）、vMerge（纵向合并）
 * - 单元格边框：解析 <w:tcBorders>，按边转 Univer 的 borderXxx 字段
 * - 单元格边距：解析 <w:tcMar>，映射到 Univer cell.margin
 * - 表格列宽：解析 <w:gridCol w:w="...">，按比例分给 Univer tableColumns
 * - 段落样式：粗体（<w:b/>）、字号（<w:sz w:val="...">）、对齐（<w:jc>）
 *
 * 旧版「纯段落」API（parseDocxParagraphs / parseDocxParagraphsFromBase64）保留，
 * Ethan 表单填写、文本类文件导入继续走它（模型就是段落数组，无需表结构）。
 * 办公抽屉的 .docx 导入走新版「富结构」API（parseDocxRichDocument），
 * 由 officeService 构造含 tableSource 的 Univer UDM，保留表格/合并/边框。
 */

import PizZip from 'pizzip'

// ──────────────── 旧版：纯段落 API（保持兼容）────────────

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

// ──────────────── 新版：富结构 API（办公抽屉 docx 导入用）────────────

/**
 * 段落/单元格内一个文本片段（含样式）。
 * v3.2.1 扩展：run 级样式补全（斜体/下划线/删除线/颜色/文字底纹/上下标），
 * 供「像 Word 完全不变排版」的 HTML 渲染与 docx 导出使用。
 * 所有字段为可选，缺省即继承上级/默认值，保证旧数据与纯文本兼容。
 */
export interface DocxRun {
  text: string
  bold?: boolean
  /** 斜体（<w:i/>、<w:iCs/>） */
  italic?: boolean
  /** 下划线类型（<w:u w:val="..."/>）：single/double/thick/dotted/dash/words...；有值即下划线 */
  underline?: string
  /** 删除线（<w:strike/> 或 <w:dstrike/>） */
  strike?: boolean
  /** 文字颜色 hex（<w:color w:val/>，65535=自动），缺省黑色 */
  color?: string
  /** 文字底纹/高亮 hex（<w:shd> 在 rPr 内），缺省透明 */
  highlight?: string
  /** 上/下标（<w:vertAlign w:val/>）：'super' | 'sub' */
  vertAlign?: 'super' | 'sub'
  /** PAGE 域（页眉/页脚的 <w:instrText> 含 PAGE 时设为 true），渲染为当前页页码 */
  pageNumber?: boolean
  fontSize?: number // 单位：半点（pt = v/2；DOCX 本身也是半点）
  fontFamily?: string // 优先中文字体（eastAsia），其次西文（ascii）
  /** 空心字（<w:outline/>）：仅描边、不填充 */
  outline?: boolean
  /** 字符间距（<w:spacing w:val/>，单位 1/20 pt）。正值加宽字间距。 */
  characterSpacing?: number
}

export interface DocxCell {
  /** 单元格内的段落（多段落=多行） */
  paragraphs: DocxParagraph[]
  /** 横向合并：跨越的列数（DOCX <w:gridSpan>，默认 1） */
  colSpan: number
  /** 纵向合并：DOCX <w:vMerge>，'restart' 起一个新合并列、'continue' 被上方吞掉 */
  vMerge: 'restart' | 'continue'
  /** 纵向合并跨越的行数（仅 vMerge='restart' 时有效，由 parseWTable 后处理计算） */
  rowSpan?: number
  /** 单元格边框（仅记录存在边框的边，缺省视为无边框） */
  borders?: { top?: DocxBorder; right?: DocxBorder; bottom?: DocxBorder; left?: DocxBorder }
  /** 单元格内边距（DOCX <w:tcMar>，单位 twip = 1/20 pt = 1/1440 in） */
  margins?: { top?: number; right?: number; bottom?: number; left?: number }
  /** 单元格内容宽度（DOCX <w:tcW>，单位 twip） */
  width?: number
  /** 单元格底纹背景色 hex（<w:tcPr><w:shd w:fill/>），缺省无底纹 */
  shading?: string
  /** 单元格内文字垂直对齐：top / center / bottom（<w:vAlign/>），缺省由样式决定 */
  vertAlign?: 'top' | 'center' | 'bottom'
}

/** 行距规则（DOCX <w:spacing w:lineRule/>） */
export type LineSpacingRule = 'auto' | 'atLeast' | 'exact' | 'multiple'

export interface DocxParagraph {
  /** 段落内文本片段（按顺序） */
  runs: DocxRun[]
  /** 对齐：left / center / right / both（两端对齐） */
  align?: 'left' | 'center' | 'right' | 'both'
  /** 段落是否为空（保留空段用于结构占位） */
  empty?: boolean
  /**
   * 行距（<w:spacing w:line/>）。单位为 twip（1/20pt）。
   * - lineRule=auto / 默认：按字体计算的 240 分之一倍数（如 360 = 1.5 倍行距）
   * - lineRule=multiple：word 存的倍率×240（如 1.5 倍存 360）
   * - lineRule=exact / atLeast：固定/最小间距 twip
   * 缺省不设 → 继承浏览器/Word 默认单倍行距。
   */
  lineSpacing?: number
  lineSpacingRule?: LineSpacingRule
  /** 段前间距（twip，1/20pt） */
  spacingBefore?: number
  /** 段后间距（twip，1/20pt） */
  spacingAfter?: number
  /** 左缩进（twip） */
  indentLeft?: number
  /** 右缩进（twip） */
  indentRight?: number
  /** 首行缩进（twip，正值缩进；负值=悬挂缩进） */
  indentFirstLine?: number
  /**
   * 首行缩进·字符数（<w:firstLineChars/>，单位 1/100 字符，如 200=2 字符）。
   * 中文正文常按「字符」缩进，应按当前字号逐字换算；优先于 indentFirstLine。
   * 正值缩进；负值=悬挂（hangingChars）。
   */
  indentFirstLineChars?: number
  /** 与下段同页（<w:keepNext/>） */
  keepNext?: boolean
  /** 段内不跨页（<w:keepLines/>） */
  keepLines?: boolean
  /** 段前分页（<w:pageBreakBefore/>） */
  pageBreakBefore?: boolean
  /** 段落底纹背景色 hex（<w:pPr><w:shd/>），缺省透明 */
  shading?: string
}

export interface DocxBorder {
  /** 边框样式：single / double / dashed / dotted / none */
  style: string
  /** 边框粗细（DOCX 1/8 pt 单位，4 = 0.5pt；保留原值供 Univer 直接换算） */
  size: number
  /** 颜色（hex，如 '000000'） */
  color: string
}

export interface DocxTable {
  /** 表格的二维单元格网格（含被合并吞掉的占位 cell） */
  rows: DocxCell[][]
  /** 总列数（含被合并的列） */
  colCount: number
  /** 表格列宽（twip，按列顺序；与 colCount 同长） */
  columnWidths?: number[]
  /** 表格水平对齐（<w:tblPr><w:jc/>）：left / center / right，缺省继承/左对齐 */
  align?: 'left' | 'center' | 'right'
  /** 每行高度（twip，<w:trPr><w:trHeight/>，可选值；与 rows 一一对应） */
  rowHeights?: (number | undefined)[]
}

export type DocxRichBlock = DocxRichParagraphBlock | DocxRichTableBlock | DocxRichPageBreakBlock

export interface DocxRichParagraphBlock {
  type: 'paragraph'
  paragraph: DocxParagraph
}

export interface DocxRichTableBlock {
  type: 'table'
  table: DocxTable
}

/** 显式分页符：来自段落里的 <w:br w:type="page"/>，用于保留原文档的换页位置。 */
export interface DocxRichPageBreakBlock {
  type: 'pageBreak'
}

/**
 * 页面级分栏：来自 <w:body><w:sectPr>（每个分节可独立设置）。
 * 分栏只作用于连续正文流；分页模式下按 .doc-page 容器内 CSS 多列近似还原。
 */
export interface DocxSection {
  /** 页面宽（pt，来自 <w:pgSz w:w/>，65535=缺省 A4），缺省 A4 595.3pt */
  pageWidth: number
  /** 页面高（pt，来自 <w:pgSz w:h/>），缺省 A4 841.9pt */
  pageHeight: number
  /** 四边页边距（pt，来自 <w:pgMar/>） */
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  /** 分栏数（<w:cols w:num/>，缺省 1） */
  columns: number
  /** 栏间距（twip，<w:cols w:space/>） */
  columnSpacing: number
  /** 页眉内容块（解析 headerN.xml 所得；PAGE 域表现为 run.pageNumber） */
  headerBlocks?: DocxRichBlock[]
  /** 页脚内容块（解析 footerN.xml 所得；PAGE 域表现为 run.pageNumber） */
  footerBlocks?: DocxRichBlock[]
}

/**
 * 完整富结构文档：body 块序列 + 表格数据 + 分节（页面几何/页眉页脚/分栏）。
 * 办公抽屉的 docx 导入走这个模型，officeService 把它构建为 Univer UDM，
 * 或由 docxRichRenderer 渲染为「像 Word 的 HTML 分页」。
 */
export interface DocxRichDocument {
  blocks: DocxRichBlock[]
  /** 最后一个 <w:sectPr>（正文分节）的页面几何/页眉页脚/分栏；缺省按 A4 兜底 */
  section?: DocxSection
  /** 文档名（来自导入时的 fileName），供渲染层做兜底页眉。运行时挂载，不参与 docx 序列化。 */
  name?: string
}

/**
 * 解析 .docx 为富结构文档（办公抽屉 docx 导入用）。
 * 纯文本类文件返回仅含 paragraph 块的结构（OfficePanel 按行回退为文本）。
 */
export async function parseDocxRichDocument(
  fileName: string,
  buffer: ArrayBuffer
): Promise<DocxRichDocument> {
  if (!/\.docx$/i.test(fileName)) {
    const text = new TextDecoder().decode(buffer)
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    return {
      blocks: lines.map((line) => ({
        type: 'paragraph' as const,
        paragraph: { runs: line ? [{ text: line }] : [], empty: !line },
      })),
    }
  }

  const zip = new PizZip(buffer)
  const docXml = zip.file('word/document.xml')?.asText()
  if (!docXml) return { blocks: [] }

  const xmlDoc = new DOMParser().parseFromString(docXml, 'text/xml')
  const body = xmlDoc.getElementsByTagName('w:body')[0]
  if (!body) return { blocks: [] }

  const blocks: DocxRichBlock[] = []
  for (const child of Array.from(body.children)) {
    const tag = child.tagName
    if (tag === 'w:p') {
      // 拆分段落里所有的 <w:br w:type="page"/> 分页符：
      // 每个分页符前的内容作为一个段落，分页符转为 pageBreak 块，
      // 分页符后的内容作为下一个段落；最后一个分页符后的内容也作为一个段落。
      // 这样可避免"原段落里分页符"和"pageBreakBefore 块"重复分页。
      const segments = splitParagraphAtPageBreaks(child)
      for (const seg of segments) {
        if (seg.type === 'paragraph' && seg.paragraph) {
          blocks.push({ type: 'paragraph', paragraph: seg.paragraph })
        } else if (seg.type === 'pageBreak') {
          blocks.push({ type: 'pageBreak' })
        }
      }
    } else if (tag === 'w:tbl') {
      blocks.push({ type: 'table', table: parseWTable(child) })
    }
  }

  // 分节：页面几何 / 页眉页脚 / 分栏（最后一个 <w:sectPr>；多数文档只有一个分节）
  const section = parseWSection(body, zip)

  return { blocks, section }
}

/**
 * 解析正文分节 <w:sectPr> 的页面几何与页眉/页脚引用。
 * - 页面大小 <w:pgSz>、页边距 <w:pgMar>、分栏 <w:cols>
 * - 页眉/页脚引用 <w:headerReference>/<w:footerReference w:r:id> → 通过
 *   word/_rels/document.xml.rels 解析出 headerN.xml / footerN.xml，再解析其内容块。
 * 解析失败或缺失时按 A4 默认兜底（避免影响正文渲染）。
 */
function parseWSection(body: Element, zip: PizZip): DocxSection | undefined {
  // 正文分节的 <w:sectPr>：w:body 的最后一个直接子元素（或其内嵌套）。取 body 直属最后一个 sectPr。
  let sectPr: Element | undefined
  for (const c of Array.from(body.children)) {
    if (c.tagName === 'w:sectPr') sectPr = c
  }
  const section: DocxSection = {
    pageWidth: 595.3,
    pageHeight: 841.9,
    marginTop: 72,
    marginRight: 72,
    marginBottom: 72,
    marginLeft: 72,
    columns: 1,
    columnSpacing: 0,
  }

  const pgSz = sectPr?.getElementsByTagName('w:pgSz')[0]
  if (pgSz) {
    const w = parseInt(pgSz.getAttribute('w:w') ?? '0', 10)
    const h = parseInt(pgSz.getAttribute('w:h') ?? '0', 10)
    // 65535 表示未显式指定尺寸（A4 缺省）
    if (w && w !== 65535) section.pageWidth = twipToPt(w)
    if (h && h !== 65535) section.pageHeight = twipToPt(h)
  }

  const pgMar = sectPr?.getElementsByTagName('w:pgMar')[0]
  if (pgMar) {
    section.marginTop = twipToPt(parseInt(pgMar.getAttribute('w:top') ?? '0', 10) || 0)
    section.marginRight = twipToPt(parseInt(pgMar.getAttribute('w:right') ?? '0', 10) || 0)
    section.marginBottom = twipToPt(parseInt(pgMar.getAttribute('w:bottom') ?? '0', 10) || 0)
    section.marginLeft = twipToPt(parseInt(pgMar.getAttribute('w:left') ?? '0', 10) || 0)
  }

  const cols = sectPr?.getElementsByTagName('w:cols')[0]
  if (cols) {
    const num = parseInt(cols.getAttribute('w:num') ?? '0', 10)
    if (num > 0) section.columns = num
    const space = parseInt(cols.getAttribute('w:space') ?? '0', 10)
    if (space > 0) section.columnSpacing = space
  }

  // 页眉/页脚引用 → 解析 XML → 内容块
  if (sectPr) {
    const rels = parseDocumentRels(zip)
    const headerRef = sectPr.getElementsByTagName('w:headerReference')[0]
    const footerRef = sectPr.getElementsByTagName('w:footerReference')[0]
    if (headerRef) {
      const headerXml = loadHeaderFooterByRel(zip, rels, headerRef.getAttribute('r:id'))
      if (headerXml) {
        const hb = parseHeaderFooterXml(headerXml)
        if (hb.length) section.headerBlocks = hb
      }
    }
    if (footerRef) {
      const footerXml = loadHeaderFooterByRel(zip, rels, footerRef.getAttribute('r:id'))
      if (footerXml) {
        const fb = parseHeaderFooterXml(footerXml)
        if (fb.length) section.footerBlocks = fb
      }
    }
  }

  // 没有 <w:sectPr> 或 geometry 全默认 → 仍返回（方便渲染方走 A4 逻辑），统一返回对象
  return section
}

/** 解析 word/_rels/document.xml.rels：r:id → target 文件路径（如 header1.xml） */
function parseDocumentRels(zip: PizZip): Map<string, string> {
  const map = new Map<string, string>()
  const relsXml = zip.file('word/_rels/document.xml.rels')?.asText()
  if (!relsXml) return map
  try {
    const xmlDoc = new DOMParser().parseFromString(relsXml, 'text/xml')
    for (const rel of Array.from(xmlDoc.getElementsByTagName('Relationship'))) {
      const id = rel.getAttribute('Id')
      const target = rel.getAttribute('Target')
      if (id && target) map.set(id, target.replace(/^\//, ''))
    }
  } catch {
    /* 忽略 rels 解析失败 */
  }
  return map
}

/** 根据 r:id 从 zip 中读取 header/footer xml 文本（找不到返回空串） */
function loadHeaderFooterByRel(
  zip: PizZip,
  rels: Map<string, string>,
  rId: string | null | undefined
): string | null {
  if (!rId) return null
  const target = rels.get(rId)
  if (!target) return null
  const path = target.startsWith('word/') ? target : `word/${target}`
  const xml = zip.file(path)?.asText()
  if (!xml) return null
  // 确保根元素是 header/footer（防御 target 指向其他资源）
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    const root = doc.documentElement
    if (root && (root.tagName === 'w:hdr' || root.tagName === 'w:ftr')) return xml
  } catch {
    return null
  }
  return null
}

/**
 * 解析页眉/页脚 XML 为块序列（与正文类似：段落/表格/分页符）。
 * PAGE 域（<w:instrText> 含 PAGE）会落成一个 run.pageNumber=true 的文本 run，
 * 供渲染层替换为「当前页页码」。
 */
function parseHeaderFooterXml(xml: string): DocxRichBlock[] {
  try {
    const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml')
    const root = xmlDoc.documentElement
    if (!root) return []
    const blocks: DocxRichBlock[] = []
    for (const child of Array.from(root.children)) {
      if (child.tagName === 'w:p') {
        // 直接整体解析（页眉基本不含分页符）
        const p = parseWParagraphWithFields(child)
        blocks.push({ type: 'paragraph', paragraph: p })
      } else if (child.tagName === 'w:tbl') {
        blocks.push({ type: 'table', table: parseWTable(child) })
      }
    }
    return blocks
  } catch {
    return []
  }
}

/** 页眉/页脚专用段落解析：识别 <w:instrText> 含 PAGE 的域，生成 run.pageNumber。 */
function parseWParagraphWithFields(p: Element): DocxParagraph {
  const parsed = parseWParagraph(p)
  // 若段落内不含域字段，直接返回
  if (!p.innerHTML.includes('<w:fldChar') && !p.innerHTML.includes('instrText')) return parsed
  // 把 PAGE 域转成 pageNumber run：重建 runs，普通文本保留，域位置插入 {text:'#', pageNumber:true}
  const runs: DocxRun[] = []
  // 简单策略：扫描 p 的直接 w:r 子元素，遇到含 instrText=》PAGE 的 r 输出 pageNumber run
  for (const child of Array.from(p.children)) {
    if (child.tagName !== 'w:r') continue
    const rPr = child.getElementsByTagName('w:rPr')[0]
    const run = parseWRun(child)
    const instr = child.getElementsByTagName('w:instrText')[0]
    const isPageField = !!instr && /PAGE/i.test(instr.textContent ?? '')
    if (isPageField) {
      const base = run ?? { text: '#' }
      // 继承该 run 的样式，标记为页码
      runs.push({ ...base, text: '#', pageNumber: true })
      continue
    }
    if (run) runs.push(run)
  }
  return { ...parsed, runs: runs.length ? runs : parsed.runs, empty: runs.every((r) => !r.text) }
}

/**
 * 把含分页符的段落拆分为 [paragraph, pageBreak, paragraph, pageBreak, ..., paragraph] 段序列。
 * 对不含分页符的段落，返回 [paragraph] 单元素数组。
 * 拆分方式：把 <w:r> 元素按是否包含 <w:br type="page"/> 切分；
 * 切点处的 w:r 只取分页符前的文本，分页符后的文本开始新段。
 */
function splitParagraphAtPageBreaks(
  p: Element
): Array<{ type: 'paragraph'; paragraph?: DocxParagraph } | { type: 'pageBreak' }> {
  const out: Array<{ type: 'paragraph'; paragraph?: DocxParagraph } | { type: 'pageBreak' }> = []
  // 收集 w:r 子元素（保持原顺序）
  const runEls: Element[] = []
  for (const c of Array.from(p.children)) {
    if (c.tagName === 'w:r') runEls.push(c)
  }
  if (runEls.length === 0) {
    return [{ type: 'paragraph', paragraph: parseWParagraph(p) }]
  }
  // 判断段落是否含分页符
  let hasPb = false
  for (const r of runEls) {
    for (const cc of Array.from(r.children)) {
      if (cc.tagName === 'w:br' && cc.getAttribute('w:type') === 'page') {
        hasPb = true
        break
      }
    }
    if (hasPb) break
  }
  if (!hasPb) {
    return [{ type: 'paragraph', paragraph: parseWParagraph(p) }]
  }
  // 复用 p 的 pPr / 其他非 w:r 子元素给每段
  const pPr = p.getElementsByTagName('w:pPr')[0]
  const nonRunChildren: Element[] = []
  for (const c of Array.from(p.children)) {
    if (c.tagName !== 'w:r') nonRunChildren.push(c)
  }
  // 扫描每个 w:r，遇到含分页符的，把 r 切为 [分页符前部分] 和 [分页符后部分]
  let currentRuns: Element[] = []
  for (const r of runEls) {
    // 找到 r 里第一个分页符位置
    let firstPbIndex = -1
    const rChildren = Array.from(r.children)
    for (let i = 0; i < rChildren.length; i++) {
      const c = rChildren[i]
      if (c.tagName === 'w:br' && c.getAttribute('w:type') === 'page') {
        firstPbIndex = i
        break
      }
    }
    if (firstPbIndex === -1) {
      currentRuns.push(r)
      continue
    }
    // 切 r：前半段（保留 0..firstPbIndex，含分页符）作为当前段最后 run；后半段作为新段首 run
    // 为简化：前半段保留到 currentRuns（含分页符），然后输出当前段 + pageBreak + 起新段
    currentRuns.push(r)
    // 构造当前段 DOM 并解析
    const curP = buildParagraphFromRuns(pPr, nonRunChildren, currentRuns)
    out.push({ type: 'paragraph', paragraph: parseWParagraph(curP) })
    out.push({ type: 'pageBreak' })
    // 分页符后的内容开始新段
    currentRuns = []
    // 检查 r 在分页符之后是否还有别的元素（如 w:t）
    const afterChildren = rChildren.slice(firstPbIndex + 1)
    if (afterChildren.length > 0) {
      // 构造一个新的 w:r 包含 afterChildren
      const newR = r.cloneNode(false) as Element
      for (const ac of afterChildren) newR.appendChild(ac)
      currentRuns.push(newR)
    }
  }
  // 段末剩余的 runs
  if (currentRuns.length > 0) {
    const curP = buildParagraphFromRuns(pPr, nonRunChildren, currentRuns)
    out.push({ type: 'paragraph', paragraph: parseWParagraph(curP) })
  } else {
    // 分页符在段落末尾 —— 末尾插入一个空段占位
    out.push({ type: 'paragraph', paragraph: { runs: [], align: parseAlignFromPPr(pPr), empty: true } })
  }
  return out
}

/** 构造一个 <w:p> 元素，pPr + 其他非 w:r 子 + 给定 w:r 列表，供 parseWParagraph 解析 */
function buildParagraphFromRuns(pPr: Element | undefined, nonRunChildren: Element[], runEls: Element[]): Element {
  const p = document.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:p')
  if (pPr) p.appendChild(pPr.cloneNode(true))
  for (const nc of nonRunChildren) {
    if (nc.tagName === 'w:pPr') continue
    p.appendChild(nc.cloneNode(true))
  }
  for (const r of runEls) p.appendChild(r.cloneNode(true))
  return p
}

/**
 * 从 base64 编码的文件内容解析富结构文档（Ethan 抽屉同步使用：
 * FormDocument.rawContent 存的是 docx 的 base64）。
 */
export async function parseDocxRichDocumentFromBase64(
  fileName: string,
  base64: string
): Promise<DocxRichDocument> {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return parseDocxRichDocument(fileName, bytes.buffer)
}

// ──────────────── 内部解析工具 ────────────────

/** 提取段落/单元格元素内的文本（按文档顺序遍历 w:t / w:tab / w:br）。旧 API 用。 */
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

/** 旧 API：逐行提取单元格文本。 */
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

/** 旧 API 单元格文本归一化。 */
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

// ── 富结构：段落解析 ──

function parseWParagraph(p: Element): DocxParagraph {
  // 段落级属性（<w:pPr>）：对齐等
  const pPr = p.getElementsByTagName('w:pPr')[0]
  const align = parseAlignFromPPr(pPr)
  const spacing = parseSpacingFromPPr(pPr)
  const indent = parseIndentFromPPr(pPr)
  const keepNext = !!pPr?.getElementsByTagName('w:keepNext')[0]
  const keepLines = !!pPr?.getElementsByTagName('w:keepLines')[0]
  const pageBreakBefore = !!pPr?.getElementsByTagName('w:pageBreakBefore')[0]
  const shading = parseShdFill(pPr?.getElementsByTagName('w:shd')[0])

  const runs: DocxRun[] = []
  // 仅遍历直接子元素中的 <w:r>，避免进入嵌套表格
  for (const child of Array.from(p.children)) {
    if (child.tagName === 'w:r') {
      const run = parseWRun(child)
      if (run) runs.push(run)
    }
  }
  // 段落为空：可能是空行 / 仅有 <w:pPr>，保留为占位空段
  const text = runs.map((r) => r.text).join('')
  return {
    runs,
    align,
    empty: text.length === 0,
    ...spacing,
    ...indent,
    keepNext: keepNext || undefined,
    keepLines: keepLines || undefined,
    pageBreakBefore: pageBreakBefore || undefined,
    ...(shading ? { shading } : {}),
  }
}

function parseAlignFromPPr(pPr: Element | undefined): DocxParagraph['align'] {
  if (!pPr) return undefined
  const jc = pPr.getElementsByTagName('w:jc')[0]
  if (!jc) return undefined
  const v = jc.getAttribute('w:val')
  if (v === 'center') return 'center'
  if (v === 'right' || v === 'end') return 'right'
  if (v === 'both' || v === 'distribute') return 'both'
  return 'left'
}

/** 段落行距/段间距（<w:spacing>）。 */
function parseSpacingFromPPr(
  pPr: Element | undefined
): Pick<DocxParagraph, 'lineSpacing' | 'lineSpacingRule' | 'spacingBefore' | 'spacingAfter'> {
  if (!pPr) return {}
  const sp = pPr.getElementsByTagName('w:spacing')[0]
  if (!sp) return {}
  const out: Pick<DocxParagraph, 'lineSpacing' | 'lineSpacingRule' | 'spacingBefore' | 'spacingAfter'> = {}

  const line = parseInt(sp.getAttribute('w:line') ?? '0', 10)
  const rule = sp.getAttribute('w:lineRule')
  if (line > 0) {
    out.lineSpacing = line
    if (rule === 'atLeast' || rule === 'exact' || rule === 'multiple' || rule === 'auto') {
      out.lineSpacingRule = rule
    }
  }
  const before = parseInt(sp.getAttribute('w:before') ?? '0', 10)
  const after = parseInt(sp.getAttribute('w:after') ?? '0', 10)
  if (before > 0) out.spacingBefore = before
  if (after > 0) out.spacingAfter = after
  return out
}

/** 段落缩进（<w:ind>）。word 存的是正缩进，悬挂缩进为负首行。 */
function parseIndentFromPPr(
  pPr: Element | undefined
): Pick<DocxParagraph, 'indentLeft' | 'indentRight' | 'indentFirstLine' | 'indentFirstLineChars'> {
  if (!pPr) return {}
  const ind = pPr.getElementsByTagName('w:ind')[0]
  if (!ind) return {}
  const out: Pick<DocxParagraph, 'indentLeft' | 'indentRight' | 'indentFirstLine' | 'indentFirstLineChars'> = {}
  const left = parseInt(ind.getAttribute('w:left') ?? ind.getAttribute('w:start') ?? '0', 10)
  const right = parseInt(ind.getAttribute('w:right') ?? ind.getAttribute('w:end') ?? '0', 10)
  // 首行：firstLineChars / hangingChars 按字符计（单位 1/100 字符，如 200=2 字符），优先；
  // 否则 firstLine / hanging 按 twip（正值=缩进，hanging=悬挂缩进）。
  const firstLineChars = parseInt(ind.getAttribute('w:firstLineChars') ?? '0', 10)
  const hangingChars = parseInt(ind.getAttribute('w:hangingChars') ?? '0', 10)
  const hanging = parseInt(ind.getAttribute('w:hanging') ?? '0', 10)
  if (firstLineChars !== 0 || hangingChars !== 0) {
    out.indentFirstLineChars = hangingChars !== 0 ? -hangingChars : firstLineChars
  } else if (hanging !== 0) {
    out.indentFirstLine = -hanging
  } else {
    const firstLine = parseInt(ind.getAttribute('w:firstLine') ?? '0', 10)
    if (firstLine !== 0) out.indentFirstLine = firstLine
  }
  if (left > 0) out.indentLeft = left
  if (right > 0) out.indentRight = right
  return out
}

/** 底纹填充色：解析 <w:shd w:fill/>，忽略 'auto'。 */
function parseShdFill(shd: Element | undefined): string | undefined {
  if (!shd) return undefined
  const fill = shd.getAttribute('w:fill')
  if (!fill || fill === '' || fill === 'auto' || /^#*000000$/i.test(fill)) return undefined
  return normalizeHex(fill)
}

/** 归一化 hex 颜色为 6 位不带 #。 */
function normalizeHex(v: string): string {
  const s = v.replace(/^#/, '').trim()
  if (/^[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return s
      .split('')
      .map((c) => c + c)
      .join('')
  }
  return s
}

/** twip → pt（1pt = 20twip） */
function twipToPt(v: number): number {
  return v / 20
}

// ── 富结构：run 解析（文本片段）──

function parseWRun(r: Element): DocxRun | null {
  // run 级属性（<w:rPr>）：粗体、斜体、下划线、删除线、颜色、字号、字体、上下标、底纹
  const rPr = r.getElementsByTagName('w:rPr')[0]
  const bold = !!rPr?.getElementsByTagName('w:b')[0] || !!rPr?.getElementsByTagName('w:bCs')[0]
  const italic = !!rPr?.getElementsByTagName('w:i')[0]
  const strike =
    !!rPr?.getElementsByTagName('w:strike')[0] || !!rPr?.getElementsByTagName('w:dstrike')[0]
  const uEl = rPr?.getElementsByTagName('w:u')[0]
  const underline =
    uEl && uEl.getAttribute('w:val') && uEl.getAttribute('w:val') !== 'none' && uEl.getAttribute('w:val') !== ''
      ? uEl.getAttribute('w:val')!
      : undefined
  const colorEl = rPr?.getElementsByTagName('w:color')[0]
  const colorVal = colorEl?.getAttribute('w:val')
  const color =
    colorVal && colorVal !== 'auto' && !/^65535$/i.test(colorVal) ? normalizeHex(colorVal) : undefined
  const rShd = rPr?.getElementsByTagName('w:shd')[0]
  const highlight = parseShdFill(rShd) // 文字底纹（w:rPr 内 shd 的 fill 即高亮色）
  const va = rPr?.getElementsByTagName('w:vertAlign')[0]
  const vaVal = va?.getAttribute('w:val')
  const vertAlign =
    vaVal === 'superscript' || vaVal === 'super' ? 'super' : vaVal === 'subscript' || vaVal === 'sub' ? 'sub' : undefined
  const szEl = rPr?.getElementsByTagName('w:sz')[0]
  const fontSize = szEl ? parseInt(szEl.getAttribute('w:val') ?? '0', 10) || undefined : undefined
  const rFonts = rPr?.getElementsByTagName('w:rFonts')[0]
  // 中文字体优先（eastAsia），其次西文（ascii/hAnsi）
  const fontFamily =
    rFonts?.getAttribute('w:eastAsia') ||
    rFonts?.getAttribute('w:ascii') ||
    rFonts?.getAttribute('w:hAnsi') ||
    undefined
  // 空心字（<w:outline/>）：仅描边不填充
  const outline = !!rPr?.getElementsByTagName('w:outline')[0]
  // 字符间距（<w:spacing w:val/>，单位 1/20 pt）
  const charSpEl = rPr?.getElementsByTagName('w:spacing')[0]
  const characterSpacing = charSpEl
    ? parseInt(charSpEl.getAttribute('w:val') ?? '0', 10) || undefined
    : undefined

  // run 内的文本与控制符（<w:t>、<w:tab>、<w:br>）
  let text = ''
  for (const child of Array.from(r.children)) {
    if (child.tagName === 'w:t') {
      text += child.textContent ?? ''
    } else if (child.tagName === 'w:tab') {
      text += '\t'
    } else if (child.tagName === 'w:br' || child.tagName === 'w:cr') {
      text += '\n'
    }
  }
  if (text === '') return null
  return {
    text,
    bold: bold || undefined,
    italic: italic || undefined,
    strike: strike || undefined,
    underline,
    color,
    highlight,
    vertAlign,
    fontSize,
    fontFamily,
    outline: outline || undefined,
    characterSpacing,
  }
}

// ── 富结构：表格解析 ──

/**
 * 把 <w:tbl> 解析为 DocxTable（含合并、边框、列宽）。
 *
 * 合并逻辑：vMerge 记录在每行的 tc 上；解析时把"被上方吞掉"的格子补成占位
 * （在 row 中按列顺序插入 dummy cell），让最终 rows 与 colCount 对齐，便于
 * officeService 直接构 Univer UDM 而无需再做合并展开。
 */
function parseWTable(tbl: Element): DocxTable {
  // 表格级列宽（<w:tblGrid><w:gridCol w:w="..."/></w:tblGrid>）
  const columnWidths: number[] = []
  const grid = tbl.getElementsByTagName('w:tblGrid')[0]
  if (grid) {
    for (const col of Array.from(grid.children)) {
      if (col.tagName === 'w:gridCol') {
        columnWidths.push(parseInt(col.getAttribute('w:w') ?? '0', 10) || 0)
      }
    }
  }
  let colCount = columnWidths.length || inferColumnCount(tbl)

  // ── 兜底：<w:tblGrid> 缺失或全为 0 时，从第一行 <w:tcW> 推断列宽 ──
  // WPS/部分老格式导出的 docx 经常只有 tcW 没有 tblGrid；缺少这步会导致
  // officeService 拿到空 columnWidths，把每列压成 20 twip 最小值（中文汉字都塞不下）。
  const hasValidGrid = columnWidths.length > 0 && columnWidths.some((w) => w > 0)
  if (!hasValidGrid && colCount > 0) {
    const firstRow = Array.from(tbl.children).find((c) => c.tagName === 'w:tr')
    if (firstRow) {
      const inferred: number[] = []
      let col = 0
      for (const tc of Array.from(firstRow.children)) {
        if (tc.tagName !== 'w:tc') continue
        const tcPr = tc.getElementsByTagName('w:tcPr')[0]
        const gs = tcPr?.getElementsByTagName('w:gridSpan')[0]
        const span = gs ? Math.max(1, parseInt(gs.getAttribute('w:val') ?? '1', 10) || 1) : 1
        const tcW = tcPr?.getElementsByTagName('w:tcW')[0]
        const w = tcW ? parseInt(tcW.getAttribute('w:w') ?? '0', 10) || 0 : 0
        if (w > 0 && span > 0) {
          const perCol = Math.round(w / span)
          for (let i = 0; i < span; i++) {
            if (inferred[col + i] === undefined) inferred[col + i] = perCol
          }
        }
        col += span
      }
      if (inferred.length > 0 && inferred.some((w) => w > 0)) {
        columnWidths.length = 0
        columnWidths.push(...inferred)
        colCount = columnWidths.length // 更新 colCount 以匹配推断的列宽数
      }
    }
  }

  // 表格水平对齐（<w:tblPr><w:jc>）
  const tblPr = tbl.getElementsByTagName('w:tblPr')[0]
  let align: DocxTable['align']
  const tblJc = tblPr?.getElementsByTagName('w:jc')[0]
  const tblJcVal = tblJc?.getAttribute('w:val')
  if (tblJcVal === 'center') align = 'center'
  else if (tblJcVal === 'right' || tblJcVal === 'end') align = 'right'
  else if (tblJcVal === 'left' || tblJcVal === 'start') align = 'left'

  // 行级：<w:tr>
  const trList = Array.from(tbl.children).filter((c) => c.tagName === 'w:tr')
  const rows: DocxCell[][] = []
  const rowHeights: (number | undefined)[] = []

  // vMerge 跨行延续：记录当前合并列的起始列与列数（colSpan），下行同列若是 continue 则吞掉
  // 简化为：解析时不再为 continue 行补 dummy（Univer 要求对齐），而是为该位置留出占位
  // （officeService 收到 rows 后用 colCount 比对，缺的格子用占位 cell 补齐）。
  // 但保险起见这里就在解析阶段补齐到 colCount，避免后续漏判。
  for (const tr of trList) {
    const row: DocxCell[] = []
    for (const tc of Array.from(tr.children)) {
      if (tc.tagName !== 'w:tc') continue
      // 行首单元格携带 trHeight（tr 级属性，取一次即可）
      row.push(parseWCell(tc))
    }
    rows.push(padRow(row, colCount))
    // 行高（<w:trPr><w:trHeight w:val>，twip）
    const trPr = tr.getElementsByTagName('w:trPr')[0]
    const trHeight = trPr?.getElementsByTagName('w:trHeight')[0]
    const thVal = trHeight ? parseInt(trHeight.getAttribute('w:val') ?? '0', 10) || 0 : 0
    rowHeights.push(thVal > 0 ? thVal : undefined)
  }

  // ── vMerge 后处理：计算 rowSpan ──
  // 遍历每列，找出 vMerge='restart' 的单元格，向下数 vMerge='continue' 的行数
  for (let col = 0; col < colCount; col++) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      // 找到占据 col 列的单元格（考虑 colSpan）
      let cellCol = 0
      let cell: DocxCell | null = null
      for (const c of row) {
        if (cellCol > col) break
        if (cellCol <= col && col < cellCol + c.colSpan) {
          cell = c
          break
        }
        cellCol += c.colSpan
      }
      if (!cell || cell.vMerge !== 'restart') continue

      // 向下数 continue 行数
      let span = 1
      for (let r2 = r + 1; r2 < rows.length; r2++) {
        const nextRow = rows[r2]
        let nextCellCol = 0
        let nextCell: DocxCell | null = null
        for (const c of nextRow) {
          if (nextCellCol > col) break
          if (nextCellCol <= col && col < nextCellCol + c.colSpan) {
            nextCell = c
            break
          }
          nextCellCol += c.colSpan
        }
        if (nextCell && nextCell.vMerge === 'continue') {
          span++
        } else {
          break
        }
      }
      if (span > 1) cell.rowSpan = span
    }
  }

  return { rows, colCount, columnWidths: columnWidths.length ? columnWidths : undefined, ...(align ? { align } : {}), ...(rowHeights.some((h) => h != null) ? { rowHeights } : {}) }
}

/** 用占位 cell 把行补齐到 colCount（vMerge continue 列补占位） */
function padRow(row: DocxCell[], colCount: number): DocxCell[] {
  // 必须按实际列数（colSpan 之和）判断，不能用 row.length——
  // 当单元格有 colSpan>1 时，row.length 远小于实际列数，会导致追加多余 dummy cell。
  const actualCols = row.reduce((sum, cell) => sum + cell.colSpan, 0)
  if (actualCols >= colCount) return row // 已占满，不需要补齐
  const padded = row.slice()
  while (padded.reduce((sum, cell) => sum + cell.colSpan, 0) < colCount) {
    padded.push({
      paragraphs: [{ runs: [], empty: true }],
      colSpan: 1,
      vMerge: 'continue',
    })
  }
  return padded
}

/** 兜底：缺 <w:tblGrid> 时按行内实际 td 数推断列数（取最大值） */
function inferColumnCount(tbl: Element): number {
  let max = 0
  for (const tr of Array.from(tbl.children)) {
    if (tr.tagName !== 'w:tr') continue
    let n = 0
    for (const tc of Array.from(tr.children)) {
      if (tc.tagName !== 'w:tc') continue
      n += parseGridSpan(tc)
    }
    if (n > max) max = n
  }
  return max
}

function parseGridSpan(tc: Element): number {
  const tcPr = tc.getElementsByTagName('w:tcPr')[0]
  if (!tcPr) return 1
  const gs = tcPr.getElementsByTagName('w:gridSpan')[0]
  if (!gs) return 1
  return Math.max(1, parseInt(gs.getAttribute('w:val') ?? '1', 10) || 1)
}

// ── 富结构：单元格解析 ──

function parseWCell(tc: Element): DocxCell {
  const tcPr = tc.getElementsByTagName('w:tcPr')[0]
  const colSpan = parseGridSpan(tc)
  const vMerge = parseVMerge(tcPr)
  const borders = parseBordersFromTcPr(tcPr)
  const margins = parseMarginsFromTcPr(tcPr)
  const width = parseWidthFromTcPr(tcPr)
  const shading = parseShdFill(tcPr?.getElementsByTagName('w:shd')[0])
  const va = tcPr?.getElementsByTagName('w:vAlign')[0]
  const vaVal = va?.getAttribute('w:val')
  const vertAlign =
    vaVal === 'top' ? 'top' : vaVal === 'center' ? 'center' : vaVal === 'bottom' ? 'bottom' : undefined

  // 单元格内的多个 <w:p>：DOCX 表格里每个 tc 至少含一个 <w:p>，即使为空
  const paragraphs: DocxParagraph[] = []
  for (const child of Array.from(tc.children)) {
    if (child.tagName === 'w:p') {
      paragraphs.push(parseWParagraph(child))
    }
  }
  if (paragraphs.length === 0) {
    paragraphs.push({ runs: [], empty: true })
  }

  return { paragraphs, colSpan, vMerge, borders, margins, width, ...(shading ? { shading } : {}), ...(vertAlign ? { vertAlign } : {}) }
}

function parseVMerge(tcPr: Element | undefined): DocxCell['vMerge'] {
  if (!tcPr) return 'restart'
  const vm = tcPr.getElementsByTagName('w:vMerge')[0]
  if (!vm) return 'restart'
  const v = vm.getAttribute('w:val')
  return v === 'continue' ? 'continue' : 'restart'
}

function parseBordersFromTcPr(tcPr: Element | undefined): DocxCell['borders'] {
  if (!tcPr) return undefined
  const tcBorders = tcPr.getElementsByTagName('w:tcBorders')[0]
  if (!tcBorders) return undefined
  const borders: NonNullable<DocxCell['borders']> = {}
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const el = tcBorders.getElementsByTagName(`w:${side}`)[0]
    if (!el) continue
    const style = el.getAttribute('w:val') ?? 'single'
    const size = parseInt(el.getAttribute('w:sz') ?? '0', 10) || 0
    const color = (el.getAttribute('w:color') ?? '000000').replace(/^#/, '')
    // DOCX：'nil' / 'none' 视为无边框；sz=0 也视为无边框
    if (style === 'nil' || style === 'none' || size === 0) continue
    borders[side] = { style, size, color }
  }
  return Object.keys(borders).length ? borders : undefined
}

function parseMarginsFromTcPr(tcPr: Element | undefined): DocxCell['margins'] {
  if (!tcPr) return undefined
  const tcMar = tcPr.getElementsByTagName('w:tcMar')[0]
  if (!tcMar) return undefined
  const margins: NonNullable<DocxCell['margins']> = {}
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const el = tcMar.getElementsByTagName(`w:${side}`)[0]
    if (!el) continue
    const w = parseInt(el.getAttribute('w:w') ?? '0', 10) || 0
    if (w > 0) margins[side] = w
  }
  return Object.keys(margins).length ? margins : undefined
}

function parseWidthFromTcPr(tcPr: Element | undefined): number | undefined {
  if (!tcPr) return undefined
  const tcW = tcPr.getElementsByTagName('w:tcW')[0]
  if (!tcW) return undefined
  const w = parseInt(tcW.getAttribute('w:w') ?? '0', 10) || 0
  return w > 0 ? w : undefined
}
