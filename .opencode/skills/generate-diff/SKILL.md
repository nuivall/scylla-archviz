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

The archviz graph has two sets of node IDs: **main view** nodes (in `data/arch-nodes.js`, variable `classNodes`) and **detailed view** nodes (in `data/arch-detailed-nodes.js`, variable `detailedClassNodes`). Together they form the complete set of valid node IDs.

**Discovering valid node IDs**: Do NOT hardcode node IDs. Instead, read the data files to extract them:
- Read `data/arch-nodes.js` and collect all `id` values from the `classNodes` array.
- Read `data/arch-detailed-nodes.js` and collect all `id` values from the `detailedClassNodes` array.
- The union of these two sets is the complete list of valid node IDs.

Map each touched file to zero or more graph nodes using the mapping rules below.

**File-to-node mapping rules — main view nodes** (apply in order):

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
| `streaming/*` (not `stream_session*` or `stream_plan*`) | `stream_manager` |
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

**File-to-node mapping rules — detailed view nodes** (apply in order, AFTER main view rules):

| File path pattern | Node ID |
|---|---|
| `replica/table.*` or `replica/column_family.*` | `table` |
| `replica/memtable.*` | `memtable` |
| `row_cache.*` or `cache_flat_mutation_reader*` | `row_cache` |
| `cache_tracker.*` or `row_cache.*tracker*` | `cache_tracker` |
| `db/commitlog/commitlog.*` or `commitlog.*` | `commitlog` |
| `sstables/sstable.*` or `sstables/sstable_set*` | `sstable` |
| `sstables/sstables_manager.*` | `sstables_manager` |
| `sstables/sstable_directory.*` | `sstable_directory` |
| `compaction/compaction_strategy_impl.*` or `compaction/*strategy.*` (not `*_manager*`) | `compaction_strategy_impl` |
| `compaction/compaction_backlog_manager.*` or `compaction/backlog*` | `compaction_backlog_manager` |
| `replica/dirty_memory_manager.*` or `dirty_memory_manager*` | `dirty_memory_manager` |
| `db/large_data_handler.*` or `large_data_handler*` | `large_data_handler` |
| `db/config.*` | `config` |
| `index/secondary_index_manager.*` or `secondary_index/index_manager*` | `secondary_index_manager` |
| `mutation_reader.*` or `flat_mutation_reader*` or `mutation/mutation_reader*` | `mutation_reader` |
| `locator/token_metadata.*` (class-specific, not shared wrapper) | `token_metadata` |
| `locator/topology.*` | `topology` |
| `locator/tablet_metadata.*` or `locator/tablets.*` | `tablet_metadata` |
| `locator/tablet_map.*` or `locator/tablet.*map*` | `tablet_map` |
| `locator/effective_replication_map.*` (class-specific) | `effective_replication_map` |
| `locator/abstract_replication_strategy.*` or `locator/*_strategy.*` (not `snitch*`) | `abstract_replication_strategy` |
| `streaming/stream_session.*` | `stream_session` |
| `streaming/stream_plan.*` | `stream_plan` |
| `gms/endpoint_state.*` or `gms/application_state*` | `endpoint_state` |
| `service/topology_state_machine.*` or `topology_state_machine*` | `topology_state_machine` |
| `service/tablet_allocator.*` | `tablet_allocator` |
| `service/load_broadcaster.*` | `load_broadcaster` |
| `service/migration_notifier.*` or `migration_listener*` | `migration_notifier` |
| `service/endpoint_lifecycle*` | `endpoint_lifecycle_notifier` |
| `db/hints/manager.*` or `db/hints/host_filter*` | `hints_manager` |
| `db/hints/resource_manager.*` | `hints_resource_manager` |
| `db/system_distributed_keyspace.*` | `system_distributed_keyspace` |
| `db/view/view_building_coordinator.*` or `db/view/*coordinator*` | `view_building_coordinator` |
| `auth/password_authenticator.*` | `password_authenticator` |
| `auth/standard_role_manager.*` | `standard_role_manager` |
| `service/paxos_state.*` or `service/paxos/paxos_state*` | `paxos_state` |
| `cql3/statements/select_statement.*` | `select_statement` |
| `cql3/statements/modification_statement.*` or `cql3/statements/update_statement.*` or `cql3/statements/delete_statement.*` | `modification_statement` |
| `cql3/statements/batch_statement.*` | `batch_statement` |
| `cql3/statements/schema_altering_statement.*` or `cql3/statements/create_*` or `cql3/statements/alter_*` or `cql3/statements/drop_*` | `schema_altering_statement` |
| `cql3/prepared_statements_cache.*` or `cql3/query_options_fwd*` | `prepared_statements_cache` |
| `cql3/restrictions/*` | `statement_restrictions` |
| `transport/controller.*` or `transport/cql_server_controller*` | `cql_server_controller` |
| `alternator/controller.*` | `alternator_controller` |
| `transport/event_notifier.*` or `transport/event.*` | `event_notifier` |
| `alternator/rmw_operation.*` | `rmw_operation` |

**Important rules:**
- Files that don't match any pattern (test files, build configs, IDL files, grammar files, etc.) are **ignored** — do NOT invent nodes for them.
- Only use node IDs that exist in `classNodes` or `detailedClassNodes`. Never create new node IDs.
- A single file can map to at most one node. If a file matches both a main and a detailed rule, prefer the more specific (detailed) match.
- Aggregate linesAdded/linesRemoved per node across all files that map to it.
- When mapping to detailed view nodes, the diff overlay will work in both main and detailed modes — detailed node touches will only be visible when the user activates the detailed view.

### 5. Identify touched edges

The archviz graph has edges in `classEdges` (main view, in `data/arch-nodes.js`) and `detailedClassEdges` (detailed view, in `data/arch-detailed-nodes.js`), both with format `[source, target, depType, strength]`. The combined set of all edges forms the complete graph. An edge is "touched" if **both** its source and target are in the set of touched nodes.

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

#### File 2: `data/diff-nodes.js`

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
2. Confirm `data/diff-nodes.js` is valid JavaScript (the JSON is assigned to `var DIFF_ANALYSIS_DATA`)
3. Confirm all node IDs in the analysis exist in `classNodes` (from `data/arch-nodes.js`) or `detailedClassNodes` (from `data/arch-detailed-nodes.js`)
4. Confirm all edge keys in the analysis use the `source->target` format and both source and target are in the touched nodes set
5. Report to the user: number of touched nodes (noting how many are main vs. detailed), number of touched edges, total lines changed

## Common pitfalls

- **Do NOT invent graph nodes** that don't exist in `classNodes` or `detailedClassNodes`. If a file doesn't map to any node, skip it.
- **Do NOT hardcode node IDs** — always read them from `data/arch-nodes.js` and `data/arch-detailed-nodes.js`.
- **Do NOT include raw diff hunks** in the summaries. Write high-level descriptions.
- **Do NOT quote code-level names** (functions, methods, variables, classes, types) in summaries. Describe behavior and architecture, not code symbols.
- **Do NOT include test-only changes** as touched nodes. Test files don't map to any node.
- **Edge format is `source->target`** without the dependency type. The dep type is only in classEdges, not in the analysis.
- **New edges need no special field**: The overlay auto-detects new edges by comparing analysis edge keys against `classEdges` and `detailedClassEdges`. Just include the edge in the `edges` object like any other — it will be rendered as a dashed blue path with a "new" badge automatically.
- **The `diff-nodes.js` file goes in the `data/` directory**, not in `input/` or the project root.
