export type ServiceType =
  | 'tomcat'
  | 'nacos'
  | 'redis'
  | 'mysql'
  | 'kafka'
  | 'vue2'
  | 'vue3'
  | 'custom'

/** 一次性动作（如 npm install / npm run test），区别于长驻的 startCommand */
export interface ServiceAction {
  name: string
  command: string
}

export interface ServiceConfig {
  id: string
  name: string
  type: ServiceType
  /** 可执行文件/脚本路径，用于 pgrep 兜底匹配进程 */
  executablePath?: string
  /** 启动命令（shell 执行，如 `bin/startup.sh`、`npm run dev`） */
  startCommand: string
  /** 优雅停止命令（可选，优先于进程信号） */
  stopCommand?: string
  /** 工作目录 */
  workDir?: string
  /** 需要监听展示的端口 */
  ports: number[]
  /** 日志文件路径（可选，未填时使用内置日志文件） */
  logPath?: string
  /** HTTP 健康检查地址（可选，如 http://localhost:8848/nacos） */
  healthCheckUrl?: string
  /** 一次性动作按钮（可选，如 npm install） */
  actions?: ServiceAction[]
}

/** 单个进程的资源占用（macOS ps 采样：%cpu 为衰减均值，rss 为常驻内存） */
export interface ProcessStat {
  pid: number
  cpuPercent: number
  memoryMB: number
}

/** 服务三档状态：进程 + 端口 + 健康探针 + 资源占用 */
export interface ServiceStatus {
  running: boolean
  pids: number[]
  portsListening: number[]
  /** 进程实际监听但未在配置中声明的端口（自动发现） */
  discoveredPorts: number[]
  /** null 表示未配置健康检查 */
  healthy: boolean | null
  procStats: ProcessStat[]
}

export interface ServiceWithStatus {
  config: ServiceConfig
  status: ServiceStatus
}

/** 服务配置类型预设：选类型后表单自动预填 */
export interface ServiceTemplate {
  type: ServiceType
  label: string
  defaultPorts: number[]
  defaultStartCommand: string
  defaultStopCommand?: string
  defaultWorkDir?: string
  defaultHealthCheckUrl?: string
  defaultActions?: ServiceAction[]
}

const NPM_PROJECT_ACTIONS: ServiceAction[] = [
  { name: '安装依赖', command: 'npm install' },
  { name: '测试', command: 'npm run test' },
  { name: '构建', command: 'npm run build' }
]

export const SERVICE_TEMPLATES: ServiceTemplate[] = [
  {
    type: 'tomcat',
    label: 'Tomcat',
    defaultPorts: [8080],
    defaultStartCommand: 'bin/startup.sh',
    defaultStopCommand: 'bin/shutdown.sh'
  },
  {
    type: 'nacos',
    label: 'Nacos',
    defaultPorts: [8848, 9848],
    defaultStartCommand: 'bin/startup.sh -m standalone',
    defaultStopCommand: 'bin/shutdown.sh',
    defaultHealthCheckUrl: 'http://localhost:8848/nacos'
  },
  {
    type: 'redis',
    label: 'Redis',
    defaultPorts: [6379],
    defaultStartCommand: 'redis-server ./redis.conf'
  },
  {
    type: 'mysql',
    label: 'MySQL',
    defaultPorts: [3306],
    defaultStartCommand: 'mysqld --defaults-file=./my.cnf'
  },
  {
    type: 'kafka',
    label: 'Kafka',
    defaultPorts: [9092],
    defaultStartCommand: 'bin/kafka-server-start.sh config/server.properties',
    defaultStopCommand: 'bin/kafka-server-stop.sh'
  },
  {
    type: 'vue2',
    label: 'Vue2',
    defaultPorts: [8080],
    defaultStartCommand: 'npm run dev',
    defaultActions: NPM_PROJECT_ACTIONS
  },
  {
    type: 'vue3',
    label: 'Vue3',
    defaultPorts: [5173],
    defaultStartCommand: 'npm run dev',
    defaultActions: NPM_PROJECT_ACTIONS
  },
  {
    type: 'custom',
    label: '自定义',
    defaultPorts: [],
    defaultStartCommand: ''
  }
]
