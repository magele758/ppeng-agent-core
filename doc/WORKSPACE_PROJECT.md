# Workspace：多根 Project 与云端 Folder

与 TaskMode（HOW）正交，会话绑定 **WHERE**：默认仓库 / 可复用多根 Project / 可新建的云端 Folder。Lab 选择器在 Play 输入区下方。

## 三种绑定

| kind | 含义 |
|------|------|
| `default` | chat 用 `repoRoot`；task 仍走隔离 workspace（`isolatedWorkspaceRoot ?? repoRoot`） |
| `project` | 命名工程，多个本地根；请求体用 `primary`，落库/回包用 `isPrimary`（bash cwd = 主根） |
| `cloud_folder` | 工作副本在 `stateDir/cloud-folders/<id>/`；配了 S3 则前缀 `cloud-folders/{folderId}/`。运行时唯一根 alias 固定为 `cloud` |

同一会话只能选一种 kind，不能混本地根 + 云端根。

## 会话 metadata（write-once）

```ts
workspaceBinding: { kind: 'default' | 'project' | 'cloud_folder'; projectId?: string; cloudFolderId?: string }
workspaceBindingBound: true  // 仅封印显式 Project / cloud folder（sealWorkspaceBindingPatch），之后不可改
```

`kind: 'default'` **不封印**：选择器保持可改，已有会话上残留的 `workspaceBindingBound` 也不锁定。未封印时 Lab 可 `PATCH /api/sessions/:id` `{ workspaceBinding }`（`null` → `default`）。已封印到 Project / 云端 Folder 且值不同 → **409** `CONFLICT`；同值 PATCH 为空操作。根失效抛 `WORKSPACE_UNAVAILABLE`（**422**），**禁止**静默回退 `repoRoot`。

## HTTP

**校验 / 浏览**

- `POST /api/fs/validate` `{ path }` → 200 `{ ok: true, path }`（realpath）或 400 `{ ok: false, code, message }`
  - `code`：`not_absolute` / `not_found` / `not_directory` / `symlink` / `blocked` / `not_readable` / `not_writable`
- `GET /api/fs/browse?path=` → `{ path, parent?, entries: [{ name, isDir, path }] }`；空 `path` 从 `$HOME`（否则 `cwd`）起；传入路径必须是绝对路径

**Project**

- `GET /api/projects` → `{ projects }`；`GET/PATCH /api/projects/:id` → `{ project }`
- `POST /api/projects` `{ name, roots?: { path, alias?, primary? }[] }` → 201 `{ project }`
- `PATCH` `{ name?, primaryRootId? }`
- `POST /api/projects/:id/roots` `{ path, alias?, primary? }` → 201 `{ root, project }`
- `DELETE .../roots/:rootId` → `{ ok: true, project }`；删最后一个根 → **409**
- `DELETE /api/projects/:id` → `{ ok: true }`
- 根记录：`{ id, projectId, alias, path, isPrimary }`

**Cloud folder**

- `GET /api/cloud-folders` → `{ folders }`；`GET /api/cloud-folders/:id` → `{ folder }`
- `POST /api/cloud-folders` `{ name }` → 201 `{ folder }`（`backend: 's3'|'local'`、`localPath`、`s3Prefix`）
- `DELETE /api/cloud-folders/:id` → `{ ok: true }`（清本地缓存，见下）

浏览器没有原生选夹器：路径输入 + browse/validate。Lab 解析器兼容旧字段（`realPath` / `kind`），**契约以本节为准**。

## 路径（运行时）

| 入参 | 解析 |
|------|------|
| `@frontend/src/App.tsx` | alias + 相对路径 |
| `src/App.tsx` | primary 根 |
| `/abs/...` | 必须落在某一已授权根的 realpath 下，否则 `Path escapes workspace` |

## Lab

Composer **工作区**：默认 / 已有 Project / 新建 Project（多根：路径 + 浏览 + 校验；第一个根标 `primary`）/ 已有云端 Folder / 新建云端 Folder（只填名字）。已封印只读展示根列表。任一根 `POST /api/fs/validate` 失败则**禁用发送**，提示换 Project 或改回默认（已封印则请新开会话）。**不会**静默回退仓库根。

删除会话不删用户本地 Project 根；云端 Folder 实体保留。

## 已知限制

- `write_file` / `edit_file` / notebook 写会 `persistCloudFolderAfterWrite`；**`bash` 写入不会自动回传到 S3**。
- `DELETE /api/cloud-folders/:id` 只删 SQLite 行 + 本地缓存目录，**不删 S3 对象**。
- `POST /api/bots/:id/open` 不带 `workspaceBinding`；已有 Bot 会话的 `/messages`、`/stream` 也不会从 body 写入绑定。非默认工作区需之后再 `PATCH`（首轮封印前）。
