// Architecture node/edge data for ScyllaDB Architecture Visualizer
// This file is loaded before the main inline script to provide graph data
// without bloating index.html.

// =============================================================================
// DATA
// =============================================================================

const LAYERS = {
  storage: { label: 'Storage Engine', color: '#d4903e' },
  cluster: { label: 'Cluster / P2P', color: '#5b5b8e' },
  services: { label: 'Core Services', color: '#4ab8c9' },
  query: { label: 'Query Layer', color: '#e8a83e' },
  api: { label: 'API / Protocol', color: '#9e3b3b' },
};

// ---- DEPENDENCY TYPE DATA ----
const DEP_TYPES = {
  ref: { label: 'Reference (&)', color: '#4ab8c9' },
  'sharded-ref': { label: 'Sharded ref', color: '#5b5b8e' },
  'raw-ptr': { label: 'Raw pointer (late-init)', color: '#d4903e' },
  'unique-ptr': { label: 'Unique pointer (owned)', color: '#e8a83e' },
  observer: { label: 'Observer/listener', color: '#2d2d5e' },
  'pluggable': { label: 'Pluggable (late-init)', color: '#9e3b3b' },
  'ctor-param': { label: 'Constructor param', color: '#6ec6d8' },
  'method-param': { label: 'Method param only', color: '#7c8694' },
};

// ---- CLASS-LEVEL DATA ----
// All peering_sharded_service / async_sharded_service classes in the ScyllaDB codebase

const classNodes = [
  // === STORAGE LAYER ===
  { id:'database', ns:'replica', layer:'storage', desc:'The local replica database: owns tables, memtables, commitlog, SSTable managers, view update generator.' },
  { id:'compaction_manager', ns:'compaction', layer:'storage', desc:'Manages compaction tasks across all tables, pluggable system_keyspace dependency.' },
  { id:'storage_manager', ns:'sstables', layer:'storage', desc:'SSTable storage lifecycle management: creation, deletion, object storage.' },
  { id:'sstable_compressor_factory', ns:'sstables', layer:'storage', desc:'Default SSTable compressor factory. No sharded service dependencies.' },
  { id:'system_keyspace', ns:'db', layer:'storage', desc:'System keyspace operations: local metadata, peer info, compaction history, Raft state.' },
  { id:'view_builder', ns:'db::view', layer:'storage', desc:'Materialized view builder: tracks pending views and coordinates build progress.' },
  { id:'view_building_worker', ns:'db::view', layer:'storage', desc:'View building worker: executes tasks scheduled by coordinator for building views.' },
  { id:'view_update_generator', ns:'db::view', layer:'storage', desc:'Generates materialized view updates from base table mutations.' },
  { id:'snapshot_ctl', ns:'db::snapshot', layer:'storage', desc:'Snapshot controller: manages table snapshots, backups, and snapshot lifecycle.' },
  { id:'batchlog_manager', ns:'db', layer:'storage', desc:'Manages batchlog replay for atomic batch writes across partitions.' },
  { id:'sstables_loader', ns:'', layer:'storage', desc:'Loads SSTables from external sources into the database.' },
  { id:'raft_sys_table_storage', ns:'service', layer:'storage', desc:'Persistent Raft log storage: persists log entries, snapshots, term/vote, and commit index to the system.raft CQL table.' },

  // === CLUSTER LAYER ===
  { id:'gossiper', ns:'gms', layer:'cluster', desc:'Gossip protocol engine: failure detection (Phi accrual), endpoint state distribution, cluster membership.' },
  { id:'messaging_service', ns:'netw', layer:'cluster', desc:'RPC transport layer: serialization, compression, connection pooling, verb routing between nodes.' },
  { id:'shared_token_metadata', ns:'locator', layer:'cluster', desc:'Shared token metadata: token-to-endpoint mapping, pending ranges, tablet metadata.' },
  { id:'erm_factory', ns:'locator', layer:'cluster', desc:'Effective replication map factory: creates and caches replication maps per strategy.' },
  { id:'feature_service', ns:'gms', layer:'cluster', desc:'Cluster feature flags: tracks supported features across nodes for safe rolling upgrades.' },
  { id:'snitch', ns:'locator', layer:'cluster', desc:'Endpoint snitch: provides datacenter/rack locality information for replication placement.' },
  { id:'stream_manager', ns:'streaming', layer:'cluster', desc:'Orchestrates bulk data transfer between nodes for repair, bootstrap, rebuild.' },
  { id:'repair_service', ns:'repair', layer:'cluster', desc:'Drives anti-entropy repair: hash comparison, streaming of differing ranges.' },
  { id:'failure_detector', ns:'direct_fd', layer:'cluster', desc:'Direct failure detector for node liveness. No sharded service dependencies.' },
  { id:'address_map', ns:'service', layer:'cluster', desc:'Maps host IDs to IP addresses. Used via gossip_address_map alias by gossiper, storage_service, and messaging_service.' },
  { id:'direct_fd_pinger', ns:'service', layer:'cluster', desc:'Pinger for direct failure detector, sending ping messages over messaging service.' },
  { id:'raft_server', ns:'raft', layer:'cluster', desc:'Core Raft consensus engine: drives leader election, log replication, snapshotting, and configuration changes for each Raft group.' },
  { id:'raft_rpc', ns:'service', layer:'cluster', desc:'ScyllaDB Raft RPC transport: translates Raft protocol messages into network calls via messaging_service.' },

  // === SERVICES LAYER ===
  { id:'storage_service', ns:'service', layer:'services', desc:'Central orchestrator for the node lifecycle: bootstrap, decommission, topology changes, schema agreement.' },
  { id:'storage_proxy', ns:'service', layer:'services', desc:'Coordinates reads/writes across replicas: consistency levels, read repair, speculative retry, hints.' },
  { id:'migration_manager', ns:'service', layer:'services', desc:'Manages schema migrations and propagation. Observes gossiper state changes.' },
  { id:'raft_group_registry', ns:'service', layer:'services', desc:'Raft group registry: creates, owns, and manages the lifecycle of all raft::server instances on a shard, including group 0 and tablet Raft groups.' },
  { id:'raft_group0', ns:'service', layer:'services', desc:'Manages the lifecycle of cluster-wide Raft group 0: discovery, bootstrap, join/leave, and upgrade from pre-Raft procedures.' },
  { id:'raft_group0_client', ns:'service', layer:'services', desc:'Client interface for posting commands to Raft group 0: serializes operations via group0_guard and enforces linearizability.' },
  { id:'group0_state_machine', ns:'service', layer:'services', desc:'State machine for Raft group 0: applies committed commands (schema changes, topology changes, broadcast table queries) to the local database.' },
  { id:'qos_controller', ns:'qos', layer:'services', desc:'Quality-of-service: maps users to service levels and scheduling groups.' },
  { id:'auth_service', ns:'auth', layer:'services', desc:'Authentication/authorization service: manages authenticators, authorizers, role managers.' },
  { id:'auth_cache', ns:'auth', layer:'services', desc:'Auth permission and role cache: caches role records and permissions from system tables.' },
  { id:'cdc_generation', ns:'cdc', layer:'services', desc:'CDC generation service: manages CDC stream generations tied to token ring changes.' },
  { id:'cdc_service', ns:'cdc', layer:'services', desc:'CDC service: listens for schema changes and manages CDC log tables.' },
  { id:'task_manager', ns:'tasks', layer:'services', desc:'Distributed task manager: tracks long-running operations (repair, compaction) across the cluster.' },
  { id:'cache_hitrate_calculator', ns:'service', layer:'services', desc:'Cache hit-rate calculator: periodically recalculates and publishes cache stats via gossip.' },
  { id:'paxos_store', ns:'service', layer:'services', desc:'Paxos state store: persists Paxos promise/proposal/decision state for LWT.' },
  { id:'view_update_backlog_broker', ns:'service', layer:'services', desc:'View update backlog broker: publishes view backlog info via gossip.' },
  { id:'tracing', ns:'tracing', layer:'services', desc:'Distributed request tracing infrastructure for recording and storing trace events.' },
  { id:'mapreduce_service', ns:'service', layer:'services', desc:'Map-reduce service for distributed aggregation queries.' },
  { id:'strong_coordinator', ns:'service::sc', layer:'services', desc:'Strong consistency coordinator for Raft-based operations.' },
  { id:'groups_manager', ns:'service::sc', layer:'services', desc:'Strong consistency groups manager for Raft group lifecycle.' },
  { id:'client_routes', ns:'service', layer:'services', desc:'Client routes service for CQL native transport routing.' },

  // === QUERY LAYER ===
  { id:'query_processor', ns:'cql3', layer:'query', desc:'CQL query processing pipeline: parsing, validation, optimization, execution.' },
  { id:'lang_manager', ns:'lang', layer:'query', desc:'UDF runtime manager: Lua and WebAssembly scripting. No sharded service dependencies.' },
  { id:'vector_store_client', ns:'vector_search', layer:'query', desc:'Vector similarity search client for ANN queries. No sharded service dependencies.' },

  // === API LAYER ===
  { id:'cql_server', ns:'transport', layer:'api', desc:'CQL protocol server: handles client connections, authentication, query dispatch.' },
  { id:'alternator_executor', ns:'alternator', layer:'api', desc:'DynamoDB-compatible request executor: translates and executes DynamoDB API operations.' },
  { id:'alternator_server', ns:'alternator', layer:'api', desc:'Alternator HTTP server: handles DynamoDB API requests and authentication.' },
  { id:'alternator_expiration', ns:'alternator', layer:'api', desc:'Alternator TTL expiration service: cleans up expired items in Alternator tables.' },
  { id:'audit', ns:'audit', layer:'api', desc:'Audit logging service with syslog and table-based storage backends.' },
];

// ---- DEPENDENCY DESCRIPTIONS (discovered from ScyllaDB source) ----
const DEP_DESCRIPTIONS = {
  // --- storage_service ---
  'storage_service->database->sharded-ref': 'Accesses the local database for schema lookups, table/keyspace metadata, configuration (ring_delay, cluster_name, num_tokens), applying mutations, draining during shutdown, invoking compaction operations, and finding column families for tablet operations.',
  'storage_service->gossiper->ref': 'Performs shadow rounds during join/replace, manages endpoint lifecycle (add/remove endpoints), advertises local application state (STATUS, TOKENS, SCHEMA), starts/stops gossiping, queries endpoint liveness, and resolves host IDs to IPs.',
  'storage_service->messaging_service->sharded-ref': 'Registers all RPC verb handlers (node_ops_cmd, raft_topology_cmd, tablet_stream/repair/cleanup, join_node RPCs), sends RPCs to other nodes, bans hosts at the messaging layer during topology changes, and manages preferred IP reconnection.',
  'storage_service->migration_manager->sharded-ref': 'Plugs itself as a migration_listener to receive schema change callbacks (on_create/update/drop_keyspace), uses the group0_client for raft operations, invokes passive_announce for schema version propagation, and drains migration_manager during shutdown.',
  'storage_service->query_processor->ref': 'Executes internal CQL queries (e.g., during first-node bootstrap for topology mutations), accesses the storage_proxy for mutating data locally and updating fence versions, and upgrades the auth_version flag across all shards.',
  'storage_service->repair_service->sharded-ref': 'Invokes repair for node lifecycle operations: bootstrap_with_repair, replace_with_repair, decommission_with_repair, removenode_with_repair, rebuild_with_repair, and tablet-level repair; also shuts down during drain.',
  'storage_service->stream_manager->sharded-ref': 'Runs streaming operations (stream_ranges during bootstrap, decommission, removenode, rebuild, and tablet streaming) using its scheduling group, and shuts down on all shards during drain_on_shutdown.',
  'storage_service->snitch->sharded-ref': 'Queries for datacenter/rack location (used in token_metadata topology updates, join parameters, range_streamer construction), retrieves the snitch name for gossip application state, and subscribes to snitch reconfiguration events.',
  'storage_service->qos_controller->sharded-ref': 'Upgrades the QoS service level controller from v1 to v2 (using raft-based data accessor) during topology state loading, updates both service levels cache and effective service levels cache on topology transitions.',
  'storage_service->auth_service->ref': 'Triggers auth_cache().load_all() to reload all cached authentication/authorization data when the auth subsystem is upgraded to v2 during consistent topology change enablement.',
  'storage_service->raft_group_registry->raw-ptr': 'Accesses the group0 Raft server for leader checks and topology coordination via the registry.',
  'storage_service->raft_group0->method-param': 'Calls setup_group0(), join_group0(), and finish_setup_after_join() during cluster join and bootstrap to manage group 0 lifecycle.',
  'storage_service->raft_group0_client->raw-ptr': 'Starts guarded operations, prepares and commits topology change commands via the group0 client.',
  'storage_service->shared_token_metadata->ref': 'Reads the current token_metadata_ptr for endpoint/topology lookups, clones it for mutation, acquires the lock for serialized updates, sets new metadata after topology transitions, and provides access to tablet metadata and version tracking.',
  'storage_service->system_keyspace->sharded-ref': 'Reads and writes persistent cluster state: bootstrap state, saved tokens, endpoint/peer info, topology state, CDC generation IDs, host-to-IP mappings, peer features, service level versions, auth versions, and topology request entries.',
  'storage_service->cdc_generation->sharded-ref': 'Delegates CDC generation lifecycle: applies new CDC generation IDs via handle_cdc_generation, loads CDC tablet streams, calls leave_ring during decommission, and queries CDC timestamps and streams.',
  'storage_service->view_builder->sharded-ref': 'Upgrades view_builder version (upgrade_to_v1_5 / upgrade_to_v2) during topology state loading, marks existing views as built before bootstrap streaming, and drains all instances during shutdown.',
  'storage_service->feature_service->ref': 'Checks feature flags to gate functionality (e.g., file_stream, tablet_repair_scheduler, zero_token_nodes, topology_global_request_queue), validates enabled/unsafe features during topology transitions, and reads supported_feature_set for join parameters.',
  'storage_service->task_manager->ctor-param': 'Registers three task_manager modules during construction (node_ops, tablets, global_topology_requests) to track and manage background tasks for these operation types.',
  'storage_service->address_map->ref': 'Resolves host_id to IP address throughout topology operations, peer info updates, ownership calculations, schema version descriptions, and endpoint-to-address mappings for describe_ring.',
  'storage_service->erm_factory->ref': 'Creates static effective_replication_map instances for each keyspace during token metadata changes, computing replica placement on the local shard and all other shards.',
  'storage_service->gossiper->observer': 'Reacts to endpoint state changes (on_join, on_change, on_alive, on_dead, on_remove, on_restart) — updating system.peers, notifying up/down/CQL-ready status, and reconnecting preferred IPs.',

  // --- storage_proxy ---
  'storage_proxy->database->sharded-ref': 'Accesses local table/schema metadata, executes local reads and mutations, retrieves configuration parameters (timeouts, limits), finds effective replication maps, and initializes the hints managers.',
  'storage_proxy->shared_token_metadata->ref': 'Obtains the current token metadata pointer, resolves the node\'s own address (my_address()), and derives fencing tokens for topology-aware write coordination.',
  'storage_proxy->feature_service->ref': 'Checks cluster feature flags (e.g., separate_page_size_and_safety_limit, empty_replica_pages, lwt_with_tablets, batchlog_v2, address_nodes_by_host_ids) that gate backward-compatible protocol behavior.',
  'storage_proxy->messaging_service->raw-ptr': 'Registers/unregisters all RPC verb handlers (mutation, read_data, read_digest, truncate, paxos operations) and sends all inter-node RPC requests for distributed reads and writes.',
  'storage_proxy->gossiper->raw-ptr': 'Checks node liveness (is_alive()), resolves host IDs to/from IP addresses, enumerates live/unreachable cluster members for truncation quorum checks.',
  'storage_proxy->migration_manager->raw-ptr': 'Fetches schemas from remote nodes when handling incoming RPC requests (get_schema_for_read() and get_schema_for_write()), ensuring the correct schema version before processing.',
  'storage_proxy->system_keyspace->raw-ptr': 'Queries topology request entries from system tables when coordinating global topology operations like truncation and snapshotting.',
  'storage_proxy->raft_group_registry->raw-ptr': 'Accesses the Raft group registry for group 0 server access.',
  'storage_proxy->raft_group0_client->raw-ptr': 'Starts guarded operations, prepares and submits topology change commands for tablet-based truncation and snapshot requests.',
  'storage_proxy->cdc_generation->raw-ptr': 'Augments write mutations with CDC log entries and checks whether CDC augmentation is needed; set post-construction to break the circular dependency.',
  'storage_proxy->erm_factory->ref': 'Exposes the factory via get_erm_factory() so other components can create effective replication maps for keyspaces when initializing or updating topology.',

  // --- migration_manager ---
  'migration_manager->messaging_service->ref': 'Registers/unregisters RPC verb handlers (DEFINITIONS_UPDATE, MIGRATION_REQUEST, SCHEMA_CHECK, GET_SCHEMA_VERSION) and sends schema pull/push messages to peers.',
  'migration_manager->storage_proxy->ref': 'Accesses the database, schema tables, and data dictionary for reading/writing schema mutations.',
  'migration_manager->gossiper->ref': 'Checks endpoint liveness, reads endpoint/application state (SCHEMA version), enumerates live members, and publishes local schema version via add_local_application_state.',
  'migration_manager->feature_service->ref': 'Queries cluster_schema_features() for schema serialization and checks feature flags (group0_schema_versioning, in_memory_tables) that gate schema-related behavior.',
  'migration_manager->raft_group_registry->ref': 'Accesses the Raft group registry for group 0 server and upgrade state checks.',
  'migration_manager->raft_group0_client->ref': 'Starts group0 operations, adds entries to the Raft log, and prepares schema-change commands via the group0 client.',
  'migration_manager->system_keyspace->sharded-ref': 'Gets/sets the group0 schema version and passes it to db::schema_tables::merge_schema.',
  'migration_manager->storage_service->pluggable': 'Plugged late via plug_storage_service(); obtains a permit from storage_service for schema merge operations.',
  'migration_manager->gossiper->observer': 'Reacts to endpoint state changes (on_join, on_change, on_alive) to schedule schema pulls when remote endpoint states change.',

  // --- raft_group_registry ---
  'raft_group_registry->messaging_service->sharded-ref': 'Registers/unregisters all Raft RPC verb handlers (append_entries, vote_request, vote_reply, etc.) and the direct_fd_ping verb.',
  'raft_group_registry->raft_server->unique-ptr': 'Creates, owns, starts, aborts, and destroys raft::server instances for each Raft group via start_server_for_group().',
  'raft_group_registry->raft_rpc->unique-ptr': 'Creates raft_rpc instances as the RPC transport for each raft::server when starting a new Raft group.',
  'raft_group_registry->raft_sys_table_storage->unique-ptr': 'Creates raft_sys_table_storage instances as the persistence backend for each raft::server.',
  'raft_group_registry->direct_fd_pinger->ref': 'Uses the direct failure detector pinger and proxy to provide raft::failure_detector to all Raft groups.',

  // --- raft_group0 ---
  'raft_group0->raft_group_registry->ref': 'Accesses the Raft group registry to create/access the group 0 raft::server instance and manage its lifecycle.',
  'raft_group0->raft_group0_client->ref': 'Holds reference to the group0 client for posting commands and managing the upgrade state.',
  'raft_group0->gossiper->ref': 'Uses get_broadcast_address(), set_group0_id(), and peer exchange during Raft discovery and group 0 setup.',
  'raft_group0->feature_service->ref': 'Checks features like group0_limited_voters and supports_raft_cluster_mgmt to gate group 0 behavior.',
  'raft_group0->messaging_service->sharded-ref': 'Registers Raft discovery RPC verbs for initial group 0 peer exchange.',
  'raft_group0->storage_service->method-param': 'Passed to setup_group0(), join_group0(), finish_setup_after_join() for discovery leader initialization, topology upgrade state, and checking raft_topology_change_enabled().',
  'raft_group0->query_processor->method-param': 'Passed to create_server_for_group0() and setup methods to create raft_sys_table_storage (persistent Raft log) and persistent_discovery.',
  'raft_group0->migration_manager->method-param': 'Passed to create_server_for_group0(), setup_group0(), join_group0() to create the group0_state_machine and disable schema pulls once Raft-based schema management is active.',
  'raft_group0->system_keyspace->method-param': 'Passed to setup_group0() and setup_group0_if_exist() to get/set the persisted Raft group0 ID and check bootstrap completion state.',

  // --- raft_group0_client ---
  'raft_group0_client->raft_group_registry->ref': 'Accesses the group 0 raft::server via the registry to submit commands and perform read barriers.',
  'raft_group0_client->system_keyspace->ref': 'Reads and writes the group0 upgrade state and other persistent Raft metadata from system tables.',
  'raft_group0_client->shared_token_metadata->ref': 'Accesses token metadata for topology-aware operations within group 0 command processing.',

  // --- raft_server ---
  'raft_server->raft_rpc->unique-ptr': 'Owns the RPC transport implementation for sending and receiving Raft protocol messages (append_entries, vote, snapshot).',
  'raft_server->raft_sys_table_storage->unique-ptr': 'Owns the persistence backend for durably storing Raft log entries, snapshots, and term/vote state.',
  'raft_server->group0_state_machine->unique-ptr': 'Owns the state machine that applies committed Raft commands to the local database (for group 0).',

  // --- raft_rpc ---
  'raft_rpc->messaging_service->ref': 'Sends all Raft protocol messages (append_entries, vote_request, vote_reply, install_snapshot, etc.) over the network via messaging_service RPC verbs.',

  // --- raft_sys_table_storage ---
  'raft_sys_table_storage->query_processor->ref': 'Executes CQL queries against the system.raft table to persist and load Raft log entries, snapshots, and server state.',

  // --- group0_state_machine ---
  'group0_state_machine->raft_group0_client->ref': 'Manages state IDs for optimistic concurrency control when applying committed group 0 commands.',
  'group0_state_machine->migration_manager->ref': 'Applies committed schema mutations by merging them into the local schema via the migration manager.',
  'group0_state_machine->storage_proxy->ref': 'Applies committed data mutations (write_mutations commands) through the storage proxy.',
  'group0_state_machine->storage_service->ref': 'Applies committed topology change commands via the storage service.',
  'group0_state_machine->feature_service->ref': 'Checks feature flags to determine behavior when applying committed group 0 commands.',

  // --- gossiper ---
  'gossiper->shared_token_metadata->ref': 'Obtains topology info (my_host_id, my_address, datacenter, rack) and accesses the token metadata pointer for endpoint identity.',
  'gossiper->messaging_service->ref': 'Sends all gossip protocol messages (SYN, ACK, ACK2, ECHO, SHUTDOWN, GET_ENDPOINT_STATES) and registers incoming gossip RPC handlers.',
  'gossiper->address_map->ref': 'Maintains and exposes the mapping between host IDs and IP addresses for endpoint resolution throughout the cluster.',

  // --- messaging_service ---
  'messaging_service->feature_service->ref': 'Listens for the maintenance_tenant feature and enables the $maintenance scheduling tenant when activated.',
  'messaging_service->qos_controller->ref': 'Resolves scheduling groups for service levels, dynamically adds unknown isolation cookies, and obtains default scheduling groups for RPC dispatch.',
  'messaging_service->shared_token_metadata->raw-ptr': 'Determines peer datacenter/rack for encryption, compression, and tcp_nodelay decisions.',
  'messaging_service->address_map->ref': 'Records host_id-to-IP mappings when CLIENT_ID connections are established and resolves host IDs to IP addresses for outgoing RPC calls.',

  // --- database ---
  'database->compaction_manager->ref': 'Delegates compaction lifecycle (enable, drain, plug forwarding) while each table submits/triggers compactions and manages compaction strategies.',
  'database->feature_service->ref': 'Checks feature flags like fragmented_commitlog_entries during commitlog initialization.',
  'database->shared_token_metadata->ref': 'Accessed via get_token_metadata_ptr() for token/range resolution, keyspace creation, and tablet support.',
  'database->qos_controller->pluggable': 'Subscribes to QoS service level changes during start(), creating per-service-level reader concurrency semaphores dynamically.',
  'database->system_keyspace->pluggable': 'Forwards the plug to compaction_manager, large_data_handler, and corrupt_data_handler, enabling them to persist truncation records, compaction history, and corruption reports to system tables.',
  'database->view_update_generator->pluggable': 'Used in push_view_replica_updates() and stream_view_replica_updates() to generate and push materialized view update mutations.',
  'database->erm_factory->method-param': 'Passed to create_keyspace(), create_in_memory_keyspace(), and create_local_system_table() to construct effective replication maps when initializing keyspaces.',

  // --- stream_manager ---
  'stream_manager->database->sharded-ref': 'Reads table data from the local shard during streaming sessions.',
  'stream_manager->messaging_service->sharded-ref': 'Registers RPC handlers for stream session communication and sends/receives streaming data between nodes.',
  'stream_manager->migration_manager->sharded-ref': 'Used during streaming operations for schema synchronization between nodes.',
  'stream_manager->gossiper->ref': 'Registers/unregisters as an endpoint state change subscriber during start()/stop().',
  'stream_manager->view_builder->ref': 'Coordinates materialized view building when data is streamed in.',
  'stream_manager->gossiper->observer': 'Reacts to on_dead(), on_remove(), on_restart() callbacks to detect node failures and abort active streaming sessions to/from dead nodes.',

  // --- repair_service ---
  'repair_service->database->sharded-ref': 'Reads table data during repair, obtains schemas, creates readers, and accesses token metadata indirectly.',
  'repair_service->storage_proxy->sharded-ref': 'Coordinates repair write operations across nodes, including applying repair row diffs.',
  'repair_service->gossiper->sharded-ref': 'Checks node liveness, resolves host IDs, and registers a row_level_repair_gossip_helper for endpoint state change notifications during repair.',
  'repair_service->messaging_service->ref': 'Handles all repair RPC communication including row-level repair protocol messages and RPC stream sink/source creation.',
  'repair_service->system_keyspace->sharded-ref': 'Reads/writes repair history and repair task records to system tables.',
  'repair_service->view_builder->ref': 'Passed to the streaming consumer during repair to coordinate materialized view building as repaired data is written.',
  'repair_service->migration_manager->ref': 'Performs schema synchronization during repair operations.',
  'repair_service->shared_token_metadata->sharded-ref': 'Clones and manipulates token metadata for topology operations like replace_with_repair (accessed indirectly via database).',
  'repair_service->task_manager->ctor-param': 'Registers a repair::task_manager_module for tracking and managing repair tasks.',

  // --- system_keyspace ---
  'system_keyspace->query_processor->ref': 'Executes internal CQL extensively (35+ call sites) via execute_internal(), query_internal(), get_mutations_internal() to read/write all system table metadata.',
  'system_keyspace->database->ref': 'Plugs itself into the database on construction and creates system tables via db.create_local_system_table().',
  'system_keyspace->erm_factory->method-param': 'Provides the effective replication map factory needed when creating system keyspace tables with proper replication configurations.',

  // --- compaction_manager ---
  'compaction_manager->system_keyspace->pluggable': 'Writes compaction history entries via update_compaction_history() and reads them via get_compaction_history().',
  'compaction_manager->task_manager->ctor-param': 'Registers a compaction::task_manager_module for tracking compaction tasks.',

  // --- view_builder ---
  'view_builder->database->ref': 'Looks up tables/schemas, accesses token metadata, obtains reader permits/semaphores, and iterates views for the materialized view build process.',
  'view_builder->system_keyspace->ref': 'Persists and loads view build progress, manages built-view markers, and registers/removes view build status entries in local system tables.',
  'view_builder->query_processor->ref': 'Executes raft-coordinated view build status announcements (via announce_with_raft) and queries the view_build_status tables for distributed build state.',
  'view_builder->raft_group_registry->ref': 'Accesses the Raft group registry for group 0 operations.',
  'view_builder->raft_group0_client->ref': 'Coordinates view build status changes (started/success/removed) as linearizable raft group 0 commands across the cluster via the group0 client.',
  'view_builder->view_update_generator->ref': 'Delegates staging sstable registration and invokes view-update population (via populate_views) when processing base-table rows during incremental view builds.',
  'view_builder->migration_manager->raw-ptr': 'Used only during start() to wait for schema agreement across the cluster before beginning the view build procedure.',

  // --- view_building_worker ---
  'view_building_worker->database->ref': 'Looks up base tables and view schemas, accesses token/tablet metadata, obtains reader permits, and iterates tables to discover staging sstables.',
  'view_building_worker->system_keyspace->ref': 'Persists view building task mutations via raft, loads/removes built-view markers, manages view build progress, and registers views for building.',
  'view_building_worker->messaging_service->ref': 'Registers/unregisters the work_on_view_building_tasks RPC verb, enabling the view building coordinator to dispatch build tasks to worker nodes.',
  'view_building_worker->view_update_generator->ref': 'Invokes populate_views during range-build tasks and process_staging_sstables to generate and propagate view updates from staging data.',
  'view_building_worker->raft_group_registry->ref': 'Accesses the Raft group registry for group 0 operations.',
  'view_building_worker->raft_group0_client->ref': 'Starts raft group 0 operations, prepares and commits view-building-task mutations as group 0 commands via the group0 client.',

  // --- view_update_generator ---
  'view_update_generator->database->ref': 'Plugs itself into the database on construction; discovers staging sstables, obtains reader permits, and manages view-update memory backpressure.',
  'view_update_generator->storage_proxy->sharded-ref': 'Sends view update mutations to replicas, manages view-write abort/backlog, and coordinates distributed view update propagation.',

  // --- cdc_generation ---
  'cdc_generation->gossiper->ref': 'Queries endpoint states (shard count, sharding info), checks node liveness/status, and publishes CDC generation IDs as gossip application state.',
  'cdc_generation->system_keyspace->sharded-ref': 'Reads/writes CDC generation data, persists the current generation ID, checks rewrite status, and queries CDC stream state/history.',
  'cdc_generation->shared_token_metadata->ref': 'Obtains the token ring layout, counts normal token owners for generation sizing, and accesses tablet maps for CDC stream generation.',
  'cdc_generation->feature_service->ref': 'Checks whether the cdc_generations_v2 feature flag is enabled, which determines the CDC generation format (v1 vs v2) used during creation.',
  'cdc_generation->database->ref': 'Checks for the existence of CDC-related schemas (e.g., cdc_desc_v1), iterates all tables when loading CDC tablet streams, and looks up base table schemas.',
  'cdc_generation->gossiper->observer': 'Reacts to on_join/on_change callbacks after joining the ring to handle CDC generation gossip events.',

  // --- cdc_service ---
  'cdc_service->storage_proxy->ref': 'Accesses the database for schema lookups, executes read queries for pre-/post-images, registers itself on the proxy for CDC augmentation, and tracks CDC operation statistics.',

  // --- auth_service ---
  'auth_service->query_processor->ref': 'Accesses the database for keyspace checks, resets caches, and executes internal CQL queries for authentication, authorization, and role management.',
  'auth_service->raft_group_registry->ref': 'Accesses the Raft group registry for group 0 operations.',
  'auth_service->raft_group0_client->ref': 'Commits auth-related mutations (role/permission changes) as linearizable raft group 0 commands via group0_batch::commit().',
  'auth_service->auth_cache->ref': 'Loads all role data at startup, sets the permission loader callback, retrieves cached permission sets for authorization checks, and prunes cached permissions when resources are revoked.',

  // --- auth_cache ---
  'auth_cache->query_processor->ref': 'Executes internal CQL queries that fetch role records (login status, superuser flag, grants, salted hashes, attributes, permissions) from auth system tables into the in-memory cache.',

  // --- qos_controller ---
  'qos_controller->auth_service->sharded-ref': 'Accesses the role manager for querying service-level attributes attached to roles, resolving effective service levels, and mapping authenticated users to scheduling groups.',
  'qos_controller->shared_token_metadata->ref': 'Checks topology identity (via is_me) when handling endpoint lifecycle events such as a node leaving the cluster.',

  // --- query_processor ---
  'query_processor->storage_proxy->ref': 'Routes all CQL read/write operations to the storage layer.',
  'query_processor->vector_store_client->ref': 'Services vector-search (ANN) queries from CQL statements.',
  'query_processor->lang_manager->ref': 'Manages user-defined functions and aggregates written in supported scripting languages (Lua, WASM).',
  'query_processor->migration_manager->method-param': 'Obtains group0 guards for DDL operations and checks concurrent DDL retries; injected late via start_remote().',
  'query_processor->mapreduce_service->method-param': 'Delegates cluster-wide aggregation dispatch via query_processor::mapreduce(); injected late via start_remote().',
  'query_processor->strong_coordinator->method-param': 'Acquired via acquire_strongly_consistent_coordinator() for tablet-level strongly consistent reads and writes; injected late via start_remote().',
  'query_processor->raft_group_registry->method-param': 'Accesses the Raft group registry; injected late via start_remote().',
  'query_processor->raft_group0_client->method-param': 'Executes broadcast table queries and obtains group0 guards for schema changes; accessed via the group registry.',

  // --- cql_server ---
  'cql_server->query_processor->sharded-ref': 'Dispatches all incoming CQL protocol requests (query, prepare, execute, batch) to the query processor on the appropriate shard.',
  'cql_server->auth_service->ref': 'Authenticates connecting CQL clients during STARTUP/AUTH_RESPONSE handshake and resolves authorized prepared statement caches.',
  'cql_server->qos_controller->ref': 'Assigns each CQL connection to the appropriate scheduling group based on the authenticated user\'s service level.',
  'cql_server->gossiper->ref': 'Translates endpoint lifecycle events (join/leave/up/down) into CQL protocol topology and status change events sent to registered clients.',

  // --- alternator_executor ---
  'alternator_executor->gossiper->ref': 'Resolves the local node\'s broadcast address for the DescribeEndpoints DynamoDB-compatible API call.',
  'alternator_executor->storage_proxy->ref': 'Executes all DynamoDB-compatible read/write operations (PutItem, GetItem, Query, Scan, BatchWriteItem) by translating them into internal storage proxy calls.',
  'alternator_executor->storage_service->ref': 'Accesses node and cluster topology information needed for Alternator table management and schema operations.',
  'alternator_executor->migration_manager->ref': 'Performs schema changes (CreateTable, DeleteTable, UpdateTable) through the cluster\'s schema migration mechanism.',

  // --- alternator_server ---
  'alternator_server->alternator_executor->ref': 'Routes all incoming HTTP DynamoDB API requests through the executor\'s operation methods.',
  'alternator_server->storage_proxy->ref': 'Obtains timeout configuration and service permit allocation for incoming Alternator requests.',
  'alternator_server->gossiper->ref': 'Provides endpoint resolution and cluster state awareness in the HTTP request handling path.',
  'alternator_server->auth_service->ref': 'Verifies AWS Signature V4 authentication on incoming Alternator HTTP requests via the key_cache and verify_signature() flow.',
  'alternator_server->qos_controller->ref': 'Assigns Alternator request handling to the appropriate scheduling group based on the authenticated user\'s service level.',

  // --- alternator_expiration ---
  'alternator_expiration->storage_proxy->ref': 'Executes delete mutations for expired TTL items found during the periodic background scan of Alternator tables.',
  'alternator_expiration->gossiper->ref': 'Determines which token ranges this node owns so the expiration scan only processes locally-owned partitions.',

  // --- snapshot_ctl ---
  'snapshot_ctl->database->sharded-ref': 'Enumerates keyspaces/tables and invokes snapshot creation and clearing operations on each shard\'s local database instance.',
  'snapshot_ctl->storage_proxy->sharded-ref': 'Coordinates cluster-wide snapshot operations (take_cluster_column_family_snapshot) that require topology-aware coordination.',
  'snapshot_ctl->task_manager->ctor-param': 'Registers a snapshot::task_manager_module to track snapshot and backup operations as managed tasks.',
  'snapshot_ctl->storage_manager->ref': 'Handles SSTable-level storage operations during snapshot creation and backup tasks.',

  // --- batchlog_manager ---
  'batchlog_manager->query_processor->ref': 'Replays failed batches by re-executing the stored batch mutations through the CQL query processing path.',
  'batchlog_manager->system_keyspace->ref': 'Reads and writes batchlog entries (both v1 and v2 formats) in the system.batchlog table during replay and migration.',
  'batchlog_manager->feature_service->ref': 'Checks cluster feature flags that determine the batchlog format version (v1 vs v2) for migration and replay logic.',

  // --- sstables_loader ---
  'sstables_loader->database->sharded-ref': 'Looks up column families, loads SSTables into the local database, and accesses per-table schema for the refresh/load operation.',
  'sstables_loader->storage_service->sharded-ref': 'Calls verify_topology_quiesced() and await_topology_quiesced() to ensure topology is stable before performing load-and-stream, and obtains the effective replication map for token ownership resolution.',
  'sstables_loader->messaging_service->ref': 'Streams SSTables to other nodes during the load-and-stream operation when loaded SSTables contain data not owned by the local node.',
  'sstables_loader->view_builder->sharded-ref': 'Passes view_builder to the streaming consumer during load-and-stream to coordinate materialized view building as new SSTables are loaded.',
  'sstables_loader->view_building_worker->sharded-ref': 'Passes view_building_worker to the streaming consumer for executing view build tasks when loading SSTables that affect materialized views.',
  'sstables_loader->task_manager->ctor-param': 'Registers a task_manager_module to track SSTable load and download operations as managed tasks.',
  'sstables_loader->storage_manager->ref': 'Handles SSTable storage operations including object-store endpoint validation and SSTable file management during download tasks.',

  // --- cache_hitrate_calculator ---
  'cache_hitrate_calculator->database->sharded-ref': 'Collects per-table cache hit/miss statistics from all shards and recalculates optimal cache hit rates.',
  'cache_hitrate_calculator->gossiper->ref': 'Publishes computed cache hit rate ratios as gossip application state so other nodes can make cache-aware read routing decisions.',

  // --- paxos_store ---
  'paxos_store->system_keyspace->ref': 'Persists and loads Paxos consensus state (promises, proposals, decisions) in the system.paxos table for CAS operations.',
  'paxos_store->feature_service->ref': 'Checks whether per-table Paxos state schemas are enabled, determining how Paxos state is stored (shared vs. per-table schema).',
  'paxos_store->database->ref': 'Looks up and creates per-table Paxos state schemas, accesses column mappings, and performs the underlying data operations for Paxos rounds.',
  'paxos_store->migration_manager->ref': 'Listens for table drop events to clean up corresponding per-table Paxos state schemas via on_before_drop_column_family.',

  // --- view_update_backlog_broker ---
  'view_update_backlog_broker->storage_proxy->sharded-ref': 'Samples the local materialized view update backlog and determines the current backlog level for throttling decisions.',
  'view_update_backlog_broker->gossiper->ref': 'Publishes and receives view update backlog levels via gossip, enabling cluster-wide write throttling when views fall behind.',

  // --- audit ---
  'audit->shared_token_metadata->ref': 'Resolves the local node\'s IP address from the token metadata for including in audit log entries.',
  'audit->query_processor->ctor-param': 'Writes audit log entries to the audit table via internal CQL queries.',
  'audit->migration_manager->ctor-param': 'Ensures the audit keyspace and table schema exist before writing audit entries.',

  // --- direct_fd_pinger ---
  'direct_fd_pinger->messaging_service->ref': 'Sends DIRECT_FD_PING RPC messages to other nodes, implementing the direct failure detector pinger interface for Raft server liveness checks.',

  // --- mapreduce_service ---
  'mapreduce_service->storage_proxy->ref': 'Executes per-shard sub-queries of a distributed aggregation and resolves effective replication maps for splitting queries across vnodes or tablets.',
  'mapreduce_service->messaging_service->ref': 'Sends and receives map-reduce RPC messages for distributing aggregation sub-queries to remote shards.',
  'mapreduce_service->database->sharded-ref': 'Accesses table schemas and database configuration for query planning during distributed aggregation operations.',

  // --- strong_coordinator ---
  'strong_coordinator->groups_manager->ref': 'Acquires raft::server instances via groups_manager.acquire_server(group_id) for strongly-consistent tablet read and write operations.',
  'strong_coordinator->database->ref': 'Executes local reads directly via database.query() for strongly-consistent tablet queries, bypassing the storage_proxy layer.',

  // --- groups_manager ---
  'groups_manager->raft_group_registry->ref': 'Starts and stops raft::server instances for strongly-consistent tablet groups, and provides raft::server access to the coordinator via acquire_server().',
  'groups_manager->messaging_service->ref': 'Sends and receives Raft RPC messages (vote, append_entries, etc.) for the tablet-level strongly-consistent Raft groups via the inner rpc_impl class.',
  'groups_manager->query_processor->ref': 'Creates raft_sys_table_storage instances for persistent Raft log storage when starting new tablet Raft groups.',
  'groups_manager->database->ref': 'Accesses table/schema metadata when managing tablet Raft groups and resolving tablet-to-table mappings.',
  'groups_manager->shared_token_metadata->ref': 'Receives token_metadata_ptr via the update() method to track which tablets need Raft groups started or stopped.',
  'groups_manager->feature_service->ref': 'Checks whether the strongly-consistent tablets feature is enabled before starting Raft groups for newly assigned tablets.',

  // --- client_routes ---
  'client_routes->query_processor->ref': 'Executes CQL queries against the system.client_routes table for reading and writing client routing entries.',
  'client_routes->feature_service->ref': 'Checks whether the CLIENT_ROUTES cluster feature is enabled before activating client route management.',

  // --- task_manager ---
  'task_manager->messaging_service->raw-ptr': 'Registers and handles task-manager-specific RPC verbs for cross-node task status queries and coordination; set late via init_ms_handlers().',
};

// Class edges: [source, target, depType, strength]
// strength: 1-8 (usage count of this dependency within the service)
//   1 = single mention, 8 = pervasive usage throughout the class
const classEdges = [
  // --- storage_service (the mega hub) ---
  ['storage_service','database','sharded-ref',3],
  ['storage_service','gossiper','ref',3],
  ['storage_service','messaging_service','sharded-ref',3],
  ['storage_service','migration_manager','sharded-ref',2],
  ['storage_service','query_processor','ref',2],
  ['storage_service','repair_service','sharded-ref',2],
  ['storage_service','stream_manager','sharded-ref',2],
  ['storage_service','snitch','sharded-ref',1],
  ['storage_service','qos_controller','sharded-ref',1],
  ['storage_service','auth_service','ref',1],
  ['storage_service','raft_group_registry','raw-ptr',2],
  ['storage_service','raft_group0','method-param',2],
  ['storage_service','raft_group0_client','raw-ptr',2],
  ['storage_service','shared_token_metadata','ref',3],
  ['storage_service','system_keyspace','sharded-ref',2],
  ['storage_service','cdc_generation','sharded-ref',1],
  ['storage_service','view_builder','sharded-ref',1],
  ['storage_service','feature_service','ref',2],
  ['storage_service','task_manager','ctor-param',1],
  ['storage_service','address_map','ref',2],
  ['storage_service','erm_factory','ref',2],
  ['storage_service','gossiper','observer',3],

  // --- storage_proxy ---
  ['storage_proxy','database','sharded-ref',3],
  ['storage_proxy','shared_token_metadata','ref',3],
  ['storage_proxy','feature_service','ref',2],
  ['storage_proxy','messaging_service','raw-ptr',3],
  ['storage_proxy','gossiper','raw-ptr',2],
  ['storage_proxy','migration_manager','raw-ptr',2],
  ['storage_proxy','system_keyspace','raw-ptr',2],
  ['storage_proxy','raft_group_registry','raw-ptr',2],
  ['storage_proxy','raft_group0_client','raw-ptr',2],
  ['storage_proxy','cdc_generation','raw-ptr',1],
  ['storage_proxy','erm_factory','ref',2],

  // --- migration_manager ---
  ['migration_manager','messaging_service','ref',2],
  ['migration_manager','storage_proxy','ref',2],
  ['migration_manager','gossiper','ref',2],
  ['migration_manager','feature_service','ref',1],
  ['migration_manager','raft_group_registry','ref',2],
  ['migration_manager','raft_group0_client','ref',2],
  ['migration_manager','system_keyspace','sharded-ref',1],
  ['migration_manager','storage_service','pluggable',2],
  ['migration_manager','gossiper','observer',3],

  // --- raft_group_registry ---
  ['raft_group_registry','messaging_service','sharded-ref',2],
  ['raft_group_registry','raft_server','unique-ptr',3],
  ['raft_group_registry','raft_rpc','unique-ptr',2],
  ['raft_group_registry','raft_sys_table_storage','unique-ptr',2],
  ['raft_group_registry','direct_fd_pinger','ref',1],

  // --- raft_group0 ---
  ['raft_group0','raft_group_registry','ref',3],
  ['raft_group0','raft_group0_client','ref',2],
  ['raft_group0','gossiper','ref',2],
  ['raft_group0','feature_service','ref',1],
  ['raft_group0','messaging_service','sharded-ref',1],
  ['raft_group0','storage_service','method-param',1],
  ['raft_group0','query_processor','method-param',1],
  ['raft_group0','migration_manager','method-param',1],
  ['raft_group0','system_keyspace','method-param',1],

  // --- raft_group0_client ---
  ['raft_group0_client','raft_group_registry','ref',2],
  ['raft_group0_client','system_keyspace','ref',2],
  ['raft_group0_client','shared_token_metadata','ref',1],

  // --- raft_server ---
  ['raft_server','raft_rpc','unique-ptr',3],
  ['raft_server','raft_sys_table_storage','unique-ptr',3],
  ['raft_server','group0_state_machine','unique-ptr',3],

  // --- raft_rpc ---
  ['raft_rpc','messaging_service','ref',3],

  // --- raft_sys_table_storage ---
  ['raft_sys_table_storage','query_processor','ref',3],

  // --- group0_state_machine ---
  ['group0_state_machine','raft_group0_client','ref',2],
  ['group0_state_machine','migration_manager','ref',2],
  ['group0_state_machine','storage_proxy','ref',2],
  ['group0_state_machine','storage_service','ref',1],
  ['group0_state_machine','feature_service','ref',1],

  // --- gossiper ---
  ['gossiper','shared_token_metadata','ref',2],
  ['gossiper','messaging_service','ref',3],
  ['gossiper','address_map','ref',2],

  // --- messaging_service ---
  ['messaging_service','feature_service','ref',2],
  ['messaging_service','qos_controller','ref',1],
  ['messaging_service','shared_token_metadata','raw-ptr',1],
  ['messaging_service','address_map','ref',2],

  // --- database ---
  ['database','compaction_manager','ref',3],
  ['database','feature_service','ref',1],
  ['database','shared_token_metadata','ref',2],
  ['database','qos_controller','pluggable',1],
  ['database','system_keyspace','pluggable',1],
  ['database','view_update_generator','pluggable',2],
  ['database','erm_factory','method-param',1],

  // --- stream_manager ---
  ['stream_manager','database','sharded-ref',2],
  ['stream_manager','messaging_service','sharded-ref',2],
  ['stream_manager','migration_manager','sharded-ref',1],
  ['stream_manager','gossiper','ref',2],
  ['stream_manager','view_builder','ref',1],
  ['stream_manager','gossiper','observer',2],

  // --- repair_service ---
  ['repair_service','database','sharded-ref',2],
  ['repair_service','storage_proxy','sharded-ref',2],
  ['repair_service','gossiper','sharded-ref',2],
  ['repair_service','messaging_service','ref',2],
  ['repair_service','system_keyspace','sharded-ref',1],
  ['repair_service','view_builder','ref',1],
  ['repair_service','migration_manager','ref',1],
  ['repair_service','shared_token_metadata','sharded-ref',1],
  ['repair_service','task_manager','ctor-param',1],

  // --- system_keyspace ---
  ['system_keyspace','query_processor','ref',2],
  ['system_keyspace','database','ref',2],
  ['system_keyspace','erm_factory','method-param',1],

  // --- auth_service ---
  ['auth_service','query_processor','ref',2],
  ['auth_service','raft_group_registry','ref',1],
  ['auth_service','raft_group0_client','ref',1],
  ['auth_service','auth_cache','ref',2],

  // --- auth_cache ---
  ['auth_cache','query_processor','ref',2],

  // --- view_builder ---
  ['view_builder','database','ref',2],
  ['view_builder','system_keyspace','ref',1],
  ['view_builder','query_processor','ref',1],
  ['view_builder','raft_group_registry','ref',1],
  ['view_builder','raft_group0_client','ref',1],
  ['view_builder','view_update_generator','ref',2],
  ['view_builder','migration_manager','raw-ptr',1],

  // --- view_building_worker ---
  ['view_building_worker','database','ref',2],
  ['view_building_worker','system_keyspace','ref',1],
  ['view_building_worker','messaging_service','ref',1],
  ['view_building_worker','view_update_generator','ref',2],
  ['view_building_worker','raft_group_registry','ref',1],
  ['view_building_worker','raft_group0_client','ref',1],

  // --- view_update_generator ---
  ['view_update_generator','database','ref',2],
  ['view_update_generator','storage_proxy','sharded-ref',2],

  // --- cdc_generation ---
  ['cdc_generation','gossiper','ref',2],
  ['cdc_generation','system_keyspace','sharded-ref',1],
  ['cdc_generation','shared_token_metadata','ref',2],
  ['cdc_generation','feature_service','ref',1],
  ['cdc_generation','database','ref',1],
  ['cdc_generation','gossiper','observer',2],

  // --- cdc_service ---
  ['cdc_service','storage_proxy','ref',2],

  // --- compaction_manager ---
  ['compaction_manager','system_keyspace','pluggable',1],
  ['compaction_manager','task_manager','ctor-param',1],

  // --- qos_controller ---
  ['qos_controller','auth_service','sharded-ref',1],
  ['qos_controller','shared_token_metadata','ref',1],

  // --- task_manager ---
  ['task_manager','messaging_service','raw-ptr',1],

  // --- cql_server ---
  ['cql_server','query_processor','sharded-ref',3],
  ['cql_server','auth_service','ref',2],
  ['cql_server','qos_controller','ref',1],
  ['cql_server','gossiper','ref',1],

  // --- query_processor ---
  ['query_processor','storage_proxy','ref',3],
  ['query_processor','vector_store_client','ref',1],
  ['query_processor','lang_manager','ref',1],
  ['query_processor','migration_manager','method-param',1],
  ['query_processor','mapreduce_service','method-param',1],
  ['query_processor','strong_coordinator','method-param',1],
  ['query_processor','raft_group_registry','method-param',1],
  ['query_processor','raft_group0_client','method-param',1],

  // --- alternator_executor ---
  ['alternator_executor','gossiper','ref',2],
  ['alternator_executor','storage_proxy','ref',2],
  ['alternator_executor','storage_service','ref',1],
  ['alternator_executor','migration_manager','ref',1],

  // --- alternator_server ---
  ['alternator_server','alternator_executor','ref',2],
  ['alternator_server','storage_proxy','ref',2],
  ['alternator_server','gossiper','ref',1],
  ['alternator_server','auth_service','ref',1],
  ['alternator_server','qos_controller','ref',1],

  // --- alternator_expiration ---
  ['alternator_expiration','storage_proxy','ref',2],
  ['alternator_expiration','gossiper','ref',1],

  // --- snapshot_ctl ---
  ['snapshot_ctl','database','sharded-ref',2],
  ['snapshot_ctl','storage_proxy','sharded-ref',1],
  ['snapshot_ctl','task_manager','ctor-param',1],
  ['snapshot_ctl','storage_manager','ref',1],

  // --- batchlog_manager ---
  ['batchlog_manager','query_processor','ref',2],
  ['batchlog_manager','system_keyspace','ref',1],
  ['batchlog_manager','feature_service','ref',1],

  // --- sstables_loader ---
  ['sstables_loader','database','sharded-ref',2],
  ['sstables_loader','storage_service','sharded-ref',2],
  ['sstables_loader','messaging_service','ref',1],
  ['sstables_loader','view_builder','sharded-ref',1],
  ['sstables_loader','view_building_worker','sharded-ref',1],
  ['sstables_loader','task_manager','ctor-param',1],
  ['sstables_loader','storage_manager','ref',1],

  // --- cache_hitrate_calculator ---
  ['cache_hitrate_calculator','database','sharded-ref',2],
  ['cache_hitrate_calculator','gossiper','ref',1],

  // --- paxos_store ---
  ['paxos_store','system_keyspace','ref',2],
  ['paxos_store','feature_service','ref',1],
  ['paxos_store','database','ref',2],
  ['paxos_store','migration_manager','ref',1],

  // --- view_update_backlog_broker ---
  ['view_update_backlog_broker','storage_proxy','sharded-ref',2],
  ['view_update_backlog_broker','gossiper','ref',1],

  // --- tracing ---
  // tracing has no ctor deps on known sharded services

  // --- audit ---
  ['audit','shared_token_metadata','ref',1],
  ['audit','query_processor','ctor-param',1],
  ['audit','migration_manager','ctor-param',1],

  // --- direct_fd_pinger ---
  ['direct_fd_pinger','messaging_service','ref',1],

  // --- mapreduce_service ---
  ['mapreduce_service','storage_proxy','ref',2],
  ['mapreduce_service','messaging_service','ref',1],
  ['mapreduce_service','database','sharded-ref',1],

  // --- strong_coordinator ---
  ['strong_coordinator','groups_manager','ref',2],
  ['strong_coordinator','database','ref',2],

  // --- groups_manager ---
  ['groups_manager','raft_group_registry','ref',2],
  ['groups_manager','messaging_service','ref',1],
  ['groups_manager','query_processor','ref',1],
  ['groups_manager','database','ref',1],
  ['groups_manager','shared_token_metadata','ref',1],
  ['groups_manager','feature_service','ref',1],

  // --- client_routes ---
  ['client_routes','query_processor','ref',1],
  ['client_routes','feature_service','ref',1],
];
