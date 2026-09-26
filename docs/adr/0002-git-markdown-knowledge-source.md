<a id="adr-0002-git-markdown-knowledge-source"></a>

# ADR 0002：以 Git Markdown 作为知识来源

<a id="status"></a>

## 状态

已接受（Accepted）。

<a id="context"></a>

## 背景

团队知识应当易于审查、便于迁移，并与代码保持接近。

<a id="decision"></a>

## 决策

以 Git 管理的 Markdown 作为知识库的权威来源。应用在这些文件之上提供索引、编辑、图谱可视化和检索能力。

<a id="consequences"></a>

## 影响

- 知识变更可以像代码一样接受审查。
- 团队可以将知识保存在项目仓库附近。
- 初期知识图谱保持轻量，不依赖 Neo4j。
