# pi-cliproxyapi-websearch

A native web search extension (`web_search`) tailored for the CLIProxyAPI provider in [Pi](https://github.com/earendil-works/pi).

**Zero configuration, zero secondary authentication, no extra API keys or OAuth required** — seamlessly reuses existing `cliproxyapi` connections and model credentials from Pi.

[English](#pi-cliproxyapi-websearch) | [中文说明](#中文说明)

> ⚠️ **Prerequisites**:
> - **CLIProxyAPI Server**: Version **`v7.3.5` or higher**.
> - **Pi Provider Extension**: Must be paired with [`@router-for-me/pi-cliproxyapi-provider`](https://www.npmjs.com/package/@router-for-me/pi-cliproxyapi-provider).

---

## Features

- **Zero Config, No Re-authentication**: Directly reuses the authenticated CLIProxyAPI credentials (BaseURL and API Key) from Pi's model runtime. No re-OAuth or manual API key configuration required.
- **Dynamic Current Model / Automatic Fallback**:
  - By default, uses the active `cliproxyapi` model from your current session to perform searches (supports `gemini-3.8-flash-high`, `gpt-5.6-*`, `gpt-6-*`, `grok-*`, `gpt-5.5`, etc.).
  - If the active session uses a model from another provider, the extension automatically selects an available search model from the registered `cliproxyapi` catalog.
- **Isolated Sub-request Architecture**: Dispatches lightweight sub-requests containing only the native `web_search` tool, completely isolated from local coding tools to prevent mixed-tool conflicts and server-side stripping issues.
- **Model Switching Command**: Built-in `/websearch-model` slash command to inspect, configure, or reset the search model anytime.
- **Execution Time Display**: Displays execution duration (`Took X.Xs` / `Elapsed X.Xs`) matching Pi's shell tool conventions.

---

## Installation

```bash
# 1. Install the CLIProxyAPI Provider extension (if not already installed)
pi install npm:@router-for-me/pi-cliproxyapi-provider

# 2. Install this search extension
pi install npm:pi-cliproxyapi-websearch
```

> Local development or testing: `pi -e ./extensions/index.ts`

---

## Commands

| Command | Description |
| :--- | :--- |
| `/websearch-model` | **Interactive selection**: Opens a terminal selection menu (`ctx.ui.select`), with the top option dynamically following the current session model, followed by candidate models in alphabetical order. |
| `/websearch-model <model-id>` | **Direct assignment**: Directly configure a specific CLIProxyAPI search model (supports Tab completion). |
| `/websearch-model reset` | **Reset to default**: Restore dynamic tracking of the current session model (aliases: `reset`, `current`, `auto`). |

---

## Development

```bash
npm ci
npm run check  # TypeScript typecheck + unit tests (Node.js native test runner)
```

---

# 中文说明

专为 [Pi](https://github.com/earendil-works/pi) 的 CLIProxyAPI Provider 打造的原生网络搜索插件（`web_search`）。

**零配置、零二次认证、无需额外 API Key 或 OAuth**，直接复用 Pi 中已有的 `cliproxyapi` 连接与模型凭据。

> ⚠️ **前置依赖**：
> - **CLIProxyAPI 服务端**：版本需为 **`v7.3.5` 及以上**。
> - **Pi Provider 插件**：必须搭配 [`@router-for-me/pi-cliproxyapi-provider`](https://www.npmjs.com/package/@router-for-me/pi-cliproxyapi-provider) 使用。

---

## 特性

- **零配置、免二次认证**：直接从 Pi 的模型运行时中复用已登录的 CLIProxyAPI 凭据（BaseURL 与 API Key），无需重新 OAuth，也无需手动配置 API Key。
- **直接使用当前模型 / 自动回退**：
  - 默认跟随当前会话中的 `cliproxyapi` 模型执行搜索（支持 `gemini-3.8-flash-high`、`gpt-5.6-*`、`gpt-6-*`、`grok-*`、`gpt-5.5` 等系列）。
  - 若当前会话使用的是其他 Provider 模型，插件会自动从已注册的 `cliproxyapi` 目录中选取可用的搜索模型回退执行。
- **纯净子请求架构**：后台发起仅包含原生 `web_search` 的纯净轻量请求，完全剥离本地编码工具，彻底杜绝混合工具冲突与服务端剥离问题。
- **模型切换命令**：内置 `/websearch-model` 命令，随时查看、指定或重置搜索模型。
- **执行时间显示**：显示执行耗时（`Took X.Xs` / `Elapsed X.Xs`），与 Pi 的终端工具规范一致。

---

## 安装

```bash
# 1. 安装 CLIProxyAPI Provider 插件（若未安装）
pi install npm:@router-for-me/pi-cliproxyapi-provider

# 2. 安装本搜索插件
pi install npm:pi-cliproxyapi-websearch
```

> 本地开发或测试加载：`pi -e ./extensions/index.ts`

---

## 命令

| 命令 | 说明 |
| :--- | :--- |
| `/websearch-model` | **交互式选择**：弹出终端选择菜单（`ctx.ui.select`），首项为动态跟随当前会话模型，其余候选模型按字母顺序排列，直接用方向键选择 |
| `/websearch-model <model-id>` | **命令行直设**：直接指定特定的 CLIProxyAPI 搜索模型（支持 Tab 键自动补全） |
| `/websearch-model reset` | **重置为默认**：恢复为自动跟随当前会话模型（支持 `reset`、`current`、`auto`） |

---

## 开发

```bash
npm ci
npm run check  # TypeScript 类型检查 + 单元测试（Node.js 原生测试套件）
```
