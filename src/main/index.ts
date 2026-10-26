import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { spawn, exec } from 'node:child_process'
import { openSync, mkdirSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProcessManager } from './processManager'
import { JsonStore, servicesFile, defaultLogFile } from './store'
import type { ServiceConfig } from '@shared/types'

app.setName('toolsDesktopMg')

let mainWindow: BrowserWindow | null = null
let processManager: ProcessManager
let serviceStore: JsonStore<ServiceConfig[]>
/** 执行中的一次性动作（key = serviceId:actionName），防止并发重复执行 */
const runningActions = new Set<string>()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'ToolsDesktopMg',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 外部链接一律走系统浏览器，不在应用内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  const userDataDir = app.getPath('userData')
  processManager = new ProcessManager(userDataDir)
  serviceStore = new JsonStore<ServiceConfig[]>(servicesFile(userDataDir))

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc(): void {
  ipcMain.handle('services:list', () => serviceStore.load([]))

  /** 从项目配置文件识别 dev server 端口（vite.config / vue.config / .env） */
  ipcMain.handle('services:detectPorts', async (_e, workDir: string) => {
    return detectPortsFromProject(workDir)
  })

  ipcMain.handle('services:add', (_e, config: Omit<ServiceConfig, 'id'>) => {
    const services = serviceStore.load([])
    const created: ServiceConfig = { ...config, id: randomUUID() }
    serviceStore.save([...services, created])
    return created
  })

  ipcMain.handle('services:update', (_e, config: ServiceConfig) => {
    const services = serviceStore.load([])
    const idx = services.findIndex((s) => s.id === config.id)
    if (idx === -1) throw new Error('服务不存在')
    services[idx] = config
    serviceStore.save(services)
    return config
  })

  ipcMain.handle('services:delete', (_e, id: string) => {
    const services = serviceStore.load([])
    serviceStore.save(services.filter((s) => s.id !== id))
  })

  ipcMain.handle('service:start', async (_e, id: string) => {
    const cfg = mustGet(id)
    const logFile = cfg.logPath?.trim() || defaultLogFile(app.getPath('userData'))
    const pid = await processManager.start(cfg, logFile)
    return { pid, logFile }
  })

  ipcMain.handle('service:stop', async (_e, id: string) => {
    await processManager.stop(mustGet(id))
  })

  ipcMain.handle('service:forceStop', async (_e, id: string) => {
    await processManager.forceStop(mustGet(id))
  })

  ipcMain.handle('service:status', async (_e, id: string) => {
    return processManager.status(mustGet(id))
  })

  ipcMain.handle('service:openLog', async (_e, id: string) => {
    const cfg = mustGet(id)
    const logFile = cfg.logPath?.trim() || defaultLogFile(app.getPath('userData'))
    await shell.openPath(logFile)
  })

  /** 执行一次性动作（npm install / npm run test 等），输出追加到日志，退出码返回 */
  ipcMain.handle(
    'service:runAction',
    async (_e, id: string, actionName: string) => {
      const cfg = mustGet(id)
      const action = cfg.actions?.find((a) => a.name === actionName)
      if (!action) throw new Error(`动作「${actionName}」不存在`)
      const key = `${id}:${actionName}`
      if (runningActions.has(key)) throw new Error(`「${actionName}」正在执行中，请稍候`)

      const logFile = cfg.logPath?.trim() || defaultLogFile(app.getPath('userData'))
      mkdirSync(dirname(logFile), { recursive: true })
      const out = openSync(logFile, 'a')
      appendFileSync(
        out,
        `\n===== [${new Date().toLocaleString()}] ${actionName}: ${action.command} =====\n`
      )

      runningActions.add(key)
      return new Promise<{ ok: boolean; code: number | null }>((resolve) => {
        const child = spawn('/bin/zsh', ['-lc', action.command], {
          cwd: cfg.workDir || undefined,
          stdio: ['ignore', out, out]
        })
        child.on('exit', (code) => {
          runningActions.delete(key)
          resolve({ ok: code === 0, code })
        })
        child.on('error', (err) => {
          runningActions.delete(key)
          resolve({ ok: false, code: -1 })
          console.error(`[runAction] ${actionName} 执行失败:`, err)
        })
      })
    }
  )

  ipcMain.handle('service:openTerminal', async (_e, id: string) => {
    const cfg = mustGet(id)
    if (!cfg.workDir) throw new Error('未配置工作目录')
    // open -a Terminal <dir>：在 Terminal.app 中打开工作目录
    await execShell(`open -a Terminal "${cfg.workDir}"`)
  })
}

function mustGet(id: string): ServiceConfig {
  const found = serviceStore.load([]).find((s) => s.id === id)
  if (!found) throw new Error('服务不存在')
  return found
}

const PORT_CONFIG_FILES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vue.config.js',
  'vue.config.cjs',
  '.env',
  '.env.development',
  '.env.local'
]

/** 正则扫描项目配置文件中的 dev server 端口声明 */
async function detectPortsFromProject(workDir: string): Promise<number[]> {
  const { readFile, readdir } = await import('node:fs/promises')
  const ports = new Set<number>()
  let files: string[]
  try {
    const all = await readdir(workDir)
    files = PORT_CONFIG_FILES.filter((f) => all.includes(f))
  } catch {
    throw new Error('工作目录不存在或不可读取')
  }

  for (const file of files) {
    try {
      const content = await readFile(join(workDir, file), 'utf-8')
      // vite: server: { port: 5173 } / vue-cli: devServer: { port: 8080 }
      for (const m of content.matchAll(/\bport\s*[:=]\s*['"]?(\d{2,5})['"]?/gi)) {
        addPort(ports, m[1])
      }
      // .env: VITE_PORT=xxxx / PORT=xxxx
      for (const m of content.matchAll(/^(?:VITE_)?PORT\s*=\s*(\d{2,5})\s*$/gm)) {
        addPort(ports, m[1])
      }
    } catch {
      /* 单个文件读取失败忽略 */
    }
  }
  return [...ports].sort((a, b) => a - b)
}

function addPort(ports: Set<number>, raw: string): void {
  const port = Number(raw)
  if (Number.isInteger(port) && port >= 1 && port <= 65535) ports.add(port)
}

function execShell(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}
