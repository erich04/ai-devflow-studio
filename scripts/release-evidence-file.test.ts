import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readBoundedJsonFileSync,
  readBoundedUtf8FileSync,
  ReleaseEvidenceFileError,
  sha256BoundedRegularFileSync,
} from './release-evidence-file.mjs'

describe('release evidence file boundary', () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reads valid JSON from a regular file within the byte limit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const evidencePath = join(directory, 'evidence.json')
    writeFileSync(evidencePath, '{"status":"passed","count":2}')

    expect(readBoundedJsonFileSync(evidencePath, 64)).toEqual({
      status: 'passed',
      count: 2,
    })
  })

  it('rejects a symbolic link with a fixed safe error code', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const targetPath = join(directory, 'target.json')
    const evidencePath = join(directory, 'evidence.json')
    writeFileSync(targetPath, '{"secret":"must-not-leak"}')
    symlinkSync(targetPath, evidencePath)

    expect(() => readBoundedJsonFileSync(evidencePath)).toThrowError(
      expect.objectContaining({
        name: 'ReleaseEvidenceFileError',
        code: 'RELEASE_EVIDENCE_FILE_SYMLINK',
        message: 'RELEASE_EVIDENCE_FILE_SYMLINK',
      }) as ReleaseEvidenceFileError,
    )
  })

  it('rejects a directory with a fixed safe error code', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const evidencePath = join(directory, 'evidence.json')
    mkdirSync(evidencePath)

    expect(() => readBoundedJsonFileSync(evidencePath)).toThrowError(
      expect.objectContaining({
        name: 'ReleaseEvidenceFileError',
        code: 'RELEASE_EVIDENCE_FILE_NOT_REGULAR',
        message: 'RELEASE_EVIDENCE_FILE_NOT_REGULAR',
      }) as ReleaseEvidenceFileError,
    )
  })

  it('rejects a regular file over the byte limit without leaking its path or content', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const evidencePath = join(directory, 'evidence.json')
    writeFileSync(evidencePath, '{"password":"must-not-leak"}')

    let caughtError: unknown
    try {
      readBoundedJsonFileSync(evidencePath, 8)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(ReleaseEvidenceFileError)
    expect(caughtError).toMatchObject({
      code: 'RELEASE_EVIDENCE_FILE_TOO_LARGE',
      message: 'RELEASE_EVIDENCE_FILE_TOO_LARGE',
    })
    expect(String(caughtError)).not.toContain(evidencePath)
    expect(String(caughtError)).not.toContain('must-not-leak')
  })

  it('rejects invalid UTF-8 with a fixed safe error code', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const evidencePath = join(directory, 'evidence.json')
    writeFileSync(
      evidencePath,
      Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
    )

    expect(() => readBoundedJsonFileSync(evidencePath)).toThrowError(
      expect.objectContaining({
        code: 'RELEASE_EVIDENCE_FILE_INVALID_UTF8',
        message: 'RELEASE_EVIDENCE_FILE_INVALID_UTF8',
      }) as ReleaseEvidenceFileError,
    )
  })

  it('rejects invalid JSON without leaking parser details or content', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const evidencePath = join(directory, 'evidence.json')
    writeFileSync(evidencePath, '{"secret":"must-not-leak",}')

    let caughtError: unknown
    try {
      readBoundedJsonFileSync(evidencePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(ReleaseEvidenceFileError)
    expect(caughtError).toMatchObject({
      code: 'RELEASE_EVIDENCE_FILE_INVALID_JSON',
      message: 'RELEASE_EVIDENCE_FILE_INVALID_JSON',
    })
    expect(String(caughtError)).not.toContain('must-not-leak')
    expect(String(caughtError)).not.toContain(evidencePath)
  })

  it('maps filesystem failures to a fixed safe error code', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const evidencePath = join(directory, 'missing-sensitive-name.json')

    let caughtError: unknown
    try {
      readBoundedJsonFileSync(evidencePath)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(ReleaseEvidenceFileError)
    expect(caughtError).toMatchObject({
      code: 'RELEASE_EVIDENCE_FILE_READ_FAILED',
      message: 'RELEASE_EVIDENCE_FILE_READ_FAILED',
    })
    expect(String(caughtError)).not.toContain(evidencePath)
    expect(String(caughtError)).not.toContain('ENOENT')
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid byte limit %s with a fixed safe error code',
    (maxBytes) => {
      expect(() => readBoundedJsonFileSync('unused-sensitive-path', maxBytes)).toThrowError(
        expect.objectContaining({
          code: 'RELEASE_EVIDENCE_FILE_INVALID_LIMIT',
          message: 'RELEASE_EVIDENCE_FILE_INVALID_LIMIT',
        }) as ReleaseEvidenceFileError,
      )
    },
  )

  it('computes the SHA-256 digest of a regular file within the byte limit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const artifactPath = join(directory, 'artifact.tar.gz')
    writeFileSync(artifactPath, 'abc')

    expect(sha256BoundedRegularFileSync(artifactPath, 3)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('refuses to hash a symbolic link', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const targetPath = join(directory, 'target.tar.gz')
    const artifactPath = join(directory, 'artifact.tar.gz')
    writeFileSync(targetPath, 'abc')
    symlinkSync(targetPath, artifactPath)

    expect(() => sha256BoundedRegularFileSync(artifactPath, 64)).toThrowError(
      expect.objectContaining({
        code: 'RELEASE_EVIDENCE_FILE_SYMLINK',
        message: 'RELEASE_EVIDENCE_FILE_SYMLINK',
      }) as ReleaseEvidenceFileError,
    )
  })

  it('refuses to hash a directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const artifactPath = join(directory, 'artifact.tar.gz')
    mkdirSync(artifactPath)

    expect(() => sha256BoundedRegularFileSync(artifactPath, 64)).toThrowError(
      expect.objectContaining({
        code: 'RELEASE_EVIDENCE_FILE_NOT_REGULAR',
        message: 'RELEASE_EVIDENCE_FILE_NOT_REGULAR',
      }) as ReleaseEvidenceFileError,
    )
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses to hash with invalid byte limit %s',
    (maxBytes) => {
      expect(() =>
        sha256BoundedRegularFileSync('unused-sensitive-path', maxBytes),
      ).toThrowError(
        expect.objectContaining({
          code: 'RELEASE_EVIDENCE_FILE_INVALID_LIMIT',
          message: 'RELEASE_EVIDENCE_FILE_INVALID_LIMIT',
        }) as ReleaseEvidenceFileError,
      )
    },
  )

  it('maps hash filesystem failures to a fixed safe error code', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const artifactPath = join(directory, 'missing-sensitive-name.tar.gz')

    let caughtError: unknown
    try {
      sha256BoundedRegularFileSync(artifactPath, 64)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(ReleaseEvidenceFileError)
    expect(caughtError).toMatchObject({
      code: 'RELEASE_EVIDENCE_FILE_READ_FAILED',
      message: 'RELEASE_EVIDENCE_FILE_READ_FAILED',
    })
    expect(String(caughtError)).not.toContain(artifactPath)
    expect(String(caughtError)).not.toContain('ENOENT')
  })

  it('refuses to hash a regular file over the byte limit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const artifactPath = join(directory, 'artifact.tar.gz')
    writeFileSync(artifactPath, 'abcd')

    expect(() => sha256BoundedRegularFileSync(artifactPath, 3)).toThrowError(
      expect.objectContaining({
        code: 'RELEASE_EVIDENCE_FILE_TOO_LARGE',
        message: 'RELEASE_EVIDENCE_FILE_TOO_LARGE',
      }) as ReleaseEvidenceFileError,
    )
  })

  it('reads bounded UTF-8 text from a regular file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const evidencePath = join(directory, 'result.md')
    writeFileSync(evidencePath, 'release: 通过\n')

    expect(readBoundedUtf8FileSync(evidencePath, 64)).toBe('release: 通过\n')
  })

  it('decodes a multi-byte UTF-8 character split across read chunks', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const evidencePath = join(directory, 'result.md')
    const evidence = `${'a'.repeat(64 * 1024 - 1)}通`
    writeFileSync(evidencePath, evidence)

    expect(readBoundedUtf8FileSync(evidencePath, Buffer.byteLength(evidence))).toBe(
      evidence,
    )
  })

  it('hashes a regular file across multiple bounded read chunks', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const artifactPath = join(directory, 'artifact.tar.gz')
    const artifact = Buffer.alloc(64 * 1024 * 2 + 17, 0xa5)
    writeFileSync(artifactPath, artifact)

    expect(sha256BoundedRegularFileSync(artifactPath, artifact.byteLength)).toBe(
      createHash('sha256').update(artifact).digest('hex'),
    )
  })

  it('refuses to read UTF-8 text through a symbolic link', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-evidence-file-'))
    temporaryDirectories.push(directory)
    const targetPath = join(directory, 'target.md')
    const evidencePath = join(directory, 'result.md')
    writeFileSync(targetPath, 'secret: must-not-leak')
    symlinkSync(targetPath, evidencePath)

    expect(() => readBoundedUtf8FileSync(evidencePath, 64)).toThrowError(
      expect.objectContaining({
        code: 'RELEASE_EVIDENCE_FILE_SYMLINK',
        message: 'RELEASE_EVIDENCE_FILE_SYMLINK',
      }) as ReleaseEvidenceFileError,
    )
  })
})
