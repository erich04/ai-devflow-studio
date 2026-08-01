import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

function comparePaths(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizedMode(stats, type) {
  if (type === 'directory') return '0755'
  if (type === 'symlink') return '0777'
  return stats.mode & 0o111 ? '0755' : '0644'
}

export async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function collectEntries(rootDirectory, relativeDirectory = '') {
  const absoluteDirectory = path.join(rootDirectory, relativeDirectory)
  const names = await readdir(absoluteDirectory)
  names.sort(comparePaths)
  const entries = []

  for (const name of names) {
    const relativePath = relativeDirectory
      ? path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), name)
      : name
    const absolutePath = path.join(rootDirectory, ...relativePath.split('/'))
    const stats = await lstat(absolutePath)

    if (stats.isDirectory()) {
      entries.push({
        path: relativePath,
        type: 'directory',
        mode: normalizedMode(stats, 'directory'),
      })
      entries.push(...(await collectEntries(rootDirectory, relativePath)))
      continue
    }

    if (stats.isSymbolicLink()) {
      entries.push({
        path: relativePath,
        type: 'symlink',
        mode: normalizedMode(stats, 'symlink'),
        target: await readlink(absolutePath),
      })
      continue
    }

    if (!stats.isFile()) {
      throw new Error(`Unsupported desktop artifact entry type: ${relativePath}`)
    }

    entries.push({
      path: relativePath,
      type: 'file',
      mode: normalizedMode(stats, 'file'),
      size: stats.size,
      sha256: await sha256File(absolutePath),
    })
  }

  return entries
}

export async function createDesktopArtifactManifest(appDirectory, metadata) {
  return {
    schemaVersion: 1,
    artifact: {
      productName: metadata.productName,
      version: metadata.version,
      electronVersion: metadata.electronVersion,
      platform: metadata.platform,
      arch: metadata.arch,
      signed: false,
      installer: false,
      runtimeDependencies: {
        electron: metadata.electronVersion,
        ...(metadata.sqlJsVersion ? { 'sql.js': metadata.sqlJsVersion } : {}),
      },
    },
    entries: await collectEntries(appDirectory),
  }
}

async function copyOptionalFile(sourcePath, destinationPath) {
  try {
    await cp(sourcePath, destinationPath)
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error
  }
}

export async function stageDesktopPilotApplication({
  desktopDirectory,
  stagingDirectory,
  sqlJsDirectory,
}) {
  const [desktopPackage, sqlJsPackage] = await Promise.all([
    readFile(path.join(desktopDirectory, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(sqlJsDirectory, 'package.json'), 'utf8').then(JSON.parse),
  ])

  await rm(stagingDirectory, { recursive: true, force: true })
  await mkdir(path.join(stagingDirectory, 'node_modules', 'sql.js'), { recursive: true })
  await Promise.all([
    cp(path.join(desktopDirectory, 'dist'), path.join(stagingDirectory, 'dist'), { recursive: true }),
    cp(path.join(desktopDirectory, 'dist-electron'), path.join(stagingDirectory, 'dist-electron'), {
      recursive: true,
    }),
    cp(path.join(sqlJsDirectory, 'dist'), path.join(stagingDirectory, 'node_modules', 'sql.js', 'dist'), {
      recursive: true,
    }),
  ])

  const stagedPackage = {
    name: 'ai-devflow-studio-desktop',
    productName: 'AI DevFlow Studio',
    version: desktopPackage.version,
    private: true,
    type: 'module',
    main: 'dist-electron/main.js',
    dependencies: {
      'sql.js': sqlJsPackage.version,
    },
  }
  await Promise.all([
    writeFile(path.join(stagingDirectory, 'package.json'), `${JSON.stringify(stagedPackage, null, 2)}\n`),
    writeFile(
      path.join(stagingDirectory, 'node_modules', 'sql.js', 'package.json'),
      `${JSON.stringify(sqlJsPackage, null, 2)}\n`,
    ),
    copyOptionalFile(
      path.join(sqlJsDirectory, 'LICENSE'),
      path.join(stagingDirectory, 'node_modules', 'sql.js', 'LICENSE'),
    ),
    copyOptionalFile(
      path.join(sqlJsDirectory, 'README.md'),
      path.join(stagingDirectory, 'node_modules', 'sql.js', 'README.md'),
    ),
  ])

  return stagedPackage
}

export function resolveDesktopExecutablePath(appDirectory, platform) {
  if (platform === 'darwin') {
    return path.join(
      appDirectory,
      'AI DevFlow Studio.app',
      'Contents',
      'MacOS',
      'AI DevFlow Studio',
    )
  }
  if (platform === 'win32') {
    return path.join(appDirectory, 'AI DevFlow Studio.exe')
  }
  if (platform === 'linux') {
    return path.join(appDirectory, 'AI DevFlow Studio')
  }
  throw new Error(`Unsupported Desktop pilot platform: ${platform}`)
}

function writeTarString(header, value, offset, length, label) {
  const encoded = Buffer.from(value)
  if (encoded.length > length) {
    throw new Error(`${label} is too long for the portable tar format: ${value}`)
  }
  encoded.copy(header, offset)
}

function writeTarOctal(header, value, offset, length, label) {
  const octal = value.toString(8)
  if (octal.length > length - 1) {
    throw new Error(`${label} is too large for the portable tar format: ${value}`)
  }
  writeTarString(header, `${octal.padStart(length - 1, '0')}\0`, offset, length, label)
}

function splitTarPath(archivePath) {
  if (Buffer.byteLength(archivePath) <= 100) {
    return { name: archivePath, prefix: '' }
  }

  for (let separator = archivePath.lastIndexOf('/'); separator > 0; separator = archivePath.lastIndexOf('/', separator - 1)) {
    const prefix = archivePath.slice(0, separator)
    const name = archivePath.slice(separator + 1)
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix }
    }
  }

  throw new Error(`Path is too long for the portable tar format: ${archivePath}`)
}

function createTarHeader({ archivePath, mode, size = 0, type, linkTarget = '' }) {
  const header = Buffer.alloc(512)
  const normalizedPath = type === 'directory' && !archivePath.endsWith('/')
    ? `${archivePath}/`
    : archivePath
  const { name, prefix } = splitTarPath(normalizedPath)

  writeTarString(header, name, 0, 100, 'Tar path')
  writeTarOctal(header, mode, 100, 8, 'Tar mode')
  writeTarOctal(header, 0, 108, 8, 'Tar uid')
  writeTarOctal(header, 0, 116, 8, 'Tar gid')
  writeTarOctal(header, size, 124, 12, 'Tar size')
  writeTarOctal(header, 0, 136, 12, 'Tar mtime')
  header.fill(0x20, 148, 156)
  writeTarString(header, type === 'directory' ? '5' : type === 'symlink' ? '2' : '0', 156, 1, 'Tar type')
  if (linkTarget) writeTarString(header, linkTarget, 157, 100, 'Tar link target')
  writeTarString(header, 'ustar\0', 257, 6, 'Tar magic')
  writeTarString(header, '00', 263, 2, 'Tar version')
  writeTarString(header, prefix, 345, 155, 'Tar path prefix')

  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  const encodedChecksum = `${checksum.toString(8).padStart(6, '0')}\0 `
  writeTarString(header, encodedChecksum, 148, 8, 'Tar checksum')
  return header
}

async function collectArchiveEntries(rootDirectory, relativeDirectory = '') {
  const absoluteDirectory = path.join(rootDirectory, ...relativeDirectory.split('/').filter(Boolean))
  const names = await readdir(absoluteDirectory)
  names.sort(comparePaths)
  const entries = []

  for (const name of names) {
    const relativePath = relativeDirectory ? path.posix.join(relativeDirectory, name) : name
    const absolutePath = path.join(rootDirectory, ...relativePath.split('/'))
    const stats = await lstat(absolutePath)
    if (stats.isDirectory()) {
      entries.push({ relativePath, absolutePath, stats, type: 'directory' })
      entries.push(...(await collectArchiveEntries(rootDirectory, relativePath)))
    } else if (stats.isSymbolicLink()) {
      entries.push({
        relativePath,
        absolutePath,
        stats,
        type: 'symlink',
        linkTarget: await readlink(absolutePath),
      })
    } else if (stats.isFile()) {
      entries.push({ relativePath, absolutePath, stats, type: 'file' })
    } else {
      throw new Error(`Unsupported desktop archive entry type: ${relativePath}`)
    }
  }

  return entries
}

async function* streamTar(sourceDirectory, archiveRootName) {
  yield createTarHeader({
    archivePath: archiveRootName,
    mode: 0o755,
    type: 'directory',
  })

  for (const entry of await collectArchiveEntries(sourceDirectory)) {
    const mode = entry.type === 'directory'
      ? 0o755
      : entry.type === 'symlink'
        ? 0o777
        : entry.stats.mode & 0o111
          ? 0o755
          : 0o644
    const size = entry.type === 'file' ? entry.stats.size : 0
    yield createTarHeader({
      archivePath: path.posix.join(archiveRootName, entry.relativePath),
      mode,
      size,
      type: entry.type,
      linkTarget: entry.linkTarget,
    })

    if (entry.type === 'file') {
      for await (const chunk of createReadStream(entry.absolutePath)) {
        yield chunk
      }
      const remainder = size % 512
      if (remainder !== 0) yield Buffer.alloc(512 - remainder)
    }
  }

  yield Buffer.alloc(1024)
}

export async function writeDeterministicTarGzip({
  sourceDirectory,
  archivePath,
  archiveRootName,
}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(archiveRootName)) {
    throw new Error(`Archive root name must be one portable path segment: ${archiveRootName}`)
  }

  await mkdir(path.dirname(archivePath), { recursive: true })
  await pipeline(
    Readable.from(streamTar(sourceDirectory, archiveRootName)),
    createGzip({ level: 9, mtime: 0 }),
    createWriteStream(archivePath, { mode: 0o644 }),
  )
}
