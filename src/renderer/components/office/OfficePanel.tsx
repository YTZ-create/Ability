/**
 * OfficePanel — Univer 容器与状态徽章（不含外层 chrome）
 *
 * 设计为「内容组件」：抽屉/CapabilitiesHub 等容器负责提供标题栏与关闭按钮
 * 支持两类编辑器：工作表（Sheets）/ 文档（Docs），通过类型切换展示
 * 两个容器常驻挂载（避免卸载破坏 Univer 实例），用 display 切换可见性
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Download, Upload, FileText } from 'lucide-react'
import { FileSpreadsheet } from 'lucide-react'
import { officeService } from '../../services/officeService'
import { useOfficeStore } from '../../stores/officeStore'
import { useOfficeDrawerStore } from '../../stores/officeDrawerStore'
import * as XLSX from 'xlsx'
import { parseDocxParagraphs } from '../../utils/docxParagraphs'

export type OfficeStatus = 'initializing' | 'ready' | 'error'
export type EditorKind = 'sheets' | 'docs'

/**
 * 为容器绑定 ResizeObserver，避免「就绪但白屏」（Univer 需要知道真实尺寸）
 */
function useResizeFix(ref: React.RefObject<HTMLDivElement | null>, apiGetter: () => any | null, resetKey?: number) {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver(() => {
      try {
        apiGetter()?.resize?.()
      } catch {}
    })
    ro.observe(el)

    // 兜底：容器可见时触发一次 resize
    const t = setTimeout(() => {
      try {
        apiGetter()?.resize?.()
      } catch {}
    }, 60)

    return () => {
      ro.disconnect()
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])
}

export const OfficePanel: React.FC = () => {
  // 编辑页类型以 officeDrawerStore.activeKind 为唯一数据源：
  // 本地面板切页与外部程序化指定（Ethan 抽屉同步导入）共用一个 store 字段，
  // 避免本地 state 与 store 双向同步造成的乒乓覆盖（外部设置的页面被回写冲掉）
  const kind = useOfficeDrawerStore((s) => s.activeKind)
  const setKind = useOfficeDrawerStore((s) => s.setActiveKind)
  const sheetsContainerRef = useRef<HTMLDivElement>(null)
  const docsContainerRef = useRef<HTMLDivElement>(null)
  const [sheetsStatus, setSheetsStatus] = useState<OfficeStatus>('initializing')
  const [docsStatus, setDocsStatus] = useState<OfficeStatus>('initializing')
  const addWorkbook = useOfficeStore((s) => s.addWorkbook)
  const addDocument = useOfficeStore((s) => s.addDocument)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const docFileInputRef = useRef<HTMLInputElement>(null)
  const docsVersion = useOfficeDrawerStore((s) => s.docsVersion)
  const [pageInfo, setPageInfo] = useState<{ current: number; total: number } | null>(null)

  // 轮询读取分页信息（骨架在编辑器挂载后异步计算，导入后需要多等几轮）
  const refreshPageInfo = useCallback(() => {
    let timer: ReturnType<typeof setTimeout>
    let tries = 0
    const tick = () => {
      tries++
      const n = officeService.getDocsPageInfo()
      if (n != null) {
        setPageInfo(n)
        return
      }
      if (tries < 8) timer = setTimeout(tick, 500)
    }
    timer = setTimeout(tick, 800)
    return () => clearTimeout(timer)
  }, [])

  useResizeFix(sheetsContainerRef, () => officeService.sheetsAPI)
  useResizeFix(docsContainerRef, () => officeService.docsAPI, docsVersion)

  // 初始化工作表实例
  useEffect(() => {
    if (!sheetsContainerRef.current) return

    const ok = officeService.initSheets(sheetsContainerRef.current)
    if (ok) {
      setSheetsStatus('ready')

      const result = officeService.createWorkbook('未命名工作簿')
      if (result.success && result.data?.id) {
        addWorkbook({
          id: result.data.id,
          name: '未命名工作簿',
          state: 'draft',
          description: '初始工作簿',
        })
      }
    } else {
      setSheetsStatus('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 初始化文档实例 —— 延迟到首次切到「文档」页时执行：
  // 容器在 display:none 状态下初始化会让引擎把画布算成 0 尺寸，切回来后整页空白。
  // docsInitRef 保证只初始化一次。
  const docsInitRef = useRef(false)
  useEffect(() => {
    if (kind !== 'docs' || docsInitRef.current) return
    if (!docsContainerRef.current) return
    docsInitRef.current = true

    const ok = officeService.initDocs(docsContainerRef.current)
    if (ok) {
      setDocsStatus('ready')

      const result = officeService.createDocument('未命名文档')
      if (result.success && result.data?.id) {
        addDocument({
          id: result.data.id,
          name: '未命名文档',
          state: 'draft',
          description: '初始文档',
        })
      }
      refreshPageInfo()
    } else {
      setDocsStatus('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  // 文档编辑器容器重建（导入/重排触发版本号变化）后，把待导入内容挂载到新容器。
  // 注意：此时 service 端编辑器实例已被 prepareDocsImport 重置（initialized=false），
  // 必须无条件调用 flushPendingDocsImport，由它内部完成 initDocs + 创建文档。
  useEffect(() => {
    if (docsVersion === 0) return
    if (!docsContainerRef.current) return

    const result = officeService.flushPendingDocsImport(docsContainerRef.current)
    if (result) {
      setDocsStatus(result.success ? 'ready' : 'error')
      setDocsNote(result.message)
      if (result.success) {
        const cleanup = refreshPageInfo()
        return cleanup
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsVersion])

  // 当前页码跟随滚动：文档滚轮不走可订阅的滚动事件流（反向滚动机制），
  // 用轻量轮询读取可见范围，页码有变化才 setState
  useEffect(() => {
    if (kind !== 'docs') return
    if (!officeService.docsInitialized) return
    const t = setInterval(() => {
      const info = officeService.getDocsPageInfo()
      if (info) {
        setPageInfo(prev => (prev && prev.current === info.current && prev.total === info.total) ? prev : info)
      }
    }, 300)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsVersion, kind])

  // 抽屉宽度变化不再触发文档重排：页面尺寸固定 A4，排版稳定不随宽度变化。
  // 只重新计算「适配宽度」的显示缩放（缩放不影响排版分页），保证窄抽屉也能看到整页
  const drawerWidth = useOfficeDrawerStore((s) => s.width)
  useEffect(() => {
    const t = setTimeout(() => {
      officeService.fitDocZoom()
    }, 250)
    return () => clearTimeout(t)
  }, [drawerWidth])

  const handleExportSheets = useCallback(async () => {
    try {
      const blob = await officeService.exportWorkbook()
      if (!blob) {
        console.error('导出失败')
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'workbook.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('导出失败:', err)
    }
  }, [])

  const handleExportDocs = useCallback(async () => {
    try {
      const blob = await officeService.exportDocument()
      if (!blob) {
        console.error('导出失败')
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'document.docx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('导出失败:', err)
    }
  }, [])

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSheetsNote(`正在导入 ${file.name}...`)
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })

      // 写入当前活动工作簿（避免新建工作簿后 sheet 名不匹配）
      let totalRows = 0
      let firstErr: string | null = null
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, { header: 1 })

        if (jsonData.length > 0) {
          const result = officeService.writeRange(sheetName, totalRows, 0, jsonData)
          if (result.success) {
            totalRows += jsonData.length + 1 // +1 行间隔
          } else if (!firstErr) {
            firstErr = result.message
          }
        }
      }

      if (firstErr) setSheetsNote(`部分数据未导入: ${firstErr}`)
      else if (totalRows > 0) setSheetsNote(`已导入 ${totalRows} 行数据`)
      else setSheetsNote('未读取到数据，请检查文件内容')
    } catch (err: any) {
      console.error('导入失败:', err)
      setSheetsNote(`导入失败: ${err?.message ?? err}`)
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleImportDocs = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setDocsNote(`正在导入 ${file.name}...`)
    try {
      const buffer = await file.arrayBuffer()
      const paragraphs = await parseDocxParagraphs(file.name, buffer)

      // 整体重建文档编辑器：service 销毁旧实例并 bump 版本号，
      // 新容器 div（key 变化）remount 后由 useEffect 调 flushPendingDocsImport 挂载内容
      const result = officeService.importDocumentParagraphs(paragraphs, file.name.replace(/\.[^.]+$/, ''))
      if (!result.success) {
        setDocsNote(`导入失败: ${result.message}`)
      }
    } catch (err: any) {
      console.error('导入文档失败:', err)
      setDocsNote(`导入失败: ${err?.message ?? err}`)
    }

    if (docFileInputRef.current) docFileInputRef.current.value = ''
  }, [])

  const setSheetsFeedback = useOfficeDrawerStore((s) => s.setSheetsFeedback)
  const setDocsFeedback = useOfficeDrawerStore((s) => s.setDocsFeedback)
  // 工作表 / 文档 反馈包装：各自独立存储，互不覆盖
  const setSheetsNote = useCallback((msg: string) => setSheetsFeedback(msg), [setSheetsFeedback])
  const setDocsNote = useCallback((msg: string) => setDocsFeedback(msg), [setDocsFeedback])

  const status = kind === 'sheets' ? sheetsStatus : docsStatus

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 类型切换 + 状态徽章 + 操作按钮栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b-2 border-brutal-black shrink-0 flex-wrap">
        {/* 类型切换 */}
        <div className="flex items-center border-2 border-brutal-black bg-white shadow-brutal-sm">
          <button
            onClick={() => setKind('sheets')}
            className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold font-mono transition-colors ${
              kind === 'sheets' ? 'bg-brutal-yellow' : 'hover:bg-brutal-cream'
            }`}
          >
            <FileSpreadsheet size={10} />
            工作表
          </button>
          <button
            onClick={() => setKind('docs')}
            className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold font-mono border-l-2 border-brutal-black transition-colors ${
              kind === 'docs' ? 'bg-brutal-yellow' : 'hover:bg-brutal-cream'
            }`}
          >
            <FileText size={10} />
            文档
          </button>
        </div>

        {status === 'initializing' && (
          <span className="text-[10px] px-1.5 py-0.5 bg-brutal-yellow border border-brutal-black font-mono">
            初始化中...
          </span>
        )}
        {status === 'error' && (
          <span className="text-[10px] px-1.5 py-0.5 bg-brutal-pink text-white border border-brutal-black font-mono">
            加载失败
          </span>
        )}

        {status === 'ready' && (
          <div className="ml-auto flex items-center gap-1">
            {kind === 'sheets' && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleImport}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[10px] font-bold font-mono px-2 py-0.5 border-2 border-brutal-black bg-white hover:bg-brutal-cream shadow-brutal-sm active:shadow-none active:translate-x-[1px] active:translate-y-[1px] transition-all duration-100 flex items-center gap-1"
                  title="导入 .xlsx"
                >
                  <Upload size={10} /> 导入
                </button>
                <button
                  onClick={handleExportSheets}
                  className="text-[10px] font-bold font-mono px-2 py-0.5 border-2 border-brutal-black bg-white hover:bg-brutal-lime shadow-brutal-sm active:shadow-none active:translate-x-[1px] active:translate-y-[1px] transition-all duration-100 flex items-center gap-1"
                  title="导出 .xlsx"
                >
                  <Download size={10} /> 导出
                </button>
              </>
            )}
            {kind === 'docs' && (
              <>
                <input
                  ref={docFileInputRef}
                  type="file"
                  accept=".docx,.txt,.md,.html"
                  onChange={handleImportDocs}
                  className="hidden"
                />
                <button
                  onClick={() => docFileInputRef.current?.click()}
                  className="text-[10px] font-bold font-mono px-2 py-0.5 border-2 border-brutal-black bg-white hover:bg-brutal-cream shadow-brutal-sm active:shadow-none active:translate-x-[1px] active:translate-y-[1px] transition-all duration-100 flex items-center gap-1"
                  title="导入文档"
                >
                  <Upload size={10} /> 导入
                </button>
                <button
                  onClick={handleExportDocs}
                  className="text-[10px] font-bold font-mono px-2 py-0.5 border-2 border-brutal-black bg-white hover:bg-brutal-lime shadow-brutal-sm active:shadow-none active:translate-x-[1px] active:translate-y-[1px] transition-all duration-100 flex items-center gap-1"
                  title="导出 .docx"
                >
                  <Download size={10} /> 导出
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 编辑器容器（常驻，display 切换） */}
      <div className="flex-1 relative overflow-hidden">
        {sheetsStatus === 'error' && kind === 'sheets' && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-black/60 font-mono">
            电子表格加载失败，请检查控制台
          </div>
        )}
        {docsStatus === 'error' && kind === 'docs' && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-black/60 font-mono">
            文档加载失败，请检查控制台
          </div>
        )}
        {/* 工作表容器 */}
        <div
          ref={sheetsContainerRef}
          className="univer-container absolute inset-0"
          style={{ display: kind === 'sheets' ? 'block' : 'none', visibility: sheetsStatus === 'ready' ? 'visible' : 'hidden' }}
        />
        {/* 文档容器（key 变化时 React 会销毁旧 div 创建全新元素 —— Univer 的 React root
            按容器元素缓存，复用旧元素二次挂载会静默失败，必须换新元素） */}
        <div
          key={docsVersion}
          ref={docsContainerRef}
          className="univer-container absolute inset-0"
          style={{ display: kind === 'docs' ? 'block' : 'none', visibility: docsStatus === 'ready' ? 'visible' : 'hidden' }}
        />
        {/* 页码指示：叠在底部缩放栏左侧（36px 行内垂直居中），锚定抽屉编辑区左下角（随抽屉宽度始终靠左） */}
        {kind === 'docs' && status === 'ready' && pageInfo && (
          <div
            className="absolute bottom-0 left-0 z-10 flex items-center px-2 bg-white"
            style={{ height: 36 }}
            title="当前页 / 总页数（拖宽抽屉会重新排版，页数随之变化）"
          >
            <span className="text-xs font-medium" style={{ color: 'rgb(27, 28, 31)' }}>
              第 {pageInfo.current} 页，共 {pageInfo.total} 页
            </span>
          </div>
        )}
      </div>
    </div>
  )
}