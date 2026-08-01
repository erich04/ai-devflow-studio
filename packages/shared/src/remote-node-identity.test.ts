import { describe, expect, it } from 'vitest'
import {
  assertCanonicalLocalNodeId,
  fromTeamStoredNodeId,
  toTeamStoredNodeId,
} from './remote-node-identity'

describe('remote node identity', () => {
  it('round-trips one canonical local node ID through exactly one Team prefix', () => {
    const stored = toTeamStoredNodeId('run-1', 'gate-1')

    expect(stored).toBe('run-1:gate-1')
    expect(fromTeamStoredNodeId('run-1', stored)).toBe('gate-1')
    expect(toTeamStoredNodeId('run_%_1', 'gate_1')).toBe(
      'run_%_1:gate_1',
    )
  })

  it('rejects empty, padded, or overlong Run and node IDs', () => {
    const invalidPairs: Array<readonly [string, string]> = [
      ['', 'gate-1'],
      [' run-1', 'gate-1'],
      ['run-1 ', 'gate-1'],
      ['run-1', ''],
      ['run-1', ' gate-1'],
      ['run-1', 'gate-1 '],
      ['r'.repeat(201), 'gate-1'],
      ['run-1', 'g'.repeat(201)],
    ]
    for (const [runId, nodeId] of invalidPairs) {
      expect(() => assertCanonicalLocalNodeId(runId, nodeId)).toThrow(
        'Invalid local Run or node ID.',
      )
    }
  })

  it('rejects a local ID in the reserved namespace and malformed stored IDs', () => {
    expect(() => toTeamStoredNodeId('run-1', 'run-1:gate-1')).toThrow(
      'Local node ID uses the reserved Team node namespace.',
    )
    expect(() => fromTeamStoredNodeId('run-1', 'run-other:gate-1')).toThrow(
      'Stored Team node ID is outside the Run namespace.',
    )
    expect(() => fromTeamStoredNodeId('run-1', 'run-1:')).toThrow(
      'Stored Team node ID is not canonical.',
    )
    expect(() =>
      fromTeamStoredNodeId('run-1', 'run-1:run-1:gate-1'),
    ).toThrow('Stored Team node ID is not canonical.')
  })
})
