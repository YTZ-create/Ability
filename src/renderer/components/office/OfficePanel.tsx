/**
 * OfficePanel — Univer 容器与状态徽章（不含外层 chrome）
 *
 * 设计为「内容组件」：抽屉/CapabilitiesHub 等容器负责提供标题栏与关闭按钮
 * 支持两类编辑器：工作表（Sheets）/ 文档（Docs），通过类型切换展示
 * 两个容器常驻挂载（避免卸载破坏 Univer 实例），用 display 切换可见性
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Download, Upload, FileText, Minus, Plus } from 'lucide-react'
import { FileSpreadsheet } from 'lucide-react'
import { officeService } from '../../services/officeService'
import { useOfficeStore } from '../../stores/officeStore'
import { useOfficeDrawerStore } from '../../stores/officeDrawerStore'
import { usePluginStore } from '../../stores/pluginStore'
import * as XLSX from 'xlsx'
import { parseDocxParagraphs, parseDocxRichDocument } from '../../utils/docxParagraphs'
import {
  docxRichToHtml,
  docxRichToBlocks,
  syncHtmlBackToRich,
  docxRichToBlob,
  docxPagePx,
  sectionZoneHtml,
  buildFallbackHeaderHtml,
} from '../../utils/docxRichRenderer'
import type { DocxRichDocument } from '../../utils/docxParagraphs'
import { PagedDocsView, type PagedBlock } from './PagedDocsView'

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
  const htmlDocsRef = useRef<HTMLDivElement>(null)
  const [sheetsStatus, setSheetsStatus] = useState<OfficeStatus>('initializing')
  const [docsStatus, setDocsStatus] = useState<OfficeStatus>('initializing')
  const addWorkbook = useOfficeStore((s) => s.addWorkbook)
  const addDocument = useOfficeStore((s) => s.addDocument)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const docFileInputRef = useRef<HTMLInputElement>(null)
  const docsVersion = useOfficeDrawerStore((s) => s.docsVersion)
  const [pageInfo, setPageInfo] = useState<{ current: number; total: number } | null>(null)
  // HTML 渲染模式：开关启用时文档页用 HTML 原生渲染（绕开 Univer 表格转换），关闭回退 Univer
  const docsHtmlEnabled = usePluginStore((s) => s.plugins.find((p) => p.id === 'docs-html')?.enabled ?? false)
  // HTML 模式的当前富结构文档与最新 HTML 字符串
  const [htmlRich, setHtmlRich] = useState<DocxRichDocument | null>(null)
  const [htmlStatus, setHtmlStatus] = useState<OfficeStatus>('initializing')
  // HTML 模式分页开关：true=多页 A4 版式；false=连续整页
  const [htmlPaged, setHtmlPaged] = useState(true)
  // HTML 文档的块列表（分页测量用）
  const [htmlBlocks, setHtmlBlocks] = useState<PagedBlock[]>([])
  // 分页内容宽/高：固定 A4 逻辑尺寸（= 原文档页宽），随内容高度定高。
  // 排版分页只依赖这个固定尺寸，宽度变化只改缩放，不重排 → 每页内容稳定。
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null)
  // HTML 分页视图的显示缩放（宽度适配用，不影响分页）
  const [htmlZoom, setHtmlZoom] = useState(1)
  // 连续缩放值（未量化）：捏合缩放用它累积，避免每帧取整造成阶梯/卡顿。展示时再取整。
  const htmlZoomRef = useRef(1)
  // 缩放模式：fit=适应宽度（抽屉拖动时自动缩放且打印不变）；manual=用户手动缩放
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit')
  // HTML 分页视图的总页数与当前页
  const [htmlPageInfo, setHtmlPageInfo] = useState<{ current: number; total: number } | null>(null)
  // 「像 Word」页面几何：源自原文档 <w:sectPr>（docxPagePx）+ 页眉/页脚/分栏
  const [pageGeo, setPageGeo] = useState<{
    pageWidthPx: number
    pageHeightPx: number
    contentWidthPx: number
    contentHeightPx: number
    margins: { top: number; right: number; bottom: number; left: number }
    headerHtml?: string
    footerHtml?: string
    columns: number
    columnSpacingPx: number
  } | null>(null)

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

  // HTML 渲染模式：导入（docsVersion 变化）或开关启用时，从富结构模型渲染可编辑 HTML。
  // 表格/合并/边框由浏览器原生渲染，天然稳定；编辑后通过 syncHtmlBackToRich 写回模型。
  useEffect(() => {
    if (!docsHtmlEnabled) return
    if (kind !== 'docs') return
    // 首次进来需要先有富模型（可能是「未命名文档」尚无 content，也尝试同步一次）
    const rich = officeService.getCurrentDocsRich()
    setHtmlRich((prev) => (rich === prev ? prev : rich))
    setHtmlBlocks((prev) => {
      const next = rich ? docxRichToBlocks(rich) : []
      // 仅当 key 与内容指纹都相同时才复用 prev —— 否则答案写入后
      // dangerouslySetInnerHTML/PagedDocsView 不会收到新块，文档页无法更新。
      const same =
        prev.length === next.length &&
        prev.every((b, i) => {
          if (b.key !== next[i].key) return false
          if (b.kind !== next[i].kind) return false
          if (b.kind === 'p') return b.html === (next[i] as any).html
          return b.rowHtmls.join('\u0000') === (next[i] as any).rowHtmls.join('\u0000')
        })
      return same ? prev : next
    })
  }, [docsHtmlEnabled, kind, docsVersion, htmlPaged])

  // 推导分页尺寸：读取原文档 <w:sectPr> 的真实页面几何（宽/高/四边页距/分栏）+ 页眉/页脚。
  // 每次 htmlRich 引用变化（导入新文档）时重算；同一次导入不重算。
  // 用 pageGeo 自身的值作为"已计算"的哨兵，避免每次 drawer 宽度变化或 zoom 变化都重排。
  const lastMeasuredRef = useRef<DocxRichDocument | null>(null)
  useEffect(() => {
    if (!docsHtmlEnabled || !htmlPaged) return
    if (!htmlRich) return
    if (lastMeasuredRef.current === htmlRich) return
    lastMeasuredRef.current = htmlRich
    const geo = docxPagePx(htmlRich)
    const margins = {
      top: geo.marginTopPx,
      right: geo.marginRightPx,
      bottom: geo.marginBottomPx,
      left: geo.marginLeftPx,
    }
    // 没有原页眉时使用文档名作为兜底页眉（与 WPS 显示文件名保持一致）
    const docName = htmlRich.name
    const hdr = sectionZoneHtml(htmlRich, 'header') || (docName ? buildFallbackHeaderHtml(docName) : '')
    const ftr = sectionZoneHtml(htmlRich, 'footer')
    setPageGeo({
      pageWidthPx: geo.widthPx,
      pageHeightPx: geo.heightPx,
      contentWidthPx: geo.contentWidthPx,
      contentHeightPx: geo.contentHeightPx,
      margins,
      headerHtml: hdr || undefined,
      footerHtml: ftr || undefined,
      columns: geo.columns,
      columnSpacingPx: geo.columnSpacingPx,
    })
    // pageSize 用于缩放与容器宽度 —— 用「整页宽」做宽度基准，避免页边距导致横向溢出
    setPageSize({ w: geo.widthPx, h: geo.heightPx })
    const el = htmlDocsRef.current
    const available = Math.max(100, el ? el.clientWidth : 794)
    setHtmlZoom(Math.max(0.3, Math.min(2.5, available / geo.widthPx)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsHtmlEnabled, htmlPaged, htmlRich])

  // 缩放适配宽度：抽屉宽度变化时，用 CSS transform 缩放分页容器，
  // 使页面贴合容器宽。缩放不影响排版分页 → 每页内容稳定、不重排。
  // 仅在 fit（适应宽度）模式下自动跟随抽屉宽度；用户手动缩放后保持不变。
  const drawerWidth = useOfficeDrawerStore((s) => s.width)
  const ZOOM_MIN = 0.3
  const ZOOM_MAX = 2.5
  const ZOOM_STEP = 0.1
  useEffect(() => {
    if (!htmlPaged || !pageSize) return
    if (zoomMode !== 'fit') return
    const t = setTimeout(() => {
      const el = htmlDocsRef.current
      if (!el) return
      const available = Math.max(100, el.clientWidth - 56) // 页横边距
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, available / pageSize.w))
      setHtmlZoom((prev) => (Math.abs(prev - next) > 0.001 ? next : prev))
    }, 120)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerWidth, htmlPaged, pageSize, kind, zoomMode])

  // 导入新文档 / 切换分页开关后，回到「适应宽度」模式并立即按当前宽度适配
  useEffect(() => {
    if (!docsHtmlEnabled || !htmlPaged || !pageSize) return
    const el = htmlDocsRef.current
    if (!el) return
    setZoomMode('fit')
    const available = Math.max(100, el.clientWidth - 56)
    setHtmlZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, available / pageSize.w)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsHtmlEnabled, htmlPaged, docsVersion])

  const zoomIn = useCallback(() => {
    setZoomMode('manual')
    setHtmlZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100))
  }, [])
  const zoomOut = useCallback(() => {
    setZoomMode('manual')
    setHtmlZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100))
  }, [])
  const zoomFit = useCallback(() => {
    if (!pageSize) return
    // 已在「适应宽度」→ 再点一次退出，保持当前缩放值不变（不跳变），转为手动模式。
    if (zoomMode === 'fit') {
      setZoomMode('manual')
      return
    }
    // 首次点击才真正进入 fit：立即按当前宽度缩放。
    const el = htmlDocsRef.current
    if (el) {
      const available = Math.max(100, el.clientWidth - 56)
      setHtmlZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, available / pageSize.w)))
    }
    setZoomMode('fit')
  }, [pageSize, zoomMode])

  // 触控板捏合缩放：Chromium 把触控板双指捏合映射为 ctrlKey/metaKey=true 的 wheel 事件。
  // 只拦这类事件做缩放，普通两指滚动（浏览上下）的 wheel 不带 ctrlKey，不受影响。
  // 必须用原生非被动 listener 才能 preventDefault，否则页面/浏览器默认会放大整页。
  // 平滑：捏合步长天然极小，用 htmlZoomRef 连续累加、不量化，避免阶梯感。
  useEffect(() => {
    const el = htmlDocsRef.current
    if (!el || !docsHtmlEnabled) return
    // 每个 wheel 事件前同步一次 ref，避免 ref 与 state 短暂脱节造成跳变
    htmlZoomRef.current = htmlZoom
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      // 生理像素归一化：deltaMode 0=像素 1=行(≈16px) 2=页(≈120px)
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 120 : e.deltaY
      const factor = Math.pow(2, -delta / 600)
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, htmlZoomRef.current * factor))
      htmlZoomRef.current = next
      setZoomMode('manual')
      setHtmlZoom(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, docsHtmlEnabled, htmlZoom])

  useEffect(() => {
    if (!docsHtmlEnabled) return
    if (!htmlRich) return
    // 若有可编辑 DOM 且用户有改动，先回写完再决定是否重渲染（由上层 flush 决定）
    if (htmlDocsRef.current) {
      syncHtmlBackToRich(htmlRich, htmlDocsRef.current)
    }
  }, [docsVersion, docsHtmlEnabled])

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
      let blob: Blob | null = null
      setDocsFeedback('正在导出到 docx...')
      if (docsHtmlEnabled) {
        // HTML 渲染模式：先把页面改动回写模型，再用 docx 库「原样导出」富结构
        const rich = officeService.getCurrentDocsRich()
        if (htmlDocsRef.current && rich) {
          try { syncHtmlBackToRich(rich, htmlDocsRef.current) } catch (e: any) { console.warn('同步编辑到模型失败:', e) }
        }
        try {
          if (rich) {
            blob = await docxRichToBlob(rich)
          } else {
            setDocsFeedback('暂无可导出的文档内容（尚未导入文档）')
            return
          }
        } catch (e: any) {
          // docx 原生导出失败 → 回退 Univer 导出，保证一定有产物
          console.error('docx 原生导出失败，回退 Univer:', e)
          setDocsFeedback(`原生导表失败，已回退：${e?.message ?? e}`)
          blob = await officeService.exportDocument()
        }
      } else {
        blob = await officeService.exportDocument()
      }
      if (!blob) {
        setDocsFeedback('导出失败：未生成文档文件')
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'document.docx'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setDocsFeedback('已导出')
    } catch (err: any) {
      console.error('导出失败:', err)
      setDocsFeedback(`导出失败: ${err?.message ?? err}`)
    }
  }, [docsHtmlEnabled])

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
      const title = file.name.replace(/\.[^.]+$/, '')

      if (/\.docx$/i.test(file.name)) {
        // .docx 走「富结构」路径：保留段落 + 表格 + 合并 + 边框 + 列宽
        // 原文档排版（申报书等带表格文档）在 Univer 中完整还原，不再压成 " ｜ " 纯文本
        const rich = await parseDocxRichDocument(file.name, buffer)
        if (!rich.blocks.length) {
          setDocsNote('文档内容为空或解析失败')
        } else {
          const result = officeService.prepareDocsImportRich(rich, title)
          if (!result.success) {
            setDocsNote(`导入失败: ${result.message}`)
          }
        }
      } else {
        // 文本类（.txt/.md/.html/.htm/.json/.yaml/.xml/.rtf 等）走旧段落路径
        const paragraphs = await parseDocxParagraphs(file.name, buffer)
        const result = officeService.importDocumentParagraphs(paragraphs, title)
        if (!result.success) {
          setDocsNote(`导入失败: ${result.message}`)
        }
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

  const status = kind === 'sheets' ? sheetsStatus : docsHtmlEnabled ? 'ready' : docsStatus

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
                {docsHtmlEnabled && (
                  <button
                    onClick={() => setHtmlPaged((v) => !v)}
                    className="text-[10px] font-bold font-mono px-2 py-0.5 border-2 border-brutal-black bg-white hover:bg-brutal-pink shadow-brutal-sm active:shadow-none active:translate-x-[1px] active:translate-y-[1px] transition-all duration-100"
                    title={htmlPaged ? '切换到连续整页' : '切换到 A4 分页'}
                  >
                    {htmlPaged ? '连续' : '分页'}
                  </button>
                )}
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
        {docsHtmlEnabled ? (
          /* HTML 文档渲染：绕开 Univer 的 DOCX→UDM 表格转换，浏览器原生稳定渲染表格 */
          <div
            ref={htmlDocsRef}
            className="absolute inset-0 overflow-auto bg-white univer-container"
            style={{ display: kind === 'docs' ? 'block' : 'none' }}
          >
            {htmlRich ? (
              htmlPaged && pageSize ? (
                /* 水平居中：
                   - 容器用 flex items-center，子项内联 width 用「未缩放」的 pageSize.w。
                   - transform: scale 不会改布局盒，只改渲染尺寸 → 视觉按子项 width 居中。
                   - 之前写 width: pageSize.w * htmlZoom 造成"已缩放"再被 scale 二次放大，
                     视觉矩形 = 原始宽 × zoom × zoom，且子项 width 又按 zoom 取，导致
                     抽屉窄时右侧留大块空白。 */
                <div className="flex min-h-full w-full flex-col items-center pt-6 pb-16">
                  <div style={{ width: Math.floor(pageSize.w), flex: '0 0 auto' }}>
                  <div
                    style={{
                      transform: `scale(${htmlZoom})`,
                      transformOrigin: 'top center',
                    }}
                  >
                    <PagedDocsView
                      blocks={htmlBlocks}
                      contentWidth={pageGeo ? pageGeo.contentWidthPx : pageSize.w}
                      contentHeight={pageGeo ? pageGeo.contentHeightPx : pageSize.h}
                      pageWidth={pageGeo ? pageGeo.pageWidthPx : pageSize.w}
                      pageHeight={pageGeo ? pageGeo.pageHeightPx : pageSize.h}
                      {...(pageGeo
                        ? {
                            margins: pageGeo.margins,
                            headerHtml: pageGeo.headerHtml,
                            footerHtml: pageGeo.footerHtml,
                            columns: pageGeo.columns,
                            columnSpacingPx: pageGeo.columnSpacingPx,
                          }
                        : {})}
                      onInput={() => {
                        const rich = officeService.getCurrentDocsRich()
                        if (rich && htmlDocsRef.current) syncHtmlBackToRich(rich, htmlDocsRef.current)
                      }}
                      onPageInfo={(cur, total) =>
                        setHtmlPageInfo((prev) =>
                          prev && prev.current === cur && prev.total === total ? prev : { current: cur, total }
                        )
                      }
                    />
                  </div>
                  </div>
                </div>
              ) : (
                <div className="docx-html p-4" onInput={() => {
                  const rich = officeService.getCurrentDocsRich()
                  if (rich && htmlDocsRef.current) syncHtmlBackToRich(rich, htmlDocsRef.current)
                }}
                  dangerouslySetInnerHTML={{ __html: docxRichToHtml(htmlRich) }}
                />
              )
            ) : (
              docsHtmlEnabled &&
              kind === 'docs' && (
                <div className="flex h-full items-center justify-center text-xs text-black/40 font-mono">
                  暂无文档内容，请导入 .docx 或在右侧卡片编辑
                </div>
              )
            )}
          </div>
        ) : (
          /* 文档容器（key 变化时 React 会销毁旧 div 创建全新元素 —— Univer 的 React root
              按容器元素缓存，复用旧元素二次挂载会静默失败，必须换新元素） */
          <div
            key={docsVersion}
            ref={docsContainerRef}
            className="univer-container absolute inset-0"
            style={{ display: kind === 'docs' ? 'block' : 'none', visibility: docsStatus === 'ready' ? 'visible' : 'hidden' }}
          />
        )}
        {/* 页码 + 缩放栏：叠在底部。Univer 模式用 pageInfo（无缩放控件）；
            HTML 分页模式用 htmlPageInfo，并提供 − % + 适应宽度等缩放控件 */}
        {kind === 'docs' &&
          status === 'ready' &&
          (docsHtmlEnabled ? htmlPageInfo?.total : pageInfo) && (
            <div
              className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between px-3 bg-white border-t-2 border-brutal-black"
              style={{ height: 36 }}
            >
              <span
                className="text-xs font-medium"
                style={{ color: 'rgb(27, 28, 31)' }}
                title={
                  docsHtmlEnabled
                    ? '当前页 / 总页数（缩放随抽屉宽度自适应，每页内容不变）'
                    : '当前页 / 总页数（拖宽抽屉会重新排版，页数随之变化）'
                }
              >
                第 {docsHtmlEnabled ? (htmlPageInfo?.current ?? 1) : pageInfo!.current} 页 / 共{' '}
                {docsHtmlEnabled ? htmlPageInfo!.total : pageInfo!.total} 页
              </span>
              {docsHtmlEnabled && htmlPaged && pageSize && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={zoomOut}
                    className="flex h-6 w-6 items-center justify-center border border-brutal-black bg-white hover:bg-brutal-cream active:translate-y-[1px]"
                    title="缩小"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="min-w-[52px] text-center font-mono text-xs font-bold" style={{ color: 'rgb(27, 28, 31)' }}>
                    {Math.round(htmlZoom * 100)}%
                  </span>
                  <button
                    onClick={zoomIn}
                    className="flex h-6 w-6 items-center justify-center border border-brutal-black bg-white hover:bg-brutal-cream active:translate-y-[1px]"
                    title="放大"
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    onClick={zoomFit}
                    className={`h-6 border px-2 font-mono text-[10px] font-bold active:translate-y-[1px] ${
                      zoomMode === 'fit'
                        ? 'border-brutal-black bg-brutal-yellow'
                        : 'border-brutal-black bg-white hover:bg-brutal-cream'
                    }`}
                    title="缩放随抽屉宽度自适应"
                  >
                    适应宽度
                  </button>
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  )
}