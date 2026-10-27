import { spawn, execFile } from 'node:child_process'
import { openSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import type { ProcessStat, ServiceConfig, ServiceStatus } from '@shared/types'
import { JsonStore, pidsFile } from './store'
import { shellEnv } from './shellEnv'

const execFileAsync = promisify(execFile)

const TERM_GRACE_MS = 10_000 // 优雅停止等待时长，超时升级 SIGKILL

/**
 * 进程管理器：负责服务的启动/停止/强杀/状态检测。
 *
 * 策略说明：
 * - 启动通过 /bin/zsh -lc 执行，detached 建立独立进程组，输出重定向到日志文件
 * - 很多中间件（tomcat/nacos 的 startup.sh）会派生 java 子进程后脚本自身退出，
 *   因此停止与状态检测不依赖单一 PID，而是 pgrep -f 按 executablePath/workDir 模式匹配整个进程树
 * - PID 记录持久化到 pids.json，应用重启后仍可管理之前拉起的进程
 */
export class ProcessManager {
  /** 服务 id -> 记录的主 PID（可能是壳脚本，已退出则靠 pgrep 兜底） */
  private pids = new Map<string, number>()
  private pidStore: JsonStore<Record<string, number>>

  constructor(userDataDir: string) {
    this.pidStore = new JsonStore(pidsFile(userDataDir))
    this.pids = new Map(Object.entries(this.pidStore.load({})))
  }

  private persistPids(): void {
    this.pidStore.save(Object.fromEntries(this.pids))
  }

  async start(cfg: ServiceConfig, logFile: string): Promise<number> {
    if (this.pids.has(cfg.id)) {
      const alive = await this.findPids(cfg)
      if (alive.length > 0) throw new Error('服务已在运行')
      this.pids.delete(cfg.id) // 记录的进程已死，清理陈旧记录
    }

    const out = this.openSyncLog(logFile)
    const child = spawn('/bin/zsh', ['-lc', cfg.startCommand], {
      cwd: cfg.workDir || undefined,
      detached: true,
      stdio: ['ignore', out, out],
      env: shellEnv()
    })
    child.unref()
    const pid = child.pid
    if (pid === undefined) throw new Error('进程创建失败（未获得 PID）')
    this.pids.set(cfg.id, pid)
    this.persistPids()

    // 中间件启动脚本（如 nacos/tomcat 的 startup.sh）会派生后台进程后自身退出，
    // 且 Java 应用就绪可能需要数十秒，这里轮询等待，最长 30s
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (this.isPidAlive(pid)) return pid // 前台运行模式（如 redis-server）
      const pids = await this.findPids(cfg)
      if (pids.length > 0) return pid // 后台派生模式（如 startup.sh -> java）
      await new Promise((r) => setTimeout(r, 1000))
    }
    this.pids.delete(cfg.id)
    this.persistPids()
    throw new Error(`启动后 30s 内未检测到进程，请检查启动命令与路径。日志：${logFile}`)
  }

  /** 优雅停止：优先执行自定义 stopCommand，否则 SIGTERM -> 等待 -> SIGKILL */
  async stop(cfg: ServiceConfig): Promise<void> {
    if (cfg.stopCommand && cfg.stopCommand.trim()) {
      await execFileAsync('/bin/zsh', ['-lc', cfg.stopCommand], {
        cwd: cfg.workDir || undefined,
        env: shellEnv()
      }).catch((err) => {
        throw new Error(`停止命令执行失败: ${err.message}`)
      })
      await this.waitForExit(cfg)
      return
    }
    await this.signal(cfg, 'SIGTERM')
    const exited = await this.waitForExit(cfg)
    if (!exited) await this.signal(cfg, 'SIGKILL')
  }

  /** 强制停止：直接 SIGKILL 整棵进程树 */
  async forceStop(cfg: ServiceConfig): Promise<void> {
    await this.signal(cfg, 'SIGKILL')
  }

  async status(cfg: ServiceConfig): Promise<ServiceStatus> {
    const pids = await this.findPids(cfg)
    const running = pids.length > 0

    const portsListening: number[] = []
    for (const port of cfg.ports) {
      if (await this.isPortListening(port)) portsListening.push(port)
    }

    let healthy: boolean | null = null
    if (cfg.healthCheckUrl) {
      healthy = await this.checkHealth(cfg.healthCheckUrl)
    }

    const procStats = pids.length > 0 ? await this.collectStats(pids) : []
    const discoveredPorts = await this.discoverListeningPorts(pids, cfg.ports)

    return { running, pids, portsListening, discoveredPorts, healthy, procStats }
  }

  /** 自动发现：进程实际监听但未配置声明的端口（如 vite 动态端口） */
  private async discoverListeningPorts(pids: number[], configured: number[]): Promise<number[]> {
    if (pids.length === 0) return []
    try {
      const { stdout } = await execFileAsync('lsof', [
        '-nP',
        '-a',
        '-iTCP',
        '-sTCP:LISTEN',
        '-p',
        pids.join(',')
      ])
      const configuredSet = new Set(configured)
      const ports = new Set<number>()
      for (const m of stdout.matchAll(/:(\d+)\s+\(LISTEN\)/g)) {
        const port = Number(m[1])
        if (port > 0 && !configuredSet.has(port)) ports.add(port)
      }
      return [...ports].sort((a, b) => a - b)
    } catch {
      return []
    }
  }

  /** 采样进程 CPU / 内存（ps 单次调用批量取，避免逐 pid 开销） */
  private async collectStats(pids: number[]): Promise<ProcessStat[]> {
    try {
      const { stdout } = await execFileAsync('ps', [
        '-o',
        'pid=,%cpu=,rss=',
        '-p',
        pids.join(',')
      ])
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [pid, cpu, rss] = line.split(/\s+/)
          return {
            pid: Number(pid),
            cpuPercent: Number(cpu) || 0,
            memoryMB: Math.round((Number(rss) || 0) / 1024) // rss 单位 KB
          }
        })
        .filter((s) => s.pid > 0)
    } catch {
      return [] // 进程在采样间隙全部退出等场景
    }
  }

  /** 进程匹配：记录的 PID 存活 + pgrep -f 按 executablePath 与 workDir 双模式兜底（并集） */
  private async findPids(cfg: ServiceConfig): Promise<number[]> {
    const result = new Set<number>()
    const recorded = this.pids.get(cfg.id)
    if (recorded && this.isPidAlive(recorded)) result.add(recorded)

    // java 进程命令行未必包含 bin 目录（如 -jar .../target/xxx.jar），
    // 因此 executablePath 与 workDir 都参与匹配，取并集
    const patterns = [cfg.executablePath?.trim(), cfg.workDir?.trim()].filter(
      (p): p is string => !!p
    )
    for (const pattern of patterns) {
      try {
        const { stdout } = await execFileAsync('pgrep', ['-f', pattern])
        for (const line of stdout.split('\n')) {
          const pid = Number(line.trim())
          if (pid > 0 && pid !== process.pid) result.add(pid)
        }
      } catch {
        /* pgrep 无匹配时退出码非 0，属正常 */
      }
    }
    return [...result]
  }

  /** 打开日志文件（追加写），目录不存在时自动创建 */
  private openSyncLog(logFile: string): number {
    mkdirSync(dirname(logFile), { recursive: true })
    return openSync(logFile, 'a')
  }

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  private async signal(cfg: ServiceConfig, sig: NodeJS.Signals): Promise<void> {
    const pids = await this.findPids(cfg)
    for (const pid of pids) {
      try {
        process.kill(-pid, sig) // 负值 = 杀整个进程组（启动时 detached 保证同组）
      } catch {
        try {
          process.kill(pid, sig)
        } catch {
          /* 进程已退出 */
        }
      }
    }
  }

  /** 等待进程退出，返回是否在期限内全部退出 */
  private async waitForExit(cfg: ServiceConfig): Promise<boolean> {
    const deadline = Date.now() + TERM_GRACE_MS
    while (Date.now() < deadline) {
      const pids = await this.findPids(cfg)
      if (pids.length === 0) {
        this.pids.delete(cfg.id)
        this.persistPids()
        return true
      }
      await new Promise((r) => setTimeout(r, 300))
    }
    return (await this.findPids(cfg)).length === 0
  }

  private async isPortListening(port: number): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
      return stdout.trim().length > 0
    } catch {
      return false // lsof 无匹配时退出码 1
    }
  }

  private async checkHealth(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch {
      return false
    }
  }
}
