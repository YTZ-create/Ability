/**
 * officeParser — 解析 ````office {json}```` 块
 *
 * 参照 `handoff.ts` 的模式，解析 Agent 输出中的 office 指令块
 * 支持: ```office\n{json}\n```
 */

export interface OfficeCommand {
  action:
    | 'create_workbook'
    | 'create_document'
    | 'write_range'
    | 'set_style'
    | 'insert_text'
    | 'export'
    | 'approve'
    | 'discard'
  params: Record<string, any>
}

/** 解析 office 块，返回解析结果 */
export function parseOfficeBlock(content: string): { command: OfficeCommand } | { error: string } | null {
  // 匹配 ```office 包裹的格式
  const officeRegex = /```office\s*\n([\s\S]*?)```/
  const match = content.match(officeRegex)

  if (!match) return null

  const raw = match[1].trim()

  try {
    const parsed = JSON.parse(raw)
    if (!parsed.action) {
      return { error: 'office 块缺少 action 字段' }
    }

    const validActions = [
      'create_workbook',
      'create_document',
      'write_range',
      'set_style',
      'insert_text',
      'export',
      'approve',
      'discard',
    ]
    if (!validActions.includes(parsed.action)) {
      return { error: `未知 action: ${parsed.action}，支持: ${validActions.join(', ')}` }
    }

    return {
      command: {
        action: parsed.action as OfficeCommand['action'],
        params: parsed.params || {},
      },
    }
  } catch {
    // 尝试归一化后解析
    try {
      const normalized = raw
        .replace(/\u201c/g, '"')
        .replace(/\u201d/g, '"')
        .replace(/\uff1a/g, ':')
      const parsed = JSON.parse(normalized)
      if (!parsed.action) {
        return { error: 'office 块缺少 action 字段' }
      }
      return {
        command: {
          action: parsed.action as OfficeCommand['action'],
          params: parsed.params || {},
        },
      }
    } catch {
      return { error: 'office 块 JSON 解析失败' }
    }
  }
}

/** 从 Agent 回复中移除 office 块，避免显示在消息气泡中 */
export function cleanOfficeBlock(content: string): string {
  return content.replace(/```office\s*\n[\s\S]*?```/g, '').trim()
}