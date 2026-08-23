# 系统架构 / 模块依赖图模板（U07/U08）——diagram-design

> 分层展示模块与依赖；套用 `style-guide.md`。

## 基础结构
```html
<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;font-family:ui-monospace,monospace}
  body{margin:24px;background:#FFFAEF;color:#1A1A1A}
  .layer{border:3px solid #1A1A1A;background:#fff;box-shadow:5px 5px 0 #1A1A1A;
         padding:16px;margin-bottom:16px;border-radius:0}
  .layer h3{margin:0 0 12px;font-size:13px;text-transform:uppercase;background:#FFC857;
            display:inline-block;padding:2px 8px;border:2px solid #1A1A1A}
  .mod{display:inline-block;border:2px solid #1A1A1A;background:#fff;padding:8px 12px;
       margin:6px;font-weight:700;box-shadow:3px 3px 0 #1A1A1A}
  .dep{color:#1A1A1A;font-weight:800;text-align:center;font-size:12px}
</style></head><body>
  <div class="layer"><h3>前端 / Renderer</h3><div class="mod">UI 组件</div><div class="mod">Stores</div>
    <div class="mod">PlatformAPI</div></div>
  <div class="dep">▼ 经 API ▼</div>
  <div class="layer"><h3>服务层 / Services</h3><div class="mod">scheduler</div>
    <div class="mod">toolRegistry</div><div class="mod">codeGraph</div></div>
</body></html>
```

## 依赖绘制
- 用 `▼ ▶` 文本箭头 + 行级 `.dep` div 表示方向。
- 反向依赖（被谁引用）用虚线框：`border-style:dashed`。
- 引用 `services/codeGraph.ts` 的统计结果可自动标注「被 N 处引用」。