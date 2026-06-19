import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = path.join(rootDir, 'apps/desktop')
const requireFromDesktop = createRequire(path.join(desktopDir, 'package.json'))
const electronPackagePath = requireFromDesktop.resolve('electron/package.json')
const electronDir = path.dirname(electronPackagePath)
const electronPackage = JSON.parse(readFileSync(electronPackagePath, 'utf8'))

function getPlatformPath() {
  switch (os.platform()) {
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron'
    case 'win32':
      return 'electron.exe'
    default:
      throw new Error(`Electron builds are not available on platform: ${os.platform()}`)
  }
}

function inspectInstall() {
  const platformPath = getPlatformPath()
  const pathFile = path.join(electronDir, 'path.txt')
  const versionFile = path.join(electronDir, 'dist', 'version')
  const executablePath = path.join(electronDir, 'dist', platformPath)

  const pathFileValue = existsSync(pathFile) ? readFileSync(pathFile, 'utf8') : null
  const versionValue = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').replace(/^v/, '') : null

  return {
    executablePath,
    ok:
      pathFileValue === platformPath &&
      versionValue === electronPackage.version &&
      existsSync(executablePath),
    pathFileValue,
    platformPath,
    versionValue,
  }
}

function runElectronInstall() {
  const installScript = path.join(electronDir, 'install.js')
  const installEnv = { ...process.env }
  delete installEnv.ELECTRON_SKIP_BINARY_DOWNLOAD

  const result = spawnSync(process.execPath, [installScript], {
    cwd: electronDir,
    env: installEnv,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`Electron install script exited with ${result.status ?? 'unknown status'}`)
  }
}

let inspection = inspectInstall()

if (!inspection.ok) {
  console.log(
    [
      'Electron binary is missing or incomplete.',
      `expected path.txt: ${inspection.platformPath}`,
      `actual path.txt: ${inspection.pathFileValue ?? '<missing>'}`,
      `expected version: ${electronPackage.version}`,
      `actual version: ${inspection.versionValue ?? '<missing>'}`,
      'Running Electron package install script...',
    ].join('\n'),
  )
  runElectronInstall()
  inspection = inspectInstall()
}

if (!inspection.ok) {
  throw new Error(`Electron install is still incomplete after repair: ${inspection.executablePath}`)
}

console.log(`Electron binary ready: ${inspection.executablePath}`)
