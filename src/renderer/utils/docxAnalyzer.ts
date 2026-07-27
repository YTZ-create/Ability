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

  const structure: DocxStructure = {
    paragraphs: extractParagraphs(docXml),
    tables: extractTables(docXml),
    bookmarks: extractBookmarks(docXml),
    formFields: extractFormFields(docXml),
    placeholders: extractPlaceholders(docXml),
    headers: extractHeadersFooters(zip, 'header'),
    footers: extractHeadersFooters(zip, 'footer'),
    textBoxes: extractTextBoxes(docXml),
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

  return structure
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

        // 检查是否为空
        const isEmpty = text.trim() === ''

        // 检查是否包含标签（冒号结尾）
        const hasLabel = /[：:]$/.test(text.trim())

        // 检查是否包含占位符
        const hasPlaceholder = /[＿_]{3,}|【[^】]+】|\{[^}]+\}/.test(text)

        tables.push({
          rowIndex,
          colIndex,
          cellRef: `R${rowIndex + 1}C${colIndex + 1}`,
          text,
          isMerged,
          isEmpty,
          hasLabel,
          hasPlaceholder,
        })

        colIndex++
      }
      rowIndex++
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
 * 提取占位符信息
 */
function extractPlaceholders(docXml: string): PlaceholderInfo[] {
  const placeholders: PlaceholderInfo[] = []
  
  // 提取所有文本节点
  const textNodeRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g
  let match

  while ((match = textNodeRegex.exec(docXml)) !== null) {
    const text = match[1]
    const position = match.index

    // 查找下划线占位符 ____
    const underlineRegex = /([＿_]{3,})/g
    let underlineMatch
    while ((underlineMatch = underlineRegex.exec(text)) !== null) {
      const placeholderText = underlineMatch[1]
      const charOffset = position + underlineMatch.index

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

  // 1. 表格中的空白单元格或占位符单元格
  for (const table of structure.tables) {
    if (table.isEmpty || table.hasPlaceholder) {
      locations.push({
        type: 'table-cell',
        cellRef: table.cellRef,
        context: table.text,
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
