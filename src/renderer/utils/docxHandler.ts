import PizZip from 'pizzip'
import type { FormField } from '../agents/formFiller'

/**
 * 填写方法类型
 */
export type FillMethod = 'word-com' | 'dom-parser' | 'regex'

/**
 * 文档结构信息（用于填写前后的结构校验）
 */
export interface DocxStructureInfo {
  paragraphCount: number
  tableCount: number
  cellCount: number
}

/**
 * 从 XML 中提取所有 <w:t> 文本节点的内容和位置信息
 */
interface TextNodeInfo {
  text: string
  xmlStart: number
  xmlEnd: number
  tOpenTag: string
  content: string
}

function extractTextNodes(xml: string): TextNodeInfo[] {
  if (!xml) return []
  const nodes: TextNodeInfo[] = []
  // 修复：同时匹配普通标签 <w:t>...</w:t> 和自闭合标签 <w:t/>
  const regex = /<w:t([^>]*)(?:\/>|>([\s\S]*?)<\/w:t>)/g
  let match
  while ((match = regex.exec(xml)) !== null) {
    const attrs = match[1] || ''
    const content = match[2] || ''  // 自闭合标签内容为空
    const tOpenTag = `<w:t${attrs}>`
    nodes.push({
      text: content,
      xmlStart: match.index,
      xmlEnd: match.index + match[0].length,
      tOpenTag,
      content,
    })
  }
  return nodes
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 在表格文档中，找到 label 所在单元格的右侧相邻单元格中的第一个文本节点
 * 用于 anchorText 匹配失败时的降级策略
 */
function findRightAdjacentCellNode(xml: string, textNodes: TextNodeInfo[], labelNodeIdx: number): { nodeIdx: number; node: TextNodeInfo } | null {
  if (labelNodeIdx < 0 || labelNodeIdx >= textNodes.length) return null

  const labelNode = textNodes[labelNodeIdx]
  const labelXmlPos = labelNode.xmlStart

  // 找到 label 所在的 <w:tc> 单元格
  // 从 labelXmlPos 往前搜索最近的 <w:tc>
  let tcStart = xml.lastIndexOf('<w:tc>', labelXmlPos)
  let tcEnd = xml.indexOf('</w:tc>', labelXmlPos)
  if (tcStart < 0 || tcEnd < 0) return null

  // 找到下一个 <w:tc>（同行右侧单元格）
  const nextTcStart = xml.indexOf('<w:tc>', tcEnd)
  if (nextTcStart < 0) return null

  const nextTcEnd = xml.indexOf('</w:tc>', nextTcStart)
  if (nextTcEnd < 0) return null

  // 在右侧单元格中找第一个文本节点
  for (let i = 0; i < textNodes.length; i++) {
    if (textNodes[i].xmlStart > nextTcStart && textNodes[i].xmlEnd < nextTcEnd) {
      console.log(`[docxHandler][Smart] Found right-adjacent cell node ${i}: "${textNodes[i].content.substring(0, 80)}"`)
      return { nodeIdx: i, node: textNodes[i] }
    }
  }

  return null
}

// ============================================================
// 方案一：Word COM 自动化（Windows + PowerShell）
// ============================================================

/**
 * 使用 Word COM 自动化填写 .docx 文件
 * 通过 PowerShell 调用 Word.Application COM 对象，100% 保留原始格式
 * 仅支持 Windows 且安装了 Microsoft Word
 */
export async function fillDocxWithWordCOM(
  filePath: string,
  fields: FormField[],
  execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
): Promise<string> {
  const fieldsWithValue = fields.filter(f => f.value)
  console.log(`[docxHandler][WordCOM] Filling ${fieldsWithValue.length} fields via Word COM`)
  console.log(`[docxHandler][WordCOM] Fields with values:`, fieldsWithValue.map(f => `${f.label}=${f.value}`).join(', '))

  // 构建 PowerShell 脚本
  const psCommands: string[] = []

  // 复制原文件为新文件
  const newFilePath = filePath.replace(/\.([^.]+)$/, '_filled.$1')
  psCommands.push(`Copy-Item -LiteralPath '${escapePsString(filePath)}' -Destination '${escapePsString(newFilePath)}' -Force`)

  // 创建 Word COM 对象
  psCommands.push('$word = New-Object -ComObject Word.Application')
  psCommands.push('$word.Visible = $false')

  // 打开文档
  psCommands.push(`$doc = $word.Documents.Open('${escapePsString(newFilePath)}')`)

  // 对每个字段执行查找替换
  for (const field of fieldsWithValue) {
    const label = field.label
    const value = field.value

    console.log(`[docxHandler][WordCOM] Processing field: "${label}" = "${value}"`)

    // 策略：查找标签文本，在标签后插入值
    // 使用 Find 定位标签，找到后直接在找到的 Range 上操作
    psCommands.push(`
$range = $doc.Content
$range.Find.ClearFormatting()
$range.Find.Text = '${escapePsString(label)}'
$range.Find.Forward = $true
$range.Find.Wrap = 1
if ($range.Find.Execute()) {
  # 找到标签后，range 现在指向找到的文本
  # 使用 InsertAfter 在标签后插入值
  $range.InsertAfter('${escapePsString(value)}')
  Write-Host "Filled: ${escapePsString(label)} = ${escapePsString(value)}"
} else {
  Write-Host "Not found: ${escapePsString(label)}"
}
`)
  }

  // 保存并关闭
  psCommands.push('$doc.Save()')
  psCommands.push('$doc.Close()')
  psCommands.push('$word.Quit()')
  psCommands.push('[System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null')
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

  console.log('[docxHandler][WordCOM] Executing PowerShell script...')
  console.log('[docxHandler][WordCOM] Script length:', fullScript.length, 'chars')
  const result = await execCommand(psCommand)

  console.log('[docxHandler][WordCOM] stdout:', result.stdout)
  if (result.stderr) {
    console.warn('[docxHandler][WordCOM] stderr:', result.stderr)
  }
  console.log('[docxHandler][WordCOM] exitCode:', result.exitCode)

  if (result.exitCode !== 0) {
    throw new Error(`Word COM 填写失败 (exit code ${result.exitCode}): ${result.stderr}`)
  }

  console.log(`[docxHandler][WordCOM] Done! New file: ${newFilePath}`)
  return newFilePath
}

/**
 * 使用 Word COM 填写并返回 base64 内容
 * 先通过 COM 填写，再由调用方读取文件
 */
export async function fillDocxWithWordCOMBase64(
  filePath: string,
  fields: FormField[],
  execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
  readFile: (path: string) => Promise<{ content: ArrayBuffer | null; error: string | null; size: number }>
): Promise<string> {
  const newFilePath = await fillDocxWithWordCOM(filePath, fields, execCommand)

  // 等待文件系统同步（避免路径含中文时读取失败）
  await new Promise(r => setTimeout(r, 500))

  // 尝试读取生成的文件，最多重试 5 次
  let lastError: string | undefined
  for (let attempt = 0; attempt < 5; attempt++) {
    const { content, error } = await readFile(newFilePath)
    if (!error && content) {
      const bytes = new Uint8Array(content)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      return btoa(binary)
    }
    lastError = error || undefined
    console.warn(`[docxHandler][WordCOM] Read attempt ${attempt + 1}/5 failed:`, lastError)
    await new Promise(r => setTimeout(r, 500))
  }

  throw new Error(`无法读取填写后的文件: ${lastError}`)
}

function escapePsString(str: string): string {
  return str.replace(/'/g, "''")
}

// ============================================================
// 方案二：DOMParser XML 操作（简化版）
// ============================================================

/**
 * 使用 DOMParser 解析和修改 docx XML
 * 简化策略：直接查找标签文本并在其后插入值
 */
export async function fillDocxWithDOMParser(
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
  const docXml = zip.file('word/document.xml')?.asText()
  if (!docXml) {
    throw new Error('无法读取 document.xml')
  }

  let filledXml = docXml
  const fieldsWithValue = fields.filter(f => f.value)
  
  for (const field of fieldsWithValue) {
    const label = field.label
    const value = field.value
    const escapedValue = escapeXml(value)
    
    // 简化策略：查找标签并在其后插入值
    // 策略1：查找 "标签：" 或 "标签:" 模式
    const colonPattern = new RegExp(`(<w:t[^>]*>[^<]*${escapeXml(label)}[：:]?[^<]*</w:t>)`, 'g')
    if (colonPattern.test(filledXml)) {
      filledXml = filledXml.replace(colonPattern, `$1<w:t xml:space="preserve">${escapedValue}</w:t>`)
      continue
    }
    
    // 策略2：查找下划线占位符 "___" 或 "____"
    const underlinePattern = new RegExp(
      `(<w:t[^>]*>[^<]*${escapeXml(label)}[^<]*</w:t>[\\s\\S]*?<w:t[^>]*>)([＿_]+)(</w:t>)`,
      'g'
    )
    if (underlinePattern.test(filledXml)) {
      filledXml = filledXml.replace(underlinePattern, `$1${escapedValue}$3`)
      continue
    }
    
    // 策略3：直接在标签后追加
    const labelPattern = new RegExp(`(<w:t[^>]*>[^<]*${escapeXml(label)}[^<]*</w:t>)`, 'g')
    if (labelPattern.test(filledXml)) {
      filledXml = filledXml.replace(labelPattern, `$1<w:t xml:space="preserve">${escapedValue}</w:t>`)
    }
  }

  // 创建全新的 zip 实例
  const newZip = new PizZip()
  const allFiles = zip.file(/.*/)
  for (const zipEntry of allFiles) {
    if (!zipEntry.dir) {
      if (zipEntry.name === 'word/document.xml') {
        newZip.file(zipEntry.name, filledXml)
      } else {
        newZip.file(zipEntry.name, zipEntry.asBinary())
      }
    }
  }

  const blob = newZip.generate({ type: 'uint8array' })
  let binary = ''
  for (let i = 0; i < blob.length; i++) {
    binary += String.fromCharCode(blob[i])
  }
  return btoa(binary)
}

// ============================================================
// 方案三：统一智能填写引擎
// ============================================================

/**
 * 统一智能填写引擎
 * 多策略定位填写位置：下划线替换 > 冒号后插入 > 空节点填充 > 下划线格式节点 > 追加入标签
 * 不依赖特定占位符格式，兼容大多数真实 docx 文档
 */
export async function fillDocxFile(
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
  const docXml = zip.file('word/document.xml')?.asText()
  if (!docXml) {
    throw new Error('无法读取 document.xml')
  }

  const fieldsWithValue = fields.filter(f => f.value)
  console.log(`[docxHandler][Smart] Total fields: ${fields.length}, with value: ${fieldsWithValue.length}`)

  // 检测文档是否包含表格或类表格结构（用于 anchorText 策略保护）
  // 包括：表格 <w:tbl>、文本框 <w:txbxContent>、分栏等
  const hasTable = docXml.includes('<w:tbl>') || 
                   docXml.includes('<w:txbxContent>') || 
                   docXml.includes('<mc:AlternateContent')
  console.log(`[docxHandler][Smart] Document has table-like structure: ${hasTable}`)

  let filledXml = docXml
  let filledCount = 0

  // 提取填写前的文档结构信息（用于防错位校验）
  const structureBefore = extractDocxStructureInfo(filledXml)

  for (const field of fields) {
    if (!field.value) continue

    const label = field.label
    const value = field.value
    const escapedValue = escapeXml(value)

    console.log(`\n[docxHandler][Smart] === Processing: "${label}" = "${value}" ===`)

    // 每次循环重新提取文本节点，确保位置信息正确
    const textNodes = extractTextNodes(filledXml)

    let filled = false

    // ============================================================
    // 新策略：段落级 Run 合并替换（解决 Run 碎片化导致的下划线错位）
    // 优先级最高，因为它能处理占位符被拆分到多个 Run 的情况
    // 集成方案3：下划线优化 - 只改下划线区域，固定文字完全不动
    // ============================================================
    if (!filled) {
      const paraRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
      let paraMatch
      while ((paraMatch = paraRegex.exec(filledXml)) !== null) {
        const paraXml = paraMatch[0]
        // 构建段落完整文本
        const textMatches = paraXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
        let paraText = ''
        for (const tm of textMatches) {
          const m = tm.match(/<w:t[^>]*>([^<]*)<\/w:t>/)
          if (m) paraText += m[1]
        }

        // 情况1：标签和占位符在同一段落（如 "姓名：________"）
        if (paraText.includes(label)) {
          // 方案3：下划线优化 - 优先尝试只改下划线区域
          const fixedPrefix = label + (paraText.substring(paraText.indexOf(label) + label.length).match(/^[：:\s]*/)?.[0] || '')
          const underlineOptResult = fillTrailingUnderline(paraXml, fixedPrefix, escapedValue)
          if (underlineOptResult.success) {
            filledXml = filledXml.substring(0, paraMatch.index) + underlineOptResult.newParaXml + filledXml.substring(paraMatch.index + paraMatch[0].length)
            filled = true
            filledCount++
            console.log(`[docxHandler][Smart] ✓ Strategy -1a: Underline optimization - only modify underline area`)
            break
          }

          // 降级到原有的 Run 合并替换逻辑
          const afterLabel = paraText.substring(paraText.indexOf(label) + label.length)
          const placeholderMatch = afterLabel.match(/^[：:\s]*([＿_]{2,}|[（(][\s]*[)）])/)

          if (placeholderMatch) {
            const fullPlaceholder = placeholderMatch[0]
            const result = replacePlaceholderInParagraph(
              paraXml,
              fullPlaceholder,
              escapedValue
            )
            if (result.success) {
              filledXml = filledXml.substring(0, paraMatch.index) + result.newParagraphXml + filledXml.substring(paraMatch.index + paraMatch[0].length)
              filled = true
              filledCount++
              console.log(`[docxHandler][Smart] ✓ Strategy -1: Paragraph-level Run merge replacement (same paragraph)`)
              break
            }
          }

          // 情况1b：标签后直接跟内容（无占位符，如 "姓名：张三"）
          if (!filled) {
            const colonMatch = afterLabel.match(/^[：:\s]+/)
            if (colonMatch) {
              const result = replacePlaceholderInParagraph(
                paraXml,
                colonMatch[0],
                colonMatch[0] + escapedValue
              )
              if (result.success) {
                filledXml = filledXml.substring(0, paraMatch.index) + result.newParagraphXml + filledXml.substring(paraMatch.index + paraMatch[0].length)
                filled = true
                filledCount++
                console.log(`[docxHandler][Smart] ✓ Strategy -1b: Paragraph-level insertion after colon`)
                break
              }
            }
          }
        }

        // 情况2：表格场景 - 标签在一个单元格，占位符在相邻单元格
        // 检查段落是否在包含 anchorText 的单元格中
        if (!filled && field.anchorText && paraText.includes(field.anchorText)) {
          // 尝试在当前段落中查找占位符
          const placeholderMatch = paraText.match(/([＿_]{2,}|[（(][\s]*[)）])/)
          if (placeholderMatch) {
            const result = replacePlaceholderInParagraph(
              paraXml,
              placeholderMatch[0],
              escapedValue
            )
            if (result.success) {
              filledXml = filledXml.substring(0, paraMatch.index) + result.newParagraphXml + filledXml.substring(paraMatch.index + paraMatch[0].length)
              filled = true
              filledCount++
              console.log(`[docxHandler][Smart] ✓ Strategy -1c: Paragraph-level replacement with anchorText`)
              break
            }
          }
        }
      }
    }

    // ============================================================
    // 新策略：表格关键词锚定 + 合并单元格兼容 + 增量写入
    // 通过关键词定位单元格，免疫合并单元格导致的索引错位
    // ============================================================
    if (!filled && field.anchorText && hasTable) {
      // 查找包含 anchorText 的单元格
      const labelCell = findCellByKeyword(filledXml, field.anchorText)

      if (labelCell) {
        console.log(`[docxHandler][Smart] Strategy -2: Found label cell by keyword "${field.anchorText.substring(0, 30)}..."`)

        // 检查是否为合并单元格
        if (isMergedCell(labelCell.cellXml)) {
          console.log(`[docxHandler][Smart] ⚠ Label cell is merged, looking for next non-merged cell`)
        }

        // 查找右侧相邻单元格
        const afterLabelCell = filledXml.substring(labelCell.cellEnd)
        const nextCellMatch = afterLabelCell.match(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/)

        if (nextCellMatch) {
          const nextCellXml = nextCellMatch[0]
          const nextCellStart = labelCell.cellEnd + nextCellMatch.index
          const nextCellEnd = nextCellStart + nextCellXml.length

          // 检查相邻单元格是否为合并单元格（非首格）
          const isNextMerged = isMergedCell(nextCellXml)
          if (isNextMerged) {
            console.log(`[docxHandler][Smart] ⚠ Adjacent cell is merged, skipping to avoid invisible content`)
          } else {
            // 在相邻单元格中查找占位符
            const cellTextMatches = nextCellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
            let cellText = ''
            for (const tm of cellTextMatches) {
              const m = tm.match(/<w:t[^>]*>([^<]*)<\/w:t>/)
              if (m) cellText += m[1]
            }

            // 尝试替换占位符
            const placeholderMatch = cellText.match(/([＿_]{2,}|[（(][\s]*[)）])/)
            if (placeholderMatch) {
              const result = replaceInCell(nextCellXml, placeholderMatch[0], escapedValue)
              if (result.success) {
                filledXml = filledXml.substring(0, nextCellStart) + result.newCellXml + filledXml.substring(nextCellEnd)
                filled = true
                filledCount++
                console.log(`[docxHandler][Smart] ✓ Strategy -2: Table keyword anchor + cell replacement (placeholder)`)
              }
            }

            // 如果单元格为空或仅含空白，直接填入
            if (!filled && (cellText.trim() === '' || /^[：:\s]+$/.test(cellText.trim()))) {
              const result = replaceInCell(nextCellXml, cellText.trim() || ' ', escapedValue)
              if (result.success) {
                filledXml = filledXml.substring(0, nextCellStart) + result.newCellXml + filledXml.substring(nextCellEnd)
                filled = true
                filledCount++
                console.log(`[docxHandler][Smart] ✓ Strategy -2b: Table keyword anchor + cell replacement (empty cell)`)
              }
            }
          }
        }
      }
    }

    // ============================================================
    // 新策略：表格关键词锚定 - 直接用 label 定位（无 anchorText 时）
    // 集成方案1：列索引强锁定 + 方案2：单元格读写白名单
    // ============================================================
    if (!filled && hasTable) {
      // 方案1：列索引强锁定 - 通过左侧题干定位，只往右边填写
      const columnLockResult = fillTableRightCellByTopic(filledXml, label, escapedValue)
      if (columnLockResult.success) {
        filledXml = columnLockResult.newDocXml
        filled = true
        filledCount++
        console.log(`[docxHandler][Smart] ✓ Strategy -2c: Column lock - left topic to right cell`)
      } else {
        // 降级到原有的关键词锚定逻辑
        const labelCell = findCellByKeyword(filledXml, label)
        if (labelCell) {
          // 方案2：检查是否为只读单元格（白名单机制）
          if (isCellReadOnly(labelCell.cellXml, 0)) {
            console.log(`[docxHandler][Smart] ⚠ Label cell is read-only, skipping`)
          } else {
            // 查找右侧相邻单元格
            const afterLabelCell = filledXml.substring(labelCell.cellEnd)
            const nextCellMatch = afterLabelCell.match(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/)

            if (nextCellMatch) {
              const nextCellXml = nextCellMatch[0]
              const nextCellStart = labelCell.cellEnd + nextCellMatch.index
              const nextCellEnd = nextCellStart + nextCellXml.length

              // 方案2：检查右侧单元格是否为只读
              if (isCellReadOnly(nextCellXml, 1)) {
                console.log(`[docxHandler][Smart] ⚠ Right cell is read-only, skipping`)
              } else if (!isMergedCell(nextCellXml)) {
                const cellTextMatches = nextCellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
                let cellText = ''
                for (const tm of cellTextMatches) {
                  const m = tm.match(/<w:t[^>]*>([^<]*)<\/w:t>/)
                  if (m) cellText += m[1]
                }

                // 替换占位符或填入空单元格
                const placeholderMatch = cellText.match(/([＿_]{2,}|[（(][\s]*[)）])/)
                if (placeholderMatch) {
                  const result = replaceInCell(nextCellXml, placeholderMatch[0], escapedValue)
                  if (result.success) {
                    filledXml = filledXml.substring(0, nextCellStart) + result.newCellXml + filledXml.substring(nextCellEnd)
                    filled = true
                    filledCount++
                    console.log(`[docxHandler][Smart] ✓ Strategy -2d: Table label keyword anchor + cell replacement`)
                  }
                } else if (cellText.trim() === '' || /^[：:\s]+$/.test(cellText.trim())) {
                  const result = replaceInCell(nextCellXml, cellText.trim() || ' ', escapedValue)
                  if (result.success) {
                    filledXml = filledXml.substring(0, nextCellStart) + result.newCellXml + filledXml.substring(nextCellEnd)
                    filled = true
                    filledCount++
                    console.log(`[docxHandler][Smart] ✓ Strategy -2e: Table label keyword anchor + empty cell fill`)
                  }
                }
              }
            }
          }
        }
      }
    }

    // Step 1: 查找填写目标位置
    // 如果有 anchorText 且文档包含表格（表格场景：标签和填写位置在不同单元格），优先用 anchorText 定位
    // 保护：非表格文档不使用 anchorText 策略，避免 LLM 误判导致原有策略被跳过
    let targetNodeIdx = -1
    let targetEndInNode = -1
    let targetNode: TextNodeInfo | null = null

    if (field.anchorText && hasTable) {
      console.log(`[docxHandler][Smart] Using anchorText "${field.anchorText}" to locate target cell`)
      console.log(`[docxHandler][Smart] anchorText length: ${field.anchorText.length}`)

      // 调试：打印所有包含 anchorText 部分文字的节点
      const anchorKeywords = field.anchorText.substring(0, 20)
      console.log(`[docxHandler][Smart] Searching for nodes containing: "${anchorKeywords}..."`)
      for (let i = 0; i < textNodes.length; i++) {
        if (textNodes[i].content.includes(anchorKeywords)) {
          console.log(`[docxHandler][Smart]   Node ${i}: "${textNodes[i].content.substring(0, 100)}..."`)
        }
      }

      // 用 anchorText 在整个文档中搜索目标单元格
      for (let i = 0; i < textNodes.length; i++) {
        const pos = textNodes[i].content.indexOf(field.anchorText)
        if (pos >= 0) {
          targetNodeIdx = i
          targetEndInNode = pos + field.anchorText.length
          targetNode = textNodes[i]
          console.log(`[docxHandler][Smart] Found anchorText in node ${i}: "${textNodes[i].content}"`)
          break
        }
      }
      // 模糊匹配：去除 anchorText 首尾空白后重试
      if (targetNodeIdx < 0) {
        const anchorTrimmed = field.anchorText.trim()
        if (anchorTrimmed !== field.anchorText) {
          for (let i = 0; i < textNodes.length; i++) {
            const pos = textNodes[i].content.indexOf(anchorTrimmed)
            if (pos >= 0) {
              targetNodeIdx = i
              targetEndInNode = pos + anchorTrimmed.length
              targetNode = textNodes[i]
              console.log(`[docxHandler][Smart] Found trimmed anchorText in node ${i}: "${textNodes[i].content}"`)
              break
            }
          }
        }
      }
      // 跨节点匹配
      if (targetNodeIdx < 0) {
        const found = findLabelAcrossNodes(textNodes, field.anchorText)
        if (found) {
          targetNodeIdx = found.nodeIdx
          targetEndInNode = found.posInNode + field.anchorText.length
          targetNode = textNodes[targetNodeIdx]
          console.log(`[docxHandler][Smart] Found anchorText across nodes at node ${targetNodeIdx}`)
        }
      }

      if (targetNodeIdx < 0 || !targetNode) {
        console.log(`[docxHandler][Smart] ⚠ anchorText "${field.anchorText}" NOT FOUND in table document`)
        console.log(`[docxHandler][Smart] ⚠ Falling back to label-based table cell search for "${label}"`)
        // 重要：在表格文档中，如果 anchorText 没找到，使用 label 搜索 + 表格结构感知降级
        // 找到 label 所在单元格，然后定位同行右侧的相邻单元格作为填写目标
        // 不直接跳过，避免所有字段都不填写
      } else {
        // 找到 anchorText，直接用 value 替换整个 anchorText 内容
        const newContent = escapedValue
        filledXml = replaceTextNodeContent(filledXml, targetNode, newContent)
        filled = true
        filledCount++
        console.log(`[docxHandler][Smart] ✓ Replaced anchorText with value in node ${targetNodeIdx}`)
      }
    }

    // 如果没有 anchorText 或 anchorText 未找到，使用 label 搜索
    let labelNodeIdx = targetNodeIdx >= 0 ? targetNodeIdx : -1
    let labelEndInNode = targetNodeIdx >= 0 ? targetEndInNode : -1
    let labelNode: TextNodeInfo | null = targetNode

    if (labelNodeIdx < 0) {
      // 1a. 单节点精确匹配
      for (let i = 0; i < textNodes.length; i++) {
        const pos = textNodes[i].content.indexOf(label)
        if (pos >= 0) {
          labelNodeIdx = i
          labelEndInNode = pos + label.length
          labelNode = textNodes[i]
          console.log(`[docxHandler][Smart] Found label in node ${i} at pos ${pos}: "${textNodes[i].content}"`)
          break
        }
      }
    }

    // 1b. 单节点模糊匹配：去除标签末尾冒号后重试
    if (labelNodeIdx < 0) {
      const labelTrimmed = label.replace(/[：:\s]+$/, '')
      if (labelTrimmed !== label) {
        for (let i = 0; i < textNodes.length; i++) {
          const pos = textNodes[i].content.indexOf(labelTrimmed)
          if (pos >= 0) {
            labelNodeIdx = i
            labelEndInNode = pos + labelTrimmed.length
            labelNode = textNodes[i]
            console.log(`[docxHandler][Smart] Found trimmed label in node ${i} at pos ${pos}: "${textNodes[i].content}"`)
            break
          }
        }
      }
    }

    // 1c. 跨节点匹配
    if (labelNodeIdx < 0) {
      const found = findLabelAcrossNodes(textNodes, label)
      if (found) {
        labelNodeIdx = found.nodeIdx
        labelEndInNode = found.posInNode + label.length
        labelNode = textNodes[labelNodeIdx]
      }
    }

    if (labelNodeIdx < 0 || !labelNode) {
      if (!filled) {
        console.log(`[docxHandler][Smart] Label "${label}" not found, skipping`)
      }
      continue
    }

    // 如果 anchorText 已找到并填写，跳过后续策略
    if (filled) continue

    // 表格文档降级策略：anchorText 未找到时，使用 label 定位后切换到右侧相邻单元格
    // 重要：只要 hasTable 且 targetNodeIdx < 0 就触发，不要求 anchorText 存在
    let currentNode: TextNodeInfo = labelNode
    let currentLabelEndInNode = labelEndInNode
    let isTableTargetCell = false  // 标记是否已切换到表格目标单元格

    if (hasTable && targetNodeIdx < 0) {
      const adjacent = findRightAdjacentCellNode(filledXml, textNodes, labelNodeIdx)
      if (adjacent) {
        console.log(`[docxHandler][Smart] Table fallback: using right-adjacent cell node ${adjacent.nodeIdx} instead of label node ${labelNodeIdx}`)
        currentNode = adjacent.node
        currentLabelEndInNode = 0  // 在右侧单元格中从开头开始
        isTableTargetCell = true
      } else {
        console.log(`[docxHandler][Smart] Table fallback: no right-adjacent cell found, using label node (may fill in wrong cell)`)
      }
    }

    // 计算 currentNode 在 textNodes 中的索引，供后续策略使用
    const currentNodeIdx = textNodes.indexOf(currentNode)

    // ============================================================
    // Step 2: 多策略尝试填写
    // ============================================================

    // --- 策略 0: 表格目标单元格直接填充 ---
    // 当已切换到表格右侧目标单元格时，直接替换内容为 value
    // 不寻找下划线/冒号，因为表格单元格通常是空的
    if (!filled && isTableTargetCell) {
      console.log(`[docxHandler][Smart] Strategy 0: Direct fill for table target cell`)
      let newContent = escapedValue

      // 如果 deletePlaceholder=true 且单元格中有占位文字，删除占位文字
      if (field.deletePlaceholder && field.anchorText) {
        newContent = newContent.replace(
          new RegExp(escapeRegExp(field.anchorText), 'g'),
          ''
        )
      }

      filledXml = replaceTextNodeContent(filledXml, currentNode, newContent)
      filled = true
      filledCount++
      console.log(`[docxHandler][Smart] ✓ Strategy 0: Direct fill in table target cell (node ${currentNodeIdx})`)
    }

    // --- 策略 1: 同节点下划线替换 ---
    // "姓名：___" → 在冒号后、下划线前插入 value
    // 根据 deletePlaceholder 决定是否保留占位文字
    if (!filled && currentLabelEndInNode <= currentNode.content.length) {
      const afterLabel = currentNode.content.substring(currentLabelEndInNode)
      console.log(`[docxHandler][Smart] Strategy 1 check - afterLabel: "${afterLabel}"`)
      const underlineMatch = afterLabel.match(/^[：:\s]*([＿_]+)/)
      console.log(`[docxHandler][Smart] Strategy 1 underlineMatch:`, underlineMatch ? `"${underlineMatch[0]}"` : 'null')

      if (underlineMatch) {
        const underlineChars = underlineMatch[1]
        const colonPart = underlineMatch[0].substring(0, underlineMatch[0].indexOf(underlineChars))
        const underlineStart = currentLabelEndInNode + colonPart.length

        // 计算拆分位置（标签+冒号 和 下划线 之间）
        const splitOffset = underlineStart

        // 拆分run：前半部分（标签）无下划线，后半部分（value+下划线）有下划线
        const splitResult = splitRunAt(filledXml, currentNode.xmlStart, splitOffset)
        if (splitResult) {
          const [beforeRun, afterRun] = splitResult

          // 根据 deletePlaceholder 决定内容组合方式
          // 下划线始终保留，占位文字根据用户选择决定保留或删除
          // deletePlaceholder=true: 删除占位文字，只保留 value + 下划线
          // deletePlaceholder=false: 保留占位文字，占位文字 + value + 下划线
          // beforeRun 中已包含占位文字（如果有）
          const afterContent = escapedValue + underlineChars  // value + 下划线（始终保留）

          // 如果 deletePlaceholder=true，需要从 beforeRun 中删除占位文字
          let cleanBeforeRun = beforeRun
          if (field.deletePlaceholder && field.anchorText) {
            // 从 beforeRun 的文本内容中删除占位文字
            cleanBeforeRun = cleanBeforeRun.replace(
              new RegExp(escapeRegExp(field.anchorText), 'g'),
              ''
            )
          }

          const newAfterRun = afterRun.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/, `<w:t xml:space="preserve">${afterContent}</w:t>`)
          // 给后半部分添加下划线
          const tPosInAfterRun = newAfterRun.indexOf('<w:t')
          const finalAfterRun = addUnderlineToRunAt(newAfterRun, tPosInAfterRun >= 0 ? tPosInAfterRun : 0)
          // 从第一个 run 中移除下划线属性（避免标签带下划线）
          cleanBeforeRun = cleanBeforeRun
            .replace(/<w:u\s+w:val="[^"]*"\s*\/>/g, '')
            .replace(/<w:u\s*\/>/g, '')
            .replace(/<w:u\s+w:val="[^"]*">[\s\S]*?<\/w:u>/g, '')

          // 组合
          filledXml = filledXml.substring(0, currentNode.xmlStart) + cleanBeforeRun + finalAfterRun + filledXml.substring(currentNode.xmlEnd)
          filled = true
          filledCount++
          console.log(`[docxHandler][Smart] ✓ Strategy 1: Split run - label (no underline) + value (with underline), deletePlaceholder=${field.deletePlaceholder}`)
        } else {
          // 拆分失败，降级为直接替换
          console.log(`[docxHandler][Smart] Strategy 1 split failed, using fallback`)

          // 检查 currentLabelEndInNode 后面是否紧跟冒号（全角或半角）
          // 如果是，跳过冒号再插入值，避免值出现在冒号前面
          let actualInsertPos = currentLabelEndInNode
          const afterLabelEnd = currentNode.content.substring(currentLabelEndInNode)
          const colonMatch = afterLabelEnd.match(/^[：:]/)
          if (colonMatch) {
            actualInsertPos = currentLabelEndInNode + colonMatch[0].length
            console.log(`[docxHandler][Smart] Fallback: skipping colon "${colonMatch[0]}" at pos ${currentLabelEndInNode}, insert at ${actualInsertPos}`)
          }

          // 重要：before 必须包含到 actualInsertPos，这样冒号才会在 before 中
          const before = currentNode.content.substring(0, actualInsertPos)
          const after = currentNode.content.substring(actualInsertPos)
          // 找到下划线位置
          const underlineIdx = after.search(/[＿_]/)
          let newContent: string
          if (underlineIdx >= 0) {
            const underlineChar = after[underlineIdx]
            let beforeUnderline = after.substring(0, underlineIdx)
            const afterUnderline = after.substring(underlineIdx + 1)

            // 根据 deletePlaceholder 决定是否从 beforeUnderline 中删除占位文字
            if (field.deletePlaceholder && field.anchorText) {
              beforeUnderline = beforeUnderline.replace(
                new RegExp(escapeRegExp(field.anchorText), 'g'),
                ''
              )
            }

            newContent = before + beforeUnderline + escapedValue + underlineChar + afterUnderline
            console.log(`[docxHandler][Smart] Fallback: before="${before}", beforeUnderline="${beforeUnderline}", value="${value}", underline="${underlineChar}"`)
          } else {
            // 没有下划线，直接在冒号后追加
            newContent = before + after + escapedValue
            console.log(`[docxHandler][Smart] Fallback: no underline found, appending value after colon`)
          }

          filledXml = replaceTextNodeContent(filledXml, currentNode, newContent)
          filledXml = addUnderlineToRunAt(filledXml, currentNode.xmlStart)
          filled = true
          filledCount++
          console.log(`[docxHandler][Smart] ✓ Strategy 1 (fallback): Same-node underscore replacement with colon skip, deletePlaceholder=${field.deletePlaceholder}`)
        }
      } else {
        // 标签后没有直接跟下划线，尝试在同节点末尾追加 value + 下划线
        // 场景：标签和下划线在不同 run 中，如 "申报学院：" 和 "___" 分属不同 run
        console.log(`[docxHandler][Smart] Strategy 1: no underline match after label, checking node content`)
        const nodeHasUnderline = currentNode.content.includes('_') || currentNode.content.includes('＿')
        console.log(`[docxHandler][Smart] Node has underline: ${nodeHasUnderline}, content: "${currentNode.content.substring(0, 80)}..."`)
        if (!nodeHasUnderline) {
          // 当前节点没有下划线，在同节点末尾追加 value（下划线在后续节点中，由策略2处理）
          // 不在此处填写，让策略2处理
          console.log(`[docxHandler][Smart] Deferring to Strategy 2 for cross-node handling`)
        }
      }
    }

    // --- 策略 2: 跨节点下划线替换 ---
    // 标签在一个 run，下划线在后续 run
    // 下划线始终保留，用户内容放在下划线之前
    if (!filled) {
      // 找到 currentNode 在 textNodes 中的索引，从它之后开始搜索
      const currentNodeIdx = textNodes.indexOf(currentNode)
      const searchStart = currentNodeIdx >= 0 ? currentNodeIdx + 1 : labelNodeIdx + 1
      for (let j = searchStart; j < textNodes.length; j++) {
        const nextNode = textNodes[j]
        const uMatch = nextNode.content.match(/([＿_]+)/)
        if (uMatch) {
          const underlineChars = uMatch[1]
          const uPos = nextNode.content.indexOf(underlineChars)
          let before = nextNode.content.substring(0, uPos)
          const after = nextNode.content.substring(uPos + underlineChars.length)
          
          // 根据 deletePlaceholder 决定是否从 before 中删除占位文字
          if (field.deletePlaceholder && field.anchorText) {
            // 从 before 中删除占位文字
            before = before.replace(
              new RegExp(escapeRegExp(field.anchorText), 'g'),
              ''
            )
          }
          
          // 下划线始终保留，用户内容放在下划线之前
          const newContent = before + escapedValue + underlineChars + after

          filledXml = replaceTextNodeContent(filledXml, nextNode, newContent)
          filledXml = addUnderlineToRunAt(filledXml, nextNode.xmlStart)
          filled = true
          filledCount++
          console.log(`[docxHandler][Smart] ✓ Strategy 2: Cross-node underscore replacement (node ${j}), underline preserved`)
          break
        }
      }
    }

    // --- 策略 3: 同节点冒号后插入 ---
    // "姓名：" → 在冒号后直接插入 value（不给标签加下划线）
    if (!filled && currentLabelEndInNode <= currentNode.content.length) {
      const afterLabel = currentNode.content.substring(currentLabelEndInNode)
      const colonMatch = afterLabel.match(/^[：:\s]*$/)
      if (colonMatch) {
        // 标签后只有冒号/空白/空
        const colonPart = afterLabel.match(/^[：:\s]*/)?.[0] || ''
        const restAfter = afterLabel.substring(colonPart.length)
        const newContent = currentNode.content.substring(0, currentLabelEndInNode) + colonPart + escapedValue + restAfter

        filledXml = replaceTextNodeContent(filledXml, currentNode, newContent)
        // 注意：不给标签节点加下划线
        filled = true
        filledCount++
        console.log(`[docxHandler][Smart] ✓ Strategy 3: Insert after colon in same node (no underline on label)`)
      }
    }

    // --- 策略 4: 相邻空节点填充 ---
    // 标签后紧跟 <w:t></w:t>（无文本或仅空白） → 填入 value
    if (!filled) {
      const searchStart4 = currentNodeIdx >= 0 ? currentNodeIdx + 1 : labelNodeIdx + 1
      for (let j = searchStart4; j < textNodes.length && j < searchStart4 + 15; j++) {
        const nextNode = textNodes[j]
        const trimmed = nextNode.content.trim()
        // 空节点 或 仅含标点/空白
        if (trimmed === '' || /^[：:\s]+$/.test(trimmed)) {
          const colonMatch = nextNode.content.match(/^[：:\s]*/)?.[0] || ''
          const rest = nextNode.content.substring(colonMatch.length)
          const newContent = colonMatch + escapedValue + rest

          filledXml = replaceTextNodeContent(filledXml, nextNode, newContent)
          filledXml = addUnderlineToRunAt(filledXml, nextNode.xmlStart)
          filled = true
          filledCount++
          console.log(`[docxHandler][Smart] ✓ Strategy 4: Fill empty run (node ${j})`)
          break
        }
      }
    }

    // --- 策略 5: 下划线格式节点填充 ---
    // 标签后紧跟带 <w:u> 格式的 run（Word 用下划线格式表示填写区）
    if (!filled) {
      const searchStart5 = currentNodeIdx >= 0 ? currentNodeIdx + 1 : labelNodeIdx + 1
      for (let j = searchStart5; j < textNodes.length && j < searchStart5 + 15; j++) {
        const nextNode = textNodes[j]
        const trimmed = nextNode.content.trim()
        if ((trimmed === '' || /^[：:\s]+$/.test(trimmed)) && runHasUnderline(filledXml, nextNode.xmlStart)) {
          const colonMatch = nextNode.content.match(/^[：:\s]*/)?.[0] || ''
          const rest = nextNode.content.substring(colonMatch.length)
          const newContent = colonMatch + escapedValue + rest

          filledXml = replaceTextNodeContent(filledXml, nextNode, newContent)
          filledXml = addUnderlineToRunAt(filledXml, nextNode.xmlStart)
          filled = true
          filledCount++
          console.log(`[docxHandler][Smart] ✓ Strategy 5: Fill underline-formatted run (node ${j})`)
          break
        }
      }
    }

    // --- 策略 6: 兜底 — 追加入标签节点 ---
    // 找不到明确的填写位置，直接在标签文本末尾追加 value（不给标签加下划线）
    if (!filled) {
      const newContent = currentNode.content + escapedValue
      filledXml = replaceTextNodeContent(filledXml, currentNode, newContent)
      // 注意：不给标签节点加下划线
      filled = true
      filledCount++
      console.log(`[docxHandler][Smart] ✓ Strategy 6: Append to label run (fallback, no underline on label)`)
    }
  }

  console.log(`\n[docxHandler][Smart] === Summary ===`)
  console.log(`[docxHandler][Smart] Filled ${filledCount} / ${fieldsWithValue.length} fields`)

  // ============================================================
  // 防错位校验：填写后对比文档结构
  // ============================================================
  const structureAfter = extractDocxStructureInfo(filledXml)
  const structureComparison = compareDocxStructure(structureBefore, structureAfter)
  if (!structureComparison.consistent) {
    console.warn(`[docxHandler][Smart] ⚠ Structure changes detected after filling:`)
    for (const warning of structureComparison.warnings) {
      console.warn(`[docxHandler][Smart]   - ${warning}`)
    }
  } else {
    console.log(`[docxHandler][Smart] ✓ Structure preserved: ${structureBefore.paragraphCount} paragraphs, ${structureBefore.tableCount} tables, ${structureBefore.cellCount} cells`)
  }

  // 创建全新的 zip 实例，逐个复制文件（避免直接修改原实例导致文件损坏）
  const newZip = new PizZip()
  // 遍历原 zip 中的所有文件
  const allFiles = zip.file(/.*/)
  for (const zipEntry of allFiles) {
    if (!zipEntry.dir) {
      if (zipEntry.name === 'word/document.xml') {
        // 使用填写后的 XML
        newZip.file(zipEntry.name, filledXml)
      } else {
        // 复制其他文件（保持原始内容）
        newZip.file(zipEntry.name, zipEntry.asBinary())
      }
    }
  }

  const blob = newZip.generate({ type: 'uint8array' })
  console.log(`[docxHandler][Smart] Generated blob, size: ${blob.length} bytes`)

  let binary = ''
  for (let i = 0; i < blob.length; i++) {
    binary += String.fromCharCode(blob[i])
  }
  return btoa(binary)
}

/**
 * 检查文本节点所在的 <w:r> 是否包含下划线格式 <w:u>
 */
function runHasUnderline(xml: string, textNodePos: number): boolean {
  // 向前查找最近的 <w:r 开标签
  let runStart = -1
  for (let i = textNodePos; i >= 0; i--) {
    if (xml.substring(i, i + 4) === '<w:r' && (xml[i + 4] === '>' || xml[i + 4] === ' ')) {
      runStart = i
      break
    }
  }
  if (runStart < 0) return false

  // 找 run 的结束
  const runEnd = xml.indexOf('</w:r>', textNodePos)
  if (runEnd < 0) return false

  // 检查 run 的 XML 中是否包含 <w:u
  const runXml = xml.substring(runStart, runEnd)
  return runXml.includes('<w:u')
}

function findLabelAcrossNodes(
  nodes: TextNodeInfo[],
  label: string
): { nodeIdx: number; posInNode: number } | null {
  console.log(`[docxHandler] Searching for label "${label}" across ${nodes.length} text nodes`)
  
  for (let startIdx = 0; startIdx < nodes.length; startIdx++) {
    let combined = ''
    // 修复：移除硬编码的 10 个节点限制，搜索所有后续节点
    for (let j = startIdx; j < nodes.length; j++) {
      combined += nodes[j].content
      const pos = combined.indexOf(label)
      if (pos >= 0) {
        console.log(`[docxHandler] Found label "${label}" starting from node ${startIdx}, position ${pos} in combined text`)
        let charCount = 0
        for (let k = startIdx; k <= j; k++) {
          const nodeLen = nodes[k].content.length
          if (charCount + nodeLen > pos) {
            const posInNode = pos - charCount
            console.log(`[docxHandler] Label starts in node ${k} at position ${posInNode}, node content: "${nodes[k].content}"`)
            return { nodeIdx: k, posInNode }
          }
          charCount += nodeLen
        }
      }
    }
  }
  
  console.log(`[docxHandler] Label "${label}" NOT found in any text nodes`)
  return null
}

function replaceTextNodeContent(xml: string, node: TextNodeInfo, newContent: string): string {
  const before = xml.substring(0, node.xmlStart)
  const after = xml.substring(node.xmlEnd)
  return before + `${node.tOpenTag}${newContent}</w:t>` + after
}

/**
 * 在指定位置分割 <w:r>...</w:r> run
 * splitPos 是相对于 run 内第一个 <w:t> 文本内容的偏移量
 * 返回 [beforeRunXml, afterRunXml]，如果无法分割则返回 null
 */
function splitRunAt(xml: string, textNodePos: number, splitOffset: number): [string, string] | null {
  let runStart = -1
  for (let i = textNodePos; i >= 0; i--) {
    if (xml.substring(i, i + 4) === '<w:r' &&
        (xml[i + 4] === '>' || xml[i + 4] === ' ')) {
      runStart = i
      break
    }
  }
  if (runStart < 0) return null

  const runEnd = xml.indexOf('</w:r>', textNodePos)
  if (runEnd < 0) return null

  // 找到 run 内的 <w:t> 标签
  const tOpenMatch = xml.substring(runStart, runEnd).match(/<w:t([^>]*)>/)
  if (!tOpenMatch) return null

  const tOpenTag = `<w:t${tOpenMatch[1]}>`
  const tCloseTag = '</w:t>'
  const tOpenPos = runStart + tOpenMatch.index! + tOpenMatch[0].length
  const tClosePos = xml.indexOf(tCloseTag, tOpenPos)
  if (tClosePos < 0) return null

  const content = xml.substring(tOpenPos, tClosePos)
  if (splitOffset < 0 || splitOffset > content.length) return null

  // 分割内容
  const beforeContent = content.substring(0, splitOffset)
  const afterContent = content.substring(splitOffset)

  // 获取 run 属性（用于复制到新 run）
  const rPrMatch = xml.substring(runStart, tOpenPos).match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)
  const rPrXml = rPrMatch ? rPrMatch[0] : ''

  // 构建两个新的 run
  const beforeRun = xml.substring(runStart, tOpenPos - tOpenTag.length) +
                    tOpenTag + beforeContent + tCloseTag + '</w:r>'
  const afterRun = '<w:r>' + rPrXml + tOpenTag + afterContent + tCloseTag + '</w:r>'

  return [beforeRun, afterRun]
}

/**
 * 给指定位置的 run 添加下划线格式
 */
function addUnderlineToRunAt(xml: string, textNodePos: number): string {
  let runStart = -1
  for (let i = textNodePos; i >= 0; i--) {
    if (xml.substring(i, i + 4) === '<w:r' &&
        (xml[i + 4] === '>' || xml[i + 4] === ' ')) {
      runStart = i
      break
    }
  }

  if (runStart < 0) return xml

  const runEnd = xml.indexOf('</w:r>', textNodePos)
  if (runEnd < 0) return xml

  const runXml = xml.substring(runStart, runEnd + 6)

  // 已有下划线则跳过
  if (runXml.includes('<w:u')) return xml

  if (runXml.includes('<w:rPr/>')) {
    const newRunXml = runXml.replace('<w:rPr/>', '<w:rPr><w:u w:val="single"/></w:rPr>')
    return xml.substring(0, runStart) + newRunXml + xml.substring(runEnd + 6)
  }

  const rPrMatch = runXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)
  if (rPrMatch) {
    const newRunXml = runXml.replace('</w:rPr>', '<w:u w:val="single"/></w:rPr>')
    return xml.substring(0, runStart) + newRunXml + xml.substring(runEnd + 6)
  }

  const rTagMatch = runXml.match(/^<w:r([^>]*)>/)
  if (rTagMatch) {
    const insertPos = runStart + rTagMatch[0].length
    return xml.substring(0, insertPos) + '<w:rPr><w:u w:val="single"/></w:rPr>' + xml.substring(insertPos)
  }

  return xml
}

// ============================================================
// 防错位机制：段落 Run 合并替换法
// ============================================================

/**
 * 段落 Run 信息
 */
interface ParagraphRunInfo {
  runXml: string
  textContent: string
  startOffset: number
  endOffset: number
}

/**
 * 段落 Run 合并替换法（解决下划线占位符错位）
 * 核心逻辑：
 * 1. 遍历段落所有 run 拼接完整文本
 * 2. 定位占位符的起止偏移
 * 3. 映射回对应的 run 范围
 * 4. 合并目标 run 的文本并替换
 * 5. 写回第一个 run 并清空其余 run
 * 6. 全程继承原有格式
 */
function replacePlaceholderInParagraph(
  paragraphXml: string,
  placeholder: string,
  replaceText: string
): { success: boolean; newParagraphXml: string } {
  // 提取段落中的所有 run
  const runs: ParagraphRunInfo[] = []
  const runRegex = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g
  let match
  let offset = 0

  while ((match = runRegex.exec(paragraphXml)) !== null) {
    const runXml = match[0]
    // 提取 run 内的所有文本
    const textMatches = runXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
    let textContent = ''
    for (const textMatch of textMatches) {
      const text = textMatch.replace(/<w:t[^>]*>([^<]*)<\/w:t>/, '$1')
      textContent += text
    }

    runs.push({
      runXml,
      textContent,
      startOffset: offset,
      endOffset: offset + textContent.length,
    })

    offset += textContent.length
  }

  if (runs.length === 0) {
    return { success: false, newParagraphXml: paragraphXml }
  }

  // 拼接完整段落文本
  const fullText = runs.map(r => r.textContent).join('')

  // 查找占位符
  const placeholderIdx = fullText.indexOf(placeholder)
  if (placeholderIdx === -1) {
    return { success: false, newParagraphXml: paragraphXml }
  }

  const placeholderEnd = placeholderIdx + placeholder.length

  // 找到覆盖占位符的所有 run
  const targetRuns: ParagraphRunInfo[] = []
  for (const run of runs) {
    if (run.endOffset > placeholderIdx && run.startOffset < placeholderEnd) {
      targetRuns.push(run)
    }
  }

  if (targetRuns.length === 0) {
    return { success: false, newParagraphXml: paragraphXml }
  }

  // 构建新的第一个 run 内容
  const firstRun = targetRuns[0]
  const beforePlaceholder = fullText.substring(firstRun.startOffset, placeholderIdx)
  const afterPlaceholder = fullText.substring(placeholderEnd, targetRuns[targetRuns.length - 1].endOffset)

  // 替换第一个 run 的文本内容
  let newFirstRunXml = firstRun.runXml
  const textRegex = /<w:t([^>]*)>([^<]*)<\/w:t>/g
  let newTextContent = beforePlaceholder + replaceText + afterPlaceholder
  let firstTextMatch = true

  newFirstRunXml = newFirstRunXml.replace(textRegex, (match, attrs, text) => {
    if (firstTextMatch) {
      firstTextMatch = false
      return `<w:t${attrs}>${escapeXml(newTextContent)}</w:t>`
    }
    return match
  })

  // 清空其他目标 run 的文本
  let newParagraphXml = paragraphXml.replace(firstRun.runXml, newFirstRunXml)
  for (let i = 1; i < targetRuns.length; i++) {
    const run = targetRuns[i]
    const emptyRunXml = run.runXml.replace(/<w:t([^>]*)>[^<]*<\/w:t>/g, '<w:t$1></w:t>')
    newParagraphXml = newParagraphXml.replace(run.runXml, emptyRunXml)
  }

  console.log(`[docxHandler][RunMerge] ✓ Replaced placeholder "${placeholder}" across ${targetRuns.length} run(s)`)
  return { success: true, newParagraphXml }
}

/**
 * 提取文档结构信息（用于填写前后的结构校验）
 */
export function extractDocxStructureInfo(docXml: string): DocxStructureInfo {
  const paragraphCount = (docXml.match(/<w:p\b/g) || []).length
  const tableCount = (docXml.match(/<w:tbl\b/g) || []).length
  const cellCount = (docXml.match(/<w:tc\b/g) || []).length

  return { paragraphCount, tableCount, cellCount }
}

/**
 * 对比填写前后的文档结构
 */
export function compareDocxStructure(
  before: DocxStructureInfo,
  after: DocxStructureInfo
): { consistent: boolean; warnings: string[] } {
  const warnings: string[] = []

  if (before.paragraphCount !== after.paragraphCount) {
    warnings.push(`段落数变化: ${before.paragraphCount} → ${after.paragraphCount}`)
  }
  if (before.tableCount !== after.tableCount) {
    warnings.push(`表格数变化: ${before.tableCount} → ${after.tableCount}`)
  }
  if (before.cellCount !== after.cellCount) {
    warnings.push(`单元格数变化: ${before.cellCount} → ${after.cellCount}`)
  }

  return {
    consistent: warnings.length === 0,
    warnings,
  }
}

// ============================================================
// 防错位机制：表格关键词锚定 + 固定列宽 + 合并单元格兼容
// ============================================================

/**
 * 通过关键词在表格中定位单元格
 * 不按行列号定位，而是通过单元格内的关键词匹配目标单元格
 * 完全免疫合并单元格、嵌套表格导致的索引错位
 */
function findCellByKeyword(
  docXml: string,
  keyword: string
): { cellXml: string; cellStart: number; cellEnd: number } | null {
  const cellRegex = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g
  let match

  while ((match = cellRegex.exec(docXml)) !== null) {
    const cellXml = match[0]
    // 提取单元格内的所有文本
    const textMatches = cellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
    let cellText = ''
    for (const textMatch of textMatches) {
      const text = textMatch.replace(/<w:t[^>]*>([^<]*)<\/w:t>/, '$1')
      cellText += text
    }

    if (cellText.includes(keyword)) {
      return {
        cellXml,
        cellStart: match.index,
        cellEnd: match.index + match[0].length,
      }
    }
  }

  return null
}

/**
 * 方案1：列索引强锁定 - 通过左侧题干定位，只往右边填写
 * 明确表格每行的第0列=左侧只读题干列，第1列=右侧填写列
 * 强制只操作同行的右列单元格，完全跳过左列
 */
function fillTableRightCellByTopic(
  docXml: string,
  topicKeyword: string,
  fillContent: string
): { success: boolean; newDocXml: string } {
  console.log(`[docxHandler][ColumnLock] 尝试列索引强锁定: 题干="${topicKeyword.substring(0, 30)}..."`)
  
  // 查找所有表格
  const tableRegex = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g
  let tableMatch
  let newDocXml = docXml

  while ((tableMatch = tableRegex.exec(docXml)) !== null) {
    const tableXml = tableMatch[0]
    let newTableXml = tableXml

    // 查找所有行
    const rowRegex = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g
    let rowMatch

    while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
      const rowXml = rowMatch[0]

      // 提取所有单元格
      const cells: { xml: string; text: string; start: number; end: number }[] = []
      const cellRegex = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g
      let cellMatch

      while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
        const cellXml = cellMatch[0]
        const textMatches = cellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
        let cellText = ''
        for (const textMatch of textMatches) {
          const text = textMatch.replace(/<w:t[^>]*>([^<]*)<\/w:t>/, '$1')
          cellText += text
        }
        cells.push({
          xml: cellXml,
          text: cellText,
          start: cellMatch.index,
          end: cellMatch.index + cellMatch[0].length,
        })
      }

      // 方案1核心：第0列=题干列，第1列=填写列
      if (cells.length >= 2) {
        const leftCell = cells[0]  // 第0列：只读题干列
        const rightCell = cells[1]  // 第1列：右侧填写列

        // 仅匹配左栏的题干文本，不修改左栏内容
        if (leftCell.text.includes(topicKeyword)) {
          console.log(`[docxHandler][ColumnLock] ✓ 找到题干: "${topicKeyword.substring(0, 30)}..."`)
          console.log(`[docxHandler][ColumnLock]   左列(只读): "${leftCell.text.substring(0, 50)}..."`)
          console.log(`[docxHandler][ColumnLock]   右列(填写): "${rightCell.text.substring(0, 50)}..."`)

          // 只在右栏执行填写逻辑
          let newRightCellXml = rightCell.xml

          // 策略：替换右栏中的占位符或填入空单元格
          const placeholderMatch = rightCell.text.match(/([＿_]{2,}|[（(][\s]*[)）])/)
          if (placeholderMatch) {
            // 有占位符，替换占位符
            const result = replaceInCell(rightCell.xml, placeholderMatch[0], fillContent)
            if (result.success) {
              newRightCellXml = result.newCellXml
              console.log(`[docxHandler][ColumnLock] ✓ 替换占位符成功`)
            }
          } else if (rightCell.text.trim() === '' || /^[：:\s]+$/.test(rightCell.text.trim())) {
            // 空单元格，直接填入
            const result = replaceInCell(rightCell.xml, rightCell.text.trim() || ' ', fillContent)
            if (result.success) {
              newRightCellXml = result.newCellXml
              console.log(`[docxHandler][ColumnLock] ✓ 填入空单元格成功`)
            }
          }

          if (newRightCellXml !== rightCell.xml) {
            // 更新行XML
            const newRowXml = rowXml.substring(0, rightCell.start) + newRightCellXml + rowXml.substring(rightCell.end)
            newTableXml = newTableXml.replace(rowXml, newRowXml)
            newDocXml = newDocXml.replace(tableXml, newTableXml)
            return { success: true, newDocXml }
          }
        }
      }
    }
  }

  console.log(`[docxHandler][ColumnLock] ✗ 未找到匹配的题干`)
  return { success: false, newDocXml: docXml }
}

/**
 * 方案2：单元格读写白名单 - 提前给所有表格列标注角色
 * 题干说明列开启只读锁定，代码遍历写入时直接跳过锁定单元格
 */
function isCellReadOnly(cellXml: string, colIndex: number): boolean {
  // 规则1：第0列（最左侧）通常是题干列，标记为只读
  if (colIndex === 0) {
    console.log(`[docxHandler][Whitelist] 列${colIndex}标记为只读(题干列)`)
    return true
  }

  // 规则2：提取单元格文本，检查是否包含标签（冒号结尾）
  const textMatches = cellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
  let cellText = ''
  for (const textMatch of textMatches) {
    const text = textMatch.replace(/<w:t[^>]*>([^<]*)<\/w:t>/, '$1')
    cellText += text
  }

  // 如果包含标签（如"姓名："）且没有占位符，标记为只读
  const hasLabel = /[：:]$/.test(cellText.trim())
  const hasPlaceholder = /[＿_]{3,}|【[^】]+】|\{[^}]+\}/.test(cellText)

  if (hasLabel && !hasPlaceholder) {
    console.log(`[docxHandler][Whitelist] 单元格标记为只读(含标签): "${cellText.substring(0, 30)}..."`)
    return true
  }

  return false
}

/**
 * 方案3：下划线填写优化 - 只改下划线区域，固定文字完全不动
 * 锁定固定前缀不修改，只处理段落末尾带下划线格式的占位片段
 */
function fillTrailingUnderline(
  paraXml: string,
  fixedPrefix: string,
  fillText: string
): { success: boolean; newParaXml: string } {
  console.log(`[docxHandler][UnderlineOpt] 尝试下划线优化填写: 前缀="${fixedPrefix.substring(0, 30)}..."`)

  // 提取段落的所有 run
  const runs: { xml: string; text: string; hasUnderline: boolean }[] = []
  const runRegex = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g
  let match

  while ((match = runRegex.exec(paraXml)) !== null) {
    const runXml = match[0]
    const textMatches = runXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
    let textContent = ''
    for (const textMatch of textMatches) {
      const text = textMatch.replace(/<w:t[^>]*>([^<]*)<\/w:t>/, '$1')
      textContent += text
    }

    // 检查是否有下划线格式
    const hasUnderline = runXml.includes('<w:u')

    runs.push({
      xml: runXml,
      text: textContent,
      hasUnderline,
    })
  }

  // 拼接完整段落文本
  const fullText = runs.map(r => r.text).join('')

  // 检查是否以固定前缀开头
  if (!fullText.startsWith(fixedPrefix)) {
    console.log(`[docxHandler][UnderlineOpt] ✗ 段落不以固定前缀开头`)
    return { success: false, newParaXml: paraXml }
  }

  // 查找带下划线格式的占位 run
  let newParaXml = paraXml
  let foundUnderlineRun = false

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]

    // 仅匹配带下划线格式的占位 run
    if (run.hasUnderline && /[＿_]/.test(run.text)) {
      console.log(`[docxHandler][UnderlineOpt] ✓ 找到下划线 run: "${run.text.substring(0, 30)}..."`)

      // 替换下划线内容为填写内容，继承原有下划线样式
      const newRunXml = run.xml.replace(
        /<w:t[^>]*>[^<]*<\/w:t>/g,
        `<w:t xml:space="preserve">${fillText}</w:t>`
      )

      // 确保保留下划线格式
      let finalRunXml = newRunXml
      if (!newRunXml.includes('<w:u')) {
        // 添加下划线格式
        const rPrMatch = newRunXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)
        if (rPrMatch) {
          finalRunXml = newRunXml.replace('</w:rPr>', '<w:u w:val="single"/></w:rPr>')
        } else {
          // 没有 rPr，添加一个
          finalRunXml = newRunXml.replace(
            /^<w:r([^>]*)>/,
            '<w:r$1><w:rPr><w:u w:val="single"/></w:rPr>'
          )
        }
      }

      newParaXml = newParaXml.replace(run.xml, finalRunXml)
      foundUnderlineRun = true
      console.log(`[docxHandler][UnderlineOpt] ✓ 替换下划线内容成功`)
      break  // 只替换第一个带下划线的 run
    }
  }

  if (!foundUnderlineRun) {
    console.log(`[docxHandler][UnderlineOpt] ✗ 未找到带下划线格式的占位 run`)
    return { success: false, newParaXml: paraXml }
  }

  return { success: true, newParaXml }
}

/**
 * 判断单元格是否为合并单元格
 * 通过检查 <w:gridSpan> 或 <w:vMerge> 标签判断
 */
function isMergedCell(cellXml: string): boolean {
  return cellXml.includes('<w:gridSpan') || cellXml.includes('<w:vMerge')
}

/**
 * 在单元格内替换占位符文本
 * 保留原有段落、字体、对齐方式，只替换占位符
 */
function replaceInCell(
  cellXml: string,
  placeholder: string,
  replaceText: string
): { success: boolean; newCellXml: string } {
  // 提取单元格内的所有段落
  const paraRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
  let match
  let newCellXml = cellXml

  while ((match = paraRegex.exec(cellXml)) !== null) {
    const paraXml = match[0]
    const result = replacePlaceholderInParagraph(paraXml, placeholder, replaceText)

    if (result.success) {
      newCellXml = newCellXml.replace(paraXml, result.newParagraphXml)
      return { success: true, newCellXml }
    }
  }

  return { success: false, newCellXml }
}

/**
 * 设置表格固定列宽（防止内容撑变形）
 * 在表格属性中添加 <w:tblW> 和 <w:tblLayout w:type="fixed"/>
 */
function setTableFixedWidth(tableXml: string, widths?: number[]): string {
  let newTableXml = tableXml

  // 查找表格属性
  const tblPrMatch = tableXml.match(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/)
  if (!tblPrMatch) {
    return tableXml
  }

  let tblPrXml = tblPrMatch[0]

  // 添加固定布局（如果不存在）
  if (!tblPrXml.includes('<w:tblLayout')) {
    tblPrXml = tblPrXml.replace(
      '</w:tblPr>',
      '<w:tblLayout w:type="fixed"/></w:tblPr>'
    )
  }

  newTableXml = newTableXml.replace(tblPrMatch[0], tblPrXml)

  // 如果提供了列宽，设置每个单元格的宽度
  if (widths && widths.length > 0) {
    const tcRegex = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g
    let cellIndex = 0
    let match

    while ((match = tcRegex.exec(newTableXml)) !== null) {
      const cellXml = match[0]
      const colIndex = cellIndex % widths.length

      if (widths[colIndex]) {
        // 在单元格属性中添加宽度
        const tcPrMatch = cellXml.match(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/)
        if (tcPrMatch) {
          let tcPrXml = tcPrMatch[0]
          if (!tcPrXml.includes('<w:tcW')) {
            tcPrXml = tcPrXml.replace(
              '</w:tcPr>',
              `<w:tcW w:w="${widths[colIndex]}" w:type="dxa"/></w:tcPr>`
            )
            const newCellXml = cellXml.replace(tcPrMatch[0], tcPrXml)
            newTableXml = newTableXml.replace(cellXml, newCellXml)
          }
        }
      }

      cellIndex++
    }
  }

  return newTableXml
}

// ============================================================
// 提取文本（用于 LLM 分析）
// ============================================================

export function extractDocxText(rawContent: ArrayBuffer): string {
  const buffer = new Uint8Array(rawContent)
  const zip = new PizZip(buffer)

  const docXml = zip.file('word/document.xml')?.asText()
  if (!docXml) return ''

  const textNodes = docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []
  const texts = textNodes.map(t => {
    const match = t.match(/<w:t[^>]*>([^<]*)<\/w:t>/)
    return match ? match[1] : ''
  })
  const result = texts.join(' ')
  if (result.trim()) return result

  const allTextMatches = docXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || []
  return allTextMatches.map(t => {
    const match = t.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/)
    return match ? match[1] : ''
  }).join('')
}

// ============================================================
// 方案四：书签填写
// ============================================================

/**
 * 通过书签名称填写内容
 * 书签是 Word 文档中的标记位置，可以精确定位填写位置
 */
export async function fillDocxByBookmark(
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
  const docXml = zip.file('word/document.xml')?.asText()
  if (!docXml) {
    throw new Error('无法读取 document.xml')
  }

  let filledXml = docXml
  const fieldsWithValue = fields.filter(f => f.value && f.location?.type === 'bookmark' && f.location?.bookmarkName)

  console.log(`[docxHandler][Bookmark] Filling ${fieldsWithValue.length} fields by bookmark`)

  for (const field of fieldsWithValue) {
    const bookmarkName = field.location!.bookmarkName!
    const value = field.value
    const escapedValue = escapeXml(value)

    console.log(`[docxHandler][Bookmark] Processing bookmark: "${bookmarkName}" = "${value}"`)

    // 查找书签开始标记
    const bookmarkStartRegex = new RegExp(`<w:bookmarkStart\\s+w:name="${bookmarkName}"[^>]*\\/?>`, 'g')
    const startMatch = bookmarkStartRegex.exec(filledXml)

    if (!startMatch) {
      console.warn(`[docxHandler][Bookmark] Bookmark "${bookmarkName}" not found`)
      continue
    }

    const startPos = startMatch.index + startMatch[0].length

    // 查找书签结束标记
    const bookmarkIdMatch = startMatch[0].match(/w:id="(\d+)"/)
    if (!bookmarkIdMatch) {
      console.warn(`[docxHandler][Bookmark] Cannot find bookmark ID for "${bookmarkName}"`)
      continue
    }

    const bookmarkId = bookmarkIdMatch[1]
    const bookmarkEndRegex = new RegExp(`<w:bookmarkEnd\\s+w:id="${bookmarkId}"[^>]*\\/?>`, 'g')
    const endMatch = bookmarkEndRegex.exec(filledXml)

    if (!endMatch) {
      console.warn(`[docxHandler][Bookmark] Cannot find end mark for bookmark "${bookmarkName}"`)
      continue
    }

    const endPos = endMatch.index

    // 替换书签内的内容
    const before = filledXml.substring(0, startPos)
    const after = filledXml.substring(endPos)
    const newContent = `<w:t xml:space="preserve">${escapedValue}</w:t>`

    filledXml = before + newContent + after
    console.log(`[docxHandler][Bookmark] ✓ Filled bookmark "${bookmarkName}"`)
  }

  // 创建全新的 zip 实例
  const newZip = new PizZip()
  const allFiles = zip.file(/.*/)
  for (const zipEntry of allFiles) {
    if (!zipEntry.dir) {
      if (zipEntry.name === 'word/document.xml') {
        newZip.file(zipEntry.name, filledXml)
      } else {
        newZip.file(zipEntry.name, zipEntry.asBinary())
      }
    }
  }

  const blob = newZip.generate({ type: 'uint8array' })
  let binary = ''
  for (let i = 0; i < blob.length; i++) {
    binary += String.fromCharCode(blob[i])
  }
  return btoa(binary)
}

// ============================================================
// 方案五：窗体控件填写
// ============================================================

/**
 * 通过窗体控件名称填写内容
 * 支持文本框、下拉列表、日期选择器等窗体控件
 */
export async function fillDocxByFormField(
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
  const docXml = zip.file('word/document.xml')?.asText()
  if (!docXml) {
    throw new Error('无法读取 document.xml')
  }

  let filledXml = docXml
  const fieldsWithValue = fields.filter(f => f.value && f.location?.type === 'form-field' && f.location?.fieldName)

  console.log(`[docxHandler][FormField] Filling ${fieldsWithValue.length} fields by form field`)

  for (const field of fieldsWithValue) {
    const fieldName = field.location!.fieldName!
    const value = field.value
    const escapedValue = escapeXml(value)

    console.log(`[docxHandler][FormField] Processing form field: "${fieldName}" = "${value}"`)

    // 查找窗体控件 <w:fldSimple> 或 <w:sdt>
    const fieldRegex = new RegExp(`<w:(?:fldSimple|sdt)\\b[^>]*>[\\s\\S]*?<w:name\\s+w:val="${fieldName}"[\\s\\S]*?<\\/w:(?:fldSimple|sdt)>`, 'g')
    const fieldMatch = fieldRegex.exec(filledXml)

    if (!fieldMatch) {
      console.warn(`[docxHandler][FormField] Form field "${fieldName}" not found`)
      continue
    }

    // 查找控件内的默认值或占位符
    const defaultMatch = fieldMatch[0].match(/<w:default\s+w:val="([^"]+)"/)
    const placeholderMatch = fieldMatch[0].match(/<w:t[^>]*>([^<]*)<\/w:t>/)

    if (defaultMatch || placeholderMatch) {
      // 替换默认值或占位符
      const oldContent = defaultMatch ? defaultMatch[1] : placeholderMatch![1]
      const fieldXml = fieldMatch[0].replace(oldContent, escapedValue)
      filledXml = filledXml.replace(fieldMatch[0], fieldXml)
      console.log(`[docxHandler][FormField] ✓ Filled form field "${fieldName}"`)
    } else {
      console.warn(`[docxHandler][FormField] Cannot find placeholder in form field "${fieldName}"`)
    }
  }

  // 创建全新的 zip 实例
  const newZip = new PizZip()
  const allFiles = zip.file(/.*/)
  for (const zipEntry of allFiles) {
    if (!zipEntry.dir) {
      if (zipEntry.name === 'word/document.xml') {
        newZip.file(zipEntry.name, filledXml)
      } else {
        newZip.file(zipEntry.name, zipEntry.asBinary())
      }
    }
  }

  const blob = newZip.generate({ type: 'uint8array' })
  let binary = ''
  for (let i = 0; i < blob.length; i++) {
    binary += String.fromCharCode(blob[i])
  }
  return btoa(binary)
}
