# 流程图模板（U01/U03）——diagram-design

> 顺序步骤 + 分支；套用 `style-guide.md`（paper/ink/accent/pink）。

## 基础结构
```html
<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;font-family:ui-monospace,monospace}
  body{margin:24px;background:#FFFAEF;color:#1A1A1A}
  .box{border:3px solid #1A1A1A;background:#fff;box-shadow:5px 5px 0 #1A1A1A;
       padding:16px 20px;font-weight:800;border-radius:0}
  .box.step{background:#FFC857}      /* 主路径 */
  .box.decide{background:#FF6B91}    /* 决策 */
  .arrow{height:20px;text-align:center;font-weight:800;color:#1A1A1A}
</style></head><body>
  <div class="box step">开始</div>
  <div class="arrow">▼</div>
  <div class="box">处理</div>
  <div class="arrow">▼</div>
  <div class="box decide">是否符合条件？</div>
  <div class="arrow">▼（是）</div>
  <div class="box">结束·成功</div>
</body></html>
```

## 要点
- 分支用不同强调色区分（pink 决策 / green 成功）。
- 箭头保持垂直居中对齐；分支可并排两组 `.box`。
- 信息 ≤7 步，过多则拆子流程。