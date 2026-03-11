<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# workflow — Graph Execution Engine

## Purpose
A lightweight LangGraph-inspired directed graph execution engine. `graph-engine.ts` allows defining nodes (processing steps) and edges (transitions with optional conditions), then executing the graph from a start node through to terminal nodes. Used to model multi-step AI workflows such as research pipelines and agent loops where the next step depends on the output of the current step.

## Key Files
| File | Description |
|------|-------------|
| `graph-engine.ts` | Graph definition API (`addNode`, `addEdge`), execution engine (`run`), cycle detection |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- The engine must detect cycles and throw on infinite loops — do not remove the cycle detection guard
- Nodes are async functions: `(state: GraphState) => Promise<GraphState>` — state is immutable between nodes (return new state)
- Conditional edges use a predicate: `addEdge('nodeA', 'nodeB', (state) => state.confidence > 0.8)`
- Terminal nodes (no outgoing edges) end the graph execution
- Keep this engine generic — no domain logic (no LLM calls, no DB access) in `graph-engine.ts` itself

### Testing Requirements
- Test linear graph: A → B → C, verify all nodes execute in order
- Test conditional branching: verify correct branch is taken based on state
- Test cycle detection: graph with A → B → A should throw
- Run `npm run test:bun`

### Common Patterns
- Graph definition: `const g = new GraphEngine(); g.addNode('classify', classifyFn); g.addEdge('classify', 'respond')`
- Execution: `const finalState = await g.run('classify', initialState)`
- State is a plain object; each node returns a modified copy (spread operator pattern)

## Dependencies
### Internal
- Used by: `services/DeepResearchService.ts`, `ollama/agent-loop.ts` (if refactored to use graph engine)

### External
- None — pure TypeScript implementation with no external dependencies

<!-- MANUAL: -->
