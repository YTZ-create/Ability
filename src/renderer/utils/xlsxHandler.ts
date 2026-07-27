import PizZip from 'pizzip'
import type { FormField } from '../agents/formFiller'

/**
 * Excel 填写方法类型
 */
export type ExcelFillMethod = 'excel-com' | 'xml-direct'

/**
 * 单元格位置信息
 */
interface CellInfo {
  ref: string // 如 "A1", "B2"
  value: string
  type: 's' | 'str' | 'n' | 'b' | 'inlineStr' // shared string, string, number, boolean, inline string
  formula?: string // 公式内容（如果有）
  style?: string // 样式索引
}

/**
 * 合并单元格信息
 */
interface MergedCellInfo {
  ref: string // 合并区域引用，如 "A1:C3"
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

/**
 * 数据验证信息
 */
interface DataValidationInfo {
  ref: string // 应用的单元格区域
  type: string // 验证类型：list, whole, decimal, date, textLength 等
  formula1?: string // 验证公式1
  formula2?: string // 验证公式2
  allowBlank?: boolean
  showDropDown?: boolean
  showErrorMessage?: boolean
  errorTitle?: string
  error?: string
}

/**
 * 从 Excel XML 中提取单元格信息
 */
function extractCellsFromSheet(sheetXml: string): CellInfo[] {
  const cells: CellInfo[] = []
  // 增强：同时提取公式和样式信息
  const cellRegex = /<c\s+r="([^"]+)"([^>]*)>(?:<f>([^<]*)<\/f>)?(?:<v>([^<]*)<\/v>)?/g
  let match

  while ((match = cellRegex.exec(sheetXml)) !== null) {
    const ref = match[1]
    const attrs = match[2]
    const formula = match[3] || ''
    const value = match[4] || ''

    // 提取类型属性
    const typeMatch = attrs.match(/t="([^"]+)"/)
    const type = typeMatch ? typeMatch[1] as CellInfo['type'] : 'n'

    // 提取样式索引
    const styleMatch = attrs.match(/s="([^"]+)"/)
    const style = styleMatch ? styleMatch[1] : undefined

    cells.push({ ref, value, type, formula: formula || undefined, style })
  }

  return cells
}

/**
 * 从工作表 XML 中提取合并单元格信息
 */
function extractMergedCells(sheetXml: string): MergedCellInfo[] {
  const mergedCells: MergedCellInfo[] = []
  const mergeCellRegex = /<mergeCell\s+ref="([^"]+)"[^>]*\/>/g
  let match

  while ((match = mergeCellRegex.exec(sheetXml)) !== null) {
    const ref = match[1]
    // 解析合并区域，如 "A1:C3"
    const rangeMatch = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
    if (rangeMatch) {
      const startCol = columnLetterToNumber(rangeMatch[1])
      const startRow = parseInt(rangeMatch[2], 10)
      const endCol = columnLetterToNumber(rangeMatch[3])
      const endRow = parseInt(rangeMatch[4], 10)

      mergedCells.push({ ref, startRow, startCol, endRow, endCol })
    }
  }

  console.log(`[xlsxHandler] Found ${mergedCells.length} merged cell(s)`)
  return mergedCells
}

/**
 * 从工作表 XML 中提取数据验证信息
 */
function extractDataValidations(sheetXml: string): DataValidationInfo[] {
  const validations: DataValidationInfo[] = []
  const dataValidationRegex = /<dataValidation\s+([^>]*)>(?:<formula1>([^<]*)<\/formula1>)?(?:<formula2>([^<]*)<\/formula2>)?<\/dataValidation>/g
  let match

  while ((match = dataValidationRegex.exec(sheetXml)) !== null) {
    const attrs = match[1]
    const formula1 = match[2] || ''
    const formula2 = match[3] || ''

    // 提取属性
    const typeMatch = attrs.match(/type="([^"]+)"/)
    const refMatch = attrs.match(/sqref="([^"]+)"/)
    const allowBlankMatch = attrs.match(/allowBlank="([^"]+)"/)
    const showDropDownMatch = attrs.match(/showDropDown="([^"]+)"/)
    const showErrorMessageMatch = attrs.match(/showErrorMessage="([^"]+)"/)
    const errorTitleMatch = attrs.match(/errorTitle="([^"]+)"/)
    const errorMatch = attrs.match(/error="([^"]+)"/)

    if (refMatch) {
      validations.push({
        ref: refMatch[1],
        type: typeMatch ? typeMatch[1] : 'none',
        formula1: formula1 || undefined,
        formula2: formula2 || undefined,
        allowBlank: allowBlankMatch ? allowBlankMatch[1] === '1' : undefined,
        showDropDown: showDropDownMatch ? showDropDownMatch[1] === '1' : undefined,
        showErrorMessage: showErrorMessageMatch ? showErrorMessageMatch[1] === '1' : undefined,
        errorTitle: errorTitleMatch ? errorTitleMatch[1] : undefined,
        error: errorMatch ? errorMatch[1] : undefined,
      })
    }
  }

  console.log(`[xlsxHandler] Found ${validations.length} data validation(s)`)
  return validations
}

/**
 * 检查单元格是否在合并区域内（但不是首格）
 */
function isNonFirstMergedCell(ref: string, mergedCells: MergedCellInfo[]): boolean {
  try {
    const { col, row } = parseCellRef(ref)
    for (const merged of mergedCells) {
      // 检查是否在合并区域内
      if (row >= merged.startRow && row <= merged.endRow &&
          col >= merged.startCol && col <= merged.endCol) {
        // 检查是否不是首格（首格是合并区域的左上角）
        if (row !== merged.startRow || col !== merged.startCol) {
          return true
        }
      }
    }
  } catch (e) {
    // 解析失败，保守处理
  }
  return false
}

/**
 * 检查单元格是否有数据验证（下拉列表等）
 */
function getCellDataValidation(ref: string, validations: DataValidationInfo[]): DataValidationInfo | null {
  for (const validation of validations) {
    // 简单检查：如果验证区域的引用包含此单元格
    // 更精确的检查需要解析区域引用（如 "A1:A10"）
    if (validation.ref === ref || validation.ref.includes(ref)) {
      return validation
    }
  }
  return null
}

/**
 * 解析 sharedStrings.xml 获取字符串映射
 */
function parseSharedStrings(sharedStringsXml: string): string[] {
  const strings: string[] = []
  const siRegex = /<si>([\s\S]*?)<\/si>/g
  let match

  while ((match = siRegex.exec(sharedStringsXml)) !== null) {
    const siContent = match[1]
    // 提取所有 <t> 标签的内容
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
 * 将列字母转换为数字（A=1, B=2, ..., Z=26, AA=27, ...）
 */
function columnLetterToNumber(letter: string): number {
  let num = 0
  for (let i = 0; i < letter.length; i++) {
    num = num * 26 + (letter.charCodeAt(i) - 64)
  }
  return num
}

/**
 * 将数字转换为列字母（1=A, 2=B, ..., 26=Z, 27=AA, ...）
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
 * 解析单元格引用（如 "A1"）为列号和行号
 */
function parseCellRef(ref: string): { col: number; row: number } {
  const match = ref.match(/^([A-Z]+)(\d+)$/)
  if (!match) throw new Error(`Invalid cell reference: ${ref}`)

  const col = columnLetterToNumber(match[1])
  const row = parseInt(match[2], 10)

  return { col, row }
}

/**
 * 转义 XML 特殊字符
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 使用 XML 直接操作填写 Excel 文件
 * 通过修改 sharedStrings.xml 和 sheet XML 实现
 */
export async function fillXlsxWithXml(
  rawContent: ArrayBuffer | string,
  fields: FormField[]
): Promise<string> {
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

  // 读取 sharedStrings.xml
  const sharedStringsEntry = zip.file('xl/sharedStrings.xml')
  const sharedStrings = sharedStringsEntry ? parseSharedStrings(sharedStringsEntry.asText()) : []

  // 读取工作簿以获取工作表映射
  const workbookEntry = zip.file('xl/workbook.xml')
  if (!workbookEntry) {
    throw new Error('无法读取 workbook.xml')
  }

  // 查找所有工作表文件
  const sheetFiles = zip.file(/xl\/worksheets\/sheet\d+\.xml/)
  if (!sheetFiles || sheetFiles.length === 0) {
    throw new Error('无法找到工作表文件')
  }

  console.log(`[xlsxHandler][XML] Found ${sheetFiles.length} sheet(s)`)

  // 构建字段映射：label -> value
  const fieldMap = new Map<string, string>()
  for (const field of fields) {
    if (field.value) {
      fieldMap.set(field.label, field.value)
    }
  }

  // 处理每个工作表
  for (const sheetFile of sheetFiles) {
    let sheetXml = sheetFile.asText()
    const cells = extractCellsFromSheet(sheetXml)
    
    // 提取合并单元格和数据验证信息
    const mergedCells = extractMergedCells(sheetXml)
    const dataValidations = extractDataValidations(sheetXml)

    console.log(`[xlsxHandler][XML] Processing sheet: ${sheetFile.name}, found ${cells.length} cells, ${mergedCells.length} merged, ${dataValidations.length} validations`)

    // 查找标签单元格并填写值
    for (const cell of cells) {
      // 获取单元格文本
      let cellText = ''
      if (cell.type === 's') {
        // shared string
        const idx = parseInt(cell.value, 10)
        if (idx < sharedStrings.length) {
          cellText = sharedStrings[idx]
        }
      } else if (cell.type === 'inlineStr') {
        // inline string - 需要从 XML 中提取
        const inlineMatch = sheetXml.match(new RegExp(`<c[^>]*r="${cell.ref}"[^>]*>.*?<t[^>]*>([^<]*)<\/t>.*?<\\/c>`, 's'))
        if (inlineMatch) {
          cellText = inlineMatch[1]
        }
      } else {
        cellText = cell.value
      }

      // 检查是否是标签
      const value = fieldMap.get(cellText)
      if (value !== undefined) {
        console.log(`[xlsxHandler][XML] Found label "${cellText}" at ${cell.ref}, filling with "${value}"`)

        // 填写右侧单元格
        let targetRef: string
        try {
          const { col, row } = parseCellRef(cell.ref)
          const targetCol = col + 1
          targetRef = `${columnNumberToLetter(targetCol)}${row}`
        } catch (parseErr) {
          console.warn(`[xlsxHandler][XML] Invalid cell reference: ${cell.ref}, skipping`)
          continue
        }

        // 检查目标单元格是否是合并区域的非首格（不能写入）
        if (isNonFirstMergedCell(targetRef, mergedCells)) {
          console.warn(`[xlsxHandler][XML] Target ${targetRef} is non-first merged cell, skipping`)
          continue
        }

        // 检查目标单元格是否有数据验证（下拉列表等）
        const validation = getCellDataValidation(targetRef, dataValidations)
        if (validation && validation.type === 'list') {
          // 验证值是否在可选项中
          const listFormula = validation.formula1 || ''
          console.log(`[xlsxHandler][XML] Target ${targetRef} has list validation: ${listFormula}`)
          // 注意：这里只是记录日志，实际填写仍然进行，但会提示用户
        }

        // 检查目标单元格是否是公式单元格（保留公式，只更新引用数据）
        const targetCellRegex = new RegExp(`<c\\s+r="${targetRef}"([^>]*)>(?:<f>([^<]*)<\\/f>)?(?:<v>([^<]*)<\\/v>)?<\\/c>`, 's')
        const targetMatch = sheetXml.match(targetCellRegex)
        
        if (targetMatch) {
          const existingFormula = targetMatch[2] || ''
          const existingStyle = targetMatch[1]?.match(/s="([^"]+)"/)?.[1] || ''
          
          if (existingFormula) {
            // 目标单元格有公式，保留公式但更新计算值
            console.log(`[xlsxHandler][XML] Target ${targetRef} has formula "${existingFormula}", preserving formula and updating value`)
            const styleAttr = existingStyle ? ` s="${existingStyle}"` : ''
            sheetXml = sheetXml.replace(
              targetCellRegex,
              `<c r="${targetRef}"${styleAttr}><f>${existingFormula}</f><v>${escapeXml(value)}</v></c>`
            )
          } else {
            // 目标单元格没有公式，直接更新值
            // 添加新字符串到 sharedStrings
            const newIdx = sharedStrings.length
            sharedStrings.push(value)
            
            const styleAttr = existingStyle ? ` s="${existingStyle}"` : ''
            sheetXml = sheetXml.replace(
              targetCellRegex,
              `<c r="${targetRef}"${styleAttr} t="s"><v>${newIdx}</v></c>`
            )
          }
        } else {
          // 单元格不存在，在合适位置插入
          const newIdx = sharedStrings.length
          sharedStrings.push(value)
          
          // 简单策略：在 </sheetData> 前插入
          sheetXml = sheetXml.replace(
            '</sheetData>',
            `<c r="${targetRef}" t="s"><v>${newIdx}</v></c></sheetData>`
          )
        }

        console.log(`[xlsxHandler][XML] ✓ Filled ${targetRef} with "${value}"`)
      }
    }

    // 更新工作表 XML
    zip.file(sheetFile.name, sheetXml)
  }

  // 更新 sharedStrings.xml
  if (sharedStringsEntry) {
    let newSharedStringsXml = sharedStringsEntry.asText()

    // 重建 sharedStrings 内容
    const siEntries = sharedStrings.map(s => `<si><t>${escapeXml(s)}</t></si>`).join('')
    newSharedStringsXml = newSharedStringsXml.replace(
      /<sst([^>]*)>[\s\S]*<\/sst>/,
      `<sst$1>${siEntries}</sst>`
    )

    // 更新 count 和 uniqueCount 属性
    // uniqueCount: 不重复字符串的数量
    // count: 所有单元格对共享字符串的总引用次数
    const uniqueCount = sharedStrings.length
    
    // 统计实际的引用次数：遍历所有工作表，统计 type='s' 的单元格数量
    let totalCount = 0
    for (const sheetFile of sheetFiles) {
      const sheetXml = zip.file(sheetFile.name)?.asText() || ''
      const cells = extractCellsFromSheet(sheetXml)
      totalCount += cells.filter(c => c.type === 's').length
    }
    
    newSharedStringsXml = newSharedStringsXml.replace(
      /uniqueCount="\d+"/,
      `uniqueCount="${uniqueCount}"`
    )
    newSharedStringsXml = newSharedStringsXml.replace(
      /count="\d+"/,
      `count="${totalCount}"`
    )

    zip.file('xl/sharedStrings.xml', newSharedStringsXml)
  }

  // 创建全新的 zip 实例，逐个复制文件（避免直接修改原实例导致文件损坏）
  const newZip = new PizZip()
  const allFiles = zip.file(/.*/)
  for (const zipEntry of allFiles) {
    if (!zipEntry.dir) {
      newZip.file(zipEntry.name, zipEntry.asBinary())
    }
  }

  const blob = newZip.generate({ type: 'uint8array' })
  console.log(`[xlsxHandler][XML] Generated blob, size: ${blob.length} bytes`)

  let binary = ''
  for (let i = 0; i < blob.length; i++) {
    binary += String.fromCharCode(blob[i])
  }
  return btoa(binary)
}

/**
 * 使用 Excel COM 自动化填写 .xlsx 文件
 * 通过 PowerShell 调用 Excel.Application COM 对象
 */
export async function fillXlsxWithExcelCOM(
  filePath: string,
  fields: FormField[],
  execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  readFile: (path: string) => Promise<{ content: ArrayBuffer | null; error: string | null; size: number }>
): Promise<string> {
  const fieldsWithValue = fields.filter(f => f.value)
  console.log(`[xlsxHandler][ExcelCOM] Filling ${fieldsWithValue.length} fields via Excel COM`)

  // 构建 PowerShell 脚本
  const psCommands: string[] = []

  // 复制原文件为新文件
  const newFilePath = filePath.replace(/\.([^.]+)$/, '_filled.$1')
  psCommands.push(`Copy-Item -LiteralPath '${escapePsString(filePath)}' -Destination '${escapePsString(newFilePath)}' -Force`)

  // 创建 Excel COM 对象
  psCommands.push('$excel = New-Object -ComObject Excel.Application')
  psCommands.push('$excel.Visible = $false')
  psCommands.push('$excel.DisplayAlerts = $false')

  // 打开工作簿
  psCommands.push(`$workbook = $excel.Workbooks.Open('${escapePsString(newFilePath)}')`)

  // 对每个字段，只在第一个工作表中查找并填写（避免多工作表重复修改）
  psCommands.push('$sheet = $workbook.Sheets.Item(1)')
  psCommands.push('$usedRange = $sheet.UsedRange')

  for (const field of fieldsWithValue) {
    const label = field.label
    const value = field.value

    console.log(`[xlsxHandler][ExcelCOM] Processing field: "${label}" = "${value}"`)

    psCommands.push(`
# 查找标签 "${label}"
$found = $usedRange.Find('${escapePsString(label)}')
if ($found) {
  # 在右侧单元格填写值
  $targetCell = $found.Offset(0, 1)
  $targetCell.Value2 = '${escapePsString(value)}'
  Write-Host "Filled: ${escapePsString(label)} = ${escapePsString(value)} at $($found.Address)"
} else {
  Write-Host "Not found: ${escapePsString(label)}"
}
`)
  }

  // 保存并关闭
  psCommands.push('$workbook.Save()')
  psCommands.push('$workbook.Close()')
  psCommands.push('$excel.Quit()')
  psCommands.push('[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null')
  psCommands.push(`Write-Host "DONE:${newFilePath}"`)

  const fullScript = psCommands.join('\n')

  // 使用 EncodedCommand 避免引号转义问题（PowerShell 需要 UTF-16LE 编码）
  const utf16Bytes = new Uint8Array(fullScript.length * 2)
  for (let i = 0; i < fullScript.length; i++) {
    const code = fullScript.charCodeAt(i)
    utf16Bytes[i * 2] = code & 0xff
    utf16Bytes[i * 2 + 1] = (code >> 8) & 0xff
  }
  let binary = ''
  for (let i = 0; i < utf16Bytes.length; i++) {
    binary += String.fromCharCode(utf16Bytes[i])
  }
  const scriptBase64 = btoa(binary)
  const psCommand = `powershell -ExecutionPolicy Bypass -EncodedCommand ${scriptBase64}`

  console.log('[xlsxHandler][ExcelCOM] Executing PowerShell script...')
  const result = await execCommand(psCommand)

  console.log('[xlsxHandler][ExcelCOM] stdout:', result.stdout)
  if (result.stderr) {
    console.warn('[xlsxHandler][ExcelCOM] stderr:', result.stderr)
  }

  if (result.exitCode !== 0) {
    throw new Error(`Excel COM 填写失败 (exit code ${result.exitCode}): ${result.stderr}`)
  }

  // 读取生成的文件
  const { content, error } = await readFile(newFilePath)
  if (error || !content) {
    throw new Error(`无法读取填写后的文件: ${error}`)
  }

  const bytes = new Uint8Array(content)
  let resultBinary = ''
  for (let i = 0; i < bytes.length; i++) {
    resultBinary += String.fromCharCode(bytes[i])
  }
  return btoa(resultBinary)
}

function escapePsString(str: string): string {
  return str.replace(/'/g, "''")
}
