# Brutalist 视觉风格规范（diagram-design）

> 硬边框、硬阴影、方形元素。以下 token 为全局唯一来源，任何图统一套用。

## 调色板
| Token | 值 | 用途 |
|---|---|---|
| paper (纸底) | `#FFFAEF` | 页面/画布背景 |
| ink (油墨) | `#1A1A1A` | 主文字、主边框 |
| accent (主黄) | `#FFC857` | 强调块、高亮 |
| pink (主粉) | `#FF6B91` | 次要强调、标注 |
| lavender | `#A78BFA` | 第三强调（紫色） |
| green | `#A9D877` | 成功/通过 |
| blue | `#27CCF3` | 数据/信息 |

## 基础样式（硬阴影）
```css
.box {
  border: 3px solid #1A1A1A;
  background: #fff;
  box-shadow: 5px 5px 0 #1A1A1A;   /* 硬阴影，无模糊 */
  border-radius: 0 !important;     /* 方形，禁用圆角 */
}
```

## 间距与字号
- 网格基数：8px；画布内元素间距 ≥8px，分组间距 ≥16px。
- 标题：font-weight 800；正文：font-weight 600；辅助 12px。
- 等宽字体实现技术观感：`font-family: ui-monospace, Menlo, Consolas, monospace`。

## 强调规则
- 主要路径用 accent（黄），关键决策用 pink。
- 每张图配色 ≤5 色；只用一个主强调色 + 中性色。
- 反馈状态：进行中=accent，成功=green，风险=ink（外框加粗）。

## 组成要点
- 箭头：用文本符号（▼ ▶ →）或 CSS 边框三角形，同样加硬描边。
- 分组/泳道：外层容器加 3px 边框与内阴影区的半透明纸底。
- 可编辑性：全部由内联 CSS 实现，无外链，可开后编辑。