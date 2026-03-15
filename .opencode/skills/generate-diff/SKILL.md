---
name: generate-diff
description: Generate diff analysis input files for scylla-archviz from a git repo's recent commits. Asks for repo path and commit count, then produces input/code.diff, input/code-analysis.json, and data/diff-nodes.js with 2-level analysis (peering_service, class).
---

## What I do

Generate the input files that power the "Diff Analysis" tab in scylla-archviz. I take a git repository path and a number of recent commits, extract the combined diff, perform a 2-level code analysis (peering services and classes), and produce the required output files.

The analysis is **fully independent** of the architecture graph data (`arch-nodes.js`, `arch-detailed-nodes.js`). It discovers entities and relationships directly from the diff code itself.

## When to use me

Use this skill when you want to refresh or regenerate the diff analysis data — for example after a new commit lands in the ScyllaDB repo, or when pointing at a different repo/branch.

## Output overview

The skill produces data at two granularity levels, each with its own set of nodes and edges:

| Level | Nodes are | Edges represent |
|-------|-----------|-----------------|
| `peering_service` | Sharded service classes (e.g. `storage_service`, `gossiper`) | Service-to-service calls/usage in the diff |
| `class` | Any C++ class touched by the diff (not limited to services) | Class-to-class calls/usage in the diff |

Each node is assigned a `layer` from `[storage, cluster, services, query, api]` so the web view can render both levels on the same 5-tier layout.

## Step-by-step procedure

### 1. Ask the user for inputs

Use the `question` tool to ask both questions at once:

- **Repository path**: Absolute path to the git repo to diff (e.g. `/code/nuivall/scylladb`)
- **Number of commits**: How many recent commits to include in the diff (default: 1)

### 2. Extract the diff

Run `git diff HEAD~N` in the target repo (where N = number of commits). Save the output to `input/code.diff` in the archviz project root.

```bash
# Example for 1 commit:
git -C <repo_path> diff HEAD~1 > /code/nuivall/scylla-archviz/input/code.diff
```

Also capture the commit metadata:

```bash
git -C <repo_path> log --oneline -N
```

### 3. Read the diff and identify touched files

Read the saved diff file. Build a list of all modified/added/deleted files from the diff headers (`--- a/...` and `+++ b/...` lines). Count lines added and removed per file.

**Skip** these file categories entirely — they never produce nodes at any level:
- Test files (`test/*`)
- Documentation (`docs/*`, `*.md`)
- Build configs (`CMakeLists.txt`, `*.cmake`, `configure.py`)
- IDL definition files (`*.idl`)
- Grammar files (`*.g`, `*.yy`)
- `main.cc`

### 4. Analyze at peering_service level

Peering services are C++ classes that derive from `seastar::peering_sharded_service`, `seastar::async_sharded_service`, or are otherwise well-known sharded service singletons in ScyllaDB.

#### 4a. Identify touched services

For each non-skipped source file in the diff:

1. **By file name**: If a `.cc` or `.hh` file is named after a known sharded service pattern (e.g., `service/storage_service.cc`, `message/messaging_service.hh`, `gms/gossiper.cc`), that file belongs to that service.

2. **By class method definitions**: Scan the diff hunks for C++ qualified method definitions like `ClassName::method_name(`. If `ClassName` is a sharded service class, the file belongs to that service.

3. **By context in the diff**: If a file modifies or adds code that is clearly part of a service (e.g., adding an RPC handler, extending a service's public API), attribute it to that service.

4. **Unattributable files**: Files that cannot be attributed to any service are **not included** at this level. They may still appear at the class level.

For each identified service, record:
- `id`: snake_case service name (e.g., `storage_service`, `mapreduce_service`)
- `ns`: C++ namespace (e.g., `service`, `gms`, `netw`)
- `layer`: one of `storage`, `cluster`, `services`, `query`, `api` (see layer assignment rules below)
- `files`: list of source files belonging to this service in the diff
- `linesAdded` / `linesRemoved`: aggregated across all files
- `classes`: list of class IDs (from the class level) that belong to this service
- `summary`: 2-5 sentence architectural description (see summary rules below)

#### 4b. Identify service-to-service edges

Scan the diff for evidence of one service calling or using another:
- Method calls on injected service references (e.g., `_messaging.send_message(...)`)
- New RPC verb registrations or handlers
- New references or parameters added to a service's constructor

Each edge is keyed as `source_service->target_service`. Write a 1-2 sentence summary describing what the dependency is used for in the context of the diff.

Only include edges where the diff actually shows the interaction. Do not infer edges from general knowledge of the codebase.

### 5. Analyze at class level

#### 5a. Identify touched classes

Identify ALL C++ classes touched by the diff — not just services. This includes:
- Classes whose methods are added or modified
- New class definitions introduced by the diff
- Classes whose member declarations or inheritance change
- Structs and enums that have significant behavioral changes

For each class, record:
- `id`: snake_case class name (e.g., `filtering_delete_statement`, `modification_statement`)
- `ns`: C++ namespace (e.g., `cql3::statements`, `service`)
- `layer`: inferred from the class's role (see layer assignment rules below)
- `files`: source files where this class is defined or modified
- `linesAdded` / `linesRemoved`: lines changed in code belonging to this class
- `peering_service`: the ID of the parent service this class belongs to (if any), or `null`
- `summary`: 2-4 sentence description (see summary rules below)

**Peering service classes are also class-level nodes.** A service like `mapreduce_service` appears both as a peering_service node and as a class node. Set `peering_service` to its own ID in this case.

#### 5b. Identify class-to-class edges

Scan the diff for evidence of one class calling or using another:
- Method calls: code in class A calls methods on class B
- Construction: class A creates instances of class B
- Inheritance: class A extends or implements class B (if introduced or changed by the diff)
- Parameter passing: class A receives class B as a parameter

Each edge is keyed as `source_class->target_class`. Write a 1-2 sentence summary.

Only include edges visible in the diff code.

### 6. Layer assignment rules

Every node at every level must be assigned a `layer` from: `storage`, `cluster`, `services`, `query`, `api`.

Use these heuristics to determine the layer:

| Layer | Typical namespaces | Typical roles |
|-------|-------------------|---------------|
| `storage` | `replica`, `sstables`, `compaction`, `db`, `db::view` | Data storage, compaction, memtables, SSTables, commitlog, caching, schema |
| `cluster` | `gms`, `netw`, `dht`, `streaming`, `repair`, `raft`, `direct_fd`, `locator` | Gossip, messaging/RPC, topology, token metadata, streaming, repair, failure detection, Raft consensus |
| `services` | `service`, `cdc`, `auth`, `qos`, `tasks` | Coordination (storage_proxy, storage_service), migration, Raft groups, CDC, auth, QoS, task management, hints |
| `query` | `cql3`, `cql3::statements`, `cql3::functions`, `query`, `lang` | CQL parsing, query processing, statements, prepared statements, UDFs, restrictions |
| `api` | `transport`, `alternator`, `api`, `audit` | CQL server, Alternator (DynamoDB-compatible API), REST API, audit logging |

Additional guidance:
- If a class's namespace clearly maps to a layer, use that.
- If a class serves multiple roles, pick the layer of its primary consumer or parent service.
- When in doubt, prefer `services` as the default layer for general-purpose utility code.

### 7. Write summaries

#### Node summaries (both levels)

For each node at every level, write a high-level summary:
- **peering_service**: 2-5 sentences describing what the diff does in this service. Focus on architectural impact.
- **class**: 2-4 sentences describing how this class is changed and why.

Rules:
- Focus on the **what** and **why**, not raw code changes.
- Describe architectural patterns, data flows, and behavioral changes.
- Do NOT quote specific function names, method names, variable names, class names, or type names in summaries.
- The audience is someone reading an architecture diagram, not someone reviewing code.

#### Edge summaries (both levels)

For each edge at every level, write a 1-2 sentence summary describing what the dependency is used for. Same rules as node summaries: no code-level names, keep it architectural.

### 8. Compose the commit summary

Write a `title` (short, like a PR title) and a `summary` (2-4 sentences describing the overall change at an architectural level).

For multi-commit diffs, the title should describe the overall theme and the summary should cover the combined effect.

### 9. Generate output files

#### File 1: `input/code-analysis.json`

```json
{
  "commit": "<short hash or range>",
  "title": "<short PR-style title>",
  "summary": "<2-4 sentence architectural summary>",
  "levels": {
    "peering_service": {
      "nodes": {
        "<service_id>": {
          "ns": "<C++ namespace>",
          "layer": "<storage|cluster|services|query|api>",
          "summary": "<2-5 sentence description>",
          "files": ["<relative/path/to/file1>", "..."],
          "linesAdded": 0,
          "linesRemoved": 0,
          "classes": ["<class_id>", "..."]
        }
      },
      "edges": {
        "<source>-><target>": {
          "summary": "<1-2 sentence description>"
        }
      }
    },
    "class": {
      "nodes": {
        "<class_id>": {
          "ns": "<C++ namespace>",
          "layer": "<storage|cluster|services|query|api>",
          "summary": "<2-4 sentence description>",
          "files": ["<relative/path/to/file1>", "..."],
          "linesAdded": 0,
          "linesRemoved": 0,
          "peering_service": "<service_id or null>"
        }
      },
      "edges": {
        "<source>-><target>": {
          "summary": "<1-2 sentence description>"
        }
      }
    }
  },
  "newFiles": ["<files that were added>"],
  "modifiedFiles": ["<files that were modified>"]
}
```

#### File 2: `data/diff-nodes.js`

This file sets a global variable with the same data as the JSON, formatted for direct inclusion in the browser:

```javascript
// Auto-generated from input/code-analysis.json
// This file is loaded before diff-graph.js to provide analysis data
// without requiring fetch() (which fails under file:// protocol).
var DIFF_ANALYSIS_DATA = <contents of code-analysis.json>;
```

Write the JSON content inline as the value of `DIFF_ANALYSIS_DATA`. Use readable formatting (2-space indent), not minified.

#### File 3: `input/code.diff`

Already saved in step 2. No additional processing needed.

### 10. Verify

After generating all files:
1. Confirm `input/code-analysis.json` is valid JSON.
2. Confirm `data/diff-nodes.js` is valid JavaScript (the JSON is assigned to `var DIFF_ANALYSIS_DATA`).
3. Confirm every node at every level has a valid `layer` value from `[storage, cluster, services, query, api]`.
4. Confirm all edge keys use the `source->target` format and both source and target exist as node IDs at that level.
5. Confirm cross-level references are consistent:
   - Every class ID listed in a service's `classes` array exists in `levels.class.nodes`.
   - Every class's `peering_service` value (if non-null) exists in `levels.peering_service.nodes`.
6. Report to the user:
   - Number of nodes at each level (peering_service, class)
   - Number of edges at each level
   - Total lines changed
   - Any files that could not be attributed to any entity at any level

## Common pitfalls

- **Do NOT reference architecture graph data.** This analysis is independent of `arch-nodes.js` and `arch-detailed-nodes.js`. Never read those files or constrain node IDs to match them.
- **Do NOT skip non-service classes.** Every C++ class touched by the diff should appear at the class level, even if it's not a sharded service.
- **Do NOT include raw diff hunks** in the summaries. Write high-level descriptions.
- **Do NOT quote code-level names** (functions, methods, variables, classes, types) in summaries. Describe behavior and architecture, not code symbols.
- **Do NOT include test-only changes** as nodes. Test files are skipped entirely.
- **Edge format is `source->target`** at all levels. Use the node IDs of that level.
- **Every node needs a layer.** Do not leave `layer` empty or null. Use the heuristics in step 6 to assign one.
- **Cross-level links must be bidirectional.** If a service lists a class in its `classes` array, that class must have `peering_service` pointing back to that service. 
- **The `diff-nodes.js` file goes in the `data/` directory**, not in `input/` or the project root.
- **Peering services also appear as class-level nodes.** A service class like `storage_service` should be a node at both the `peering_service` and `class` levels.
