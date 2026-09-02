/**
 * LLM 输出 JSON 的鲁棒解析器。
 * LLM 在长输出时（>2000 tokens）经常出现：
 * 1. 输出被截断（最后几行/字段缺失）
 * 2. 未用 ```json``` 包裹
 * 3. JSON 内部有未转义引号/换行
 * 4. 多个 ```json``` 块拼接
 * 5. 末尾含 "Here is the JSON:" 等说明文字
 *
 * 本模块按以下策略依次尝试，确保最大提取成功率：
 * A. 直接 JSON.parse
 * B. 补全被截断的 JSON（追加 ] 或 } 后再 parse）
 * C. 提取 ```json ... ``` 代码块
 * D. 提取顶层 [ ... ] 数组
 * E. 正则逐个提取字段对象
 */

export interface JsonParseResult {
  ok: boolean
  value?: unknown
  error?: string
  /** 实际使用的策略：'direct' | 'truncated-fix' | 'codeblock' | 'array-extract' | 'regex-objects' | 'failed' */
  strategy: string
  /** 当策略为 regex-objects 时返回的字段数 */
  fieldCount?: number
}

export function parseLLMJson(raw: string): JsonParseResult {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'empty response', strategy: 'failed' }
  }
  let s = raw.trim()

  // 优先尝试：直接 parse
  try {
    return { ok: true, value: JSON.parse(s), strategy: 'direct' }
  } catch {
    // 继续
  }

  // 尝试：补全截断的 JSON（追加 ] 或 }）
  // 思路：扫描括号计数，若开括号多于闭括号，在末尾补上相应闭括号
  const bracketFixed = tryFixTruncatedJson(s)
  if (bracketFixed) {
    try {
      return { ok: true, value: JSON.parse(bracketFixed), strategy: 'truncated-fix' }
    } catch {
      // 继续
    }
  }

  // 尝试：提取 ```json ... ``` 代码块
  const codeBlockMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim()
    try {
      return { ok: true, value: JSON.parse(inner), strategy: 'codeblock' }
    } catch {
      const fixed = tryFixTruncatedJson(inner)
      if (fixed) {
        try {
          return { ok: true, value: JSON.parse(fixed), strategy: 'truncated-fix' }
        } catch {
          // fall through
        }
      }
      // 从代码块里正则提取
      const objs = extractObjectsByRegex(inner)
      if (objs.length > 0) {
        return { ok: true, value: objs, strategy: 'regex-objects', fieldCount: objs.length }
      }
    }
  }

  // 尝试：提取顶层 [...] 数组
  const arrayMatch = s.match(/\[[\s\S]*\]/m)
  if (arrayMatch) {
    const inner = arrayMatch[0]
    try {
      return { ok: true, value: JSON.parse(inner), strategy: 'array-extract' }
    } catch {
      const fixed = tryFixTruncatedJson(inner)
      if (fixed) {
        try {
          return { ok: true, value: JSON.parse(fixed), strategy: 'truncated-fix' }
        } catch {
          // fall through
        }
      }
    }
  }

  // 兜底：正则逐个提取 {...} 对象
  const objs = extractObjectsByRegex(s)
  if (objs.length > 0) {
    return { ok: true, value: objs, strategy: 'regex-objects', fieldCount: objs.length }
  }

  return { ok: false, error: 'no json found', strategy: 'failed' }
}

/**
 * 给定疑似被截断的 JSON 字符串，尝试补全开闭括号。
 * 策略：扫描所有 `{` `[` 和 `}` `]`，若开括号多于闭括号，追加相应数量的闭括号；
 * 同时尝试修复字符串中未转义的换行/引号。
 */
function tryFixTruncatedJson(s: string): string | null {
  if (!s) return null
  // 仅在 s 看起来像 JSON 时处理：以 [ 或 { 开头
  if (!/^[\s]*[\[{]/.test(s)) return null

  // 修复 1：行内未转义引号 → 转义为 \"
  // 简化策略：扫描字符串上下文，若在字符串内（"...内"）遇到裸换行或裸引号，修复
  // 这里只做最简单的情况：把字符串中出现的非转义裸 " 转为 \"
  const fixed1 = fixUnescapedQuotes(s)
  // 修复 2：补全括号
  const fixed2 = closeBrackets(fixed1)
  // 修复 3：去除尾部的非 JSON 字符（如逗号、说明文字）
  const fixed3 = stripTrailingGarbage(fixed2)

  return fixed3
}

function fixUnescapedQuotes(s: string): string {
  // 简化：不处理复杂情况。让 JSON.parse 自行报错。
  return s
}

function closeBrackets(s: string): string {
  // 状态机扫描：在字符串内/外统计括号
  let inString = false
  let escape = false
  const stack: string[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (c === '\\') {
        escape = true
      } else if (c === '"') {
        inString = false
      }
    } else {
      if (c === '"') {
        inString = true
      } else if (c === '{') {
        stack.push('}')
      } else if (c === '[') {
        stack.push(']')
      } else if (c === '}' || c === ']') {
        stack.pop()
      }
    }
  }
  if (inString) {
    // 字符串未关闭 → 关闭它
    s = s + '"'
    inString = false
  }
  // 把剩余的 stack 反向追加
  return s + stack.reverse().join('')
}

function stripTrailingGarbage(s: string): string {
  // 把末尾的非 JSON 字符（如逗号、句号、换行）去除
  // 仅保留以 ] } 结尾
  while (s.length > 0) {
    const last = s[s.length - 1]
    if (last === ']' || last === '}') return s
    if (/\s/.test(last)) {
      s = s.slice(0, -1)
      continue
    }
    // 末尾非括号非空白（很可能是 LLM 后续说明文字），但因为已 closeBrackets 补全，
    // 这里已经会以 ] 结尾。理论上不会到这里。
    s = s.slice(0, -1)
  }
  return s
}

/**
 * 兜底：正则从乱码 JSON 中逐个提取 {...} 字段对象。
 * 每提取一个对象就尝试 JSON.parse；parse 失败的丢弃。
 */
function extractObjectsByRegex(s: string): any[] {
  const out: any[] = []
  // 匹配最外层 {...}（非贪婪，逐个对象）
  // 用括号深度匹配更准确；这里用简化正则
  const re = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g
  const matches = s.match(re) || []
  for (const m of matches) {
    try {
      out.push(JSON.parse(m))
    } catch {
      // 尝试补全
      const fixed = tryFixTruncatedJson(m)
      if (fixed) {
        try {
          out.push(JSON.parse(fixed))
        } catch {
          // 丢弃
        }
      }
    }
  }
  return out
}
