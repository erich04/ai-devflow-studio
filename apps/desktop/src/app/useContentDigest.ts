import { useCallback, useEffect, useState } from 'react'
import { createDesignRevisionDigest, sha256Text, type Artifact, type DesignRevisionIdentity } from '@ai-devflow/shared'
/**
 * Digests that bind a review to the text and key a design list (design §3.24, §5.11). A
 * module-level cache of 20 entries makes every later render synchronous, so the "正在核对…" row
 * appears only the first time a version is opened in a window. The cache holds digests only;
 * identities are rebuilt from each artifact on every call.
 */
const MAX_CACHED_DIGESTS = 20
const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()
function remember(key: string, value: string) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > MAX_CACHED_DIGESTS) cache.delete(cache.keys().next().value!)
}
/** Tests clear the cache before each case so "first render" cases do not depend on test order. */
export function clearContentDigestCacheForTests() {
  cache.clear()
  inflight.clear()
}
export type DigestResult = { state: 'pending' | 'done' | 'failed'; value?: string; error?: string; retry(): void }
function digestOnce(key: string, compute: () => Promise<string>): Promise<string> {
  const running = inflight.get(key)
  if (running) return running
  const promise = compute().then((value) => { remember(key, value); return value }).finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}
function useCachedDigest(key: string | undefined, compute: () => Promise<string>): DigestResult {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; attempt: number; state: 'done' | 'failed'; value?: string; error?: string }>()
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const cached = key === undefined ? undefined : cache.get(key)
  useEffect(() => {
    if (key === undefined || cache.has(key)) return
    let disposed = false
    digestOnce(key, compute).then(
      (value) => { if (!disposed) setResult({ key, attempt, state: 'done', value }) },
      (error: unknown) => { if (!disposed) setResult({ key, attempt, state: 'failed', error: error instanceof Error ? error.message : String(error) }) },
    )
    return () => { disposed = true }
    // `compute` always hashes the input that `key` names, so `key` is the only input dependency.
  }, [key, attempt])
  if (key === undefined) return { state: 'done', retry }     // nothing to hash
  if (cached !== undefined) return { state: 'done', value: cached, retry }
  if (result && result.key === key && result.attempt === attempt) {
    return { state: result.state, ...(result.value === undefined ? {} : { value: result.value }), ...(result.error === undefined ? {} : { error: result.error }), retry }
  }
  return { state: 'pending', retry }
}
/** `sha256Text(text)`; an `undefined` text is `done` without a value. */
export function useContentDigest(text: string | undefined): DigestResult {
  return useCachedDigest(text === undefined ? undefined : `content:${text}`, () => sha256Text(text!))
}
/** The design identity of `artifact`: its own id and recorded time with a cached digest. */
export function useDesignIdentity(artifact: Artifact | undefined): DigestResult & { identity?: DesignRevisionIdentity } {
  const key = artifact ? `design:${JSON.stringify({ title: artifact.title, summary: artifact.summary, content: artifact.content })}` : undefined
  const digest = useCachedDigest(key, () => createDesignRevisionDigest(artifact!))
  if (!artifact || digest.state !== 'done' || digest.value === undefined) return digest
  return { ...digest, identity: { artifactId: artifact.id, updatedAt: artifact.updatedAt, contentDigest: digest.value } }
}
