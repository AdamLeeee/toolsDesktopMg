import { useState } from 'react'
import type { ServiceAction, ServiceConfig, ServiceType } from '@shared/types'
import { SERVICE_TEMPLATES } from '@shared/types'

interface Props {
  /** null = 新建；否则为编辑中的配置 */
  initial: ServiceConfig | null
  onSave: (config: Omit<ServiceConfig, 'id'> & { id?: string }) => Promise<void>
  onClose: () => void
}

/** 添加/编辑服务表单：选择类型后自动预填默认端口与启动命令 */
export default function ServiceForm({ initial, onSave, onClose }: Props) {
  const template = initial
    ? SERVICE_TEMPLATES.find((t) => t.type === initial.type)
    : SERVICE_TEMPLATES[0]

  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<ServiceType>(initial?.type ?? 'tomcat')
  const [executablePath, setExecutablePath] = useState(initial?.executablePath ?? '')
  const [startCommand, setStartCommand] = useState(initial?.startCommand ?? template?.defaultStartCommand ?? '')
  const [stopCommand, setStopCommand] = useState(initial?.stopCommand ?? template?.defaultStopCommand ?? '')
  const [workDir, setWorkDir] = useState(initial?.workDir ?? '')
  const [ports, setPorts] = useState((initial?.ports ?? template?.defaultPorts ?? []).join(', '))
  const [healthCheckUrl, setHealthCheckUrl] = useState(initial?.healthCheckUrl ?? template?.defaultHealthCheckUrl ?? '')
  const [logPath, setLogPath] = useState(initial?.logPath ?? '')
  const [detecting, setDetecting] = useState(false)
  const [detectHint, setDetectHint] = useState('')
  const [actions, setActions] = useState<ServiceAction[]>(
    initial?.actions ?? template?.defaultActions ?? []
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const applyTemplate = (t: (typeof SERVICE_TEMPLATES)[number]) => {
    setType(t.type)
    if (!initial) {
      setStartCommand(t.defaultStartCommand)
      setStopCommand(t.defaultStopCommand ?? '')
      setPorts(t.defaultPorts.join(', '))
      setHealthCheckUrl(t.defaultHealthCheckUrl ?? '')
      setActions(t.defaultActions ?? [])
    }
  }

  /** 从项目配置文件（vite.config/vue.config/.env）识别端口并填入 */
  const detectPorts = async () => {
    const dir = workDir.trim()
    if (!dir) return setDetectHint('请先填写工作目录')
    setDetecting(true)
    setDetectHint('')
    try {
      const detected = await window.api.detectPorts(dir)
      if (detected.length === 0) {
        setDetectHint('未在项目配置文件中识别到端口，可手动填写')
      } else {
        const existing = ports
          .split(/[,，\s]+/)
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0)
        const merged = [...new Set([...existing, ...detected])]
        setPorts(merged.join(', '))
        setDetectHint(`已识别端口: ${detected.join(', ')}`)
      }
    } catch (err) {
      setDetectHint((err as Error).message)
    } finally {
      setDetecting(false)
    }
  }

  const submit = async () => {
    if (!name.trim()) return setError('请填写服务名称')
    if (!startCommand.trim()) return setError('请填写启动命令')
    const portList = ports
      .split(/[,，\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0 && n < 65536)
    setSaving(true)
    setError('')
    try {
      await onSave({
        ...(initial ? { id: initial.id } : {}),
        name: name.trim(),
        type,
        executablePath: executablePath.trim() || undefined,
        startCommand: startCommand.trim(),
        stopCommand: stopCommand.trim() || undefined,
        workDir: workDir.trim() || undefined,
        ports: portList,
        healthCheckUrl: healthCheckUrl.trim() || undefined,
        logPath: logPath.trim() || undefined,
        actions: actions.filter((a) => a.name.trim() && a.command.trim())
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 z-10">
      <div className="w-[520px] max-h-[85vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold mb-4">
          {initial ? '编辑服务' : '添加服务'}
        </h2>

        <div className="space-y-4">
          <Row label="服务名称">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：本机 Nacos"
              className={inputCls}
            />
          </Row>

          <Row label="类型">
            <div className="flex flex-wrap gap-2">
              {SERVICE_TEMPLATES.map((t) => (
                <button
                  key={t.type}
                  onClick={() => applyTemplate(t)}
                  className={`rounded px-3 py-1 text-sm border ${
                    type === t.type
                      ? 'border-blue-500 bg-blue-600/30 text-blue-200'
                      : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Row>

          <Row label="启动命令" hint="shell 执行，可写相对路径（基于工作目录）">
            <input
              value={startCommand}
              onChange={(e) => setStartCommand(e.target.value)}
              placeholder="如 bin/startup.sh"
              className={`${inputCls} font-mono`}
            />
          </Row>

          <Row label="停止命令" hint="可选；不填时用 SIGTERM/SIGKILL 信号">
            <input
              value={stopCommand}
              onChange={(e) => setStopCommand(e.target.value)}
              placeholder="如 bin/shutdown.sh"
              className={`${inputCls} font-mono`}
            />
          </Row>

          <Row label="工作目录">
            <input
              value={workDir}
              onChange={(e) => setWorkDir(e.target.value)}
              placeholder="如 /Users/li.jx/tools/nacos"
              className={`${inputCls} font-mono`}
            />
          </Row>

          <Row label="可执行路径" hint="可选；用于进程识别兜底（pgrep -f 匹配）">
            <input
              value={executablePath}
              onChange={(e) => setExecutablePath(e.target.value)}
              placeholder="如 /Users/li.jx/tools/nacos/bin"
              className={`${inputCls} font-mono`}
            />
          </Row>

          <Row label="端口" hint="逗号分隔；启动后也会自动发现实际监听的端口">
            <div className="flex gap-2">
              <input
                value={ports}
                onChange={(e) => setPorts(e.target.value)}
                placeholder="如 8848, 9848"
                className={inputCls}
              />
              <button
                onClick={detectPorts}
                disabled={detecting}
                className="shrink-0 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                {detecting ? '识别中…' : '从项目识别'}
              </button>
            </div>
            {detectHint && <div className="mt-1 text-xs text-zinc-500">{detectHint}</div>}
          </Row>

          <Row label="健康检查 URL" hint="可选；HTTP 2xx 视为健康">
            <input
              value={healthCheckUrl}
              onChange={(e) => setHealthCheckUrl(e.target.value)}
              placeholder="如 http://localhost:8848/nacos"
              className={`${inputCls} font-mono`}
            />
          </Row>

          <Row label="日志文件" hint="可选；不填则统一写入应用数据目录">
            <input
              value={logPath}
              onChange={(e) => setLogPath(e.target.value)}
              placeholder="/path/to/catalina.out"
              className={`${inputCls} font-mono`}
            />
          </Row>

          <Row label="动作按钮" hint="一次性命令（如 npm install），按钮显示名称，悬停可看命令">
            <div className="space-y-2">
              {actions.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={a.name}
                    onChange={(e) =>
                      setActions(actions.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                    placeholder="名称，如 安装依赖"
                    className={`${inputCls} w-32 shrink-0`}
                  />
                  <input
                    value={a.command}
                    onChange={(e) =>
                      setActions(actions.map((x, j) => (j === i ? { ...x, command: e.target.value } : x)))
                    }
                    placeholder="命令，如 npm install"
                    className={`${inputCls} flex-1 font-mono`}
                  />
                  <button
                    onClick={() => setActions(actions.filter((_, j) => j !== i))}
                    className="shrink-0 rounded border border-zinc-700 px-2 text-sm text-red-400 hover:bg-zinc-800"
                    title="删除该动作"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => setActions([...actions, { name: '', command: '' }])}
                className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                + 添加动作
              </button>
            </div>
          </Row>
        </div>

        {error && <div className="mt-4 text-sm text-red-400">{error}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded border border-zinc-700 px-4 py-1.5 text-sm hover:bg-zinc-800">
            取消
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-40"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full rounded border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-sm outline-none focus:border-blue-500'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm mb-1">
        {label}
        {hint && <span className="ml-2 text-xs text-zinc-500">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
