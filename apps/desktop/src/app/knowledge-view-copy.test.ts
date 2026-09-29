import { describe, expect, it } from 'vitest'
import { buildKnowledgeDataSource, formatLocalTime } from './desktop-view-model'
import {
  describeKnowledgeIndex,
  knowledgeCategoryLabel,
  knowledgeEntityKindLabel,
  knowledgeIndexWarningLabel,
  knowledgeRelationLabel,
} from './knowledge-view-copy'

const indexedAt = '2026-08-01T00:00:00.000Z'

describe('describeKnowledgeIndex', () => {
  it('maps every data-source label from buildKnowledgeDataSource to Chinese and keeps the raw values in details', () => {
    const snapshot = {
      projectId: 'local-project',
      contentHash: 'repository-hash',
      documents: [],
      chunks: [],
      entities: [],
      relations: [],
      indexedAt,
      truncated: false,
      warnings: [],
    }
    const cases = [
      [buildKnowledgeDataSource({ desktopConnected: false, dataOrigin: 'local' }), '尚未建立知识索引'],
      [buildKnowledgeDataSource({ desktopConnected: true, dataOrigin: 'local', isLoading: true }), '正在索引'],
      [buildKnowledgeDataSource({ desktopConnected: true, dataOrigin: 'local', snapshot }), '知识索引已更新 · 没有文档'],
      [buildKnowledgeDataSource({ desktopConnected: true, dataOrigin: 'local', snapshot: { ...snapshot, truncated: true } }), '知识索引已更新 · 结果不完整'],
      [buildKnowledgeDataSource({ desktopConnected: true, dataOrigin: 'local', snapshot, error: 'boom' }), '刷新失败 · 显示上次结果'],
      [buildKnowledgeDataSource({ desktopConnected: true, dataOrigin: 'local', error: 'boom' }), '知识索引不可用'],
    ] as const

    for (const [dataSource, badge] of cases) {
      const copy = describeKnowledgeIndex({ dataSource, documentCount: 0, indexedAt, isLoading: false })
      expect(copy.badge).toBe(badge)
      expect(copy.badge).not.toMatch(/[a-z]{3,}/)
      expect(copy.note).not.toContain(dataSource.label)
      expect(copy.note).not.toContain(dataSource.detail)
      expect(copy.details).toContainEqual({ label: '数据来源', value: `${dataSource.status} · ${dataSource.label}` })
      expect(copy.details).toContainEqual({ label: '说明', value: dataSource.detail })
    }
  })

  it('shows the local index time on the first layer and the ISO value in details', () => {
    const copy = describeKnowledgeIndex({
      dataSource: { status: 'local indexed', label: 'indexed', detail: '3 docs', tone: 'good' },
      documentCount: 3,
      indexedAt,
      isLoading: false,
    })

    expect(copy).toMatchObject({ badge: '知识索引已更新', note: '已索引 3 份 Git Markdown 文档。' })
    expect(copy.indexedAtLabel).toBe(`更新于 ${formatLocalTime(indexedAt)}`)
    expect(copy.details).toContainEqual({ label: '索引时间', value: indexedAt })
    expect(copy.details).toContainEqual({ label: '提示', value: '索引完成不代表内容已审查。' })
  })

  it('does not echo an unknown label on the first layer', () => {
    const copy = describeKnowledgeIndex({
      dataSource: { status: 'missing contract', label: 'something new', detail: 'x', tone: 'soft' },
      documentCount: 0,
      indexedAt: undefined,
      isLoading: false,
    })

    expect(copy).toMatchObject({ badge: '索引状态待核实', indexedAtLabel: '尚未索引' })
    expect(copy.details).toContainEqual({ label: '数据来源', value: 'missing contract · something new' })
  })
})

describe('knowledge labels', () => {
  it('translates categories, entity kinds, relations and warnings with a safe fallback', () => {
    expect(knowledgeCategoryLabel('testing_standard')).toBe('测试规范')
    expect(knowledgeCategoryLabel('custom')).toBe('其他文档')
    expect(knowledgeEntityKindLabel('standard')).toBe('规范')
    expect(knowledgeEntityKindLabel('unknown')).toBe('其他')
    expect(knowledgeRelationLabel('defines')).toBe('定义')
    expect(knowledgeRelationLabel('unknown')).toBe('关联')
    expect(knowledgeIndexWarningLabel('file_count_limit_exceeded')).toBe('文件数量超出上限')
    expect(knowledgeIndexWarningLabel('new_warning')).toBe('索引警告待核实')
  })
})
