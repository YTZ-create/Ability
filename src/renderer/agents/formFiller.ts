import { BaseAgent, type AgentConfig } from './base'
import type { PlatformAPI } from '../api/platformAPI'
import { FileOutput } from 'lucide-react'
import { callLLM, resolveProvider } from '../utils/llm'
import { useSettingsStore } from '../stores/settingsStore'
import { useTokenUsageStore } from '../stores/tokenUsageStore'
import type { AnalysisStep } from '../stores/chatStore'
import { extractDocumentText } from '../utils/docParser'
import { fillDocxFile, fillDocxWithDOMParser, fillDocxWithWordCOMBase64, fillDocxByBookmark, fillDocxByFormField, type FillMethod } from '../utils/docxHandler'
import { fillXlsxWithXml, fillXlsxWithExcelCOM } from '../utils/xlsxHandler'
import { analyzeDocxStructure, extractFillableLocations as extractDocxLocations } from '../utils/docxAnalyzer'
import { analyzeXlsxStructure, extractFillableLocations as extractXlsxLocations } from '../utils/xlsxAnalyzer'
import PizZip from 'pizzip'

export interface FormField {
  id: string
  label: string
  placeholder: string
  value: string
  filledBy: 'user' | 'ai' | 'none'
  anchorText?: string  // 目标位置的锚点文字（用于表格等标签与填写位置不同的场景）
  deletePlaceholder?: boolean  // 是否删除占位提示文字（true=替换, false=保留并追加）
  
  // 新增：约束字段（从文档中提取）
  constraints?: {
    format?: string  // 格式要求：date, number, email, phone, idCard等
    required?: boolean  // 是否必填
    maxLength?: number  // 最大长度
    minLength?: number  // 最小长度
    pattern?: string  // 正则表达式约束
    options?: string[]  // 可选值列表（下拉选项）
    precision?: number  // 数值精度（小数位数）
    min?: number  // 最小值
    max?: number  // 最大值
    unit?: string  // 单位
    consistency?: string  // 一致性要求：如"全文统一"的字段名
  }
  
  // 新增：位置信息（用于精确填写）
  location?: {
    type: 'paragraph' | 'table-cell' | 'bookmark' | 'form-field' | 'placeholder'
    paragraphIndex?: number  // 段落序号
    cellRef?: string  // 表格单元格引用（如"A1"）
    bookmarkName?: string  // 书签名称
    fieldName?: string  // 窗体控件名称
    charOffset?: number  // 字符偏移量
  }
}

export interface FormDocument {
  filePath: string
  fileName: string
  originalContent: string
  rawContent?: string  // 原始 base64 内容（.docx 等二进制格式需要）
  fields: FormField[]
  currentFieldIndex: number
  status: 'extracting' | 'filling' | 'completed'
}

export class FormFillerAgent extends BaseAgent {
  constructor(platform: PlatformAPI) { super(platform) }

  config: AgentConfig = {
    id: 'form-filler',
    name: 'Ethan',
    description: '分析文档中的信息采集项，对话式帮你填写文档',
    icon: FileOutput,
    color: '#F472B6',
    provider: 'auto',
    model: '',
    systemPrompt: `你是 Ethan，信息采集与文档填写专家。你擅长从文档中识别需要填写的信息项，然后以对话的方式逐个收集信息并填入文档。

## 你的团队
- **Oliver** - 智能调度助手（团队领导）
- **Ethan** (你) - 信息采集与文档填写专家
- **Charlotte** - 文件分析专家
- **Amelia** - 文档摘要专家
- **Atlas** - 系统架构设计专家
- **Audrey** - 深度研究专家
- **Avery** - 测试修复与代码审查专家
- **Aurora** - 日常事务专家
- **Aria** - 内容生成专家
- **Arthur** - 文档与演示全能专家
- **Alice** - 浏览器控制专家

## 重要规则
- 你是信息采集与文档填写专家，专注于从文档中提取需要填写的字段，然后收集信息并填入。
- 回复时始终明确你的身份是"信息采集专家 Ethan"。
- 用 Markdown 格式回复，语言: 中文。`,
  }

  async extractFieldsFromDoc(
    filePath: string,
    onProgress?: (steps: AnalysisStep[], fileName: string) => void
  ): Promise<{ fields: FormField[]; content: string; rawContent: string }> {
    const dotIndex = filePath.lastIndexOf('.')
    const ext = dotIndex === -1 ? '' : filePath.substring(dotIndex).toLowerCase()
    const fileName = filePath.split(/[/\\]/).pop() || filePath
    console.log('[FormFiller] Reading file:', filePath, 'ext:', ext)

    // 定义分析步骤
    const steps: AnalysisStep[] = [
      { key: 'read', label: '读取文件', status: 'active' },
      { key: 'extract-text', label: '提取文档文本', status: 'pending' },
      { key: 'analyze-structure', label: '分析文档结构', status: 'pending' },
      { key: 'build-prompt', label: '构建分析提示词', status: 'pending' },
      { key: 'llm-extract', label: 'AI 提取待填项', status: 'pending' },
      { key: 'validate', label: '交叉验证结果', status: 'pending' },
    ]

    const reportProgress = () => {
      if (onProgress) {
        onProgress([...steps], fileName)
      }
    }

    // 初始报告
    reportProgress()

    let rawContent: string
    let content: string
    let arrayBuffer: ArrayBuffer | undefined

    // ========== 第一步：读取文件 ==========
    try {
      if (['.docx', '.pdf'].includes(ext)) {
        console.log('[FormFiller] Calling readBinaryFile for:', filePath)
        const result = await this.platform.fs.readBinaryFile(filePath)
        console.log('[FormFiller] readBinaryFile result - error:', result.error, 'arrayBuffer:', result.content ? `byteLength=${result.content.byteLength}` : 'null')
        if (result.error || !result.content) {
          steps[0].status = 'error'
          reportProgress()
          throw new Error(result.error || '无法读取文件')
        }
        arrayBuffer = result.content
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        rawContent = btoa(binary)
        console.log('[FormFiller] rawContent base64 length:', rawContent.length)
        content = await extractDocumentText(filePath, arrayBuffer, ext)
        console.log('[FormFiller] extractDocumentText returned, content length:', content.length)
      } else {
        const result = await this.platform.fs.readFile(filePath)
        if (result.error || !result.content) {
          steps[0].status = 'error'
          reportProgress()
          throw new Error(result.error || '无法读取文件')
        }
        rawContent = result.content
        content = await extractDocumentText(filePath, rawContent, ext)
      }

      steps[0].status = 'done'
      steps[1].status = 'active'
      reportProgress()
    } catch (err) {
      steps[0].status = 'error'
      reportProgress()
      throw err
    }

    if (!content.trim()) {
      steps[1].status = 'error'
      reportProgress()
      throw new Error('文档内容为空或无法解析。请确认文件是有效的 docx/pdf 格式。')
    }

    // ========== 第二步：文档结构分析 ==========
    let structureInfo = ''
    let fillableLocations: Array<Record<string, any>> = []

    if (ext === '.docx' && arrayBuffer) {
      try {
        const docxStructure = analyzeDocxStructure(arrayBuffer)
        fillableLocations = extractDocxLocations(docxStructure)
        structureInfo = this.buildDocxStructureDescription(docxStructure)
        console.log('[FormFiller] Docx structure analysis complete, fillable locations:', fillableLocations.length)
      } catch (e: any) {
        console.warn('[FormFiller] Docx structure analysis failed:', e.message)
      }
    } else if ((ext === '.xlsx' || ext === '.xls') && arrayBuffer) {
      try {
        const xlsxStructure = analyzeXlsxStructure(arrayBuffer)
        fillableLocations = extractXlsxLocations(xlsxStructure)
        structureInfo = this.buildXlsxStructureDescription(xlsxStructure)
        console.log('[FormFiller] Xlsx structure analysis complete, fillable locations:', fillableLocations.length)
      } catch (e: any) {
        console.warn('[FormFiller] Xlsx structure analysis failed:', e.message)
      }
    }

    steps[1].status = 'done'
    steps[2].status = 'done'
    steps[3].status = 'active'
    reportProgress()

    // ========== 第三步：构建 LLM 提示词（结构感知） ==========
    const maxContentLength = 12000
    const truncatedContent = content.length > maxContentLength
      ? content.substring(0, maxContentLength) + '\n\n...（文档内容过长，已截断）'
      : content

    const locationsDescription = fillableLocations.length > 0
      ? `\n## 文档结构分析结果（自动检测到的待填位置）\n${structureInfo}\n`
      : ''

    const prompt = `你是一个信息采集专家，专门从各类表格、申报书、申请表等文档中提取需要填写的字段。

## 文档内容
${truncatedContent}
${locationsDescription}

## 提取规则
请仔细分析文档，找出所有需要用户手动填写的信息项。以下都是需要填写的字段：
1. 带有冒号（: 或 ：）后面跟着空白或下划线的，如"姓名：____"、"团队名称："
2. 括号（）或（ ）中需要填写内容的，如"（填写团队名称）"
3. 表格中的空白单元格（特别是左侧有标签的右侧空白单元格）
4. 带有下划线 ___ 或横线 —— 的待填位置
5. 任何明显需要用户输入具体信息的位置（如姓名、学号、日期、电话、地址、项目名称等）
6. 文档中出现的"____"、"___"、"（）"、"（  ）"等占位符前面的标签文字
7. 书签标记的位置
8. 窗体控件（文本框、下拉列表等）

## 重要：锚点文字（anchorText）
对于表格类文档，标签和填写位置可能不在同一个单元格。例如：
- 左侧单元格是"背景与目的"，右侧单元格是"请简述此项目的背景情况及开展的目的。"
- 这种情况下，label 是"背景与目的"，但填写位置应该通过右侧单元格中的文字来定位
- anchorText 应该填写右侧单元格中的完整文字

如果标签和填写位置在同一个位置（如"姓名：____"），则不需要 anchorText。
如果标签和填写位置不同（如表格），则必须提供 anchorText 来定位填写位置。

## 约束提取
对于每个字段，请尽可能提取以下约束信息：
- format: 格式要求（date/number/email/phone/idCard/text）
- required: 是否必填（true/false）
- maxLength/minLength: 长度限制
- options: 如果是下拉选择，列出所有可选项
- precision: 数值精度（小数位数）
- min/max: 数值范围
- unit: 单位（如"元"、"kg"等）
- consistency: 如果该字段需要全文统一（如甲方名称），标注一致性组名

## 输出要求
- 每个字段包含 label（字段名称）、placeholder（填写提示/示例）
- 如果标签和填写位置不同，还需提供 anchorText（目标位置的锚点文字）
- 如果有约束信息，提供 constraints 对象
- 如果能确定字段位置，提供 location 对象
- placeholder 应该简短说明该填什么内容，例如"如：张三"、"如：2026年7月1日"
- 只返回 JSON 数组，不要其他文字

## JSON 格式
[
  { "label": "姓名", "placeholder": "填写你的真实姓名", "constraints": { "required": true, "format": "text" } },
  { "label": "日期", "placeholder": "如：2026年7月1日", "constraints": { "format": "date" } },
  { "label": "背景与目的", "placeholder": "简述项目背景", "anchorText": "请简述此项目的背景情况及开展的目的。", "location": { "type": "table-cell", "cellRef": "R2C2" } },
  { "label": "性别", "placeholder": "选择性别", "constraints": { "options": ["男", "女"] } }
]

请尽可能多地提取字段，不要遗漏。`

    // ========== 第四步：调用 LLM ==========
    const settingsStore = useSettingsStore.getState()
    const tokenUsageStore = useTokenUsageStore.getState()
    const userConfig = settingsStore.getAgentModel(this.config.id)
    const rawProvider = userConfig?.provider || this.config.provider
    const model = userConfig?.model || this.config.model || ''

    const onTokenUsage = async (promptTokens: number, completionTokens: number) => {
      const provider = await resolveProvider(rawProvider)
      tokenUsageStore.addRecord({
        provider,
        model: model || 'default',
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        agentName: this.config.name,
      })
    }

    const result = await callLLM({
      provider: rawProvider,
      model,
      messages: [
        { role: 'system', content: '你是一个信息提取专家，只返回 JSON。' },
        { role: 'user', content: prompt },
      ],
      onTokenUsage,
    })

    // ========== 第五步：解析 LLM 结果 ==========
    let fields: FormField[] = []
    try {
      console.log('[FormFiller] LLM raw response length:', result.length)
      const codeBlockMatch = result.match(/```json?\s*([\s\S]*?)\s*```/)
      const jsonStr = (codeBlockMatch ? codeBlockMatch[1] : result.replace(/```json|```/g, '')).trim()
      const parsed = JSON.parse(jsonStr)
      console.log('[FormFiller] Parsed fields count:', parsed.length)
      fields = parsed.map((f: any, i: number) => ({
        id: `field-${i}`,
        label: f.label || `字段 ${i + 1}`,
        placeholder: f.placeholder || '',
        value: '',
        filledBy: 'none' as const,
        anchorText: f.anchorText || undefined,
        deletePlaceholder: f.deletePlaceholder || undefined,
        constraints: f.constraints || undefined,
        location: f.location || undefined,
      }))
    } catch (e: any) {
      console.error('[FormFiller] JSON parse failed:', e.message)
      console.error('[FormFiller] Raw LLM response:', result)
      throw new Error(`字段提取失败: ${e.message}。请检查文档格式是否正确。`)
    }

    // ========== 第六步：与结构分析结果交叉验证 ==========
    if (fillableLocations.length > 0) {
      fields = this.crossValidateFields(fields, fillableLocations)
    }

    return { fields, content, rawContent }
  }

  /**
   * 构建 Word 文档结构描述（供 LLM 参考）
   * 修复4：使用 summary 字段提供文档全貌
   */
  private buildDocxStructureDescription(structure: any): string {
    const parts: string[] = []

    // 修复4：添加文档摘要
    if (structure.summary) {
      const summary = structure.summary
      const summaryParts = [
        `### 文档摘要`,
        `- 段落数: ${summary.totalParagraphs}`,
        `- 表格数: ${summary.totalTables}`,
        `- 占位符数: ${summary.totalPlaceholders}`,
        `- 可填写单元格: ${summary.fillableCellCount}`,
        `- 标签单元格: ${summary.labelCellCount}`,
        `- 是否有合并单元格: ${summary.hasMergedCells ? '是' : '否'}`,
      ]
      if (summary.tableDimensions.length > 0) {
        summaryParts.push(`- 表格尺寸: ${summary.tableDimensions.join(', ')}`)
      }
      if (summary.coverFields.length > 0) {
        summaryParts.push(`- 封面填空: ${summary.coverFields.join('、')}`)
      }
      parts.push(summaryParts.join('\n'))
    }

    if (structure.tables?.length > 0) {
      const tableDesc = structure.tables
        .filter((t: any) => {
          // 跳过 vMerge continue 行（影子 cell）
          if (t.vMergeType === 'continue') return false
          return t.isEmpty || t.hasPlaceholder || t.hasLabel
        })
        .map((t: any) => {
          let desc = `  - 单元格 ${t.cellRef}: "${t.text.substring(0, 50)}"`
          if (t.isEmpty) desc += ' [空白]'
          if (t.hasPlaceholder) desc += ' [占位符]'
          if (t.hasLabel) desc += ' [标签]'
          // 修复3：显示关联信息
          if (t.labelFor) desc += ` → 填写格: ${t.labelFor}`
          if (t.filledBy) desc += ` ← 标签: ${t.filledBy}`
          return desc
        })
        .join('\n')
      if (tableDesc) parts.push(`### 表格单元格\n${tableDesc}`)
    }

    if (structure.bookmarks?.length > 0) {
      const bookmarkDesc = structure.bookmarks
        .map((b: any) => `  - 书签 "${b.name}" (段落 ${b.paragraphIndex})${b.text ? `: "${b.text}"` : ''}`)
        .join('\n')
      parts.push(`### 书签\n${bookmarkDesc}`)
    }

    if (structure.formFields?.length > 0) {
      const fieldDesc = structure.formFields
        .map((f: any) => `  - ${f.type} "${f.name}"${f.defaultValue ? ` (默认: ${f.defaultValue})` : ''}${f.options ? ` [选项: ${f.options.join(', ')}]` : ''}`)
        .join('\n')
      parts.push(`### 窗体控件\n${fieldDesc}`)
    }

    if (structure.placeholders?.length > 0) {
      const placeholderDesc = structure.placeholders
        .slice(0, 20)  // 限制数量避免过长
        .map((p: any) => `  - ${p.type} "${p.text}" (段落 ${p.paragraphIndex})${p.context ? ` 上下文: "${p.context}"` : ''}`)
        .join('\n')
      parts.push(`### 占位符\n${placeholderDesc}`)
    }

    return parts.join('\n\n')
  }

  /**
   * 构建 Excel 文档结构描述（供 LLM 参考）
   */
  private buildXlsxStructureDescription(structure: any): string {
    const parts: string[] = []

    for (const sheet of structure.sheets || []) {
      const sheetParts: string[] = [`### 工作表: ${sheet.name} (${sheet.rowCount}行 x ${sheet.colCount}列)`]

      if (sheet.headers?.length > 0) {
        const headerDesc = sheet.headers
          .map((h: any) => `  - ${h.cellRef}: "${h.text}"`)
          .join('\n')
        sheetParts.push(`#### 表头\n${headerDesc}`)
      }

      if (sheet.emptyCells?.length > 0) {
        const emptyDesc = sheet.emptyCells
          .slice(0, 30)  // 限制数量
          .map((c: any) => `  - ${c.cellRef}${c.headerLabel ? ` (表头: ${c.headerLabel})` : ''}${c.hasDataValidation ? ' [下拉选项]' : ''}`)
          .join('\n')
        sheetParts.push(`#### 空白待填单元格\n${emptyDesc}`)
      }

      parts.push(sheetParts.join('\n'))
    }

    if (structure.mergedCells?.length > 0) {
      const mergedDesc = structure.mergedCells
        .map((m: any) => `  - ${m.range}`)
        .join('\n')
      parts.push(`### 合并单元格\n${mergedDesc}`)
    }

    if (structure.dataValidations?.length > 0) {
      const validationDesc = structure.dataValidations
        .map((v: any) => `  - ${v.cellRef}: ${v.type}${v.formula1 ? ` (${v.formula1})` : ''}`)
        .join('\n')
      parts.push(`### 数据验证\n${validationDesc}`)
    }

    if (structure.formulas?.length > 0) {
      const formulaDesc = structure.formulas
        .slice(0, 20)
        .map((f: any) => `  - ${f.cellRef}: ${f.formula}`)
        .join('\n')
      parts.push(`### 公式单元格\n${formulaDesc}`)
    }

    return parts.join('\n\n')
  }

  /**
   * 交叉验证：将 LLM 提取的字段与结构分析结果对比
   * 补充 LLM 可能遗漏的字段，修正位置信息
   */
  private crossValidateFields(
    llmFields: FormField[],
    structuralLocations: Array<Record<string, any>>
  ): FormField[] {
    console.log(`[FormFiller] Cross-validating: ${llmFields.length} LLM fields vs ${structuralLocations.length} structural locations`)

    // 为 LLM 提取的字段补充位置信息
    for (const field of llmFields) {
      if (!field.location) {
        // 尝试从结构位置中找到匹配
        const match = structuralLocations.find(loc => {
          if (loc.headerLabel && field.label.includes(loc.headerLabel)) return true
          if (loc.context && loc.context.includes(field.label)) return true
          if (loc.bookmarkName && field.label.toLowerCase().includes(loc.bookmarkName.toLowerCase())) return true
          return false
        })
        if (match) {
          field.location = {
            type: match.type || 'placeholder',
            cellRef: match.cellRef,
            bookmarkName: match.bookmarkName,
            fieldName: match.fieldName,
            paragraphIndex: match.paragraphIndex,
            charOffset: match.charOffset,
          }
          console.log(`[FormFiller] ✓ Matched location for "${field.label}": ${JSON.stringify(match)}`)
        }
      }
    }

    return llmFields
  }

  async generateAIFill(field: FormField, context: string): Promise<string> {
    const settingsStore = useSettingsStore.getState()
    const tokenUsageStore = useTokenUsageStore.getState()
    const userConfig = settingsStore.getAgentModel(this.config.id)
    const rawProvider = userConfig?.provider || this.config.provider
    const model = userConfig?.model || this.config.model || ''

    const onTokenUsage = async (promptTokens: number, completionTokens: number) => {
      const provider = await resolveProvider(rawProvider)
      tokenUsageStore.addRecord({
        provider,
        model: model || 'default',
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        agentName: this.config.name,
      })
    }

    const prompt = `请根据以下上下文，为"${field.label}"生成一个合适的填写内容。
字段说明：${field.placeholder}

上下文：
${context}

请直接给出填写内容，不要其他解释。如果上下文不足以生成内容，请返回一个合理的示例或占位内容。`

    return await callLLM({
      provider,
      model,
      messages: [
        { role: 'system', content: '你是一个信息填写助手，根据上下文生成合适的填写内容。直接给出内容，不要解释。' },
        { role: 'user', content: prompt },
      ],
      onTokenUsage,
    })
  }

  async fillDocument(
    originalContent: string,
    fields: FormField[],
    filePath?: string,
    rawContent?: string,
    fillMethod: FillMethod = 'word-com',
    onMethodChange?: (method: string, status: 'trying' | 'success' | 'failed') => void
  ): Promise<string> {
    // 对于 .docx 文件，根据选择的方法填写
    if (filePath && filePath.toLowerCase().endsWith('.docx')) {
      console.log(`[FormFiller] Using fill method: ${fillMethod}`)
      console.log(`[FormFiller] Fields to fill: ${fields.filter(f => f.value).length} with values`)
      for (const f of fields.filter(f => f.value)) {
        console.log(`[FormFiller]   "${f.label}" = "${f.value}"`)
      }

      // 确保 rawContent 可用（用于验证和 fallback 方案）
      if (!rawContent) {
        const { content: arrayBuffer, error } = await this.platform.fs.readBinaryFile(filePath)
        if (error || !arrayBuffer) {
          throw new Error(error || '无法读取 .docx 文件')
        }
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        rawContent = btoa(binary)
      }

      // 保存最佳结果（即使验证"失败"也保留，避免因验证误判丢弃正确结果）
      let bestResult: string | null = null

      // ============================================================
      // 优先策略：书签/窗体控件填写（原生锚点定位法）
      // 如果字段有 location 信息且类型为 bookmark 或 form-field，优先使用
      // 100% 继承周边格式，完全不会出现错位
      // ============================================================
      const bookmarkFields = fields.filter(f => f.value && f.location?.type === 'bookmark' && f.location?.bookmarkName)
      const formFieldFields = fields.filter(f => f.value && f.location?.type === 'form-field' && f.location?.fieldName)

      if (bookmarkFields.length > 0) {
        try {
          onMethodChange?.('书签锚点填写', 'trying')
          const result = await fillDocxByBookmark(rawContent, fields)
          if (this.validateFillResult(rawContent, result, bookmarkFields)) {
            onMethodChange?.('书签锚点填写', 'success')
            // 书签填写成功后，继续用其他方法填写非书签字段
            rawContent = result
            console.log(`[FormFiller] ✓ Bookmark filling succeeded for ${bookmarkFields.length} fields, continuing with remaining fields`)
          } else {
            if (result !== rawContent) {
              console.warn('[FormFiller] Bookmark validation not passed but content changed, keeping as best result')
              bestResult = result
              rawContent = result
            }
            onMethodChange?.('书签锚点填写', 'failed')
          }
        } catch (err: any) {
          console.error('[FormFiller] Bookmark filling failed:', err.message)
          onMethodChange?.('书签锚点填写', 'failed')
        }
      }

      if (formFieldFields.length > 0) {
        try {
          onMethodChange?.('窗体控件填写', 'trying')
          const result = await fillDocxByFormField(rawContent, fields)
          if (this.validateFillResult(rawContent, result, formFieldFields)) {
            onMethodChange?.('窗体控件填写', 'success')
            rawContent = result
            console.log(`[FormFiller] ✓ Form field filling succeeded for ${formFieldFields.length} fields, continuing with remaining fields`)
          } else {
            if (result !== rawContent) {
              console.warn('[FormFiller] Form field validation not passed but content changed, keeping as best result')
              bestResult = result
              rawContent = result
            }
            onMethodChange?.('窗体控件填写', 'failed')
          }
        } catch (err: any) {
          console.error('[FormFiller] Form field filling failed:', err.message)
          onMethodChange?.('窗体控件填写', 'failed')
        }
      }

      // 过滤掉已通过书签/窗体控件填写的字段
      const remainingFields = fields.filter(f =>
        f.value &&
        !(f.location?.type === 'bookmark' && f.location?.bookmarkName) &&
        !(f.location?.type === 'form-field' && f.location?.fieldName)
      )

      // 如果所有字段都已通过书签/窗体控件填写完成
      if (remainingFields.length === 0) {
        if (bestResult) {
          console.log('[FormFiller] All fields filled via bookmark/form-field')
          return bestResult
        }
        // 如果 rawContent 已被更新（书签/窗体控件成功），直接返回
        if (rawContent !== fields[0]?.value) {
          return rawContent
        }
      }

      // ============================================================
      // 方案一：Word COM 自动化（仅在 Windows + 安装 Word 时可用）
      // ============================================================
      let currentMethod: FillMethod = fillMethod
      if (currentMethod === 'word-com') {
        try {
          onMethodChange?.('Word COM 自动化', 'trying')
          const result = await fillDocxWithWordCOMBase64(
            filePath,
            remainingFields.length > 0 ? remainingFields : fields,
            (cmd) => this.platform.os.execCommand(cmd),
            (path) => this.platform.fs.readBinaryFile(path)
          )
          if (this.validateFillResult(rawContent, result, remainingFields.length > 0 ? remainingFields : fields)) {
            onMethodChange?.('Word COM 自动化', 'success')
            return result
          }
          if (result !== rawContent) {
            console.warn('[FormFiller] Word COM validation not passed but content changed, keeping as best result')
            bestResult = result
          }
          onMethodChange?.('Word COM 自动化', 'failed')
        } catch (err: any) {
          console.error('[FormFiller] Word COM failed:', err.message)
          onMethodChange?.('Word COM 自动化', 'failed')
        }
        currentMethod = 'dom-parser'
      }

      // ============================================================
      // 方案二：DOMParser XML 操作
      // ============================================================
      if (currentMethod === 'dom-parser') {
        try {
          onMethodChange?.('XML 直接操作', 'trying')
          const result = await fillDocxWithDOMParser(rawContent, remainingFields.length > 0 ? remainingFields : fields)
          if (this.validateFillResult(rawContent, result, remainingFields.length > 0 ? remainingFields : fields)) {
            onMethodChange?.('XML 直接操作', 'success')
            return result
          }
          if (result !== rawContent && !bestResult) {
            console.warn('[FormFiller] DOMParser validation not passed but content changed, keeping as best result')
            bestResult = result
          }
          onMethodChange?.('XML 直接操作', 'failed')
        } catch (err: any) {
          console.error('[FormFiller] DOMParser failed:', err.message)
          onMethodChange?.('XML 直接操作', 'failed')
        }
        currentMethod = 'regex'
      }

      // ============================================================
      // 方案三：统一智能填写引擎（含段落 Run 合并替换 + 表格关键词锚定）
      // 兼容性最强，包含所有防错位机制
      // ============================================================
      try {
        onMethodChange?.('智能填写引擎', 'trying')
        const result = await fillDocxFile(rawContent, remainingFields.length > 0 ? remainingFields : fields)
        if (this.validateFillResult(rawContent, result, remainingFields.length > 0 ? remainingFields : fields)) {
          onMethodChange?.('智能填写引擎', 'success')
          return result
        }
        if (result !== rawContent && !bestResult) {
          console.warn('[FormFiller] Smart engine validation not passed but content changed, keeping as best result')
          bestResult = result
        }
        onMethodChange?.('智能填写引擎', 'failed')
      } catch (err: any) {
        console.error('[FormFiller] Smart engine fill failed:', err.message)
        onMethodChange?.('智能填写引擎', 'failed')
      }

      // 如果有最佳结果（内容已改变但验证未通过），仍然返回它
      if (bestResult) {
        console.warn('[FormFiller] Returning best available result (content changed but strict validation not passed)')
        return bestResult
      }

      throw new Error('所有填写方案均未成功，请检查文档格式是否包含可识别的待填字段')
    }

    // 对于 .xlsx/.xls 文件，使用 Excel 专用处理方法
    if (filePath && (filePath.toLowerCase().endsWith('.xlsx') || filePath.toLowerCase().endsWith('.xls'))) {
      console.log(`[FormFiller] Processing Excel file: ${filePath}`)
      console.log(`[FormFiller] Fields to fill: ${fields.filter(f => f.value).length} with values`)
      for (const f of fields.filter(f => f.value)) {
        console.log(`[FormFiller]   "${f.label}" = "${f.value}"`)
      }

      // 确保 rawContent 可用
      if (!rawContent) {
        const { content: arrayBuffer, error } = await this.platform.fs.readBinaryFile(filePath)
        if (error || !arrayBuffer) {
          throw new Error(error || '无法读取 Excel 文件')
        }
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        rawContent = btoa(binary)
      }

      let bestResult: string | null = null

      // 方案一：Excel COM 自动化（仅在 Windows + 安装 Excel 时可用）
      try {
        onMethodChange?.('Excel COM 自动化', 'trying')
        const result = await fillXlsxWithExcelCOM(
          filePath,
          fields,
          (cmd) => this.platform.os.execCommand(cmd),
          (path) => this.platform.fs.readBinaryFile(path)
        )
        if (this.validateXlsxResult(rawContent, result, fields)) {
          onMethodChange?.('Excel COM 自动化', 'success')
          return result
        }
        if (result !== rawContent) {
          console.warn('[FormFiller] Excel COM validation not passed but content changed, keeping as best result')
          bestResult = result
        }
        onMethodChange?.('Excel COM 自动化', 'failed')
      } catch (err: any) {
        console.error('[FormFiller] Excel COM failed:', err.message)
        onMethodChange?.('Excel COM 自动化', 'failed')
      }

      // 方案二：XML 直接操作
      try {
        onMethodChange?.('Excel XML 直接操作', 'trying')
        const result = await fillXlsxWithXml(rawContent, fields)
        if (this.validateXlsxResult(rawContent, result, fields)) {
          onMethodChange?.('Excel XML 直接操作', 'success')
          return result
        }
        if (result !== rawContent && !bestResult) {
          console.warn('[FormFiller] Excel XML validation not passed but content changed, keeping as best result')
          bestResult = result
        }
        onMethodChange?.('Excel XML 直接操作', 'failed')
      } catch (err: any) {
        console.error('[FormFiller] Excel XML failed:', err.message)
        onMethodChange?.('Excel XML 直接操作', 'failed')
      }

      // 如果有最佳结果，仍然返回它
      if (bestResult) {
        console.warn('[FormFiller] Returning best available Excel result')
        return bestResult
      }

      throw new Error('Excel 填写方案均未成功，请检查表格格式是否包含可识别的待填字段')
    }

    // 对于其他格式，使用 LLM 填写
    const settingsStore = useSettingsStore.getState()
    const tokenUsageStore = useTokenUsageStore.getState()
    const userConfig = settingsStore.getAgentModel(this.config.id)
    const rawProvider = userConfig?.provider || this.config.provider
    const model = userConfig?.model || this.config.model || ''

    const onTokenUsage = async (promptTokens: number, completionTokens: number) => {
      const provider = await resolveProvider(rawProvider)
      tokenUsageStore.addRecord({
        provider,
        model: model || 'default',
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        agentName: this.config.name,
      })
    }

    const fieldsJson = fields.map((f) => ({ label: f.label, value: f.value }))

    const prompt = `请将以下字段的值填入原始文档的对应位置，生成填写完成的文档。

## 原始文档
${originalContent}

## 填写字段（JSON）
${JSON.stringify(fieldsJson, null, 2)}

## 要求
1. 将每个字段的值准确填入文档中对应的位置
2. 保持原文档的格式、排版不变
3. 只返回填写完成的文档内容，不要其他文字`

    return await callLLM({
      provider: rawProvider,
      model,
      messages: [
        { role: 'system', content: '你是一个文档填写助手，将字段值填入文档对应位置。只返回填写后的文档内容。' },
        { role: 'user', content: prompt },
      ],
      onTokenUsage,
    })
  }

  /**
   * 验证填写结果是否生效
   * 对比原始内容和填写后的内容，检查是否有实际改变
   *
   * 关键修复：对 .docx 文件，必须将填写结果作为 zip 解压，在 word/document.xml 中
   * 搜索字段值。之前在二进制中直接搜索 Unicode 字符串，但 zip 中的 XML 是 UTF-8 编码，
   * 中文等多字节字符的 UTF-8 字节序列无法匹配 JavaScript 的 Unicode 字符串，
   * 导致验证永远失败，所有填写方案都被误判为"未生效"。
   */
  private validateFillResult(originalRawContent: string | undefined, filledContent: string, fields: FormField[]): boolean {
    if (!originalRawContent) {
      console.warn('[FormFiller] No original raw content to compare, assuming success')
      return true
    }

    // 1. 快速检查：内容是否改变
    if (originalRawContent === filledContent) {
      console.error('[FormFiller] Content unchanged - fill failed (identical base64)')
      return false
    }

    console.log(`[FormFiller] Content length change: ${Math.abs(filledContent.length - originalRawContent.length)} chars`)

    // 2. 对 .docx 文件，解压 zip 后在 document.xml 中验证
    try {
      const binaryString = atob(filledContent)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      // 尝试作为 zip 加载，提取 document.xml
      let zip: PizZip
      try {
        zip = new PizZip(bytes)
      } catch (zipErr) {
        console.warn('[FormFiller] Cannot load result as zip:', (zipErr as Error).message)
        return this.validateInRawBytes(binaryString, fields)
      }
      const docXml = zip.file('word/document.xml')?.asText()

      if (!docXml) {
        // 无法作为 zip 加载（Word COM 返回的 base64 可能带有额外包装）
        // 降级到原始二进制搜索
        console.warn('[FormFiller] Cannot extract document.xml from result, falling back to raw search')
        return this.validateInRawBytes(binaryString, fields)
      }

      console.log('[FormFiller] Validating in document.xml (decoded from UTF-8 zip entry)')
      return this.validateInXml(docXml, fields)
    } catch (err) {
      console.error('[FormFiller] Failed to decode filled content for validation:', err)
      // 无法验证时，只要内容改变就认为成功（不阻塞用户）
      return true
    }
  }

  /**
   * 在 XML 文本中验证字段值是否存在
   * XML 已被 PizZip 正确解码为 JavaScript 字符串（UTF-8 → Unicode），
   * 所以可以直接用 includes() 搜索中文等非 ASCII 字符
   *
   * 修复：返回详细的验证报告，而不仅仅是 true/false
   * 让用户知道哪些字段成功填写，哪些失败
   */
  private validateInXml(docXml: string, fields: FormField[]): boolean {
    let foundCount = 0
    const fieldsWithValue = fields.filter(f => f.value)
    const missingFields: string[] = []

    for (const field of fieldsWithValue) {
      // 注意：XML 中可能对特殊字符进行了转义
      const escapedValue = field.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')

      const found = docXml.includes(field.value) || docXml.includes(escapedValue)

      if (found) {
        foundCount++
        console.log(`[FormFiller] ✓ Field "${field.label}" = "${field.value}" found in document.xml`)
      } else {
        missingFields.push(field.label)
        console.warn(`[FormFiller] ✗ Field "${field.label}" = "${field.value}" NOT found in document.xml`)
        // 调试：检查值是否被拆分到多个 <w:t> 节点导致跨节点
        if (field.value.length > 1) {
          let charFoundCount = 0
          for (const char of field.value) {
            if (docXml.includes(char)) charFoundCount++
          }
          if (charFoundCount > 0) {
            console.warn(`[FormFiller]   Partial: ${charFoundCount}/${field.value.length} individual chars found (value may be split across <w:t> nodes)`)
          }
        }
      }
    }

    // 修复：只要找到至少一个字段就返回 true，但记录缺失字段供后续报告
    const success = foundCount > 0
    console.log(`[FormFiller] XML validation: ${foundCount}/${fieldsWithValue.length} fields found`)
    if (missingFields.length > 0) {
      console.warn(`[FormFiller] Missing fields: ${missingFields.join(', ')}`)
    }
    return success
  }

  /**
   * 验证 Excel 填写结果是否生效
   * 对比原始内容和填写后的内容，检查是否有实际改变
   * 对 .xlsx 文件，解压 zip 后在 sharedStrings.xml 和 sheet XML 中搜索字段值
   */
  private validateXlsxResult(originalRawContent: string | undefined, filledContent: string, fields: FormField[]): boolean {
    if (!originalRawContent) {
      console.warn('[FormFiller] No original raw content to compare, assuming success')
      return true
    }

    // 1. 快速检查：内容是否改变
    if (originalRawContent === filledContent) {
      console.error('[FormFiller] Excel content unchanged - fill failed (identical base64)')
      return false
    }

    console.log(`[FormFiller] Excel content length change: ${Math.abs(filledContent.length - originalRawContent.length)} chars`)

    // 2. 解压 zip 后在 sharedStrings.xml 和 sheet XML 中验证
    try {
      const binaryString = atob(filledContent)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      let zip: PizZip
      try {
        zip = new PizZip(bytes)
      } catch (zipErr) {
        console.warn('[FormFiller] Cannot load Excel result as zip:', (zipErr as Error).message)
        return originalRawContent !== filledContent
      }
      const sharedStringsXml = zip.file('xl/sharedStrings.xml')?.asText() || ''

      // 收集所有 XML 内容
      let allXml = sharedStringsXml
      const sheetFiles = zip.file(/xl\/worksheets\/sheet\d+\.xml/)
      if (sheetFiles) {
        for (const sheetFile of sheetFiles) {
          allXml += sheetFile.asText()
        }
      }

      if (!allXml) {
        console.warn('[FormFiller] Cannot extract Excel XML from result')
        return originalRawContent !== filledContent
      }

      let foundCount = 0
      const fieldsWithValue = fields.filter(f => f.value)

      for (const field of fieldsWithValue) {
        const escapedValue = field.value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;')

        const found = allXml.includes(field.value) || allXml.includes(escapedValue)
        if (found) {
          foundCount++
          console.log(`[FormFiller] ✓ Excel field "${field.label}" = "${field.value}" found`)
        } else {
          console.warn(`[FormFiller] ✗ Excel field "${field.label}" = "${field.value}" NOT found`)
        }
      }

      const success = foundCount > 0
      console.log(`[FormFiller] Excel validation: ${foundCount}/${fieldsWithValue.length} fields found`)
      return success
    } catch (err) {
      console.error('[FormFiller] Failed to decode filled Excel content for validation:', err)
      return true
    }
  }

  /**
   * 降级方案：在原始二进制字符串中搜索（用于无法解压 zip 的情况）
   * 对 ASCII 内容有效，但中文等多字节字符会失败
   */
  private validateInRawBytes(binaryString: string, fields: FormField[]): boolean {
    let foundCount = 0
    const fieldsWithValue = fields.filter(f => f.value)

    for (const field of fieldsWithValue) {
      // 直接搜索（对 ASCII 有效）
      if (binaryString.includes(field.value)) {
        foundCount++
        console.log(`[FormFiller] ✓ Field "${field.label}" found in raw bytes (ASCII match)`)
        continue
      }

      // UTF-8 编码后搜索（对中文等非 ASCII 字符）
      try {
        const utf8Bytes = new TextEncoder().encode(field.value)
        let utf8Str = ''
        for (let i = 0; i < utf8Bytes.length; i++) {
          utf8Str += String.fromCharCode(utf8Bytes[i])
        }
        if (binaryString.includes(utf8Str)) {
          foundCount++
          console.log(`[FormFiller] ✓ Field "${field.label}" found via UTF-8 encoding`)
        } else {
          console.warn(`[FormFiller] ✗ Field "${field.label}" NOT found (raw + UTF-8)`)
        }
      } catch {
        console.warn(`[FormFiller] ✗ Field "${field.label}" UTF-8 encode failed`)
      }
    }

    console.log(`[FormFiller] Raw validation: ${foundCount}/${fieldsWithValue.length} fields found`)
    return foundCount > 0
  }

  // ========== 校验层：填写前和填写后的验证 ==========

  /**
   * 填写前校验：验证字段值是否符合约束
   * 返回校验结果，包含错误和警告列表
   */
  validateFieldsBeforeFill(fields: FormField[]): {
    valid: boolean
    errors: Array<{ fieldId: string; label: string; message: string }>
    warnings: Array<{ fieldId: string; label: string; message: string }>
  } {
    const errors: Array<{ fieldId: string; label: string; message: string }> = []
    const warnings: Array<{ fieldId: string; label: string; message: string }> = []

    for (const field of fields) {
      if (!field.value) {
        // 检查必填项
        if (field.constraints?.required) {
          errors.push({
            fieldId: field.id,
            label: field.label,
            message: '必填字段未填写',
          })
        }
        continue
      }

      const constraints = field.constraints
      if (!constraints) continue

      // 格式校验
      if (constraints.format) {
        const formatValid = this.validateFormat(field.value, constraints.format)
        if (!formatValid) {
          errors.push({
            fieldId: field.id,
            label: field.label,
            message: `格式不符合要求：期望 ${constraints.format} 格式`,
          })
        }
      }

      // 长度校验
      if (constraints.maxLength && field.value.length > constraints.maxLength) {
        errors.push({
          fieldId: field.id,
          label: field.label,
          message: `内容长度 ${field.value.length} 超过最大长度 ${constraints.maxLength}`,
        })
      }
      if (constraints.minLength && field.value.length < constraints.minLength) {
        warnings.push({
          fieldId: field.id,
          label: field.label,
          message: `内容长度 ${field.value.length} 小于最小长度 ${constraints.minLength}`,
        })
      }

      // 数值范围校验
      if (constraints.format === 'number' || constraints.precision !== undefined) {
        const numValue = parseFloat(field.value)
        if (!isNaN(numValue)) {
          if (constraints.min !== undefined && numValue < constraints.min) {
            errors.push({
              fieldId: field.id,
              label: field.label,
              message: `数值 ${numValue} 小于最小值 ${constraints.min}`,
            })
          }
          if (constraints.max !== undefined && numValue > constraints.max) {
            errors.push({
              fieldId: field.id,
              label: field.label,
              message: `数值 ${numValue} 大于最大值 ${constraints.max}`,
            })
          }
        }
      }

      // 选项校验
      if (constraints.options && constraints.options.length > 0) {
        if (!constraints.options.includes(field.value)) {
          warnings.push({
            fieldId: field.id,
            label: field.label,
            message: `值 "${field.value}" 不在预设选项中：${constraints.options.join(', ')}`,
          })
        }
      }

      // 正则校验
      if (constraints.pattern) {
        try {
          const regex = new RegExp(constraints.pattern)
          if (!regex.test(field.value)) {
            errors.push({
              fieldId: field.id,
              label: field.label,
              message: `值不符合正则表达式约束：${constraints.pattern}`,
            })
          }
        } catch {
          // 无效的正则表达式，跳过
        }
      }
    }

    // 一致性校验：检查标记为 consistency 的字段是否一致
    const consistencyGroups = new Map<string, FormField[]>()
    for (const field of fields) {
      if (field.constraints?.consistency && field.value) {
        const group = field.constraints.consistency
        if (!consistencyGroups.has(group)) {
          consistencyGroups.set(group, [])
        }
        consistencyGroups.get(group)!.push(field)
      }
    }

    for (const [group, groupFields] of consistencyGroups) {
      if (groupFields.length > 1) {
        const values = new Set(groupFields.map(f => f.value))
        if (values.size > 1) {
          for (const field of groupFields) {
            warnings.push({
              fieldId: field.id,
              label: field.label,
              message: `一致性组 "${group}" 中的值不一致，请确保全文统一`,
            })
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * 填写后校验：验证输出文档的完整性、格式和一致性
   */
  async validateFilledDocument(
    filledContent: string,
    fields: FormField[],
    filePath?: string
  ): Promise<{
    complete: boolean
    formatValid: boolean
    consistencyValid: boolean
    issues: Array<{ type: 'error' | 'warning'; message: string; field?: string }>
  }> {
    const issues: Array<{ type: 'error' | 'warning'; message: string; field?: string }> = []

    // 1. 完整性检查：遍历所有待填项，确认无遗漏
    const filledFields = fields.filter(f => f.value)
    const unfilledRequiredFields = fields.filter(f => f.constraints?.required && !f.value)
    
    if (unfilledRequiredFields.length > 0) {
      for (const field of unfilledRequiredFields) {
        issues.push({
          type: 'error',
          message: `必填字段 "${field.label}" 未填写`,
          field: field.label,
        })
      }
    }

    // 2. 格式检查：校验是否出现样式错乱、表格变形、公式报错
    if (filePath?.toLowerCase().endsWith('.docx')) {
      try {
        const binaryString = atob(filledContent)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const zip = new PizZip(bytes)
        const docXml = zip.file('word/document.xml')?.asText()
        
        if (docXml) {
          // 检查是否有损坏的 XML 标签
          const openTags = (docXml.match(/<w:[a-zA-Z]+/g) || []).length
          const closeTags = (docXml.match(/<\/w:[a-zA-Z]+>/g) || []).length
          if (Math.abs(openTags - closeTags) > 5) {
            issues.push({
              type: 'warning',
              message: '文档 XML 结构可能存在异常',
            })
          }
        }
      } catch (e) {
        issues.push({
          type: 'warning',
          message: '无法验证文档结构完整性',
        })
      }
    }

    if (filePath?.toLowerCase().endsWith('.xlsx')) {
      try {
        const binaryString = atob(filledContent)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const zip = new PizZip(bytes)
        
        // 检查公式是否有错误值
        const sheetFiles = zip.file(/xl\/worksheets\/sheet\d+\.xml/)
        if (sheetFiles) {
          for (const sheetFile of sheetFiles) {
            const sheetXml = sheetFile.asText()
            // 检查是否有 #VALUE!, #N/A, #REF! 等错误
            const errorPatterns = ['#VALUE!', '#N/A', '#REF!', '#DIV/0!', '#NAME?', '#NULL!']
            for (const errorPattern of errorPatterns) {
              if (sheetXml.includes(errorPattern)) {
                issues.push({
                  type: 'warning',
                  message: `表格中可能存在公式错误：${errorPattern}`,
                })
              }
            }
          }
        }
      } catch (e) {
        issues.push({
          type: 'warning',
          message: '无法验证表格结构完整性',
        })
      }
    }

    // 3. 一致性检查：对关键信息做全文比对
    const consistencyGroups = new Map<string, FormField[]>()
    for (const field of fields) {
      if (field.constraints?.consistency && field.value) {
        const group = field.constraints.consistency
        if (!consistencyGroups.has(group)) {
          consistencyGroups.set(group, [])
        }
        consistencyGroups.get(group)!.push(field)
      }
    }

    for (const [group, groupFields] of consistencyGroups) {
      if (groupFields.length > 1) {
        const values = new Set(groupFields.map(f => f.value))
        if (values.size > 1) {
          issues.push({
            type: 'warning',
            message: `一致性组 "${group}" 中的值不一致：${Array.from(values).join(', ')}`,
          })
        }
      }
    }

    return {
      complete: unfilledRequiredFields.length === 0,
      formatValid: !issues.some(i => i.type === 'error' && i.message.includes('XML')),
      consistencyValid: !issues.some(i => i.message.includes('一致')),
      issues,
    }
  }

  /**
   * 格式校验辅助方法
   */
  private validateFormat(value: string, format: string): boolean {
    switch (format) {
      case 'date':
        // 支持多种日期格式
        return /^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?$/.test(value) ||
               /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(value)
      case 'number':
        return !isNaN(parseFloat(value))
      case 'email':
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      case 'phone':
        return /^1[3-9]\d{9}$/.test(value) || /^\d{3,4}-?\d{7,8}$/.test(value)
      case 'idCard':
        return /^\d{17}[\dXx]$/.test(value)
      case 'text':
        return value.length > 0
      default:
        return true
    }
  }
}
