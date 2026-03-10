---
name: generate-diff
description: Generate diff overlay input files for scylla-archviz from a git repo's recent commits. Asks for repo path and commit count, then produces input/code.diff, input/code-analysis.json, and diff-analysis-data.js.
---

## What I do

Generate the input files that power the "Diff" overlay button in scylla-archviz. I take a git repository path and a number of recent commits, extract the combined diff, analyze which architecture graph nodes and edges are affected, write high-level descriptions, and produce the three required output files.

## When to use me

Use this skill when you want to refresh or regenerate the diff overlay data — for example after a new commit lands in the ScyllaDB repo, or when pointing at a different repo/branch.

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

### 4. Map files to graph nodes

The archviz graph has a fixed set of node IDs. Map each touched file to zero or more graph nodes using the mapping rules below.

**Valid graph node IDs** (only these exist on the graph):

```
database, compaction_manager, storage_manager, sstable_compressor_factory,
system_keyspace, view_builder, view_building_worker, view_update_generator,
snapshot_ctl, batchlog_manager, sstables_loader, raft_sys_table_storage,
gossiper, messaging_service, shared_token_metadata, erm_factory,
feature_service, snitch, stream_manager, repair_service, failure_detector,
address_map, direct_fd_pinger, raft_server, raft_rpc,
storage_service, storage_proxy, migration_manager, raft_group_registry,
raft_group0, raft_group0_client, group0_state_machine, qos_controller,
auth_service, auth_cache, cdc_generation, cdc_service, task_manager,
cache_hitrate_calculator, paxos_store, view_update_backlog_broker, tracing,
mapreduce_service, strong_coordinator, groups_manager, client_routes,
query_processor, lang_manager, vector_store_client,
cql_server, alternator_executor, alternator_server, alternator_expiration, audit
```

**File-to-node mapping rules** (apply in order):

| File path pattern | Node ID |
|---|---|
| `service/storage_service.*` | `storage_service` |
| `service/storage_proxy.*` | `storage_proxy` |
| `service/migration_manager.*` | `migration_manager` |
| `service/raft_group_registry.*` | `raft_group_registry` |
| `service/raft_group0.*` (not client) | `raft_group0` |
| `service/raft_group0_client.*` | `raft_group0_client` |
| `service/group0_state_machine.*` | `group0_state_machine` |
| `service/mapreduce_service.*` | `mapreduce_service` |
| `service/qos_controller.*` or `service/qos*` | `qos_controller` |
| `service/paxos*` | `paxos_store` |
| `service/view_update_backlog*` | `view_update_backlog_broker` |
| `service/cache_hitrate*` | `cache_hitrate_calculator` |
| `service/raft_rpc.*` | `raft_rpc` |
| `service/raft_sys_table_storage.*` | `raft_sys_table_storage` |
| `service/client_routes.*` | `client_routes` |
| `raft/server.*` | `raft_server` |
| `gms/gossiper.*` | `gossiper` |
| `gms/feature_service.*` or `gms/feature.*` | `feature_service` |
| `locator/token_metadata.*` or `locator/shared_token_metadata.*` | `shared_token_metadata` |
| `locator/snitch*` or `locator/*snitch*` | `snitch` |
| `locator/erm_factory.*` or `locator/effective_replication_map*` | `erm_factory` |
| `message/messaging_service.*` | `messaging_service` |
| `streaming/*` | `stream_manager` |
| `repair/*` | `repair_service` |
| `direct_failure_detector/*` | `failure_detector` |
| `service/address_map.*` or `gms/gossip_address_map*` | `address_map` |
| `service/direct_fd_pinger.*` | `direct_fd_pinger` |
| `replica/database.*` | `database` |
| `compaction/*compaction_manager*` | `compaction_manager` |
| `sstables/storage_manager.*` | `storage_manager` |
| `sstables/compressor*` | `sstable_compressor_factory` |
| `db/system_keyspace.*` | `system_keyspace` |
| `db/view/view_builder.*` | `view_builder` |
| `db/view/view_building_worker.*` | `view_building_worker` |
| `db/view/view_update_generator.*` | `view_update_generator` |
| `db/snapshot*` | `snapshot_ctl` |
| `db/batchlog_manager.*` | `batchlog_manager` |
| `sstables_loader.*` | `sstables_loader` |
| `cql3/query_processor.*` | `query_processor` |
| `lang/*` | `lang_manager` |
| `vector_search/*` | `vector_store_client` |
| `transport/server.*` or `transport/cql*` | `cql_server` |
| `alternator/executor.*` | `alternator_executor` |
| `alternator/server.*` | `alternator_server` |
| `alternator/expiration.*` | `alternator_expiration` |
| `auth/service.*` or `auth/authenticator*` or `auth/authorizer*` or `auth/role_manager*` | `auth_service` |
| `auth/permissions_cache*` or `auth/roles_cache*` | `auth_cache` |
| `cdc/generation*` | `cdc_generation` |
| `cdc/cdc_service*` or `cdc/log*` | `cdc_service` |
| `tasks/*` | `task_manager` |
| `tracing/*` | `tracing` |
| `service/sc/*coordinator*` or `service/strong_coordinator*` | `strong_coordinator` |
| `service/sc/*groups*` or `service/groups_manager*` | `groups_manager` |
| `audit/*` | `audit` |

**Important rules:**
- Files that don't match any pattern (test files, build configs, IDL files, grammar files, etc.) are **ignored** — do NOT invent nodes for them.
- Only use node IDs from the valid list above. Never create new node IDs.
- A single file can map to at most one node.
- Aggregate linesAdded/linesRemoved per node across all files that map to it.

### 5. Identify touched edges

The archviz graph has edges in `classEdges` array with format `[source, target, depType, strength]`. An edge is "touched" if **both** its source and target are in the set of touched nodes.

For each touched edge (use `source->target` format, ignoring depType), read the relevant diff hunks and write a 1-2 sentence summary describing what the diff uses this dependency for. Focus on the purpose — what is being sent/read/written through this dependency in the context of the diff.

Only include edges where the diff actually shows changes to how source uses target. Don't include edges just because both endpoints are touched — there must be evidence in the diff.

**New dependencies**: If the diff introduces a dependency between two touched nodes that does NOT already exist in `classEdges`, still include it in the analysis with the `source->target` key format. The overlay will automatically detect these as "new" edges (by comparing the analysis edge keys against the graph's `classEdges`) and render them as dashed blue paths with a "new" badge — no extra field is needed in the JSON. Write the edge summary the same way as for existing edges: describe what the dependency is used for.

### 6. Write per-node and per-edge summaries

For each touched node, write a high-level summary (2-5 sentences) describing what the diff does in that component. Focus on the **what** and **why**, not raw code changes. Describe architectural patterns, data flows, and behavioral changes — do NOT quote specific function names, method names, variable names, class names, or type names. The audience is someone reading an architecture diagram, not someone reviewing code.

For each touched edge, write a 1-2 sentence summary describing what the diff uses this dependency for. Same rule: no code-level names, keep it architectural.

### 7. Compose the commit summary

Write a `title` (short, like a PR title) and a `summary` (2-4 sentences describing the overall change at an architectural level).

For multi-commit diffs, the title should describe the overall theme and the summary should cover the combined effect.

### 8. Generate output files

#### File 1: `input/code-analysis.json`

```json
{
  "commit": "<short hash or range>",
  "title": "<short PR-style title>",
  "summary": "<2-4 sentence architectural summary>",
  "nodes": {
    "<node_id>": {
      "summary": "<2-5 sentence description of changes in this component>",
      "files": ["<relative/path/to/file1>", "<relative/path/to/file2>"],
      "linesAdded": <number>,
      "linesRemoved": <number>
    }
  },
  "edges": {
    "<source>-><target>": {
      "summary": "<1-2 sentence description of what the diff uses this dependency for>"
    }
  },
  "newFiles": ["<files that were added>"],
  "modifiedFiles": ["<files that were modified>"]
}
```

#### File 2: `diff-analysis-data.js`

This file sets a global variable with the same data as the JSON, formatted for direct inclusion in the browser:

```javascript
// Auto-generated from input/code-analysis.json
// This file is loaded before diff-overlay.js to provide analysis data
// without requiring fetch() (which fails under file:// protocol).
var DIFF_ANALYSIS_DATA = <contents of code-analysis.json>;
```

Write the JSON content inline as the value of `DIFF_ANALYSIS_DATA`. Use readable formatting (2-space indent), not minified.

#### File 3: `input/code.diff`

Already saved in step 2. No additional processing needed.

### 9. Verify

After generating all files:
1. Confirm `input/code-analysis.json` is valid JSON
2. Confirm `diff-analysis-data.js` is valid JavaScript (the JSON is assigned to `var DIFF_ANALYSIS_DATA`)
3. Confirm all node IDs in the analysis exist in the valid node ID list
4. Confirm all edge keys in the analysis use the `source->target` format and both source and target are in the touched nodes set
5. Report to the user: number of touched nodes, number of touched edges, total lines changed

## Common pitfalls

- **Do NOT invent graph nodes** that don't exist in the valid list. If a file doesn't map to any node, skip it.
- **Do NOT include raw diff hunks** in the summaries. Write high-level descriptions.
- **Do NOT quote code-level names** (functions, methods, variables, classes, types) in summaries. Describe behavior and architecture, not code symbols.
- **Do NOT include test-only changes** as touched nodes. Test files don't map to any node.
- **Edge format is `source->target`** without the dependency type. The dep type is only in classEdges, not in the analysis.
- **New edges need no special field**: The overlay auto-detects new edges by comparing analysis edge keys against `classEdges`. Just include the edge in the `edges` object like any other — it will be rendered as a dashed blue path with a "new" badge automatically.
- **The `diff-analysis-data.js` file goes in the project root**, not in `input/`.
