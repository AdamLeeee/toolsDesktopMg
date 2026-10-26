import { contextBridge, ipcRenderer } from 'electron'
import type { ServiceConfig, ServiceStatus } from '@shared/types'

const api = {
  listServices: () => ipcRenderer.invoke('services:list'),
  /** 从项目配置文件（vite.config/vue.config/.env）识别端口 */
  detectPorts: (workDir: string) => ipcRenderer.invoke('services:detectPorts', workDir),
  addService: (config: Omit<ServiceConfig, 'id'>) => ipcRenderer.invoke('services:add', config),
  updateService: (config: ServiceConfig) => ipcRenderer.invoke('services:update', config),
  deleteService: (id: string) => ipcRenderer.invoke('services:delete', id),
  startService: (id: string) => ipcRenderer.invoke('service:start', id),
  stopService: (id: string) => ipcRenderer.invoke('service:stop', id),
  forceStopService: (id: string) => ipcRenderer.invoke('service:forceStop', id),
  getStatus: (id: string) => ipcRenderer.invoke('service:status', id),
  openLog: (id: string) => ipcRenderer.invoke('service:openLog', id),
  openTerminal: (id: string) => ipcRenderer.invoke('service:openTerminal', id),
  /** 执行一次性动作（npm install 等），返回 { ok, code } */
  runAction: (id: string, actionName: string) =>
    ipcRenderer.invoke('service:runAction', id, actionName)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)

export type { ServiceConfig, ServiceStatus }
