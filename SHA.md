# GitHub SHA 的作用

## 1. GitHub API 的乐观锁机制

  GitHub Contents API 使用 SHA 作为并发控制的关键：

```ts
  // git.ts 中的逻辑
  async function getFileSha(opts: GitWriteOptions): Promise<string | null> {
    // 获取文件当前的 SHA
    const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/contents/${opts.path}?ref=${opts.branch}`;
    const res = await proxyFetch(url, { method: "GET", ... });
    if (res.status === 404) {
      return null; // 文件不存在
    }
    const data = await res.json();
    return data.sha; // 返回当前文件的 SHA
  }

  export async function createOrUpdateTextFile(opts, content) {
    const sha = await getFileSha(opts); // 先获取现有 SHA
    const body = {
      message: opts.message,
      content: base64FromUtf8(content),
      branch: opts.branch,
      sha: sha ?? undefined, // ⚠️ 必须提供 SHA 来更新已存在的文件
    };
    return await writeFile(opts, body);
  }
```

  工作原理：
  - 创建新文件：sha 为 null，GitHub 创建新文件
  - 更新已存在文件：必须提供正确的 sha，GitHub 验证这是文件的当前版本
  - SHA 不匹配：如果文件在你读取后被修改了，SHA 会不同，GitHub 拒绝更新（返回 409 Conflict）

  这防止了并发覆盖问题：
  时间线：
  T1: 用户A读取文件（SHA: abc123）
  T2: 用户B读取文件（SHA: abc123）
  T3: 用户B更新文件（提供 SHA: abc123）✅ 成功，新 SHA: def456
  T4: 用户A尝试更新（提供 SHA: abc123）❌ 失败！当前 SHA 已是 def456

  ##  2. 缓存 SHA 的性能优化

  没有缓存时的流程（每次 2 个 API 调用）：
  更新文件流程：
  1. GET /repos/owner/repo/contents/path  → 获取当前 SHA
  2. PUT /repos/owner/repo/contents/path  → 使用 SHA 更新文件

  有缓存时的流程（只需 1 个 API 调用）：
  更新文件流程：
  1. 从缓存读取上次的 SHA
  2. PUT /repos/owner/repo/contents/path  → 直接使用缓存的 SHA 更新

  性能提升：
  - 减少 50% 的 API 请求
  - 节省 API rate limit 配额
  - 更快的同步速度

##  3. SHA = "unknown" 的影响

  从你的缓存文件来看：
  ```
  {
      "20241221133029-8eietj4": {
          "githubSHA": "ef32a0177eb36d98ee1cdf38f22391fd709cbd23"  // ✅ 正确
      },
      "20260115171258-ylh7rm6": {
          "githubSHA": "unknown"  // ❌ 无效
      }
  }
```
  当 SHA 是 "unknown" 时：
  async function getFileSha(opts: GitWriteOptions): Promise<string | null> {
    // 即使缓存中有 "unknown"，也无法使用
    // 必须重新 GET 一次来获取真实的 SHA
    const res = await proxyFetch(url, { method: "GET", ... });
    return data.sha;
  }

  后果：
  - ✅ 功能正常：仍然能够更新文件
  - ❌ 性能下降：每次更新都需要额外的 GET 请求
  - ❌ API 配额浪费：双倍的 API 调用

##  4. 为什么之前都是 "unknown"

  根本原因：git.ts 中的函数返回类型错误

```
  修复前（v0.2.x）：
  export async function createOrUpdateTextFile(opts, content): Promise<void> {
    //                                                              ^^^^
    const sha = await getFileSha(opts);
    const body = { message, content: base64FromUtf8(content), branch, sha };
    await writeFile(opts, body); // ❌ 没有 return
  }
  // 调用方收到 undefined
```

``` js
  修复后（v0.3.0）：
  export async function createOrUpdateTextFile(opts, content): Promise<any> {
    //                                                              ^^^
    const sha = await getFileSha(opts);
    const body = { message, content: base64FromUtf8(content), branch, sha };
    return await writeFile(opts, body); // ✅ 返回 GitHub 响应
  }

  async function writeFile(opts, body): Promise<any> {
    const res = await proxyFetch(url, { method: "PUT", body: JSON.stringify(body) });
    const responseData = await res.json();
    return responseData; // GitHub 返回 { content: { sha: "..." }, ... }
  }

  exporter.ts 现在可以正确提取 SHA：
  const uploadResult = await createOrUpdateTextFile(...); // 现在有值了
  let githubSHA: string;
  if (uploadResult && uploadResult.content && uploadResult.content.sha) {
    githubSHA = uploadResult.content.sha; // ✅ 成功提取
  }
  await updateDocCacheEntry(plugin, info.box, usedId, {
    githubSHA: githubSHA, // ✅ 保存到缓存
  });
```

##  5. 总结

  | 场景                  | SHA 来源    | API 调用次数          |
  |---------------------|-----------|-------------------|
  | 首次创建文件              | 不需要 SHA   | 1 次 PUT           |
  | 更新文件（有缓存 SHA）       | 从缓存读取     | 1 次 PUT           |
  | 更新文件（SHA="unknown"） | 必须 GET 获取 | 1 次 GET + 1 次 PUT |
  | 更新文件（无缓存）           | 必须 GET 获取 | 1 次 GET + 1 次 PUT |

  最佳性能：每个文档都有正确的 GitHub SHA 缓存

  当前状态：
  - 第一个文档已有正确 SHA（你刚才测试的）
  - 其他文档还是 "unknown"（旧版本上传的）

  建议：
  1. 运行一次完整同步，让所有文档都更新到最新版本
  2. 所有文档的 SHA 都会被正确保存
  3. 之后的增量同步会更快（减少 50% API 调用）

  