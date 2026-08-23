import PizZip from 'pizzip'

/**
 * Word 文档结构分析器
 * 深度解析 .docx 文件的结构信息，包括：
 * - 段落结构和文本内容
 * - 表格结构（行列、合并单元格）
 * - 书签位置
 * - 窗体控件（文本框、下拉列表、日期选择器等）
 * - 占位符模式（____、【请填写】、{placeholder}等）
 * - 页眉页脚内容
 * - 文本框内容
 */

export interface DocxStructure {
  paragraphs: ParagraphInfo[]
  tables: TableInfo[]
  bookmarks: BookmarkInfo[]
  formFields: FormFieldInfo[]
  placeholders: PlaceholderInfo[]
  headers: HeaderFooterInfo[]
  footers: HeaderFooterInfo[]
  textBoxes: TextBoxInfo[]
  summary: DocxSummary
}

/**
 * 文档结构摘要（供 LLM 快速理解文档全貌）
 */
export interface DocxSummary {
  totalParagraphs: number
  totalTables: number
  tableDimensions: string[]  // 如 ["26×9", "5×4", "4×3"]
  coverFields: string[]  // 封面填空，如 ["申报学院", "团队名称"]
  hasMergedCells: boolean
  totalPlaceholders: number
  fillableCellCount: number
  labelCellCount: number
}

export interface ParagraphInfo {
  index: number
  text: string
  style?: string
  alignment?: string
  hasUnderline?: boolean
  charOffset: number  // 在文档中的字符偏移
}

export interface TableInfo {
  rowIndex: number
  colIndex: number
  cellRef: string  // 如 "R1C1", "R2C3"
  text: string
  isMerged?: boolean
  mergeOrigin?: string  // 合并单元格的原始位置
  isEmpty: boolean
  hasLabel: boolean  // 是否包含标签（如"姓名："）
  hasPlaceholder: boolean  // 是否包含占位符
  isReadOnly?: boolean  // 是否为只读单元格（题干列）
  isFillable?: boolean  // 是否为可填写单元格（右侧填写列）
  vMergeType?: 'restart' | 'continue'  // 合并单元格类型
  labelFor?: string  // 如果是标签格，指向对应的填写格 cellRef
  filledBy?: string  // 如果是填写格，指向对应的标签格 cellRef
}

export interface BookmarkInfo {
  name: string
  paragraphIndex: number
  charOffset: number
  text?: string  // 书签内的文本
}

export interface FormFieldInfo {
  name: string
  type: 'text' | 'dropdown' | 'date' | 'checkbox' | 'radio'
  defaultValue?: string
  options?: string[]  // 下拉选项
  paragraphIndex: number
  charOffset: number
}

export interface PlaceholderInfo {
  type: 'underline' | 'bracket' | 'brace' | 'custom'
  text: string  // 占位符文本，如 "____", "【请填写】", "{name}"
  paragraphIndex: number
  charOffset: number
  length: number
  context?: string  // 占位符前后的上下文
}

export interface HeaderFooterInfo {
  type: 'header' | 'footer'
  text: string
  pageIndex?: number  // 如果指定了页码
}

export interface TextBoxInfo {
  id: string
  text: string
  paragraphIndex: number
  position?: { top: number; left: number; width: number; height: number }
}

/**
 * 分析 Word 文档结构
 */
export function analyzeDocxStructure(rawContent: ArrayBuffer | string): DocxStructure {
  let buffer: Uint8Array
  if (typeof rawContent === 'string') {
    const binaryString = atob(rawContent)
    buffer = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      buffer[i] = binaryString.charCodeAt(i)
    }
  } else {
    buffer = new Uint8Array(rawContent)
  }

  const zip = new PizZip(buffer)
  const docXml = zip.file('word/document.xml')?.asText()
  if (!docXml) {
    throw new Error('无法读取 document.xml')
  }

  console.log('[docxAnalyzer] Starting document structure analysis...')

  const paragraphs = extractParagraphs(docXml)
  const tables = extractTables(docXml)
  const bookmarks = extractBookmarks(docXml)
  const formFields = extractFormFields(docXml)
  const placeholders = extractPlaceholders(docXml)
  const headers = extractHeadersFooters(zip, 'header')
  const footers = extractHeadersFooters(zip, 'footer')
  const textBoxes = extractTextBoxes(docXml)

  // 生成结构摘要
  const summary = generateDocxSummary(paragraphs, tables, placeholders)

  const structure: DocxStructure = {
    paragraphs,
    tables,
    bookmarks,
    formFields,
    placeholders,
    headers,
    footers,
    textBoxes,
    summary,
  }

  console.log('[docxAnalyzer] Analysis complete:')
  console.log(`  - Paragraphs: ${structure.paragraphs.length}`)
  console.log(`  - Tables: ${structure.tables.length}`)
  console.log(`  - Bookmarks: ${structure.bookmarks.length}`)
  console.log(`  - Form Fields: ${structure.formFields.length}`)
  console.log(`  - Placeholders: ${structure.placeholders.length}`)
  console.log(`  - Headers: ${structure.headers.length}`)
  console.log(`  - Footers: ${structure.footers.length}`)
  console.log(`  - Text Boxes: ${structure.textBoxes.length}`)
  console.log(`  - Summary: ${summary.totalTables} tables, ${summary.totalPlaceholders} placeholders, ${summary.fillableCellCount} fillable cells`)

  return structure
}

/**
 * 生成文档结构摘要
 */
function generateDocxSummary(
  paragraphs: ParagraphInfo[],
  tables: TableInfo[],
  placeholders: PlaceholderInfo[]
): DocxSummary {
  // 统计表格维度（按表格分组）
  const tableDimensions: string[] = []
  const tableMap = new Map<string, { maxRow: number; maxCol: number }>()
  
  for (const table of tables) {
    // 使用 rowIndex 作为表格标识（简化处理）
    const tableKey = `table_${table.rowIndex}`
    if (!tableMap.has(tableKey)) {
      tableMap.set(tableKey, { maxRow: 0, maxCol: 0 })
    }
    const dim = tableMap.get(tableKey)!
    dim.maxRow = Math.max(dim.maxRow, table.rowIndex + 1)
    dim.maxCol = Math.max(dim.maxCol, table.colIndex + 1)
  }
  
  for (const [, dim] of tableMap) {
    tableDimensions.push(`${dim.maxRow}×${dim.maxCol}`)
  }
  
  // 提取封面字段（前 10 个段落的占位符）
  const coverFields: string[] = []
  const coverPlaceholders = placeholders.filter(p => p.paragraphIndex < 10)
  for (const p of coverPlaceholders) {
    if (p.context && !coverFields.includes(p.context)) {
      coverFields.push(p.context)
    }
  }
  
  // 统计合并单元格
  const hasMergedCells = tables.some(t => t.isMerged)
  
  // 统计可填写单元格和标签单元格
  const fillableCellCount = tables.filter(t => t.isFillable).length
  const labelCellCount = tables.filter(t => t.isReadOnly).length
  
  return {
    totalParagraphs: paragraphs.length,
    totalTables: tableMap.size,
    tableDimensions,
    coverFields,
    hasMergedCells,
    totalPlaceholders: placeholders.length,
    fillableCellCount,
    labelCellCount,
  }
}

/**
 * 提取段落信息
 */
function extractParagraphs(docXml: string): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = []
  
  // 匹配所有 <w:p> 段落
  const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g
  let match
  let index = 0
  let charOffset = 0

  while ((match = paragraphRegex.exec(docXml)) !== null) {
    const paragraphXml = match[0]
    
    // 提取段落文本
    const textNodes = paragraphXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
    const text = textNodes.map(t => {
      const textMatch = t.match(/<w:t[^>]*>([^<]*)<\/w:t>/)
      return textMatch ? textMatch[1] : ''
    }).join('')

    // 提取段落样式
    const styleMatch = paragraphXml.match(/<w:pStyle\s+w:val="([^"]+)"/)
    const style = styleMatch ? styleMatch[1] : undefined

    // 提取对齐方式
    const alignMatch = paragraphXml.match(/<w:jc\s+w:val="([^"]+)"/)
    const alignment = alignMatch ? alignMatch[1] : undefined

    // 检查是否有下划线
    const hasUnderline = paragraphXml.includes('<w:u')

    paragraphs.push({
      index,
      text,
      style,
      alignment,
      hasUnderline,
      charOffset,
    })

    charOffset += text.length
    index++
  }

  return paragraphs
}

/**
 * 判断单元格是否为标签格（启发式）
 * 特征：短文本（< 15 字）+ (加粗 或 居中 或 冒号结尾)
 */
function isLabelCell(cellXml: string, text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0 || trimmed.length >= 15) return false
  const isBold = cellXml.includes('<w:b/>') || cellXml.includes('<w:b ')
  const isCentered = /<w:jc\s+w:val="center"/.test(cellXml)
  const endsWithColon = /[：:]$/.test(trimmed)
  return isBold || isCentered || endsWithColon
}

/**
 * 判断单元格是否为填写格（启发式）
 * 特征：完全空白 或 包含占位符 或 灰色提示文字
 */
function isFillableCell(cellXml: string, text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return true
  if (/[＿_]{3,}|【[^】]+】|\{[^}]+\}/.test(text)) return true
  // 灰色提示文字（检查字体颜色）
  if (/<w:color\s+w:val="(808080|A6A6A6|BFBFBF|999999|C0C0C0)"/.test(cellXml)) return true
  return false
}

/**
 * 提取表格信息
 */
function extractTables(docXml: string): TableInfo[] {
  const tables: TableInfo[] = []
  
  // 匹配所有 <w:tbl> 表格
  const tableRegex = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g
  let tableMatch

  while ((tableMatch = tableRegex.exec(docXml)) !== null) {
    const tableXml = tableMatch[0]
    
    // 提取所有行 <w:tr>
    const rowRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g
    let rowMatch
    let rowIndex = 0

    while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
      const rowXml = rowMatch[0]
      
      // 提取所有单元格 <w:tc>
      const cellRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g
      let cellMatch
      let colIndex = 0

      while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
        const cellXml = cellMatch[0]
        
        // 提取单元格文本
        const textNodes = cellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
        const text = textNodes.map(t => {
          const textMatch = t.match(/<w:t[^>]*>([^<]*)<\/w:t>/)
          return textMatch ? textMatch[1] : ''
        }).join('')

        // 检查是否是合并单元格
        const gridSpanMatch = cellXml.match(/<w:gridSpan\s+w:val="(\d+)"/)
        const vMergeMatch = cellXml.match(/<w:vMerge(?:\s+w:val="([^"]+)")?/)
        const isMerged = !!(gridSpanMatch || vMergeMatch)
        
        // 区分 vMerge 类型：restart 或 continue
        let vMergeType: 'restart' | 'continue' | null = null
        if (vMergeMatch) {
          vMergeType = vMergeMatch[1] === 'continue' ? 'continue' : 'restart'
        }

        // 检查是否为空
        const isEmpty = text.trim() === ''

        // 检查是否包含标签（冒号结尾）
        const hasLabel = /[：:]$/.test(text.trim())

        // 检查是否包含占位符
        const hasPlaceholder = /[＿_]{3,}|【[^】]+】|\{[^}]+\}/.test(text)

        // ============================================================
        // 修复2：启发式识别标签格/填写格（优先）+ 列索引兜底
        // ============================================================
        const heuristicLabel = isLabelCell(cellXml, text)
        const heuristicFillable = isFillableCell(cellXml, text)

        let isReadOnly = false
        let isFillable = false
        
        // 优先使用启发式判断
        if (heuristicLabel && !hasPlaceholder) {
          isReadOnly = true
        } else if (heuristicFillable && !heuristicLabel) {
          isFillable = true
        } else {
          // 兜底：列索引规则
          if (colIndex === 0 && !isEmpty && !hasPlaceholder) {
            isReadOnly = true
          }
          if (colIndex >= 1 && (isEmpty || hasPlaceholder)) {
            isFillable = true
          }
          if (hasLabel && !hasPlaceholder) {
            isReadOnly = true
          }
        }

        tables.push({
          rowIndex,
          colIndex,
          cellRef: `R${rowIndex + 1}C${colIndex + 1}`,
          text,
          isMerged,
          isEmpty,
          hasLabel,
          hasPlaceholder,
          isReadOnly,
          isFillable,
          vMergeType: vMergeType || undefined,
        })

        colIndex++
      }
      rowIndex++
    }
  }

  // ============================================================
  // 修复3：后处理 - 建立标签→填写格的关联映射
  // ============================================================
  for (let i = 0; i < tables.length; i++) {
    const cell = tables[i]
    // 跳过 continue 行（影子 cell）
    if (cell.vMergeType === 'continue') continue
    
    if (cell.isReadOnly && !cell.isFillable && !cell.labelFor) {
      // 找到同一行的下一个填写格（跳过 continue 行）
      const sameRowFillable = tables.find(t => 
        t.rowIndex === cell.rowIndex && 
        t.colIndex > cell.colIndex &&
        t.vMergeType !== 'continue' &&
        t.isFillable &&
        !t.filledBy  // 尚未被其他标签关联
      )
      if (sameRowFillable) {
        cell.labelFor = sameRowFillable.cellRef
        sameRowFillable.filledBy = cell.cellRef
      }
    }
  }

  return tables
}

/**
 * 提取书签信息
 */
function extractBookmarks(docXml: string): BookmarkInfo[] {
  const bookmarks: BookmarkInfo[] = []
  
  // 匹配书签开始标记 <w:bookmarkStart>
  const bookmarkStartRegex = /<w:bookmarkStart\s+w:name="([^"]+)"\s+w:id="(\d+)"[^>]*\/?>/g
  let match

  while ((match = bookmarkStartRegex.exec(docXml)) !== null) {
    const name = match[1]
    const id = match[2]
    const position = match.index

    // 查找书签所在的段落
    const beforeXml = docXml.substring(0, position)
    const paragraphCount = (beforeXml.match(/<w:p\b/g) || []).length
    const paragraphIndex = paragraphCount > 0 ? paragraphCount - 1 : 0

    // 查找书签结束标记，提取书签内的文本
    const bookmarkEndRegex = new RegExp(`<w:bookmarkEnd\\s+w:id="${id}"[^>]*\\/?>`, 'g')
    const endMatch = bookmarkEndRegex.exec(docXml)
    
    let text: string | undefined
    if (endMatch) {
      const bookmarkContent = docXml.substring(position, endMatch.index)
      const textNodes = bookmarkContent.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
      text = textNodes.map(t => {
        const textMatch = t.match(/<w:t[^>]*>([^<]*)<\/w:t>/)
        return textMatch ? textMatch[1] : ''
      }).join('')
    }

    bookmarks.push({
      name,
      paragraphIndex,
      charOffset: position,
      text,
    })
  }

  return bookmarks
}

/**
 * 提取窗体控件信息
 */
function extractFormFields(docXml: string): FormFieldInfo[] {
  const formFields: FormFieldInfo[] = []
  
  // 匹配 Word 窗体字段 <w:fldSimple> 或 <w:sdt>
  const fieldRegex = /<w:(?:fldSimple|sdt)\b[^>]*>([\s\S]*?)<\/w:(?:fldSimple|sdt)>/g
  let match

  while ((match = fieldRegex.exec(docXml)) !== null) {
    const fieldXml = match[0]
    
    // 提取字段名称
    const nameMatch = fieldXml.match(/<w:name\s+w:val="([^"]+)"/) || 
                      fieldXml.match(/<w:tag\s+w:val="([^"]+)"/)
    const name = nameMatch ? nameMatch[1] : `field_${formFields.length}`

    // 判断字段类型
    let type: FormFieldInfo['type'] = 'text'
    if (fieldXml.includes('FORMTEXT')) {
      type = 'text'
    } else if (fieldXml.includes('FORMDROPDOWN')) {
      type = 'dropdown'
    } else if (fieldXml.includes('FORMCHECKBOX')) {
      type = 'checkbox'
    } else if (fieldXml.includes('FORMDATE')) {
      type = 'date'
    }

    // 提取默认值
    const defaultMatch = fieldXml.match(/<w:default\s+w:val="([^"]+)"/)
    const defaultValue = defaultMatch ? defaultMatch[1] : undefined

    // 提取下拉选项
    const options: string[] = []
    const optionRegex = /<w:listItem\s+w:displayText="([^"]+)"/g
    let optionMatch
    while ((optionMatch = optionRegex.exec(fieldXml)) !== null) {
      options.push(optionMatch[1])
    }

    // 查找字段所在的段落
    const position = match.index
    const beforeXml = docXml.substring(0, position)
    const paragraphCount = (beforeXml.match(/<w:p\b/g) || []).length
    const paragraphIndex = paragraphCount > 0 ? paragraphCount - 1 : 0

    formFields.push({
      name,
      type,
      defaultValue,
      options: options.length > 0 ? options : undefined,
      paragraphIndex,
      charOffset: position,
    })
  }

  return formFields
}

/**
 * 占位符真伪判定函数
 * 只有带下划线格式、【】、{}、书签、内容控件标记的内容才是可修改占位
 * 普通说明/题干文字禁止替换
 */
function isValidPlaceholder(textNodeXml: string, placeholderText: string, type: 'underline' | 'bracket' | 'brace'): boolean {
  // 规则1：下划线占位符必须带有下划线格式标记 <w:u>
  if (type === 'underline') {
    // 检查文本节点所在的 run 是否有下划线格式
    const hasUnderlineFormat = textNodeXml.includes('<w:u ') || textNodeXml.includes('<w:u/>')
    // 或者占位符本身是标准的下划线模式（3个以上下划线字符）
    const isStandardUnderline = /[＿_]{3,}/.test(placeholderText)
    return hasUnderlineFormat || isStandardUnderline
  }
  
  // 规则2：方括号占位符【】必须是完整的占位符模式
  if (type === 'bracket') {
    return /【[^】]+】/.test(placeholderText)
  }
  
  // 规则3：花括号占位符{}必须是完整的占位符模式
  if (type === 'brace') {
    return /\{[^}]+\}/.test(placeholderText)
  }
  
  return false
}

/**
 * 提取占位符信息（增强版：包含占位符真伪判定）
 */
function extractPlaceholders(docXml: string): PlaceholderInfo[] {
  const placeholders: PlaceholderInfo[] = []
  
  // 提取所有文本节点
  const textNodeRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g
  let match

  while ((match = textNodeRegex.exec(docXml)) !== null) {
    const text = match[1]
    const position = match.index
    const fullMatch = match[0]  // 包含完整的 <w:t>...</w:t> 标签

    // 查找下划线占位符 ____
    const underlineRegex = /([＿_]{3,})/g
    let underlineMatch
    while ((underlineMatch = underlineRegex.exec(text)) !== null) {
      const placeholderText = underlineMatch[1]
      const charOffset = position + underlineMatch.index

      // 占位符真伪判定：检查是否是真正的可修改占位符
      // 向上查找包含此文本节点的 run 的 XML
      const runStart = docXml.lastIndexOf('<w:r>', position)
      const runEnd = docXml.indexOf('</w:r>', position)
      const runXml = runStart >= 0 && runEnd > runStart 
        ? docXml.substring(runStart, runEnd + 6) 
        : fullMatch
      
      if (!isValidPlaceholder(runXml, placeholderText, 'underline')) {
        console.log(`[docxAnalyzer] Skipping false underline placeholder: "${placeholderText}"`)
        continue
      }

      // 查找所在段落
      const beforeXml = docXml.substring(0, charOffset)
      const paragraphCount = (beforeXml.match(/<w:p\b/g) || []).length
      const paragraphIndex = paragraphCount > 0 ? paragraphCount - 1 : 0

      // 提取上下文（前后20个字符）
      const contextStart = Math.max(0, underlineMatch.index - 20)
      const contextEnd = Math.min(text.length, underlineMatch.index + placeholderText.length + 20)
      const context = text.substring(contextStart, contextEnd)

      placeholders.push({
        type: 'underline',
        text: placeholderText,
        paragraphIndex,
        charOffset,
        length: placeholderText.length,
        context,
      })
    }

    // 查找方括号占位符 【请填写】
    const bracketRegex = /(【[^】]+】)/g
    let bracketMatch
    while ((bracketMatch = bracketRegex.exec(text)) !== null) {
      const placeholderText = bracketMatch[1]
      const charOffset = position + bracketMatch.index

      // 占位符真伪判定
      if (!isValidPlaceholder(fullMatch, placeholderText, 'bracket')) {
        console.log(`[docxAnalyzer] Skipping false bracket placeholder: "${placeholderText}"`)
        continue
      }

      const beforeXml = docXml.substring(0, charOffset)
      const paragraphCount = (beforeXml.match(/<w:p\b/g) || []).length
      const paragraphIndex = paragraphCount > 0 ? paragraphCount - 1 : 0

      placeholders.push({
        type: 'bracket',
        text: placeholderText,
        paragraphIndex,
        charOffset,
        length: placeholderText.length,
      })
    }

    // 查找花括号占位符 {placeholder}
    const braceRegex = /(\{[^}]+\})/g
    let braceMatch
    while ((braceMatch = braceRegex.exec(text)) !== null) {
      const placeholderText = braceMatch[1]
      const charOffset = position + braceMatch.index

      // 占位符真伪判定
      if (!isValidPlaceholder(fullMatch, placeholderText, 'brace')) {
        console.log(`[docxAnalyzer] Skipping false brace placeholder: "${placeholderText}"`)
        continue
      }

      const beforeXml = docXml.substring(0, charOffset)
      const paragraphCount = (beforeXml.match(/<w:p\b/g) || []).length
      const paragraphIndex = paragraphCount > 0 ? paragraphCount - 1 : 0

      placeholders.push({
        type: 'brace',
        text: placeholderText,
        paragraphIndex,
        charOffset,
        length: placeholderText.length,
      })
    }
  }

  console.log(`[docxAnalyzer] Extracted ${placeholders.length} valid placeholders (after authenticity verification)`)
  return placeholders
}

/**
 * 提取页眉页脚信息
 */
function extractHeadersFooters(zip: PizZip, type: 'header' | 'footer'): HeaderFooterInfo[] {
  const results: HeaderFooterInfo[] = []
  
  // 查找所有页眉/页脚文件
  const pattern = type === 'header' ? /word\/header\d+\.xml/ : /word\/footer\d+\.xml/
  const files = zip.file(pattern)

  for (const file of files) {
    const xml = file.asText()
    
    // 提取文本
    const textNodes = xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
    const text = textNodes.map(t => {
      const textMatch = t.match(/<w:t[^>]*>([^<]*)<\/w:t>/)
      return textMatch ? textMatch[1] : ''
    }).join('')

    if (text.trim()) {
      results.push({
        type,
        text,
      })
    }
  }

  return results
}

/**
 * 提取文本框信息
 */
function extractTextBoxes(docXml: string): TextBoxInfo[] {
  const textBoxes: TextBoxInfo[] = []
  
  // 匹配文本框 <w:txbxContent>
  const textBoxRegex = /<w:txbxContent\b[^>]*>([\s\S]*?)<\/w:txbxContent>/g
  let match
  let id = 0

  while ((match = textBoxRegex.exec(docXml)) !== null) {
    const textBoxXml = match[0]
    
    // 提取文本
    const textNodes = textBoxXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
    const text = textNodes.map(t => {
      const textMatch = t.match(/<w:t[^>]*>([^<]*)<\/w:t>/)
      return textMatch ? textMatch[1] : ''
    }).join('')

    // 查找所在段落
    const position = match.index
    const beforeXml = docXml.substring(0, position)
    const paragraphCount = (beforeXml.match(/<w:p\b/g) || []).length
    const paragraphIndex = paragraphCount > 0 ? paragraphCount - 1 : 0

    textBoxes.push({
      id: `textbox_${id++}`,
      text,
      paragraphIndex,
    })
  }

  return textBoxes
}

/**
 * 从文档结构中提取待填写字段的候选位置
 */
export function extractFillableLocations(structure: DocxStructure): Array<{
  type: 'paragraph' | 'table-cell' | 'bookmark' | 'form-field' | 'placeholder'
  paragraphIndex?: number
  cellRef?: string
  bookmarkName?: string
  fieldName?: string
  charOffset?: number
  context?: string
}> {
  const locations: Array<{
    type: 'paragraph' | 'table-cell' | 'bookmark' | 'form-field' | 'placeholder'
    paragraphIndex?: number
    cellRef?: string
    bookmarkName?: string
    fieldName?: string
    charOffset?: number
    context?: string
  }> = []

  // 1. 表格中的空白单元格或占位符单元格（跳过 vMerge continue 行）
  for (const table of structure.tables) {
    // 跳过 vMerge continue 行（影子 cell）
    if (table.vMergeType === 'continue') {
      continue
    }
    
    if (table.isEmpty || table.hasPlaceholder) {
      // 如果是填写格，尝试找到对应的标签格
      const labelCell = table.filledBy 
        ? structure.tables.find(t => t.cellRef === table.filledBy)
        : null
      
      locations.push({
        type: 'table-cell',
        cellRef: table.cellRef,
        context: labelCell ? `${labelCell.text} → ${table.cellRef}` : table.text,
      })
    }
  }

  // 2. 书签
  for (const bookmark of structure.bookmarks) {
    locations.push({
      type: 'bookmark',
      bookmarkName: bookmark.name,
      paragraphIndex: bookmark.paragraphIndex,
      context: bookmark.text,
    })
  }

  // 3. 窗体控件
  for (const formField of structure.formFields) {
    locations.push({
      type: 'form-field',
      fieldName: formField.name,
      paragraphIndex: formField.paragraphIndex,
    })
  }

  // 4. 占位符
  for (const placeholder of structure.placeholders) {
    locations.push({
      type: 'placeholder',
      paragraphIndex: placeholder.paragraphIndex,
      charOffset: placeholder.charOffset,
      context: placeholder.context,
    })
  }

  // 5. 带下划线的段落（可能是填写区域）
  for (const paragraph of structure.paragraphs) {
    if (paragraph.hasUnderline && paragraph.text.length < 100) {
      locations.push({
        type: 'paragraph',
        paragraphIndex: paragraph.index,
        context: paragraph.text,
      })
    }
  }

  return locations
}
