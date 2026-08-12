import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const INDEX_NAME = 'artifact-index.json'
const INDEX_MAX_BYTES = 16 * 1024
const MANIFEST_MAX_BYTES = 16 * 1024 * 1024
const ARCHIVE_MAX_BYTES = 1024 * 1024 * 1024
const COPY_BUFFER_BYTES = 1024 * 1024
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0

export class DesktopArtifactTrioError extends Error {
  constructor(code) {
    super(`Desktop artifact trio validation failed: ${code}`)
    this.name = 'DesktopArtifactTrioError'
    this.code = code
  }
}

function fail(code) {
  throw new DesktopArtifactTrioError(code)
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function openBoundedRegularFile(filePath, maxBytes, kind, { allowEmpty = false } = {}) {
  let before
  try {
    before = lstatSync(filePath)
  } catch {
    fail(`${kind}_not_regular`)
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    fail(`${kind}_not_regular`)
  }
  if ((!allowEmpty && before.size === 0) || before.size < 0) {
    fail(`${kind}_empty`)
  }
  if (before.size > maxBytes) {
    fail(`${kind}_too_large`)
  }

  let descriptor
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | NO_FOLLOW)
    const opened = fstatSync(descriptor)
    if (!opened.isFile() || !sameFile(before, opened) || opened.size !== before.size) {
      closeSync(descriptor)
      fail(`${kind}_not_regular`)
    }
    return { descriptor, size: opened.size }
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        // The validation error below is intentionally stable.
      }
    }
    if (error instanceof DesktopArtifactTrioError) {
      throw error
    }
    fail(`${kind}_not_regular`)
  }
}

function readBoundedJson(filePath, maxBytes, kind) {
  const { descriptor, size } = openBoundedRegularFile(filePath, maxBytes, kind, {
    allowEmpty: true,
  })
  try {
    const bytes = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const count = readSync(descriptor, bytes, offset, size - offset, offset)
      if (count === 0) {
        fail(`${kind}_changed`)
      }
      offset += count
    }
    let text
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      fail(`${kind}_invalid_json`)
    }
    try {
      return JSON.parse(text)
    } catch {
      fail(`${kind}_invalid_json`)
    }
  } finally {
    closeSync(descriptor)
  }
}

function hashBoundedRegularFile(filePath, maxBytes, kind) {
  const { descriptor, size } = openBoundedRegularFile(filePath, maxBytes, kind)
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, size))
    let offset = 0
    while (offset < size) {
      const count = readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, size - offset),
        offset,
      )
      if (count === 0) {
        fail(`${kind}_changed`)
      }
      hash.update(buffer.subarray(0, count))
      offset += count
    }
    return { sha256: hash.digest('hex'), size }
  } finally {
    closeSync(descriptor)
  }
}

function assertObject(value, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(code)
  }
  return value
}

function assertExactKeys(value, expectedKeys, code) {
  const actualKeys = Object.keys(assertObject(value, code)).sort()
  const expected = [...expectedKeys].sort()
  if (actualKeys.length !== expected.length || actualKeys.some((key, index) => key !== expected[index])) {
    fail(code)
  }
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0')) {
    return false
  }
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value) {
    return false
  }
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function assertExclusiveDirectory(directory, expectedNames) {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    fail('artifact_source_not_exclusive')
  }
  const actualNames = entries.map((entry) => entry.name).sort()
  const expected = [...expectedNames].sort()
  if (
    actualNames.length !== expected.length ||
    actualNames.some((name, index) => name !== expected[index]) ||
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
  ) {
    fail('artifact_source_not_exclusive')
  }
}

function inspect(indexPath, { exclusive = false } = {}) {
  const resolvedIndexPath = path.resolve(indexPath)
  if (path.basename(resolvedIndexPath) !== INDEX_NAME) {
    fail('artifact_index_name_invalid')
  }
  const sourceDirectory = path.dirname(resolvedIndexPath)
  const index = readBoundedJson(resolvedIndexPath, INDEX_MAX_BYTES, 'artifact_index')
  assertExactKeys(
    index,
    ['schemaVersion', 'platform', 'arch', 'appDirectory', 'manifest', 'archive'],
    'artifact_index_schema_invalid',
  )
  if (
    index.schemaVersion !== 1 ||
    !/^(darwin|linux|win32)$/.test(index.platform) ||
    !/^(arm64|x64)$/.test(index.arch) ||
    !isSafeRelativePath(index.appDirectory)
  ) {
    fail('artifact_index_schema_invalid')
  }

  const manifestName = index.manifest
  const archiveName = index.archive
  if (
    typeof manifestName !== 'string' ||
    typeof archiveName !== 'string' ||
    path.posix.basename(manifestName) !== manifestName ||
    path.posix.basename(archiveName) !== archiveName ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifestName) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(archiveName) ||
    manifestName === archiveName
  ) {
    fail('artifact_index_path_invalid')
  }

  const manifestPath = path.join(sourceDirectory, manifestName)
  const archivePath = path.join(sourceDirectory, archiveName)
  const manifest = readBoundedJson(manifestPath, MANIFEST_MAX_BYTES, 'artifact_manifest')
  assertExactKeys(
    manifest,
    ['schemaVersion', 'artifact', 'entries', 'archive'],
    'artifact_manifest_schema_invalid',
  )
  const artifact = assertObject(manifest.artifact, 'artifact_manifest_schema_invalid')
  const archive = assertObject(manifest.archive, 'artifact_manifest_schema_invalid')
  assertExactKeys(archive, ['path', 'sha256'], 'artifact_manifest_schema_invalid')
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.entries) ||
    typeof artifact.version !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(
      artifact.version,
    ) ||
    artifact.platform !== index.platform ||
    artifact.arch !== index.arch ||
    archive.path !== archiveName ||
    typeof archive.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(archive.sha256)
  ) {
    fail('artifact_manifest_schema_invalid')
  }

  const label = `ai-devflow-studio-desktop-${artifact.version}-${index.platform}-${index.arch}`
  if (manifestName !== `${label}.manifest.json` || archiveName !== `${label}.tar.gz`) {
    fail('artifact_names_not_bound')
  }

  const actualArchive = hashBoundedRegularFile(archivePath, ARCHIVE_MAX_BYTES, 'artifact_archive')
  if (actualArchive.sha256 !== archive.sha256) {
    fail('artifact_digest_mismatch')
  }

  const expectedNames = [INDEX_NAME, manifestName, archiveName]
  if (exclusive) {
    assertExclusiveDirectory(sourceDirectory, expectedNames)
  }

  return {
    version: artifact.version,
    platform: index.platform,
    arch: index.arch,
    indexName: INDEX_NAME,
    indexPath: resolvedIndexPath,
    manifestName,
    manifestPath,
    archiveName,
    archivePath,
    archiveSha256: actualArchive.sha256,
    archiveSize: actualArchive.size,
    sourceDirectory,
  }
}

function copyRegularFile(sourcePath, destinationPath, maxBytes, kind) {
  const { descriptor: source, size } = openBoundedRegularFile(sourcePath, maxBytes, kind, {
    allowEmpty: true,
  })
  let destination
  try {
    destination = openSync(
      destinationPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o644,
    )
    const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, Math.max(size, 1)))
    let offset = 0
    while (offset < size) {
      const read = readSync(source, buffer, 0, Math.min(buffer.length, size - offset), offset)
      if (read === 0) {
        fail(`${kind}_changed`)
      }
      let written = 0
      while (written < read) {
        written += writeSync(destination, buffer, written, read - written)
      }
      offset += read
    }
  } finally {
    closeSync(source)
    if (destination !== undefined) {
      closeSync(destination)
    }
  }
}

export async function inspectDesktopArtifactTrio(indexPath, options = {}) {
  return inspectDesktopArtifactTrioSync(indexPath, options)
}

export async function verifyDesktopArtifactTrio(indexPath, options = {}) {
  return inspectDesktopArtifactTrioSync(indexPath, options)
}

export function inspectDesktopArtifactTrioSync(indexPath, options = {}) {
  return inspect(indexPath, options)
}

export async function stageDesktopArtifactTrio(
  indexPath,
  destinationDirectory,
  { exclusiveSource = false } = {},
) {
  const source = inspectDesktopArtifactTrioSync(indexPath, { exclusive: exclusiveSource })
  const destination = path.resolve(destinationDirectory)
  let created = false
  try {
    mkdirSync(destination, { mode: 0o755 })
    created = true
    copyRegularFile(source.indexPath, path.join(destination, source.indexName), INDEX_MAX_BYTES, 'artifact_index')
    copyRegularFile(
      source.manifestPath,
      path.join(destination, source.manifestName),
      MANIFEST_MAX_BYTES,
      'artifact_manifest',
    )
    copyRegularFile(
      source.archivePath,
      path.join(destination, source.archiveName),
      ARCHIVE_MAX_BYTES,
      'artifact_archive',
    )
    return inspectDesktopArtifactTrioSync(path.join(destination, INDEX_NAME), { exclusive: true })
  } catch (error) {
    if (created) {
      rmSync(destination, { recursive: true, force: true })
    }
    if (!created && error && typeof error === 'object' && error.code === 'EEXIST') {
      fail('artifact_destination_exists')
    }
    throw error
  }
}

function cliResult(command, result) {
  return {
    status: 'ok',
    command,
    version: result.version,
    platform: result.platform,
    arch: result.arch,
    index: result.indexName,
    manifest: result.manifestName,
    archive: result.archiveName,
    archiveSha256: result.archiveSha256,
    archiveSize: result.archiveSize,
  }
}

async function main(argv) {
  const [command, indexPath, destinationOrFlag, possibleFlag, ...rest] = argv
  if (rest.length > 0 || !['inspect', 'verify', 'stage'].includes(command)) {
    fail('invalid_arguments')
  }
  if (command === 'inspect') {
    if (!indexPath || destinationOrFlag !== undefined) {
      fail('invalid_arguments')
    }
    return cliResult(command, await inspectDesktopArtifactTrio(indexPath))
  }
  if (command === 'verify') {
    if (!indexPath || (destinationOrFlag !== undefined && destinationOrFlag !== '--exclusive') || possibleFlag) {
      fail('invalid_arguments')
    }
    return cliResult(
      command,
      await verifyDesktopArtifactTrio(indexPath, { exclusive: destinationOrFlag === '--exclusive' }),
    )
  }
  if (
    !indexPath ||
    !destinationOrFlag ||
    (possibleFlag !== undefined && possibleFlag !== '--exclusive-source')
  ) {
    fail('invalid_arguments')
  }
  return cliResult(
    command,
    await stageDesktopArtifactTrio(indexPath, destinationOrFlag, {
      exclusiveSource: possibleFlag === '--exclusive-source',
    }),
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`)
    })
    .catch((error) => {
      const code =
        error instanceof DesktopArtifactTrioError ? error.code : 'artifact_trio_internal_error'
      process.stderr.write(`${JSON.stringify({ status: 'error', code })}\n`)
      process.exitCode = 1
    })
}
