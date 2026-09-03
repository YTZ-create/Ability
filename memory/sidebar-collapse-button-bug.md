---
name: sidebar-collapse-button-bug
description: Sidebar collapse button clicks misrouted on first interaction after refresh
metadata:
  type: project
---

## Bug Description

After refreshing the app (Ctrl+Shift+R), the **first interaction** with the sidebar collapse buttons behaves incorrectly:

1. Clicking the **历史 (History)** section's collapse/expand button → **AI Agent** section expands/collapses instead
2. Clicking the **AI Agent** section's button → needs **two clicks** to respond (first click is "eaten")
3. After these initial interactions, everything works perfectly for the rest of the session

## Attempted Fixes (neither worked)

1. **Functional state updates**: Changed `setXxx(!xxx)` to `setXxx(prev => !prev)` — no effect
2. **Zustand store**: Moved `agentsCollapsed` and `historyCollapsed` from local `useState` into a dedicated `sidebarStore.ts` Zustand store — no effect

## Observations

- The **文件夹 (Folders)** section, whose collapse state was always in `folderStore.ts` (Zustand), is NOT affected by this bug
- The app uses `React.StrictMode` (confirmed in `src/renderer/main.tsx:13`)
- `agentRegistry` uses a Proxy that returns `[]` before initialization, causing the Agent section to render empty initially
- `restoreMessages()` runs asynchronously on mount, potentially causing layout shifts

## Suspected Root Cause

Likely a combination of:
1. React StrictMode double-invoking the component body
2. Async data loading (`restoreMessages()`, agent registry initialization) causing layout shifts on first render
3. WebView2 event targeting being affected by these layout shifts — the mouse event lands on a different element than intended due to content appearing/disappearing between render cycles

## Files Involved

- [src/renderer/components/layout/Sidebar.tsx](src/renderer/components/layout/Sidebar.tsx) — sidebar component with three collapsible sections
- [src/renderer/stores/sidebarStore.ts](src/renderer/stores/sidebarStore.ts) — Zustand store for collapse state (created as attempted fix)
- [src/renderer/stores/folderStore.ts](src/renderer/stores/folderStore.ts) — folder collapse state (working correctly)
- [src/renderer/main.tsx](src/renderer/main.tsx) — entry point, uses StrictMode
- [src/renderer/agents/registry.ts](src/renderer/agents/registry.ts) — agent registry with Proxy fallback
