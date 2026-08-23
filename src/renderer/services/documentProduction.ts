/**
 * 文档生成服务（PENDING_UPDATE E 表 · 3.4 / §6.6）
 * 用 docx / pptxgenjs / xlsx / pdf-lib 生成 Word / PPT / Excel / PDF。
 * 供 Arthur（文档与演示专家）多格式分发调用。
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import pptxgen from 'pptxgenjs'
import * as XLSX from 'xlsx'
import * as PDFDocument from 'pdf-lib'

export interface DocColumn { header: string; key: string }
export interface DocData { rows: Record<string, any>[]; columns?: DocColumn[] }

/** 生成 .docx 并返回 Blob */
export async function buildDocx(title: string, sections: { heading: string; body: string }[]): Promise<Blob> {
  const children: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 32 })], heading: HeadingLevel.TITLE }),
  ]
  for (const s of sections) {
    children.push(new Paragraph({ children: [new TextRun({ text: s.heading, bold: true, size: 24 })], heading: HeadingLevel.HEADING_1 }))
    for (const line of s.body.split('\n')) children.push(new Paragraph(line))
  }
  const doc = new Document({ sections: [{ children }] })
  const buffer = await Packer.toBuffer(doc)
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

/** 生成 .pptx 幻灯片并返回 Blob */
export async function buildPptx(title: string, slides: { title: string; bullets: string[] }[]): Promise<Blob> {
  const pptx = new pptxgen()
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 })
  pptx.layout = 'WIDE'
  const first = PPTXSlide(pptx, title, '')
  first.addText(title, { x: 0.8, y: 2.6, w: 11.7, h: 1.2, fontSize: 36, bold: true, color: '1A1A1A', align: 'center' })
  for (const s of slides) {
    const slide = PPTXSlide(pptx, s.title, 'dup')
    slide.addText(s.title, { x: 0.8, y: 0.6, w: 11.7, h: 0.8, fontSize: 26, bold: true, color: '1A1A1A' })
    slide.addText(s.bullets, { x: 0.8, y: 1.7, w: 11.7, h: 4.8, fontSize: 18, color: '333333', breakLine: true })
  }
  return await pptx.write({ outputType: 'blob' }) as Blob
}
function PPTXSlide(pptx: pptxgen, _t: string, _m: string) {
  const slide = pptx.addSlide()
  slide.background = { color: 'FFFFFF' }
  return slide
}

/** 生成 .xlsx 并返回 Blob */
export async function buildXlsx(sheetName: string, data: DocData): Promise<Blob> {
  const aoa: (string | any)[][] = []
  const cols = data.columns || (data.rows[0] ? Object.keys(data.rows[0]).map((k) => ({ header: k, key: k })) : [])
  aoa.push(cols.map((c) => c.header))
  for (const row of data.rows) aoa.push(cols.map((c) => row[c.key]))
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/** 生成 .pdf（含文本表格形式）并返回 Blob */
export async function buildPdf(title: string, lines: string[]): Promise<Blob> {
  const doc = await PDFDocument.PDFDocument.create()
  const page = doc.addPage([595.28, 841.89])
  let y = page.getHeight() - 56
  page.drawText(title, { x: 48, y, size: 20 })
  y -= 24
  for (const line of lines.slice(0, 300)) {
    if (y < 48) { /* 简单分页略 */ y -= 12; continue }
    page.drawText((line || '').slice(0, 90), { x: 48, y, size: 10 })
    y -= 12
  }
  const bytes = await doc.save()
  return new Blob([bytes], { type: 'application/pdf' })
}