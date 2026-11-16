// Topology: hub → broker → group → node → observer → parameter, and its layered layout.
import type { MetadataVersion, NodeStatus } from '@fmde-hub/fmde'
import { describe, expect, it } from 'vitest'
import type { NetworkNode } from '../src/network'
import { buildTopology, layoutLayered } from '../src/topology'

function node(group: string, id: string, state: NodeStatus['state'], withMetadata = true): NetworkNode {
  const nodeKey = `${group}/${id}`
  return {
    status: { nodeKey, group, nodeId: id, name: null, state } as NodeStatus,
    metadata: withMetadata
      ? ({
          node: { name: `Node ${id}` },
          observers: [{ id: 1, name: 'sensor' }],
          parameters: [
            { key: 'p1', seriesKey: `${nodeKey}#1`, longName: 'air temperature', unit: 'Cel', cellMethod: 'POINT', device: { kind: 'observer', observerId: 1 } },
            { key: 'p2', seriesKey: `${nodeKey}#2`, longName: 'battery voltage', unit: 'V', cellMethod: 'POINT', device: { kind: 'node' } },
          ],
        } as unknown as MetadataVersion)
      : null,
    battery: { value: 12.6, unit: 'V', time: '2026-11-16T08:00:00Z' },
  }
}

const network = [node('b', 'n2', 'SILENT'), node('a', 'n1', 'OK'), node('a', 'n3', 'NO_METADATA', false)]

describe('buildTopology', () => {
  it('links hub, broker, groups (sorted, worst state), nodes and observers', () => {
    const { nodes, edges } = buildTopology(network, { brokerLabel: 'broker.example.org' }, { showParameters: false, collapseGroups: false })
    expect(nodes.map((n) => n.id)).toEqual(['hub', 'broker', 'group:a', 'node:a/n1', 'node:a/n1/obs:1', 'node:a/n3', 'group:b', 'node:b/n2', 'node:b/n2/obs:1'])
    expect(nodes.find((n) => n.id === 'broker')?.sublabel).toBe('broker.example.org')
    expect(nodes.find((n) => n.id === 'group:a')).toMatchObject({ state: 'NO_METADATA', counts: { OK: 1, NO_METADATA: 1 } })
    expect(nodes.find((n) => n.id === 'node:a/n1')).toMatchObject({ label: 'Node n1', battery: { value: 12.6, unit: 'V' } })
    expect(edges).toContainEqual(expect.objectContaining({ source: 'group:b', target: 'node:b/n2', state: 'SILENT' }))
  })

  it('attaches parameters to their device, and marks those with empty values', () => {
    const { edges } = buildTopology(network, { emptyBySeries: { 'a/n1#1': 3 } }, { showParameters: true, collapseGroups: false })
    expect(edges).toContainEqual(expect.objectContaining({ source: 'node:a/n1/obs:1', target: 'node:a/n1/param:p1', attention: true }))
    expect(edges).toContainEqual(expect.objectContaining({ source: 'node:a/n1', target: 'node:a/n1/param:p2', attention: false }))
  })

  it('shows only the groups when collapsed', () => {
    const { nodes } = buildTopology(network, {}, { showParameters: true, collapseGroups: true })
    expect(nodes.map((n) => n.kind)).toEqual(['hub', 'broker', 'group', 'group'])
  })
})

describe('layoutLayered', () => {
  it('places every node, left to right by level', async () => {
    const { nodes, edges } = buildTopology(network, {}, { showParameters: false, collapseGroups: false })
    const pos = await layoutLayered(nodes, edges)
    expect(pos.size).toBe(nodes.length)
    expect(pos.get('hub')!.x).toBeLessThan(pos.get('broker')!.x)
    expect(pos.get('broker')!.x).toBeLessThan(pos.get('group:a')!.x)
    expect(pos.get('group:a')!.x).toBeLessThan(pos.get('node:a/n1')!.x)
  })
})
