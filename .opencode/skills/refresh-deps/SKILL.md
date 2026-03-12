---
name: refresh-deps
description: Refresh architecture dependency data (nodes, edges, descriptions) for scylla-archviz by analyzing the ScyllaDB source tree. Asks whether to update main or detailed view and what to add.
---

## What I do

Analyze the ScyllaDB C++ source tree to discover sharded services and their dependencies, then update the architecture graph data files used by scylla-archviz. Always refreshes everything: nodes (service classes), edges (dependencies between them), and dependency descriptions.

## When to use me

Use this skill when:
- New sharded services have been added to ScyllaDB and the graph needs updating
- Dependencies between existing services have changed
- Dependency descriptions are stale or missing
- You want to populate the detailed view with additional nodes/edges
- You want to verify the current graph data is accurate against the source

## Step-by-step procedure

### 1. Ask the user for inputs

Use the `question` tool to ask all questions at once:

**Question 1 — Target view:**
- **Main view** (`data/arch-nodes.js`) — the default graph with core sharded services
- **Detailed view** (`data/arch-detailed-nodes.js`) — extended graph with additional nodes/edges loaded via the "Detailed" button

**Question 2 — What to add:**
- **Auto-discover** — scan the source tree, present candidates, and ask me to confirm before adding
- **Specific classes** — I'll tell you exactly which classes to add (user types a comma-separated list)
- **Nothing new** — only update existing entries, don't add any new nodes

**Question 3 — Repository path:**
- Absolute path to the ScyllaDB git repo (e.g. `/code/nuivall/scylladb`)

The refresh always updates **everything** — nodes, edges, and descriptions — for all entries (existing + newly added).

### 2. Read the current data file

Read the target data file to understand what already exists:

- **Main view**: Read `data/arch-nodes.js` — contains `LAYERS`, `DEP_TYPES`, `classNodes`, `DEP_DESCRIPTIONS`, `classEdges`
- **Detailed view**: Read `data/arch-detailed-nodes.js` — contains `detailedClassNodes`, `detailedClassEdges`, `detailedDepDescriptions`

Build a set of existing node IDs and existing edge keys (`source->target->type`) from the file.

### 3. Discover classes

If the user chose **"Nothing new"**, skip discovery entirely and proceed to step 4 with only existing nodes.

If the user chose **"Specific classes"**, use the class names they provided — look up each one in the source tree to extract namespace, description, and layer. Skip the discovery scan below.

If the user chose **"Auto-discover"**, run the discovery procedure below for the target view, then **present the list of new candidates to the user** using the `question` tool (multi-select) and only add the ones they confirm.

#### Main view — sharded services only

Search the ScyllaDB source for classes that inherit from `peering_sharded_service` or `async_sharded_service`. These are the architectural building blocks shown on the main graph.

```bash
# Find all sharded service class declarations
rg -l 'peering_sharded_service|async_sharded_service' --glob '*.hh' <repo_path>
```

Only include services that are significant architectural components — core sharded services that participate in the dependency graph. Skip test helpers, internal utilities, and trivial wrappers.

**Present candidates**: After discovery, compare against existing `classNodes`. For any new classes not already in the file, present a multi-select question like:

> "I found N new sharded services not in the main view. Which ones should I add?"
> - `class_name` — brief description (from header)
> - ...

#### Detailed view — all architecturally relevant classes

The detailed view is **not limited to sharded services**. It includes any class that is an important sub-component, data structure, or abstraction in the architecture — for example `table`, `memtable`, `row_cache`, `token_metadata`, `topology`, `sstable`, `mutation_reader`, statement classes, etc.

To discover candidates, use a broader search strategy:

1. **Start from existing detailed nodes** — read the current `detailedClassNodes` to understand what's already tracked.
2. **Examine main-view node internals** — for each main-view node, read its header to find important owned/referenced member types (e.g., `database` owns `table` instances, `gossiper` owns `endpoint_state` maps).
3. **Follow dependency chains** — when a detailed node references another non-sharded class that is architecturally significant, consider adding it too.
4. **Search for key base classes and patterns**:
   ```bash
   # Sub-components of the storage layer
   rg -l 'class table ' --glob '*.hh' <repo_path>/replica/
   rg -l 'class memtable ' --glob '*.hh' <repo_path>/replica/
   rg -l 'class row_cache ' --glob '*.hh' <repo_path>/
   rg -l 'class sstable ' --glob '*.hh' <repo_path>/sstables/

   # Cluster layer internals
   rg -l 'class token_metadata ' --glob '*.hh' <repo_path>/locator/
   rg -l 'class topology ' --glob '*.hh' <repo_path>/locator/
   rg -l 'class tablet_' --glob '*.hh' <repo_path>/locator/

   # Query layer internals
   rg -l 'class select_statement ' --glob '*.hh' <repo_path>/cql3/
   rg -l 'class modification_statement ' --glob '*.hh' <repo_path>/cql3/
   ```
5. **Use judgement** — include classes that help the reader understand the internal structure of the main-view nodes. Skip trivial helpers, private implementation details, and test-only classes.

Do NOT duplicate nodes that already exist in `classNodes` (the main view data).

**Present candidates**: After discovery, compare against existing `detailedClassNodes` and `classNodes`. For any new classes not in either file, present a multi-select question like:

> "I found N new candidate classes for the detailed view. Which ones should I add?"
> - `class_name` (namespace) — brief description
> - ...

#### Common steps for both views

For each confirmed class:
1. Read the header file to extract the class name, namespace, and a brief description of what it does
2. Determine which layer it belongs to using the layer assignment rules below
3. Format as `{ id:'<class_name>', ns:'<namespace>', layer:'<layer>', desc:'<description>' }`

**Layer assignment rules:**

| Layer | Criteria |
|---|---|
| `storage` | Classes in `replica/`, `compaction/`, `sstables/`, `db/` (system_keyspace, batchlog, snapshot, view) |
| `cluster` | Classes in `gms/`, `locator/`, `streaming/`, `repair/`, `direct_failure_detector/`, Raft transport (raft_rpc, address_map, direct_fd_pinger) |
| `services` | Classes in `service/` (storage_service, storage_proxy, migration_manager, raft groups, QoS, CDC, auth, task_manager, cache_hitrate, paxos, view_update_backlog, tracing, mapreduce, strong_coordinator, groups_manager) |
| `query` | Classes in `cql3/`, `lang/`, `vector_search/` |
| `api` | Classes in `transport/`, `alternator/`, `audit/`, `service/client_routes` |

### 4. Discover dependencies

For each node (both existing and newly added), read the class header and implementation files to identify dependencies on other nodes in the graph.

**How to identify dependencies:**

| Pattern in source | Dependency type |
|---|---|
| `sharded_service_name&` (reference member) | `ref` |
| `sharded<service>&` or `sharded<service>*` | `sharded-ref` |
| `service*` (raw pointer member, late-init) | `raw-ptr` |
| `std::unique_ptr<service>` (owned member) | `unique-ptr` |
| `observer/listener` pattern (inherits listener interface) | `observer` |
| `pluggable` or late-init setter pattern | `pluggable` |
| Constructor parameter (service passed to ctor but not stored) | `ctor-param` |
| Method parameter only (service passed to individual methods) | `method-param` |

**Strength assignment** (1-8 scale):
- **1**: Single mention — one method call or one field access
- **2-3**: Light usage — a few call sites, used in specific operations
- **4-5**: Moderate usage — used in several operations, multiple methods
- **6-7**: Heavy usage — used throughout the class in many contexts
- **8**: Pervasive — deeply intertwined, used in almost every operation

**Edge format**: `[source_id, target_id, dep_type, strength]`

**Important**: Both source and target must be valid node IDs (either in the current file's nodes or, for detailed view, also in `classNodes` from the main view). Skip edges where either endpoint is unknown.

**For main view**: Update `classEdges`.

**For detailed view**: Update `detailedClassEdges`. This includes:
- Edges between two detailed-only nodes
- Edges from a detailed node to a main-view node
- Edges from a main-view node to a detailed node (cross-links)

### 5. Update dependency descriptions

Dependency descriptions are maps from edge key (`source->target->dep_type`) to a prose description.

- **Main view**: `DEP_DESCRIPTIONS` in `data/arch-nodes.js` (declared with `const`)
- **Detailed view**: `detailedDepDescriptions` in `data/arch-detailed-nodes.js` (declared with `var`). When the UI activates detailed mode, these are merged into `DEP_DESCRIPTIONS` so the tooltip lookup works.

For each edge in the target edge array (`classEdges` or `detailedClassEdges`), read the source code to write a description:
- 1-3 sentences describing what the source class uses the dependency for
- Focus on **behavior and function**: what operations are performed, what data flows, what RPCs are sent, what lifecycle events are handled
- **Do NOT describe implementation details** like "holds a reference", "stores a pointer", "owns a member", "constructor accepts". The reader can already see the dependency type on the edge — describe *what it's used for*, not *how it's wired*
- It is OK to mention specific function/method names to be concrete (e.g., "Replays stored hints via send_mutations()")
- Keep descriptions factual and based on the actual source code

**Key format**: `'source->target->dep_type'`

### 6. Write the updated file

#### For main view (`data/arch-nodes.js`)

Preserve the existing file structure exactly:
1. File header comment
2. `LAYERS` constant (do not modify unless explicitly asked)
3. `DEP_TYPES` constant (do not modify unless explicitly asked)
4. `classNodes` array — grouped by layer with comment headers (`// === STORAGE LAYER ===`, etc.)
5. `DEP_DESCRIPTIONS` object — grouped by source node with comment headers (`// --- source_node ---`)
6. `classEdges` array — grouped by source node with comment headers (`// --- source_node ---`)

#### For detailed view (`data/arch-detailed-nodes.js`)

Preserve the existing file structure:
1. File header comment
2. `detailedClassNodes` array — grouped by layer with comment headers
3. `detailedClassEdges` array — grouped by source node with comment headers
4. `detailedDepDescriptions` object — grouped by source node with comment headers, same key format as `DEP_DESCRIPTIONS`

**Important**: Use `var` (not `const`) for the detailed view variables, since the file is loaded dynamically.

### 7. Verify

After writing the file:

1. Confirm all node IDs are valid identifiers (lowercase, underscores, no spaces)
2. Confirm all edge source/target IDs exist as node IDs (in the same file, or in `classNodes` for detailed view cross-references)
3. Confirm all edge dep types are valid keys in `DEP_TYPES`: `ref`, `sharded-ref`, `raw-ptr`, `unique-ptr`, `observer`, `pluggable`, `ctor-param`, `method-param`
4. Confirm all edge strengths are integers 1-8
5. Confirm no duplicate node IDs within the file
6. For detailed view: confirm no node IDs that duplicate `classNodes` entries
7. Confirm every edge in the target edge array has a matching key in the corresponding descriptions object (`DEP_DESCRIPTIONS` for main view, `detailedDepDescriptions` for detailed view)
8. Report to the user: number of nodes added/removed/unchanged, number of edges added/removed/unchanged

## Data format reference

### Node format
```javascript
{ id:'service_name', ns:'namespace', layer:'storage|cluster|services|query|api', desc:'One-sentence description.' }
```

### Edge format
```javascript
['source_id', 'target_id', 'dep_type', strength]
// dep_type: ref | sharded-ref | raw-ptr | unique-ptr | observer | pluggable | ctor-param | method-param
// strength: 1-8
```

### Description format
```javascript
// Main view (const, in arch-nodes.js):
'source->target->dep_type': 'What the source uses this dependency for. Concrete behaviors and data flows.'

// Detailed view (var, in arch-detailed-nodes.js):
'source->target->dep_type': 'What the source uses this dependency for. Concrete behaviors and data flows.'
```

## Common pitfalls

- **Do NOT duplicate nodes** between main and detailed views. If a node already exists in `classNodes`, it must not appear in `detailedClassNodes`.
- **Do NOT invent dependencies** that don't exist in the source code. Every edge must be traceable to actual code references.
- **Do NOT modify LAYERS or DEP_TYPES** unless the user explicitly asks. These are shared constants used by the rendering engine.
- **Strength values matter** for visual weight. Read the actual code to gauge how pervasively a dependency is used, don't just guess.
- **Keep node descriptions concise** — one sentence capturing the primary responsibility of the service.
- **Group entries by layer/source** with comment headers to maintain readability.
- **Detailed view uses `var`**, not `const`, because the file is loaded dynamically via script injection.
