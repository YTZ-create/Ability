/**
 * PagedDocsView — 把文档块按 A4 比例分页渲染（类似 WPS/Word 的多页版式）
 *
 * 流程（两阶段）：
 * 1. 渲染隐藏测量器（宽度 = 内容宽度，分栏时按栏宽），量出每个段落块总高、
 *    每个表格各「行」的偏移高度。
 * 2. 按块/行高度分配到固定高度 `contentHeight` 的页面：放不下则换页；
 *    表格跨页时按「行」拆分，每页输出独立 <table>，保证表格不被压扁。
 *
 * 「像 Word」增强：页面几何（宽/高/四边页边距）来自 docx <w:sectPr>（docxPagePx），
 * 每页铺设页眉/页脚区（PAGE 域替换为当前页码），支持分栏（CSS columns）。
 * 纯展示组件；编辑回读仍走 syncHtmlBackToRich（按单元格 data-i 定位）。
 */

import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { zonePageHtml } from '../../utils/docxRichRenderer'

export type PagedBlock =
  | { key: string; kind: 'p'; html: string; forceBreakBefore?: boolean }
  | { key: string; kind: 'table'; rowHtmls: string[]; forceBreakBefore?: boolean }

export interface PageMargins {
  top: number
  right: number
  bottom: number
  left: number
}

interface PagedDocsViewProps {
  blocks: PagedBlock[]
  /** 正文流动宽度（px），即版心宽 */
  contentWidth: number
  /** 正文流动高度（px），即版心高，超出则分页 */
  contentHeight: number
  /** 整页宽（px，缺省 = contentWidth） */
  pageWidth?: number
  /** 整页高（px，缺省 = contentHeight） */
  pageHeight?: number
  /** 四边页边距（px，缺省 0） */
  margins?: PageMargins
  /** 页眉 HTML（只读，PAGE 域占位会被区逐页替换为页码） */
  headerHtml?: string
  /** 页脚 HTML */
  footerHtml?: string
  /** 分栏数（缺省 1） */
  columns?: number
  /** 栏间距（px） */
  columnSpacingPx?: number
  onInput?: () => void
  /** 分页/页码变化时回调（当前页, 总页数） */
  onPageInfo?: (current: number, total: number) => void
}

/** 把块测量结果分配到多页 */
function distribute(blocks: PagedBlock[], heights: Map<string, number[]>, contentHeight: number): string[][] {
  const pages: string[][] = []
  let cur: string[] = []
  let curH = 0

  const flush = () => {
    if (cur.length) pages.push(cur)
    cur = []
    curH = 0
  }

  for (const b of blocks) {
    // 显式分页符（源文档 <w:br type="page"/>）→ 无论当前页还有多少空间都强制换页
    if (cur.length && b.forceBreakBefore) flush()
    if (b.kind === 'p') {
      const h = heights.get(b.key)?.[0] ?? 40
      // 段落高于一页 → 独占一页（允许滚动查看溢出）
      if (h > contentHeight) {
        flush()
        pages.push([`<div class="doc-block">${b.html}</div>`])
        continue
      }
      if (curH + h > contentHeight) flush()
      cur.push(`<div class="doc-block">${b.html}</div>`)
      curH += h
      continue
    }
    // 表格按行拆分
    const rowHs = heights.get(b.key) ?? b.rowHtmls.map(() => 30)
    let tblOpen = false
    const rowOpen = () => {
      if (tblOpen) return
      tblOpen = true
      cur.push(`<table class="t fragment" contenteditable="false"><tbody>`)
    }
    const rowClose = () => {
      if (!tblOpen) return
      tblOpen = false
      cur[cur.length - 1] += `</tbody></table>`
    }
    for (let i = 0; i < b.rowHtmls.length; i++) {
      const rh = rowHs[i] ?? 30
      // 行超页 → 独占一页
      if (rh > contentHeight) {
        rowClose()
        flush()
        pages.push([`<table class="t" contenteditable="false"><tbody>${b.rowHtmls[i]}</tbody></table>`])
        continue
      }
      if (curH + rh > contentHeight) {
        rowClose()
        flush()
      }
      rowOpen()
      cur.push(b.rowHtmls[i])
      curH += rh
    }
    rowClose()
  }
  flush()
  return pages
}

export const PagedDocsView = memo(function PagedDocsView({
  blocks,
  contentWidth,
  contentHeight,
  pageWidth,
  pageHeight,
  margins,
  headerHtml,
  footerHtml,
  columns,
  columnSpacingPx,
  onInput,
  onPageInfo,
}: PagedDocsViewProps) {
  const measurerRef = useRef<HTMLDivElement>(null)
  const pageListRef = useRef<HTMLDivElement>(null)
  const [innerList, setInnerList] = useState<string[]>([])
  const [, setCurrentPage] = useState(1)

  const m: PageMargins = margins ?? { top: 0, right: 0, bottom: 0, left: 0 }
  const pageW = pageWidth ?? contentWidth
  const pageH = pageHeight ?? contentHeight
  const colSpacing = columnSpacingPx ?? 0
  // 分栏时流动宽度为「栏宽」，行内块按栏宽换行，分页高度按栏高累积
  const flowWidth =
    columns && columns > 1 ? Math.max(60, Math.floor((contentWidth - (columns - 1) * colSpacing) / columns)) : contentWidth
  const innerHeight = Math.floor(contentHeight)

  // 阶段一：测量（同步读取 offsetHeight 需要测量器已布局）
  useLayoutEffect(() => {
    const root = measurerRef.current
    if (!root) return
    const heights = new Map<string, number[]>()
    for (const b of blocks) {
      if (b.kind === 'p') {
        const el = root.querySelector(`[data-k="${b.key}"]`)
        heights.set(b.key, [el ? (el as HTMLElement).offsetHeight : 40])
      } else {
        const tbl = root.querySelector(`[data-k="${b.key}"]`)
        if (tbl) {
          const rh = Array.from(tbl.querySelectorAll('tr')).map((r) => (r as HTMLElement).offsetHeight)
          heights.set(b.key, rh)
        } else {
          heights.set(b.key, b.rowHtmls.map(() => 30))
        }
      }
    }
    const pages = distribute(blocks, heights, contentHeight)
    const inners = pages.map((p) => p.join(''))
    setInnerList(inners)
    setCurrentPage(1)
    onPageInfo?.(1, inners.length)
  }, [blocks, contentWidth, contentHeight, flowWidth, onPageInfo])

  // 页壳：给每页套上整页宽高 + 四边页距 + 上下页眉页脚区（页码逐页填充）+ 分栏
  const rendered = useMemo(() => {
    const pgW = Math.max(100, Math.floor(pageW))
    const pgH = Math.max(80, Math.floor(pageH))
    const cols = columns && columns > 1 ? `column-count:${columns};column-gap:${colSpacing}px;` : ''
    const innerStyle = `box-sizing:border-box;width:${Math.floor(contentWidth)}px;height:${innerHeight}px;margin-left:${m.left}px;margin-right:${m.right}px;overflow:hidden;${cols}`

    return innerList
      .map((inner, i) => {
        const no = i + 1
        const hZone = headerHtml
          ? `<div class="doc-zone ${'hdr'}" style="box-sizing:border-box;width:100%;padding-left:${m.left}px;padding-right:${m.right}px;flex:0 0 auto;padding-bottom:4px;">${zonePageHtml(headerHtml, no)}</div>`
          : ''
        const fZone = footerHtml
          ? `<div class="doc-zone ftr" style="box-sizing:border-box;width:100%;padding-left:${m.left}px;padding-right:${m.right}px;flex:0 0 auto;padding-top:4px;">${zonePageHtml(footerHtml, no)}</div>`
          : ''
        return `<div class="doc-page" style="width:${pgW}px;min-height:${pgH}px;page-index:${i}">${hZone}<div class="doc-page-inner" style="${innerStyle}">${inner}</div>${fZone}</div>`
      })
      .join('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [innerList, pageW, pageH, contentWidth, m.top, m.right, m.bottom, m.left, columns, colSpacing, headerHtml, footerHtml])

  // 滚动时更新当前页：直接用 .doc-page 元素相对容器的可视位置判定。
  // 页面被父级按 htmlZoom 缩放，滚动步长 = (contentHeight+页边距)×zoom，
  // 不能再用固定步长换算；getBoundingClientRect 已含 transform，天然适配缩放。
  const handleScroll = () => {
    const el = pageListRef.current
    if (!el || pageListRef.current.children.length === 0) return
    const container = el.closest('.overflow-auto') as HTMLElement | null
    if (!container) return
    const top = container.getBoundingClientRect().top
    const pages = Array.from(el.children)
    let page = 1
    for (let i = 0; i < pages.length; i++) {
      if ((pages[i] as HTMLElement).getBoundingClientRect().top <= top + 4) page = i + 1
      else break
    }
    setCurrentPage((p) => {
      if (p !== page) onPageInfo?.(page, innerList.length)
      return p === page ? p : page
    })
  }

  return (
    <>
      {/* 隐藏测量器 */}
      <div
        ref={measurerRef}
        aria-hidden="true"
        className="docx-html measurer"
        style={{ position: 'fixed', left: '-10000px', top: 0, visibility: 'hidden', width: Math.max(60, Math.floor(flowWidth)), pointerEvents: 'none' }}
      >
        {blocks.map((b) => {
          if (b.kind === 'p')
            return <div key={b.key} className="doc-block" data-k={b.key} dangerouslySetInnerHTML={{ __html: b.html }} />
          return (
            <div key={b.key} className="doc-block" data-k={b.key}>
              <table className="t" contenteditable="false">
                <tbody dangerouslySetInnerHTML={{ __html: b.rowHtmls.join('') }} />
              </table>
            </div>
          )
        })}
      </div>
      {/* 分页展示；编辑改 DOM 后交给外部 onInput 同步 */}
      <div
        ref={pageListRef}
        className="docx-html paged"
        style={{}}
        onInput={onInput}
        onScroll={handleScroll}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    </>
  )
})