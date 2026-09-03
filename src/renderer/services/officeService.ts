/**
 * OfficeService — Univer 单例 + Facade API 封装
 *
 * 唯一隔离层：业务代码不直接依赖 Univer 内部 API
 * 模块级单例（非 Zustand），因为 univerAPI 是非响应式外部可变对象
 *
 * 支持两类编辑器实例（各自独立 Univer app，因两个 preset 都注册 UniverUIPlugin，不能共存于同一实例）：
 * - Sheets（电子表格，UniverSheetsCorePreset）
 * - Docs （文档，UniverDocsCorePreset）
 * 每个实例固定挂载在各自容器（持久 DOM），通过 display 切换可见性，避免卸载破坏实例。
 */

import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import sheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN'
import '@univerjs/preset-sheets-core/lib/index.css'
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core'
import docsCoreEnUS from '@univerjs/preset-docs-core/locales/en-US'
import docsCoreZhCN from '@univerjs/preset-docs-core/locales/zh-CN'
import '@univerjs/preset-docs-core/lib/index.css'
import { DocSkeletonManagerService } from '@univerjs/docs'
import { IRenderManagerService } from '@univerjs/engine-render'
import {
  TableAlignmentType,
  TableTextWrapType,
  TableSizeType,
  TableRowHeightRule,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  HorizontalAlign,
} from '@univerjs/core'
import * as XLSX from 'xlsx'
import { useOfficeDrawerStore } from '../stores/officeDrawerStore'
import { usePluginStore } from '../stores/pluginStore'
import type {
  DocxRichDocument,
  DocxRichBlock,
  DocxTable,
  DocxCell,
  DocxParagraph,
  DocxRun,
  DocxBorder,
} from '../utils/docxParagraphs'

type UniverAPI = any
type Workbook = any
type Worksheet = any

export interface OfficeCommandResult {
  success: boolean
  message: string
  data?: any
}

interface EditorContext {
  univer: any
  univerAPI: UniverAPI
  container: HTMLElement
  initialized: boolean
}

class OfficeService {
  /** 电子表格实例上下文 */
  private _sheets: EditorContext = { univer: null, univerAPI: null, container: null, initialized: false }
  /** 文档实例上下文 */
  private _docs: EditorContext = { univer: null, univerAPI: null, container: null, initialized: false }

  /** 初始化电子表格实例，挂载到指定容器 */
  initSheets(container: HTMLElement): boolean {
    if (this._sheets.initialized) return true

    try {
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        locales: {
          [LocaleType.EN_US]: mergeLocales([sheetsCoreEnUS]),
          [LocaleType.ZH_CN]: mergeLocales([sheetsCoreZhCN]),
        },
        presets: [
          UniverSheetsCorePreset({
            container,
          }),
        ],
      })

      this._sheets = { univer, univerAPI, container, initialized: true }
      return true
    } catch (err) {
      console.error('[OfficeService] initSheets failed:', err)
      return false
    }
  }

  /** 初始化文档实例，挂载到指定容器 */
  initDocs(container: HTMLElement): boolean {
    if (this._docs.initialized) return true

    try {
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        locales: {
          [LocaleType.EN_US]: mergeLocales([docsCoreEnUS]),
          [LocaleType.ZH_CN]: mergeLocales([docsCoreZhCN]),
        },
        presets: [
          UniverDocsCorePreset({
            container,
          }),
        ],
      })

      this._docs = { univer, univerAPI, container, initialized: true }
      return true
    } catch (err) {
      console.error('[OfficeService] initDocs failed:', err)
      return false
    }
  }

  get sheetsInitialized(): boolean {
    return this._sheets.initialized
  }

  get docsInitialized(): boolean {
    return this._docs.initialized
  }

  get sheetsAPI(): UniverAPI | null {
    return this._sheets.univerAPI
  }

  get docsAPI(): UniverAPI | null {
    return this._docs.univerAPI
  }

  // ──────────────── 电子表格方法 ────────────────

  /** 创建工作簿 */
  createWorkbook(name?: string): OfficeCommandResult {
    try {
      if (!this._sheets.univerAPI) return { success: false, message: 'Univer(表格) 未初始化' }
      const wb = this._sheets.univerAPI.createWorkbook(name ? { name } : {})
      return { success: true, message: '工作簿已创建', data: { id: wb?.getUnitId() } }
    } catch (err: any) {
      return { success: false, message: `创建工作簿失败: ${err.message}` }
    }
  }

  /** 获取当前活动工作簿 */
  getActiveWorkbook(): Workbook | null {
    if (!this._sheets.univerAPI) return null
    return this._sheets.univerAPI.getActiveWorkbook()
  }

  /** 获取当前活动工作表 */
  getActiveSheet(): Worksheet | null {
    try {
      const wb = this.getActiveWorkbook()
      if (!wb) return null
      return this._sheets.univerAPI?.getActiveSheet()
    } catch {
      return null
    }
  }

  /** 写入单元格范围 */
  writeRange(
    sheetName: string,
    startRow: number,
    startCol: number,
    data: (string | number | boolean | null)[][]
  ): OfficeCommandResult {
    try {
      if (!this._sheets.univerAPI) return { success: false, message: 'Univer(表格) 未初始化' }

      const wb = this.getActiveWorkbook()
      if (!wb) return { success: false, message: '无活动工作簿' }

      // 始终使用活动 sheet，不依赖 sheet 名匹配（导入时 sheet 名可能不一致）
      const sheet = wb.getActiveSheet()
      if (!sheet) return { success: false, message: '无活动工作表' }

      if (data.length === 0) return { success: true, message: '无数据可写入' }

      const rows = data.length
      const cols = data.reduce((m, row) => Math.max(m, row.length), 0)
      if (cols === 0) return { success: true, message: '无数据可写入' }

      // Univer 0.25 facade 的 Worksheet 没有 getCell/setValue 单格接口
      // 但 Range 提供 setValues(matrix) 可以一次性写入二维数组
      const lastRow = startRow + rows - 1
      const lastCol = startCol + cols - 1
      const range = sheet.getRange(startRow, startCol, lastRow, lastCol)
      if (!range) return { success: false, message: '无法获取写入区域' }

      // 规范化为矩形：不足的格子用 null 补齐
      const matrix: (string | number | boolean | null)[][] = []
      for (let r = 0; r < rows; r++) {
        const row: (string | number | boolean | null)[] = []
        for (let c = 0; c < cols; c++) {
          const v = data[r][c]
          row.push(v === undefined ? null : v)
        }
        matrix.push(row)
      }

      // 优先用 setValues（二维数组一次写入）；若不存在则降级逐格写入
      if (typeof range.setValues === 'function') {
        range.setValues(matrix)
      } else if (typeof sheet.getCell === 'function') {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const value = matrix[r][c]
            if (value !== null && value !== undefined) {
              sheet.getCell(startRow + r, startCol + c)?.setValue(value)
            }
          }
        }
      } else {
        return { success: false, message: '当前 Univer 版本不支持 Range/单元格写入' }
      }

      return { success: true, message: `已写入 ${rows} 行 × ${cols} 列数据` }
    } catch (err: any) {
      return { success: false, message: `写入失败: ${err.message}` }
    }
  }

  /** 设置单元格样式 */
  setStyle(
    sheetName: string,
    row: number,
    col: number,
    style: { bold?: boolean; italic?: boolean; fontSize?: number; color?: string }
  ): OfficeCommandResult {
    try {
      if (!this._sheets.univerAPI) return { success: false, message: 'Univer(表格) 未初始化' }

      const wb = this.getActiveWorkbook()
      if (!wb) return { success: false, message: '无活动工作簿' }

      const sheet = wb.getSheetByName(sheetName) || wb.getActiveSheet()
      if (!sheet) return { success: false, message: `找不到工作表: ${sheetName}` }

      const cell = sheet.getCell(row, col)
      if (!cell) return { success: false, message: `无效单元格 (${row},${col})` }

      if (style.bold !== undefined) cell.setBold?.(style.bold)
      if (style.italic !== undefined) cell.setItalic?.(style.italic)
      if (style.fontSize !== undefined) cell.setFontSize?.(style.fontSize)
      if (style.color !== undefined) cell.setFontColor?.(style.color)

      return { success: true, message: '样式已设置' }
    } catch (err: any) {
      return { success: false, message: `设置样式失败: ${err.message}` }
    }
  }

  // ──────────────── Ethan 抽屉同步扩展 ────────────────
  //
  // 只服务于 formDrawerSyncService（Ethan 答案实时写入办公抽屉），全部带兜底降级，
  // 不改动上方既有方法的行为。
  //
  // 关键实现约束：Univer 的单元注册是异步的——createWorkbook 返回后同拍内
  // getActiveWorkbook()/getSheetByName()/getSheets() 可能查不到新工作簿（实测），
  // 且多工作簿并存时"活动工作簿"语义不可靠。因此同步写入不依赖活动工作簿查询，
  // 而是在导入时缓存 FWorksheet 句柄（此时 getSheets() 已同步可用，导入方法
  // 内部用它做过校验），答案写入按句柄直达。

  /** Ethan 同步工作簿的 sheet 句柄缓存（sheetName → FWorksheet） */
  private _syncSheets: Map<string, any> = new Map()
  /** Ethan 同步工作簿句柄（供导出/清理） */
  private _syncWorkbook: Workbook | null = null

  /** 列出 Ethan 同步工作簿的全部 sheet 名（优先句柄缓存，未导入时回退活动工作簿） */
  getSheetNames(): string[] {
    try {
      if (this._syncSheets.size > 0) return Array.from(this._syncSheets.keys())
      const wb = this.getActiveWorkbook()
      if (!wb) return []
      return (wb.getSheets() || []).map((s: any) => s.getSheetName?.() ?? s.getName?.()).filter(Boolean)
    } catch {
      return []
    }
  }

  /**
   * 导入多 sheet 工作簿（真实命名 sheet）。
   * 与现有「导入」按钮同原则：复用当前渲染中的工作簿（新建 unit 不会成为渲染焦点，
   * 画布/导出都会停在旧 unit 上——实测踩坑），逐个 insertSheet + setValues 写入数据，
   * 最后清理原有的空白默认 sheet。导入成功后缓存 sheet 句柄供答案精准写入。
   */
  importWorkbookSheets(
    sheets: { name: string; data: (string | number | boolean | null)[][] }[],
    workbookName?: string
  ): OfficeCommandResult {
    try {
      if (!this._sheets.univerAPI) return { success: false, message: 'Univer(表格) 未初始化' }
      if (!sheets.length) return { success: false, message: '无可导入的工作表数据' }

      let wb = this.getActiveWorkbook()
      if (!wb) {
        // 无活动工作簿时兜底新建（此时新 unit 即渲染 unit，可接受）
        wb = this._sheets.univerAPI.createWorkbook(workbookName ? { name: workbookName } : {})
        if (!wb) return { success: false, message: '创建工作簿失败' }
      }
      if (workbookName) {
        try { (wb as any).setName?.(workbookName) } catch { /* 改名失败不影响数据 */ }
      }

      // 逐 sheet 建表 + 写入数据（insertSheet 返回句柄；数据用 setValues 矩形写入）
      const created: [string, any][] = []
      for (let i = 0; i < sheets.length; i++) {
        const s = sheets[i]
        const name = s.name || `Sheet${i + 1}`
        let ws = wb.insertSheet?.(name)
        if (!ws) return { success: false, message: `创建工作表失败: ${name}` }

        const rows = s.data.length
        const cols = s.data.reduce((m, row) => Math.max(m, row?.length ?? 0), 0)
        if (rows > 0 && cols > 0) {
          const matrix: (string | number | boolean | null)[][] = []
          for (let r = 0; r < rows; r++) {
            const row: (string | number | boolean | null)[] = []
            for (let c = 0; c < cols; c++) row.push(s.data[r]?.[c] ?? null)
            matrix.push(row)
          }
          // getRange 是 Google Sheets 风格签名：(row, col, numRows, numColumns)
          ws.getRange(0, 0, rows, cols)?.setValues?.(matrix)
        }
        created.push([name, ws])
      }

      // 清理原有空白 sheet（全部为空值的默认表），至少保留一个数据 sheet
      try {
        const existing = wb.getSheets?.() || []
        const createdIds = new Set(created.map(([, ws]) => ws.getSheetId?.()))
        for (const es of existing) {
          if (createdIds.has(es.getSheetId?.())) continue
          const isBlank = this._isSheetBlank(es)
          if (isBlank && created.length > 0) {
            wb.deleteSheet?.(es)
          }
        }
      } catch { /* 清理失败不影响数据 */ }

      // 缓存句柄（答案写入按句柄直达，不依赖活动工作簿查询）
      this._syncWorkbook = wb
      this._syncSheets = new Map(created)

      // 激活第一个数据 sheet
      try { wb.setActiveSheet?.(created[0][1]) } catch { /* skip */ }

      return {
        success: true,
        message: `已导入 ${sheets.length} 个工作表`,
        data: { id: wb.getUnitId?.(), sheetCount: sheets.length, sheetNames: created.map(([n]) => n) },
      }
    } catch (err: any) {
      return { success: false, message: `导入工作簿失败: ${err.message}` }
    }
  }

  /** 判断 sheet 是否全空（导入后清理默认空表用） */
  private _isSheetBlank(ws: any): boolean {
    try {
      const rows = ws.getMaxRows?.() ?? 0
      const cols = ws.getMaxColumns?.() ?? 0
      if (rows <= 0 || cols <= 0) return true
      const values = ws.getRange(0, 0, rows, cols)?.getValues?.() ?? []
      return !values.some((row: any[]) => row.some((v) => v !== null && v !== undefined && v !== ''))
    } catch {
      return false
    }
  }

  /** 按名称定位并写入单个单元格（xlsx 答案同步用；坐标 0 基；优先同步句柄，不依赖活动工作簿） */
  writeCell(sheetName: string, row: number, col: number, value: string | number | boolean): OfficeCommandResult {
    try {
      if (!this._sheets.univerAPI) return { success: false, message: 'Univer(表格) 未初始化' }

      let sheet = this._syncSheets.get(sheetName) ?? null
      if (!sheet) {
        const wb = this.getActiveWorkbook()
        if (!wb) return { success: false, message: '无活动工作簿' }
        sheet = (sheetName ? wb.getSheetByName(sheetName) : null) || wb.getActiveSheet()
      }
      if (!sheet) return { success: false, message: `找不到工作表: ${sheetName}` }

      const range = sheet.getRange(row, col, 1, 1)
      if (!range || typeof range.setValues !== 'function') {
        return { success: false, message: '当前 Univer 版本不支持单元格写入' }
      }
      range.setValues([[value]])
      return { success: true, message: `已写入 ${sheetName || '活动工作表'} (${row + 1},${col + 1})` }
    } catch (err: any) {
      return { success: false, message: `写入单元格失败: ${err.message}` }
    }
  }

  /** 按名称激活工作表（尽力而为，失败不影响数据写入） */
  activateSheet(sheetName: string): OfficeCommandResult {
    try {
      if (!this._sheets.univerAPI) return { success: false, message: 'Univer(表格) 未初始化' }
      let sheet = this._syncSheets.get(sheetName) ?? null
      let wb: Workbook | null = this._syncWorkbook
      if (!sheet) {
        wb = this.getActiveWorkbook()
        if (!wb) return { success: false, message: '无活动工作簿' }
        sheet = wb.getSheetByName(sheetName)
      }
      if (!sheet) return { success: false, message: `找不到工作表: ${sheetName}` }
      wb?.setActiveSheet?.(sheet)
      return { success: true, message: `已切换到 ${sheetName}` }
    } catch (err: any) {
      return { success: false, message: `切换工作表失败: ${err.message}` }
    }
  }

  /** 清空 Ethan 同步句柄缓存（会话结束时调用，防止跨会话误写） */
  clearSyncHandles(): void {
    this._syncSheets = new Map()
    this._syncWorkbook = null
  }

  /** 确保 sheet 存在（不存在则创建），用于「填写记录」问答区 */
  ensureSheet(sheetName: string): OfficeCommandResult {
    try {
      if (!this._sheets.univerAPI) return { success: false, message: 'Univer(表格) 未初始化' }
      if (this._syncSheets.has(sheetName)) {
        return { success: true, message: `工作表 ${sheetName} 已存在` }
      }
      const wb = this._syncWorkbook ?? this.getActiveWorkbook()
      if (!wb) return { success: false, message: '无活动工作簿' }
      const existing = wb.getSheetByName?.(sheetName)
      if (existing) {
        this._syncSheets.set(sheetName, existing)
        return { success: true, message: `工作表 ${sheetName} 已存在` }
      }
      const ws = wb.insertSheet?.(sheetName)
      if (!ws) return { success: false, message: `创建工作表失败: ${sheetName}` }
      this._syncSheets.set(sheetName, ws)
      return { success: true, message: `已创建工作表 ${sheetName}` }
    } catch (err: any) {
      return { success: false, message: `确保工作表失败: ${err.message}` }
    }
  }

  // ──────────────── 文档方法 ────────────────
  //
  // 核心事实：Univer 文档的换行由 body.paragraphs 数组驱动（每段一个 {startIndex}，
  // 指向 dataStream 中该段段落标记 \r 的位置；dataStream 末尾的 \n 是分节符）。
  // facade 的 insertText / insertParagraph 只往 dataStream 写字符、不维护 paragraphs
  // 数组，渲染时全部内容会挤成一个段落（导入内容全排在第一行的根因）。
  // 因此所有内容写入都走「整体重建 body + 替换文档单元」，不使用增量插入命令。

  /**
   * 把纯文本构建为 Univer 文档数据（{ body, documentStyle }）：
   * \r 为段落标记、\n 为分节符，paragraphs 逐段登记标记索引。
   * documentStyle 是与 body 平级的字段，必须显式提供（取自 Univer 内置空快照的默认值）——
   * DocumentDataModel 只在传入完全空对象时才使用内置默认，缺 documentStyle 会导致页面尺寸/边距缺失、排版错乱。
   */
  buildDocData(text: string, pageWidth?: number): any {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines = normalized.split('\n')
    let dataStream = ''
    const paragraphs: { startIndex: number; paragraphStyle: any }[] = []
    for (const line of lines) {
      dataStream += line + '\r'
      paragraphs.push({
        startIndex: dataStream.length - 1,
        paragraphStyle: { spaceAbove: { v: 0 }, lineSpacing: 1.5, spaceBelow: { v: 8 } },
      })
    }
    dataStream += '\n'
    return {
      body: {
        dataStream,
        paragraphs,
        sectionBreaks: [{ startIndex: dataStream.length - 1 }],
      },
      documentStyle: this._buildDocumentStyle(pageWidth),
    }
  }

  /**
   * 把富结构 docx 文档构建为 Univer 文档数据（保留段落 + 表格 + 合并 + 边框）。
   *
   * 输出 body 字段：
   * - dataStream：含 TABLE_START/END/ROW_START/END/CELL_START/END 控制符
   * - paragraphs：所有段落（含表格内段落）的 startIndex 列表
   * - sectionBreaks：表格每个单元格结束处的分节符
   * - textRuns：每个 run 的样式（粗体 / 字号 / 字体）
   * - tables：{ startIndex, endIndex, tableId } 列表
   *
   * 输出顶层 tableSource：{ [tableId]: { tableId, tableRows, tableColumns, ... } }
   * 含 cell.rowSpan / columnSpan / margin / borderXxx / content / textRuns。
   */
  buildDocDataFromRich(doc: DocxRichDocument, pageWidth?: number): any {
    // Univer 数据流控制符（来自 DataStreamTreeTokenType，定义在 @univerjs/core/types/docs/data-model/types.d.ts）
    const T = {
      PARAGRAPH: '\r',
      SECTION_BREAK: '\n',
      TABLE_START: '\u001A',
      TABLE_END: '\u000F',
      TABLE_ROW_START: '\u001B',
      TABLE_ROW_END: '\u000E',
      TABLE_CELL_START: '\u001C',
      TABLE_CELL_END: '\u001D',
      DOCS_END: '\0',
    } as const

    // 文档容器宽度：
    // - pageWidth 传入的是像素（来自 container.clientWidth，Univer 页面 pageSize.width 单位就是像素）
    // - DOCX 列宽单位是 twip，需要转换为像素：96dpi ≈ 1px = 15 twip
    // - Univer 在 createTableSkeleton 中会再次减去页面 marginLeft + marginRight（当前是 20 + 20 = 40px）
    // - 所以 containerTwip 必须用 (actualPageWidth - 页面边距总和) 作为基准，保证表格不会超出可用宽度
    // 与 _buildDocumentStyle 保持一致，否则容器宽可能超过/小于实际页面宽
    const actualPageWidth = Math.max(280, Math.min(1160, pageWidth ?? 960))  // actualPageWidth 是像素（页面总宽）
    const pageMarginLeftRight = 40  // _buildDocumentStyle 中 marginLeft + marginRight = 20 + 20
    const availableWidth = actualPageWidth - pageMarginLeftRight  // 实际可用宽度（像素）
    const containerTwip = Math.max(2000, Math.round(availableWidth * 15))  // containerTwip 是 twip（基于可用宽度）

    let dataStream = ''
    const paragraphs: { startIndex: number; paragraphStyle: any }[] = []
    const sectionBreaks: { startIndex: number }[] = []
    const textRuns: { st: number; ed: number; ts: any }[] = []
    const tables: { startIndex: number; endIndex: number; tableId: string }[] = []
    const tableSource: Record<string, any> = {}

    const pushParagraph = (p: DocxParagraph, inheritTwipFont?: { fontSize?: number; fontFamily?: string }) => {
      // 段落样式
      const paraStyle: any = {
        spaceAbove: { v: 0 },
        lineSpacing: 1.5,
        spaceBelow: { v: 2 },
      }
      if (p.align === 'center') paraStyle.horizontalAlign = HorizontalAlign.CENTER
      else if (p.align === 'right') paraStyle.horizontalAlign = HorizontalAlign.RIGHT
      else if (p.align === 'both' || p.align === 'justify') paraStyle.horizontalAlign = HorizontalAlign.JUSTIFIED
      else if (p.align === 'left') paraStyle.horizontalAlign = HorizontalAlign.LEFT

      // runs：空段落也要打 \r 占位（Univer 段落标记）
      if (p.runs.length === 0) {
        dataStream += T.PARAGRAPH
        paragraphs.push({ startIndex: dataStream.length - 1, paragraphStyle: paraStyle })
        return
      }
      for (let i = 0; i < p.runs.length; i++) {
        const run = p.runs[i]
        const isLast = i === p.runs.length - 1
        const runStart = dataStream.length
        dataStream += run.text
        const runEnd = dataStream.length
        if (runEnd > runStart) {
          const ts: any = {}
          if (run.bold) ts.b = true
          // DOCX 字号单位是半点（pt × 2）；Univer 用 pt，所以 /2
          const fontSizePt = run.fontSize != null ? run.fontSize / 2 : inheritTwipFont?.fontSize
          if (fontSizePt) ts.s = fontSizePt
          if (run.fontFamily || inheritTwipFont?.fontFamily) {
            ts.ff = run.fontFamily || inheritTwipFont!.fontFamily
          }
          if (Object.keys(ts).length) {
            textRuns.push({ st: runStart, ed: runEnd, ts })
          }
        }
        if (isLast) {
          dataStream += T.PARAGRAPH
          // 重要：startIndex 必须指向 \r 的位置（dataStream.length - 1），
          // 不能指向段落文本起始位置，否则 Univer 段落样式会应用到错误范围。
          paragraphs.push({ startIndex: dataStream.length - 1, paragraphStyle: paraStyle })
        }
      }
    }

    // 生成 6 位字母数字 tableId（Univer 内置格式），冲突概率极低
    const newTableId = (): string => {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
      let id = ''
      for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)]
      return id
    }

    const buildTable = (t: DocxTable) => {
      const tableId = newTableId()
      console.log(`[OfficeService] buildTable: tableId=${tableId}, colCount=${t.colCount}, columnWidths=${JSON.stringify(t.columnWidths)}`)
      // ── 列宽计算策略 ──
      // 1. 有有效列宽且合理（>= 500 twip/列）：按比例缩放，不放大
      // 2. 列宽存在但太小（< 500 twip/列）：说明 DOCX 用的是百分比或自动宽度，
      //    实际意图是占满页面，此时视为"无有效列宽"，用等分宽
      // 3. 无有效列宽：单列占满容器宽，多列按容器宽均分（最小 1500 twip）
      // 关键：每个列宽必须 >= 最小宽度，保证 cell.pageWidth - marginLeft - marginRight > 0
      //       否则 Univer 在 createNullCellPage 计算出负的可用宽度报错
      const MIN_COL_TWIP = 500
      const MIN_COL_AFTER_MARGIN = 100  // 减去 margin 后至少保证 100 twip
      const docxTotalW = t.columnWidths?.reduce((a, b) => a + b, 0) ?? 0
      const hasValidWidths = docxTotalW > 0 && t.columnWidths!.every((w) => w >= MIN_COL_TWIP)
      let scaledWidths: number[]
      if (hasValidWidths) {
        const scale = Math.min(1, containerTwip / docxTotalW)
        scaledWidths = []
        for (let i = 0; i < t.colCount; i++) {
          // 保证每个列宽至少 MIN_COL_TWIP，减去 cell margin (2+2=4) 后仍然足够
          scaledWidths.push(Math.max(MIN_COL_TWIP, Math.round((t.columnWidths?.[i] ?? 0) * scale)))
        }
        // 精度对齐：确保列宽总和精确等于 containerTwip，避免四舍五入误差
        let totalScaled = scaledWidths.reduce((a, b) => a + b, 0)
        if (totalScaled !== containerTwip && scaledWidths.length > 0) {
          const diff = containerTwip - totalScaled
          if (diff !== 0) {
            // 差值加到最后一列，保持前面的比例不变
            scaledWidths[scaledWidths.length - 1] += diff
            // 确保不小于 MIN_COL_TWIP
            if (scaledWidths[scaledWidths.length - 1] < MIN_COL_TWIP) {
              scaledWidths[scaledWidths.length - 1] = MIN_COL_TWIP
            }
          }
        }
      } else {
        if (t.colCount === 1) {
          // 单列表：默认占满容器宽
          scaledWidths = [containerTwip]
        } else {
          // 多列表：均分容器宽（最小 1500 twip ≈ 1 英寸，保证可读）
          const perCol = Math.max(1500, Math.floor(containerTwip / t.colCount))
          scaledWidths = new Array(t.colCount).fill(perCol)
          // 精度对齐
          let totalScaled = scaledWidths.reduce((a, b) => a + b, 0)
          if (totalScaled !== containerTwip && scaledWidths.length > 0) {
            const diff = containerTwip - totalScaled
            scaledWidths[scaledWidths.length - 1] += diff
          }
        }
      }
      // 最终安全检查：每个列宽必须保证至少 MIN_COL_TWIP
      // 这一步避免了因合并单元格导致某些列实际宽度极小，减去 margin 后变负
      for (let i = 0; i < scaledWidths.length; i++) {
        scaledWidths[i] = Math.max(MIN_COL_TWIP, scaledWidths[i])
      }
      // 列宽之和与表尺寸保持一致
      const tableWidthTwip = scaledWidths.reduce((a, b) => a + b, 0)

      // ── 关键：单位转换 ──
      // DOCX 列宽单位是 twip（1px = 15 twip @96dpi）
      // Univer tableColumns[].size.width.v 期望单位是像素！
      // 所以需要将 twip → 像素：px = twip / 15
      const tableColumnsPx = scaledWidths.map(w => ({ size: { type: TableSizeType.SPECIFIED, width: { v: Math.max(10, Math.round(w / 15)) } } }))
      const tableWidthPx = Math.round(tableWidthTwip / 15)

      // ── 写 dataStream（行/单元格 tokens + 单元格段落）──
      const tableStart = dataStream.length
      dataStream += T.TABLE_START

      const tableRows: any[] = []
      for (const row of t.rows) {
        dataStream += T.TABLE_ROW_START
        const tableCells: any[] = []
        const tableRow: any = {
          tableCells,
          trHeight: { val: { v: 30 }, hRule: TableRowHeightRule.AUTO },
        }
        tableRows.push(tableRow)
        for (const cell of row) {
          // vMerge=continue 的占位格：Univer 要求 rowSpan=0 表示"被上方吞掉"
          // 注意：不能设 columnSpan=0，那表示"被左侧吞掉"——纵向合并不改变列位置
          // 关键：必须加 SECTION_BREAK 才能让控制符索引正确！每个 CELL 不管是否有内容，
          // CELL_END 之前必须有一个分节符，否则后续所有控制符都会错位。
          if (cell.vMerge === 'continue' && cell.paragraphs.every((p) => p.empty)) {
            tableCells.push({
              rowSpan: 0,
              margin: { start: { v: 2 }, end: { v: 2 }, top: { v: 2 }, bottom: { v: 2 } },
            })
            // 空占位格也必须：CELL_START → 空段落 → SECTION_BREAK → CELL_END
            // 空段落必须有一个 PARAGRAPH(\r)，否则 paragraph 索引还是错
            dataStream += T.TABLE_CELL_START
            dataStream += T.PARAGRAPH  // 空段落必须一个 \r
            paragraphs.push({
              startIndex: dataStream.length - 1,
              paragraphStyle: { spaceAbove: { v: 0 }, lineSpacing: 1.5, spaceBelow: { v: 2 } },
            })
            sectionBreaks.push({ startIndex: dataStream.length })
            dataStream += T.SECTION_BREAK + T.TABLE_CELL_END
            continue
          }
          // 真实格子：写 tokens + 段落内容
          dataStream += T.TABLE_CELL_START
          // 单元格内的每个段落
          for (let pi = 0; pi < cell.paragraphs.length; pi++) {
            pushParagraph(cell.paragraphs[pi])
          }
          // 单元格结束：分节符 + CELL_END
          sectionBreaks.push({ startIndex: dataStream.length })
          dataStream += T.SECTION_BREAK + T.TABLE_CELL_END

          // 构造 Univer tableCell
          const univerCell: any = {
            margin: this._buildCellMargin(cell),
          }
          if (cell.colSpan > 1) univerCell.columnSpan = cell.colSpan
          // 纵向合并：vMerge=restart 表示新合并列的顶端（需设置 rowSpan 跨越行数）；
          // continue 表示被上方吞掉（已在上面 continue 分支处理）
          if (cell.vMerge === 'continue') univerCell.rowSpan = 0
          if (cell.rowSpan && cell.rowSpan > 1) univerCell.rowSpan = cell.rowSpan
          const borders = this._buildCellBorders(cell)
          if (borders.borderTop) univerCell.borderTop = borders.borderTop
          if (borders.borderRight) univerCell.borderRight = borders.borderRight
          if (borders.borderBottom) univerCell.borderBottom = borders.borderBottom
          if (borders.borderLeft) univerCell.borderLeft = borders.borderLeft
          tableCells.push(univerCell)
        }
        dataStream += T.TABLE_ROW_END
      }
      dataStream += T.TABLE_END

      // 表元数据
      // 注意：Univer 的 ITable.align/textWrap/position.*.relativeFrom/size.type
      // 都是数字枚举，传字符串会触发内部校验失败并把整张表丢弃（导致空白页）。
      tableSource[tableId] = {
        tableId,
        tableRows,
        tableColumns: tableColumnsPx,
        align: TableAlignmentType.START,
        indent: { v: 0 },
        textWrap: TableTextWrapType.NONE,
        position: {
          positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: 0 },
          positionV: { relativeFrom: ObjectRelativeFromV.PAGE, posOffset: 0 },
        },
        dist: { distB: 0, distL: 0, distR: 0, distT: 0 },
        size: { type: TableSizeType.SPECIFIED, width: { v: tableWidthPx } },
      }
      tables.push({ startIndex: tableStart, endIndex: dataStream.length, tableId })
      console.log(`[OfficeService] buildTable done: tableWidthPx=${tableWidthPx} (from twip:${tableWidthTwip}), tableRows=${tableRows.length}, tableColumns=${tableColumnsPx.length}`)
      console.log(`[OfficeService] buildTable dataStream (table section):`, dataStream.slice(tableStart, dataStream.length).replace(/\u001A/g, '{TS}').replace(/\u000F/g, '{TE}').replace(/\u001B/g, '{RS}').replace(/\u000E/g, '{RE}').replace(/\u001C/g, '{CS}').replace(/\u001D/g, '{CE}').replace(/\r/g, '\\r').replace(/\n/g, '\\n'))
    }

    for (const block of doc.blocks) {
      if (block.type === 'paragraph') {
        // 段落前确保不会因上一段是表格而紧贴（视觉上隔一行）
        if (dataStream.endsWith(T.TABLE_END)) {
          dataStream += T.PARAGRAPH
          paragraphs.push({
            startIndex: dataStream.length - 1,
            paragraphStyle: { spaceAbove: { v: 0 }, lineSpacing: 1.5, spaceBelow: { v: 2 } },
          })
        }
        pushParagraph(block.paragraph)
      } else {
        buildTable(block.table)
      }
    }
    // 文档结尾分节符（Univer 要求 dataStream 末尾有 \n）
    sectionBreaks.push({ startIndex: dataStream.length })
    dataStream += T.SECTION_BREAK

    // ── UDM 验证 ──
    const body = {
      dataStream,
      paragraphs,
      sectionBreaks,
      textRuns: textRuns.length ? textRuns : undefined,
      tables: tables.length ? tables : undefined,
    }
    const ts = tables.length ? tableSource : undefined
    const validationErrors = this._validateUDM(body, ts)
    if (validationErrors.length > 0) {
      console.error('[OfficeService] buildDocDataFromRich UDM 验证失败:', validationErrors)
      console.error('[OfficeService] dataStream 前 2000 字符:', dataStream.slice(0, 2000))
      console.error('[OfficeService] tables:', JSON.stringify(body.tables))
      if (ts) {
        for (const [id, tbl] of Object.entries(ts)) {
          console.error(`[OfficeService] tableSource[${id}]:`, JSON.stringify(tbl).slice(0, 500))
        }
      }
    } else {
      console.log('[OfficeService] buildDocDataFromRich UDM 验证通过')
    }

    return {
      body,
      tableSource: ts,
      documentStyle: this._buildDocumentStyle(pageWidth),
    }
  }

  /**
   * 把 Univer 单元格边距从 twip 换算为 Univer 内部单位（与 marginTop 等一致：
   * Univer 的 margin v 单位对应 1/20 pt = 1.333 twip，所以 twip × 0.75 = v）
   */
  private _buildDocumentStyle(pageWidth?: number): any {
    // 页面宽度必须在「创建时」与容器匹配——实测 Univer 文档渲染在创建瞬间烘焙布局，
    // 页面宽于创建时容器会导致文字绘制到画布外（整页空白）。
    // 排版稳定性策略：创建后不再因宽度变化重建/重排（分页、折行恒定），
    // 抽屉宽度变化只通过 fitDocZoom 调整显示缩放（缩放不影响排版分页）。
    // 高度按 A4 比例随宽度走；settings.zoomRatio 只影响显示缩放、不影响排版。
    const width = Math.max(280, Math.min(1160, pageWidth ?? 960))
    // 页面边距：必须 >= 15px 让 Univer 的页边距角标（margin identification marks）
    // 能完整地落在页面外侧；角标起点 = marginLeft - 15，marginLeft 太小（< 15）
    // 会导致角标起点跑到页面外框之外、视觉上"凸出去"。最小设为 20。
    // 同时单元格本身还有 cell margin，所以页面边距 >= 20 即可容纳角标并保留可用区。
    return {
      // TRADITIONAL 版式：真实分页（页面边界可见、骨架 pages 按页拆分，可统计页数）；
      // MODERN(2) 是连续长页，没有分页概念
      documentFlavor: 1,
      pageSize: { width, height: Math.round(width * 1.414) },
      // 页面边距 ≥ 20：保证 Univer 的 margin identification marks (IDENTIFIER_WIDTH=15)
      // 起点 marginLeft - 15 不会落在页面外框外侧导致"凸出去"现象
      marginTop: 20,
      marginBottom: 20,
      marginRight: 20,
      marginLeft: 20,
      renderConfig: {
        zeroWidthParagraphBreak: 0,
        vertexAngle: 0,
        centerAngle: 0,
        background: { rgb: '#ccc' },
      },
      autoHyphenation: 1,
      doNotHyphenateCaps: 0,
      consecutiveHyphenLimit: 2,
      marginHeader: 15,
      marginFooter: 15,
    }
  }

  /**
   * DOCX tcMar（twip）→ Univer cell.margin.v（v = 1/20 pt；twip × 0.75）
   * 缺省值：top/bottom=2, left/right=2，避免 cell width - margin < 0 导致 "The column width is less than 0" 错误
   * Univer 在 createNullCellPage 中会再次减去 margin，所以不能设置太大
   */
  private _buildCellMargin(cell: DocxCell): { start: { v: number }; end: { v: number }; top: { v: number }; bottom: { v: number } } {
    const m = cell.margins
    return {
      start: { v: m?.left != null ? Math.max(0, Math.round(m.left * 0.75)) : 2 },
      end: { v: m?.right != null ? Math.max(0, Math.round(m.right * 0.75)) : 2 },
      top: { v: m?.top != null ? Math.max(0, Math.round(m.top * 0.75)) : 2 },
      bottom: { v: m?.bottom != null ? Math.max(0, Math.round(m.bottom * 0.75)) : 2 },
    }
  }

  /**
   * DOCX tcBorders（按边）→ Univer borderXxx（color: { rgb }, width: { v }）
   * DOCX 边框粗细单位是 1/8 pt；Univer 的 v 是 1/20 pt；
   * 换算：v = (sz × 1/8 pt) × (20 v/pt) = sz × 2.5
   * 但 DOCX 默认 sz=4 → 4×2.5=10v=0.5pt 确实很粗，因此缩小到原来的 1/4 让边框更细
   */
  private _buildCellBorders(cell: DocxCell): {
    borderTop?: { color: { rgb: string }; width: { v: number } }
    borderRight?: { color: { rgb: string }; width: { v: number } }
    borderBottom?: { color: { rgb: string }; width: { v: number } }
    borderLeft?: { color: { rgb: string }; width: { v: number } }
  } {
    const b = cell.borders
    if (!b) return {}
    const convert = (side?: DocxBorder) => {
      if (!side) return undefined
      // 换算正确是 sz × 2.5，但默认会变粗，缩小到 0.6 × 2.5 = 1.5
      // 保证最小 v=1 (0.05pt 细线)
      const sz = side.size || 4
      const v = Math.max(1, Math.round(sz * 0.6))
      return { color: { rgb: side.color || '000000' }, width: { v } }
    }
    return {
      borderTop: convert(b.top),
      borderRight: convert(b.right),
      borderBottom: convert(b.bottom),
      borderLeft: convert(b.left),
    }
  }

  /** 读取活动文档的纯文本（按段落拆回 \n 分隔），无活动文档时返回空串 */
  private getDocumentPlainText(): string {
    const doc = this.getActiveDocument()
    const dataStream: string = doc?.getSnapshot?.()?.body?.dataStream ?? ''
    if (!dataStream) return ''
    return dataStream.replace(/\r?\n$/, '').split('\r').join('\n')
  }

  // ════════════════ 文档导入（整体重建编辑器）════════════════
  //
  // 为什么整体重建编辑器（而不是增量改内容）：以下更轻的路径全部实测失败——
  // 1. facade 的 insertText/insertParagraph 只写 dataStream 不维护 paragraphs 数组 → 全部挤成一行；
  // 2. doc.command.insert-text 命令整段替换后场景不重绘 → 滚动后画布空白；
  // 3. disposeUnit+createUniverDoc 交换单元存在渲染竞态 → 交替出现空白画布。
  // 只有「挂载时创建单单元编辑器」的路径渲染与滚动完全正常。
  //
  // 为什么重建时必须换新容器元素：Univer 的 UI workbench 用 WeakMap 按容器元素缓存
  // React root（design/render 的 createRoot 封装），dispose 后同一个容器元素再次挂载
  // 会静默失败（容器永远空白）。因此导入流程 = officeService 重置编辑器 + 通知
  // OfficePanel 通过 React key 重建容器 div → 新容器交给 flushPendingDocsImport 挂载。

  /** 待导入的文档内容（prepareDocsImport 设置，容器重建后由 flushPendingDocsImport 消费） */
  private _pendingDocsImport:
    | { kind: 'text'; paragraphs: string[]; title?: string; feedback?: string }
    | { kind: 'rich'; rich: DocxRichDocument; title?: string; feedback?: string }
    | null = null
  /** 当前文档的原始内容（导入后保存，供抽屉宽度变化时按新宽度重排） */
  private _currentDocsImport:
    | { kind: 'text'; paragraphs: string[]; title?: string }
    | { kind: 'rich'; rich: DocxRichDocument; title?: string }
    | null = null

  /**
   * 「原文件直出」支持：保留手动导入时读到的原始 docx 字节，以及是否已被编辑过。
   * - 只要没编辑过，导出就回传原始字节 → 与 WPS/Word 打开时一模一样（不受 docx 库重建精简影响）。
   * - 一旦被编辑（答案写入/直接改 DOM 回写模型），modified=true，导出改回 docx 库重建。
   */
  private _currentDocsOriginalBytes: ArrayBuffer | null = null
  private _currentDocsModified = false
  /** 导入时的「原始富结构快照」，供导出时逐段比对定位改动（格式保留式编辑用）。 */
  private _currentDocsOriginalRich: DocxRichDocument | null = null

  /** 文档页是否启用 HTML 渲染（插件 docs-html 开关；关闭即回退 Univer 渲染） */
  isDocsHtmlMode(): boolean {
    return usePluginStore
      .getState()
      .plugins.find((p) => p.id === 'docs-html')?.enabled ?? false
  }

  /**
   * 发起一次「纯文本」文档导入：记录段落、销毁当前 docs 编辑器实例、bump 容器版本号。
   * OfficePanel 监听版本号，用新 key 重建容器 div 后调用 flushPendingDocsImport 完成挂载。
   *
   * 「纯文本」路径的局限性：原文档的表格/合并/边框等结构会被压成纯文字（每行以 " ｜ " 分隔），
   * 仅适合文本类（.txt/.md/.html 等）导入。docx 文件请改用 prepareDocsImportRich。
   */
  prepareDocsImport(paragraphs: string[], title?: string, feedback?: string): OfficeCommandResult {
    try {
      if (this.isDocsHtmlMode()) {
        // HTML 渲染模式：无需 Univer 实例。把段落包成富结构模型直接保存，
        // OfficePanel 监听文档版本号变化完成 HTML 重渲染。
        this._currentDocsImport = { kind: 'rich', rich: this._paragraphsToRich(paragraphs), title }
        this._pendingDocsImport = null
        useOfficeDrawerStore.getState().bumpDocsVersion()
        return { success: true, message: feedback ?? '已导入' }
      }
      this._pendingDocsImport = { kind: 'text', paragraphs, title, feedback }
      // 销毁整个 docs Univer 实例（旧容器 div 随 React key 变化被整个移除）
      try {
        this._docs.univer?.dispose?.()
      } catch (err) {
        console.warn('[OfficeService] docs univer dispose 异常:', err)
      }
      this._docs = { univer: null, univerAPI: null, container: null, initialized: false }
      useOfficeDrawerStore.getState().bumpDocsVersion()
      return { success: true, message: '正在导入...' }
    } catch (err: any) {
      return { success: false, message: `导入失败: ${err.message}` }
    }
  }

  /** 把行数组转为富结构段落模型（HTML 渲染模式的文本类文件用） */
  private _paragraphsToRich(paragraphs: string[]): DocxRichDocument {
    const blocks: DocxRichBlock[] = paragraphs.map((line) => ({
      type: 'paragraph' as const,
      paragraph: { runs: line ? [{ text: line }] : [], empty: !line },
    }))
    return { blocks }
  }

  /**
   * 发起一次「富结构」文档导入：保留段落 / 表格 / 合并 / 边框。
   * 办公抽屉的 .docx 导入走这里（OfficePanel.handleImportDocs / formDrawerSyncService），
   * 原文档排版在 Univer 中完整还原——表单申报书等带表格的文档不再被压成纯文本。
   */
  prepareDocsImportRich(
    rich: DocxRichDocument,
    title?: string,
    feedback?: string,
    opts?: { originalBytes?: ArrayBuffer; fresh?: boolean },
  ): OfficeCommandResult {
    try {
      if (this.isDocsHtmlMode()) {
        // HTML 渲染模式：不创建 Univer 实例，直接保存富结构模型供 HTML 渲染。
        // 关键：用 JSON 深拷贝存一份快照，避免和 formDrawerSyncService 维护的 _docRich
        // 共享引用——否则后续答案写入虽然修改了原对象，但 React 比较引用相等会跳过
        // 状态更新，HTML 视图不会重渲染，导致"Ethan 已记录但文档没变化"。
        const snapshot = JSON.parse(JSON.stringify(rich)) as DocxRichDocument
        // 把文档名挂在富结构上，供 HTML 渲染做兜底页眉（与 WPS 的"附件1：xxx.docx"页眉一致）
        ;(snapshot as any).name = title
        this._currentDocsImport = { kind: 'rich', rich: snapshot, title }
        this._pendingDocsImport = null
        // 「原文件直出」标记：fresh 导入才重置为未编辑并记录原始字节；
        // 其余任何富结构重建（Ethan 推送/编辑回写）一律视为已编辑，导出不再直出原文件。
        if (opts?.fresh) {
          this._currentDocsOriginalBytes = opts.originalBytes ?? null
          this._currentDocsModified = false
          // 保存一份「原始富结构」深拷贝，供导出时定位改动处实现格式保留式编辑
          this._currentDocsOriginalRich = JSON.parse(JSON.stringify(snapshot)) as DocxRichDocument
        } else {
          this._currentDocsModified = true
          if (!this._currentDocsOriginalBytes && opts?.originalBytes) {
            this._currentDocsOriginalBytes = opts.originalBytes
          }
        }
        useOfficeDrawerStore.getState().bumpDocsVersion()
        return { success: true, message: feedback ?? '已导入' }
      }
      // 非 HTML 模式：把 title 挂在 rich 上，给后续 HTML 模式兜底（reflow 时复用）
      ;(rich as any).name = title
      this._pendingDocsImport = { kind: 'rich', rich, title, feedback }
      // 不再调用 dispose() — Univer 的 DI dispose 可能污染全局 DI 注册表，
      // 导致新实例缺少 "Wu" 等依赖。直接重置 _docs 上下文，让
      // flushPendingDocsImport 的 initDocs 创建全新实例。
      // 旧实例的 DOM 容器随 React key 变化被整个移除，无需手动 dispose。
      this._docs = { univer: null, univerAPI: null, container: null, initialized: false }
      useOfficeDrawerStore.getState().bumpDocsVersion()
      return { success: true, message: '正在导入...' }
    } catch (err: any) {
      return { success: false, message: `导入失败: ${err.message}` }
    }
  }

  /**
   * 按抽屉宽度自动设置文档显示缩放（fit width）。
   * 缩放只影响显示、不影响排版分页（页面固定 A4），窄抽屉也能看到整页内容。
   * 注意必须走 docs-ui 的缩放命令（直接改 snapshot.settings 不会触发重绘）。
   */
  fitDocZoom(): OfficeCommandResult {
    try {
      const doc = this.getActiveDocument()
      const container = this._docs.container
      const api = this._docs.univerAPI
      if (!doc || !container || !api) return { success: false, message: '文档未就绪' }
      const pageWidth: number = doc.getSnapshot?.()?.documentStyle?.pageSize?.width ?? 794
      const avail = Math.max(200, container.clientWidth - 40)
      const ratio = Math.min(2, Math.max(0.3, avail / pageWidth))
      const unitId = doc.getId?.()
      const result = api.executeCommand?.('doc.command.set-zoom-ratio', { zoomRatio: ratio, documentId: unitId })
      // 命令不可用时兜底直接写模型（至少数据正确，渲染随下次刷新生效）
      if (!result) doc.setZoomRatio?.(ratio)
      return { success: true, message: `显示缩放 ${Math.round(ratio * 100)}%` }
    } catch (err: any) {
      return { success: false, message: `设置缩放失败: ${err.message}` }
    }
  }

  /**
   * 按当前内容重建文档编辑器。页面尺寸已固定 A4，重建不改变排版；
   * 保留该方法供兼容调用（此前抽屉宽度变化会触发重排，现已移除该触发）。
   * 富结构（带表格）走 prepareDocsImportRich，纯文本走 prepareDocsImport。
   */
  reflowDocs(): OfficeCommandResult | null {
    if (!this._currentDocsImport) return null
    if (!this._docs.initialized) return null
    if (this._currentDocsImport.kind === 'rich') {
      return this.prepareDocsImportRich(this._currentDocsImport.rich, this._currentDocsImport.title)
    }
    return this.prepareDocsImport(this._currentDocsImport.paragraphs, this._currentDocsImport.title)
  }

  /**
   * 返回当前文档的富结构模型（供 HTML 渲染 / 原生导出）。
   * - HTML 渲染模式：展示与导出都基于这份 DocxRichDocument，
   *   直接绕开 Univer 的「DOCX→UDM 控制符」转换，表格/合并/边框天然稳定。
   * - 编辑器重建（prepareDocsImportRich）时仍保存一份副本，供 HTML 模式复用。
   */
  getCurrentDocsRich(): DocxRichDocument | null {
    if (this._currentDocsImport?.kind === 'rich') return this._currentDocsImport.rich
    return null
  }

  /** 当前文档是否已被编辑过（false 且持有原始字节时，导出应原文件直出）。 */
  hasCurrentDocsChanged(): boolean {
    return this._currentDocsModified
  }

  /** 手动导入时保留的原始 docx 字节（未编辑导出的「原样直出」用）。 */
  getCurrentDocsOriginalBytes(): ArrayBuffer | null {
    return this._currentDocsOriginalBytes
  }

  /** 文档内容已被编辑（直接改 DOM/内容可编辑时调用），导出改回重建路径而非原文件直出。 */
  markDocsModified(): void {
    this._currentDocsModified = true
  }

  /** 导入时的「原始富结构」快照（导出时定位改动处、生成格式保留式编辑）。 */
  getCurrentDocsOriginalRich(): DocxRichDocument | null {
    return this._currentDocsOriginalRich
  }

  /** 容器重建完成后挂载待导入内容（由 OfficePanel 在容器 remount 后调用） */
  flushPendingDocsImport(container: HTMLElement): OfficeCommandResult | null {
    const pending = this._pendingDocsImport
    if (!pending) return null
    this._pendingDocsImport = null

    if (!this.initDocs(container)) {
      return { success: false, message: '文档编辑器重新初始化失败' }
    }

    // 页宽按创建时容器适配（渲染约束），创建后宽度变化不再重排（见 fitDocZoom）
    const containerWidth = container.clientWidth || 400
    const pageWidth = Math.max(280, containerWidth - 80)

    if (pending.kind === 'rich') {
      // 富结构：含表格/合并/边框/列宽 → 走 buildDocDataFromRich 完整还原排版
      const docData = this.buildDocDataFromRich(pending.rich, pageWidth)
      const unitId = `office-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const fdoc = this._docs.univerAPI.createUniverDoc({
        id: unitId,
        ...(pending.title ? { title: pending.title } : {}),
        ...docData,
      })
      if (!fdoc) return { success: false, message: '创建文档失败' }

      this.fixImeAnchor(container)

      const tryFocus = (attempt = 0) => {
        try {
          fdoc.setSelection?.(0, 0)
        } catch {
          if (attempt < 5) requestAnimationFrame(() => tryFocus(attempt + 1))
        }
      }
      requestAnimationFrame(() => tryFocus())

      this._currentDocsImport = { kind: 'rich', rich: pending.rich, title: pending.title }
      const tableCount = pending.rich.blocks.filter((b) => b.type === 'table').length
      const paraCount = pending.rich.blocks.filter((b) => b.type === 'paragraph').length
      return {
        success: true,
        message:
          pending.feedback ??
          (tableCount > 0
            ? `已导入 ${paraCount} 段 + ${tableCount} 个表格`
            : paraCount > 0
            ? `已导入 ${paraCount} 个段落`
            : '文档已就绪'),
        data: { id: fdoc.getId?.() ?? fdoc.getUnitId?.(), paragraphCount: docData.body.paragraphs.length },
      }
    }

    // 纯文本：走旧 buildDocData 路径（按行生成段落）
    const text = pending.paragraphs.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
    const docData = this.buildDocData(text, pageWidth)
    const unitId = `office-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const fdoc = this._docs.univerAPI.createUniverDoc({
      id: unitId,
      ...(pending.title ? { title: pending.title } : {}),
      ...docData,
    })
    if (!fdoc) return { success: false, message: '创建文档失败' }

    // 修复 IME 候选框偏位（见 fixImeAnchor 注释）
    this.fixImeAnchor(container)
    // 页宽创建时已与容器匹配，无需缩放；抽屉宽度变化时由 OfficePanel 调 fitDocZoom 适配显示

    // 兜底把光标定位到文档头部
    const tryFocus = (attempt = 0) => {
      try {
        fdoc.setSelection?.(0, 0)
      } catch {
        if (attempt < 5) requestAnimationFrame(() => tryFocus(attempt + 1))
      }
    }
    requestAnimationFrame(() => tryFocus())

    // 保存原始内容供宽度变化时重排
    this._currentDocsImport = { kind: 'text', paragraphs: pending.paragraphs, title: pending.title }
    const count = text ? text.split('\n').length : 0
    return {
      success: true,
      // 同步流程（Ethan 答案写入）携带专属反馈文案时优先展示，避免被通用导入文案覆盖
      message: pending.feedback ?? (count > 0 ? `已导入 ${count} 个段落` : '文档已就绪'),
      data: { id: fdoc.getId?.() ?? fdoc.getUnitId?.(), paragraphCount: docData.body.paragraphs.length },
    }
  }

  /**
   * 获取当前文档的分页信息：总页数（骨架分页数据）+ 当前页（视口滚动位置推算）。
   * 骨架在编辑器挂载后异步计算，调用方需延迟或轮询获取。
   */
  getDocsPageInfo(): { current: number; total: number } | null {
    try {
      const univer = this._docs.univer
      const unitId = this.getActiveDocument()?.getId?.()
      if (!univer || !unitId) return null
      const injector = (univer as any)._injector
      const renderManager = injector?.get?.(IRenderManagerService)
      const render = renderManager?.getRenderById?.(unitId)
      const skeletonManager = render?.with?.(DocSkeletonManagerService)
      const pages = skeletonManager?.getSkeleton?.().getSkeletonData?.()?.pages
      if (!Array.isArray(pages) || pages.length === 0) return null
      const total = pages.length
      // 当前页：视口可见范围（viewBound，随真实滚动更新）落在哪一页。
      // 页纵向堆叠步长 = 页高 + 组件页边距（pageMarginTop=20）。
      const viewport = (render as any)?.scene?.getViewport?.('viewMain')
      const viewBound = viewport?.getBounding?.()?.viewBound
      const pageHeight = pages[0]?.height ?? 0
      const stride = pageHeight > 0 ? pageHeight + 20 : 0
      let current = 1
      if (viewBound && stride > 0) {
        const viewMidY = (viewBound.top + viewBound.bottom) / 2
        current = Math.min(total, Math.max(1, Math.floor(viewMidY / stride) + 1))
      }
      return { current, total }
    } catch {
      return null
    }
  }

  /** 创建空文档（仅在当前编辑器实例内创建首个文档单元，不重建编辑器） */
  createDocument(name?: string): OfficeCommandResult {
    try {
      const univerAPI = this._docs.univerAPI
      if (!univerAPI) return { success: false, message: 'Univer(文档) 未初始化' }

      // 页宽按创建时容器适配（渲染约束），与导入文档版式一致
      const containerWidth = this._docs.container?.clientWidth || 400
      const pageWidth = Math.max(280, containerWidth - 80)
      const docData = this.buildDocData('', pageWidth)
      const unitId = `office-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const fdoc = univerAPI.createUniverDoc({ id: unitId, ...(name ? { title: name } : {}), ...docData })
      if (!fdoc) return { success: false, message: '创建文档失败' }

      // 修复 IME 候选框偏位（见 fixImeAnchor 注释）
      const container = this._docs.container
      if (container) this.fixImeAnchor(container)

      const tryFocus = (attempt = 0) => {
        try {
          fdoc.setSelection?.(0, 0)
        } catch {
          if (attempt < 5) requestAnimationFrame(() => tryFocus(attempt + 1))
        }
      }
      requestAnimationFrame(() => tryFocus())

      return { success: true, message: '文档已创建', data: { id: fdoc.getId?.() ?? fdoc.getUnitId?.() } }
    } catch (err: any) {
      return { success: false, message: `创建文档失败: ${err.message}` }
    }
  }

  /**
   * 修复 IME 候选框偏位：Univer 的 IME 代理输入框是 position:fixed 元素，但定位算法
   * 会把坐标减去宿主容器偏移（activate() 里的 left -= rect.left），该算法只在宿主是
   * fixed 的「包含块」（宿主带 transform）时才成立。官方 demo 铺满窗口、宿主在 (0,0)
   * 看不出问题；我们的编辑器嵌在抽屉里（有页面偏移），代理框会整体偏到左上。
   * 给宿主加 transform 让它成为真正的包含块，算法即自洽。
   * 需在编辑器挂载后调用（代理元素随渲染管线创建）。
   */
  fixImeAnchor(container: HTMLElement): void {
    const apply = () => {
      const selContainer = container.querySelector('[id^="univer-doc-selection-container"]') as HTMLElement | null
      const parent = selContainer?.parentElement as HTMLElement | null
      if (parent && getComputedStyle(parent).transform === 'none') {
        parent.style.transform = 'translate(0, 0)'
      }
      if (!selContainer) return

      // 修复候选框「跳顶」抖动：Univer 在选区刷新时会调用 deactivate() 把代理输入框
      // 归位到 (0,0)（宿主顶部），下一拍又摆回光标处——OS 候选框随之下跳。
      // 这里用 MutationObserver 拦截归零动作，立即恢复到最后的光标锚点位置。
      // DEBUG：window.__disableImeObserver = true 可关闭此观察者（用于二分定位滚动问题）
      const anySel = selContainer as any
      if (!anySel.__imeAntiFlicker && !(window as any).__disableImeObserver) {
        anySel.__imeAntiFlicker = true
        let lastPos: { left: string; top: string } | null = null
        const mo = new MutationObserver(() => {
          const { left, top } = selContainer.style
          if (left === '0px' && top === '0px') {
            if (lastPos) {
              selContainer.style.left = lastPos.left
              selContainer.style.top = lastPos.top
            }
          } else {
            lastPos = { left, top }
          }
        })
        mo.observe(selContainer, { attributes: true, attributeFilter: ['style'] })
      }
    }
    apply()
    // 兜底再试：代理元素随渲染管线异步创建
    setTimeout(apply, 300)
    setTimeout(apply, 1000)
  }

  /** 获取当前活动文档 */
  getActiveDocument(): any | null {
    try {
      if (!this._docs.univerAPI) return null
      return this._docs.univerAPI.getActiveDocument?.() ?? null
    } catch {
      return null
    }
  }

  /** 在文档末尾追加一段文本（文本中的换行会成为新段落；走整体重建编辑器流程） */
  insertText(text: string): OfficeCommandResult {
    try {
      if (!this._docs.initialized) return { success: false, message: 'Univer(文档) 未初始化' }
      const doc = this.getActiveDocument()
      if (!doc) return { success: false, message: '无活动文档' }

      const current = this.getDocumentPlainText()
      const merged = current ? `${current}\n${text}` : text
      return this.prepareDocsImport(merged.split('\n'), doc.getName?.())
    } catch (err: any) {
      return { success: false, message: `插入文本失败: ${err.message}` }
    }
  }

  /** 把纯文本内容导入到活动文档（按行生成段落） */
  importDocumentText(text: string, title?: string): OfficeCommandResult {
    return this.importDocumentParagraphs(text.split('\n'), title)
  }

  /** 把段落数组导入为文档内容（整体重建编辑器，保留空行为空段落） */
  importDocumentParagraphs(paragraphs: string[], title?: string): OfficeCommandResult {
    try {
      if (!this._docs.initialized) return { success: false, message: 'Univer(文档) 未初始化' }
      return this.prepareDocsImport(paragraphs, title)
    } catch (err: any) {
      return { success: false, message: `导入文档失败: ${err.message}` }
    }
  }

  /**
   * 验证 UDM 结构一致性。
   * 返回所有发现的错误，如果无错误则返回空数组。
   */
  private _validateUDM(body: any, tableSource: Record<string, any> | undefined): string[] {
    const errors: string[] = []
    if (!body || !body.dataStream) return ['body.dataStream 不存在']
    const ds = body.dataStream

    // 1. 检查 dataStream 以 \n 结尾
    if (!ds.endsWith('\n')) {
      errors.push('dataStream 必须以 \\n 结尾')
    }

    // 2. 检查控制符配对
    const tableStarts = (ds.match(/\u001A/g) || []).length
    const tableEnds = (ds.match(/\u000F/g) || []).length
    if (tableStarts !== tableEnds) {
      errors.push(`TABLE_START(${tableStarts}) 与 TABLE_END(${tableEnds}) 数量不匹配`)
    }

    const rowStarts = (ds.match(/\u001B/g) || []).length
    const rowEnds = (ds.match(/\u000E/g) || []).length
    if (rowStarts !== rowEnds) {
      errors.push(`ROW_START(${rowStarts}) 与 ROW_END(${rowEnds}) 数量不匹配`)
    }

    const cellStarts = (ds.match(/\u001C/g) || []).length
    const cellEnds = (ds.match(/\u001D/g) || []).length
    if (cellStarts !== cellEnds) {
      errors.push(`CELL_START(${cellStarts}) 与 CELL_END(${cellEnds}) 数量不匹配`)
    }

    // 3. 检查 tables 数组中的索引是否正确
    if (body.tables) {
      for (const t of body.tables) {
        if (ds[t.startIndex] !== '\u001A') {
          errors.push(`table ${t.tableId} startIndex(${t.startIndex}) 不指向 TABLE_START`)
        }
        // endIndex 是 TABLE_END **之后**的索引，所以检查 t.endIndex - 1
        if (t.endIndex > 0 && ds[t.endIndex - 1] !== '\u000F') {
          errors.push(`table ${t.tableId} endIndex(${t.endIndex}) 不指向 TABLE_END`)
        }
        // 检查 tableSource 存在
        if (!tableSource || !tableSource[t.tableId]) {
          errors.push(`table ${t.tableId} 在 tableSource 中不存在`)
        }
      }
    }

    // 4. 检查 paragraphs 的 startIndex 指向 \r
    if (body.paragraphs) {
      for (let i = 0; i < body.paragraphs.length; i++) {
        const idx = body.paragraphs[i].startIndex
        if (ds[idx] !== '\r') {
          errors.push(`paragraphs[${i}] startIndex(${idx}) 不指向 PARAGRAPH(\\r)`)
        }
      }
    }

    // 5. 检查 sectionBreaks 的 startIndex 指向 \n
    if (body.sectionBreaks) {
      for (let i = 0; i < body.sectionBreaks.length; i++) {
        const idx = body.sectionBreaks[i].startIndex
        if (ds[idx] !== '\n') {
          errors.push(`sectionBreaks[${i}] startIndex(${idx}) 不指向 SECTION_BREAK(\\n)`)
        }
      }
    }

    // 6. 检查 tableSource 中 tableColumns 长度与 tableRows 列数一致
    if (tableSource) {
      for (const [id, table] of Object.entries(tableSource)) {
        const colCount = (table as any).tableColumns?.length ?? 0
        if (!Array.isArray((table as any).tableRows)) continue
        for (let ri = 0; ri < ((table as any).tableRows?.length ?? 0); ri++) {
          const row = (table as any).tableRows[ri]
          if (!Array.isArray(row.tableCells)) continue
          // 计算实际可见单元格数（排除 rowSpan=0）
          const actualCells = row.tableCells.filter((c: any) => !c.rowSpan || c.rowSpan > 0).length
          // 计算 columnSpan 总和（包含 rowSpan=0 的单元格，因为它们的 columnSpan 也占位）
          const colSpanSum = row.tableCells.reduce((sum: number, c: any) => sum + (c.columnSpan || 1), 0)
          // 关键：有 columnSpan 时，actualCells 可以小于 colCount，但 colSpanSum 必须等于 colCount
          if (colSpanSum !== colCount) {
            errors.push(`table ${id} 第 ${ri} 行: columnSpan总和(${colSpanSum}) 与列数(${colCount}) 不匹配 (实际单元格数:${actualCells})`)
          }
        }
      }
    }

    return errors
  }

  /** 清空文档内容（整体重建编辑器为空文档） */
  clearDocument(): OfficeCommandResult {
    try {
      if (!this._docs.initialized) return { success: false, message: 'Univer(文档) 未初始化' }
      const doc = this.getActiveDocument()
      return this.prepareDocsImport([], doc?.getName?.())
    } catch (err: any) {
      return { success: false, message: `清空文档失败: ${err.message}` }
    }
  }

  // ──────────────── 通用导出 ────────────────
  //
  // 注意：@univerjs/presets 0.25.x 的 facade 没有 exportFile API（v3.0.2/3 的导出按钮
  // 因此一直静默失败）。这里用项目已有依赖自建导出：
  // - xlsx：SheetJS 从活工作簿逐 sheet 读值（getValues 能反映答案写入与用户手动修改）
  // - docx：`docx` 包从活文档快照段落生成（dataStream 随用户编辑实时更新）

  /** 导出活动工作簿为 XLSX Blob（SheetJS 构建，优先同步句柄的 sheet 集合） */
  async exportWorkbook(): Promise<Blob | null> {
    try {
      if (!this._sheets.univerAPI) return null

      // 收集待导出 sheet：优先 Ethan 同步句柄，否则取活动工作簿全部 sheet
      let sheetEntries: [string, any][] = Array.from(this._syncSheets.entries())
      if (sheetEntries.length === 0) {
        const wb = this.getActiveWorkbook()
        const wsList = wb?.getSheets?.() ?? []
        sheetEntries = wsList.map((ws: any) => [ws.getSheetName?.() ?? `Sheet${sheetEntries.length + 1}`, ws])
      }
      if (sheetEntries.length === 0) return null

      const out = XLSX.utils.book_new()
      for (const [name, ws] of sheetEntries) {
        let matrix: (string | number | boolean | null)[][] = []
        try {
          const rows = ws.getMaxRows?.() ?? 0
          const cols = ws.getMaxColumns?.() ?? 0
          if (rows > 0 && cols > 0) {
            // getRange 是 (row, col, numRows, numColumns) 签名
            matrix = ws.getRange(0, 0, rows, cols)?.getValues?.() ?? []
          }
        } catch { /* 读值失败按空表处理 */ }
        const sheet = XLSX.utils.aoa_to_sheet(matrix as any[][])
        XLSX.utils.book_append_sheet(out, sheet, name.slice(0, 31))
      }

      const buf = XLSX.write(out, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
      return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    } catch (err) {
      console.error('[OfficeService] export workbook failed:', err)
      return null
    }
  }

  /** 导出活动文档为 DOCX Blob（docx 包从快照段落构建） */
  async exportDocument(): Promise<Blob | null> {
    try {
      const doc = this.getActiveDocument()
      if (!doc) return null
      const dataStream: string = doc.getSnapshot?.()?.body?.dataStream ?? ''
      const text = dataStream.replace(/\r?\n$/, '').replace(/\r/g, '\n')
      const paragraphs = text.split('\n')

      const { Document, Packer, Paragraph, TextRun } = await import('docx')
      const d = new Document({
        sections: [{
          children: paragraphs.map((line) => new Paragraph({ children: [new TextRun(line)] })),
        }],
      })
      return await Packer.toBlob(d)
    } catch (err) {
      console.error('[OfficeService] export document failed:', err)
      return null
    }
  }

  /** 销毁全部实例 */
  destroy(): void {
    try { this._sheets.univer?.dispose?.() } catch { /* skip */ }
    try { this._docs.univer?.dispose?.() } catch { /* skip */ }
    this._sheets = { univer: null, univerAPI: null, container: null, initialized: false }
    this._docs = { univer: null, univerAPI: null, container: null, initialized: false }
  }
}

/** 模块级单例 */
export const officeService = new OfficeService()