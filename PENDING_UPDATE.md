# CAPABILITY_EXPANSION_PLAN 未落地项清单（点 MD）

> 严格对照 `CAPABILITY_EXPANSION_PLAN.md` 与现有项目 `src/renderer` 实际结构，梳理出**尚未落地**的部分。
> 状态图例：**✅** 已落地　**🔜** 可直接做（无外部依赖，纯本地代码）　**⏳** 需先安装 npm/外部依赖　**🚫** 依赖用户环境/第三方或计划结论已排除
> 矛盾时以 `CAPABILITY_EXPANSION_PLAN.md` 为准；所有改动遵循「UI 只增不改减」。

---

## 一、已落地汇总（不在此次范围内，仅核对用）

- ✅ 11 人 Agent 团队注册与侧边栏动态渲染（`registry.ts` / `Sidebar.tsx`）
- ✅ 删除 William / James / Sophie（`codeReviewer.ts` / `fileOrganizer.ts` / `memoryAgent.ts`）
- ✅ Oliver 记忆调度（记住/回忆/遗忘/统计）+ `MemoryStore` 注入
- ✅ 记忆面板 `MemoryViewer`（增删 + 分类过滤）
- ✅ 能力面板 `Phase C`：CodeEditor / DiffViewer / EvaluationMemo / FileManager / SlideDeck / HtmlReportExport / DiagramDesigner / TaskPanel / PluginPanel + `taskStore` / `pluginStore` + `CapabilitiesHub`（App 右侧「能力」标签）
- ✅ 设置面板按 Agent 绑定 provider/model（覆盖 11 人）
- ✅ 6.6 Arthur 多格式分发（Arthur prompt 已含 Word/PPT/Excel/PDF/HTML 关键词路由）

---

## 二、未落地清单（按计划章节映射）

### A. 外部集成评估 → 落地（计划 1.5~1.14）

| 项 | 计划章节 | 实际需要 | 目标文件 | 状态 |
|---|---|---|---|---|
| pdf-inspector | 1.8 / 3.4 | `@firecrawl/pdf-inspector` 封装：PDF 读取/分类/提取 | `services/pdf.ts` + `agents/arthur.ts`(PDF子模块)（Amelia 复用） | ✅（CLI 探测 + pdf-parse 回退） |
| Open Code Review | 1.11 / 3.1 | `@alibaba-group/open-code-review` CLI 桥接：行级审查 + 定位/反思模块 | `services/ocr.ts` + 扩展 `agents/avery.ts` | ✅（CLI 探测 + 本地规则回退） |
| diagram-design Skill | 1.5 / 3.1 | 嵌入 27 种视觉类型 + Brutalist style-guide（paper#FFFAEF/ink#1A1A1A/accent#FFC857） | `skills/diagram-design/{SKILL.md,skill.json,references/style-guide.md,references/type-*.md}` + 联动 `DiagramDesigner` | ✅（已落地：skill 文件 + DiagramDesigner 类型选择器） |
| draw.io 导入 | 3.1 | `.drawio` / `.drawio.svg` → 编辑级 HTML 渲染 | 依赖 diagram-design 的 import 能力 | ✅（DiagramDesigner 已可编辑/预览 HTML） |
| reverse-skill 架构 | 1.9 | 借鉴 5 个架构组件：路由规则表 + 工具索引 | `skills/config/routing.json`（41 条规则）+ `services/toolRegistry.ts`（自动扫描本机工具） | ✅ |
| TencentDB 记忆 | 1.10 | `memory/types.ts` 增加 **L0-L3 层级字段** + 蒸馏、`codeGraph.ts` 代码调用关系 | `memory/types.ts` + `services/codeGraph.ts` | ✅（L0-L3 字段 + levelTTL + analyzeCodeGraph/findReferrers/moduleStats） |
| codebase-memory-mcp | 1.13 | 原生二进制，用于 Atlas + Avery + Amelia | `services/codebaseMemory.ts` | 🚫（依赖用户环境） |
| Agent Reach | 1.12 | pip 依赖，研究 Agent 广播/协作 | `services/agentReach.ts` | 🚫（依赖 pip） |
| SenseNova-Skills | 1.14 | Skill 定义可嵌入，执行依赖商汤 API | 嵌入 `skills/` | 🔜/🚫（P2） |
| Prime / Macro | 1.6 / 1.7 | 计划结论为「不可集成」，仅借鉴设计理念 | — | 🚫 不做 |

### B. 写代码 / 改代码（计划 3.1）

| 项 | 需要 | 状态 |
|---|---|---|
| Monaco 代码编辑器完整版 | `@monaco-editor/react` + 点文件即打开/保存；当前 CodeEditor 为轻量版（行号+保存/复制） | ⏳ |
| `PlatformAPI.diff()` / `fileWatch()` | 接口签名 + neutralino 实现，供 DiffViewer / FileManager 真接文件 | ✅（diff/fileWatch/notify 已实现） |
| Avery 行级审查接 OCR | 依赖 A 表 Open Code Review | ✅（`services/ocr.ts`：CLI 桥接 + 本地规则回退） |

### C. 深度研究（计划 3.2）

| 项 | 需要 | 状态 |
|---|---|---|
| 竞品分析模板 | `agents/prompts/competitive.md`（Audrey 使用，当前 `agents/prompts/` 目录不存在） | ✅ |
| 跨领域去重/交叉验证/矛盾标注 | 扩展 `agents/audrey.ts` systemPrompt（当前仅基础调研） | ✅（新增交叉验证方法论 + 矛盾/置信度标注） |

### D. 日常事务（计划 3.3）

| 项 | 需要 | 状态 |
|---|---|---|
| 定时拉取 RSS/网页 → 摘要 | Aurora 接入定时源 | 🔜 |
| `services/seedream.ts` 文生图 | 封装 AI 图片生成服务 | 🔜 |
| `services/seedance.ts` 视频生成 | 封装 AI 视频生成服务 | 🔜 |

### E. 文档与演示（计划 3.4）

| 项 | 需要 | 状态 |
|---|---|---|
| Arthur 子模块（docx / pptxgenjs / xlsx / pdf-lib） | `npm i docx pptxgenjs xlsx pdf-lib` + `agents/arthur.ts` 内部分发接线 | ✅（依赖已装 + `services/documentProduction.ts`） |
| `services/pdf.ts` | 同 A 表 pdf-inspector | ✅（pdf-parse 回退 + pdf-inspector CLI 探测） |

### F. 助理事务（计划 3.5）

| 项 | 需要 | 状态 |
|---|---|---|
| `services/scheduler.ts` 定时任务引擎 | cron 表达式驱动，Aurora 调用 | ✅（parseCron/cronMatches/createScheduler/globalScheduler） |
| 桌面通知 / timer | `PlatformAPI.notify()` / `timer` + neutralino 实现 | ✅（os.notify 已实现，timer 由 scheduler interval 承担） |

### G. 插件能力（计划 3.6）

| 项 | 需要 | 状态 |
|---|---|---|
| `services/larkConnector.ts` | 飞书开放平台 API 封装（消息/日历/任务/文档/表格/会议纪要） | 🔜（需授权） |
| `services/seedream.ts` / `services/seedance.ts` | 同 D 表 | 🔜 |

### H. 新增文件结构（计划四）中仍未创建的文件

| 文件 | 说明 | 状态 |
|---|---|---|
| `skills/config/routing.json` | Agent 路由规则（41 条，借鉴 reverse-skill） | ✅ |
| `skills/code-review/review-rules.yaml` | 审查规则模板（按语言/路径/变更类型匹配） | ✅ |
| `services/toolRegistry.ts` | 工具索引 | ✅ |
| `services/codeGraph.ts` | 代码调用关系分析 | ✅ |
| `agents/prompts/competitive.md` | 竞品分析模板 | ✅ |
| `services/pdf.ts` / `services/ocr.ts` / `services/documentProduction.ts` | P2：PDF 服务、Open Code Review 桥接、docx/pptx/xlsx/pdf 生成 | ✅（CLI 探测回退 + 本地实现） |

### I. 实现要点（计划六）中未完成项

| 项 | 需要 | 状态 |
|---|---|---|
| 6.3 PlatformAPI 扩展原则 | 新增 `diff()/fileWatch()/notify()/timer` 签名与 neutralino 实现 | ✅ |
| 6.5 多模型路由 | 当前为「按 Agent 绑定模型」；缺多模型 prompt 工程（promptBuilder 类组装） | 🔜 |

---

## 三、建议执行顺序（结合计划七 P0 优先级）

> 更新时间标注：✅=已落地。 ★ = 本轮已完成。

1. **P0（投入/收益最高，先做）**
   - ✅ `PlatformAPI`：`diff()/fileWatch()/notify()/timer`（解锁 DiffViewer/FileManager/通知）
   - ✅ `services/scheduler.ts` + Aurora 定时（纯 TS，无需依赖）
   - ✅ `skills/diagram-design`（含 Brutalist style-guide）联动 `DiagramDesigner`（Atlas P0）
2. **P1（本地代码可先行，逻辑补齐）**
   - ✅ `agents/prompts/competitive.md`（Audrey）、Audrey 交叉验证 prompt
   - ✅ `memory/types.ts` 增加 L0-L3 + `services/codeGraph.ts`
   - ✅ `skills/config/routing.json`、`skills/code-review/review-rules.yaml`、`services/toolRegistry.ts`
3. **P2（需装依赖 / 授权，确认后再做）**
   - ✅ `services/pdf.ts`（pdf-parse 回退 + pdf-inspector CLI 探测）
   - ✅ `services/ocr.ts`（open-code-review CLI 桥接 + 本地规则回退）
   - ✅ docx/pptxgenjs/xlsx/pdf-lib 安装 + `services/documentProduction.ts`
   - 🔜 Monaco 全面集成（`@monaco-editor/react`，涉及 worker 配置，风险高，仍待做）
   - 🔜/🚫 `larkConnector.ts` / `seedream.ts` / `seedance.ts`（需第三方授权/API）
   - 🚫 `codebase-memory-mcp` / `Agent Reach`（需用户本机二进制/pip，风险高）

---

> 说明：本清单记载了计划中**未更新部分的落地台账**。标注 ✅ 者已按本轮更新完成（构建通过）；⚠️/🔜/🚫 者待后续处理。