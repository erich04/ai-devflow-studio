// @vitest-environment node
import { mkdtemp, rm, rename, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeAgentProvider, createOpenAiCompatibleAgentProvider, buildDesignRevisionIdentity, buildAgentReviewContext, createKnowledgeReviewPrompt, runWorkflowStageAgent } from '@ai-devflow/shared'
import { designRevisionFixture } from '../src/testing/design-revision'
import { createLocalStore } from './local-store'
import { commitDesignRevision } from './design-revision-completion'
import { requireCurrentDesignRevision } from './gate-approval-design'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

async function fixture(long = false) {
  const f = await designRevisionFixture()
  if (long) {
    f.design.content += '\n原有技术方案：保留全部任务。'.repeat(6_000)
    f.proposal.content += '\n新增阅读提示，不变更需求。'.repeat(2_000)
    f.selection.previous = await buildDesignRevisionIdentity(f.design)
    f.selection.proposals = [await buildDesignRevisionIdentity(f.proposal)]
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-revision-'))
  dirs.push(dir)
  const dbPath = path.join(dir, 'state.sqlite')
  const store = await createLocalStore({ dbPath })
  await store.saveRun(f.run)
  for (const artifact of f.artifacts) await store.saveArtifact(artifact)
  const provider = long ? createOpenAiCompatibleAgentProvider({id:'deepseek',model:'deepseek-flash',apiKey:'fixture',baseUrl:'https://api.deepseek.com',fetcher:async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.messages[1].content).toContain(f.design.content)
    expect(body.messages[1].content).toContain(f.proposal.content)
    return Response.json({choices:[{message:{content:JSON.stringify({title:'Long revised design',summary:'Preserve all requirements.',content:f.design.content+'\n'+f.proposal.content,goals:['Search'],acceptanceCriteria:['Preserve tasks'],nonGoals:['Dependencies'],openQuestions:[],assumptions:[],risks:[]})},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100}})
  }}) : createFakeAgentProvider()
  const generated = await runWorkflowStageAgent({ ...f, provider, requestedBy: 'user-1', runtime: 'electron', designRevision: f.selection })
  return { ...f, store, dbPath, generated, gateNodeId: f.run.currentNodeId, request: f.selection,
    actor: { userId: 'user-1', userName: 'User' } }
}

describe('design revision durable completion', () => {
  it('saves a long proposal and revised formal design intact, restarts, and sends the full new subject to Gate review', async () => {
    const f = await fixture(true)
    expect(f.proposal.content.length).toBeGreaterThan(18_000)
    expect(new TextEncoder().encode(f.generated.artifact.content).byteLength).toBeGreaterThan(64 * 1024)
    const result = await commitDesignRevision(f)
    const reopened = await createLocalStore({dbPath:f.dbPath})
    const artifacts=await reopened.listArtifacts(f.run.id)
    expect(artifacts.find(item=>item.id===result.artifact.id)?.content).toBe(f.generated.artifact.content)
    const gate=result.run.nodes.find(node=>node.id===result.run.currentNodeId)!
    const context=await buildAgentReviewContext({run:result.run,node:gate,artifacts,testEvidence:[],knowledgeDocuments:[],knowledgeChunks:[]})
    expect(context.manifest.coverage).toBe('deterministically_chunked')
    const subject=context.subjectArtifacts.find(item=>item.id===result.artifact.id)!
    expect(subject.chunks.map(chunk=>chunk.content).join('')).toBe(f.generated.artifact.content)
    const prompt=createKnowledgeReviewPrompt(context)
    expect(prompt).toContain('Long revised design')
    expect(result.run.status).toBe('paused_at_gate')
    reopened.close()
  })

  it('persists a new review subject, its provenance and usage while retaining the original after restart', async () => {
    const f = await fixture()
    const result = await commitDesignRevision(f)
    const reopened = await createLocalStore({ dbPath: f.dbPath })
    expect(await reopened.getRun(f.run.id)).toEqual(result.run)
    expect(result.run).toMatchObject({ currentNodeId: f.run.currentNodeId, status: 'paused_at_gate' })
    const artifacts = await reopened.listArtifacts(f.run.id)
    expect(artifacts.find((a) => a.id === f.design.id)).toEqual(f.design)
    expect(artifacts.find((a) => a.id === f.proposal.id)).toEqual(f.proposal)
    expect(artifacts.find((a) => a.id === result.artifact.id)).toEqual(f.generated.artifact)
    expect(await reopened.listAgentTraces(f.run.id)).toHaveLength(1)
    expect(await reopened.listAgentTokenUsage(f.run.id)).toHaveLength(1)
    expect((await reopened.listEvents(f.run.id))[0]?.nodeId).toBe(f.gateNodeId)
    await expect(requireCurrentDesignRevision({ run: result.run,
      gateNode: result.run.nodes.find((node) => node.id === f.gateNodeId)!, artifacts,
      expected: f.selection.previous })).rejects.toThrow(/no longer current/)
  })

  it.each(['progress', 'proposal', 'cancel', 'persistence'] as const)('keeps the old design and phase on %s failure', async (failure) => {
    const f = await fixture()
    if (failure === 'progress') await f.store.saveRun({ ...f.run, version: f.run.version + 1 })
    if (failure === 'proposal') await f.store.saveArtifact({ ...f.proposal, content: 'changed opinion' })
    if (failure === 'persistence') { await rename(f.dbPath, `${f.dbPath}.backup`); await mkdir(f.dbPath) }
    const before = await f.store.getRun(f.run.id)
    await expect(commitDesignRevision({ ...f, beforeCommit: () => {
      if (failure === 'cancel') throw new Error('cancelled')
    } })).rejects.toThrow()
    expect(await f.store.getRun(f.run.id)).toEqual(before)
    expect((await f.store.listArtifacts(f.run.id)).find((a) => a.id === f.design.id)).toEqual(f.design)
    expect((await f.store.listArtifacts(f.run.id)).some((a) => a.id === f.generated.artifact.id)).toBe(false)
    expect(await f.store.listAgentTraces(f.run.id)).toEqual([])
  })

  it('checks source snapshots inside the durable mutation, including changes while waiting to commit', async () => {
    const f = await fixture()
    await f.store.saveArtifact({ ...f.proposal, content: 'new opinion' })
    const result = await f.store.commitWorkflowMutation({ expectedRun: f.run, run: { ...f.run, version: f.run.version + 1 },
      expectedArtifacts: [f.proposal], artifacts: [f.generated.artifact] })
    expect(result).toEqual({ committed: false, reason: 'stale_artifact' })
    expect(await f.store.getRun(f.run.id)).toEqual(f.run)
  })
})
