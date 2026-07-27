import PizZip from 'pizzip'

/**
 * Excel 文档结构分析器
 * 深度解析 .xlsx 文件的结构信息，包括：
 * - 工作表结构
 * - 表头位置识别
 * - 合并单元格
 * - 空白待填单元格
 * - 公式单元格
 * - 数据验证规则（下拉选项）
 * - 条件格式
 * - 单元格样式（字体、对齐、边框等）
 */

export interface XlsxStructure {
  sheets: SheetInfo[]
  mergedCells: MergedCellInfo[]
  dataValidations: DataValidationInfo[]
  formulas: FormulaInfo[]
  conditionalFormats: ConditionalFormatInfo[]
}

export interface SheetInfo {
  name: string
  index: number
  rowCount: number
  colCount: number
  headers: HeaderInfo[]
  emptyCells: EmptyCellInfo[]
  dataRows: number
}

export interface HeaderInfo {
  cellRef: string  // 如 "A1", "B1"
  text: string
  colIndex: number
  rowIndex: number
  isMerged: boolean
  mergeOrigin?: string
  style?: CellStyle
}

export interface EmptyCellInfo {
  cellRef: string
  rowIndex: number
  colIndex: number
  headerLabel?: string  // 对应的表头标签
  hasDataValidation: boolean  // 是否有数据验证（下拉选项）
  validationOptions?: string[]  // 下拉选项列表
}

export interface MergedCellInfo {
  origin: string  // 合并区域的起始单元格，如 "A1"
  range: string  // 合并范围，如 "A1:C3"
  startRow: number
  startCol: number
  endRow: number
  endCol: number
  text: string  // 合并单元格的文本
}

export interface DataValidationInfo {
  cellRef: string
  type: 'list' | 'whole' | 'decimal' | 'date' | 'textLength' | 'custom'
  formula1?: string  // 验证公式或选项列表
  formula2?: string  // 第二个验证公式
  allowBlank: boolean
  showDropDown: boolean
  promptTitle?: string
  promptMessage?: string
  errorTitle?: string
  errorMessage?: string
}

export interface FormulaInfo {
  cellRef: string
  formula: string
  calculatedValue?: string
  rowIndex: number
  colIndex: number
}

export interface ConditionalFormatInfo {
  range: string
  type: string
  priority: number
  formula?: string
}

export interface CellStyle {
  font?: {
    name?: string
    size?: number
    bold?: boolean
    italic?: boolean
    color?: string
  }
  alignment?: {
    horizontal?: 'left' | 'center' | 'right' | 'fill' | 'justify'
    vertical?: 'top' | 'center' | 'bottom'
    wrapText?: boolean
  }
  fill?: {
    patternType?: string
    fgColor?: string
    bgColor?: string
  }
  border?: {
    left?: string
    right?: string
    top?: string
    bottom?: string
  }
  numberFormat?: string
}

interface CellInfo {
  ref: string
  value: string
  type: 's' | 'str' | 'n' | 'b' | 'inlineStr' | 'e'
  formula?: string
  styleIndex?: number
  rowIndex: number
  colIndex: number
}

/**
 * 分析 Excel 文档结构
 */
export function analyzeXlsxStructure(rawContent: ArrayBuffer | string): XlsxStructure {
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

  console.log('[xlsxAnalyzer] Starting document structure analysis...')

  // 解析共享字符串
  const sharedStrings = parseSharedStrings(zip)
  
  // 解析样式表
  const styles = parseStyles(zip)

  // 解析工作簿
  const workbook = parseWorkbook(zip)

  // 解析每个工作表
  const sheets = parseSheets(zip, sharedStrings, styles)

  // 解析合并单元格
  const mergedCells = parseMergedCells(zip)

  // 解析数据验证
  const dataValidations = parseDataValidations(zip)

  // 解析公式
  const formulas = parseFormulas(zip, sharedStrings)

  // 解析条件格式
  const conditionalFormats = parseConditionalFormats(zip)

  const structure: XlsxStructure = {
    sheets,
    mergedCells,
    dataValidations,
    formulas,
    conditionalFormats,
  }

  console.log('[xlsxAnalyzer] Analysis complete:')
  console.log(`  - Sheets: ${structure.sheets.length}`)
  console.log(`  - Merged Cells: ${structure.mergedCells.length}`)
  console.log(`  - Data Validations: ${structure.dataValidations.length}`)
  console.log(`  - Formulas: ${structure.formulas.length}`)
  console.log(`  - Conditional Formats: ${structure.conditionalFormats.length}`)

  for (const sheet of structure.sheets) {
    console.log(`  - Sheet "${sheet.name}": ${sheet.rowCount} rows x ${sheet.colCount} cols, ${sheet.headers.length} headers, ${sheet.emptyCells.length} empty cells`)
  }

  return structure
}

/**
 * 解析共享字符串
 */
function parseSharedStrings(zip: PizZip): string[] {
  const strings: string[] = []
  const ssEntry = zip.file('xl/sharedStrings.xml')
  if (!ssEntry) return strings

  const ssXml = ssEntry.asText()
  const siRegex = /<si>([\s\S]*?)<\/si>/g
  let match

  while ((match = siRegex.exec(ssXml)) !== null) {
    const siContent = match[1]
    const tRegex = /<t[^>]*>([^<]*)<\/t>/g
    let text = ''
    let tMatch

    while ((tMatch = tRegex.exec(siContent)) !== null) {
      text += tMatch[1]
    }

    strings.push(text)
  }

  return strings
}

/**
 * 解析样式表
 */
function parseStyles(zip: PizZip): CellStyle[] {
  const styles: CellStyle[] = []
  const stylesEntry = zip.file('xl/styles.xml')
  if (!stylesEntry) return styles

  const stylesXml = stylesEntry.asText()
  
  // 简化处理：提取基本的样式信息
  // 完整实现需要解析 cellXfs、fonts、fills、borders 等
  
  const cellXfsMatch = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)
  if (!cellXfsMatch) return styles

  const cellXfsContent = cellXfsMatch[1]
  const xfRegex = /<xf\b[^>]*\/?>/g
  let match

  while ((match = xfRegex.exec(cellXfsContent)) !== null) {
    const xfXml = match[0]
    
    const style: CellStyle = {}

    // 提取数字格式
    const numFmtIdMatch = xfXml.match(/numFmtId="(\d+)"/)
    if (numFmtIdMatch) {
      style.numberFormat = numFmtIdMatch[1]
    }

    styles.push(style)
  }

  return styles
}

/**
 * 解析工作簿
 */
function parseWorkbook(zip: PizZip): { sheetNames: string[] } {
  const sheetNames: string[] = []
  const workbookEntry = zip.file('xl/workbook.xml')
  if (!workbookEntry) return { sheetNames }

  const workbookXml = workbookEntry.asText()
  const sheetRegex = /<sheet\s+name="([^"]+)"[^>]*\/?>/g
  let match

  while ((match = sheetRegex.exec(workbookXml)) !== null) {
    sheetNames.push(match[1])
  }

  return { sheetNames }
}

/**
 * 解析工作表
 */
function parseSheets(zip: PizZip, sharedStrings: string[], styles: CellStyle[]): SheetInfo[] {
  const sheets: SheetInfo[] = []
  
  const sheetFiles = zip.file(/xl\/worksheets\/sheet\d+\.xml/)
  if (!sheetFiles || sheetFiles.length === 0) return sheets

  const workbook = parseWorkbook(zip)

  for (let i = 0; i < sheetFiles.length; i++) {
    const sheetFile = sheetFiles[i]
    const sheetXml = sheetFile.asText()
    const sheetName = workbook.sheetNames[i] || `Sheet${i + 1}`

    // 提取所有单元格
    const cells = extractCells(sheetXml, sharedStrings)

    // 计算行列数
    let maxRow = 0
    let maxCol = 0
    for (const cell of cells) {
      maxRow = Math.max(maxRow, cell.rowIndex)
      maxCol = Math.max(maxCol, cell.colIndex)
    }

    // 识别表头（第一行）
    const headers: HeaderInfo[] = []
    const headerCells = cells.filter(c => c.rowIndex === 0)
    for (const cell of headerCells) {
      headers.push({
        cellRef: cell.ref,
        text: cell.value,
        colIndex: cell.colIndex,
        rowIndex: cell.rowIndex,
        isMerged: false,
        style: cell.styleIndex !== undefined ? styles[cell.styleIndex] : undefined,
      })
    }

    // 识别空白单元格（有表头但无数据）
    const emptyCells: EmptyCellInfo[] = []
    for (let row = 1; row <= maxRow; row++) {
      for (let col = 0; col <= maxCol; col++) {
        const cell = cells.find(c => c.rowIndex === row && c.colIndex === col)
        if (!cell || cell.value.trim() === '') {
          const headerLabel = headers.find(h => h.colIndex === col)?.text
          emptyCells.push({
            cellRef: `${columnNumberToLetter(col + 1)}${row + 1}`,
            rowIndex: row,
            colIndex: col,
            headerLabel,
            hasDataValidation: false,
          })
        }
      }
    }

    sheets.push({
      name: sheetName,
      index: i,
      rowCount: maxRow + 1,
      colCount: maxCol + 1,
      headers,
      emptyCells,
      dataRows: maxRow,
    })
  }

  return sheets
}

/**
 * 从工作表 XML 中提取单元格
 */
function extractCells(sheetXml: string, sharedStrings: string[]): CellInfo[] {
  const cells: CellInfo[] = []
  const cellRegex = /<c\s+r="([^"]+)"([^>]*)>(?:<f>([^<]*)<\/f>)?(?:<v>([^<]*)<\/v>)?/g
  let match

  while ((match = cellRegex.exec(sheetXml)) !== null) {
    const ref = match[1]
    const attrs = match[2]
    const formula = match[3]
    const rawValue = match[4] || ''

    // 解析类型属性
    const typeMatch = attrs.match(/t="([^"]+)"/)
    const type = typeMatch ? typeMatch[1] as CellInfo['type'] : 'n'

    // 解析样式索引
    const styleMatch = attrs.match(/s="(\d+)"/)
    const styleIndex = styleMatch ? parseInt(styleMatch[1], 10) : undefined

    // 解析行列号
    const { row, col } = parseCellRef(ref)

    // 获取单元格文本
    let value = ''
    if (type === 's') {
      const idx = parseInt(rawValue, 10)
      if (idx < sharedStrings.length) {
        value = sharedStrings[idx]
      }
    } else if (type === 'inlineStr') {
      value = rawValue
    } else {
      value = rawValue
    }

    cells.push({
      ref,
      value,
      type,
      formula,
      styleIndex,
      rowIndex: row - 1,
      colIndex: col - 1,
    })
  }

  return cells
}

/**
 * 解析合并单元格
 */
function parseMergedCells(zip: PizZip): MergedCellInfo[] {
  const mergedCells: MergedCellInfo[] = []
  
  const sheetFiles = zip.file(/xl\/worksheets\/sheet\d+\.xml/)
  if (!sheetFiles) return mergedCells

  for (const sheetFile of sheetFiles) {
    const sheetXml = sheetFile.asText()
    
    // 查找 <mergeCells> 节点
    const mergeCellsMatch = sheetXml.match(/<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/)
    if (!mergeCellsMatch) continue

    const mergeCellsContent = mergeCellsMatch[1]
    const mergeCellRegex = /<mergeCell\s+ref="([^"]+)"[^>]*\/?>/g
    let match

    while ((match = mergeCellRegex.exec(mergeCellsContent)) !== null) {
      const range = match[1]
      const [startRef, endRef] = range.split(':')
      
      if (!startRef || !endRef) continue

      const start = parseCellRef(startRef)
      const end = parseCellRef(endRef)

      mergedCells.push({
        origin: startRef,
        range,
        startRow: start.row,
        startCol: start.col,
        endRow: end.row,
        endCol: end.col,
        text: '',  // 需要从单元格中提取
      })
    }
  }

  return mergedCells
}

/**
 * 解析数据验证
 */
function parseDataValidations(zip: PizZip): DataValidationInfo[] {
  const validations: DataValidationInfo[] = []
  
  const sheetFiles = zip.file(/xl\/worksheets\/sheet\d+\.xml/)
  if (!sheetFiles) return validations

  for (const sheetFile of sheetFiles) {
    const sheetXml = sheetFile.asText()
    
    // 查找 <dataValidations> 节点
    const dataValidationsMatch = sheetXml.match(/<dataValidations[^>]*>([\s\S]*?)<\/dataValidations>/)
    if (!dataValidationsMatch) continue

    const dataValidationsContent = dataValidationsMatch[1]
    const validationRegex = /<dataValidation\b[^>]*>([\s\S]*?)<\/dataValidation>/g
    let match

    while ((match = validationRegex.exec(dataValidationsContent)) !== null) {
      const validationXml = match[0]
      const content = match[1]

      // 提取属性
      const typeMatch = validationXml.match(/type="([^"]+)"/)
      const type = typeMatch ? typeMatch[1] as DataValidationInfo['type'] : 'list'

      const allowBlankMatch = validationXml.match(/allowBlank="(\d+)"/)
      const allowBlank = allowBlankMatch ? allowBlankMatch[1] === '1' : false

      const showDropDownMatch = validationXml.match(/showDropDown="(\d+)"/)
      const showDropDown = showDropDownMatch ? showDropDownMatch[1] === '1' : false

      const sqrefMatch = validationXml.match(/sqref="([^"]+)"/)
      const cellRef = sqrefMatch ? sqrefMatch[1] : ''

      // 提取公式
      const formula1Match = content.match(/<formula1>([^<]+)<\/formula1>/)
      const formula1 = formula1Match ? formula1Match[1] : undefined

      const formula2Match = content.match(/<formula2>([^<]+)<\/formula2>/)
      const formula2 = formula2Match ? formula2Match[1] : undefined

      // 提取提示信息
      const promptTitleMatch = validationXml.match(/promptTitle="([^"]+)"/)
      const promptTitle = promptTitleMatch ? promptTitleMatch[1] : undefined

      const promptMessageMatch = validationXml.match(/prompt="([^"]+)"/)
      const promptMessage = promptMessageMatch ? promptMessageMatch[1] : undefined

      validations.push({
        cellRef,
        type,
        formula1,
        formula2,
        allowBlank,
        showDropDown,
        promptTitle,
        promptMessage,
      })
    }
  }

  return validations
}

/**
 * 解析公式
 */
function parseFormulas(zip: PizZip, sharedStrings: string[]): FormulaInfo[] {
  const formulas: FormulaInfo[] = []
  
  const sheetFiles = zip.file(/xl\/worksheets\/sheet\d+\.xml/)
  if (!sheetFiles) return formulas

  for (const sheetFile of sheetFiles) {
    const sheetXml = sheetFile.asText()
    const cells = extractCells(sheetXml, sharedStrings)

    for (const cell of cells) {
      if (cell.formula) {
        formulas.push({
          cellRef: cell.ref,
          formula: cell.formula,
          calculatedValue: cell.value,
          rowIndex: cell.rowIndex,
          colIndex: cell.colIndex,
        })
      }
    }
  }

  return formulas
}

/**
 * 解析条件格式
 */
function parseConditionalFormats(zip: PizZip): ConditionalFormatInfo[] {
  const formats: ConditionalFormatInfo[] = []
  
  const sheetFiles = zip.file(/xl\/worksheets\/sheet\d+\.xml/)
  if (!sheetFiles) return formats

  for (const sheetFile of sheetFiles) {
    const sheetXml = sheetFile.asText()
    
    // 查找 <conditionalFormatting> 节点
    const cfRegex = /<conditionalFormatting\s+sqref="([^"]+)"[^>]*>([\s\S]*?)<\/conditionalFormatting>/g
    let match

    while ((match = cfRegex.exec(sheetXml)) !== null) {
      const range = match[1]
      const content = match[2]

      // 提取规则
      const cfRuleRegex = /<cfRule\b[^>]*\/?>/g
      let ruleMatch
      let priority = 0

      while ((ruleMatch = cfRuleRegex.exec(content)) !== null) {
        const ruleXml = ruleMatch[0]
        
        const typeMatch = ruleXml.match(/type="([^"]+)"/)
        const type = typeMatch ? typeMatch[1] : 'expression'

        const priorityMatch = ruleXml.match(/priority="(\d+)"/)
        priority = priorityMatch ? parseInt(priorityMatch[1], 10) : ++priority

        const formulaMatch = ruleXml.match(/<formula>([^<]+)<\/formula>/)
        const formula = formulaMatch ? formulaMatch[1] : undefined

        formats.push({
          range,
          type,
          priority,
          formula,
        })
      }
    }
  }

  return formats
}

/**
 * 解析单元格引用
 */
function parseCellRef(ref: string): { row: number; col: number } {
  const match = ref.match(/^([A-Z]+)(\d+)$/)
  if (!match) throw new Error(`Invalid cell reference: ${ref}`)

  const col = columnLetterToNumber(match[1])
  const row = parseInt(match[2], 10)

  return { row, col }
}

/**
 * 列字母转数字
 */
function columnLetterToNumber(letter: string): number {
  let num = 0
  for (let i = 0; i < letter.length; i++) {
    num = num * 26 + (letter.charCodeAt(i) - 64)
  }
  return num
}

/**
 * 数字转列字母
 */
function columnNumberToLetter(num: number): string {
  let letter = ''
  while (num > 0) {
    const remainder = (num - 1) % 26
    letter = String.fromCharCode(65 + remainder) + letter
    num = Math.floor((num - 1) / 26)
  }
  return letter
}

/**
 * 从 Excel 结构中提取待填写字段的候选位置
 */
export function extractFillableLocations(structure: XlsxStructure): Array<{
  type: 'cell'
  cellRef: string
  headerLabel?: string
  hasDataValidation: boolean
  validationOptions?: string[]
}> {
  const locations: Array<{
    type: 'cell'
    cellRef: string
    headerLabel?: string
    hasDataValidation: boolean
    validationOptions?: string[]
  }> = []

  // 遍历所有工作表的空白单元格
  for (const sheet of structure.sheets) {
    for (const emptyCell of sheet.emptyCells) {
      // 检查是否有数据验证
      const validation = structure.dataValidations.find(v => v.cellRef === emptyCell.cellRef)
      
      let validationOptions: string[] | undefined
      if (validation && validation.type === 'list' && validation.formula1) {
        // 解析下拉选项（可能是 "选项1,选项2,选项3" 或 "=$A$1:$A$10"）
        if (validation.formula1.startsWith('"') && validation.formula1.endsWith('"')) {
          validationOptions = validation.formula1.slice(1, -1).split(',')
        }
      }

      locations.push({
        type: 'cell',
        cellRef: emptyCell.cellRef,
        headerLabel: emptyCell.headerLabel,
        hasDataValidation: !!validation,
        validationOptions,
      })
    }
  }

  return locations
}
