/**
 * 答案合并工具（纯函数，便于独立测试和复用）
 * 用于把 _applyAnswerToParagraphs 改动的 model 文本智能合并回 paragraph.runs。
 *
 * 设计原则：
 * 1. 智能切分：找 common prefix/suffix，定位插入点，保留前缀/后缀 runs 的样式。
 * 2. 安全兜底：当 runs 拼接文本与 oldText 严重不符（含 tab/换行被丢弃的 run 等）
 *    时，整段重写为单 run，继承首个非空 run 的样式。
 * 3. 不假设 runs 结构：任意 docx 段落结构下都保证答案不丢。
 */

export interface DocxRunLike {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  underline?: string
  color?: string
  highlight?: string
  vertAlign?: 'super' | 'sub'
  outline?: boolean
  characterSpacing?: number
  fontSize?: number
  fontFamily?: string
}

/** 从源 run 复制所有排版样式到目标 run（下划线/粗斜/颜色/底纹/上下标/空心/字距/字号/字体都继承）。 */
function copyStyle(src: DocxRunLike, dst: DocxRunLike): DocxRunLike {
  if (src.bold) dst.bold = true
  if (src.italic) dst.italic = true
  if (src.strike) dst.strike = true
  if (src.underline) dst.underline = src.underline
  if (src.color) dst.color = src.color
  if (src.highlight) dst.highlight = src.highlight
  if (src.vertAlign) dst.vertAlign = src.vertAlign
  if (src.outline) dst.outline = true
  if (src.characterSpacing) dst.characterSpacing = src.characterSpacing
  if (src.fontSize) dst.fontSize = src.fontSize
  if (src.fontFamily) dst.fontFamily = src.fontFamily
  return dst
}

export interface ParagraphLike {
  runs: DocxRunLike[]
  empty?: boolean
}

/**
 * 智能把 newText 合并到 paragraph.runs 中，保留原 run 样式。
 *
 * 关键：runs 拼接文本可能含 tab/换行（来自 <w:tab>/<w:br>）等控制字符，
 * 而 oldText 是 trim 后的纯文本。为正确处理这种情况，prefix/suffix 计算
 * 采用"空白归一化"匹配（把连续空白视为单字符匹配），确保切点位置准确。
 */
export function mergeAnswerIntoParagraph(
  paragraph: ParagraphLike,
  oldText: string,
  newText: string
): void {
  const runs = Array.isArray(paragraph.runs) ? paragraph.runs : []
  const runsJoined = runs.map((r) => String(r.text || '')).join('')
  if (!isAcceptableMatch(runsJoined, oldText)) {
    fallbackRewrite(paragraph, newText)
    return
  }
  // 归一化映射：把 runsJoined 和 oldText 都转成空白归一化版本，
  // prefix/suffix 在归一化字符串上计算，最后用归一化坐标切 runs。
  const a = normalizeWS(runsJoined)
  const b = normalizeWS(oldText)
  const c = normalizeWS(newText)
  let pre = 0
  const minLen = Math.min(a.length, c.length)
  while (pre < minLen && a[pre] === c[pre]) pre++
  let suf = 0
  while (
    suf < a.length - pre &&
    suf < c.length - pre &&
    a[a.length - 1 - suf] === c[c.length - 1 - suf]
  )
    suf++
  // 把归一化坐标 a[pre..a.length-suf] 映射回 runsJoined 的字符坐标
  // 思路：遍历 runsJoined 累加 char count，找到第 pre 个归一化字符对应的原始 cursor，
  //       和后 suf 个归一化字符对应的原始 cursor 起点。
  const normIdxToRaw = buildNormToRawIndex(runsJoined)
  const rawCutStart = normIdxToRaw(pre) // prefix 切尾的原始字符索引
  const rawCutEnd = normIdxToRaw(a.length - suf) // suffix 切头的原始字符索引
  // insertedRaw: 只保留 newText 归一化坐标 [pre..c.length-suf] 对应的原文字符。
  // 用 normIdxToRaw 把归一化坐标映射回 newText 原文字符索引。
  const cNormToRaw = buildNormToRawIndex(newText)
  const insStartRaw = cNormToRaw(pre)
  const insEndRaw = cNormToRaw(c.length - suf)
  const insertedRaw = newText.slice(insStartRaw, insEndRaw)
  // rawCutStart 取到 rawCutStart 所在空白块的结束位置（即将整个空白块归入 prefix），
  // rawCutEnd 取到 rawCutEnd 所在空白块的开始位置（即将整个空白块归入 suffix），
  // 这样切点不会把空白字符孤立到 drop 区段，避免出现"中间的空白/tab 被吞"。
  const adjustCutToWS = (raw: string, cut: number, mode: 'start' | 'end'): number => {
    if (mode === 'start' && cut > 0 && cut < raw.length && /\s/.test(raw[cut])) {
      // cut 在空白块内 → 推进到空白块结束
      let i = cut
      while (i < raw.length && /\s/.test(raw[i])) i++
      return i
    }
    if (mode === 'end' && cut > 0 && cut < raw.length && /\s/.test(raw[cut - 1])) {
      // cut 在空白块内 → 退到空白块开始
      let i = cut
      while (i > 0 && /\s/.test(raw[i - 1])) i--
      return i
    }
    return cut
  }
  const rawCutStartAdj = adjustCutToWS(runsJoined, rawCutStart, 'start')
  const rawCutEndAdj = adjustCutToWS(runsJoined, rawCutEnd, 'end')
  // 把 runs 切成 prefix / drop / suffix 三段（用调整后的切点）
  const prefixRuns: DocxRunLike[] = []
  const suffixRuns: DocxRunLike[] = []
  const droppedRuns: DocxRunLike[] = [] // 被替换区段里的 run（填空题占位符通常在这里，带下划线）
  let cursor = 0
  for (const r of runs) {
    const t = String(r.text || '')
    if (t.length === 0) continue
    const rStart = cursor
    const rEnd = cursor + t.length
    if (rEnd <= rawCutStartAdj) {
      prefixRuns.push({ ...r })
    } else if (rStart >= rawCutEndAdj) {
      suffixRuns.push({ ...r })
    } else {
      const preKeep = Math.max(0, Math.min(rEnd, rawCutStartAdj) - rStart)
      const sufKeep = Math.max(0, rEnd - Math.max(rStart, rawCutEndAdj))
      if (sufKeep === 0 && preKeep === 0) {
        // 整个 run 落入被替换区 → 记录其样式（填空下划线占位就在这）
        droppedRuns.push({ ...r })
      }
      if (preKeep > 0) prefixRuns.push({ ...r, text: t.slice(0, preKeep) })
      if (sufKeep > 0) suffixRuns.push({ ...r, text: t.slice(t.length - sufKeep) })
    }
    cursor = rEnd
  }
  const cleanPrefix = mergeAdjacent(prefixRuns)
  const cleanSuffix = mergeAdjacent(suffixRuns)
  // 样式源优先级：先取被替换的占位 run（保住下划线），再退回保留的前缀/后缀/首个 run。
  const styleSrc = droppedRuns[0] || cleanPrefix[cleanPrefix.length - 1] || cleanSuffix[0] || runs[0] || {}
  const valueRun: DocxRunLike = copyStyle(styleSrc, { text: insertedRaw })
  if (insertedRaw.length === 0) {
    paragraph.runs = [...cleanPrefix, ...cleanSuffix]
  } else {
    paragraph.runs = [...cleanPrefix, valueRun, ...cleanSuffix]
  }
  paragraph.empty = paragraph.runs.length === 0 || paragraph.runs.every((r) => !r.text)
}

/** 把字符串的连续空白合并成单空格，便于对齐比较 */
function normalizeWS(s: string): string {
  return s.replace(/\s+/g, ' ')
}

/**
 * 给定 raw 字符串，构建"归一化字符索引 → raw 字符索引"映射。
 * 归一化规则：把每个空白块视为单字符 ' '。
 */
function buildNormToRawIndex(raw: string): (normIdx: number) => number {
  const map: number[] = []
  let i = 0
  while (i < raw.length) {
    if (/\s/.test(raw[i])) {
      // 整个空白块映射到块起点
      map.push(i)
      while (i < raw.length && /\s/.test(raw[i])) i++
    } else {
      map.push(i)
      i++
    }
  }
  return (normIdx: number) => {
    if (normIdx <= 0) return 0
    if (normIdx >= map.length) return raw.length
    return map[normIdx]
  }
}

function fallbackRewrite(paragraph: ParagraphLike, newText: string): void {
  const runs = Array.isArray(paragraph.runs) ? paragraph.runs : []
  const styleSrc: DocxRunLike = runs.find((r) => r.text && r.text.length > 0) || runs[0] || {}
  paragraph.runs = newText ? [copyStyle(styleSrc, { text: newText })] : []
  paragraph.empty = !newText
}

function isAcceptableMatch(runsJoined: string, oldText: string): boolean {
  if (runsJoined === oldText) return true
  return runsJoined.replace(/\s+/g, '') === oldText.replace(/\s+/g, '')
}

function mergeAdjacent(runs: DocxRunLike[]): DocxRunLike[] {
  const out: DocxRunLike[] = []
  for (const r of runs) {
    const t = String(r.text || '')
    if (!t) continue
    const last = out[out.length - 1]
    if (last && String(last.text) === t) continue
    out.push(r)
  }
  return out
}
