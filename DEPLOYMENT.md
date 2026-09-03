# 部署说明

本文档帮助你从零开始在**自己的电脑**上部署并运行本项目。

> 适用对象：拿到源码、想在本机跑起来的新用户。
> 时间预估：通常 5～10 分钟（取决于网速）。

---

## 目录

1. [环境要求](#一环境要求)
2. [获取源码](#二获取源码)
3. [安装依赖](#三安装依赖)
4. [运行/构建应用](#四运行构建应用)
5. [配置 API Key](#五配置-api-key)
6. [常见问题](#六常见问题)

---

## 一、环境要求

开始之前，请确认电脑满足以下条件：

| 软件 | 版本要求 |
|------|----------|
| **Node.js** | >= 18 |
| **npm** | >= 9（随 Node.js 自动安装） |
| **操作系统** | Windows / macOS / Linux |

> 检查方法：在终端输入 `node -v` 和 `npm -v`，能输出版本号即已安装。
> 若未安装，前往官网下载对应系统版本：<https://nodejs.org/>

---

## 二、获取源码

选择以下任一种方式拿到代码：

**方式 A：git clone（推荐）**

```bash
git clone git@github.com:YTZ-create/Ability.git
cd Ability
```

**方式 B：手动下载**

- 打开 GitHub 仓库页 → 点击绿色 `Code` 按钮 → `Download ZIP`
- 解压后进入解压出来的文件夹

> 你会在文件夹里看到 `src/`、`package.json`、`README.md`、`DEPLOYMENT.md` 等文件，说明获取成功。

---

## 三、安装依赖

进入项目根目录（包含 `package.json` 的目录），执行：

```bash
npm install
```

这一步会把项目所需的所有依赖包下载到本地，需**联网**。

- 耗时取决于网速，通常 1～3 分钟。
- 安装完成后，目录下会多出一个 `node_modules/` 文件夹（这是依赖，不用管它）。
- 随 `npm install` 会**一并安装**项目声明的 Neutralino 命令行工具（`@neutralinojs/neu`），因此**你不需要额外全局安装 neu**，后面直接用 `npm run neu:*` 命令即可。

---

## 四、运行 / 构建应用

项目有两种常见的使用方式，选择适合你的一种：

### 4.1 以桌面应用方式运行（推荐，体验本机能力）

```bash
npm run neu:dev
```

首次运行会自动：

1. 用 Vite 构建前端代码；
2. 下载 Neutralino 桌面运行时二进制（需联网，仅首次）。

> 需要用打包生产版时，改为：
> ```bash
> npm run neu:build
> ```

> **请特别注意**：若只运行 `npm run build`（不带 `neu`），那只是把前端代码编译进 `resources/`，**并不会生成可双击打开的桌面应用**。要得到真正可运行/可打包的应用，必须用上面的 `npm run neu:dev`（运行）或 `npm run neu:build`（打包），它们会在构建后自动把 Neutralino 运行时与 `js/neutralino.js` 补进 `resources/`。

### 4.2 以浏览器方式预览（仅看界面）

```bash
npm run dev
```

启动后终端会给出一个本地地址（通常是 `http://localhost:5173`），在浏览器打开即可预览界面。

> **注意**：浏览器模式主要用来快速预览，涉及本机文件读写、桌面通知等原生能力只能在桌面应用方式（4.1）下完整使用。

---

## 五、配置 API Key

应用本身不自带任何模型的密钥，**首次使用必须配置你自己的 API Key**，否则询问 Agent 时会提示未配置。

配置步骤：

1. 启动应用后，点击底部状态栏的 **配置 API Key**（或进入「设置」页面）；
2. 在 **API Key** 标签页，找到你使用的厂商（如 DeepSeek、OpenAI、Anthropic、Google、智谱、通义千问、Moonshot、小米 MiMo 等）；
3. 粘贴你的 API Key，保存即可。

几点说明：

- **Key 存储位置**：以加密形式存储在本地 `.storage/`，不会上传仓库，也不会发给其他人。
- **只配一个 Key 也够用**：所有 Agent（Oliver / Charlotte / Amelia / Ethan 等）会自动识别已配置的厂商并调用其模型。
- **Agent 模型设置（可选）**：如果你需要精细化调整，可在「设置 → Agent 模型」里为某个 Agent 指定厂商和模型；留空则使用该厂商的默认模型。

---

## 六、常见问题

### Q1：运行时报找不到 `neutralino` 命令或二进制？

```bash
npm run neu:dev   # 或用 npm run neu:build
```
会触发 Neutralino 运行时下载。如果一直失败，请确认 `bin/` 目录下是否有可执行文件，或用 `npx neu` 试试。

### Q2：配置了 API Key 但还是提示"未配置 / 无可用厂商"？

- 检查 Key 是否粘贴完整（不要带多余空格或换行）；
- 确认填入的是**与下拉/输入框一致的厂商**；
- 确认对应平台的 Key 有效、余额充足。

### Q3：只能看到界面，但 Agent 不回复或一直"正在思考中"？

- 少数模型的「思考模式」默认开启，会先输出思维链。若长时间无响应，请确认 Key 有效并在「Agent 模型」设置里换用普通会话模型。

### Q4：浏览器模式（`npm run dev`）下某些功能不可用？

这是正常的——浏览器无本机文件系统、桌面通知等权限。请改用桌面应用模式（`npm run neu:dev`）体验完整功能。

### Q5：换了 API Key 后模型没跟着变？

当前设计为**自动**：保存新的 API Key 后，所有 Agent 会自动切换到有 Key 的厂商及对应默认模型。若仍异常，重启应用一次。

---

## 部署流程速览

```
clone 代码 → npm install → npm run neu:dev → 配置 API Key → 开始使用
```

---

## 补充：关于仓库内容

- 你 clone 到的是**源码仓库**，`node_modules/`、Neutralino 二进制、构建产物、私人 API Key 均不随仓库分发，运行时的 `npm install` 和构建步骤会自动补齐。
- **Neutralino 框架不需要提交进仓库**：它由 `neu` 命令行工具在 `npm run neu:dev / neu:build` 时自动下载生成，属于构建产物，保留在仓库里反而多余。
- 更多功能说明与版本历史，请参阅 [README.md](./README.md)。