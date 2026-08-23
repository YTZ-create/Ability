/**
 * Open Code Review 桥接层（PENDING_UPDATE A/B 表 · 1.11 / 3.1）
 * 封装 @alibaba-group/open-code-review CLI：行级审查 + 定位/反思。
 * CLI 不在本机时回退到本地轻量规则扫描（review-rules.yaml 语义化内置）。
 */

import type { PlatformAPI } from '../api/platformAPI'

export interface OcrIssue {
  line: number
  severity: 'error' | 'warning' | 'info'
  rule: string
  message: string
}

export interface OcrResult {
  issues: OcrIssue[]
  summary: { error: number; warning: number; info: number }
  source: 'open-code-review' | 'local-fallback'
  raw?: string
}

/** 尝试探测 @alibaba-group/open-code-review CLI */
export async function hasOpenCodeReview(platform: PlatformAPI): Promise<boolean> {
  const { exitCode } = await platform.os.execCommand('open-code-review --version', 8000)
  return exitCode === 0
}

/** 调用 CLI 对指定文件做行级审查 */
export async function runOpenCodeReview(platform: PlatformAPI, filePath: string, language = 'typescript'): Promise<OcrResult | null> {
  try {
    const { stdout, exitCode } = await platform.os.execCommand(`open-code-review "${filePath}" --lang ${language}`, 90_000)
    if (exitCode !== 0) return null
    const issues: OcrIssue[] = []
    const re = /(?:(\d+)[:\s])?\s*(error|warning|info)[:\s]\s*([^\n]+)/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(stdout)) !== null) {
      issues.push({
        line: m[1] ? parseInt(m[1], 10) : 0,
        severity: (m[2].toLowerCase() as OcrIssue['severity']),
        rule: 'ocr',
        message: m[3].trim(),
      })
    }
    const summary = { error: 0, warning: 0, info: 0 }
    for (const i of issues) summary[i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warning' : 'info']++
    return { issues, summary, source: 'open-code-review', raw: stdout }
  } catch {
    return null
  }
}

/** 本地回退规则（内置 review-rules.yaml 的关键子集，保证离线可用） */
const LOCAL_RULES: { rule: string; severity: OcrIssue['severity']; re: RegExp; message: string }[] = [
  { rule: 'ts-01', severity: 'warning', re: /:\s*any\b/g, message: '避免使用 any，改用 unknown 并做窄化。' },
  { rule: 'g-02', severity: 'info', re: /=\s*[2-9]\b/g, message: '建议将魔法数字提取为具名常量。' },
  { rule: 'ts-02', severity: 'warning', re: /&&\s*[a-zA-Z_$][\w$]*\.[a-zA-Z]/g, message: '建议使用可选链 (?.) 与空值合并 (??)。' },
  { rule: 'p-02', severity: 'warning', re: /catch\s*\{[^}]*\}/g, message: '确认 catch 未吞掉错误，需给出有意义的错误信息。' },
]

/** 对代码文本做本地行级规则扫描（无需 CLI） */
export function localReview(source: string, language = ''): OcrResult {
  const issues: OcrIssue[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  for (const rule of LOCAL_RULES) {
    for (let idx = 0; idx < lines.length; idx++) {
      if (rule.re.test(lines[idx])) {
        issues.push({ line: idx + 1, severity: rule.severity, rule: rule.rule, message: rule.message })
      }
    }
  }
  const summary = { error: 0, warning: 0, info: 0 }
  for (const i of issues) summary[i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warning' : 'info']++
  return { issues, summary, source: 'local-fallback' }
}

/** 统一入口：优先 CLI，缺失则本地规则扫描 */
export async function ocrReview(platform: PlatformAPI, filePath: string, source?: string, language = 'typescript'): Promise<OcrResult> {
  if (await hasOpenCodeReview(platform)) {
    const via = await runOpenCodeReview(platform, filePath, language)
    if (via) return via
  }
  return localReview(source || '')
}