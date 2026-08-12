import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs'

const DEFAULT_TEXT_MAX_BYTES = 64 * 1024
const READ_CHUNK_BYTES = 64 * 1024

export const RELEASE_EVIDENCE_FILE_ERROR_CODES = Object.freeze({
  changed: 'RELEASE_EVIDENCE_FILE_CHANGED',
  invalidJson: 'RELEASE_EVIDENCE_FILE_INVALID_JSON',
  invalidLimit: 'RELEASE_EVIDENCE_FILE_INVALID_LIMIT',
  invalidUtf8: 'RELEASE_EVIDENCE_FILE_INVALID_UTF8',
  notRegular: 'RELEASE_EVIDENCE_FILE_NOT_REGULAR',
  readFailed: 'RELEASE_EVIDENCE_FILE_READ_FAILED',
  symlink: 'RELEASE_EVIDENCE_FILE_SYMLINK',
  tooLarge: 'RELEASE_EVIDENCE_FILE_TOO_LARGE',
})

export class ReleaseEvidenceFileError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ReleaseEvidenceFileError'
    this.code = code
  }
}

function evidenceFileError(code) {
  return new ReleaseEvidenceFileError(code)
}

function validateLimit(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw evidenceFileError(RELEASE_EVIDENCE_FILE_ERROR_CODES.invalidLimit)
  }
}

function safeFilesystemCall(operation) {
  try {
    return operation()
  } catch {
    throw evidenceFileError(RELEASE_EVIDENCE_FILE_ERROR_CODES.readFailed)
  }
}

function assertRegularFile(fileStat) {
  if (fileStat.isSymbolicLink()) {
    throw evidenceFileError(RELEASE_EVIDENCE_FILE_ERROR_CODES.symlink)
  }
  if (!fileStat.isFile()) {
    throw evidenceFileError(RELEASE_EVIDENCE_FILE_ERROR_CODES.notRegular)
  }
}

function assertWithinLimit(fileStat, maxBytes) {
  if (fileStat.size > BigInt(maxBytes)) {
    throw evidenceFileError(RELEASE_EVIDENCE_FILE_ERROR_CODES.tooLarge)
  }
}

function assertSameFile(expected, actual) {
  if (expected.dev !== actual.dev || expected.ino !== actual.ino) {
    throw evidenceFileError(RELEASE_EVIDENCE_FILE_ERROR_CODES.changed)
  }
}

function assertUnchangedFile(expected, actual) {
  assertSameFile(expected, actual)
  if (
    expected.size !== actual.size ||
    expected.mtimeNs !== actual.mtimeNs ||
    expected.ctimeNs !== actual.ctimeNs
  ) {
    throw evidenceFileError(RELEASE_EVIDENCE_FILE_ERROR_CODES.changed)
  }
}

function readBoundedRegularFileChunksSync(filePath, maxBytes, onChunk) {
  validateLimit(maxBytes)

  const pathStat = safeFilesystemCall(() => lstatSync(filePath, { bigint: true }))
  assertRegularFile(pathStat)
  assertWithinLimit(pathStat, maxBytes)

  const noFollowFlag =
    typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const fileDescriptor = safeFilesystemCall(() =>
    openSync(filePath, constants.O_RDONLY | noFollowFlag),
  )

  try {
    const openedStat = safeFilesystemCall(() =>
      fstatSync(fileDescriptor, { bigint: true }),
    )
    if (!openedStat.isFile()) {
      throw evidenceFileError(RELEASE_EVIDENCE_FILE_ERROR_CODES.notRegular)
    }
    assertUnchangedFile(pathStat, openedStat)
    assertWithinLimit(openedStat, maxBytes)

    const buffer = Buffer.alloc(READ_CHUNK_BYTES)
    let bytesReadTotal = 0

    while (true) {
      const remainingBytes = maxBytes - bytesReadTotal
      const bytesToRead =
        remainingBytes >= READ_CHUNK_BYTES ? READ_CHUNK_BYTES : remainingBytes + 1
      const bytesRead = safeFilesystemCall(() =>
        readSync(fileDescriptor, buffer, 0, bytesToRead, null),
      )

      if (bytesRead === 0) {
        break
      }
      if (bytesRead > remainingBytes) {
        throw evidenceFileError(RELEASE_EVIDENCE_FILE_ERROR_CODES.tooLarge)
      }

      onChunk(buffer.subarray(0, bytesRead))
      bytesReadTotal += bytesRead
    }

    const completedStat = safeFilesystemCall(() =>
      fstatSync(fileDescriptor, { bigint: true }),
    )
    assertUnchangedFile(openedStat, completedStat)
  } finally {
    try {
      closeSync(fileDescriptor)
    } catch {
      // The descriptor is never exposed, and close failures must not leak system details.
    }
  }
}

export function readBoundedUtf8FileSync(
  filePath,
  maxBytes = DEFAULT_TEXT_MAX_BYTES,
) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const textChunks = []

  readBoundedRegularFileChunksSync(filePath, maxBytes, (chunk) => {
    try {
      textChunks.push(decoder.decode(chunk, { stream: true }))
    } catch {
      throw evidenceFileError(RELEASE_EVIDENCE_FILE_ERROR_CODES.invalidUtf8)
    }
  })

  try {
    textChunks.push(decoder.decode())
  } catch {
    throw evidenceFileError(RELEASE_EVIDENCE_FILE_ERROR_CODES.invalidUtf8)
  }
  return textChunks.join('')
}

export function readBoundedJsonFileSync(
  filePath,
  maxBytes = DEFAULT_TEXT_MAX_BYTES,
) {
  const text = readBoundedUtf8FileSync(filePath, maxBytes)
  try {
    return JSON.parse(text)
  } catch {
    throw evidenceFileError(RELEASE_EVIDENCE_FILE_ERROR_CODES.invalidJson)
  }
}

export function sha256BoundedRegularFileSync(filePath, maxBytes) {
  const hash = createHash('sha256')
  readBoundedRegularFileChunksSync(filePath, maxBytes, (chunk) => hash.update(chunk))
  return hash.digest('hex')
}
