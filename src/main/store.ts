import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { ServiceConfig } from '@shared/types'

/** JSON 文件持久化：服务列表 + 运行态 PID 记录（用于应用重启后的孤儿进程恢复） */
export class JsonStore<T> {
  constructor(private filePath: string) {}

  load(fallback: T): T {
    try {
      if (!existsSync(this.filePath)) return fallback
      return JSON.parse(readFileSync(this.filePath, 'utf-8')) as T
    } catch (err) {
      console.error(`[store] 读取失败 ${this.filePath}:`, err)
      return fallback
    }
  }

  save(data: T): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      console.error(`[store] 写入失败 ${this.filePath}:`, err)
      throw err
    }
  }
}

export const servicesFile = (userDataDir: string) =>
  join(userDataDir, 'services.json')
export const pidsFile = (userDataDir: string) => join(userDataDir, 'pids.json')
export const defaultLogFile = (userDataDir: string) =>
  join(userDataDir, 'logs', 'service-output.log')

export type { ServiceConfig }
