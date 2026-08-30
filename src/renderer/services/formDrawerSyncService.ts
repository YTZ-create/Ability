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
import { parseDocxParagraphsFromBase64 } from '../utils/docxParagraphs'
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

/** 常量：问答记录 sheet 名（多 sheet 降级 / 无 cellRef 降级时答案写这里） */
export const QA_SHEET_NAME = '填写记录'
/** 连续失败降级阈值 */
const FAILURE_THRESHOLD = 3

class FormDrawerSyncService {
  /** 文档同步的文本模型（导入时的原始段落数组，答案就地更新后整体重建） */
  private _docModel: string[] | null = null
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
   * - .docx → 打开抽屉文档页，按原始段落导入
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

        // 单 sheet → 答案按 cellRef 精准回写；多 sheet → 答案写「填写记录」区
        if (sheets.length === 1) {
          this._targetSheetName = sheets[0].name
          this._qaSheetName = null
        } else {
          this._targetSheetName = null
          const ensured = officeService.ensureSheet(QA_SHEET_NAME)
          this._qaSheetName = ensured.success ? QA_SHEET_NAME : null
          this._qaRow = 0
        }
        setDrawerFeedback('sheets', result.message)
        return 'sheets'
      }

      // ── 文档路径 ──
      if (ext === '.docx') {
        if (!document.rawContent) return 'none'
        const paragraphs = await parseDocxParagraphsFromBase64(document.fileName, document.rawContent)
        if (!paragraphs.length) return 'none'
        return this._importDocParagraphs(paragraphs, document)
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

  /** 文档路径共用：打开抽屉文档页 + 整体重建导入 */
  private _importDocParagraphs(paragraphs: string[], document: FormDocument): DrawerSyncMode {
    const drawer = useOfficeDrawerStore.getState()
    this._docModel = [...paragraphs]
    this._docTitle = this._titleOf(document.fileName)

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

    // 整体重建编辑器（当前架构下唯一可靠的文档写入路径，见 officeService.ts 长注释）
    const result = officeService.prepareDocsImport(this._docModel, this._docTitle ?? undefined)
    if (!result.success) return { ok: false, message: result.message }

    setDrawerFeedback('docs', applied.inPlace ? `✓ 已填入：${this._truncate(field.label)}` : `✓ 已记录：${this._truncate(field.label)}`)
    return { ok: true, message: applied.inPlace ? '已填入文档对应位置' : '已追加到文档末尾' }
  }

  /**
   * 把答案应用到段落模型。策略按序尝试：
   * 1. anchorText 就地替换（deletePlaceholder=false 时保留占位文字并追加）
   * 2. 段落含字段 label 且带占位符（下划线/待填/冒号空）→ 替换占位符
   * 3. 文末追加问答行（label：value）
   * 全部策略都保留原始段落内容（不删除原文，只替换占位片段）
   */
  private _applyAnswerToParagraphs(
    paragraphs: string[],
    field: FormField,
    value: string
  ): { paragraphs: string[]; inPlace: boolean } {
    const model = [...paragraphs]

    // 策略 1：anchorText 锚点替换
    if (field.anchorText) {
      const idx = model.findIndex((p) => p.includes(field.anchorText!))
      if (idx >= 0) {
        const anchor = field.anchorText
        model[idx] =
          field.deletePlaceholder === false
            ? model[idx].replace(anchor, `${anchor}${value}`)
            : model[idx].replace(anchor, value)
        return { paragraphs: model, inPlace: true }
      }
    }

    // 策略 2：label + 占位符替换
    const placeholderRe = /_{2,}|＿{2,}|（待填）|\(待填\)|【待填】|：\s*$|:\s*$/
    if (field.label) {
      const idx = model.findIndex((p) => p.includes(field.label) && placeholderRe.test(p))
      if (idx >= 0) {
        model[idx] = model[idx].replace(placeholderRe, (m) => (m.endsWith('：') || m.endsWith(':') ? `${m}${value}` : value))
        return { paragraphs: model, inPlace: true }
      }
    }

    // 策略 3：文末追加问答行
    model.push(`${field.label || '答案'}：${value}`)
    return { paragraphs: model, inPlace: false }
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
        const blob = await officeService.exportDocument()
        if (!blob) return { success: false, error: '文档导出失败' }
        return { success: true, blob }
      }
      return { success: false, error: '抽屉同步未启用' }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  }

  // ──────────────── 会话收尾 ────────────────

  /** 会话结束/重开时清空内部状态（由 formFillStore.endSession 调用） */
  resetSession(): void {
    this._docModel = null
    this._docTitle = null
    this._targetSheetName = null
    this._qaSheetName = null
    this._qaRow = 0
    this._failures = 0
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

  /** 等待表格编辑器初始化完成（插件自动启用后 OfficePanel 需要一拍挂载） */
  private async _waitForSheets(timeoutMs = 5000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (officeService.sheetsInitialized) return true
      await new Promise((r) => setTimeout(r, 150))
    }
    return officeService.sheetsInitialized
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
