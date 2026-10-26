import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ServiceConfig, ServiceWithStatus } from '@shared/types'
import ServiceForm from './components/ServiceForm'

type ActionState = { id: string; kind: 'start' | 'stop' | 'forceStop' } | null
type OneShotState = { key: string } | null

export default function App() {
  const [services, setServices] = useState<ServiceWithStatus[]>([])
  const [editing, setEditing] = useState<ServiceConfig | null | undefined>(undefined) // undefined=关闭, null=新建
  const [action, setAction] = useState<ActionState>(null)
  const [oneShot, setOneShot] = useState<OneShotState>(null)
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)

  const notify = (msg: string, error?: boolean) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 4000)
  }

  const refresh = useCallback(async () => {
    const configs: ServiceConfig[] = await window.api.listServices()
    const withStatus = await Promise.all(
      configs.map(async (config) => ({
        config,
        status: await window.api.getStatus(config.id).catch(() => ({
          running: false,
          pids: [],
          portsListening: [],
          discoveredPorts: [],
          healthy: null,
          procStats: []
        }))
      }))
    )
    setServices(withStatus)
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const runAction = async (id: string, kind: 'start' | 'stop' | 'forceStop') => {
    setAction({ id, kind })
    try {
      if (kind === 'start') await window.api.startService(id)
      else if (kind === 'stop') await window.api.stopService(id)
      else await window.api.forceStopService(id)
      notify(kind === 'start' ? '启动指令已执行' : kind === 'stop' ? '已停止' : '已强制停止')
    } catch (err) {
      notify(`${kind === 'start' ? '启动' : '停止'}失败: ${(err as Error).message}`, true)
    } finally {
      setAction(null)
      refresh()
    }
  }

  const runOneShot = async (id: string, name: string) => {
    const key = `${id}:${name}`
    setOneShot({ key })
    try {
      const { ok } = await window.api.runAction(id, name)
      notify(
        ok ? `「${name}」执行成功` : `「${name}」执行失败（退出码非 0，详见日志）`,
        !ok
      )
    } catch (err) {
      notify(`「${name}」执行失败: ${(err as Error).message}`, true)
    } finally {
      setOneShot(null)
    }
  }

  const saveService = async (config: Omit<ServiceConfig, 'id'> & { id?: string }) => {
    if (config.id) await window.api.updateService(config as ServiceConfig)
    else await window.api.addService(config as Omit<ServiceConfig, 'id'>)
    setEditing(undefined)
    refresh()
  }

  const removeService = async (id: string) => {
    await window.api.deleteService(id)
    refresh()
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* 左侧：服务列表 */}
      <aside className="w-72 shrink-0 border-r border-zinc-800 bg-zinc-900/50 overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h1 className="text-sm font-semibold tracking-wide">本地服务管理</h1>
          <button
            onClick={() => setEditing(null)}
            className="rounded bg-blue-600 px-2 py-1 text-xs font-medium hover:bg-blue-500"
          >
            + 添加
          </button>
        </div>
        <ul>
          {services.map(({ config, status }) => (
            <li
              key={config.id}
              onClick={() => setEditing(config)}
              className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-zinc-800/60 border-b border-zinc-800/50"
            >
              <StatusDot status={status} />
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{config.name}</div>
                <div className="text-xs text-zinc-500 truncate">
                  {config.type}
                  {config.ports.length > 0 && ` · ${config.ports.join(', ')}`}
                </div>
              </div>
              <StatusBadge status={status} size="sm" />
            </li>
          ))}
          {services.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-zinc-500">
              还没有配置服务
              <br />
              点击右上角「添加」开始
            </li>
          )}
        </ul>
      </aside>

      {/* 右侧：详情面板 */}
      <main className="flex-1 overflow-y-auto p-6">
        {services.map(({ config, status }) => (
          <section
            key={config.id}
            className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
          >
            <header className="flex items-center gap-3 mb-4">
              <StatusDot status={status} />
              <h2 className="text-lg font-semibold">{config.name}</h2>
              <StatusBadge status={status} />
              <span className="text-xs text-zinc-500">
                {statusLevel(status) === 'Running'
                  ? '进程运行中，端口正常'
                  : statusLevel(status) === 'Degraded'
                    ? '进程存在，但端口/健康检查未通过'
                    : '进程未运行'}
              </span>
            </header>

            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm mb-5">
              <Info label="类型" value={config.type} />
              <Info label="PID" value={status.pids.join(', ') || '—'} />
              <Info label="CPU" value={formatCpu(status.procStats)} />
              <Info label="内存" value={formatMemory(status.procStats)} />
              <Info label="启动命令" value={config.startCommand} mono />
              <Info
                label="端口监听"
                value={
                  config.ports.length === 0 && status.discoveredPorts.length === 0 ? (
                    '—'
                  ) : (
                    <span className="flex flex-wrap gap-2">
                      {config.ports.map((p) => {
                        const listening = status.portsListening.includes(p)
                        return (
                          <span
                            key={p}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono bg-zinc-800/80 text-zinc-300"
                          >
                            {p}
                            <span className={listening ? '' : 'text-red-400'}>
                              {listening ? '✅' : '✕'}
                            </span>
                          </span>
                        )
                      })}
                      {status.discoveredPorts.map((p) => (
                        <span
                          key={p}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono bg-sky-900/40 text-sky-300"
                          title="自动发现：进程实际监听的端口"
                        >
                          {p} ✅ 自动
                        </span>
                      ))}
                    </span>
                  )
                }
              />
              <Info label="工作目录" value={config.workDir || '—'} mono />
              <Info
                label="健康检查"
                value={
                  status.healthy === null
                    ? '未配置'
                    : status.healthy
                      ? '正常 ✓'
                      : '异常 ✗'
                }
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                disabled={action?.id === config.id}
                onClick={() => runAction(config.id, 'start')}
                className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium hover:bg-green-600 disabled:opacity-40"
              >
                {action?.id === config.id && action.kind === 'start' ? '启动中…' : '启动'}
              </button>
              <button
                disabled={action?.id === config.id}
                onClick={() => runAction(config.id, 'stop')}
                className="rounded bg-zinc-700 px-3 py-1.5 text-sm font-medium hover:bg-zinc-600 disabled:opacity-40"
              >
                {action?.id === config.id && action.kind === 'stop' ? '停止中…' : '停止'}
              </button>
              <button
                disabled={action?.id === config.id}
                onClick={() => {
                  if (confirm(`确定强制停止「${config.name}」吗？进程将收到 SIGKILL，可能丢失未落盘数据。`))
                    runAction(config.id, 'forceStop')
                }}
                className="rounded bg-red-800 px-3 py-1.5 text-sm font-medium hover:bg-red-700 disabled:opacity-40"
              >
                {action?.id === config.id && action.kind === 'forceStop' ? '强杀中…' : '强制停止'}
              </button>
              {config.actions?.map((a) => {
                const key = `${config.id}:${a.name}`
                const busy = oneShot?.key === key
                return (
                  <button
                    key={a.name}
                    disabled={busy || !!oneShot}
                    onClick={() => runOneShot(config.id, a.name)}
                    className="rounded border border-indigo-700 px-3 py-1.5 text-sm text-indigo-300 hover:bg-indigo-900/40 disabled:opacity-40"
                    title={a.command}
                  >
                    {busy ? `${a.name}中…` : a.name}
                  </button>
                )
              })}
              <div className="flex-1" />
              <button
                onClick={() => window.api.openLog(config.id).catch((e) => notify((e as Error).message, true))}
                className="rounded border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
              >
                打开日志
              </button>
              <button
                onClick={() => window.api.openTerminal(config.id).catch((e) => notify((e as Error).message, true))}
                className="rounded border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
              >
                打开终端
              </button>
              <button
                onClick={() => {
                  if (confirm(`确定删除服务「${config.name}」的配置吗？`)) removeService(config.id)
                }}
                className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-red-400 hover:bg-zinc-800"
              >
                删除
              </button>
            </div>
          </section>
        ))}
        {services.length === 0 && (
          <div className="flex h-full items-center justify-center text-zinc-500">
            在左侧添加服务后，这里会显示详情与操作按钮
          </div>
        )}
      </main>

      {/* 添加/编辑弹窗 */}
      {editing !== undefined && (
        <ServiceForm
          initial={editing}
          onSave={saveService}
          onClose={() => setEditing(undefined)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 rounded px-4 py-2 text-sm shadow-lg ${
            toast.error ? 'bg-red-700' : 'bg-zinc-700'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}

/** 进程组合计 CPU（各 pid 相加；单进程时即自身占用） */
function formatCpu(stats: ServiceWithStatus['status']['procStats']): string {
  if (stats.length === 0) return '—'
  const total = stats.reduce((sum, s) => sum + s.cpuPercent, 0)
  return `${total.toFixed(1)}%`
}

/** 进程组合计内存，按最大单位自适应显示 */
function formatMemory(stats: ServiceWithStatus['status']['procStats']): string {
  if (stats.length === 0) return '—'
  const totalMB = stats.reduce((sum, s) => sum + s.memoryMB, 0)
  return totalMB >= 1024 ? `${(totalMB / 1024).toFixed(2)} GB` : `${totalMB} MB`
}

/** 状态判定：Stopped / Degraded(进程在但端口或健康未通过) / Running */
function statusLevel(status: ServiceWithStatus['status']): 'Running' | 'Degraded' | 'Stopped' {
  if (!status.running) return 'Stopped'
  return status.portsListening.length > 0 && status.healthy !== false ? 'Running' : 'Degraded'
}

function StatusDot({ status }: { status: ServiceWithStatus['status'] }) {
  const level = statusLevel(status)
  const cls =
    level === 'Running'
      ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.9)]'
      : level === 'Degraded'
        ? 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.7)]'
        : 'bg-zinc-600'
  return <span className={`inline-block size-3 rounded-full shrink-0 ${cls}`} />
}

/** 状态徽章：md 用于详情面板（醒目），sm 用于列表 */
function StatusBadge({
  status,
  size = 'md'
}: {
  status: ServiceWithStatus['status']
  size?: 'sm' | 'md'
}) {
  const level = statusLevel(status)
  const icon = level === 'Running' ? '●' : level === 'Degraded' ? '▲' : '○'
  const colorCls =
    level === 'Running'
      ? 'bg-green-500/20 text-green-400 border-green-500/60'
      : level === 'Degraded'
        ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/60'
        : 'bg-zinc-700/40 text-zinc-400 border-zinc-600/60'
  const sizeCls =
    size === 'md'
      ? 'px-3 py-1 text-sm font-semibold gap-1.5'
      : 'px-1.5 py-0.5 text-[10px] gap-1'
  return (
    <span
      className={`inline-flex items-center rounded-full border ${colorCls} ${sizeCls}`}
    >
      <span className="leading-none">{icon}</span>
      {level}
    </span>
  )
}

function Info({
  label,
  value,
  mono
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-zinc-500 mb-0.5">{label}</div>
      <div
        className={`truncate ${mono ? 'font-mono text-xs text-zinc-300' : ''}`}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </div>
    </div>
  )
}
