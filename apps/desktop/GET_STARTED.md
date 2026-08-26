# 开始使用 Raw Agent Desktop

## 快速开始（3 分钟）

### 1. 构建桌面应用

```bash
# 从仓库根目录运行
npm run build:desktop
```

这会：
- ✅ 生成应用图标
- ✅ 编译所有 TypeScript 代码
- ✅ 构建 Next.js Web Console
- ✅ 打包服务端依赖
- ✅ 生成 DMG 安装文件

**输出位置**：`apps/desktop/release/Raw Agent-0.1.0-arm64.dmg`

**预计时间**：5-10 分钟（首次构建）

### 2. 安装应用

```bash
# 打开 DMG
open apps/desktop/release/Raw\ Agent-0.1.0-arm64.dmg

# 或者直接运行（开发测试）
open apps/desktop/release/mac-arm64/Raw\ Agent.app
```

首次运行：
1. 右键点击应用
2. 选择"打开"（绕过 Gatekeeper）
3. 点击"打开"确认

### 3. 配置 API Key

1. 应用启动后，点击**菜单栏的托盘图标**
2. 选择 **"Open Config (.env)"**
3. 在打开的文本文件中添加：

```bash
# OpenAI
RAW_AGENT_MODEL_PROVIDER=openai-compatible
RAW_AGENT_MODEL_NAME=gpt-4
RAW_AGENT_API_KEY=sk-your-key-here
RAW_AGENT_BASE_URL=https://api.openai.com/v1

# 或者 Anthropic Claude
RAW_AGENT_MODEL_PROVIDER=anthropic-compatible
RAW_AGENT_MODEL_NAME=claude-3-5-sonnet-20241022
RAW_AGENT_API_KEY=sk-ant-your-key-here
RAW_AGENT_ANTHROPIC_URL=https://api.anthropic.com
```

4. 保存文件
5. 托盘图标 → **"Restart Services"**

### 4. 开始使用

应用会自动打开 Web 界面，你可以：
- 创建新会话（"New Session"）
- 与 Agent 对话
- 查看工具调用和思考过程
- 管理多个会话

## 托盘菜单

点击菜单栏的托盘图标：

- **Show Raw Agent**：显示/隐藏主窗口
- **Open State Directory**：查看数据库和日志
- **Open Config (.env)**：编辑配置
- **Restart Services**：重启后端服务
- **Quit**：退出应用

## 常见问题

### Q: 应用启动失败怎么办？

**A:** 从终端运行查看详细日志：
```bash
/Applications/Raw\ Agent.app/Contents/MacOS/Raw\ Agent
```

常见原因：
- API Key 未配置或无效
- 端口被占用（默认 daemon 37070 / web 33815，占用时会自动探测递增并写回配置）
- Node 版本不兼容（需要 22+）

### Q: 如何查看日志？

**A:** 托盘 → "Open State Directory" → `logs/` 文件夹

或者：
```bash
open ~/Library/Application\ Support/agent-desktop/state/logs/
```

### Q: 如何重置应用？

**A:** 删除配置和数据（会丢失所有会话）：
```bash
rm -rf ~/Library/Application\ Support/agent-desktop
```

### Q: 端口冲突怎么办？

**A:** 编辑配置文件：
```bash
open ~/Library/Application\ Support/agent-desktop/.env
```

添加：
```bash
RAW_AGENT_DAEMON_PORT=7071  # 改为其他端口
```

然后重启服务。

### Q: 如何卸载？

**A:** 
```bash
# 1. 退出应用（托盘 → Quit）
# 2. 删除应用
rm -rf /Applications/Raw\ Agent.app
# 3. （可选）删除数据
rm -rf ~/Library/Application\ Support/agent-desktop
```

## 开发模式

如果你要修改代码：

```bash
# 1. 构建一次（生成 daemon 和 web）
npm run build
cd apps/web-console && npm run build && cd ../..

# 2. 进入桌面目录
cd apps/desktop

# 3. 安装依赖
npm install

# 4. 运行开发模式
npm run dev
```

修改 `src/main.ts` 后需要重新运行 `npm run dev`。

## 分发给用户

```bash
# 1. 构建 DMG
npm run build:desktop

# 2. 找到 DMG 文件
ls -lh apps/desktop/release/*.dmg

# 3. 分享给用户
# 用户只需下载 DMG，双击安装即可
```

**注意**：未签名的应用需要用户右键 → 打开。

生产环境建议：
- 申请 Apple Developer 账号
- 代码签名和公证
- 配置自动更新

## 下一步

### 用户文档

- 📖 完整用户指南：`apps/desktop/USER_GUIDE.md`
- 🎯 快速参考：`apps/desktop/QUICK_START.md`

### 开发者文档

- 🏗️ 架构详解：`apps/desktop/ARCHITECTURE.md`
- 📋 实现总结：`apps/desktop/IMPLEMENTATION_SUMMARY.md`
- ✅ 发布检查：`apps/desktop/PRE_RELEASE_CHECKLIST.md`

### 改进方向

1. **代码签名**（生产必需）
2. **自动更新**（electron-updater）
3. **跨平台支持**（Windows/Linux）
4. **性能优化**（减小包体积）
5. **用户体验**（更好的错误提示）

## 获取帮助

- 💬 问题反馈：提交 GitHub Issue
- 📚 查看文档：`apps/desktop/` 目录下的 Markdown 文件
- 🔍 查看日志：托盘 → Open State Directory → logs/

---

**祝你使用愉快！** 🎉

有任何问题或建议，欢迎反馈。
