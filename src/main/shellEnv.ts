import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * 工具链 PATH 探测与注入。
 *
 * 背景：打包版应用从 Finder/Launchpad 启动时继承的是 launchd 的最小 PATH
 * （/usr/bin:/bin:/usr/sbin:/sbin），不包含 nvm/homebrew 等用户级工具链，
 * 导致 `npm` 等命令 "command not found"。
 *
 * 这里在模块加载时组合一份完整 PATH：
 * - 继承当前进程已有 PATH（dev 模式继承终端，天然含 node 等）
 * - 固定系统目录
 * - 自动扫描 ~/.nvm 下各版本 node 的 bin 目录
 * - homebrew / volta / 用户本地目录
 */
function collectPaths(): string[] {
  const dirs = new Set<string>()

  const add = (...items: string[]) => {
    for (const p of items) if (p.trim()) dirs.add(p)
  }

  // 继承已有 PATH
  add(...(process.env.PATH ?? '').split(delimiter))
  // 固定系统目录
  add('/usr/local/bin', '/usr/local/sbin', '/opt/homebrew/bin', '/opt/homebrew/sbin')
  add('/usr/bin', '/bin', '/usr/sbin', '/sbin')
  // nvm 各 node 版本
  try {
    const versions = readdirSync(join(homedir(), '.nvm', 'versions', 'node')).sort().reverse()
    for (const v of versions) add(join(homedir(), '.nvm', 'versions', 'node', v, 'bin'))
  } catch {
    /* 未安装 nvm 属正常 */
  }
  // volta / 用户本地
  add(join(homedir(), '.volta', 'bin'), join(homedir(), '.local', 'bin'))

  return [...dirs]
}

const SHELL_PATH = collectPaths().join(delimiter)

/** 供子进程使用的完整环境：PATH 已注入工具链目录 */
export function shellEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: SHELL_PATH }
}
