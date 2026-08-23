# diagram-design Skill

> 让 Agent 用**独立 HTML** 生成可编辑的图表，遵循 Brutalist 设计规范。
> 适用于 Atlas（架构可视化）与 DiagramDesigner 面板。

## 输出规范
- 每个图表产出 `standalone HTML`（含 `<!doctype html>` 与内联 CSS），可直接在 `DiagramDesigner` 预览/编辑/导出。
- 所有图严格套用 `references/style-guide.md` 的调色板与硬阴影。
- 优先用 2px 网格（8px 基数）控制间距。

## 支持的视觉类型（27 种）
见 `references/type-overview.md`。核心模板：
- `type-flow.md`：流程图 / 泳道 / 状态机
- `type-architecture.md`：系统架构 / 模块依赖 / 部署拓扑

## 使用步骤
1. 确认目标类型（`type-overview.md` 查找）。
2. 参照对应 `type-*.md` 模板复制结构。
3. 套用 `style-guide.md` 的 token（paper/ink/accent/ui 色）。
4. 交付 `standalone HTML` + 中文图说明。

## 质量要求
- 屏幕可读、硬阴影统一、配色在 5 色内。
- 图注、箭头、分组清晰；单一图信息量不过载。