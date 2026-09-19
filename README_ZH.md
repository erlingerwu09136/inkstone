<p align="center">
  <img src="./public/inkstone-logo.svg" width="112" height="112" alt="Inkstone 项目 Logo" />
</p>

<h1 align="center">Inkstone</h1>

<p align="center">
  一套用于写作、整理、同步和备份个人知识的自托管 Markdown 笔记应用。
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./CONTRIBUTING.md">参与开发</a> ·
  <a href="./LICENSE">LGPL-3.0-only</a> ·
  <a href="https://inkstone-demo.pages.dev/">在线体验</a>
</p>

## 项目简介

Inkstone 是运行在 Cloudflare Workers 上的浏览器笔记本。笔记始终是普通 Markdown 文本；在此基础上，应用提供专注写作、实时预览、关键词与可选语义搜索、双链导航、离线编辑、多设备同步、私有 AI 接入、公开分享和异地备份。

它是一套需要自行部署的完整应用，数据库、附件和运行环境都由部署者掌控。

每个新账号都会自动获得中文版和英文版两篇标准起始笔记。纯前端体验版复用同一份笔记内容，刷新页面后恢复为这两篇起始笔记，不会另外维护一套示例数据。

### 📌 本 Fork 仓库更新与修复说明 (Fork Notes)

在原版 Inkstone 基础上，本项目进行了针对性的兼容性优化与排版体验改进：

1. **排版与换行优化（符合日常输入习惯）**：
   - 原版严格遵循标准 Markdown 语法，普通回车不会自动折行，必须行尾打两个空格或空行，导致日常笔记记录不便。
   - 本项目针对渲染引擎启用软换行支持（`breaks: true`），普通单次回车即可自然换行，告别繁琐的手动空格换行，大幅提升中文日常记录与碎片笔记体验。
2. **测试环境兼容修复 (Node 25+)**：
   - 修复在 Node.js v25+ 环境下运行单元测试时，由于原生 Web Storage 与 jsdom 冲突导致 `TypeError: localStorage.clear is not a function` 的问题。
   - 增加 `tests/setup-jsdom.ts` 环境适配补丁，确保单元测试 100% 全部通过（13/13 test files，67/67 tests passed）。
3. **代码风格与注释准入策略规范**：
   - 适配 `scripts/check-comments.mjs`，更新白名单并清除不符合规范的内嵌注释，使 `npm run comments:check` 顺利通过。
4. **Cloudflare 自动化部署资源绑定完善**：
   - 配置并绑定预置的 `FILES_KV` 和 `OAUTH_KV` 命名空间 ID，解决初次或二次部署时 Cloudflare API 报 `code: 10014 (namespace already exists)` 导致的构建中断问题。
   - 完善 `.gitignore`，避免本地与辅助工具开发配置被误上传。



## 主要功能

| 范围 | 已实现能力 |
| --- | --- |
| 写作 | CodeMirror 6 编辑器、可独立编辑的笔记标题、**桌面双笔记窗格**、各窗格独立的编辑/分栏/预览布局、双向滚动、大纲、**专注模式**、**打字机模式**、**自动保存**、**版本历史** |
| Markdown | GFM 表格与任务列表、脚注、Obsidian 风格注释、WikiLink、嵌入、块 ID、Callout、折叠块、标签页、**数学公式**、**Mermaid**、**PrismJS 代码高亮**、**Front Matter** |
| 整理 | 支持拖拽排序的多级文件夹、正文标签、收藏、置顶、归档、回收站、**Wiki 双链**、反向链接、块引用、笔记嵌入、关系图谱 |
| 搜索 | 基于 D1 FTS5 的全**文搜索**、中文索引、条件筛选、最近笔记、命令面板，以及由 Workers AI 提供的可选私有**语义/混合搜索** |
| **MCP** | 私有远程 MCP、带 PKCE 的 OAuth 2.1、可撤销的 `ink_...` API Key、标准 `search`/`fetch`、分段读取、版本安全写入、独立回收站权限和账号级授权管理 |
| 可靠性 | 可安装 PWA、离线启动、浏览器本地缓存、**离线写入队列与乐观并发控制**、常用操作立即本地生效并可失败回滚、过期同步保护、冲突副本、实时通知和主标签页轮询降级 |
| 分享 | 可设置访问口令和有效期的公开笔记链接 |
| 可迁移性 | JSON 与 ZIP 导出、可直接阅读的 **Markdown**、附件导出、**手动或定时 WebDAV/S3 备份** |
| 界面 | **桌面与移动布局**、**深浅主题**、强调色、简体中文和英文，以及仅站长可见的版本更新提醒 |

## 数据存放位置

| 组件 | 用途 |
| --- | --- |
| Cloudflare D1 | 账号、笔记、文件夹、标签、设置、版本、分享、关键词索引、按账号隔离的 AI 向量和后台索引队列 |
| Cloudflare R2 或 Workers KV | 通过 `FILES` 或 `FILES_KV` 绑定存放附件及上传头像的二进制 |
| Workers KV `OAUTH_KV` | OAuth 客户端注册、授权码、访问令牌、刷新令牌和授权记录；不存放笔记正文 |
| Workers AI `AI` 绑定 | 可选生成语义搜索向量；未配置时继续使用关键词搜索 |
| 浏览器 IndexedDB | 本地缓存与尚未上传的离线写入 |
| `SyncHub` Durable Object | 在线客户端之间的实时变更通知 |
| `CredentialVault` Durable Object | 隔离保存用于加密备份凭据的密钥 |
| WebDAV 或 S3 存储 | 用户自行配置的异地备份 |

## 部署教程

1. Fork Inkstone 仓库到自己的 GitHub 账号
2. 进入 [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create)
3. 选择 Continue with GitHub 并选择你的仓库
4. 使用 R2 时，构建命令填 `npm run build`，部署命令填 `npm run deploy`
   - 如果你打算用 KV 模式，把部署命令改成 `npm run deploy:kv`
5. 等部署完成后，打开生成的 Workers 域名

现有数据库会通过带版本号、可重复安全执行的迁移自动升级。自托管实例更新前仍建议保留一份最新备份；发现新的稳定版本时，只有站长会收到专门的更新提醒，不会打扰普通成员。

## 导出与备份

- JSON 导出保留可重新导入的旧版结构化笔记数据。
- ZIP 导出与远程备份使用同一套可校验的 Markdown 快照，包含可读正文、归档笔记、回收站笔记、附件和完整性标记。
- 远程备份支持 WebDAV 与 S3 兼容存储，同一快照内内容相同的附件只保存一份。
- 大型备份可直接选择备份文件夹分批恢复，不必把整包一次装入内存。
- 可以配置多个目标，并选择手动执行或定时运行。
- 登录密码、活动会话、分享口令和备份服务凭据不会进入导出文件。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地 Worker 和前端 |
| `npm run dev:kv` | 使用 KV 附件配置启动本地环境 |
| `npm run dev:demo` | 启动刷新即重置的纯前端体验版 |
| `npm run typecheck` | 执行 TypeScript 项目检查 |
| `npm run test:unit` | 运行 Vitest 单元测试 |
| `npm run i18n:check` | 检查中英文资源键是否完整一致 |
| `npm run comments:check` | 检查源码注释规范 |
| `npm run build` | 类型检查并生成生产构建 |
| `npm run deploy:kv` | 使用 `wrangler.kv.toml` 构建并部署 |
| `npm run deploy:demo` | 构建并部署纯静态体验版 |
| `npm run test:e2e` | 对正在运行的临时本地实例执行 API 端到端测试 |

端到端脚本会在 `http://localhost:7712` 创建、修改并删除数据，只能对专门用于测试的全新本地状态运行。

## 目录结构

```text
src/
├── client/   React 界面、编辑器、预览和本地状态
├── shared/   共享类型、限制、语言资源和 Markdown 工具
└── worker/   Hono API、认证、D1 访问、同步、分享和备份
public/       静态资源
scripts/      仓库检查与端到端验证脚本
tests/        跨模块回归测试
```

## 安全与参与开发

报告安全问题前请阅读 [`SECURITY.md`](./SECURITY.md)。开发环境和贡献要求见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 许可证

Inkstone 使用 [GNU Lesser General Public License v3.0 only](./LICENSE)，SPDX 标识为 `LGPL-3.0-only`。
