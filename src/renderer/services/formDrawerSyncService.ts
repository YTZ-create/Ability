/**
 * FormDrawerSyncService — Ethan 填写会话 ↔ 办公抽屉 的同步桥接层
 *
 * 职责（唯一同步通道，受 ethan-drawer-sync 能力开关保护）：
 * 1. autoImport：文件提取完成后自动导入办公抽屉（xlsx→工作表页 / docx+文本→文档页）
 * 2. syncAnswer：每答一题把答案写入抽屉（表格=按 cellRef 精准写格，文档=文本模型整体重建）
 * 3. exportFilled：完成后从 Univer 导出成品 Blob（FormFillView 落盘）
 *
 * 设计约束：
 * - 所有公开方法内部 try/catch，失败只记录、绝不抛出（同步永不阻塞问答主流程）
 * - 连续失败 3 次自动降级（返回 downgrade=true，由 store 把 drawerSyncMode 置 none）
 * - 不反向依赖 formFillStore（store 调服务，服务不调 store，避免循环依赖）
 */

import * as XLSX from 'xlsx'
import { officeService } from './officeService'
import { useOfficeDrawerStore } from '../stores/officeDrawerStore'
import { usePluginStore } from '../stores/pluginStore'
import { parseDocxRichDocumentFromBase64 } from '../utils/docxParagraphs'
import { docxRichToBlob } from '../utils/docxRichRenderer'
import { mergeAnswerIntoParagraph } from '../utils/docxAnswerMerge'
import type { DocxRichDocument } from '../utils/docxParagraphs'
import { getPlatform } from '../api/neutralino'
import type { FormDocument, FormField } from '../agents/formFiller'

export type DrawerSyncMode = 'sheets' | 'docs' | 'none'

export interface SyncAnswerResult {
  ok: boolean
  message: string
  /** 连续失败达到阈值，调用方应把 drawerSyncMode 降级为 'none' */
  downgrade?: boolean
}

export interface DrawerExportResult {
  success: boolean
  blob?: Blob
  error?: string
}

/** 文本模型每一行 → 富结构精确位置的路径（与 _docModel 并行） */
type SyncDocPath =
  | { type: 'paragraph'; blockIdx: number }
  | { type: 'table-row'; blockIdx: number; rowIdx: number; cellTexts: string[] }

/** 常量：问答记录 sheet 名（多 sheet 降级 / 无 cellRef 降级时答案写这里） */
export const QA_SHEET_NAME = '填写记录'
/** 连续失败降级阈值 */
const FAILURE_THRESHOLD = 3

class FormDrawerSyncService {
  /** 文档同步的文本模型（导入时的原始段落数组，答案就地更新后整体重建） */
  private _docModel: string[] | null = null
  /** 文档同步的富结构模型（仅 .docx 导入时设置；含表格/合并/边框，用于重建时完整还原排版） */
  private _docRich: DocxRichDocument | null = null
  /** 文本模型 → 富结构路径的并行映射（与 _docModel 索引一一对应） */
  private _docModelPaths: SyncDocPath[] | null = null
  private _docTitle: string | null = null
  /** 表格同步：cellRef 命中时的目标 sheet（单 sheet 文件） */
  private _targetSheetName: string | null = null
  /** 表格同步：问答记录 sheet（多 sheet / 无 cellRef 降级时用） */
  private _qaSheetName: string | null = null
  /** 问答记录追加行号 */
  private _qaRow = 0
  /** 连续失败计数 */
  private _failures = 0

  // ──────────────── 能力开关 ────────────────

  /** Ethan 抽屉同步开关是否开启（kill-switch） */
  isSyncEnabled(): boolean {
    return usePluginStore.getState().plugins.find((p) => p.id === 'ethan-drawer-sync')?.enabled ?? false
  }

  /** Univer 办公抽屉插件是否可用；不可用时自动启用（一次性，抽屉功能随之可用） */
  private _ensureOfficePlugin(): boolean {
    const store = usePluginStore.getState()
    const enabled = store.plugins.find((p) => p.id === 'univer-office')?.enabled ?? false
    if (enabled) return true
    try {
      store.toggle('univer-office')
      setDrawerFeedback('sheets', '已自动启用「办公文档 (Univer)」插件')
      return true
    } catch {
      return false
    }
  }

  // ──────────────── 自动导入 ────────────────

  /**
   * 文件提取完成后自动导入办公抽屉。返回同步模式（写入 formFillStore.drawerSyncMode）。
   * - .xlsx/.xls/.csv → 打开抽屉工作表页，构建真实命名多 sheet 工作簿
   * - .docx → 打开抽屉文档页，按富结构（含表格/合并/边框）导入
   * - .txt/.md/.html 等文本 → 文档页按行导入
   * - 其余（pdf/doc 等）→ 'none'（不支持抽屉同步，走原有纯对话路线）
   */
  async autoImport(document: FormDocument): Promise<DrawerSyncMode> {
    try {
      this.resetSession()
      if (!this.isSyncEnabled()) return 'none'
      if (!this._ensureOfficePlugin()) return 'none'

      const ext = this._extOf(document.fileName)
      const drawer = useOfficeDrawerStore.getState()

      // ── 表格路径 ──
      if (['.xlsx', '.xls', '.csv'].includes(ext)) {
        const sheets = await this._parseWorkbookSheets(document)
        if (!sheets.length) return 'none'

        drawer.open()
        drawer.setActiveKind('sheets')
        setDrawerFeedback('sheets', `正在导入 ${document.fileName}...`)

        if (!(await this._waitForSheets())) {
          setDrawerFeedback('sheets', '表格编辑器初始化超时，本次仅对话填写')
          return 'none'
        }

        const result = officeService.importWorkbookSheets(sheets, this._titleOf(document.fileName))
        if (!result.success) {
          setDrawerFeedback('sheets', `导入失败: ${result.message}`)
          return 'none'
        }

        // 同步策略（导入时即定型，避免中途 insertSheet 丢弃更早的写格——实测踩坑）：
        // - 单 sheet 且字段都有 cellRef → 答案精准写回原单元格
        // - 其余 → 立刻创建「填写记录」问答区，答案追加写入
        const needQaSheet =
          sheets.length > 1 || document.fields.some((f) => !f.location?.cellRef)
        if (!needQaSheet) {
          this._targetSheetName = sheets[0].name
          this._qaSheetName = null
          this._qaRow = 0
        } else {
          this._targetSheetName = null
          const ensured = officeService.ensureSheet(QA_SHEET_NAME)
          this._qaSheetName = ensured.success ? QA_SHEET_NAME : null
          this._qaRow = 0
        }
        setDrawerFeedback('sheets', result.message)
        return 'sheets'
      }

      // ── 文档路径（docx 走「富结构」含表格/合并/边框；不再压成纯文本）──
      if (ext === '.docx') {
        if (!document.rawContent) return 'none'
        const rich = await parseDocxRichDocumentFromBase64(document.fileName, document.rawContent)
        if (!rich.blocks.length) return 'none'
        return this._importDocRich(rich, document)
      }

      // 纯文本类（rawContent 即文件原文）
      if (['.txt', '.md', '.html', '.htm', '.json', '.yaml', '.yml', '.xml', '.rtf'].includes(ext)) {
        const text = document.rawContent ?? document.originalContent
        if (!text) return 'none'
        return this._importDocParagraphs(text.replace(/\r\n/g, '\n').split('\n'), document)
      }

      // pdf / doc 等不支持抽屉预览
      return 'none'
    } catch (err: any) {
      console.error('[FormDrawerSync] autoImport failed:', err)
      return 'none'
    }
  }

  /** 文档路径共用（纯文本）：打开抽屉文档页 + 整体重建导入 */
  private _importDocParagraphs(paragraphs: string[], document: FormDocument): DrawerSyncMode {
    const drawer = useOfficeDrawerStore.getState()
    this._docModel = [...paragraphs]
    this._docTitle = this._titleOf(document.fileName)
    this._docRich = null

    drawer.open()
    drawer.setActiveKind('docs')
    // 直调 prepareDocsImport（不走 importDocumentParagraphs 的 initialized 前置检查：
    // 首次导入时 docs 实例尚未初始化，bump 版本号后由 OfficePanel 容器 remount 完成 flush）
    const result = officeService.prepareDocsImport(paragraphs, this._docTitle)
    if (!result.success) {
      this._docModel = null
      return 'none'
    }
    setDrawerFeedback('docs', `已导入 ${document.fileName}`)
    return 'docs'
  }

  /**
   * 文档路径共用（富结构：含表格/合并/边框/列宽）：
   * - 展示侧用 prepareDocsImportRich 完整还原 docx 排版
   * - 答案同步侧维护一个「段落文本模型」_docModel 供 anchorText/占位符匹配
   * - 答案写入时：先把答案应用到 _docModel，再把改后的文本回写到 _docRich 对应段落，
   *   最后用 prepareDocsImportRich 重建 → 表格/合并/边框不丢，答案也写到正确位置
   */
  private _importDocRich(rich: DocxRichDocument, document: FormDocument): DrawerSyncMode {
    const drawer = useOfficeDrawerStore.getState()
    this._docRich = rich
    this._docModel = this._extractTextModel(rich)
    this._docTitle = this._titleOf(document.fileName)

    drawer.open()
    drawer.setActiveKind('docs')
    const result = officeService.prepareDocsImportRich(rich, this._docTitle)
    if (!result.success) {
      this._docRich = null
      this._docModel = null
      return 'none'
    }
    const tableCount = rich.blocks.filter((b) => b.type === 'table').length
    const paraCount = rich.blocks.filter((b) => b.type === 'paragraph').length
    const msg = tableCount > 0
      ? `已导入 ${document.fileName}（${paraCount} 段 + ${tableCount} 个表格）`
      : `已导入 ${document.fileName}`
    setDrawerFeedback('docs', msg)
    return 'docs'
  }

  /**
   * 从富结构文档中提取段落文本模型（供答案同步的 anchorText/占位符匹配使用）。
   * 表格行合并为 " ｜ " 分隔的单行（与旧 parseDocxParagraphs 行为一致，保证答案同步逻辑不变）。
   * 同时维护 _docModelPaths（与 _docModel 并行）记录每个文本行对应的富结构精确位置
   * （paragraph 块 / 表格某行的某单元格），答案写入时据此精准回写，避免索引错位。
   */
  private _extractTextModel(rich: any): string[] {
    const out: string[] = []
    const paths: SyncDocPath[] = []
    for (let bi = 0; bi < rich.blocks.length; bi++) {
      const block = rich.blocks[bi]
      if (block.type === 'paragraph') {
        out.push(this._paragraphToText(block.paragraph))
        paths.push({ type: 'paragraph', blockIdx: bi })
      } else if (block.type === 'table') {
        const table = block.table
        for (let ri = 0; ri < table.rows.length; ri++) {
          const row = table.rows[ri]
          const cells = row
            .map((c: any) => this._cellToText(c))
            .map((s: string) => s.trim())
          while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop()
          if (cells.some((s: string) => s !== '')) {
            out.push(cells.join(' ｜ '))
            paths.push({ type: 'table-row', blockIdx: bi, rowIdx: ri, cellTexts: cells })
          }
        }
      }
    }
    this._docModelPaths = paths
    return out
  }

  /** 段落→纯文本（拼接所有 run） */
  private _paragraphToText(p: any): string {
    return (p.runs || []).map((r: any) => r.text || '').join('')
  }

  /** 单元格→纯文本（多段落用空格连接；与旧 normalizeCellText 行为一致） */
  private _cellToText(c: any): string {
    const parts = (c.paragraphs || []).map((p: any) => this._paragraphToText(p))
    const all = parts.join('\n').split('\n').map((s: string) => s.trim()).filter((s: string) => s !== '')
    if (all.length === 0) return ''
    if (all.every((s: string) => Array.from(s).length === 1)) return all.join('')
    return all.join(' ')
  }

  /**
   * 把答案同步产生的 _docModel 改动回写到 _docRich 对应位置。
   * 使用 _docModelPaths（与 _docModel 并行，导入时建立）精确定位：
   * - paragraph 行 → 智能重写 runs（保留原 run 样式，仅替换"占位 runs"为 value run）
   * - table-row 行 → 对比该行前后 cell 文本，把发生变化的那个 cell 的段落 runs 重写
   * 找不到对应路径时退化为旧策略（数 paragraph 块），保证不丢答案。
   */
  private _applyTextModelToRich(oldText: string[], newText: string[]): void {
    if (!this._docRich) return
    const rich = this._docRich
    const min = Math.min(oldText.length, newText.length)
    for (let i = 0; i < min; i++) {
      if (oldText[i] === newText[i]) continue
      const path = this._docModelPaths?.[i]
      if (path && path.type === 'paragraph') {
        const blk = rich.blocks[path.blockIdx]
        if (blk && blk.type === 'paragraph') {
          this._mergeAnswerIntoParagraph(blk.paragraph, oldText[i], newText[i])
          continue
        }
      }
      if (path && path.type === 'table-row') {
        const blk = rich.blocks[path.blockIdx]
        if (blk && blk.type === 'table' && blk.table.rows[path.rowIdx]) {
          const row = blk.table.rows[path.rowIdx]
          const before = this._rowCellTexts(row)
          const after = newText[i].split(' ｜ ').map((s) => s.trim())
          this._applyTextToRowCells(row, before, after)
          continue
        }
      }
      // 兜底
      let paraCount = -1
      for (let j = 0; j < rich.blocks.length; j++) {
        if (rich.blocks[j].type === 'paragraph') {
          paraCount++
          if (paraCount === i) {
            this._mergeAnswerIntoParagraph(rich.blocks[j].paragraph, oldText[i], newText[i])
            break
          }
        }
      }
    }
  }

  /**
   * 把 answer 智能合并到一个段落里，保留原 run 的字体/粗体/字号。
   * 委托给 docxAnswerMerge.mergeAnswerIntoParagraph（纯函数，逻辑独立可测）。
   */
  private _mergeAnswerIntoParagraph(paragraph: any, oldText: string, newText: string): void {
    mergeAnswerIntoParagraph(paragraph, oldText, newText)
  }

  /** 表格行的所有 cell 文本（trim，剔除空尾列；与文本模型生成规则一致） */
  private _rowCellTexts(row: any[]): string[] {
    const cells = row.map((c) => this._cellToText(c)).map((s) => s.trim())
    while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop()
    return cells
  }

  /** 把 newText 按行应用回某行各 cell：找到变化 cell，智能合并（保留原 run 样式） */
  private _applyTextToRowCells(row: any[], before: string[], after: string[]): void {
    const n = Math.max(before.length, after.length)
    for (let k = 0; k < n; k++) {
      const b = before[k] ?? ''
      const a = after[k] ?? ''
      if (b === a) continue
      const cell = row[k]
      if (!cell) continue
      const target = cell.paragraphs?.[0]
      if (target) this._mergeAnswerIntoParagraph(target, b, a)
    }
  }

  // ──────────────── 答案同步 ────────────────

  /**
   * 把一条答案写入抽屉。由 formFillStore.updateField 调用（两条答题通道的汇合点）。
   * 任何失败都只记录不抛出；连续失败 3 次返回 downgrade=true。
   */
  syncAnswer(field: FormField, doc: FormDocument, mode: DrawerSyncMode): SyncAnswerResult {
    if (mode !== 'sheets' && mode !== 'docs') return { ok: true, message: '未启用同步' }
    try {
      const value = field.value
      const result =
        mode === 'sheets' ? this._syncAnswerToSheets(field, doc, value) : this._syncAnswerToDocs(field, value)
      if (result.ok) {
        this._failures = 0
      } else {
        this._failures++
      }
      return { ...result, downgrade: this._failures >= FAILURE_THRESHOLD }
    } catch (err: any) {
      console.error('[FormDrawerSync] syncAnswer failed:', err)
      this._failures++
      return { ok: false, message: err?.message ?? String(err), downgrade: this._failures >= FAILURE_THRESHOLD }
    }
  }

  /** 表格写入：优先 cellRef 精准定位，降级写入「填写记录」问答区 */
  private _syncAnswerToSheets(field: FormField, doc: FormDocument, value: string): SyncAnswerResult {
    const cellRef = field.location?.cellRef
    const pos = cellRef ? this._parseCellRef(cellRef) : null

    if (this._targetSheetName && pos) {
      const r = officeService.writeCell(this._targetSheetName, pos.row, pos.col, value)
      if (r.success) {
        setDrawerFeedback('sheets', `✓ 已写入 ${cellRef}：${this._truncate(value)}`)
        return { ok: true, message: r.message }
      }
      // 精准写格失败 → 降级问答区
    }

    if (!this._qaSheetName) {
      const ensured = officeService.ensureSheet(QA_SHEET_NAME)
      if (!ensured.success) return { ok: false, message: ensured.message }
      this._qaSheetName = QA_SHEET_NAME
      this._qaRow = 0
    }
    const r1 = officeService.writeCell(this._qaSheetName, this._qaRow, 0, field.label)
    const r2 = officeService.writeCell(this._qaSheetName, this._qaRow, 1, value)
    this._qaRow++
    if (r1.success && r2.success) {
      setDrawerFeedback('sheets', `✓ 已记录 ${this._truncate(field.label)}：${this._truncate(value)}`)
      return { ok: true, message: '已写入填写记录' }
    }
    return { ok: false, message: r2.message || r1.message }
  }

  /** 文档写入：就地替换（锚点/占位符），失败降级为文末追加问答行；每次走整体重建 */
  private _syncAnswerToDocs(field: FormField, value: string): SyncAnswerResult {
    if (!this._docModel) return { ok: false, message: '文档模型未初始化' }

    const applied = this._applyAnswerToParagraphs(this._docModel, field, value)
    this._docModel = applied.paragraphs

    // 整体重建编辑器（当前架构下唯一可靠的文档写入路径，见 officeService.ts 长注释）；
    // 透传同步反馈文案，避免容器重建完成时被通用导入文案覆盖
    const feedback = applied.inPlace
      ? `✓ 已填入：${this._truncate(field.label)}`
      : `✓ 已记录：${this._truncate(field.label)}`

    let result: { success: boolean; message: string }
    if (this._docRich) {
      // 富结构文档（.docx）：先把文本模型变化回写到富结构对应位置，再走富结构路径重建
      // → 表格/合并/边框不丢，答案也正确落到 Univer 渲染
      this._applyTextModelToRich(applied.oldParagraphs, applied.paragraphs)
      result = officeService.prepareDocsImportRich(this._docRich, this._docTitle ?? undefined, feedback)
    } else {
      // 纯文本路径
      result = officeService.prepareDocsImport(this._docModel, this._docTitle ?? undefined, feedback)
    }
    if (!result.success) return { ok: false, message: result.message }

    setDrawerFeedback('docs', feedback)
    return { ok: true, message: applied.inPlace ? '已填入文档对应位置' : '已追加到文档末尾' }
  }

  /**
   * 把答案应用到段落模型。策略按序尝试：
   * 1. anchorText 就地替换（deletePlaceholder=false 时保留占位文字并追加）
   * 2. 段落含字段 label 且带占位符（下划线/待填/冒号空）→ 替换占位符
   * 3. 文末追加问答行（label：value）
   * 全部策略都保留原始段落内容（不删除原文，只替换占位片段）
   * 返回值附带 oldParagraphs，供富结构文档（.docx）回写到 _docRich 使用。
   */
  private _applyAnswerToParagraphs(
    paragraphs: string[],
    field: FormField,
    value: string
  ): { paragraphs: string[]; inPlace: boolean; oldParagraphs: string[] } {
    const oldParagraphs = [...paragraphs]
    const model = [...paragraphs]

    // 策略 1：anchorText 锚点替换
    // 关键修复：anchorText 的语义是"定位填写位置"，而不是"要被 value 替换的整段文本"。
    // 正确语义是：value 应该出现在 anchorText 之后，而不是吃掉 anchorText。
    // - 若 anchorText 末尾是占位符（下划线/待填/方括号/省略号），则整段 anchorText
    //   替换为 value（label 已含在 anchorText 内）
    // - 否则在 anchorText 之后插入 value（保留 label + 已有内容）
    if (field.anchorText) {
      const idx = model.findIndex((p) => p.includes(field.anchorText!))
      if (idx >= 0) {
        const anchor = field.anchorText
        const placeholderTail = /[＿_＿]{2,}|（待填）|\(待填\)|【待填】|【[^【】]*】|\[[^\[\]]*\]|…{1,}$/
        if (placeholderTail.test(anchor)) {
          // anchorText 已含占位符 → 整段替换为 value
          model[idx] = model[idx].replace(anchor, value)
        } else {
          // anchorText 只是 label/位置 → 在 anchorText 之后插入 value
          const pos = model[idx].indexOf(anchor) + anchor.length
          model[idx] = model[idx].slice(0, pos) + value + model[idx].slice(pos)
        }
        return { paragraphs: model, inPlace: true, oldParagraphs }
      }
    }

    // 策略 2：label + 占位符替换
    const placeholderRe = /_{2,}|＿{2,}|（待填）|\(待填\)|【待填】|：\s*$|:\s*$/
    if (field.label) {
      const idx = model.findIndex((p) => p.includes(field.label) && placeholderRe.test(p))
      if (idx >= 0) {
        model[idx] = model[idx].replace(placeholderRe, (m) => (m.endsWith('：') || m.endsWith(':') ? `${m}${value}` : value))
        return { paragraphs: model, inPlace: true, oldParagraphs }
      }
    }

    // 策略 3：文末追加问答行
    model.push(`${field.label || '答案'}：${value}`)
    return { paragraphs: model, inPlace: false, oldParagraphs }
  }

  // ──────────────── 导出（M4 由 FormFillView 调用） ────────────────

  /** 从 Univer 导出当前抽屉内容为 Blob（sheets→xlsx / docs→docx） */
  async exportFilled(mode: DrawerSyncMode): Promise<DrawerExportResult> {
    try {
      if (mode === 'sheets') {
        const blob = await officeService.exportWorkbook()
        if (!blob) return { success: false, error: '工作簿导出失败' }
        return { success: true, blob }
      }
      if (mode === 'docs') {
        // 文档导出：优先用 docx 库「原样导出」富结构（表格/合并/边框全保留）。
        // 不要用 officeService.exportDocument() —— 那会把 Univer 的 dataStream 按行
        // 压平成纯文本 Paragraph，表格结构/合并全丢，导致成品排版错乱。
        if (this._docRich) {
          const blob = await docxRichToBlob(this._docRich)
          if (blob) return { success: true, blob }
        }
        const blob = await officeService.exportDocument()
        if (!blob) return { success: false, error: '文档导出失败' }
        return { success: true, blob }
      }
      return { success: false, error: '抽屉同步未启用' }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  }

  /**
   * 导出成品并落盘到原文件同目录（*_filled 后缀）：
   * - 目标已存在时自动加时间戳，绝不覆盖原文件或历史成品
   * - 写入后读回验证（字节长度一致），失败返回 error 由调用方回退到原有填写引擎
   */
  async exportFilledToDisk(
    mode: DrawerSyncMode,
    originalFilePath: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      const platform = getPlatform()
      if (!platform) return { success: false, error: 'Platform not available' }

      const exportResult = await this.exportFilled(mode)
      if (!exportResult.success || !exportResult.blob) {
        return { success: false, error: exportResult.error ?? '导出失败' }
      }
      const buffer = await exportResult.blob.arrayBuffer()

      let target = originalFilePath.replace(/\.([^.]+)$/, '_filled.$1')
      if (await this._fileExists(target)) {
        const d = new Date()
        const p = (n: number) => String(n).padStart(2, '0')
        const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
        target = originalFilePath.replace(/\.([^.]+)$/, `_filled_${stamp}.$1`)
      }

      const writeResult = await platform.fs.writeBinaryFile(target, buffer)
      if (!writeResult.success) {
        return { success: false, error: `写入文件失败: ${writeResult.error}` }
      }

      // 读回验证：字节长度必须一致（不做全量比对，导出内容来源即为内存数据）
      const readBack = await platform.fs.readBinaryFile(target)
      if (readBack.error || !readBack.content) {
        return { success: false, error: `写入验证失败：无法读取已写入的文件 — ${readBack.error}` }
      }
      if (readBack.content.byteLength !== buffer.byteLength) {
        return {
          success: false,
          error: `写入验证失败：写入 ${buffer.byteLength} 字节，读回 ${readBack.content.byteLength} 字节`,
        }
      }
      return { success: true, filePath: target }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  }

  /** 文件存在性探测（Neutralino getStats；不存在/不可达均视为不存在） */
  private async _fileExists(path: string): Promise<boolean> {
    try {
      const nl = (window as any).Neutralino
      if (!nl) return false
      await nl.filesystem.getStats(path)
      return true
    } catch {
      return false
    }
  }

  // ──────────────── 会话收尾 ────────────────

  /** 会话结束/重开时清空内部状态（由 formFillStore.endSession 调用） */
  resetSession(): void {
    this._docModel = null
    this._docModelPaths = null
    this._docRich = null
    this._docTitle = null
    this._targetSheetName = null
    this._qaSheetName = null
    this._qaRow = 0
    this._failures = 0
    officeService.clearSyncHandles()
  }

  // ──────────────── 内部工具 ────────────────

  private _extOf(fileName: string): string {
    const dot = fileName.lastIndexOf('.')
    return dot === -1 ? '' : fileName.substring(dot).toLowerCase()
  }

  private _titleOf(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, '')
  }

  private _truncate(s: string, n = 20): string {
    return s.length > n ? `${s.slice(0, n)}…` : s
  }

  /**
   * 解析 cellRef 为 0 基行列。兼容两种项目内格式：
   * - xlsxAnalyzer："A1"/"B12"（列字母 + 1 基行号）
   * - docxAnalyzer："R2C3"（1 基行/列）
   */
  private _parseCellRef(ref: string): { row: number; col: number } | null {
    try {
      const r1c1 = /^R(\d+)C(\d+)$/i.exec(ref.trim())
      if (r1c1) return { row: parseInt(r1c1[1], 10) - 1, col: parseInt(r1c1[2], 10) - 1 }
      const a1 = /^([A-Za-z]+)(\d+)$/.exec(ref.trim())
      if (a1) {
        let col = 0
        for (const ch of a1[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
        return { row: parseInt(a1[2], 10) - 1, col: col - 1 }
      }
      return null
    } catch {
      return null
    }
  }

  /** 等待表格编辑器初始化完成且活动工作簿就绪（插件自动启用后 OfficePanel 需要一拍挂载） */
  private async _waitForSheets(timeoutMs = 5000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (officeService.sheetsInitialized && officeService.getActiveWorkbook()) return true
      await new Promise((r) => setTimeout(r, 150))
    }
    return officeService.sheetsInitialized && !!officeService.getActiveWorkbook()
  }

  /** 重新以二进制读取源文件并解析为多 sheet 二维数组（rawContent 对二进制格式不可靠，必须重读） */
  private async _parseWorkbookSheets(
    document: FormDocument
  ): Promise<{ name: string; data: (string | number | boolean | null)[][] }[]> {
    const platform = getPlatform()
    if (!platform) return []
    const { content, error } = await platform.fs.readBinaryFile(document.filePath)
    if (error || !content) {
      console.error('[FormDrawerSync] 读取表格文件失败:', error)
      return []
    }
    const wb = XLSX.read(content, { type: 'array' })
    const sheets: { name: string; data: (string | number | boolean | null)[][] }[] = []
    for (const name of wb.SheetNames) {
      const data = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(wb.Sheets[name], {
        header: 1,
        defval: null,
      })
      // 跳过全空 sheet（XLSX 有时会产出空表）
      if (data.some((row) => (row ?? []).some((v) => v !== null && v !== undefined && v !== ''))) {
        sheets.push({ name, data })
      }
    }
    return sheets
  }
}

/** 反馈写入辅助：sheets/docs 各自独立反馈条 */
function setDrawerFeedback(kind: 'sheets' | 'docs', msg: string): void {
  const drawer = useOfficeDrawerStore.getState()
  if (kind === 'sheets') drawer.setSheetsFeedback(msg)
  else drawer.setDocsFeedback(msg)
}

/** 模块级单例 */
export const formDrawerSyncService = new FormDrawerSyncService()
