# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源
├── backend/                # Python 后端服务与数据集处理逻辑
│   ├── app.py              # 后端 API 入口
│   └── dataset_service.py  # 数据集加载、缓存、处理服务
├── config/                 # 项目自定义配置代码与配置常量
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   ├── start.sh            # 生产环境启动脚本
│   └── validate.sh         # 检测与校验脚本
├── src/
│   ├── app/                # 页面路由与布局
│   │   └── api/            # Next.js API 路由
│   ├── components/         # 功能组件与 UI 组件
│   │   └── ui/             # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 通用工具库
│   │   ├── cleaning/       # 数据清洗检测逻辑
│   │   ├── server/         # 服务端专用工具
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── test/                   # Python 后端测试
├── .dataset-store/         # 本地数据集缓存与上传数据
├── components.json         # shadcn/ui 配置
├── eslint.config.mjs       # ESLint 配置
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
├── postcss.config.mjs      # PostCSS 配置
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。
- `.next/`、`node_modules/`、`__pycache__/`、`tsconfig.tsbuildinfo` 等为生成产物或依赖缓存，不作为源码目录维护。

### 文件目录职责规范

- **脚本代码**：放在 `scripts/` 下，仅用于构建、启动、部署、预处理、批处理等工程操作；不要承载业务功能逻辑。
- **功能代码**：放在 `src/app/`、`src/components/`、`src/features/`、`src/hooks/` 等目录下；跨多个文件的业务能力优先按功能聚合到 `src/features/<feature-name>/`。
- **工具代码**：放在 `src/lib/` 下，只包含通用、无业务状态或低耦合的工具函数、客户端封装、格式化与转换逻辑；禁止把页面组件或业务流程塞进 `lib`。
- **配置代码**：项目自定义配置常量、运行时配置解析、后端/前端共享配置应放在 `config/` 下；`next.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`postcss.config.mjs`、`components.json`、`package.json` 等必须被工具链在根目录发现的入口配置文件保留在根目录。
- **测试代码**：放在 `src/tests/` 或与被测文件同目录的 `*.test.ts(x)` / `*.spec.ts(x)`；测试夹具、mock、测试 helper 应放在 `src/tests/` 内部，不要混入功能实现目录。
- **检测代码**：放在 `src/checks/` 下，用于健康检查、数据校验、诊断、质量门禁、开发期检测等；检测逻辑可以调用功能代码和工具代码，但不能反向成为功能代码的运行依赖。
- 新增文件前必须先判断所属职责；如果一个文件同时承担脚本、功能、工具、配置、测试、检测中的多种角色，应拆分到对应目录。
- 目录命名保持语义清晰、稳定、可搜索；避免 `misc`、`common2`、`new`、`temp` 等无法表达职责的目录名。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### Karpathy 准则

- 使用 AI/Agent 时，把自然语言当作高层接口，但不要把生成结果当作事实；必须阅读关键代码路径，理解变更意图、边界条件和失败模式。
- 先做最小可运行闭环：明确目标、改动最小表面、快速运行类型检查/测试/页面验证，再继续扩大范围。
- 优先选择简单、直接、可解释的实现；避免为一次性需求引入复杂抽象、隐式魔法、过度通用化或难以调试的状态链路。
- 对 AI 生成代码保持“信任但验证”：检查类型、未声明标识符、死代码、重复逻辑、异常路径、hydration 风险和用户可见回归。
- 保留工程师判断：Agent 可以加速写代码，但最终必须由人类级别的审查标准决定是否合入；不能提交自己无法解释的代码。
- 遇到不确定性时先缩小问题并建立可观测性，例如补充日志、断言、测试用例或临时复现实验，而不是盲目重写。
- 倾向小步提交和清晰 diff；每次变更都应能说明“为什么需要、影响哪里、如何验证”。

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**
