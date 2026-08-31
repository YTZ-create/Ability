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
import * as XLSX from 'xlsx'
import { useOfficeDrawerStore } from '../stores/officeDrawerStore'

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
    // 页面宽度必须在「创建时」与容器匹配——实测 Univer 文档渲染在创建瞬间烘焙布局，
    // 页面宽于创建时容器会导致文字绘制到画布外（整页空白）。
    // 排版稳定性策略：创建后不再因宽度变化重建/重排（分页、折行恒定），
    // 抽屉宽度变化只通过 fitDocZoom 调整显示缩放（缩放不影响排版分页）。
    // 高度按 A4 比例随宽度走；settings.zoomRatio 只影响显示缩放、不影响排版。
    const width = Math.max(280, Math.min(1160, pageWidth ?? 960))
    return {
      body: {
        dataStream,
        paragraphs,
        sectionBreaks: [{ startIndex: dataStream.length - 1 }],
      },
      documentStyle: {
        // TRADITIONAL 版式：真实分页（页面边界可见、骨架 pages 按页拆分，可统计页数）；
        // MODERN(2) 是连续长页，没有分页概念
        documentFlavor: 1,
        pageSize: { width, height: Math.round(width * 1.414) },
        // 边距取小值：编辑器组件本身还有 20px 的 pageMargin，叠加后实际留白才正常；
        // 之前用 50 时左/上各有 70px 的大片空白
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
        marginHeader: 30,
        marginFooter: 30,
      },
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
  private _pendingDocsImport: { paragraphs: string[]; title?: string; feedback?: string } | null = null
  /** 当前文档的原始内容（导入后保存，供抽屉宽度变化时按新宽度重排） */
  private _currentDocsImport: { paragraphs: string[]; title?: string } | null = null

  /**
   * 发起一次文档导入：记录内容、销毁当前 docs 编辑器实例、bump 容器版本号。
   * OfficePanel 监听版本号，用新 key 重建容器 div 后调用 flushPendingDocsImport 完成挂载。
   */
  prepareDocsImport(paragraphs: string[], title?: string, feedback?: string): OfficeCommandResult {
    try {
      this._pendingDocsImport = { paragraphs, title, feedback }
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
   */
  reflowDocs(): OfficeCommandResult | null {
    if (!this._currentDocsImport) return null
    if (!this._docs.initialized) return null
    return this.prepareDocsImport(this._currentDocsImport.paragraphs, this._currentDocsImport.title)
  }

  /** 容器重建完成后挂载待导入内容（由 OfficePanel 在容器 remount 后调用） */
  flushPendingDocsImport(container: HTMLElement): OfficeCommandResult | null {
    const pending = this._pendingDocsImport
    if (!pending) return null
    this._pendingDocsImport = null

    if (!this.initDocs(container)) {
      return { success: false, message: '文档编辑器重新初始化失败' }
    }

    const text = pending.paragraphs.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
    // 页宽按创建时容器适配（渲染约束），创建后宽度变化不再重排（见 fitDocZoom）
    const containerWidth = container.clientWidth || 400
    const pageWidth = Math.max(280, containerWidth - 80)
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
    this._currentDocsImport = { paragraphs: pending.paragraphs, title: pending.title }
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