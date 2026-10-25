import { expect, it } from 'vitest'
import { parseKnowledgeModel, knowledgeModelLabels } from './hindsight'

it('generates a bounded semantic extraction contract and rejects authority or executable fields', () => {
  const input = { version: 'refund-v1', dimensions: [
    { key: 'sem_kind', type: 'multi-values', values: [{ value: 'business_rule' }, { value: 'module' }] },
    { key: 'sem_rule', type: 'map', fields: { name: { type: 'text' }, statement: { type: 'text' } } },
  ] }
  expect(knowledgeModelLabels(parseKnowledgeModel(input))).toEqual(input.dimensions)
  expect(() => parseKnowledgeModel({ ...input, endpoint: 'https://evil.test' })).toThrow()
  expect(() => parseKnowledgeModel({ ...input, dimensions: [{ key: 'df_approved', type: 'text' }] })).toThrow()
  expect(() => parseKnowledgeModel({ ...input, dimensions: [{ key: 'sem_rule', type: 'map', fields: { command: { type: 'script' } } }] })).toThrow()
})

it('enforces the model size limit in UTF-8 bytes for non-ASCII descriptions', () => {
  const fields = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`field_${i}`, { type: 'text', description: '文'.repeat(500) }]))
  expect(() => parseKnowledgeModel({ version: 'v1', dimensions: [{ key: 'sem_rule', type: 'map', fields }] })).toThrow('过大')
})
