import { createServer } from 'node:http'
import assert from 'node:assert/strict'

/** Query a genuinely completed packaged workflow through the production conversation API. */
export async function probeCompletedWorkflow({ page, run, projectId }) {
  // This loopback protocol fixture uses a priced model ID so the production
  // budget guard can admit each round. No request goes to an external model.
  const fixtureModel = 'gpt-4.1-mini'
  const seen = new Map()
  let calls = 0
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    assert.equal(body.model, fixtureModel)
    const input = JSON.parse(body.messages.find((message) => message.role === 'user').content)
    for (const observation of input.toolObservations) {
      if (observation.name === 'node' && observation.result?.node) seen.set(observation.result.node.id, observation.result)
    }
    const node = run.nodes[calls++]
    const value = node
      ? { tool: { name: 'node', args: { runId: run.id, nodeId: node.id } } }
      : { text: '全部阶段已经完成，测试和交付证据可查看。', actions: [{ label: '查看最终验收', runId: run.id, nodeId: run.nodes.find((item) => item.kind === 'acceptance').id, section: 'Final Gate' }] }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 30, completion_tokens: 10 } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const provider = await page.evaluate(({baseUrl, model}) => window.aiDevFlowDesktop.saveAgentProviderCredential({
      name: 'Completed workflow test', model, apiKey: 'sk-completed-flow-test-only', baseUrl,
    }), {baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: fixtureModel})
    const created = await page.evaluate((projectId) => window.aiDevFlowDesktop.workbenchConversation({ type: 'create', projectId }), projectId)
    const conversationId = created.conversationId
    const sent = await page.evaluate((input) => window.aiDevFlowDesktop.workbenchConversation(input), { type: 'send', projectId, conversationId, providerId: provider.providerId, text: '查询全部节点已经实际完成的状态、证据和审批。' })
    assert.equal(sent.error, undefined)
    let conversation
    const started = Date.now()
    do {
      const result = await page.evaluate((projectId) => window.aiDevFlowDesktop.workbenchConversation({ type: 'list', projectId }), projectId)
      conversation = result.conversations.find((item) => item.id === conversationId)
      if (conversation?.status !== 'running') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() - started < 30000)
    assert.equal(conversation?.status, 'idle', conversation?.error)
    assert.equal(seen.size, run.nodes.length)
    for (const node of run.nodes) {
      const actual = seen.get(node.id)
      assert.equal(actual.node.status, node.status)
      assert.equal(actual.runVersion, run.version)
      assert.equal(actual.execution.runTestEvidence.some((evidence) => evidence.status === 'passed'), true)
      if (node.kind === 'gate' || node.kind === 'acceptance') assert.ok(actual.gate)
      if (node.kind === 'task') assert.ok(actual.execution.coding.length)
      if (node.kind === 'pr' || node.kind === 'acceptance') assert.equal(actual.execution.delivery.some((intent) => intent.status === 'completed'), true)
    }
    const state = await page.evaluate(() => window.aiDevFlowDesktop.loadState())
    assert.equal(state.runs.find((item) => item.id === run.id).version, run.version)
    return { allCompletedNodesRead: seen.size, realPassedTestEvidence: true, codingAndDeliveryRead: true, finalGateRead: true, modelCalls: calls, workflowMutations: 0 }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
