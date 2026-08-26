# Desktop Client - Quick Reference

## 一键构建

```bash
# 从仓库根目录运行
npm run build:desktop
```

输出位置：`apps/desktop/release/Raw Agent-0.1.0-arm64.dmg`

## 前置条件

✅ Node.js >= 22  
✅ macOS（构建 macOS 应用）  
✅ 至少 4GB 可用磁盘空间  

## 构建步骤（详细）

```bash
# 1. 安装依赖
npm install

# 2. 构建核心包
npm run build

# 3. 构建 Web Console（standalone 模式）
cd apps/web-console
npm run build
cd ../..

# 4. 装配服务端 bundle
node scripts/prepare-desktop-server.mjs

# 5. 构建桌面应用
cd apps/desktop
npm install
npm run dist
```

## 开发模式

```bash
# 先构建核心包和 Web Console
npm run build
cd apps/web-console && npm run build && cd ../..

# 运行桌面应用（开发模式）
cd apps/desktop
npm install
npm run dev
```

## 输出文件

```
apps/desktop/release/
├── Raw Agent-0.1.0-arm64.dmg          # 用户分发
├── Raw Agent-0.1.0-arm64-mac.zip      # 备用格式
└── mac-arm64/Raw Agent.app/           # 未签名应用
```

## 常见错误

### 错误：找不到 apps/daemon/dist

**原因**：未运行 `npm run build`

**解决**：
```bash
npm run build
```

### 错误：找不到 .next/standalone

**原因**：Web Console 未构建

**解决**：
```bash
cd apps/web-console
npm run build
cd ../..
```

### 错误：Node 版本过低

**原因**：项目需要 Node 22+（`node:sqlite` 支持）

**解决**：
```bash
# 升级 Node（推荐使用 nvm）
nvm install 22
nvm use 22
```

### 错误：electron-builder 失败

**原因**：缺少 Xcode Command Line Tools

**解决**：
```bash
xcode-select --install
```

## 测试

### 快速测试

```bash
# 构建后手动运行
open apps/desktop/release/mac-arm64/Raw\ Agent.app
```

### 测试配置

1. 首次运行
2. 点击托盘图标 → "Open Config (.env)"
3. 添加模型配置：
   ```bash
   RAW_AGENT_MODEL_PROVIDER=openai-compatible
   RAW_AGENT_MODEL_NAME=gpt-4
   RAW_AGENT_API_KEY=your-key
   RAW_AGENT_BASE_URL=https://api.openai.com/v1
   ```
4. 托盘 → "Restart Services"
5. 创建新会话测试

## 分发

### DMG 文件

```bash
# 分享给用户
cp apps/desktop/release/Raw\ Agent-0.1.0-arm64.dmg ~/Desktop/
```

用户安装步骤：
1. 双击 DMG
2. 拖拽到 Applications
3. 首次运行时右键 → 打开（绕过 Gatekeeper）

### 签名（可选）

需要 Apple Developer 账号和证书：

```bash
# 1. 配置 package.json
"build": {
  "mac": {
    "identity": "Developer ID Application: Your Name (TEAM_ID)"
  }
}

# 2. 构建会自动签名
npm run build:desktop

# 3. 公证
xcrun notarytool submit \
  --apple-id your@email.com \
  --password @keychain:AC_PASSWORD \
  --team-id TEAM_ID \
  --wait \
  apps/desktop/release/Raw\ Agent-0.1.0-arm64.dmg

# 4. 装订公证票据
xcrun stapler staple apps/desktop/release/Raw\ Agent-0.1.0-arm64.dmg
```

## 清理

```bash
# 清理构建产物
rm -rf apps/desktop/dist
rm -rf apps/desktop/release
rm -rf apps/desktop/server-bundle
rm -rf apps/desktop/node_modules
```

## 性能优化

### 减小包体积

1. **排除开发依赖**（已实现）
2. **排除可选依赖**：
   ```bash
   # 在 prepare-desktop-server.mjs 中
   npm install --omit=dev --omit=optional
   ```
3. **压缩 node_modules**：
   ```bash
   # 使用 electron-builder 的 asar（需要解决 sqlite 写入问题）
   ```

### 加速构建

1. **增量构建**：不清理 `dist/`，只重新编译修改的文件
2. **并行编译**：`tsc -b --force` 改为 `tsc -b`
3. **跳过图标生成**：图标只需生成一次

## 文档

- **用户指南**：`apps/desktop/USER_GUIDE.md`
- **架构说明**：`apps/desktop/ARCHITECTURE.md`
- **README**：`apps/desktop/README.md`

## 故障排查

### 应用无法启动

```bash
# 查看日志
/Applications/Raw\ Agent.app/Contents/MacOS/Raw\ Agent
```

### 端口冲突

默认端口跟随 Lab（daemon `37070` / web `33815`）；占用时应用会自动探测递增并写回本地
`config.json`，一般无需手动处理。如需固定指定端口：

```bash
# 检查端口占用
lsof -i :37070
lsof -i :33815

# 修改配置
open ~/Library/Application\ Support/agent-desktop/.env
# 添加：
# RAW_AGENT_DAEMON_PORT=7071
# RAW_AGENT_WEB_PORT=13001
```

### 重置应用

```bash
# 删除配置和数据（谨慎！）
rm -rf ~/Library/Application\ Support/agent-desktop
```

## 快速命令

```bash
# 完整构建流程
npm run build:desktop

# 仅重新打包（跳过 build）
cd apps/desktop && npm run dist

# 生成 DMG 和 ZIP
cd apps/desktop && npm run dist:dmg

# 开发模式
cd apps/desktop && npm run dev

# 清理构建产物
rm -rf apps/desktop/{dist,release,server-bundle}
```

## 支持

- 技术问题：查看 `ARCHITECTURE.md`
- 用户问题：查看 `USER_GUIDE.md`
- 构建问题：查看 `README.md`
