# ToolsDesktopMg

macOS 桌面端的本地服务管理工具：把散落在各处的中间件、数据库、前端项目的启停操作收进一个界面。**非 Docker 容器应用**，直接管理本机安装的 Tomcat、Nacos、Redis、MySQL、Kafka，以及 Vue2/Vue3 等前端项目。

## 功能特性

### 服务生命周期
- **一键启动**：通过 shell 执行启动命令（`startup.sh`、`npm run dev`、`redis-server` 等），支持配置工作目录
- **一键停止**：优先执行自定义停止命令 → SIGTERM 优雅停止（10s 超时）→ 自动升级 SIGKILL
- **强制停止**：SIGKILL 杀掉整个进程组，覆盖 `startup.sh` 派生 java 子进程等场景
- **孤儿进程恢复**：PID 持久化 + `pgrep -f` 双模式兜底匹配（可执行路径 / 工作目录），应用重启后仍能管理之前拉起的服务

### 状态监控
- **三档状态**：`Running`（进程 + 端口 + 健康全通过）/ `Degraded`（进程在但端口或健康未通过）/ `Stopped`，徽章带图标与光晕，列表与详情双处展示
- **端口监听**：`lsof` 逐端口检测，绿色 ✅ / 红色 ✕ 徽章展示
- **端口自动发现**：查询服务进程**实际监听**的所有端口（蓝色「自动」徽章），vite 端口被占用自动漂移等场景一目了然
- **端口识别**：从项目配置文件（`vite.config` / `vue.config` / `.env`）正则扫描端口，一键填入
- **CPU / 内存**：进程组合计占用，5 秒自动刷新
- **健康检查**：HTTP 探针（如 `http://localhost:8848/nacos`），2xx 视为健康

### 前端项目支持（Vue2 / Vue3）
- 类型模板预填启动命令与端口（vue-cli 8080 / vite 5173）
- **自定义动作按钮**：`npm install`、`npm run test`、`npm run build` 一键执行，可任意增删改（换 pnpm 只需改命令）
- 动作执行防并发，完整输出写入日志

### 辅助功能
- 日志统一落盘，点击「打开日志」直接查看
- 「打开终端」在服务工作目录唤起 Terminal.app
- 服务类型模板：Tomcat / Nacos / Redis / MySQL / Kafka / Vue2 / Vue3 / 自定义

## 技术栈

- **Electron 45** + **electron-vite 6**（Vite 8 构建，主进程 / 预加载 / 渲染三端热更新）
- **React 19** + **TypeScript 7** + **Tailwind CSS 4**
- 全栈 TypeScript，主进程与渲染进程共享类型定义（`src/shared/types.ts`）
- 进程管理基于系统调用（`spawn` / `kill` / `lsof` / `pgrep` / `ps`），无额外原生依赖

## 快速开始

### 环境要求
- macOS（Apple Silicon / Intel 均可）
- Node.js 18+

### 启动开发

```bash
npm install
npm run dev
```

> 国内网络若 Electron 二进制下载失败，项目已内置 `.npmrc` 指向 npmmirror 镜像，无需额外配置。

### 其他命令

```bash
npm run build      # 三端生产构建（out/ 目录）
npm run dist       # 生产构建 + 打包 .dmg（输出到 dist/，当前 arm64）
npm run typecheck  # 主进程 + 渲染进程类型检查
```

> 打包产物如 `dist/toolsDesktopMg-0.1.0-arm64.dmg`（约 116MB），本地开发构建未做代码签名，首次打开需右键 →「打开」绕过 Gatekeeper。如需 Intel 版本，在 `electron-builder.yml` 的 `arch` 中加 `x64`（或改 `universal`）。

## 使用指南

1. 点左上角 **「+ 添加」**，选择服务类型（如 Vue3 / Nacos）
2. 模板会预填启动命令、默认端口与动作按钮
3. 填写 **工作目录**（如 `/Users/xxx/env/java/nacos` 或 Vue 项目根目录）
4. 端口可点 **「从项目识别」** 自动填入，或手动填写
5. 保存后即可 **启动 / 停止 / 强制停止**，并实时查看状态、端口、CPU / 内存
6. Vue 项目可先点 **「安装依赖」** 再启动

### 配置示例（Nacos）

| 字段 | 值 |
|---|---|
| 启动命令 | `bin/startup.sh -m standalone` |
| 停止命令 | `bin/shutdown.sh` |
| 工作目录 | `/Users/xxx/env/java/nacos` |
| 端口 | `8848, 9848` |
| 健康检查 | `http://localhost:8848/nacos` |

## 数据存储

所有数据存于 macOS 应用数据目录（无需 sudo）：

```
~/Library/Application Support/toolsDesktopMg/
├── services.json   # 服务配置列表
├── pids.json       # 运行中服务的 PID 记录（用于孤儿进程恢复）
└── logs/
    └── service-output.log   # 默认日志输出（各服务 stdout/stderr 追加写入）
```

## 项目结构

```
src/
├── shared/
│   └── types.ts            # 共享类型：ServiceConfig / ServiceStatus / 类型模板预设
├── main/                   # Electron 主进程
│   ├── index.ts            # 应用入口 + IPC 注册（CRUD / 启停 / 动作 / 端口识别）
│   ├── store.ts            # JSON 文件持久化
│   └── processManager.ts   # 核心：进程启停、信号处理、状态与资源采样
├── preload/
│   └── index.ts            # contextBridge 安全暴露 API（contextIsolation 开启）
└── renderer/               # React 渲染进程
    ├── src/App.tsx         # 列表 + 详情双栏布局、状态轮询（5s）
    └── components/
        └── ServiceForm.tsx # 服务表单（类型模板 / 动作编辑 / 端口识别）
```

## 设计说明

- **进程组控制**：启动时 `detached: true` 建立独立进程组，停止/强杀用 `kill(-pid)` 整组终止，避免只杀壳脚本留下孤儿 java/node 进程
- **双模式进程检测**：兼容前台进程（`redis-server`）与后台派生（`startup.sh` → java）两类模型，启动后 30s 轮询确认
- **状态判据分层**：进程存活（`ps` 信号 0 探测）→ 端口监听（`lsof`）→ HTTP 健康（2s 超时），逐层递进
- **安全基线**：`contextIsolation` 开启、`nodeIntegration` 关闭、渲染进程通过 preload 白名单 API 访问主进程能力

## Roadmap

- [ ] 菜单栏（Menu Bar）常驻与快捷启停
- [ ] 应用内日志实时查看面板（tail -f）
- [ ] 精确 CPU% 差分计算（当前为 ps 衰减均值口径）
- [ ] 批量启停（一键拉起整套环境）
- [ ] 包管理器下拉选项（npm / pnpm / yarn）
- [x] electron-builder 打包分发（.dmg，arm64；Universal 待加 x64 target）
- [ ] 应用图标与代码签名 / 公证
- [ ] 开机自启（LaunchAgent 生成）
