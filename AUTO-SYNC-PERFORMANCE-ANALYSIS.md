# 自动全量同步性能分析报告

## 场景假设
- 笔记数量: 2000 篇
- 资源数量: 5000 个
- 同步频率: 每 60 分钟
- 文档变化率: 10% (200 篇)
- 资源变化率: 1% (50 个)

---

## 1. 当前架构的性能瓶颈

### 1.1 文档同步性能分析

#### 操作耗时估算

| 操作 | 单次耗时 | 2000篇总耗时 | 瓶颈类型 |
|-----|---------|-------------|---------|
| exportMarkdown() API | 50ms | 100s (1.67分钟) | **I/O + CPU** |
| 计算 hash (SHA-256) | 1ms | 2s | CPU |
| 计算 hash (FNV-1a) | 0.1ms | 0.2s | CPU |
| 查询本地缓存 | 0.5ms | 1s | I/O |
| 比对 hash | 0.01ms | 0.02s | CPU |
| GitHub API (10%变化) | 300ms × 200 | 60s (1分钟) | **网络** |
| **总计** | | **~163s (2.7分钟)** | |

#### 详细分析

**最大瓶颈: exportMarkdown() API**

```typescript
// 当前实现 (exporter.ts)
const markdownRaw = await exportMarkdown(docId);
```

问题:
- ❌ 每次同步都要导出 Markdown
- ❌ 2000 次 API 调用 → 100 秒
- ❌ 即使内容未变也要导出
- ❌ CPU 和内存消耗大

### 1.2 资源同步性能分析

#### 操作耗时估算

| 操作 | 单次耗时 | 5000个总耗时 | 瓶颈类型 |
|-----|---------|-------------|---------|
| 读取文件 (平均200KB) | 2ms | 10s | **I/O** |
| 计算 hash | 1ms | 5s | CPU |
| 查询缓存 | 0.5ms | 2.5s | I/O |
| 比对 hash | 0.01ms | 0.05s | CPU |
| GitHub API (1%变化) | 500ms × 50 | 25s | **网络** |
| **总计** | | **~42.5s** | |

### 1.3 总体性能评估

```
单次全量同步总耗时:
  文档: 163s
  资源: 42.5s
  总计: 205.5s ≈ 3.4 分钟
```

**每小时同步一次:**
- CPU 密集: 3.4 分钟
- 空闲时间: 56.6 分钟
- **CPU 占用率: ~6%** (可接受)

**每 10 分钟同步一次:**
- CPU 密集: 3.4 分钟
- 空闲时间: 6.6 分钟
- **CPU 占用率: ~34%** (⚠️ 偏高)

**每 5 分钟同步一次:**
- CPU 密集: 3.4 分钟
- 空闲时间: 1.6 分钟
- **CPU 占用率: ~68%** (❌ 太高)

---

## 2. 核心问题

### 问题 1: 无差异化扫描

**当前逻辑:**
```typescript
// 每次同步都要处理所有文档
for (const doc of allDocs) {
    const markdown = await exportMarkdown(doc.id);  // ← 每次都导出!
    const hash = await calculateHash(markdown);
    // ...
}
```

**问题:**
- ❌ 即使文档未修改，也要导出 Markdown
- ❌ 2000 次不必要的 API 调用
- ❌ 100 秒浪费在未变化的文档上

### 问题 2: 缺少变更检测

**当前架构缺少:**
- ❌ SiYuan 文档修改时间检测
- ❌ 增量同步机制
- ❌ 变更队列

**理想架构应该:**
- ✅ 只处理修改过的文档
- ✅ 利用 SiYuan 的 `updated` 时间戳
- ✅ 维护"待同步队列"

### 问题 3: GitHub API 调用优化

**当前问题:**
```typescript
// 问题: 不需要获取 GitHub SHA
const cached = await getDocCacheEntry(plugin, notebookId, docId);
if (cached && cached.contentHash === currentHash) {
    // 跳过上传 ← 正确
}
// 但之前已经:
// 1. 导出了 Markdown (浪费)
// 2. 计算了 hash (浪费)
```

**优化点:**
- ✅ 先检查 SiYuan 时间戳
- ✅ 再决定是否导出
- ✅ 避免不必要的操作

---

## 3. 优化方案

### 方案 A: 基于时间戳的增量同步 (推荐)

#### 核心思路

利用 SiYuan 的文档元数据中的 `updated` 字段:

```typescript
// SiYuan 文档信息
{
    id: "20241221133029-8eietj4",
    updated: 1736985500000,  // ← 文档最后修改时间
    // ...
}
```

#### 实现逻辑

```typescript
// 伪代码
async function incrementalSync() {
    const allDocs = await getAllDocuments();
    const changedDocs = [];

    // 第一轮: 快速过滤 (只查询元数据，不导出内容)
    for (const doc of allDocs) {
        const docInfo = await getDocInfo(doc.id);  // 轻量级查询
        const cached = await getDocCacheEntry(notebookId, doc.id);

        if (!cached) {
            // 缓存不存在 → 新文档
            changedDocs.push(doc);
            continue;
        }

        if (docInfo.updated > cached.siyuanUpdated) {
            // SiYuan 更新时间晚于缓存时间 → 文档已修改
            changedDocs.push(doc);
        }
        // else: 文档未修改 → 跳过
    }

    // 第二轮: 只处理变化的文档
    for (const doc of changedDocs) {
        const markdown = await exportMarkdown(doc.id);  // 只导出变化的
        const hash = await calculateHash(markdown);
        // ... 后续上传逻辑
    }
}
```

#### 性能对比

**场景: 2000 篇文档，10% 变化 (200 篇)**

| 阶段 | 当前方案 | 优化方案 | 提升 |
|-----|---------|---------|-----|
| 第一轮扫描 | exportMarkdown × 2000<br>(100s) | getDocInfo × 2000<br>(10s) | **10倍** |
| 第二轮处理 | - | exportMarkdown × 200<br>(10s) | - |
| **总计** | 100s | 20s | **5倍** |

**日常场景: 2000 篇文档，1% 变化 (20 篇)**

| 阶段 | 当前方案 | 优化方案 | 提升 |
|-----|---------|---------|-----|
| 第一轮扫描 | 100s | 10s | 10倍 |
| 第二轮处理 | - | 1s | - |
| **总计** | 100s | 11s | **9倍** |

### 方案 B: 事件驱动 + 变更队列

#### 核心思路

监听 SiYuan 文档修改事件，维护"待同步队列"

```typescript
// 实时监听文档修改
plugin.eventBus.on("ws-main", (event) => {
    if (event.cmd === "transactions") {
        // 文档被修改
        const docId = event.data.docId;
        syncQueue.add(docId);  // 加入待同步队列
    }
});

// 定时同步队列中的文档
setInterval(async () => {
    const docsToSync = syncQueue.getAll();
    for (const docId of docsToSync) {
        await syncDocument(docId);
        syncQueue.remove(docId);
    }
}, 60000);  // 每分钟
```

#### 优势

- ✅ 实时响应修改
- ✅ 零浪费（只同步修改的）
- ✅ 性能最优

#### 劣势

- ❌ 实现复杂
- ❌ 需要持久化队列
- ❌ 依赖 WebSocket 事件

### 方案 C: 混合方案 (推荐)

结合方案 A 和 方案 B:

1. **主路径**: 基于时间戳的增量同步（方案 A）
2. **辅助路径**: 事件驱动队列（方案 B）
3. **保底路径**: 定期全量扫描（每天一次）

---

## 4. 资源文件优化

### 问题

资源文件通常不频繁修改:
- 图片上传后几乎不变
- PDF 文件不变
- 只有新增的资源需要同步

### 优化方案

#### 方案 1: 利用文件系统时间戳

```typescript
async function getModifiedAssets(since: number): Promise<AssetFile[]> {
    const allAssets = await getAllAssets();
    const modifiedAssets = [];

    for (const asset of allAssets) {
        const stat = await getFileStat(`data/assets/${asset.path}`);

        if (stat.mtime > since) {
            // 文件修改时间晚于上次同步 → 新增或修改
            modifiedAssets.push(asset);
        }
    }

    return modifiedAssets;
}

// 使用
const lastSyncTime = await getLastAssetSyncTime();
const assetsToSync = await getModifiedAssets(lastSyncTime);
// 只同步 assetsToSync (可能只有 10-50 个)
```

#### 性能对比

**场景: 5000 个资源，1% 新增/修改 (50 个)**

| 操作 | 当前方案 | 优化方案 | 提升 |
|-----|---------|---------|-----|
| 扫描文件时间戳 | - | 5000 × 0.1ms = 0.5s | - |
| 读取文件内容 | 5000 × 2ms = 10s | 50 × 2ms = 0.1s | **100倍** |
| 计算 hash | 5000 × 1ms = 5s | 50 × 1ms = 0.05s | **100倍** |
| **总计** | 15s | 0.65s | **23倍** |

---

## 5. 最终优化方案总结

### 推荐架构

```
┌─────────────────────────────────────────────────────┐
│          自动全量同步优化架构                          │
└─────────────────────────────────────────────────────┘

定时器触发 (每 N 分钟)
        │
        ▼
┌────────────────────┐
│ 1. 增量扫描文档     │
│  - 获取所有文档元数据│  ← 轻量级查询 (10s)
│  - 比对 updated 时间│
│  - 筛选变化的文档   │
└────────┬───────────┘
         │
         ▼
   有变化的文档？
         │
    ┌────┴────┐
    │         │
   YES       NO
    │         │
    ▼         ▼
┌──────────┐ [跳过]
│ 2. 导出  │
│    Markdown│  ← 只导出变化的 (1-10s)
└────┬─────┘
     │
     ▼
┌──────────┐
│ 3. 计算  │
│    hash  │  ← 只计算变化的 (0.1-1s)
└────┬─────┘
     │
     ▼
┌──────────┐
│ 4. 上传  │
│   GitHub │  ← 只上传变化的 (3-30s)
└────┬─────┘
     │
     ▼
┌────────────────────┐
│ 5. 增量扫描资源     │
│  - 获取文件时间戳   │  ← 轻量级查询 (0.5s)
│  - 筛选新增/修改    │
└────────┬───────────┘
         │
         ▼
   有新增/修改？
         │
    ┌────┴────┐
    │         │
   YES       NO
    │         │
    ▼         ▼
┌──────────┐ [跳过]
│ 6. 同步  │
│   资源   │  ← 只同步变化的 (0.5-5s)
└──────────┘
```

### 性能对比总结

#### 场景 1: 日常同步 (1% 文档变化, 0.5% 资源变化)

| 方案 | 文档耗时 | 资源耗时 | 总耗时 | vs当前 |
|-----|---------|---------|--------|-------|
| 当前方案 | 163s | 42.5s | 205.5s | 1× |
| 优化方案 | 11s | 0.5s | 11.5s | **18×** |

**结论:** ✅ 可以每 5-10 分钟同步一次

#### 场景 2: 大量修改 (50% 文档变化, 10% 资源变化)

| 方案 | 文档耗时 | 资源耗时 | 总耗时 | vs当前 |
|-----|---------|---------|--------|-------|
| 当前方案 | 163s | 42.5s | 205.5s | 1× |
| 优化方案 | 60s | 6s | 66s | **3×** |

**结论:** ✅ 即使大量修改，性能仍提升 3 倍

---

## 6. 资源消耗分析

### CPU 占用

**当前方案 (每 60 分钟):**
```
活跃时间: 205.5s / 3600s = 5.7%
峰值占用: 30-50% (导出 Markdown)
平均占用: 2-3%
```

**优化方案 (每 10 分钟):**
```
活跃时间: 11.5s / 600s = 1.9%
峰值占用: 20-30% (只处理变化的)
平均占用: 0.5-1%
```

**结论:** ✅ CPU 占用可忽略

### 内存占用

**当前方案:**
```
并发处理: 5 个文档/资源
单个文档: ~100KB Markdown
峰值内存: 5 × 100KB = 500KB
```

**优化方案:**
```
并发处理: 5 个文档/资源
单个文档: ~100KB Markdown
峰值内存: 5 × 100KB = 500KB
```

**结论:** ✅ 内存占用不变（很低）

### 网络带宽

**当前方案 (10% 文档变化, 1% 资源变化):**
```
上传文档: 200 × 50KB = 10MB
上传资源: 50 × 200KB = 10MB
总流量: 20MB / 小时
```

**优化方案:**
```
上传流量: 相同 (20MB / 小时)
下载流量: 0 (不需要拉取)
```

**结论:** ✅ 带宽占用可忽略

### GitHub API 配额

**GitHub 限制:**
```
认证用户: 5000 requests/hour
```

**当前方案 (10% 变化):**
```
文档上传: 200 requests
资源上传: 50 requests
总计: 250 requests/hour
配额使用: 250 / 5000 = 5%
```

**优化方案 (1% 变化):**
```
文档上传: 20 requests
资源上传: 5 requests
总计: 25 requests/hour
配额使用: 25 / 5000 = 0.5%
```

**结论:** ✅ API 配额充足

---

## 7. 实施建议

### 优先级

1. **P0 - 立即实现**
   - 基于时间戳的增量同步（文档）
   - 基于文件时间戳的增量同步（资源）

2. **P1 - 近期实现**
   - 定时任务调度器
   - 同步进度显示
   - 错误重试机制

3. **P2 - 长期优化**
   - 事件驱动变更队列
   - 智能调度（空闲时同步）
   - 冲突自动解决

### 配置建议

```typescript
interface AutoSyncConfig {
    enabled: boolean;           // 是否启用自动同步
    interval: number;           // 同步间隔（分钟）
    syncDocs: boolean;          // 同步文档
    syncAssets: boolean;        // 同步资源
    onlyWhenIdle: boolean;      // 仅在空闲时同步
    maxConcurrency: number;     // 最大并发数
}

// 推荐配置
{
    enabled: true,
    interval: 10,               // 每 10 分钟
    syncDocs: true,
    syncAssets: true,
    onlyWhenIdle: false,
    maxConcurrency: 5
}
```

---

## 8. 风险评估

### 低风险 ✅

- CPU 占用: < 2%
- 内存占用: < 1MB
- 网络带宽: < 20MB/小时
- GitHub API: < 5% 配额

### 中风险 ⚠️

- **SiYuan API 调用频率**
  - 问题: 频繁调用可能影响 SiYuan 性能
  - 缓解: 增量扫描，只查询元数据

- **缓存文件膨胀**
  - 问题: 长期运行，缓存文件可能变大
  - 缓解: 定期清理旧缓存（保留最近 1000 条）

### 高风险 ❌

- **无**

---

## 9. 总结

### 回答你的问题

> 会不会导致 2000 篇 notes 和 5000 个 assets:
> 1. 全部需要重新导出 markdown
> 2. 全部重新计算 hash
> 3. 全部获取对应在 Github 上的文件的 SHA
> 4. 全部进行比对计算

**当前架构:**
- ❌ 是的，会导致以上问题
- ❌ 每次同步耗时 3.4 分钟
- ❌ 每 10 分钟同步会导致 34% CPU 占用

**优化后架构:**
- ✅ 不会，只处理修改的文档
- ✅ 日常同步耗时 ~11 秒
- ✅ 每 10 分钟同步，CPU 占用 < 2%

### 最终建议

**强烈推荐实施优化方案！**

优化后的架构可以:
- ✅ 每 5-10 分钟自动同步
- ✅ CPU/内存/网络占用可忽略
- ✅ GitHub API 配额充足
- ✅ 性能提升 10-20 倍

**不需要担心性能问题！**
