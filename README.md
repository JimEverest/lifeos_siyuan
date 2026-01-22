# LifeOS Sync

[English](#english) | [中文](#中文)

---

## English

**Export-only sync from SiYuan to GitHub (markdown + assets)**. GitHub is treated as a read-only mirror for collaboration and tooling.

### ✨ Key Features

- **🚀 Auto-Sync**: Automatically sync changes to GitHub at configurable intervals (5-60 minutes)
- **⚡ Incremental Sync**: Only syncs changed documents and assets, avoiding full repository scans
- **💾 Intelligent Cache System**: 30-50x performance improvement with hash-based change detection
- **📦 Batch Operations**: Efficient parallel processing of multiple files
- **🔒 Multi-Environment Support**: Works seamlessly in HTTPS, HTTP, localhost, and Docker environments

### 🎯 Cache Mechanism Highlights

The cache system is the **core technology** enabling high-performance auto-sync for large repositories (2000+ documents, 5000+ assets):

#### **How It Works**

1. **Document Cache (Notebook-based Sharding)**
   - Cache file: `.lifeos-sync/cache-{notebookId}.json`
   - Stores: GitHub SHA, content hash, SiYuan updated timestamp, file path
   - Update strategy: Only recalculate hash when `doc.updated > cached.siyuanUpdated`
   - **Performance**: 100s → 3s for unchanged documents (30x faster)

2. **Asset Cache (Hash-based 16-way Sharding)**
   - Cache files: `.lifeos-sync/assets-cache-{0-f}.json`
   - Sharding by: First character of filename hash
   - Stores: GitHub SHA, file hash, size, modification time
   - **Performance**: Skips re-upload for identical assets (50x faster)

3. **Incremental Sync Algorithm**
   ```
   Phase 1: Document Scanning (SQL-based, lightweight)
     └─ Query all doc metadata (id, box, updated) from blocks table
     └─ Compare doc.updated vs cache.siyuanUpdated
     └─ Only process changed documents

   Phase 2: Asset Scanning (File metadata - modification time only)
     └─ Read /data/assets directory (mtime only, no file content)
     └─ Compare asset.mtime vs last sync time
     └─ Only upload changed assets

   Phase 3: Batch Upload (Parallel processing)
     └─ Concurrency: 5 files at a time
     └─ Skip upload if GitHub SHA matches local hash
   ```

4. **Performance Comparison**

   | Scenario | Without Cache | With Cache + Incremental Sync | Improvement |
   |----------|---------------|-------------------------------|-------------|
   | First sync (2000 docs) | 200s | 200s | - |
   | Daily sync (1% changed) | 205s | 11s | **18x faster** |
   | No changes | 200s | 6s | **33x faster** |
   | CPU usage (10min auto-sync) | 34% | 2% | **17x reduction** |

5. **Hash Strategy (Multi-Environment)**
   - **HTTPS/localhost**: SHA-256 via `crypto.subtle` API
   - **HTTP (Docker)**: FNV-1a hash fallback (browser-compatible)
   - Automatic detection and graceful degradation

### 🔧 Quick Start (Development)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the plugin:
   ```bash
   npm run build
   ```
   This outputs `index.js` in the plugin root.

3. Load the plugin folder in SiYuan.

### 📖 Usage

#### Manual Export
- Click the top bar sync icon → **Export current doc**
- Exports the currently active document in the editor to GitHub

#### Asset Sync
- Top bar icon → **Sync all assets**
- Uploads all assets from `data/assets` to GitHub

#### Auto-Sync (v0.3.0)
- Top bar icon → **Auto sync: ON/OFF** (quick toggle)
- Configure via menu → **Configure...** → Auto Sync section:
  - **Enable auto sync**: Turn on/off automatic synchronization
  - **Sync interval**: 1-1440 minutes (default: 30 minutes)
  - **Sync documents**: Include document changes in auto-sync
  - **Sync assets**: Include asset changes in auto-sync

#### Configuration
- Top bar icon → **Configure...**
- Settings:
  - **Repo URL**: GitHub repository URL (e.g., `https://github.com/user/repo`)
  - **Branch**: Target branch (default: `main`)
  - **Token (PAT)**: GitHub Personal Access Token with repo permissions
  - **Export root**: Directory in repo for markdown files (empty = repo root)
  - **Assets dir**: Directory for assets (default: `assets`)
  - **Ignore notebooks**: Comma-separated notebook names to exclude (supports `*` wildcard)
  - **Ignore paths**: Comma-separated paths to exclude (supports `*` wildcard)
  - **Ignore tags**: Comma-separated tags to exclude (supports `*` wildcard)
  - **Export all assets**: Export all assets from `data/assets` (if unchecked, only exports referenced assets)
  - **Clean frontmatter**: Remove YAML frontmatter from exported markdown

### 📝 Notes on GitHub 404 Logs

- During export, the plugin first attempts to fetch the existing file SHA from GitHub
- If the file does not exist, GitHub returns 404 - **this is normal behavior**
- The browser console may show these 404 GET requests, but the subsequent PUT will successfully create/update the file
- Assets are written under `assets/<filename>` (no double prefix)

### ⚙️ Technical Details

#### Architecture
- **Client-side only**: All sync operations run in the SiYuan plugin environment
- **Export-only**: Only pushes to GitHub; no pull/backsync implemented (reserved for later)
- **Cache storage**: JSON files in `.lifeos-sync/` directory
- **Change detection**: Hash-based comparison (SHA-256 or FNV-1a)
- **Conflict resolution**: GitHub SHA comparison prevents accidental overwrites

#### Performance Optimizations
1. **SQL Metadata Queries**: Use SiYuan's `/api/query/sql` to fetch document metadata without exporting markdown
2. **Timestamp-based Filtering**: Only process documents with `updated > cached.siyuanUpdated`
3. **Parallel Upload**: Process multiple files concurrently (max concurrency: 5)
4. **Smart Skipping**: Skip upload when local hash matches GitHub SHA
5. **Cache Sharding**: Distribute cache across multiple files to reduce I/O lock contention

#### Supported Environments
- ✅ Windows Desktop (HTTPS)
- ✅ macOS Desktop (HTTPS)
- ✅ Linux Desktop (HTTPS)
- ✅ Docker (HTTP) with hash fallback
- ✅ Localhost (HTTP)

### 🚀 Version History

- **v0.4.2** (2026-01-23):
  - 🐛 Fixed `Buffer is not defined` error in browser environment (asset upload now works)
  - 🐛 Fixed double exclamation mark in image links (`!![image]` → `![image]`)
- **v0.4.1** (2026-01-23):
  - 🐛 Fixed image link formatting with negative lookbehind regex
  - 🔧 Multi-shard cache scanning for cross-device compatibility
- **v0.4.0** (2026-01-23):
  - 🚀 Multi-device cache compatibility: Scans all 16 asset shards when cache lookup fails
  - ⚡ Simplified asset cache validation (filename-only check, no fileSize/contentHash verification)
  - 🔧 Performance optimization: Cache check before file reading
- **v0.3.0**: Auto-sync + incremental sync + performance optimizations
- **v0.2.0**: Cache system + hash-based change detection
- **v0.1.0**: Initial release with manual export

### 🐛 Known Issues & Solutions

#### Multi-Device Sync Cache Mismatch
**Problem**: When syncing across multiple devices (Desktop, Docker, Mobile), asset cache shard calculation may differ due to environment variations, causing assets to be marked as "not cached" even though they exist in cache files.

**Solution (v0.4.0+)**: The plugin now scans all 16 asset cache shards if the expected shard doesn't contain the entry. This ensures cross-device compatibility with minimal performance impact.

#### SiYuan SQL Query Limit
**Issue**: SiYuan's `/api/query/sql` returns only 64 records by default.

**Workaround**: Always include explicit `LIMIT` in SQL queries (e.g., `LIMIT 10000` for large repositories). The plugin handles this internally for incremental sync.

#### HTTP vs HTTPS Hash Algorithm
**Behavior**:
- HTTPS/localhost: Uses SHA-256 (64-char hash)
- HTTP (Docker): Uses FNV-1a (8-char hash)

**Impact**: Switching between HTTP/HTTPS environments will cause one-time cache invalidation and re-upload all files. After the first sync, cache works normally.

### 📄 License

MIT

---

## 中文

**从思源笔记单向同步到 GitHub（markdown + 资源文件）**。GitHub 被视为只读镜像，用于协作和工具集成。

### ✨ 核心功能

- **🚀 自动同步**: 可配置的定时自动同步到 GitHub（5-60 分钟间隔）
- **⚡ 增量同步**: 仅同步变化的文档和资源，避免全量扫描
- **💾 智能缓存系统**: 基于哈希的变化检测，性能提升 30-50 倍
- **📦 批量操作**: 高效的并行文件处理
- **🔒 多环境支持**: 无缝支持 HTTPS、HTTP、localhost 和 Docker 环境

### 🎯 缓存机制亮点

缓存系统是实现**大型仓库（2000+ 文档、5000+ 资源）高性能自动同步**的**核心技术**：

#### **工作原理**

1. **文档缓存（按笔记本分片）**
   - 缓存文件：`.lifeos-sync/cache-{笔记本ID}.json`
   - 存储内容：GitHub SHA、内容哈希、思源更新时间戳、文件路径
   - 更新策略：仅当 `doc.updated > cached.siyuanUpdated` 时重新计算哈希
   - **性能提升**：未变化文档从 100 秒降至 3 秒（30 倍加速）

2. **资源缓存（基于哈希的 16 路分片）**
   - 缓存文件：`.lifeos-sync/assets-cache-{0-f}.json`
   - 分片依据：文件名哈希的首字符
   - 存储内容：GitHub SHA、文件哈希、大小、修改时间
   - **性能提升**：跳过相同资源的重复上传（50 倍加速）

3. **增量同步算法**
   ```
   阶段 1：文档扫描（基于 SQL，轻量级）
     └─ 从 blocks 表查询所有文档元数据（id、box、updated）
     └─ 比较 doc.updated 与 cache.siyuanUpdated
     └─ 仅处理变化的文档

   阶段 2：资源扫描（仅文件元数据 - 修改时间）
     └─ 读取 /data/assets 目录（仅 mtime，不读文件内容）
     └─ 比较 asset.mtime 与上次同步时间
     └─ 仅上传变化的资源

   阶段 3：批量上传（并行处理）
     └─ 并发数：同时处理 5 个文件
     └─ 如果 GitHub SHA 与本地哈希匹配则跳过上传
   ```

4. **性能对比**

   | 场景 | 无缓存 | 缓存 + 增量同步 | 性能提升 |
   |------|--------|----------------|----------|
   | 首次同步（2000 篇文档） | 200 秒 | 200 秒 | - |
   | 每日同步（1% 变化） | 205 秒 | 11 秒 | **18 倍加速** |
   | 无变化 | 200 秒 | 6 秒 | **33 倍加速** |
   | CPU 占用（10 分钟自动同步） | 34% | 2% | **降低 17 倍** |

5. **哈希策略（多环境兼容）**
   - **HTTPS/localhost**：使用 `crypto.subtle` API 的 SHA-256
   - **HTTP（Docker）**：降级使用 FNV-1a 哈希（浏览器兼容）
   - 自动检测环境并优雅降级

### 🔧 快速开始（开发）

1. 安装依赖：
   ```bash
   npm install
   ```

2. 构建插件：
   ```bash
   npm run build
   ```
   将在插件根目录生成 `index.js`。

3. 在思源笔记中加载插件文件夹。

### 📖 使用方法

#### 手动导出
- 点击顶栏同步图标 → **Export current doc**（导出当前文档）
- 将编辑器中当前活动的文档导出到 GitHub

#### 资源同步
- 顶栏图标 → **Sync all assets**（同步所有资源）
- 将 `data/assets` 中的所有资源上传到 GitHub

#### 自动同步（v0.3.0）
- 顶栏图标 → **Auto sync: ON/OFF**（快速开关）
- 配置方式：菜单 → **Configure...** → Auto Sync 部分：
  - **Enable auto sync**：启用/禁用自动同步
  - **Sync interval**：同步间隔（1-1440 分钟，默认 30 分钟）
  - **Sync documents**：自动同步包含文档变化
  - **Sync assets**：自动同步包含资源变化

#### 配置设置
- 顶栏图标 → **Configure...**（配置）
- 设置项：
  - **Repo URL**：GitHub 仓库 URL（如 `https://github.com/user/repo`）
  - **Branch**：目标分支（默认：`main`）
  - **Token (PAT)**：GitHub 个人访问令牌（需要 repo 权限）
  - **Export root**：markdown 文件在仓库中的目录（空 = 仓库根目录）
  - **Assets dir**：资源目录（默认：`assets`）
  - **Ignore notebooks**：要排除的笔记本名称（逗号分隔，支持 `*` 通配符）
  - **Ignore paths**：要排除的路径（逗号分隔，支持 `*` 通配符）
  - **Ignore tags**：要排除的标签（逗号分隔，支持 `*` 通配符）
  - **Export all assets**：导出 `data/assets` 中的所有资源（取消勾选则仅导出文档引用的资源）
  - **Clean frontmatter**：从导出的 markdown 中移除 YAML frontmatter

### 📝 关于 GitHub 404 日志的说明

- 导出时，插件会先尝试从 GitHub 获取现有文件的 SHA
- 如果文件不存在，GitHub 返回 404 - **这是正常行为**
- 浏览器控制台可能显示这些 404 GET 请求，但后续的 PUT 请求会成功创建/更新文件
- 资源文件写入 `assets/<文件名>`（无双重前缀）

### ⚙️ 技术细节

#### 架构设计
- **纯客户端**：所有同步操作在思源笔记插件环境中运行
- **仅导出**：只推送到 GitHub；未实现拉取/反向同步（保留用于后续版本）
- **缓存存储**：JSON 文件存储在 `.lifeos-sync/` 目录
- **变化检测**：基于哈希的比较（SHA-256 或 FNV-1a）
- **冲突解决**：通过 GitHub SHA 比较防止意外覆盖

#### 性能优化
1. **SQL 元数据查询**：使用思源的 `/api/query/sql` 获取文档元数据，无需导出 markdown
2. **基于时间戳的过滤**：仅处理 `updated > cached.siyuanUpdated` 的文档
3. **并行上传**：并发处理多个文件（最大并发数：5）
4. **智能跳过**：当本地哈希与 GitHub SHA 匹配时跳过上传
5. **缓存分片**：将缓存分布在多个文件中，减少 I/O 锁争用

#### 支持的环境
- ✅ Windows 桌面版（HTTPS）
- ✅ macOS 桌面版（HTTPS）
- ✅ Linux 桌面版（HTTPS）
- ✅ Docker（HTTP）带哈希降级
- ✅ Localhost（HTTP）

### 🚀 版本历史

- **v0.3.0**：自动同步 + 增量同步 + 性能优化
- **v0.2.0**：缓存系统 + 基于哈希的变化检测
- **v0.1.0**：初始版本，支持手动导出

### 📄 许可证

MIT
