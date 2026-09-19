<p align="center">
  <img src="./public/inkstone-logo.svg" width="112" height="112" alt="Inkstone project logo" />
</p>

<h1 align="center">Inkstone</h1>

<p align="center">
  A self-hosted Markdown notebook for writing, organizing, syncing, and backing up personal knowledge.
</p>

<p align="center">
  <a href="./README_ZH.md">中文</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a> ·
  <a href="./LICENSE">LGPL-3.0-only</a> ·
  <a href="https://inkstone-demo.pages.dev/">Demo</a>
</p>

## About / 关于项目

Inkstone is a browser-based notebook that runs on Cloudflare Workers. Notes always remain plain Markdown text; on top of that foundation, the application provides focused writing, live preview, lexical and optional semantic search, bidirectional links, offline editing, multi-device synchronization, private AI access, public sharing, and off-site backups.

It is a complete self-hosted application. The deployer retains control of the database, attachments, and runtime environment.

Every new account automatically receives two standard starter notes, one in Chinese and one in English. The browser-only demo reuses the same note content; refreshing the page restores these two starter notes instead of loading a separate set of demo data.

> **中文说明**：  
> Inkstone（砚石）是一套完全运行在 Cloudflare Workers Serverless 架构上的自托管浏览器 Markdown 个人知识库与笔记本。笔记始终保持为标准 Markdown 纯文本；在此基础上提供专注沉浸式写作、双栏实时预览、D1 FTS5 全文搜索与私有语义搜索、双向链接、离线编辑与自动同步、原生 MCP AI 接入、公开分享以及 WebDAV / S3 异地备份等全套能力。数据与运行环境完全自托管，零服务器维护成本。


### 📌 Fork Updates & Fixes

This fork includes several fixes, UX enhancements, and compatibility improvements based on the upstream project:

1. **Natural Line Breaks (Everyday Note-taking Friendly)**:
   - Upstream strictly enforced standard Markdown newline rules (ignoring single linebreaks unless two trailing spaces were typed).
   - Configured `breaks: true` in the markdown rendering pipeline so single linebreaks wrap naturally without requiring extra spaces, fitting daily typing habits much better.
2. **Test Environment Compatibility (Node 25+)**:
   - Fixed `TypeError: localStorage.clear is not a function` occurring in Node 25+ environments under `jsdom` due to Node's built-in Web Storage conflict.
   - Added `tests/setup-jsdom.ts` and updated `vitest.config.ts`, ensuring 100% test suite pass rate (13/13 test files, 67/67 unit tests).
3. **Comment Policy & Checks**:
   - Synchronized `scripts/check-comments.mjs` whitelist and cleaned up unapproved CSS comments to make `npm run comments:check` fully pass.
4. **Cloudflare Deployment Improvements**:
   - Explicitly bound `FILES_KV` and `OAUTH_KV` namespace IDs in configuration to prevent Cloudflare deploy failures caused by duplicate namespace creation errors (`code: 10014`).
   - Improved `.gitignore` to keep workspace and tool metadata clean.


## Features

| Area | Included |
| --- | --- |
| Writing | CodeMirror 6 editor, independently editable note titles, **two-note editor groups**, per-group editor/split/preview layouts, synchronized scrolling, outline, **focus mode**, **typewriter mode**, **autosave**, and **version history** |
| Markdown | GFM tables and task lists, footnotes, Obsidian-style comments, WikiLinks, embeds, block IDs, callouts, details blocks, tabs, **math**, **Mermaid diagrams**, **PrismJS syntax highlighting**, and **Front Matter** |
| Organization | Nested folders with drag-and-drop ordering, inline tags, favorites, pinning, archive, trash, **wiki links**, backlinks, block references, note embeds, and a relationship graph |
| Search | D1 FTS5 **full-text search** with Chinese indexing, filters, recent notes, command-palette navigation, and optional private **semantic/hybrid search** powered by Workers AI |
| **MCP** | Private remote MCP, OAuth 2.1 with PKCE, revocable `ink_...` API keys, standard `search`/`fetch`, bounded reads, revision-safe writes, separate trash permission, and per-account grant management |
| Reliability | Installable PWA, offline app launch, browser-side cache, **offline write queue and optimistic concurrency control**, immediate local mutations with rollback, stale-sync protection, conflict copies, realtime notifications, and elected-tab polling fallback |
| Sharing | Public note links with optional access passwords and expiration dates |
| Portability | JSON and ZIP exports, directly readable **Markdown**, attachment export, and **manual or scheduled WebDAV/S3 backups** |
| Interface | **Desktop and mobile layouts**, **dark/light themes**, accent colors, Simplified Chinese, English, and owner-only update notifications |

## Data storage

| Component | Purpose |
| --- | --- |
| Cloudflare D1 | Accounts, notes, folders, tags, settings, versions, shares, lexical indexes, per-account AI embeddings, and background indexing queues |
| Cloudflare R2 or Workers KV | Attachment and uploaded-avatar binaries through the `FILES` or `FILES_KV` binding |
| Workers KV `OAUTH_KV` | OAuth client registrations, authorization codes, access and refresh tokens, and grants; note bodies are not stored here |
| Workers AI `AI` binding | Optional embedding generation for semantic search; unavailable deployments continue to use lexical search |
| Browser IndexedDB | Local cache and pending offline writes |
| `SyncHub` Durable Object | Realtime change notifications between active clients |
| `CredentialVault` Durable Object | Isolated storage for the key used to encrypt backup credentials |
| WebDAV or S3 storage | User-configured off-site backups |

## Deployment

1. Fork the Inkstone repository to your GitHub account.
2. Open [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create).
3. Select **Continue with GitHub**, then choose your forked repository.
4. For R2 mode, set the build command to `npm run build` and the deploy command to `npm run deploy`.
   - To use KV mode, change the deploy command to `npm run deploy:kv`.
5. After deployment completes, open the generated Workers URL.

Existing databases are upgraded automatically through versioned, idempotent migrations. Keep a current backup before updating any self-hosted deployment. When a newer stable Inkstone release is available, the owner receives a focused reminder without interrupting regular members.

## Exports and backups

- JSON export preserves legacy structured notebook data for re-import.
- ZIP export and remote backups use the same verified Markdown snapshot format, including readable notes, archived and trashed notes, attachments, and a completion marker.
- Remote backup targets support WebDAV and S3-compatible storage, with duplicate attachment content stored only once inside each snapshot.
- Large backups can be restored by selecting the backup folder, without loading one complete archive into memory.
- Multiple targets can be configured and run manually or on a schedule.
- Login passwords, active sessions, share passwords, and backup-service credentials are not included in exports.

## Development and verification

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Worker and client |
| `npm run dev:kv` | Start locally with the KV attachment configuration |
| `npm run dev:demo` | Start the reset-on-refresh browser-only demo |
| `npm run typecheck` | Run TypeScript project checks |
| `npm run test:unit` | Run the Vitest unit test suite |
| `npm run i18n:check` | Verify parity between the English and Chinese locale resources |
| `npm run comments:check` | Enforce the source-comment policy |
| `npm run build` | Type-check and create a production build |
| `npm run deploy:kv` | Build and deploy with `wrangler.kv.toml` |
| `npm run deploy:demo` | Build and deploy the static browser-only demo |
| `npm run test:e2e` | Exercise the API against a running disposable local instance |

The end-to-end script creates, changes, and deletes data at `http://localhost:7712`. Run it only against a fresh local state dedicated to testing.

## Repository layout

```text
src/
├── client/   React interface, editor, preview, and local state
├── shared/   Shared types, limits, locale resources, and Markdown utilities
└── worker/   Hono API, authentication, D1 access, sync, sharing, and backups
public/       Static assets
scripts/      Repository checks and end-to-end verification scripts
tests/        Cross-module regression tests
```

## Security and contributions

Read [`SECURITY.md`](./SECURITY.md) before reporting a vulnerability. Development setup and contribution requirements are documented in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Inkstone is distributed under the [GNU Lesser General Public License v3.0 only](./LICENSE), using the SPDX identifier `LGPL-3.0-only`.
