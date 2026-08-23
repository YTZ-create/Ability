# 待处理任务清单（Pending）

> 对 CAPABILITY_EXPANSION_PLAN.md 落地过程中的**仍待处理项**汇总。
> 状态图例：⏳ 技术上可做（需单独验证）｜🔜/🚫 需第三方授权/API 或依赖用户本机环境。

---

## P1. Monaco 代码编辑器全面集成（⏳ 技术上可做）

### 现状
- 现有 `src/renderer/components/editor/CodeEditor.tsx` 为**轻量版**：纯文本 textarea + 行号 + 保存/复制，可用但体验有限。

### 目标
- 换用 `@monaco-editor/react`（VS Code 同款内核）：
  - 语法高亮 / 代码补全
  - 点文件即打开 / 保存
  - 更好的行号、折叠、查找

### 卡点（为何未落地）
- Monaco 的 worker 在 **Vite + Neutralino（WebView2）** 默认从 CDN 加载，客户端离线/跨域会失败。
- 必须配 `vite-plugin-monaco-editor` 或自定义 loader，把 worker **打入本地包**。
- 属高风险改动，配错会让现有可用编辑器白屏；因避免返工而未强行替换。

### 落地步骤
1. `npm i @monaco-editor/react monaco-editor`
2. `vite.config.ts` 挂 `vite-plugin-monaco-editor`，worker 走本地打包
3. 替换 CodeEditor 内部实现并做一次构建验证

---

## P2. larkConnector / seedream / seedance（🔜/🚫 需第三方授权/API）

| 服务 | 用途 | 卡点 | 落地前提 |
|---|---|---|---|
| `services/larkConnector.ts` | 飞书：消息/日历/任务/文档/表格 | 需飞书开放平台应用凭证 + OAuth 授权 | 走飞书授权后封装 |
| `services/seedream.ts` | 文生图 | 需商汤/Seedream API key | 提供 key 后接生成接口 |
| `services/seedance.ts` | 文生视频 | 需 Seedance API key | 提供 key 后接生成接口 |

### 原则
- 无凭证时只写空壳无法验证，且密钥不该硬编码进仓库。
- 用户决定厂商/授权/提供 key 后一次性接入并验证。

---

## P3. codebase-memory-mcp / Agent Reach（🚫 依赖用户本机环境）

| 项 | 定位 | 现状替代 |
|---|---|---|
| `codebase-memory-mcp` | 本地 MCP 原生二进制，跨平台受限 | `services/codeGraph.ts` 调用关系分析 |
| `Agent Reach` | 依赖 Python/pip，多 Agent 广播协作 | `services/toolRegistry.ts` 工具探测 |

- 计划结论定位为「依赖用户环境」，非缺口项。
- 已用本地 JS 层轻量替代，覆盖大部分场景；除非用户提供对应本机环境，否则不推进。

---

## P4. 多模型路由（计划 §6.5 · 🔜 增强项）

### 现状
- 当前为「**按 Agent 绑定模型**」（设置面板绑定 provider/model）。

### 目标
- 用 `promptBuilder` 类组装器做**多模型 prompt 工程**：
  - 按任务复杂度/上下文长度自动选模型
  - 单 Agent 面向多模型的提示词适配

### 定位
- 属**增强项非缺口项**，现有绑定已可跑通；改动面较大，需与现有设置面板协调，按需推进。

---

## P5. pdf-inspector / open-code-review CLI 本体安装（依赖缺失）

### 现状
- 已落地**服务层**：
  - `services/pdf.ts`：探测本机 `pdf-inspector` CLI → 有则 CLI，无则回退 `pdf-parse`
  - `services/ocr.ts`：探测 `open-code-review` CLI → 有则 CLI，无则回退本地规则扫描
- 两个 **CLI 本体尚未安装**（非普通 npm 包：pdf-inspector 为 Rust 二进制，open-code-review 为 CLI 工具）。

### 现状表现
- 实际走**回退路径**（pdf-parse / 本地规则）。

### 落地步骤
- 确认两 CLI 在 Windows 的正确安装方案并执行安装 → 服务层自动切换 CLI 路径，无需改代码。

---

## 优先级建议

1. **Monaco**（P1）— 体验收益最高，可独立构建验证
2. **授权/API 类**（P2）— 用户提供凭证后推进
3. **其他**（P3/P4/P5）— 按需，依赖本机环境或为增强项