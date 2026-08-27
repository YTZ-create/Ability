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

type UniverAPI = any
type Workbook = any
type Worksheet = any

export interface OfficeCommandResult {
  success: boolean
  message: string
  data?: any
}

interface EditorContext {
  univerAPI: UniverAPI
  container: HTMLElement
  initialized: boolean
}

class OfficeService {
  /** 电子表格实例上下文 */
  private _sheets: EditorContext = { univerAPI: null, container: null, initialized: false }
  /** 文档实例上下文 */
  private _docs: EditorContext = { univerAPI: null, container: null, initialized: false }

  /** 初始化电子表格实例，挂载到指定容器 */
  initSheets(container: HTMLElement): boolean {
    if (this._sheets.initialized) return true

    try {
      const { univerAPI } = createUniver({
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

      this._sheets = { univerAPI, container, initialized: true }
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
      const { univerAPI } = createUniver({
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

      this._docs = { univerAPI, container, initialized: true }
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

  // ──────────────── 文档方法 ────────────────

  /** 创建文档 */
  createDocument(name?: string): OfficeCommandResult {
    try {
      if (!this._docs.univerAPI) return { success: false, message: 'Univer(文档) 未初始化' }

      // 初始空段落 body：让文档一创建即为非空，避免 Univer 显示「开始」整页占位提示
      // （默认无 body 的新文档会进入 empty 状态，只有点击占位才进入编辑）
      // dataStream 末尾需含段落符 \r 与分节符 \n
      const initBody: any = {
        dataStream: '\r\n',
        paragraphs: [{ startIndex: 0 }],
        sectionBreaks: [{ startIndex: 1 }],
      }

      const fdoc = this._docs.univerAPI.createUniverDoc(
        name
          ? { title: name, body: initBody }
          : { body: initBody }
      )

      // 兜底把光标定位到文档头部
      const unitId = fdoc?.getId?.() ?? fdoc?.getUnitId?.()
      if (fdoc) {
        const tryFocus = (attempt = 0) => {
          try {
            fdoc.setSelection?.(0, 0)
          } catch {
            if (attempt < 5) requestAnimationFrame(() => tryFocus(attempt + 1))
          }
        }
        requestAnimationFrame(() => tryFocus())
      }
      return { success: true, message: '文档已创建', data: { id: unitId } }
    } catch (err: any) {
      return { success: false, message: `创建文档失败: ${err.message}` }
    }
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

  /** 在文档中插入一段文本（追加到末尾） */
  insertText(text: string): OfficeCommandResult {
    try {
      if (!this._docs.univerAPI) return { success: false, message: 'Univer(文档) 未初始化' }
      const doc = this.getActiveDocument()
      if (!doc) return { success: false, message: '无活动文档' }
      doc.insertText?.(text)
      return { success: true, message: '已插入文本' }
    } catch (err: any) {
      return { success: false, message: `插入文本失败: ${err.message}` }
    }
  }

  /** 把纯文本内容导入到活动文档（按行生成段落） */
  importDocumentText(text: string): OfficeCommandResult {
    return this.importDocumentParagraphs(text.split('\n'))
  }

  /** 把段落数组导入到活动文档（每一段为一个段落） */
  importDocumentParagraphs(paragraphs: string[]): OfficeCommandResult {
    try {
      if (!this._docs.univerAPI) return { success: false, message: 'Univer(文档) 未初始化' }
      const doc = this.getActiveDocument()
      if (!doc) return { success: false, message: '无活动文档' }

      // 逐段插入，insertParagraph 会把 \n 归并为段落分隔符 \r\n，实现「一段=一段落」
      let count = 0
      for (const p of paragraphs) {
        const line = p.trim()
        if (line) {
          doc.insertParagraph?.(line)
          count++
        }
      }
      return { success: true, message: `已导入 ${count} 个段落` }
    } catch (err: any) {
      return { success: false, message: `导入文档失败: ${err.message}` }
    }
  }

  /** 清空活动文档内容 */
  clearDocument(): OfficeCommandResult {
    try {
      if (!this._docs.univerAPI) return { success: false, message: 'Univer(文档) 未初始化' }
      const doc = this.getActiveDocument()
      if (!doc) return { success: false, message: '无活动文档' }
      // 先全选再删除：选中整个 dataStream 文本区域并插入空串
      const snapshot = doc.getSnapshot?.()
      const body = snapshot?.body
      const len = body?.dataStream?.length ?? 0
      if (len >= 2) {
        doc.insertText?.('', { startOffset: 0, endOffset: len - 2 })
      }
      return { success: true, message: '文档已清空' }
    } catch (err: any) {
      return { success: false, message: `清空文档失败: ${err.message}` }
    }
  }

  // ──────────────── 通用导出 ────────────────

  /** 导出活动工作簿为 XLSX Blob */
  async exportWorkbook(): Promise<Blob | null> {
    try {
      if (!this._sheets.univerAPI) return null
      const data = await this._sheets.univerAPI.exportFile()
      return data
    } catch (err) {
      console.error('[OfficeService] export workbook failed:', err)
      return null
    }
  }

  /** 导出活动文档为 DOCX Blob */
  async exportDocument(): Promise<Blob | null> {
    try {
      if (!this._docs.univerAPI) return null
      const data = await this._docs.univerAPI.exportFile()
      return data
    } catch (err) {
      console.error('[OfficeService] export document failed:', err)
      return null
    }
  }

  /** 销毁全部实例 */
  destroy(): void {
    this._sheets = { univerAPI: null, container: null, initialized: false }
    this._docs = { univerAPI: null, container: null, initialized: false }
  }
}

/** 模块级单例 */
export const officeService = new OfficeService()