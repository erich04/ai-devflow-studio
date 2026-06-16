# ADR 0002: Git Markdown Knowledge Source

## Status

Accepted

## Context

Team knowledge should stay reviewable, portable, and close to code.

## Decision

Use Git-managed Markdown as the source of truth for the knowledge base. The app provides indexing,
editing, graph visualization, and retrieval on top of those files.

## Consequences

- Knowledge changes can be reviewed like code.
- Teams can keep knowledge beside project repositories.
- The first knowledge graph remains lightweight and does not require Neo4j.
