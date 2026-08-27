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
import PizZip from 'pizzip'

export type OfficeStatus = 'initializing' | 'ready' | 'error'
export type EditorKind = 'sheets' | 'docs'

/**
 * 解析上传文件为段落数组（保留结构，避免 docx 所有文本拼成一行）
 * 支持 .docx（按 <w:p> 段落提取）及其余格式（按纯文本分行）
 */
async function parseDocxParagraphs(fileName: string, buffer: ArrayBuffer): Promise<string[]> {
  if (!/\.docx$/i.test(fileName)) {
    const text = new TextDecoder().decode(buffer)
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
  }

  const zip = new PizZip(buffer)
  const docXml = zip.file('word/document.xml')?.asText()
  if (!docXml) return []

  // 按 <w:p>...</w:p> 切分段落，每个段落内拼接所有 <w:t> 文本
  const paragraphs: string[] = []
  const paraRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g
  const textRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g

  let paraMatch: RegExpExecArray | null
  while ((paraMatch = paraRegex.exec(docXml))) {
    const paraXml = paraMatch[0]
    let paraText = ''
    let textMatch: RegExpExecArray | null
    textRegex.lastIndex = 0
    while ((textMatch = textRegex.exec(paraXml))) {
      paraText += textMatch[1]
    }
    if (paraText) paragraphs.push(paraText.trim())
  }

  return paragraphs
}

/**
 * 为容器绑定 ResizeObserver，避免「就绪但白屏」（Univer 需要知道真实尺寸）
 */
function useResizeFix(ref: React.RefObject<HTMLDivElement | null>, apiGetter: () => any | null) {
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
  }, [])
}

export const OfficePanel: React.FC = () => {
  const [kind, setKind] = useState<EditorKind>('sheets')
  const sheetsContainerRef = useRef<HTMLDivElement>(null)
  const docsContainerRef = useRef<HTMLDivElement>(null)
  const [sheetsStatus, setSheetsStatus] = useState<OfficeStatus>('initializing')
  const [docsStatus, setDocsStatus] = useState<OfficeStatus>('initializing')
  const addWorkbook = useOfficeStore((s) => s.addWorkbook)
  const addDocument = useOfficeStore((s) => s.addDocument)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const docFileInputRef = useRef<HTMLInputElement>(null)

  useResizeFix(sheetsContainerRef, () => officeService.sheetsAPI)
  useResizeFix(docsContainerRef, () => officeService.docsAPI)

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

  // 初始化文档实例
  useEffect(() => {
    if (!docsContainerRef.current) return

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
    } else {
      setDocsStatus('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      // 清空现有内容后再导入
      const cleared = officeService.clearDocument()
      if (!cleared.success) {
        console.error(cleared.message)
      }

      const buffer = await file.arrayBuffer()
      const paragraphs = await parseDocxParagraphs(file.name, buffer)

      const result = officeService.importDocumentParagraphs(paragraphs)
      if (result.success) {
        setDocsNote(`已导入 ${file.name}`)
      } else {
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
  const setActiveKind = useOfficeDrawerStore((s) => s.setActiveKind)
  // 工作表 / 文档 反馈包装：各自独立存储，互不覆盖
  const setSheetsNote = useCallback((msg: string) => setSheetsFeedback(msg), [setSheetsFeedback])
  const setDocsNote = useCallback((msg: string) => setDocsFeedback(msg), [setDocsFeedback])

  // 同步当前激活页面，驱动标题栏反馈的显隐
  useEffect(() => {
    setActiveKind(kind)
  }, [kind, setActiveKind])

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
                  className="text-[10px] font-mono px-2 py-0.5 border-2 border-brutal-black bg-white hover:bg-brutal-cream shadow-brutal-sm active:shadow-none active:translate-x-[1px] active:translate-y-[1px] transition-all duration-100 flex items-center gap-1"
                  title="导入 .xlsx"
                >
                  <Upload size={10} /> 导入
                </button>
                <button
                  onClick={handleExportSheets}
                  className="text-[10px] font-mono px-2 py-0.5 border-2 border-brutal-black bg-white hover:bg-brutal-lime shadow-brutal-sm active:shadow-none active:translate-x-[1px] active:translate-y-[1px] transition-all duration-100 flex items-center gap-1"
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
                  className="text-[10px] font-mono px-2 py-0.5 border-2 border-brutal-black bg-white hover:bg-brutal-cream shadow-brutal-sm active:shadow-none active:translate-x-[1px] active:translate-y-[1px] transition-all duration-100 flex items-center gap-1"
                  title="导入文档"
                >
                  <Upload size={10} /> 导入
                </button>
                <button
                  onClick={handleExportDocs}
                  className="text-[10px] font-mono px-2 py-0.5 border-2 border-brutal-black bg-white hover:bg-brutal-lime shadow-brutal-sm active:shadow-none active:translate-x-[1px] active:translate-y-[1px] transition-all duration-100 flex items-center gap-1"
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
        {/* 文档容器 */}
        <div
          ref={docsContainerRef}
          className="univer-container absolute inset-0"
          style={{ display: kind === 'docs' ? 'block' : 'none', visibility: docsStatus === 'ready' ? 'visible' : 'hidden' }}
        />
      </div>
    </div>
  )
}