/**
 * 记忆系统类型定义
 */

export type MemoryCategory =
  | 'user-preference'   // 用户偏好
  | 'project-context'   // 项目上下文
  | 'analysis-result'   // 分析结果
  | 'session-summary'   // 会话摘要
  | 'general'           // 通用

/**
 * 记忆层级（借鉴 TencentDB 记忆，PENDING_UPDATE A 表 / 1.10）
 * L0=长期稳固事实/偏好、L1=项目级上下文、L2=会话/短期记忆、L3=缓存/临时拼接内容
 * 均为可选字段，向后兼容。
 */
export type MemoryLevel = 'L0' | 'L1' | 'L2' | 'L3'

export interface MemoryEntry {
  /** 唯一 ID */
  id: string
  /** 记忆分类 */
  category: MemoryCategory
  /** 唯一键（用于去重，如 "proj:my-app:tech-stack"） */
  key: string
  /** 记忆内容（Markdown 文本） */
  content: string
  /** 标签 */
  tags: string[]
  /** 关联的项目路径 */
  projectPath?: string
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
  /** 可选的过期时间（Unix timestamp），过期后自动清理 */
  expiresAt?: number
  /** 记忆层级（L0~L3），默认 'L2' 会话级 */
  level?: MemoryLevel
  /** 来源 / 上游记忆 key（用于关联蒸馏链） */
  sourceKeys?: string[]
  /** 置信度 0~1（蒸馏/校验用） */
  confidence?: number
  /** 检索命中加分权重，越大越优先召回 */
  weight?: number
}

/** L0-L3 层级说明（供 UI 展示 / 蒸馏提示） */
export const MEMORY_LEVEL_META: Record<MemoryLevel, { label: string; ttlMs?: number; desc: string }> = {
  L0: { label: '长期', desc: '稳固的用户偏好与事实，长期保留' },
  L1: { label: '项目', desc: '项目级上下文与架构知识' },
  L2: { label: '会话', desc: '会话/短期记忆，默认层' },
  L3: { label: '缓存', desc: '临时拼接/缓存内容，定期清理' },
}

/** 依据 level 返回建议 TTL（毫秒），缺失则返回 undefined */
export function levelTTL(level?: MemoryLevel): number | undefined {
  return level ? MEMORY_LEVEL_META[level].ttlMs : undefined
}

export interface MemoryQuery {
  /** 文本搜索（匹配 content） */
  text?: string
  /** 按分类过滤 */
  category?: MemoryCategory
  /** 按标签过滤 */
  tag?: string
  /** 按项目路径过滤 */
  projectPath?: string
  /** 返回最大条数 */
  limit?: number
  /** 偏移量 */
  offset?: number
}

export interface MemoryStats {
  total: number
  byCategory: Record<string, number>
  oldestEntry: number | null
  newestEntry: number | null
}
