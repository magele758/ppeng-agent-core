import { app, BrowserWindow, Tray, Menu, shell, dialog, utilityProcess, UtilityProcess } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// 统一 userData 目录名（否则会用 package.json 的 scoped 名 @ppeng/agent-desktop）
app.setName('agent-desktop');

interface StoreSchema {
  windowBounds: {
    width: number;
    height: number;
    x?: number;
    y?: number;
  };
  daemonPort: number;
  webPort: number;
}

/** 极简 JSON 文件配置存储（避免 electron-store v10 的 ESM/CJS 不兼容） */
class JsonStore {
  private filePath: string;
  private data: StoreSchema;
  constructor(defaults: StoreSchema) {
    this.filePath = path.join(app.getPath('userData'), 'config.json');
    this.data = { ...defaults };
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = { ...defaults, ...JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) };
      }
    } catch {
      // 损坏的配置：回退到默认值
    }
  }
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K] {
    return this.data[key];
  }
  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void {
    this.data[key] = value;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('[Store] Failed to persist config:', err);
    }
  }
}

let _store: JsonStore | null = null;
function getStore(): JsonStore {
  if (!_store) {
    _store = new JsonStore({
      windowBounds: { width: 1400, height: 900 },
      daemonPort: 7070,
      webPort: 13000
    });
  }
  return _store;
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let daemonProcess: UtilityProcess | null = null;
let webProcess: UtilityProcess | null = null;

const isDev = !app.isPackaged;
const DAEMON_PORT = 7070;
const WEB_PORT = 13000;

// 获取资源路径
function getResourcePath(...segments: string[]): string {
  if (isDev) {
    return path.join(process.cwd(), '..', '..', ...segments);
  }
  return path.join(process.resourcesPath, ...segments);
}

// daemon 入口（开发时直接用 apps/daemon/dist，打包后用 server-bundle）
function getDaemonEntry(): string {
  if (isDev) {
    return path.join(process.cwd(), '..', 'daemon', 'dist', 'server.js');
  }
  return getResourcePath('server-bundle', 'apps', 'daemon', 'dist', 'server.js');
}

// web console 入口（standalone 产物）
function getWebEntry(): { entry: string; cwd: string } {
  if (isDev) {
    const cwd = path.join(process.cwd(), '..', 'web-console', '.next', 'standalone');
    return { entry: path.join(cwd, 'apps', 'web-console', 'server.js'), cwd };
  }
  const cwd = getResourcePath('web');
  return { entry: path.join(cwd, 'apps', 'web-console', 'server.js'), cwd };
}

// 获取状态目录
function getStateDir(): string {
  const stateDir = path.join(app.getPath('userData'), 'state');
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  return stateDir;
}

// 启动 Daemon
async function startDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    const daemonPath = getDaemonEntry();
    const stateDir = getStateDir();
    
    console.log('[Daemon] Starting daemon from:', daemonPath);
    console.log('[Daemon] State directory:', stateDir);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      RAW_AGENT_STATE_DIR: stateDir,
      RAW_AGENT_DAEMON_HOST: '127.0.0.1',
      RAW_AGENT_DAEMON_PORT: String(DAEMON_PORT),
      NODE_ENV: 'production'
    };

    // 读取用户的 .env 配置
    const userEnvPath = path.join(app.getPath('userData'), '.env');
    if (fs.existsSync(userEnvPath)) {
      console.log('[Daemon] Loading user .env from:', userEnvPath);
      const envContent = fs.readFileSync(userEnvPath, 'utf-8');
      envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const [, key, value] = match;
          env[key.trim()] = value.trim();
        }
      });
    }

    daemonProcess = utilityProcess.fork(daemonPath, [], {
      env: { ...env } as Record<string, string>,
      stdio: 'pipe'
    });

    daemonProcess.stdout?.on('data', (data: Buffer) => {
      console.log('[Daemon]', data.toString().trim());
    });

    daemonProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[Daemon Error]', data.toString().trim());
    });

    daemonProcess.on('exit', (code: number) => {
      console.log('[Daemon] Exited with code:', code);
      daemonProcess = null;
    });

    // 轮询健康检查等待 daemon 启动
    let attempts = 0;
    const maxAttempts = 30;
    const checkHealth = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${DAEMON_PORT}/api/health`, {
          signal: AbortSignal.timeout(1000)
        });
        if (res.ok) {
          console.log('[Daemon] Health check OK');
          resolve();
          return true;
        }
      } catch (err) {
        // 预期：连接拒绝或超时
      }
      attempts++;
      if (attempts >= maxAttempts) {
        reject(new Error('Daemon health check timeout'));
        return true;
      }
      setTimeout(checkHealth, 500);
      return false;
    };
    setTimeout(checkHealth, 1000);
  });
}

// 启动 Web Console
async function startWebConsole(): Promise<void> {
  return new Promise((resolve, reject) => {
    const { entry: webPath, cwd: webCwd } = getWebEntry();
    
    console.log('[Web] Starting web console from:', webPath);

    const env = {
      ...process.env,
      PORT: String(WEB_PORT),
      DAEMON_PROXY_TARGET: `http://127.0.0.1:${DAEMON_PORT}`,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1'
    };

    webProcess = utilityProcess.fork(webPath, [], {
      env: { ...env } as Record<string, string>,
      cwd: webCwd,
      stdio: 'pipe'
    });

    webProcess.stdout?.on('data', (data: Buffer) => {
      console.log('[Web]', data.toString().trim());
    });

    webProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[Web Error]', data.toString().trim());
    });

    webProcess.on('exit', (code: number) => {
      console.log('[Web] Exited with code:', code);
      webProcess = null;
    });

    // 轮询检查 web 启动
    let attempts = 0;
    const maxAttempts = 30;
    const checkWeb = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${WEB_PORT}/`, {
          signal: AbortSignal.timeout(1000)
        });
        if (res.ok || res.status === 404) {
          console.log('[Web] Server responding');
          resolve();
          return true;
        }
      } catch (err) {
        // 预期：连接拒绝或超时
      }
      attempts++;
      if (attempts >= maxAttempts) {
        reject(new Error('Web console startup timeout'));
        return true;
      }
      setTimeout(checkWeb, 500);
      return false;
    };
    setTimeout(checkWeb, 1000);
  });
}

// 停止所有进程
function stopAllProcesses(): void {
  if (webProcess) {
    console.log('[Web] Stopping...');
    webProcess.kill();
    webProcess = null;
  }
  if (daemonProcess) {
    console.log('[Daemon] Stopping...');
    daemonProcess.kill();
    daemonProcess = null;
  }
}

// 创建主窗口
async function createWindow(): Promise<void> {
  const bounds = getStore().get('windowBounds');

  mainWindow = new BrowserWindow({
    ...bounds,
    title: 'Agent Home',
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'default',
    show: false
  });

  // 锁定窗口标题，避免网页 <title> 覆盖成 “Agent Lab · Debug Console” 之类
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  // 保存窗口尺寸
  mainWindow.on('close', () => {
    if (mainWindow) {
      getStore().set('windowBounds', mainWindow.getBounds());
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 打开外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  try {
    // 启动后端服务
    await startDaemon();
    await startWebConsole();

    // 加载 Web Console
    const webUrl = `http://127.0.0.1:${WEB_PORT}`;
    console.log('[Main] Loading:', webUrl);
    await mainWindow.loadURL(webUrl);

    mainWindow.show();
  } catch (error) {
    console.error('[Main] Failed to start services:', error);
    dialog.showErrorBox(
      'Startup Failed',
      `Failed to start Raw Agent services:\n\n${error}`
    );
    app.quit();
  }
}

// 创建托盘图标
function createTray(): void {
  // 使用简单的模板图标（需要后续添加图标文件）
  const iconPath = path.join(__dirname, '../assets/trayTemplate.png');
  
  // 如果图标不存在，创建一个临时的
  if (!fs.existsSync(iconPath)) {
    console.log('[Tray] Icon not found, using default');
  }

  try {
    tray = new Tray(iconPath);
  } catch {
    // Fallback: 不创建托盘图标
    console.log('[Tray] Could not create tray icon');
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Raw Agent',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Open State Directory',
      click: () => {
        shell.openPath(getStateDir());
      }
    },
    {
      label: 'Open Config (.env)',
      click: () => {
        const envPath = path.join(app.getPath('userData'), '.env');
        if (!fs.existsSync(envPath)) {
          const templatePath = getResourcePath('.env.example');
          if (fs.existsSync(templatePath)) {
            fs.copyFileSync(templatePath, envPath);
          } else {
            fs.writeFileSync(envPath, '# Raw Agent Configuration\n');
          }
        }
        shell.openPath(envPath);
      }
    },
    { type: 'separator' },
    {
      label: 'Restart Services',
      click: async () => {
        stopAllProcesses();
        if (mainWindow) {
          try {
            await startDaemon();
            await startWebConsole();
            mainWindow.reload();
          } catch (error) {
            console.error('[Tray] Restart failed:', error);
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Raw Agent');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// App 生命周期
app.whenReady().then(async () => {
  console.log('[App] Ready, starting...');
  console.log('[App] User data:', app.getPath('userData'));
  console.log('[App] Is packaged:', app.isPackaged);

  createTray();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // macOS 上保持后台运行
  // 不调用 app.quit()
});

app.on('before-quit', () => {
  console.log('[App] Quitting, stopping services...');
  stopAllProcesses();
});

app.on('will-quit', () => {
  stopAllProcesses();
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('[Process] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection:', reason);
});
