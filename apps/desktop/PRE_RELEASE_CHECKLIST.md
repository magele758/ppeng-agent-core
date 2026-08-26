# Desktop Client - Pre-Release Checklist

在分发 DMG 文件给用户前，请完成以下检查：

## 构建前检查

- [ ] 确认 Node.js 版本 >= 22
- [ ] 确认 macOS 版本 >= 11.0
- [ ] 确认至少 4GB 可用磁盘空间
- [ ] 已安装 Xcode Command Line Tools：`xcode-select --install`
- [ ] 根目录 `.env.example` 包含最新的配置说明
- [ ] `apps/desktop/assets/icon.svg` 图标设计确认

## 构建检查

- [ ] `npm run build` 成功完成（无错误）
- [ ] `apps/web-console/npm run build` 生成 standalone 产物
- [ ] `node scripts/prepare-desktop-server.mjs` 成功装配 server-bundle
- [ ] `apps/desktop/npm run dist` 生成 DMG 文件
- [ ] DMG 文件大小合理（预期 150-250MB）

## 功能测试

### 安装测试

- [ ] DMG 文件可以正常挂载
- [ ] 拖拽到 Applications 正常工作
- [ ] 首次启动能绕过 Gatekeeper（右键 → 打开）
- [ ] 应用图标正确显示

### 启动测试

- [ ] 应用能正常启动（5-10 秒内）
- [ ] 托盘图标正常显示
- [ ] 主窗口正常打开并加载 Web Console
- [ ] 无明显错误弹窗

### 配置测试

- [ ] 托盘 → "Open Config (.env)" 能打开配置文件
- [ ] 配置文件路径正确：`~/Library/Application Support/agent-desktop/.env`
- [ ] 首次打开会从 `.env.example` 复制模板
- [ ] 修改配置后能保存
- [ ] 托盘 → "Restart Services" 能重启服务

### 功能测试

- [ ] 能创建新会话
- [ ] 能发送消息（需配置有效的 API Key）
- [ ] 工具调用正常显示
- [ ] 审批流程正常工作
- [ ] 文件读写功能正常
- [ ] bash 命令执行正常
- [ ] 沙箱模式正常工作（`RAW_AGENT_SANDBOX_MODE=auto`）

### 状态管理

- [ ] 托盘 → "Open State Directory" 能打开数据目录
- [ ] SQLite 数据库文件存在且可访问
- [ ] 关闭窗口后应用在后台运行
- [ ] 重新打开窗口能恢复状态
- [ ] 窗口大小和位置能记住

### 退出测试

- [ ] 托盘 → "Quit" 能正常退出
- [ ] daemon 和 web 进程被正确终止
- [ ] 无僵尸进程残留：`ps aux | grep "Raw Agent"`

## 性能测试

- [ ] 启动时间 < 10 秒
- [ ] 内存占用合理（< 500MB 空闲时）
- [ ] CPU 占用合理（< 5% 空闲时）
- [ ] 磁盘占用合理（state 目录 < 100MB 新安装）

## 兼容性测试

### macOS 版本

- [ ] macOS 14 (Sonoma)
- [ ] macOS 13 (Ventura)
- [ ] macOS 12 (Monterey)
- [ ] macOS 11 (Big Sur)

### 芯片架构

- [ ] Apple M1
- [ ] Apple M2
- [ ] Apple M3

## 安全测试

- [ ] 沙箱模式能阻止访问 ~/.ssh
- [ ] 沙箱模式能阻止访问 ~/.aws
- [ ] 审批流程能拦截文件删除操作
- [ ] 配置文件权限正确（600）
- [ ] SQLite 数据库权限正确（600）

## 文档检查

- [ ] `README.md` 包含桌面客户端说明
- [ ] `apps/desktop/README.md` 内容完整
- [ ] `apps/desktop/USER_GUIDE.md` 面向用户
- [ ] `apps/desktop/ARCHITECTURE.md` 面向开发者
- [ ] `apps/desktop/QUICK_START.md` 快速参考
- [ ] 所有文档链接有效
- [ ] 截图和示例最新

## 发布前

- [ ] 版本号正确（`apps/desktop/package.json`）
- [ ] CHANGELOG.md 更新（如果有）
- [ ] 已测试清洁安装（删除旧的 agent-desktop 目录）
- [ ] 已测试升级安装（覆盖旧版本）
- [ ] 准备好 Release Notes

## 可选（生产环境）

- [ ] 已签名：Apple Developer ID Application
- [ ] 已公证：`xcrun notarytool`
- [ ] 已装订：`xcrun stapler`
- [ ] 启用自动更新：electron-updater
- [ ] 配置更新服务器：GitHub Releases

## 分发

- [ ] DMG 文件重命名清晰：`RawAgent-0.1.0-macOS-arm64.dmg`
- [ ] 生成 SHA256 校验和：`shasum -a 256 *.dmg`
- [ ] 上传到分发平台（GitHub Releases / CDN）
- [ ] 提供下载链接和安装说明
- [ ] 准备好技术支持渠道

## 用户反馈

收集并记录：

- [ ] 安装问题
- [ ] 启动问题
- [ ] 性能问题
- [ ] 兼容性问题
- [ ] 功能请求

## 回归测试（更新后）

每次更新都重新执行：

- [ ] 安装测试
- [ ] 启动测试
- [ ] 核心功能测试
- [ ] 升级安装测试（从上一版本）

## 紧急回滚计划

如果发现重大问题：

1. [ ] 立即下架 DMG 文件
2. [ ] 发布紧急公告
3. [ ] 提供回滚到上一版本的说明
4. [ ] 修复问题并重新测试
5. [ ] 发布修复版本

---

## 测试命令

```bash
# 构建
npm run build:desktop

# 安装测试
open apps/desktop/release/mac-arm64/Raw\ Agent.app

# 查看日志
/Applications/Raw\ Agent.app/Contents/MacOS/Raw\ Agent

# 检查进程
ps aux | grep "Raw Agent"

# 检查端口（默认 daemon 37070 / web 33815；实际生效端口见 config.json）
lsof -i :37070
lsof -i :33815

# 清理测试环境
rm -rf ~/Library/Application\ Support/agent-desktop

# 生成校验和
shasum -a 256 apps/desktop/release/*.dmg
```

## 报告模板

```markdown
## 测试报告

**版本**：0.1.0
**构建日期**：YYYY-MM-DD
**测试人**：Your Name
**测试环境**：
- macOS: 14.2
- 芯片: M1
- 内存: 16GB

### 测试结果

- ✅ 安装测试通过
- ✅ 启动测试通过
- ✅ 功能测试通过
- ⚠️ 性能测试：启动时间 12 秒（超出预期）
- ❌ 兼容性测试：macOS 11 启动失败

### 已知问题

1. macOS 11 启动时提示缺少 xxx 库
2. 内存占用偏高（600MB）
3. 托盘图标在暗色模式下不清晰

### 建议

1. 优化启动流程
2. 减少内存占用
3. 适配暗色模式图标
4. 添加 macOS 11 兼容性修复

### 是否可以发布

- [ ] 可以发布
- [x] 需要修复后发布
- [ ] 不推荐发布
```

---

**记住**：用户体验 > 功能完整性。宁可晚几天发布一个稳定版本，也不要发布一个充满 bug 的版本。
