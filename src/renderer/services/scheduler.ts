/**
 * 定时任务引擎（PENDING_UPDATE F 表 / CAPABILITY_EXPANSION_PLAN 3.3、3.5、§6.3）
 * cron 表达式驱动，Aurora 调用。纯 TS，无外部依赖。
 * 支持 5 字段 cron：`minute hour day-of-month month day-of-week`
 * 约定：`* *` 空白字段默认匹配任意值（不在此引擎内额外约定，统一按标准 cron）
 */

export interface CronParsed {
  minute: Set<number>
  hour: Set<number>
  dayOfMonth: Set<number>
  month: Set<number>
  dayOfWeek: Set<number>
}

/** 解析单个 cron 字段，支持 `*`、数字、`a-b`、`*/n`、`a,b,c` */
function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const p = part.trim()
    if (p === '*' || p === '') {
      for (let i = min; i <= max; i++) out.add(i)
      continue
    }
    let step = 1
    let base = p
    const slashIdx = p.indexOf('/')
    if (slashIdx !== -1) {
      base = p.slice(0, slashIdx)
      step = parseInt(p.slice(slashIdx + 1), 10) || 1
    }
    let lo = min, hi = max
    const dashIdx = base.indexOf('-')
    if (dashIdx !== -1) {
      lo = parseInt(base.slice(0, dashIdx), 10) || min
      hi = parseInt(base.slice(dashIdx + 1), 10) || max
    } else if (base !== '*') {
      lo = hi = parseInt(base, 10)
    }
    for (let i = lo; i <= hi; i += step) out.add(i)
  }
  return out
}

/** 解析完整 cron 表达式，非法时返回 null */
export function parseCron(cron: string): CronParsed | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minute, hour, dom, month, dow] = parts
  const parsed = {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dayOfMonth: parseField(dom, 1, 31),
    month: parseField(month, 1, 12),
    // cron 中 0/7 均表周日
    dayOfWeek: parseField(dow === '0' ? '7' : dow, 0, 7),
  }
  // 如果 dayOfMonth 为全量，dayOfWeek 通常作为 OR 逻辑；这里按两周各自的独立匹配设计
  return parsed
}

/** 判断某个日期时刻是否命中 cron */
export function cronMatches(cron: CronParsed | string, d: Date): boolean {
  const c = typeof cron === 'string' ? parseCron(cron) : cron
  if (!c) return false
  if (!c.minute.has(d.getMinutes())) return false
  if (!c.hour.has(d.getHours())) return false
  if (!c.month.has(d.getMonth() + 1)) return false
  const domMatch = c.dayOfMonth.has(d.getDate())
  const dowCron = d.getDay() === 0 ? 7 : d.getDay() // 周日归一为 7
  const dowMatch = c.dayOfWeek.has(dowCron)
  // 标准 cron 语义：若 dom 设为具体值而 dow 为 *，则按 dom；反之按 dow；两者皆具体则 OR
  const domWild = c.dayOfMonth.has(-1) || c.dayOfMonth.size === 31
  const dowWild = c.dayOfWeek.size === 8
  if (!domWild && !dowWild) return domMatch || dowMatch
  if (!domWild) return domMatch
  if (!dowWild) return dowMatch
  return true
}

export interface DueTask {
  id: string
  cron: string
  payload?: unknown
}

export type TaskHandler = (task: DueTask) => void | Promise<void>

/** 获得 cron 下一次触发的时间（用于展示） */
export function nextRunTime(cron: CronParsed | string, from: Date = new Date()): Date | null {
  const c = typeof cron === 'string' ? parseCron(cron) : cron
  if (!c) return null
  const d = new Date(from)
  d.setSeconds(0, 0)
  // 最大向后找 5 年，避免死循环
  const maxTs = from.getTime() + 5 * 365 * 24 * 60 * 60 * 1000
  for (let i = 0; i < 50000; i++) {
    d.setMinutes(d.getMinutes() + 1)
    if (d.getTime() > maxTs) return null
    if (cronMatches(c, d)) return new Date(d)
  }
  return null
}

export interface Scheduler {
  register(cron: string, handler: TaskHandler): () => void
  unregister(id: string): void
  start(): void
  stop(): void
  pendingCount(): number
}

/**
 * 创建调度器。内部用 30s 轮询，检测到整分钟命中即触发。
 * 返回 stop 函数用于回收 interval。
 */
export function createScheduler(tickMs = 30_000): Scheduler {
  let interval: ReturnType<typeof setInterval> | null = null
  let lastMinute = -1
  let seq = 0
  const jobs = new Map<string, { cron: CronParsed; handler: TaskHandler }>()

  const tick = () => {
    const now = new Date()
    const minute = now.getHours() * 100 + now.getMinutes()
    if (minute === lastMinute) return
    lastMinute = minute
    for (const [id, job] of jobs) {
      if (cronMatches(job.cron, now)) {
        try { void job.handler({ id, cron: '' }) } catch (e) { console.error('[scheduler] handler error', id, e) }
      }
    }
  }

  return {
    register(cron, handler) {
      const parsed = parseCron(cron)
      if (!parsed) { console.warn('[scheduler] invalid cron:', cron); return () => {} }
      const id = `job-${Date.now()}-${++seq}`
      jobs.set(id, { cron: parsed, handler })
      return () => jobs.delete(id)
    },
    unregister(id) { jobs.delete(id) },
    pendingCount() { return jobs.size },
    start() {
      if (interval) return
      lastMinute = -1
      interval = setInterval(tick, tickMs)
    },
    stop() {
      if (interval) { clearInterval(interval); interval = null }
    },
  }
}

/** 全局单例（供 Aurora 等顶层调用） */
export const globalScheduler = createScheduler()