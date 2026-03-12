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

**CRITICAL: Do NOT use hardcoded node IDs or static mapping tables.** Always derive the mapping dynamically from the graph data files at runtime.

#### Step 4a. Read graph data and build the node registry

Read both data files and extract every node's `{ id, ns }`:
- `data/arch-nodes.js` → `classNodes` array
- `data/arch-detailed-nodes.js` → `detailedClassNodes` array

The union of all `id` values is the complete set of valid node IDs.

#### Step 4b. Derive file-path patterns from `ns` and `id`

For each node, convert its `ns` (C++ namespace) and `id` into candidate file patterns using these rules:

1. **Namespace to directory**: Replace `::` with `/` in the `ns` field to get the directory prefix. E.g., `ns:'db::view'` → `db/view/`, `ns:'alternator'` → `alternator/`, `ns:'service'` → `service/`.

2. **Stem from `id`**: Strip common prefixes/suffixes to get the file stem. Usually the `id` itself is the stem (e.g., `id:'executor'` → `executor`). For nodes whose `id` has a prefix matching the last namespace component, use the full `id` (e.g., `id:'view_builder'` with `ns:'db::view'` → stem is `view_builder`).

3. **Primary pattern**: `<dir>/<id>.*` — e.g., `alternator/executor.*`, `db/view/view_builder.*`, `service/storage_service.*`.

4. **Catch-all directory nodes**: Some nodes represent an entire subsystem directory. If a node's `ns` maps to a top-level directory where no other node's primary pattern would match files, that directory is a catch-all. Common examples: `streaming/*` → `stream_manager`, `repair/*` → `repair_service`, `tasks/*` → `task_manager`, `tracing/*` → `tracing`, `audit/*` → `audit`, `lang/*` → `lang_manager`, `vector_search/*` → `vector_store_client`. Determine these by checking if only one node has that namespace directory.

5. **Namespace aliases**: Some C++ namespaces don't match directory names. Known aliases:
   - `ns:'netw'` → directory `message/` (for `messaging_service`)
   - `ns:'direct_fd'` → directory `direct_failure_detector/` (for `failure_detector`)
   - `ns:''` (empty) → root directory (for `sstables_loader` etc.)

   When deriving patterns, if the directory from step 1 doesn't seem right, check the node's `id` to locate the file. For example, `sstables_loader` with `ns:''` → look for `sstables_loader.*` in the repo root.

Apply these rules to build a map of `file_pattern → node_id` for all nodes.

#### Step 4c. Match diff files against patterns

For each file in the diff:
1. Skip test files (`test/*`), documentation (`docs/*`, `*.md`), build configs (`CMakeLists.txt`, `*.cmake`, `configure.py`), IDL files (`*.idl`), grammar files (`*.g`, `*.yy`), and `main.cc`.
2. Try to match the file path against the derived patterns (most-specific first — patterns with explicit filenames before directory catch-alls).
3. A single file maps to at most one node.

#### Step 4d. Fallback: scan unmapped source files for class method definitions

Some `.cc` files contain method implementations for a class defined in a different header file (e.g., `alternator/streams.cc` contains methods of the `executor` class). These won't match the primary `<dir>/<id>.*` pattern.

For any `.cc` file from the diff that was NOT matched in step 4c and is NOT a test/doc/config file:
1. Read the diff hunks for that file (or the first ~200 lines of the file itself in the target repo).
2. Look for C++ qualified method definitions like `ClassName::method_name(` where `ClassName` matches a known node class. Build the class-name lookup from node IDs: convert `snake_case` id to the likely C++ class name (usually the same, e.g., `executor`, `system_keyspace`, `storage_service`). Also check the `ns` prefix to disambiguate (e.g., `alternator::executor`).
3. If a file contains method definitions for exactly one known node class, map it to that node.
4. If a file contains methods for multiple node classes, map it to the most-referenced one (by count of method definitions).

**Important rules:**
- Files that don't match any pattern AND don't contain recognizable class methods are **ignored** — do NOT invent nodes for them.
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
- **Do NOT hardcode node IDs or static mapping tables** — always derive file-to-node mappings dynamically from the `ns` and `id` fields in `data/arch-nodes.js` and `data/arch-detailed-nodes.js`. Use the fallback scan for `.cc` files that contain methods of a class defined elsewhere.
- **Split source files**: Some `.cc` files implement methods of a class whose header lives in a different file (e.g., `alternator/streams.cc` contains `executor::` methods). The fallback scan in step 4d handles this — do NOT skip these files just because their name doesn't match a node ID.
- **Do NOT include raw diff hunks** in the summaries. Write high-level descriptions.
- **Do NOT quote code-level names** (functions, methods, variables, classes, types) in summaries. Describe behavior and architecture, not code symbols.
- **Do NOT include test-only changes** as touched nodes. Test files don't map to any node.
- **Edge format is `source->target`** without the dependency type. The dep type is only in classEdges, not in the analysis.
- **New edges need no special field**: The overlay auto-detects new edges by comparing analysis edge keys against `classEdges` and `detailedClassEdges`. Just include the edge in the `edges` object like any other — it will be rendered as a dashed blue path with a "new" badge automatically.
- **The `diff-nodes.js` file goes in the `data/` directory**, not in `input/` or the project root.
