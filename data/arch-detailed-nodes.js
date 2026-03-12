// Detailed architecture node/edge data for ScyllaDB Architecture Visualizer
// This file extends the base arch-nodes.js with additional nodes and edges
// that provide a more granular view of the architecture.
//
// Format is identical to arch-nodes.js:
//   detailedClassNodes — array of { id, ns, layer, desc }
//   detailedClassEdges — array of [source, target, type, strength]
//
// When the "Detailed" button is active, these arrays are concatenated with
// the base classNodes/classEdges to form the full graph.

var detailedClassNodes = [
  // === STORAGE LAYER (sub-components) ===
  { id:'table',                      ns:'replica',     layer:'storage',  desc:'A single column family (table): owns memtables, row cache, commitlog segment, compaction groups, and SSTable sets.' },
  { id:'memtable',                   ns:'replica',     layer:'storage',  desc:'In-memory sorted mutation store for a table. Flushed to SSTable when full.' },
  { id:'row_cache',                  ns:'',            layer:'storage',  desc:'LSA-backed partition cache sitting in front of SSTables, tracked by cache_tracker.' },
  { id:'cache_tracker',              ns:'',            layer:'storage',  desc:'Tracks row cache memory and eviction across all tables on a shard.' },
  { id:'commitlog',                  ns:'db',          layer:'storage',  desc:'Write-ahead log for durability: segments mutations before memtable apply.' },
  { id:'sstable',                    ns:'sstables',    layer:'storage',  desc:'On-disk sorted-string table: immutable file holding partitions, indexes, and bloom filter.' },
  { id:'sstables_manager',           ns:'sstables',    layer:'storage',  desc:'Manages SSTable lifecycle: creation, format selection, garbage collection. Owns storage_manager and large_data_handler refs.' },
  { id:'sstable_directory',          ns:'sstables',    layer:'storage',  desc:'Discovers and loads SSTables from a filesystem directory for a table.' },
  { id:'compaction_strategy_impl',   ns:'compaction',  layer:'storage',  desc:'Base class for compaction strategies (STCS, LCS, TWCS, ICS): selects SSTables for compaction and provides backlog tracking.' },
  { id:'compaction_backlog_manager', ns:'compaction',  layer:'storage',  desc:'Aggregates compaction backlog estimates across all tables to drive compaction scheduling.' },
  { id:'dirty_memory_manager',       ns:'replica',     layer:'storage',  desc:'Tracks and throttles dirty (unflushed) memtable memory; triggers flushes when thresholds are exceeded.' },
  { id:'large_data_handler',         ns:'db',          layer:'storage',  desc:'Detects and records large partitions, rows, and cells during SSTable writes.' },
  { id:'config',                     ns:'db',          layer:'storage',  desc:'Central configuration store: holds all ScyllaDB YAML config values as typed, observable named_values.' },
  { id:'secondary_index_manager',    ns:'secondary_index', layer:'storage', desc:'Manages secondary indexes for a table: creates, drops, and maintains index views.' },
  { id:'mutation_reader',            ns:'',            layer:'storage',  desc:'Core streaming abstraction: pulls mutation_fragment_v2 from any data source (memtable, SSTable, cache, remote).' },
  { id:'compaction_group',           ns:'replica',     layer:'storage',  desc:'An isolated LSM tree unit within a table: owns memtables, SSTable sets (main and maintenance), and backlog tracker; one per tablet replica on a shard.' },
  { id:'compaction_task_executor',   ns:'compaction',  layer:'storage',  desc:'Core execution engine for individual compaction operations, managing state transitions (pending/active/done/failed) and coordinating the actual SSTable compaction work.' },
  { id:'sstable_set',                ns:'sstables',    layer:'storage',  desc:'Immutable, queryable collection of SSTables supporting efficient range-based selection and combined mutation reader creation.' },
  { id:'sstable_writer',             ns:'sstables',    layer:'storage',  desc:'Consumes mutation fragments and writes them into a new SSTable on disk, handling serialization format.' },
  { id:'index_reader',               ns:'sstables',    layer:'storage',  desc:'Reads and navigates the partition index of an SSTable for efficient seeking and scanning of partition positions.' },
  { id:'partition_index_cache',      ns:'sstables',    layer:'storage',  desc:'LRU-evictable cache for SSTable partition index pages allocated inside LSA, with async loading and deduplication.' },
  { id:'commitlog_replayer',         ns:'db',          layer:'storage',  desc:'Replays commitlog segments on startup to recover mutations not yet flushed to SSTables.' },
  { id:'virtual_table',              ns:'db',          layer:'storage',  desc:'Base class for virtual system tables that produce data programmatically rather than from SSTables.' },
  { id:'schema',                     ns:'',            layer:'storage',  desc:'Immutable, shared representation of a table\'s full schema: columns, partition/clustering key definitions, compaction and compression settings.' },
  { id:'data_dictionary_database',   ns:'data_dictionary', layer:'storage', desc:'Type-erased, coordinator-side view of the schema catalog providing keyspace/table lookup without direct storage access.' },
  { id:'keyspace',                   ns:'replica',     layer:'storage',  desc:'Represents a keyspace on a shard: owns replication strategy, effective replication map, and per-keyspace metadata.' },
  { id:'querier_cache',              ns:'replica',     layer:'storage',  desc:'TTL-based cache for mutation readers (queriers) that survive across paged query continuations.' },

  // === CLUSTER LAYER (sub-components) ===
  { id:'token_metadata',             ns:'locator',     layer:'cluster',  desc:'Immutable snapshot of the cluster token ring: token-to-endpoint mapping, topology, and tablet metadata.' },
  { id:'topology',                   ns:'locator',     layer:'cluster',  desc:'Cluster topology model: nodes indexed by host_id, IP, datacenter, and rack.' },
  { id:'tablet_metadata',            ns:'locator',     layer:'cluster',  desc:'Collection of all tablet maps across all tables, tracking tablet-to-replica assignments.' },
  { id:'tablet_map',                 ns:'locator',     layer:'cluster',  desc:'Per-table tablet layout: maps tablet IDs to replica sets, tracks transitions and resize state.' },
  { id:'effective_replication_map',   ns:'locator',     layer:'cluster',  desc:'Computed replica placement for a keyspace: caches natural endpoints per token for fast lookup.' },
  { id:'abstract_replication_strategy', ns:'locator',  layer:'cluster',  desc:'Base class for replication strategies (SimpleStrategy, NetworkTopologyStrategy): computes replica placement.' },
  { id:'stream_session',             ns:'streaming',   layer:'cluster',  desc:'A single streaming session between two nodes: manages file transfer, progress, and error handling.' },
  { id:'stream_plan',                ns:'streaming',   layer:'cluster',  desc:'Builder for streaming operations: collects ranges/tables to stream and creates coordinated sessions.' },
  { id:'endpoint_state',             ns:'gms',         layer:'cluster',  desc:'Gossip state for one endpoint: heartbeat, application state map (STATUS, TOKENS, SCHEMA, LOAD).' },
  { id:'topology_state_machine',     ns:'service',     layer:'cluster',  desc:'Raft-based topology state machine: drives node join/leave/replace/rebuild transitions.' },
  { id:'tablet_allocator',           ns:'service',     layer:'cluster',  desc:'Balances tablet replicas across nodes: load-aware placement, split/merge decisions.' },
  { id:'load_broadcaster',           ns:'service',     layer:'cluster',  desc:'Periodically broadcasts this node\'s disk load via gossip for load-balanced operations.' },
  { id:'migration_notifier',         ns:'service',     layer:'cluster',  desc:'Schema change notification hub: fires on_create/update/drop events to registered migration_listeners.' },
  { id:'endpoint_lifecycle_notifier', ns:'service',    layer:'cluster',  desc:'Endpoint lifecycle notification hub: fires up/down/joined/left events to registered subscribers.' },
  { id:'versioned_value',            ns:'gms',         layer:'cluster',  desc:'Immutable versioned gossip state value (STATUS, TOKENS, SCHEMA, LOAD) disseminated to cluster nodes via gossip rounds.' },
  { id:'persistent_discovery',       ns:'service',     layer:'cluster',  desc:'Wraps the Raft peer discovery algorithm with persistent storage of learned peers on disk for group 0 bootstrap.' },
  { id:'topology_coordinator',       ns:'service',     layer:'cluster',  desc:'Drives all topology transitions (join, leave, replace, tablet migration) as the Raft group 0 leader.' },
  { id:'repair_reader',              ns:'',            layer:'cluster',  desc:'Reads mutation fragments from local or multishard readers for a repair range, computing per-row hashes for the row-level repair algorithm.' },
  { id:'repair_writer',              ns:'',            layer:'cluster',  desc:'Writes repaired mutation fragments to new SSTables on the follower side during row-level repair.' },

  // === SERVICES LAYER (sub-components) ===
  { id:'hints_manager',              ns:'db::hints',   layer:'services', desc:'Per-endpoint hinted handoff manager: stores and replays hints when a replica is temporarily down.' },
  { id:'hints_resource_manager',     ns:'db::hints',   layer:'services', desc:'Controls resource budget (disk, memory) shared across all per-endpoint hints managers.' },
  { id:'system_distributed_keyspace', ns:'db',         layer:'services', desc:'Operations on the system_distributed keyspace: CDC generations, service levels, view build status.' },
  { id:'view_building_coordinator',  ns:'db::view',    layer:'services', desc:'Raft-leader coordinator for materialized view builds: assigns ranges to workers, tracks progress.' },
  { id:'password_authenticator',     ns:'auth',        layer:'services', desc:'Default authenticator: validates credentials against system_auth.roles using bcrypt-hashed passwords.' },
  { id:'standard_role_manager',      ns:'auth',        layer:'services', desc:'Default role manager: CRUD operations on roles/grants in system_auth tables via Raft group 0.' },
  { id:'paxos_state',                ns:'service::paxos', layer:'services', desc:'Paxos round state (promise, proposal, commit): static methods drive CAS prepare/accept/learn phases.' },
  { id:'service_level_controller',   ns:'qos',         layer:'services', desc:'Controls per-user scheduling groups and QoS service levels, mapping authenticated users/roles to effective service level options.' },
  { id:'authenticator',              ns:'auth',        layer:'services', desc:'Abstract interface for authenticating role identity via pluggable credential mechanisms (password, LDAP, etc.).' },
  { id:'authorizer',                 ns:'auth',        layer:'services', desc:'Abstract interface for granting, revoking, and querying permissions on resources for authenticated roles.' },
  { id:'role_manager',               ns:'auth',        layer:'services', desc:'Abstract interface for creating, dropping, granting, and querying roles and their hierarchy.' },
  { id:'cdc_metadata',               ns:'cdc',         layer:'services', desc:'Tracks known CDC generations and maps partition tokens to CDC stream IDs for write augmentation routing.' },

  // === QUERY LAYER (sub-components) ===
  { id:'select_statement',           ns:'cql3::statements', layer:'query', desc:'Compiled SELECT: holds restrictions, selection, ordering; executes reads via query_processor.' },
  { id:'modification_statement',     ns:'cql3::statements', layer:'query', desc:'Base for INSERT/UPDATE/DELETE: holds column operations, restrictions; executes writes via query_processor.' },
  { id:'batch_statement',            ns:'cql3::statements', layer:'query', desc:'CQL BATCH: groups modification_statements for atomic multi-partition writes.' },
  { id:'schema_altering_statement',  ns:'cql3::statements', layer:'query', desc:'Base for DDL (CREATE/ALTER/DROP TABLE/KEYSPACE): prepares schema mutations via query_processor.' },
  { id:'prepared_statements_cache',  ns:'cql3',        layer:'query',    desc:'LRU cache of prepared CQL statements keyed by MD5 hash, shared per shard.' },
  { id:'statement_restrictions',     ns:'cql3::restrictions', layer:'query', desc:'Parsed WHERE clause: partition key, clustering, and regular column restrictions for query planning.' },
  { id:'query_options',              ns:'cql3',        layer:'query',    desc:'Per-query parameters: consistency level, bound variable values, paging state, serial consistency, and timestamps.' },
  { id:'cql_statement',              ns:'cql3',        layer:'query',    desc:'Abstract base for all executable CQL statements, defining check_access(), validate(), and execute() interface.' },
  { id:'selection',                  ns:'cql3::selection', layer:'query', desc:'SELECT clause column selection logic: manages which columns to fetch and produces result set metadata.' },
  { id:'result_set',                 ns:'cql3',        layer:'query',    desc:'Tabular query result container holding rows of column values with associated metadata.' },
  { id:'functions_registry',         ns:'cql3::functions', layer:'query', desc:'Global function registry for all built-in and user-defined functions/aggregates, resolved by name and argument types.' },

  // === API LAYER (sub-components) ===
  { id:'cql_server_controller',      ns:'cql_transport', layer:'api',    desc:'Lifecycle controller for the CQL native transport: creates, starts, and stops the sharded cql_server.' },
  { id:'alternator_controller',      ns:'alternator',  layer:'api',      desc:'Lifecycle controller for the Alternator DynamoDB-compatible HTTP endpoint: owns executor and server.' },
  { id:'event_notifier',             ns:'cql_transport', layer:'api',    desc:'Pushes topology/status/schema change events to CQL clients registered for REGISTER.' },
  { id:'rmw_operation',              ns:'alternator',  layer:'api',      desc:'Read-modify-write CAS operation for Alternator: UpdateItem, DeleteItem with conditions.' },
];

var detailedClassEdges = [
  // ===================================================================
  // STORAGE LAYER EDGES
  // ===================================================================

  // --- table ---
  ['table','compaction_manager','ref',5],          // _compaction_manager is compaction_manager& (ctor param)
  ['table','sstables_manager','ref',4],            // _sstables_manager is sstables_manager& (ctor param)
  ['table','row_cache','ref',5],                   // _cache is row_cache member (owned)
  ['table','cache_tracker','ctor-param',3],        // row_cache_tracker passed to ctor, forwarded to row_cache
  ['table','commitlog','raw-ptr',3],               // _commitlog is db::commitlog* (set via mark_ready_for_writes)
  ['table','dirty_memory_manager','raw-ptr',3],    // _config.dirty_memory_manager is dirty_memory_manager*

  // --- memtable ---
  ['memtable','dirty_memory_manager','ref',5],     // _dirty_mgr is dirty_memory_manager& (ctor param)

  // --- row_cache ---
  ['row_cache','cache_tracker','ref',5],           // _tracker is cache_tracker& (ctor param)
  ['row_cache','memtable','method-param',3],       // update() and update_invalidating() take memtable&

  // --- commitlog ---
  ['commitlog','config','method-param',2],         // commitlog::config::from_db_config(const db::config&)

  // --- sstable ---
  ['sstable','large_data_handler','ref',4],        // _large_data_handler is large_data_handler& (ctor param)
  ['sstable','sstables_manager','ref',4],          // _manager is sstables_manager& (ctor param)

  // --- sstables_manager ---
  ['sstables_manager','storage_manager','raw-ptr',3],           // _storage is storage_manager*
  ['sstables_manager','large_data_handler','ref',4],            // _large_data_handler is large_data_handler&
  ['sstables_manager','cache_tracker','ref',3],                 // _cache_tracker is cache_tracker&
  ['sstables_manager','feature_service','ref',2],               // _features is gms::feature_service&
  ['sstables_manager','sstable_compressor_factory','ref',2],    // _compressor_factory is sstable_compressor_factory&

  // --- sstable_directory ---
  ['sstable_directory','sstables_manager','ref',4],  // _manager is sstables_manager& (ctor param)
  ['sstable_directory','table','method-param',2],    // ctor overload takes replica::table&

  // --- compaction_strategy_impl ---
  ['compaction_strategy_impl','compaction_backlog_manager','method-param',2], // make_backlog_tracker() returns tracker impl

  // --- dirty_memory_manager ---
  ['dirty_memory_manager','database','raw-ptr',3],   // _db is replica::database*

  // --- large_data_handler ---
  ['large_data_handler','system_keyspace','pluggable',3],   // _sys_ks is pluggable<system_keyspace>
  ['large_data_handler','feature_service','ref',2],         // cql_table_large_data_handler._feat is feature_service&

  // --- compaction_group ---
  ['compaction_group','table','ref',8],                         // back-reference to owning table
  ['compaction_group','sstable_set','ref',7],                   // _main_sstables, _maintenance_sstables are lw_shared_ptr<sstable_set>
  ['compaction_group','compaction_backlog_manager','observer',4], // registers backlog tracker with the backlog manager
  ['compaction_group','compaction_manager','method-param',3],   // submits compaction tasks to compaction_manager

  // --- compaction_task_executor ---
  ['compaction_task_executor','compaction_manager','ref',8],    // _cm is compaction_manager& (back-reference to owning manager)
  ['compaction_task_executor','table','method-param',3],        // operates on table data during compaction

  // --- sstable_set ---
  ['sstable_set','sstable','ref',8],                  // contains shared_sstable instances
  ['sstable_set','mutation_reader','method-param',4], // create_single_key_sstable_reader() returns mutation_reader

  // --- sstable_writer ---
  ['sstable_writer','sstable','ref',8],    // writes into an sstable
  ['sstable_writer','schema','ctor-param',7], // ctor takes const schema& for serialization

  // --- index_reader ---
  ['index_reader','sstable','ref',8],                     // reads the partition index of an sstable
  ['index_reader','partition_index_cache','ref',7],        // uses the partition index page cache
  ['index_reader','cache_tracker','method-param',3],       // accesses cache_tracker via sstables_manager for lru/region

  // --- partition_index_cache ---
  ['partition_index_cache','cache_tracker','ctor-param',5], // ctor takes lru & region from cache_tracker

  // --- commitlog_replayer ---
  ['commitlog_replayer','database','sharded-ref',8],       // _db is sharded<replica::database>& (ctor param)
  ['commitlog_replayer','system_keyspace','sharded-ref',6], // _sys_ks is sharded<system_keyspace>& (ctor param)
  ['commitlog_replayer','commitlog','method-param',5],     // recover() takes commitlog&

  // --- virtual_table ---
  ['virtual_table','schema','ref',7],              // _s is schema_ptr (defines the virtual table schema)
  ['virtual_table','mutation_reader','method-param',3], // as_mutation_source() returns mutation_reader

  // --- schema ---
  // schema is a self-contained immutable descriptor; no outgoing edges to graph nodes

  // --- data_dictionary_database ---
  ['data_dictionary_database','database','raw-ptr',8],         // type-erased proxy backed by replica::database
  ['data_dictionary_database','keyspace','method-param',5],    // find_keyspace() returns keyspace handles
  ['data_dictionary_database','config','method-param',4],      // get_config() returns db::config&
  ['data_dictionary_database','feature_service','method-param',3], // features() returns feature_service&
  ['data_dictionary_database','schema','method-param',4],      // find_schema() returns schema_ptr

  // --- keyspace ---
  ['keyspace','abstract_replication_strategy','ref',7], // owns replication_strategy_ptr
  ['keyspace','effective_replication_map','ref',7],     // owns static_effective_replication_map_ptr
  ['keyspace','erm_factory','ref',6],                   // ctor takes erm_factory&

  // --- querier_cache ---
  ['querier_cache','mutation_reader','ref',5],  // owns mutation_reader inside cached querier_base instances

  // ===================================================================
  // CLUSTER LAYER EDGES
  // ===================================================================

  // --- token_metadata ---
  ['token_metadata','shared_token_metadata','raw-ptr',5],  // _shared_token_metadata is shared_token_metadata* (back-pointer)
  ['token_metadata','topology','ref',6],                   // owns topology via impl; exposes get_topology()
  ['token_metadata','tablet_metadata','ref',6],            // owns tablet_metadata via impl; exposes tablets()

  // --- tablet_metadata ---
  ['tablet_metadata','tablet_map','ref',6],                // _tablets maps table_id -> tablet_map_ptr (one per table)

  // --- effective_replication_map ---
  ['effective_replication_map','abstract_replication_strategy','ref',7], // _rs is shared_ptr<const abstract_replication_strategy>
  ['effective_replication_map','token_metadata','ref',7],               // _tmptr is token_metadata_ptr
  ['effective_replication_map','erm_factory','raw-ptr',4],              // static variant holds _factory back-pointer

  // --- stream_session ---
  ['stream_session','stream_manager','ref',5],  // _mgr is stream_manager& (ctor param)

  // --- stream_plan ---
  ['stream_plan','stream_manager','ref',5],     // _mgr is stream_manager& (ctor param)

  // --- topology_state_machine ---
  ['topology_state_machine','raft_group0','method-param',3],      // abort_request() takes raft_group0&
  ['topology_state_machine','feature_service','method-param',3],  // abort_request/generate_cancel take feature_service&
  ['topology_state_machine','system_keyspace','method-param',3],  // wait_for_request_completion takes system_keyspace&

  // --- tablet_allocator ---
  ['tablet_allocator','database','ctor-param',5],             // ctor takes replica::database&
  ['tablet_allocator','migration_notifier','ctor-param',4],   // ctor takes migration_notifier&
  ['tablet_allocator','system_keyspace','method-param',3],    // balance_tablets takes system_keyspace*

  // --- load_broadcaster ---
  ['load_broadcaster','database','sharded-ref',5],  // _db is sharded<replica::database>&
  ['load_broadcaster','gossiper','ref',5],          // _gossiper is gms::gossiper& (publishes load via gossip)

  // --- versioned_value ---
  // Pure value type with factory methods; no outgoing edges to graph nodes

  // --- persistent_discovery ---
  ['persistent_discovery','query_processor','ref',6],       // _qp is query_processor& for persisting discovered peers
  ['persistent_discovery','messaging_service','method-param',4], // run() takes messaging_service& for RPC discovery

  // --- topology_coordinator ---
  ['topology_coordinator','raft_group0','ref',8],                      // _group0 member ref; central to all coordination
  ['topology_coordinator','topology_state_machine','ref',8],           // _topo_sm member ref; drives state transitions
  ['topology_coordinator','raft_server','ref',7],                      // _raft member ref; checks leadership, submits commands
  ['topology_coordinator','gossiper','ref',7],                         // _gossiper member ref; endpoint state management
  ['topology_coordinator','shared_token_metadata','ref',7],            // _shared_tm member ref; token ring mutations
  ['topology_coordinator','messaging_service','ref',6],                // _messaging member ref; sends topology RPCs
  ['topology_coordinator','system_keyspace','ref',6],                  // _sys_ks member ref; reads/writes topology state
  ['topology_coordinator','database','ref',6],                         // _db member ref; schema and table access
  ['topology_coordinator','system_distributed_keyspace','sharded-ref',5], // _sys_dist_ks member; CDC and service level ops
  ['topology_coordinator','cdc_generation','ref',5],                   // _cdc_gens member ref; CDC generation lifecycle
  ['topology_coordinator','tablet_allocator','ref',6],                 // _tablet_allocator member ref; tablet rebalancing
  ['topology_coordinator','view_building_coordinator','unique-ptr',5], // _vb_coordinator owned; view build coordination
  ['topology_coordinator','feature_service','ref',4],                  // _feature_service member ref; feature flag checks
  ['topology_coordinator','endpoint_lifecycle_notifier','ref',4],      // _lifecycle_notifier member ref; fires lifecycle events
  ['topology_coordinator','qos_controller','ref',4],                   // _sl_controller member ref; QoS upgrades
  ['topology_coordinator','migration_manager','observer',3],           // inherits migration_listener::empty_listener

  // --- repair_reader ---
  ['repair_reader','database','sharded-ref',7],    // ctor takes sharded<replica::database>&
  ['repair_reader','mutation_reader','ref',6],     // _reader wraps a mutation_reader internally

  // --- repair_writer ---
  ['repair_writer','database','sharded-ref',6],              // make_repair_writer takes sharded<replica::database>&
  ['repair_writer','view_update_generator','sharded-ref',4], // make_repair_writer takes sharded<view_update_generator>&

  // ===================================================================
  // SERVICES LAYER EDGES
  // ===================================================================

  // --- hints_manager ---
  ['hints_manager','storage_proxy','ref',4],            // _proxy is storage_proxy& (ctor param)
  ['hints_manager','gossiper','raw-ptr',2],             // _gossiper_anchor is shared_ptr<const gossiper>
  ['hints_manager','database','sharded-ref',3],         // _local_db is replica::database& (from sharded)
  ['hints_manager','hints_resource_manager','ref',3],   // _resource_manager is resource_manager& (ctor param)

  // --- hints_resource_manager ---
  ['hints_resource_manager','storage_proxy','ctor-param',2],  // ctor takes storage_proxy&
  ['hints_resource_manager','gossiper','raw-ptr',2],          // _gossiper_ptr is shared_ptr<const gossiper>

  // --- system_distributed_keyspace ---
  ['system_distributed_keyspace','query_processor','ref',4],      // _qp is query_processor&
  ['system_distributed_keyspace','migration_manager','ref',3],    // _mm is migration_manager&
  ['system_distributed_keyspace','storage_proxy','ref',3],        // _sp is storage_proxy&

  // --- view_building_coordinator ---
  ['view_building_coordinator','database','ref',5],              // _db is replica::database&
  ['view_building_coordinator','raft_server','ref',4],           // _raft is raft::server&
  ['view_building_coordinator','raft_group0','ref',4],           // _group0 is raft_group0&
  ['view_building_coordinator','system_keyspace','ref',4],       // _sys_ks is system_keyspace&
  ['view_building_coordinator','gossiper','ref',3],              // _gossiper is gms::gossiper&
  ['view_building_coordinator','messaging_service','ref',3],     // _messaging is messaging_service&

  // --- password_authenticator ---
  ['password_authenticator','query_processor','ref',5],          // _qp is query_processor&
  ['password_authenticator','raft_group0_client','ref',4],       // _group0_client is raft_group0_client&
  ['password_authenticator','migration_manager','ref',3],        // _migration_manager is migration_manager&
  ['password_authenticator','auth_cache','ref',3],               // _cache is auth::cache&

  // --- standard_role_manager ---
  ['standard_role_manager','query_processor','ref',5],           // _qp is query_processor&
  ['standard_role_manager','raft_group0_client','ref',4],        // _group0_client is raft_group0_client&
  ['standard_role_manager','migration_manager','ref',3],         // _migration_manager is migration_manager&
  ['standard_role_manager','auth_cache','ref',3],                // _cache is auth::cache&

  // --- paxos_state ---
  ['paxos_state','storage_proxy','method-param',4],  // prepare/accept/learn static methods take storage_proxy&
  ['paxos_state','paxos_store','method-param',4],    // prepare/accept/learn/prune static methods take paxos_store&

  // --- service_level_controller ---
  ['service_level_controller','auth_service','sharded-ref',7],         // _auth_service sharded ref; role-to-service-level mapping
  ['service_level_controller','shared_token_metadata','ref',4],        // _token_metadata member ref; topology identity checks
  ['service_level_controller','query_processor','method-param',4],     // reload_distributed_data_accessor() takes qp&
  ['service_level_controller','raft_group0_client','method-param',4],  // reload_distributed_data_accessor() takes group0_client&
  ['service_level_controller','system_keyspace','method-param',3],     // get_create_driver_service_level_mutations() takes sys_ks&

  // --- authenticator ---
  ['authenticator','raft_group0_client','method-param',4],  // create/alter/drop take group0_batch& from raft_group0_client

  // --- authorizer ---
  ['authorizer','raft_group0_client','method-param',4],  // grant/revoke take group0_batch& from raft_group0_client

  // --- role_manager ---
  ['role_manager','raft_group0_client','method-param',5],  // create/drop/alter/grant/revoke/set_attribute/remove_attribute take group0_batch&

  // --- cdc_metadata ---
  // Self-contained data structure; no outgoing edges to graph nodes

  // ===================================================================
  // QUERY LAYER EDGES
  // ===================================================================

  // --- select_statement ---
  ['select_statement','query_processor','method-param',4],      // execute/do_execute take query_processor&
  ['select_statement','statement_restrictions','ref',5],        // _restrictions is shared_ptr<const statement_restrictions>

  // --- modification_statement ---
  ['modification_statement','query_processor','method-param',4],  // execute/do_execute take query_processor&

  // --- batch_statement ---
  ['batch_statement','query_processor','method-param',4],             // execute takes query_processor&
  ['batch_statement','modification_statement','ref',5],               // _statements is vector<shared_ptr<modification_statement>>

  // --- schema_altering_statement ---
  ['schema_altering_statement','query_processor','method-param',4],   // execute/prepare_schema_mutations take query_processor&

  // --- prepared_statements_cache (owned by query_processor) ---
  // No outgoing edges — pure cache data structure; query_processor owns it

  // --- query_options ---
  // Pure data/options class; no outgoing edges to graph nodes

  // --- cql_statement ---
  ['cql_statement','query_processor','method-param',6],  // check_access/validate/execute all take query_processor&
  ['cql_statement','query_options','method-param',5],    // execute/execute_without_checking take const query_options&

  // --- selection ---
  ['selection','result_set','unique-ptr',6],              // result_set_builder owns unique_ptr<result_set>
  ['selection','query_options','raw-ptr',4],              // result_set_builder._options is const query_options*
  ['selection','statement_restrictions','ref',5],         // restrictions_filter holds shared_ptr<statement_restrictions>
  ['selection','database','method-param',3],              // from_selectors() takes data_dictionary::database

  // --- result_set ---
  // Self-contained data container; no outgoing edges to graph nodes

  // --- functions_registry ---
  ['functions_registry','database','method-param',4],  // get/validate_types/match_arguments take data_dictionary::database

  // ===================================================================
  // API LAYER EDGES
  // ===================================================================

  // --- cql_server_controller ---
  ['cql_server_controller','auth_service','sharded-ref',4],      // _auth_service is sharded<auth::service>&
  ['cql_server_controller','gossiper','sharded-ref',3],          // _gossiper is sharded<gms::gossiper>&
  ['cql_server_controller','query_processor','sharded-ref',4],   // _qp is sharded<query_processor>&
  ['cql_server_controller','qos_controller','sharded-ref',3],    // _sl_controller is sharded<qos::service_level_controller>&
  ['cql_server_controller','config','ref',3],                    // _config is const db::config&
  ['cql_server_controller','cql_server','unique-ptr',5],         // _server is unique_ptr<sharded<cql_server>>
  ['cql_server_controller','migration_notifier','sharded-ref',2], // _mnotifier is sharded<migration_notifier>&

  // --- alternator_controller ---
  ['alternator_controller','gossiper','sharded-ref',3],                    // _gossiper is sharded<gms::gossiper>&
  ['alternator_controller','storage_proxy','sharded-ref',4],               // _proxy is sharded<storage_proxy>&
  ['alternator_controller','storage_service','sharded-ref',3],             // _ss is sharded<storage_service>&
  ['alternator_controller','migration_manager','sharded-ref',3],           // _mm is sharded<migration_manager>&
  ['alternator_controller','system_distributed_keyspace','sharded-ref',3], // _sys_dist_ks is sharded<system_distributed_keyspace>&
  ['alternator_controller','cdc_generation','sharded-ref',2],              // _cdc_gen_svc is sharded<cdc::generation_service>&
  ['alternator_controller','auth_service','sharded-ref',3],                // _auth_service is sharded<auth::service>&
  ['alternator_controller','qos_controller','sharded-ref',2],              // _sl_controller is sharded<qos::service_level_controller>&
  ['alternator_controller','config','ref',3],                              // _config is const db::config&
  ['alternator_controller','alternator_executor','unique-ptr',5],          // _executor is owned sharded<executor>
  ['alternator_controller','alternator_server','unique-ptr',5],            // _server is owned sharded<server>

  // --- event_notifier ---
  ['event_notifier','cql_server','ref',5],  // _server is cql_server& (owning server back-reference)

  // --- rmw_operation ---
  ['rmw_operation','storage_proxy','ctor-param',3],  // ctor takes storage_proxy& for schema resolution

  // ===================================================================
  // CROSS-LAYER EDGES (connecting detailed nodes as targets)
  // ===================================================================

  // table owns a secondary_index_manager
  ['table','secondary_index_manager','ref',4],             // each table holds secondary_index_manager for its indexes

  // table owns compaction_groups
  ['table','compaction_group','ref',7],                    // _compaction_groups holds all compaction_group instances

  // gossiper owns endpoint_state instances
  ['gossiper','endpoint_state','ref',6],                   // _endpoint_state_map maps endpoints to their endpoint_state

  // gossiper disseminates versioned_values via endpoint_state
  ['endpoint_state','versioned_value','ref',6],            // application_state map stores versioned_value entries

  // query_processor owns prepared_statements_cache
  ['query_processor','prepared_statements_cache','ref',5],  // _prepared_cache is prepared_statements_cache member

  // database owns querier_cache
  ['database','querier_cache','ref',5],                    // _querier_cache member for paged query continuity

  // database owns keyspace instances
  ['database','keyspace','ref',6],                         // _keyspaces maps keyspace names to keyspace instances

  // database owns virtual_table instances
  ['database','virtual_table','ref',4],                    // _virtual_tables holds virtual table registrations

  // cql_server_controller references endpoint_lifecycle_notifier
  ['cql_server_controller','endpoint_lifecycle_notifier','sharded-ref',2], // _lifecycle_notifier is sharded<endpoint_lifecycle_notifier>&

  // database creates mutation_readers via table
  ['table','mutation_reader','method-param',4],            // make_reader()/as_mutation_source() return mutation_reader

  // select_statement uses selection
  ['select_statement','selection','ref',6],                // _selection is shared_ptr<selection>

  // auth_service owns authenticator, authorizer, role_manager
  ['auth_service','authenticator','unique-ptr',6],         // _authenticator is unique_ptr<authenticator>
  ['auth_service','authorizer','unique-ptr',6],            // _authorizer is unique_ptr<authorizer>
  ['auth_service','role_manager','unique-ptr',6],          // _role_manager is unique_ptr<role_manager>

  // cdc_service uses cdc_metadata
  ['cdc_service','cdc_metadata','ref',5],                  // tracks CDC stream mappings for write augmentation

  // repair_service uses repair_reader and repair_writer
  ['repair_service','repair_reader','method-param',4],     // creates repair_reader for row-level repair ranges
  ['repair_service','repair_writer','method-param',4],     // creates repair_writer for applying repair diffs
];

var detailedDepDescriptions = {
  // ===================================================================
  // STORAGE LAYER
  // ===================================================================

  // --- table ---
  'table->compaction_manager->ref': 'Submits, tracks, and controls compaction tasks (including offstrategy compaction) for all compaction groups owned by the table.',
  'table->sstables_manager->ref': 'Creates new SSTable objects via make_sstable(), manages SSTable lifecycle (deletion, snapshots), and selects the preferred SSTable format version.',
  'table->row_cache->ref': 'Caches partition data from SSTables in memory to serve reads faster and avoid redundant disk I/O.',
  'table->cache_tracker->ctor-param': 'Provides LRU eviction tracking, memory accounting, and metrics for the per-table row cache.',
  'table->commitlog->raw-ptr': 'Writes mutations to the commit log for durability before applying them to memtables; activated via mark_ready_for_writes().',
  'table->dirty_memory_manager->raw-ptr': 'Throttles memtable writes via the region_group when dirty memory exceeds soft/hard limits.',

  // --- memtable ---
  'memtable->dirty_memory_manager->ref': 'Tracks real and unspooled dirty memory usage via the region_group and accounts for memory being spooled to disk during flush.',

  // --- row_cache ---
  'row_cache->cache_tracker->ref': 'Allocates cache memory from the LSA region, evicts entries via the shared LRU, and reports cache hit/miss/eviction statistics.',
  'row_cache->memtable->method-param': 'Merges flushed memtable contents into the cache via update() and update_invalidating(), keeping the cache synchronized after a flush.',

  // --- commitlog ---
  'commitlog->config->method-param': 'Reads commitlog directory, segment size, sync period, and flush thresholds from db::config via from_db_config().',

  // --- sstable ---
  'sstable->large_data_handler->ref': 'Detects and records oversized partitions, rows, cells, and collection elements into system.large_* tables during SSTable writes.',
  'sstable->sstables_manager->ref': 'Manages SSTable lifecycle (activation, deactivation, memory reclaim), accesses writer configuration, and registers in the manager\'s active/close lists.',

  // --- sstables_manager ---
  'sstables_manager->storage_manager->raw-ptr': 'Obtains object-storage endpoint clients for S3/cloud-based SSTable storage and resolves configured object storage endpoints.',
  'sstables_manager->large_data_handler->ref': 'Passes the handler to each newly created SSTable so it can detect and log oversized data during writes.',
  'sstables_manager->cache_tracker->ref': 'Provides access to the LSA region, cached file stats, and partition index cache stats used by SSTable index caching.',
  'sstables_manager->feature_service->ref': 'Determines the highest supported SSTable format version based on cluster-wide enabled features, ensuring cross-node format compatibility.',
  'sstables_manager->sstable_compressor_factory->ref': 'Creates compressor instances for SSTable data compression and decompression.',

  // --- sstable_directory ---
  'sstable_directory->sstables_manager->ref': 'Creates SSTable instances when loading from a directory and controls concurrency via the directory semaphore.',
  'sstable_directory->table->method-param': 'Extracts the sstables_manager, schema, sharder, and storage options from the table to load SSTables from its data directory.',

  // --- compaction_strategy_impl ---
  'compaction_strategy_impl->compaction_backlog_manager->method-param': 'Returns a backlog tracker via make_backlog_tracker(), registered with the backlog manager to compute compaction backlog for I/O scheduling decisions.',

  // --- dirty_memory_manager ---
  'dirty_memory_manager->database->raw-ptr': 'Identifies and flushes the largest memtable via flush_when_needed() when dirty memory pressure is detected.',

  // --- large_data_handler ---
  'large_data_handler->system_keyspace->pluggable': 'Records large partition/row/cell entries into system.large_* tables; plugged late to break the initialization dependency.',
  'large_data_handler->feature_service->ref': 'Listens for feature enablement (large collection detection, dead row tracking) and switches to extended recording logic when new cluster features become available.',

  // --- compaction_group ---
  'compaction_group->table->ref': 'Back-references the owning table for schema, SSTable manager, compaction strategy, and configuration access during all compaction group operations.',
  'compaction_group->sstable_set->ref': 'Maintains main and maintenance SSTable sets that organize this compaction group\'s on-disk data for reads and compaction selection.',
  'compaction_group->compaction_backlog_manager->observer': 'Registers a compaction backlog tracker with the manager so the I/O scheduler can account for this group\'s compaction debt.',
  'compaction_group->compaction_manager->method-param': 'Submits compaction tasks and offstrategy compaction requests to the compaction manager when triggered by writes or strategy decisions.',

  // --- compaction_task_executor ---
  'compaction_task_executor->compaction_manager->ref': 'Executes compaction operations under the compaction manager\'s control, reporting state transitions and completion back to the manager.',
  'compaction_task_executor->table->method-param': 'Accesses table schema, SSTable sets, and compaction strategies when selecting and compacting SSTables for a compaction group.',

  // --- sstable_set ---
  'sstable_set->sstable->ref': 'Organizes shared_sstable instances into an ordered, queryable collection supporting efficient range lookups and incremental scanning.',
  'sstable_set->mutation_reader->method-param': 'Creates combined mutation readers over multiple SSTables via create_single_key_sstable_reader() and make_range_sstable_reader() for query execution.',

  // --- sstable_writer ---
  'sstable_writer->sstable->ref': 'Serializes mutation fragments (partition starts, rows, tombstones) into the SSTable\'s on-disk format during compaction and flush.',
  'sstable_writer->schema->ctor-param': 'Uses the table schema to determine column layout, serialization format, and metadata collection during SSTable writes.',

  // --- index_reader ---
  'index_reader->sstable->ref': 'Navigates the SSTable\'s partition index file to locate partition positions for efficient data file seeking.',
  'index_reader->partition_index_cache->ref': 'Loads and caches parsed partition index pages to avoid repeated disk reads for frequently accessed index entries.',
  'index_reader->cache_tracker->method-param': 'Accesses the LSA region and LRU tracking via the cache tracker for partition index page memory management.',

  // --- partition_index_cache ---
  'partition_index_cache->cache_tracker->ctor-param': 'Allocates index page memory from the LSA region and registers pages with the LRU for eviction under memory pressure.',

  // --- commitlog_replayer ---
  'commitlog_replayer->database->sharded-ref': 'Applies recovered mutations to the appropriate tables across all shards during startup commitlog replay.',
  'commitlog_replayer->system_keyspace->sharded-ref': 'Reads truncation records and replay positions from system tables to determine which commitlog segments need replaying.',
  'commitlog_replayer->commitlog->method-param': 'Iterates commitlog segments via recover() to read and deserialize mutations written before the last shutdown.',

  // --- virtual_table ---
  'virtual_table->schema->ref': 'Defines the virtual table\'s column layout and metadata via the owned schema_ptr.',
  'virtual_table->mutation_reader->method-param': 'Produces mutation readers via as_mutation_source() that generate data programmatically for virtual system table queries.',

  // --- data_dictionary_database ---
  'data_dictionary_database->database->raw-ptr': 'Provides a type-erased coordinator-side facade over the real replica::database for schema lookups without direct storage coupling.',
  'data_dictionary_database->keyspace->method-param': 'Returns keyspace handles via find_keyspace() for accessing replication strategy and keyspace metadata.',
  'data_dictionary_database->config->method-param': 'Exposes database configuration via get_config() for query processing and schema validation decisions.',
  'data_dictionary_database->feature_service->method-param': 'Exposes the cluster feature service via features() for checking feature flags during query preparation.',
  'data_dictionary_database->schema->method-param': 'Resolves table schemas via find_schema() for query compilation, validation, and execution planning.',

  // --- keyspace ---
  'keyspace->abstract_replication_strategy->ref': 'Owns the replication strategy that computes replica placement for all tables in this keyspace.',
  'keyspace->effective_replication_map->ref': 'Owns the precomputed effective replication map used for fast endpoint lookups during read and write coordination.',
  'keyspace->erm_factory->ref': 'Uses the factory to create and update effective replication maps when the token ring or replication strategy changes.',

  // --- querier_cache ---
  'querier_cache->mutation_reader->ref': 'Caches active mutation readers between paged query rounds to avoid re-seeking SSTables and re-filtering data on continuation.',

  // ===================================================================
  // CLUSTER LAYER
  // ===================================================================

  // --- token_metadata ---
  'token_metadata->shared_token_metadata->raw-ptr': 'Accesses the parent shared container for version tracking, lock acquisition, and creating new token_metadata snapshots.',
  'token_metadata->topology->ref': 'Exposes the DC/rack layout, node states, and host-to-endpoint mappings for all cluster nodes via get_topology().',
  'token_metadata->tablet_metadata->ref': 'Exposes per-table tablet maps describing tablet-to-replica assignments for the entire cluster via tablets().',

  // --- tablet_metadata ---
  'tablet_metadata->tablet_map->ref': 'Maps each table_id to its tablet_map, storing the tablet-to-replica mapping for every tablet-enabled table.',

  // --- effective_replication_map ---
  'effective_replication_map->abstract_replication_strategy->ref': 'Computes and queries replica placement for a keyspace using the strategy\'s placement algorithm (SimpleStrategy, NetworkTopologyStrategy).',
  'effective_replication_map->token_metadata->ref': 'Retains the token_metadata snapshot used to compute this replication map, keeping the associated topology version alive for consistent lookups.',
  'effective_replication_map->erm_factory->raw-ptr': 'Registers and unregisters itself in the factory\'s cache for deduplication across keyspaces sharing the same replication configuration.',

  // --- stream_session ---
  'stream_session->stream_manager->ref': 'Registers the session, sends streaming protocol messages, and coordinates file transfer tasks with the peer node.',

  // --- stream_plan ---
  'stream_plan->stream_manager->ref': 'Executes planned streaming operations by creating stream sessions and coordinating data transfer with remote nodes.',

  // --- topology_state_machine ---
  'topology_state_machine->raft_group0->method-param': 'Prepares and commits topology change commands that cancel pending requests via the Raft group0 client in abort_request().',
  'topology_state_machine->feature_service->method-param': 'Consults cluster feature state when generating topology mutation updates in abort_request() and generate_cancel_request_update().',
  'topology_state_machine->system_keyspace->method-param': 'Queries topology_request_state from system tables in wait_for_request_completion() to determine whether a topology request has completed.',

  // --- tablet_allocator ---
  'tablet_allocator->database->ctor-param': 'Accesses token metadata, table schemas, and database configuration for the tablet load balancing algorithm.',
  'tablet_allocator->migration_notifier->ctor-param': 'Registers as a migration listener to react to schema changes affecting tablet allocation.',
  'tablet_allocator->system_keyspace->method-param': 'Queries system tablet state (e.g., RF-change requests, rack-list colocation checks) during balance_tablets().',

  // --- load_broadcaster ---
  'load_broadcaster->database->sharded-ref': 'Periodically reads the local database disk load size for broadcasting to other nodes.',
  'load_broadcaster->gossiper->ref': 'Registers as an endpoint state change subscriber and disseminates local node load information via gossip application state updates.',

  // --- persistent_discovery ---
  'persistent_discovery->query_processor->ref': 'Persists learned Raft peer addresses to system tables via CQL queries during group 0 bootstrap discovery.',
  'persistent_discovery->messaging_service->method-param': 'Sends and receives Raft discovery protocol messages to find initial group 0 peers during cluster formation.',

  // --- topology_coordinator ---
  'topology_coordinator->raft_group0->ref': 'Central coordination point: starts operations, prepares and commits topology change commands, and manages the group 0 lifecycle during all topology transitions.',
  'topology_coordinator->topology_state_machine->ref': 'Reads and drives the topology state machine through join/leave/replace/rebuild transitions, applying state mutations at each step.',
  'topology_coordinator->raft_server->ref': 'Checks Raft leadership status, reads the current term, and submits topology commands to the Raft log for consensus.',
  'topology_coordinator->gossiper->ref': 'Manages endpoint gossip state during topology transitions: adds/removes endpoints, checks liveness, and advertises topology changes.',
  'topology_coordinator->shared_token_metadata->ref': 'Clones and mutates the token ring during topology transitions, updating token-to-endpoint mappings and tablet assignments.',
  'topology_coordinator->messaging_service->ref': 'Sends topology coordination RPCs (raft_topology_cmd, tablet_stream/repair/cleanup) to participating nodes during transitions.',
  'topology_coordinator->system_keyspace->ref': 'Reads and writes topology state, peer info, and transition progress to system tables throughout the coordination process.',
  'topology_coordinator->database->ref': 'Accesses table schemas, token metadata, and database configuration needed for topology change planning and execution.',
  'topology_coordinator->system_distributed_keyspace->sharded-ref': 'Manages CDC generation data and service level configurations during topology transitions that affect the token ring.',
  'topology_coordinator->cdc_generation->ref': 'Handles CDC generation lifecycle (creation, publication, cleanup) when topology changes alter the token ring layout.',
  'topology_coordinator->tablet_allocator->ref': 'Invokes tablet load balancing after topology changes to rebalance tablet replicas across the updated set of nodes.',
  'topology_coordinator->view_building_coordinator->unique-ptr': 'Owns and drives the view building coordinator to resume materialized view builds after topology stabilizes.',
  'topology_coordinator->feature_service->ref': 'Checks cluster feature flags to gate topology behaviors (e.g., tablet support, zero-token nodes, global request queue).',
  'topology_coordinator->endpoint_lifecycle_notifier->ref': 'Fires endpoint join/leave/up/down lifecycle events to registered subscribers when topology transitions complete.',
  'topology_coordinator->qos_controller->ref': 'Upgrades the QoS service level controller during topology transitions that enable new Raft-based data accessors.',
  'topology_coordinator->migration_manager->observer': 'Listens for schema change events as a migration_listener to react to DDL operations during topology coordination.',

  // --- repair_reader ---
  'repair_reader->database->sharded-ref': 'Creates local or multishard mutation readers over the database to read partition data for hash computation during row-level repair.',
  'repair_reader->mutation_reader->ref': 'Wraps a mutation_reader internally to stream mutation fragments from the data source, computing per-row hashes for repair comparison.',

  // --- repair_writer ---
  'repair_writer->database->sharded-ref': 'Writes repaired mutation fragments into new SSTables on the local database during the follower side of row-level repair.',
  'repair_writer->view_update_generator->sharded-ref': 'Generates materialized view updates for repaired data written during the repair process.',

  // ===================================================================
  // SERVICES LAYER
  // ===================================================================

  // --- hints_manager ---
  'hints_manager->storage_proxy->ref': 'Replays stored hints by sending mutations to destination replicas and queries the local database for schema and token metadata.',
  'hints_manager->gossiper->raw-ptr': 'Resolves endpoint host IDs to IP addresses when managing hint directories and sending hints to target replicas.',
  'hints_manager->database->sharded-ref': 'Provides the hint_sender with access to schema information and query execution during hint replay.',
  'hints_manager->hints_resource_manager->ref': 'Coordinates disk space watchdog limits, send-rate semaphores, and per-device quotas across all per-endpoint hint managers on a shard.',

  // --- hints_resource_manager ---
  'hints_resource_manager->storage_proxy->ctor-param': 'Vestigial construction-time dependency from the storage_proxy initialization site; not actively used at runtime.',
  'hints_resource_manager->gossiper->raw-ptr': 'Forwards the gossiper to each registered hints::manager during start() so hint managers can resolve host IDs and endpoint addresses.',

  // --- system_distributed_keyspace ---
  'system_distributed_keyspace->query_processor->ref': 'Executes internal CQL queries extensively for reading/writing CDC generation descriptions, view build statuses, and service level configurations.',
  'system_distributed_keyspace->migration_manager->ref': 'Starts group0 operations and announces schema mutations when creating or updating system_distributed tables.',
  'system_distributed_keyspace->storage_proxy->ref': 'Performs distributed mutations for CDC stream descriptions and generation timestamps, and accesses feature flags and token metadata.',

  // --- view_building_coordinator ---
  'view_building_coordinator->database->ref': 'Accesses token metadata and tablet maps to determine tablet-to-replica assignments during view building coordination.',
  'view_building_coordinator->raft_server->ref': 'Checks the current Raft term to detect leadership changes and abort the coordinator if the term changes.',
  'view_building_coordinator->raft_group0->ref': 'Starts Raft operations, prepares commands, and commits state machine mutations via the group0 client during view build coordination.',
  'view_building_coordinator->system_keyspace->ref': 'Creates mutations for view build status tracking, marks views as STARTED or SUCCESS, and manages the currently-processed base table ID.',
  'view_building_coordinator->gossiper->ref': 'Checks replica liveness via is_alive() before dispatching view building tasks to remote replicas.',
  'view_building_coordinator->messaging_service->ref': 'Sends RPC requests to remote replicas for executing view building tasks via send_work_on_view_building_tasks().',

  // --- password_authenticator ---
  'password_authenticator->query_processor->ref': 'Executes internal CQL queries for authenticating users (looking up salted password hashes), creating default superuser credentials, and accessing database configuration.',
  'password_authenticator->raft_group0_client->ref': 'Starts Raft group0 operations and commits authentication mutations (creating or updating password hashes) as linearizable group0 batches.',
  'password_authenticator->migration_manager->ref': 'Obtains the concurrent DDL retry count when retrying default superuser password creation on group0 conflicts.',
  'password_authenticator->auth_cache->ref': 'Looks up cached role records (including salted password hashes) during authentication to avoid querying the database on every login.',

  // --- standard_role_manager ---
  'standard_role_manager->query_processor->ref': 'Executes internal CQL queries for role CRUD operations, membership lookups, attribute queries, and enumerating all roles from system_auth.roles.',
  'standard_role_manager->raft_group0_client->ref': 'Starts Raft group0 operations and commits role management mutations (create, alter, drop, grant, revoke) as linearizable batches.',
  'standard_role_manager->migration_manager->ref': 'Obtains the concurrent DDL retry count when retrying default superuser role creation on group0 conflicts.',
  'standard_role_manager->auth_cache->ref': 'Looks up cached role records (superuser status, login capability, membership) to serve role queries without hitting the database.',

  // --- paxos_state ---
  'paxos_state->storage_proxy->method-param': 'Accesses the local database in prepare(), accept(), and learn() for querying data, retrieving table stats for CAS latency metrics, and checking truncation times.',
  'paxos_state->paxos_store->method-param': 'Loads and persists Paxos state (promises, proposals, decisions) in the system.paxos table during prepare(), accept(), learn(), and prune().',

  // --- service_level_controller ---
  'service_level_controller->auth_service->sharded-ref': 'Queries the role manager for service-level attributes attached to roles, resolves effective service levels, and maps authenticated users to scheduling groups.',
  'service_level_controller->shared_token_metadata->ref': 'Checks topology identity (via is_me) when handling endpoint lifecycle events such as a node leaving the cluster.',
  'service_level_controller->query_processor->method-param': 'Initializes the distributed data accessor for reading service level configurations from system_distributed tables.',
  'service_level_controller->raft_group0_client->method-param': 'Creates the Raft-based distributed data accessor for linearizable service level configuration updates.',
  'service_level_controller->system_keyspace->method-param': 'Reads and creates driver-level service level mutations during migration from v1 to v2 QoS configuration.',

  // --- authenticator ---
  'authenticator->raft_group0_client->method-param': 'Creates, alters, and drops authentication entries via group0_batch for linearizable credential management.',

  // --- authorizer ---
  'authorizer->raft_group0_client->method-param': 'Grants, revokes, and queries permissions via group0_batch for linearizable authorization changes.',

  // --- role_manager ---
  'role_manager->raft_group0_client->method-param': 'Performs all role lifecycle operations (create, drop, alter, grant, revoke, set/remove attributes) via group0_batch for linearizable role management.',

  // ===================================================================
  // QUERY LAYER
  // ===================================================================

  // --- select_statement ---
  'select_statement->query_processor->method-param': 'Provides access to the storage proxy and database context needed to coordinate read queries in execute() and do_execute().',
  'select_statement->statement_restrictions->ref': 'Encapsulates all WHERE-clause restrictions for computing partition ranges, clustering bounds, and filtering conditions during query execution.',

  // --- modification_statement ---
  'modification_statement->query_processor->method-param': 'Provides access to the storage proxy and schema context required to apply INSERT, UPDATE, or DELETE operations in execute() and get_mutations().',

  // --- batch_statement ---
  'batch_statement->query_processor->method-param': 'Provides access to the storage proxy for coordinating grouped write mutations in execute() and do_execute().',
  'batch_statement->modification_statement->ref': 'Groups individual INSERT/UPDATE/DELETE statements that compose the batch for atomic multi-partition writes.',

  // --- schema_altering_statement ---
  'schema_altering_statement->query_processor->method-param': 'Provides access to the Raft group0 client and migration machinery for applying DDL schema changes in execute() and prepare_schema_mutations().',

  // --- cql_statement ---
  'cql_statement->query_processor->method-param': 'All CQL statement operations (check_access, validate, execute) receive the query_processor for accessing the storage proxy, database, and schema context.',
  'cql_statement->query_options->method-param': 'The execute() and execute_without_checking() methods receive query_options carrying consistency level, bound values, paging state, and timestamps.',

  // --- selection ---
  'selection->result_set->unique-ptr': 'The result_set_builder accumulates query result rows into a result_set, producing the final tabular output of SELECT queries.',
  'selection->query_options->raw-ptr': 'The result_set_builder accesses query_options for paging state and the restrictions_filter accesses it for filtering decisions.',
  'selection->statement_restrictions->ref': 'The restrictions_filter uses statement_restrictions to evaluate per-row filtering conditions during result set construction.',
  'selection->database->method-param': 'The from_selectors() factory method takes a data_dictionary::database handle for resolving column types and user-defined types during selection preparation.',

  // --- functions_registry ---
  'functions_registry->database->method-param': 'Resolves function signatures, validates argument types, and matches overloaded functions using the data_dictionary::database for type system access.',

  // ===================================================================
  // API LAYER
  // ===================================================================

  // --- cql_server_controller ---
  'cql_server_controller->auth_service->sharded-ref': 'Passes the auth service to cql_server instances for authenticating and authorizing incoming CQL client connections.',
  'cql_server_controller->gossiper->sharded-ref': 'Advertises node CQL readiness state (RPC_READY) via gossip when the CQL server starts or stops.',
  'cql_server_controller->query_processor->sharded-ref': 'Passes the query processor to each cql_server shard so it can parse, prepare, and execute CQL statements on behalf of clients.',
  'cql_server_controller->qos_controller->sharded-ref': 'Registers the event_notifier as a QoS change subscriber and assigns scheduling groups to connections based on service level.',
  'cql_server_controller->config->ref': 'Reads CQL transport configuration: listen addresses, ports, TLS settings, and client resource limits.',
  'cql_server_controller->cql_server->unique-ptr': 'Manages the lifecycle of per-shard CQL protocol server instances, creating them on start and destroying them on stop.',
  'cql_server_controller->migration_notifier->sharded-ref': 'Registers the event_notifier as a migration listener so schema change events (CREATE, ALTER, DROP) are pushed to subscribed CQL clients.',

  // --- alternator_controller ---
  'alternator_controller->gossiper->sharded-ref': 'Passes the gossiper to the alternator executor for cluster topology awareness and node liveness checks.',
  'alternator_controller->storage_proxy->sharded-ref': 'Passes the storage proxy to the alternator executor to coordinate DynamoDB-compatible read and write operations across the cluster.',
  'alternator_controller->storage_service->sharded-ref': 'Passes the storage service to the alternator executor for access to token metadata and cluster management operations.',
  'alternator_controller->migration_manager->sharded-ref': 'Passes the migration manager to the alternator executor for performing schema mutations such as CreateTable and DeleteTable.',
  'alternator_controller->system_distributed_keyspace->sharded-ref': 'Passes system_distributed_keyspace to the alternator executor for managing Alternator tags and table-level metadata.',
  'alternator_controller->cdc_generation->sharded-ref': 'Passes the CDC generation service to the alternator executor to support CDC stream management for Alternator tables.',
  'alternator_controller->auth_service->sharded-ref': 'Passes the auth service to the alternator executor for authenticating DynamoDB-compatible API requests using AWS Signature V4.',
  'alternator_controller->qos_controller->sharded-ref': 'Passes the QoS controller to the alternator executor for per-request quality-of-service scheduling and resource controls.',
  'alternator_controller->config->ref': 'Reads Alternator-specific configuration: listen address, port, HTTPS settings, and write isolation mode.',
  'alternator_controller->alternator_executor->unique-ptr': 'Manages the per-shard DynamoDB-compatible request execution logic, creating and destroying executor instances.',
  'alternator_controller->alternator_server->unique-ptr': 'Manages per-shard HTTP/HTTPS server instances that accept DynamoDB-compatible API requests.',

  // --- event_notifier ---
  'event_notifier->cql_server->ref': 'Accesses connected client connections for dispatching schema change, topology change, and status change CQL protocol events.',

  // --- rmw_operation ---
  'rmw_operation->storage_proxy->ctor-param': 'Executes the read-modify-write cycle (via cas() for LWT or separate read/write paths) for Alternator PutItem, UpdateItem, and DeleteItem operations.',

  // ===================================================================
  // CROSS-LAYER
  // ===================================================================

  // --- table (cross-layer) ---
  'table->secondary_index_manager->ref': 'Manages all secondary indexes on the table: handles index creation, removal, and maintenance during mutations and compaction.',
  'table->compaction_group->ref': 'Owns all compaction groups for the table, with one compaction group per tablet replica on this shard, each managing its own LSM tree.',
  'table->mutation_reader->method-param': 'Creates mutation_reader objects via make_mutation_reader() over all data sources (memtables, SSTables, cache) for queries and streaming.',

  // --- gossiper (cross-layer) ---
  'gossiper->endpoint_state->ref': 'Tracks per-node heartbeat and application state key-value pairs (STATUS, TOKENS, SCHEMA, LOAD) exchanged during gossip rounds.',

  // --- endpoint_state (cross-layer) ---
  'endpoint_state->versioned_value->ref': 'Stores versioned application state entries (STATUS, TOKENS, SCHEMA, LOAD, DC, RACK) as versioned_value instances exchanged during gossip.',

  // --- query_processor (cross-layer) ---
  'query_processor->prepared_statements_cache->ref': 'Caches prepared CQL statements by key, supporting lookup, eviction, and invalidation when schema changes occur.',

  // --- database (cross-layer) ---
  'database->querier_cache->ref': 'Caches active mutation readers between paged query continuations so subsequent pages avoid re-seeking SSTables from scratch.',
  'database->keyspace->ref': 'Owns all keyspace instances on this shard, mapping keyspace names to their replication strategies and effective replication maps.',
  'database->virtual_table->ref': 'Registers virtual system tables that produce data programmatically for queries against system_schema and other virtual keyspaces.',

  // --- cql_server_controller (cross-layer) ---
  'cql_server_controller->endpoint_lifecycle_notifier->sharded-ref': 'Registers the event_notifier as a lifecycle subscriber so node join/leave/up/down events are pushed to subscribed CQL clients.',

  // --- select_statement (cross-layer) ---
  'select_statement->selection->ref': 'Uses the selection to determine which columns to fetch, how to transform results, and what metadata to include in the query response.',

  // --- auth_service (cross-layer) ---
  'auth_service->authenticator->unique-ptr': 'Owns the pluggable authenticator implementation for verifying user credentials during CQL and Alternator connection handshakes.',
  'auth_service->authorizer->unique-ptr': 'Owns the pluggable authorizer implementation for checking permissions on resources during CQL statement execution.',
  'auth_service->role_manager->unique-ptr': 'Owns the pluggable role manager implementation for CRUD operations on roles, grants, and role hierarchy.',

  // --- cdc_service (cross-layer) ---
  'cdc_service->cdc_metadata->ref': 'Tracks CDC generation stream mappings used to route CDC log writes to the correct partition keys during write augmentation.',

  // --- repair_service (cross-layer) ---
  'repair_service->repair_reader->method-param': 'Creates repair_reader instances for each repair range to read and hash local partition data for comparison with peer replicas.',
  'repair_service->repair_writer->method-param': 'Creates repair_writer instances to write mutation fragment diffs received from peer replicas into new local SSTables.',
};
