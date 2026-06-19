import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = path.join(rootDir, 'apps/desktop')
const requireFromDesktop = createRequire(path.join(desktopDir, 'package.json'))
const electronPackagePath = requireFromDesktop.resolve('electron/package.json')
const electronDir = path.dirname(electronPackagePath)
const requireFromElectron = createRequire(path.join(electronDir, 'install.js'))
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

async function downloadElectronArtifact() {
  const extract = requireFromElectron('extract-zip')
  const checksums = requireFromElectron('./checksums.json')
  const platform = process.env.npm_config_platform || process.platform
  const arch = process.env.npm_config_arch || process.arch
  const zipName = `electron-v${electronPackage.version}-${platform}-${arch}.zip`
  const expectedChecksum = checksums[zipName]
  const url = `https://github.com/electron/electron/releases/download/v${electronPackage.version}/${zipName}`
  const zipPath = path.join(os.tmpdir(), zipName)
  const curl = spawnSync(
    'curl',
    ['--fail', '--location', '--retry', '3', '--output', zipPath, url],
    { stdio: 'inherit' },
  )
  if (curl.status !== 0) {
    throw new Error(`Unable to download ${zipName} with curl: ${curl.status ?? 'unknown status'}`)
  }

  const zipBuffer = readFileSync(zipPath)
  const actualChecksum = createHash('sha256').update(zipBuffer).digest('hex')
  if (expectedChecksum && actualChecksum !== expectedChecksum) {
    throw new Error(`Checksum mismatch for ${zipName}: expected ${expectedChecksum}, got ${actualChecksum}`)
  }

  const distPath = path.join(electronDir, 'dist')
  await extract(zipPath, { dir: distPath })
  await rm(zipPath, { force: true })

  const srcTypeDefPath = path.join(distPath, 'electron.d.ts')
  const targetTypeDefPath = path.join(electronDir, 'electron.d.ts')
  if (existsSync(srcTypeDefPath)) {
    renameSync(srcTypeDefPath, targetTypeDefPath)
  }

  await writeFile(path.join(electronDir, 'path.txt'), getPlatformPath())
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

  if (!inspection.ok) {
    console.log('Electron package install script did not produce a binary; downloading artifact directly...')
    await downloadElectronArtifact()
    inspection = inspectInstall()
  }
}

if (!inspection.ok) {
  throw new Error(`Electron install is still incomplete after repair: ${inspection.executablePath}`)
}

console.log(`Electron binary ready: ${inspection.executablePath}`)
