// Auto-generated from input/code.diff
// Loaded via <script> tag to avoid fetch() issues under file:// protocol.
var DIFF_RAW_TEXT = `diff --git a/configure.py b/configure.py
index 390b395ff6..dd71f4129b 100755
--- a/configure.py
+++ b/configure.py
@@ -1047,6 +1047,7 @@ scylla_core = (['message/messaging_service.cc',
                 'cql3/statements/broadcast_modification_statement.cc',
                 'cql3/statements/broadcast_select_statement.cc',
                 'cql3/statements/delete_statement.cc',
+                'cql3/statements/filtering_delete_statement.cc',
                 'cql3/statements/prune_materialized_view_statement.cc',
                 'cql3/statements/batch_statement.cc',
                 'cql3/statements/select_statement.cc',
@@ -1484,6 +1485,7 @@ idls = ['idl/gossip_digest.idl.hh',
         'idl/strong_consistency/state_machine.idl.hh',
         'idl/group0_state_machine.idl.hh',
         'idl/mapreduce_request.idl.hh',
+        'idl/filtering_delete_request.idl.hh',
         'idl/replica_exception.idl.hh',
         'idl/per_partition_rate_limit_info.idl.hh',
         'idl/position_in_partition.idl.hh',
diff --git a/cql3/Cql.g b/cql3/Cql.g
index d891204764..7692388d07 100644
--- a/cql3/Cql.g
+++ b/cql3/Cql.g
@@ -637,19 +637,22 @@ deleteStatement returns [std::unique_ptr<raw::delete_statement> expr]
         std::vector<std::unique_ptr<cql3::operation::raw_deletion>> column_deletions;
         bool if_exists = false;
         std::optional<expression> cond_opt;
+        bool allow_filtering = false;
     }
     : K_DELETE ( dels=deleteSelection { column_deletions = std::move(dels); } )?
       K_FROM cf=columnFamilyName
       ( usingTimestampTimeoutClause[attrs] )?
       K_WHERE wclause=whereClause
       ( K_IF ( K_EXISTS { if_exists = true; } | conditions=updateConditions { cond_opt = std::move(conditions); } ))?
+      ( K_ALLOW K_FILTERING { allow_filtering = true; } )?
       {
           return std::make_unique<raw::delete_statement>(cf,
                                             std::move(attrs),
                                             std::move(column_deletions),
                                             std::move(wclause),
                                             std::move(cond_opt),
-                                            if_exists);
+                                            if_exists,
+                                            allow_filtering);
       }
     ;
 
diff --git a/cql3/expr/expr-utils.hh b/cql3/expr/expr-utils.hh
index ab79093da3..ef454bf80c 100644
--- a/cql3/expr/expr-utils.hh
+++ b/cql3/expr/expr-utils.hh
@@ -290,4 +290,14 @@ struct aggregation_split_result {
 // are empty, and outer_loop should be evaluated for each loop.
 aggregation_split_result split_aggregation(std::span<const expression> aggregation);
 
+// Replaces all bind_variable nodes in the expression tree with constant nodes
+// whose values are taken from the given query_options. This is used to produce
+// an expression that can be serialized to CQL text (since bind variables lose
+// their index information during formatting and cannot survive a round-trip
+// through CQL text).
+//
+// The expression must be prepared (bind_variable receivers must be set).
+// Throws if a bind variable value is unset.
+expression inline_bind_variables(const expression& e, const query_options& options);
+
 }
\\ No newline at end of file
diff --git a/cql3/expr/expression.cc b/cql3/expr/expression.cc
index 39051be8dd..d301b92304 100644
--- a/cql3/expr/expression.cc
+++ b/cql3/expr/expression.cc
@@ -776,7 +776,7 @@ auto fmt::formatter<cql3::expr::expression::printer>::format(const cql3::expr::e
             },
             [&] (const untyped_constant& uc) {
                 if (uc.partial_type == untyped_constant::type_class::string) {
-                    out = fmt::format_to(out, "'{}'", uc.raw_text);
+                    out = fmt::format_to(out, "{}", cql3::util::single_quote(uc.raw_text));
                 } else {
                     out = fmt::format_to(out, "{}", uc.raw_text);
                 }
@@ -899,6 +899,23 @@ expression replace_partition_token(const expression& expr, const column_definiti
     });
 }
 
+expression inline_bind_variables(const expression& e, const query_options& options) {
+    return search_and_replace(e, [&] (const expression& node) -> std::optional<expression> {
+        if (auto bv = as_if<bind_variable>(&node)) {
+            if (!bv->receiver) {
+                on_internal_error(expr_logger,
+                    "inline_bind_variables() called on unprepared expression (bind_variable has no receiver)");
+            }
+            auto value = options.get_value_at(bv->bind_index);
+            if (value.is_null()) {
+                return constant::make_null(bv->receiver->type);
+            }
+            return constant(cql3::raw_value::make_value(value), bv->receiver->type);
+        }
+        return std::nullopt;
+    });
+}
+
 bool recurse_until(const expression& e, const noncopyable_function<bool (const expression&)>& predicate_fun) {
     if (auto res = predicate_fun(e)) {
         return res;
diff --git a/cql3/query_processor.cc b/cql3/query_processor.cc
index 9d64684772..616bf097cf 100644
--- a/cql3/query_processor.cc
+++ b/cql3/query_processor.cc
@@ -388,6 +388,11 @@ query_processor::query_processor(service::storage_proxy& proxy, data_dictionary:
                             _cql_stats.filtered_reads,
                             sm::description("Counts the total number of CQL read requests that required ALLOW FILTERING. See filtered_rows_read_total to compare how many rows needed to be filtered."))(basic_level).set_skip_when_empty(),
 
+                    sm::make_counter(
+                            "filtered_delete_requests",
+                            _cql_stats.filtered_deletes,
+                            sm::description("Counts the total number of CQL delete requests that required ALLOW FILTERING."))(basic_level).set_skip_when_empty(),
+
                     // rows read with filtering enabled (because ALLOW FILTERING was required)
                     sm::make_counter(
                             "filtered_rows_read_total",
@@ -1096,6 +1101,12 @@ query_processor::mapreduce(query::mapreduce_request req, tracing::trace_state_pt
     co_return co_await remote_.get().mapreducer.dispatch(std::move(req), std::move(tr_state));
 }
 
+future<query::filtering_delete_result>
+query_processor::filtering_delete(query::filtering_delete_request req, tracing::trace_state_ptr tr_state) {
+    auto [remote_, holder] = remote();
+    co_return co_await remote_.get().mapreducer.dispatch_delete(std::move(req), std::move(tr_state));
+}
+
 future<::shared_ptr<messages::result_message>>
 query_processor::execute_schema_statement(const statements::schema_altering_statement& stmt, service::query_state& state, const query_options& options, service::group0_batch& mc) {
     if (this_shard_id() != 0) {
diff --git a/cql3/query_processor.hh b/cql3/query_processor.hh
index 2bba232f44..10d86204e9 100644
--- a/cql3/query_processor.hh
+++ b/cql3/query_processor.hh
@@ -491,6 +491,10 @@ class query_processor : public seastar::peering_sharded_service<query_processor>
     future<query::mapreduce_result>
     mapreduce(query::mapreduce_request, tracing::trace_state_ptr);
 
+    // Splits given \`filtering_delete_request\` and distributes execution across a cluster.
+    future<query::filtering_delete_result>
+    filtering_delete(query::filtering_delete_request, tracing::trace_state_ptr);
+
     struct retry_statement_execution_error : public std::exception {};
 
     future<::shared_ptr<cql_transport::messages::result_message>>
diff --git a/cql3/restrictions/statement_restrictions.hh b/cql3/restrictions/statement_restrictions.hh
index af727f7fb0..c59685d76b 100644
--- a/cql3/restrictions/statement_restrictions.hh
+++ b/cql3/restrictions/statement_restrictions.hh
@@ -201,6 +201,12 @@ class statement_restrictions {
         return _clustering_columns_restrictions;
     }
 
+    /// Returns the full WHERE clause expression, if available.
+    /// This is the conjunction of all restrictions as received from the parser.
+    const std::optional<expr::expression>& where() const {
+        return _where;
+    }
+
     // Get a set of columns restricted by the IS NOT NULL restriction.
     // IS NOT NULL is a special case that is handled separately from other restrictions.
     const std::unordered_set<const column_definition*> get_not_null_columns() const;
diff --git a/cql3/statements/delete_statement.cc b/cql3/statements/delete_statement.cc
index 9ca4857177..feccf038af 100644
--- a/cql3/statements/delete_statement.cc
+++ b/cql3/statements/delete_statement.cc
@@ -12,6 +12,7 @@
 
 #include "data_dictionary/data_dictionary.hh"
 #include "delete_statement.hh"
+#include "filtering_delete_statement.hh"
 #include "raw/delete_statement.hh"
 #include "mutation/mutation.hh"
 #include "cql3/expr/expression.hh"
@@ -59,8 +60,29 @@ void delete_statement::add_update_for_key(mutation& m, const query::clustering_r
 namespace raw {
 
 ::shared_ptr<cql3::statements::modification_statement>
-delete_statement::prepare_internal(data_dictionary::database db, schema_ptr schema, prepare_context& ctx,
+delete_statement::prepare_statement(data_dictionary::database db, schema_ptr schema, prepare_context& ctx,
         std::unique_ptr<attributes> attrs, cql_stats& stats) const {
+    if (_allow_filtering) {
+        // DELETE ... ALLOW FILTERING: column-specific deletions are not supported.
+        // Only whole-row/partition deletion makes sense with filtering.
+        if (!_deletions.empty()) {
+            throw exceptions::invalid_request_exception(
+                "Column-specific deletions are not supported with ALLOW FILTERING. "
+                "Use DELETE FROM ... WHERE ... ALLOW FILTERING to delete entire rows.");
+        }
+
+        // Conditions (IF EXISTS, IF ...) are not supported with ALLOW FILTERING.
+        // Check early, before process_where_clause() which validates conditions
+        // against PK restrictions and would give a confusing error message.
+        if (_if_exists || _conditions.has_value()) {
+            throw exceptions::invalid_request_exception(
+                "Conditional DELETE (IF) is not supported with ALLOW FILTERING");
+        }
+        return ::make_shared<cql3::statements::filtering_delete_statement>(
+            audit_info(), statement_type::DELETE, ctx.bound_variables_size(),
+            schema, std::move(attrs), stats);
+    }
+
     auto stmt = ::make_shared<cql3::statements::delete_statement>(audit_info(), statement_type::DELETE, ctx.bound_variables_size(), schema, std::move(attrs), stats);
 
     for (auto&& deletion : _deletions) {
@@ -80,9 +102,16 @@ delete_statement::prepare_internal(data_dictionary::database db, schema_ptr sche
         op->fill_prepare_context(ctx);
         stmt->add_operation(op);
     }
+    return stmt;
+}
+
+::shared_ptr<cql3::statements::modification_statement>
+delete_statement::prepare_internal(data_dictionary::database db, schema_ptr schema, prepare_context& ctx,
+        std::unique_ptr<attributes> attrs, cql_stats& stats) const {
+    auto stmt = prepare_statement(db, schema, ctx, std::move(attrs), stats);
     prepare_conditions(db, *schema, ctx, *stmt);
-    stmt->process_where_clause(db, _where_clause, ctx);
-    if (has_slice(stmt->restrictions().get_clustering_columns_restrictions())) {
+    stmt->process_where_clause(db, _where_clause, ctx, _allow_filtering);
+    if (!_allow_filtering && has_slice(stmt->restrictions().get_clustering_columns_restrictions())) {
         if (!schema->is_compound()) {
             throw exceptions::invalid_request_exception("Range deletions on \\"compact storage\\" schemas are not supported");
         }
@@ -98,10 +127,12 @@ delete_statement::delete_statement(cf_name name,
                                  std::vector<std::unique_ptr<operation::raw_deletion>> deletions,
                                  expr::expression where_clause,
                                  std::optional<expr::expression> conditions,
-                                 bool if_exists)
+                                 bool if_exists,
+                                 bool allow_filtering)
     : raw::modification_statement(std::move(name), std::move(attrs), std::move(conditions), false, if_exists)
     , _deletions(std::move(deletions))
     , _where_clause(std::move(where_clause))
+    , _allow_filtering(allow_filtering)
 {
     SCYLLA_ASSERT(!_attrs->time_to_live.has_value());
 }
diff --git a/cql3/statements/filtering_delete_statement.cc b/cql3/statements/filtering_delete_statement.cc
new file mode 100644
index 0000000000..db6b8fe0ff
--- /dev/null
+++ b/cql3/statements/filtering_delete_statement.cc
@@ -0,0 +1,145 @@
+/*
+ * SPDX-License-Identifier: LicenseRef-ScyllaDB-Source-Available-1.0
+ */
+
+/* Copyright 2026-present ScyllaDB */
+
+#include "cql3/statements/filtering_delete_statement.hh"
+#include "cql3/expr/expr-utils.hh"
+#include "cql3/query_processor.hh"
+#include "cql3/util.hh"
+#include "db/consistency_level_validations.hh"
+#include "gms/feature_service.hh"
+#include "service/storage_proxy.hh"
+#include "transport/messages/result_message.hh"
+#include "tracing/tracing.hh"
+#include "validation.hh"
+
+namespace cql3 {
+
+namespace statements {
+
+filtering_delete_statement::filtering_delete_statement(
+    audit::audit_info_ptr&& audit_info,
+    statement_type type,
+    uint32_t bound_terms,
+    schema_ptr s,
+    std::unique_ptr<attributes> attrs,
+    cql_stats& stats)
+    : delete_statement(std::move(audit_info), type, bound_terms, std::move(s), std::move(attrs), stats)
+{
+}
+
+filtering_delete_statement::optimization_tier
+filtering_delete_statement::classify() const {
+    auto& r = restrictions();
+    if (r.has_non_primary_key_restriction()) {
+        bool all_static = std::ranges::all_of(
+                r.get_non_pk_restriction(),
+                [] (const auto& entry) { return entry.first->is_static(); });
+        if (all_static && !r.has_clustering_columns_restriction()) {
+            return optimization_tier::partition_only;
+        }
+        return optimization_tier::regular_column;
+    }
+    if (r.has_clustering_columns_restriction()) {
+        return optimization_tier::clustering;
+    }
+    return optimization_tier::partition_only;
+}
+
+future<::shared_ptr<cql_transport::messages::result_message>>
+filtering_delete_statement::execute_without_checking_exception_message(
+    query_processor& qp,
+    service::query_state& qs,
+    const query_options& options,
+    std::optional<service::group0_guard> guard) const
+{
+    // Feature flag check: all nodes must support filtering delete
+    if (!qp.proxy().features().filtering_delete) {
+        throw exceptions::invalid_request_exception(
+            "DELETE with ALLOW FILTERING is not yet supported by all nodes in the cluster. "
+            "Please ensure all nodes are upgraded before using this feature.");
+    }
+    return do_execute(qp, qs, options);
+}
+
+future<::shared_ptr<cql_transport::messages::result_message>>
+filtering_delete_statement::do_execute(
+    query_processor& qp,
+    service::query_state& qs,
+    const query_options& options) const
+{
+    cql3::util::validate_timestamp(qp.db().get_config(), options, attrs);
+    (void)validation::validate_column_family(qp.db(), keyspace(), column_family());
+
+    tracing::add_table_name(qs.get_trace_state(), keyspace(), column_family());
+
+    inc_cql_stats(qs.get_client_state().is_internal());
+    ++_stats.filtered_deletes;
+
+    auto cl = options.get_consistency();
+    if (db::is_serial_consistency(cl)) {
+        throw exceptions::invalid_request_exception(
+            "SERIAL/LOCAL_SERIAL consistency is not supported for DELETE with ALLOW FILTERING");
+    }
+
+    auto tier = classify();
+    auto timestamp = options.get_timestamp(qs);
+
+    // Map local optimization_tier to the RPC-transportable tier enum
+    query::filtering_delete_request::tier req_tier;
+    switch (tier) {
+    case optimization_tier::partition_only:
+        req_tier = query::filtering_delete_request::tier::partition_only;
+        break;
+    case optimization_tier::clustering:
+        req_tier = query::filtering_delete_request::tier::clustering;
+        break;
+    case optimization_tier::regular_column:
+        req_tier = query::filtering_delete_request::tier::regular_column;
+        break;
+    }
+
+    // Inline bind variables into the WHERE expression and serialize to CQL text.
+    // This makes the expression self-contained for transmission to remote nodes.
+    auto& where_expr = restrictions().where();
+    if (!where_expr) {
+        throw exceptions::invalid_request_exception(
+            "DELETE with ALLOW FILTERING requires a WHERE clause");
+    }
+    auto inlined = expr::inline_bind_variables(*where_expr, options);
+    auto where_clause = cql3::util::relations_to_where_clause(inlined);
+
+    // Compute partition key ranges from restrictions on the coordinator
+    auto key_ranges = restrictions().get_partition_key_ranges(options);
+
+    auto timeout_duration = get_timeout(qs.get_client_state(), options);
+    auto timeout = lowres_system_clock::now() + std::chrono::duration_cast<lowres_system_clock::duration>(timeout_duration);
+
+    query::filtering_delete_request req{
+        .schema_id = s->id(),
+        .schema_version = s->version(),
+        .where_clause = std::move(where_clause),
+        .pr = std::move(key_ranges),
+        .cl = cl,
+        .timeout = timeout,
+        .timestamp = timestamp,
+        .optimization_tier = req_tier,
+        .shard_id_hint = std::nullopt,
+    };
+
+    tracing::trace(qs.get_trace_state(), "Dispatching filtering delete ({}) to mapreduce service",
+                    tier == optimization_tier::partition_only ? "partition_only" :
+                    (tier == optimization_tier::clustering ? "clustering" : "regular_column"));
+
+    auto result = co_await qp.filtering_delete(std::move(req), qs.get_trace_state());
+
+    tracing::trace(qs.get_trace_state(), "Filtering delete completed: {} rows deleted", result.rows_deleted);
+
+    co_return ::make_shared<cql_transport::messages::result_message::void_message>();
+}
+
+} // namespace statements
+
+} // namespace cql3
diff --git a/cql3/statements/filtering_delete_statement.hh b/cql3/statements/filtering_delete_statement.hh
new file mode 100644
index 0000000000..f8be316de0
--- /dev/null
+++ b/cql3/statements/filtering_delete_statement.hh
@@ -0,0 +1,47 @@
+/*
+ * SPDX-License-Identifier: LicenseRef-ScyllaDB-Source-Available-1.0
+ */
+
+/* Copyright 2026-present ScyllaDB */
+
+#pragma once
+
+#include "cql3/statements/delete_statement.hh"
+
+namespace cql3 {
+
+namespace statements {
+
+// A DELETE statement with ALLOW FILTERING. This statement scans data across
+// the cluster in parallel (mapreduce-style) and applies tombstones for
+// matching rows/partitions. Unlike a normal DELETE, it does not require
+// the full partition key to be specified.
+class filtering_delete_statement : public delete_statement {
+public:
+    filtering_delete_statement(audit::audit_info_ptr&& audit_info, statement_type type, uint32_t bound_terms,
+                               schema_ptr s, std::unique_ptr<attributes> attrs, cql_stats& stats);
+
+    virtual future<::shared_ptr<cql_transport::messages::result_message>>
+    execute_without_checking_exception_message(query_processor& qp, service::query_state& qs,
+            const query_options& options, std::optional<service::group0_guard> guard) const override;
+
+private:
+    future<::shared_ptr<cql_transport::messages::result_message>>
+    do_execute(query_processor& qp, service::query_state& qs, const query_options& options) const;
+
+    // Determine optimization tier based on the restrictions
+    enum class optimization_tier {
+        // no CK/regular column restrictions - apply partition tombstones
+        partition_only,
+        // PK + CK predicates (no regular column restrictions) - apply range/row tombstones
+        clustering,
+        // read-before-delete, evaluate predicates, delete individually
+        regular_column
+    };
+
+    optimization_tier classify() const;
+};
+
+}
+
+}
diff --git a/cql3/statements/modification_statement.cc b/cql3/statements/modification_statement.cc
index 130bea6e77..4f53680d77 100644
--- a/cql3/statements/modification_statement.cc
+++ b/cql3/statements/modification_statement.cc
@@ -496,9 +496,9 @@ void modification_statement::build_cas_result_set_metadata() {
 }
 
 void
-modification_statement::process_where_clause(data_dictionary::database db, expr::expression where_clause, prepare_context& ctx) {
+modification_statement::process_where_clause(data_dictionary::database db, expr::expression where_clause, prepare_context& ctx, bool allow_filtering) {
     _restrictions = restrictions::analyze_statement_restrictions(db, s, type, where_clause, ctx,
-            applies_only_to_static_columns(), _selects_a_collection, false /* allow_filtering */, restrictions::check_indexes::no);
+            applies_only_to_static_columns(), _selects_a_collection, allow_filtering, restrictions::check_indexes::no);
     /*
      * If there's no clustering columns restriction, we may assume that EXISTS
      * check only selects static columns and hence we can use any row from the
@@ -513,10 +513,12 @@ modification_statement::process_where_clause(data_dictionary::database db, expr:
         }
     }
     if (_restrictions->has_token_restrictions()) {
-        throw exceptions::invalid_request_exception(format("The token function cannot be used in WHERE clauses for UPDATE and DELETE statements: {}",
-                to_string(_restrictions->get_partition_key_restrictions())));
+        if (!allow_filtering) {
+            throw exceptions::invalid_request_exception(format("The token function cannot be used in WHERE clauses for UPDATE and DELETE statements: {}",
+                    to_string(_restrictions->get_partition_key_restrictions())));
+        }
     }
-    if (!_restrictions->get_non_pk_restriction().empty()) {
+    if (!_restrictions->get_non_pk_restriction().empty() && !allow_filtering) {
         throw exceptions::invalid_request_exception(seastar::format("Invalid where clause contains non PRIMARY KEY columns: {}",
                                                                     fmt::join(_restrictions->get_non_pk_restriction()
                                          | std::views::keys
@@ -554,7 +556,7 @@ modification_statement::process_where_clause(data_dictionary::database db, expr:
             }
         }
     }
-    if (_restrictions->has_partition_key_unrestricted_components()) {
+    if (_restrictions->has_partition_key_unrestricted_components() && !allow_filtering) {
         throw exceptions::invalid_request_exception(format("Missing mandatory PRIMARY KEY part {}",
             _restrictions->unrestricted_column(column_kind::partition_key).name_as_text()));
     }
diff --git a/cql3/statements/modification_statement.hh b/cql3/statements/modification_statement.hh
index 6374e13803..30151b7a89 100644
--- a/cql3/statements/modification_statement.hh
+++ b/cql3/statements/modification_statement.hh
@@ -161,7 +161,7 @@ class modification_statement : public cql_statement_opt_metadata {
         return _is_raw_counter_shard_write.value_or(false);
     }
 
-    void process_where_clause(data_dictionary::database db, expr::expression where_clause, prepare_context& ctx);
+    void process_where_clause(data_dictionary::database db, expr::expression where_clause, prepare_context& ctx, bool allow_filtering = false);
 
     // CAS statement returns a result set. Prepare result set metadata
     // so that get_result_metadata() returns a meaningful value.
diff --git a/cql3/statements/raw/delete_statement.hh b/cql3/statements/raw/delete_statement.hh
index 5d17247f3f..cf43dd4d2a 100644
--- a/cql3/statements/raw/delete_statement.hh
+++ b/cql3/statements/raw/delete_statement.hh
@@ -29,16 +29,24 @@ class delete_statement : public modification_statement {
 private:
     std::vector<std::unique_ptr<operation::raw_deletion>> _deletions;
     expr::expression _where_clause;
+    bool _allow_filtering;
 public:
     delete_statement(cf_name name,
            std::unique_ptr<attributes::raw> attrs,
            std::vector<std::unique_ptr<operation::raw_deletion>> deletions,
            expr::expression where_clause,
            std::optional<expr::expression> conditions,
-           bool if_exists);
+           bool if_exists,
+           bool allow_filtering = false);
+
+    bool allow_filtering() const { return _allow_filtering; }
+    const expr::expression& where_clause() const { return _where_clause; }
 protected:
     virtual ::shared_ptr<cql3::statements::modification_statement> prepare_internal(data_dictionary::database db, schema_ptr schema,
         prepare_context& ctx, std::unique_ptr<attributes> attrs, cql_stats& stats) const override;
+private:
+    ::shared_ptr<cql3::statements::modification_statement> prepare_statement(data_dictionary::database db, schema_ptr schema,
+        prepare_context& ctx, std::unique_ptr<attributes> attrs, cql_stats& stats) const;
 };
 
 }
diff --git a/cql3/statements/raw/modification_statement.hh b/cql3/statements/raw/modification_statement.hh
index a8b6e701fa..ad2f87bf10 100644
--- a/cql3/statements/raw/modification_statement.hh
+++ b/cql3/statements/raw/modification_statement.hh
@@ -32,7 +32,6 @@ class modification_statement : public cf_statement {
 protected:
     const std::unique_ptr<attributes::raw> _attrs;
     const std::optional<expr::expression> _conditions;
-private:
     const bool _if_not_exists;
     const bool _if_exists;
 protected:
diff --git a/cql3/stats.hh b/cql3/stats.hh
index 21f9e00d4f..dc64c8f3c0 100644
--- a/cql3/stats.hh
+++ b/cql3/stats.hh
@@ -72,6 +72,7 @@ struct cql_stats {
     int64_t secondary_index_rows_read = 0;
 
     int64_t filtered_reads = 0;
+    int64_t filtered_deletes = 0;
     int64_t filtered_rows_matched_total = 0;
     int64_t filtered_rows_read_total = 0;
 
diff --git a/gms/feature_service.hh b/gms/feature_service.hh
index 25b532dedf..a979954388 100644
--- a/gms/feature_service.hh
+++ b/gms/feature_service.hh
@@ -186,6 +186,7 @@ class feature_service final : public peering_sharded_service<feature_service> {
     gms::feature topology_noop_request { *this, "TOPOLOGY_NOOP_REQUEST"sv };
     gms::feature tablets_intermediate_fallback_cleanup { *this, "TABLETS_INTERMEDIATE_FALLBACK_CLEANUP"sv };
     gms::feature batchlog_v2 { *this, "BATCHLOG_V2"sv };
+    gms::feature filtering_delete { *this, "FILTERING_DELETE"sv };
 public:
 
     const std::unordered_map<sstring, std::reference_wrapper<feature>>& registered_features() const;
diff --git a/idl/filtering_delete_request.idl.hh b/idl/filtering_delete_request.idl.hh
new file mode 100644
index 0000000000..968871077a
--- /dev/null
+++ b/idl/filtering_delete_request.idl.hh
@@ -0,0 +1,39 @@
+/*
+ * Copyright 2026-present ScyllaDB
+ */
+
+/*
+ * SPDX-License-Identifier: LicenseRef-ScyllaDB-Source-Available-1.0
+ */
+
+#include "dht/i_partitioner_fwd.hh"
+
+#include "idl/uuid.idl.hh"
+#include "idl/consistency_level.idl.hh"
+
+namespace query {
+struct filtering_delete_request {
+    enum class tier : uint8_t {
+        partition_only,
+        clustering,
+        regular_column
+    };
+
+    table_id schema_id;
+    table_schema_version schema_version;
+    sstring where_clause;
+    dht::partition_range_vector pr;
+
+    db::consistency_level cl;
+    lowres_system_clock::time_point timeout;
+    api::timestamp_type timestamp;
+    query::filtering_delete_request::tier optimization_tier;
+    std::optional<shard_id> shard_id_hint;
+};
+
+struct filtering_delete_result {
+    uint64_t rows_deleted;
+};
+
+verb [[cancellable]] filtering_delete_request(query::filtering_delete_request req [[ref]], std::optional<tracing::trace_info> trace_info [[ref]]) -> query::filtering_delete_result;
+}
diff --git a/message/messaging_service.cc b/message/messaging_service.cc
index 5f78d91e8a..2d443d17a3 100644
--- a/message/messaging_service.cc
+++ b/message/messaging_service.cc
@@ -131,6 +131,8 @@
 #include "idl/node_ops.dist.impl.hh"
 #include "idl/mapreduce_request.dist.hh"
 #include "idl/mapreduce_request.dist.impl.hh"
+#include "idl/filtering_delete_request.dist.hh"
+#include "idl/filtering_delete_request.dist.impl.hh"
 #include "idl/storage_service.dist.impl.hh"
 #include "idl/join_node.dist.impl.hh"
 #include "idl/tasks.dist.impl.hh"
@@ -754,6 +756,7 @@ static constexpr unsigned do_get_rpc_client_idx(messaging_verb verb) {
     case messaging_verb::MUTATION_FAILED:
         return 3;
     case messaging_verb::MAPREDUCE_REQUEST:
+    case messaging_verb::FILTERING_DELETE_REQUEST:
         return 4;
     case messaging_verb::LAST:
         return -1; // should never happen
diff --git a/message/messaging_service.hh b/message/messaging_service.hh
index 5a17f0e319..0511e632bb 100644
--- a/message/messaging_service.hh
+++ b/message/messaging_service.hh
@@ -211,7 +211,8 @@ enum class messaging_verb : int32_t {
     WORK_ON_VIEW_BUILDING_TASKS = 82,
     NOTIFY_BANNED = 83,
     SNAPSHOT_WITH_TABLETS = 84,
-    LAST = 85,
+    FILTERING_DELETE_REQUEST = 85,
+    LAST = 86,
 };
 
 } // namespace netw
diff --git a/query/query-request.hh b/query/query-request.hh
index 13a659dd3e..f06c25345a 100644
--- a/query/query-request.hh
+++ b/query/query-request.hh
@@ -539,6 +539,36 @@ struct mapreduce_result {
 };
 
 std::ostream& operator<<(std::ostream& out, const query::mapreduce_result::printer&);
+
+// Request to perform a filtering delete (DELETE ... ALLOW FILTERING).
+// This is dispatched to shards in parallel, where each shard scans its local
+// data and applies tombstones for matching rows/partitions.
+struct filtering_delete_request {
+    // Optimization tier determines the tombstone strategy:
+    //   partition_only: partition-only predicates -> partition tombstones
+    //   clustering: PK + CK predicates -> range/row tombstones
+    //   regular_column: regular column predicates -> read-before-delete, per-row tombstones
+    enum class tier : uint8_t { partition_only, clustering, regular_column };
+
+    table_id schema_id;                // Table identity
+    table_schema_version schema_version; // Schema version for validation
+    sstring where_clause;              // CQL WHERE clause with bind variables inlined
+    dht::partition_range_vector pr;    // Partition ranges to scan
+    db::consistency_level cl;          // Consistency level for writes
+    lowres_system_clock::time_point timeout;
+    api::timestamp_type timestamp;     // Timestamp for tombstones
+    tier optimization_tier;
+    std::optional<shard_id> shard_id_hint;
+};
+
+std::ostream& operator<<(std::ostream& out, const filtering_delete_request& r);
+std::ostream& operator<<(std::ostream& out, const filtering_delete_request::tier& t);
+
+struct filtering_delete_result {
+    uint64_t rows_deleted = 0;
+};
+
+std::ostream& operator<<(std::ostream& out, const filtering_delete_result& r);
 }
 
 
@@ -549,3 +579,6 @@ template <> struct fmt::formatter<query::mapreduce_request> : fmt::ostream_forma
 template <> struct fmt::formatter<query::mapreduce_request::reduction_type> : fmt::ostream_formatter {};
 template <> struct fmt::formatter<query::mapreduce_request::aggregation_info> : fmt::ostream_formatter {};
 template <> struct fmt::formatter<query::mapreduce_result::printer> : fmt::ostream_formatter {};
+template <> struct fmt::formatter<query::filtering_delete_request> : fmt::ostream_formatter {};
+template <> struct fmt::formatter<query::filtering_delete_request::tier> : fmt::ostream_formatter {};
+template <> struct fmt::formatter<query::filtering_delete_result> : fmt::ostream_formatter {};
diff --git a/query/query.cc b/query/query.cc
index eb8d698f49..2fdd42af4f 100644
--- a/query/query.cc
+++ b/query/query.cc
@@ -412,6 +412,31 @@ std::ostream& operator<<(std::ostream& out, const query::mapreduce_result::print
     return out << "]";
 }
 
+std::ostream& operator<<(std::ostream& out, const query::filtering_delete_request::tier& t) {
+    switch (t) {
+    case query::filtering_delete_request::tier::partition_only: return out << "partition_only";
+    case query::filtering_delete_request::tier::clustering: return out << "clustering";
+    case query::filtering_delete_request::tier::regular_column: return out << "regular_column";
+    }
+    return out << "unknown";
+}
+
+std::ostream& operator<<(std::ostream& out, const query::filtering_delete_request& r) {
+    return out << "filtering_delete_request{"
+        << "schema_id=" << r.schema_id
+        << ", schema_version=" << r.schema_version
+        << ", where_clause=" << r.where_clause
+        << ", pr_size=" << r.pr.size()
+        << ", cl=" << fmt::format("{}", r.cl)
+        << ", tier=" << r.optimization_tier
+        << ", timestamp=" << r.timestamp
+        << "}";
+}
+
+std::ostream& operator<<(std::ostream& out, const query::filtering_delete_result& r) {
+    return out << "filtering_delete_result{rows_deleted=" << r.rows_deleted << "}";
+}
+
 }
 
 std::optional<query::clustering_range> position_range_to_clustering_range(const position_range& r, const schema& s) {
diff --git a/service/mapreduce_service.cc b/service/mapreduce_service.cc
index 816ea37a9a..4035223101 100644
--- a/service/mapreduce_service.cc
+++ b/service/mapreduce_service.cc
@@ -20,6 +20,7 @@
 #include "exceptions/exceptions.hh"
 #include "gms/gossiper.hh"
 #include "idl/mapreduce_request.dist.hh"
+#include "idl/filtering_delete_request.dist.hh"
 #include "locator/abstract_replication_strategy.hh"
 #include "utils/error_injection.hh"
 #include "utils/log.hh"
@@ -29,6 +30,9 @@
 #include "replica/database.hh"
 #include "schema/schema.hh"
 #include "schema/schema_registry.hh"
+#include "mutation/mutation.hh"
+#include "mutation/range_tombstone.hh"
+#include "keys/clustering_bounds_comparator.hh"
 #include <seastar/core/future.hh>
 #include <seastar/core/on_internal_error.hh>
 #include <seastar/core/when_all.hh>
@@ -47,6 +51,9 @@
 #include "cql3/functions/functions.hh"
 #include "cql3/functions/aggregate_fcts.hh"
 #include "cql3/expr/expr-utils.hh"
+#include "cql3/restrictions/statement_restrictions.hh"
+#include "cql3/statements/select_statement.hh"
+#include "cql3/util.hh"
 
 namespace service {
 
@@ -550,10 +557,17 @@ void mapreduce_service::init_messaging_service() {
             return dispatch_to_shards(req, tr_info);
         }
     );
+    ser::filtering_delete_request_rpc_verbs::register_filtering_delete_request(
+        &_messaging,
+        [this](query::filtering_delete_request req, std::optional<tracing::trace_info> tr_info) -> future<query::filtering_delete_result> {
+            return dispatch_delete_to_shards(req, tr_info);
+        }
+    );
 }
 
 future<> mapreduce_service::uninit_messaging_service() {
-    return ser::mapreduce_request_rpc_verbs::unregister(&_messaging);
+    co_await ser::mapreduce_request_rpc_verbs::unregister(&_messaging);
+    co_await ser::filtering_delete_request_rpc_verbs::unregister(&_messaging);
 }
 
 future<> mapreduce_service::dispatch_range_and_reduce(const locator::effective_replication_map_ptr& erm, retrying_dispatcher& dispatcher, const query::mapreduce_request& req, query::mapreduce_request&& req_with_modified_pr, locator::host_id addr, query::mapreduce_result& shared_accumulator, tracing::trace_state_ptr tr_state) {
@@ -816,6 +830,542 @@ future<query::mapreduce_result> mapreduce_service::dispatch(query::mapreduce_req
     }
 }
 
+// ============================================================================
+// Filtering delete dispatch implementation
+// ============================================================================
+
+// retrying_dispatcher for filtering delete - reuses the same class but with
+// filtering_delete_request/result types. We use a templated helper.
+class filtering_delete_retrying_dispatcher {
+    mapreduce_service& _mapreducer;
+    tracing::trace_state_ptr _tr_state;
+    std::optional<tracing::trace_info> _tr_info;
+
+    future<query::filtering_delete_result> dispatch_to_shards_locally(query::filtering_delete_request req, std::optional<tracing::trace_info> tr_info) {
+        try {
+            co_return co_await _mapreducer.dispatch_delete_to_shards(req, _tr_info);
+        } catch (const std::exception& e) {
+            std::throw_with_nested(std::runtime_error(e.what()));
+        }
+    }
+public:
+    filtering_delete_retrying_dispatcher(mapreduce_service& mapreducer, tracing::trace_state_ptr tr_state)
+        : _mapreducer(mapreducer)
+        , _tr_state(tr_state)
+        , _tr_info(tracing::make_trace_info(tr_state))
+    {}
+
+    future<query::filtering_delete_result> dispatch_to_node(const locator::effective_replication_map& erm, locator::host_id id, query::filtering_delete_request req) {
+        if (_mapreducer._proxy.is_me(erm, id)) {
+            co_return co_await dispatch_to_shards_locally(req, _tr_info);
+        }
+
+        _mapreducer._stats.requests_dispatched_to_other_nodes += 1;
+
+        if (_mapreducer._shutdown) {
+            throw std::runtime_error("mapreduce_service is shutting down");
+        }
+
+        try {
+            co_return co_await ser::filtering_delete_request_rpc_verbs::send_filtering_delete_request(
+                &_mapreducer._messaging, id, _mapreducer._abort_outgoing_tasks, req, _tr_info
+            );
+        } catch (rpc::closed_error& e) {
+            if (_mapreducer._shutdown) {
+                throw;
+            }
+            flogger.warn("retrying filtering_delete_request on a super-coordinator after failing to send it to {} ({})", id, e.what());
+            tracing::trace(_tr_state, "retrying filtering_delete_request on a super-coordinator after failing to send it to {} ({})", id, e.what());
+        }
+        co_return co_await dispatch_to_shards_locally(req, _tr_info);
+    }
+};
+
+static constexpr int DEFAULT_DELETE_PAGING_SIZE = 1000;
+
+future<query::filtering_delete_result> mapreduce_service::dispatch_delete_to_shards(
+    query::filtering_delete_request req,
+    std::optional<tracing::trace_info> tr_info
+) {
+    _stats.requests_dispatched_to_own_shards += 1;
+    std::vector<future<query::filtering_delete_result>> futures;
+
+    for (const auto& s : smp::all_cpus()) {
+        futures.push_back(container().invoke_on(s, [req, tr_info] (auto& fs) {
+            return fs.execute_delete_on_this_shard(req, tr_info);
+        }));
+    }
+    auto results = co_await when_all_succeed(futures.begin(), futures.end());
+
+    query::filtering_delete_result combined;
+    for (auto&& r : results) {
+        combined.rows_deleted += r.rows_deleted;
+    }
+    co_return combined;
+}
+
+future<query::filtering_delete_result> mapreduce_service::execute_delete_on_this_shard(
+    query::filtering_delete_request req,
+    std::optional<tracing::trace_info> tr_info
+) {
+    tracing::trace_state_ptr tr_state;
+    if (tr_info) {
+        tr_state = tracing::tracing::get_local_tracing_instance().create_session(*tr_info);
+        tracing::begin(tr_state);
+    }
+
+    tracing::trace(tr_state, "Executing filtering_delete_request");
+    _stats.requests_executed += 1;
+
+    schema_ptr schema = local_schema_registry().get(req.schema_version);
+    auto db = _db.local().as_data_dictionary();
+
+    lowres_system_clock::duration time_left = req.timeout - lowres_system_clock::now();
+    lowres_clock::time_point timeout_point = lowres_clock::now() + time_left;
+
+    auto now = gc_clock::now();
+    auto ts = req.timestamp;
+    auto cl = req.cl;
+
+    // Re-parse the WHERE clause and prepare a select statement (MV pattern).
+    // This gives us: restrictions (for filtering), selection (all columns),
+    // and a partition_slice (with clustering bounds from the WHERE clause).
+    auto raw = cql3::util::build_select_statement(
+        schema->cf_name(), req.where_clause, true /* select_all_columns */, schema->all_columns());
+    raw->prepare_keyspace(schema->ks_name());
+    raw->set_bound_variables({});
+    cql3::cql_stats ignored_stats;
+    auto prepared = raw->prepare(db, ignored_stats, true /* for_view */);
+    auto select_stmt = static_pointer_cast<cql3::statements::select_statement>(prepared->statement);
+
+    // Build selection, partition_slice, and read_command from the re-prepared statement.
+    auto empty_options = cql3::query_options({});
+    auto slice = select_stmt->make_partition_slice(empty_options);
+    // Ensure the pager sends partition and clustering keys so we can reconstruct them
+    slice.options.set<query::partition_slice::option::send_partition_key>();
+    slice.options.set<query::partition_slice::option::send_clustering_key>();
+    slice.options.set<query::partition_slice::option::allow_short_read>();
+
+    auto max_result_size = _proxy.get_max_result_size(slice);
+
+    auto command = make_lw_shared<query::read_command>(
+        schema->id(),
+        schema->version(),
+        std::move(slice),
+        max_result_size,
+        query::tombstone_limit(_proxy.get_tombstone_limit()),
+        query::row_limit::max,
+        query::partition_limit::max,
+        now,
+        tracing::make_trace_info(tr_state),
+        query_id::create_null_id(),
+        query::is_first_page::no,
+        ts);
+
+    // Build a selection that includes all columns (for predicate evaluation and key extraction)
+    auto all_columns = std::ranges::to<std::vector<const column_definition*>>(
+        schema->all_columns()
+        | std::views::transform([] (const column_definition& cdef) { return &cdef; }));
+    auto selection = cql3::selection::selection::for_columns(schema, std::move(all_columns));
+
+    // Get filtering restrictions from the re-prepared select statement
+    auto filtering_restrictions = select_stmt->get_restrictions();
+
+    auto query_state = make_lw_shared<service::query_state>(
+        client_state::for_internal_calls(),
+        tr_state,
+        empty_service_permit()
+    );
+    auto query_opts = make_lw_shared<cql3::query_options>(
+        cql3::default_cql_config,
+        cl,
+        std::optional<std::vector<std::string_view>>(),
+        std::vector<cql3::raw_value>(),
+        true, // skip metadata
+        cql3::query_options::specific_options::DEFAULT
+    );
+
+    // For clustering tier with prefix restrictions, prepare clustering bounds for range tombstones
+    bool use_range_tombstones = (req.optimization_tier == query::filtering_delete_request::tier::clustering
+                                 && !filtering_restrictions->clustering_key_restrictions_need_filtering());
+    auto ck_bounds_for_tombstones = use_range_tombstones
+        ? filtering_restrictions->get_clustering_bounds(empty_options)
+        : std::vector<query::clustering_range>();
+
+    // Iterate through partition ranges owned by this shard
+    static constexpr size_t max_ranges = 256;
+    dht::partition_range_vector ranges_owned_by_this_shard;
+    ranges_owned_by_this_shard.reserve(std::min(max_ranges, req.pr.size()));
+    partition_ranges_owned_by_this_shard owned_iter(schema, std::move(req.pr), req.shard_id_hint);
+
+    uint64_t total_deleted = 0;
+    std::optional<dht::partition_range> current_range;
+
+    // For partition_only and clustering-prefix, collect unique partition keys and apply
+    // bulk tombstones after the scan.
+    bool collect_partitions = (req.optimization_tier == query::filtering_delete_request::tier::partition_only
+                               || use_range_tombstones);
+    std::set<dht::decorated_key, dht::decorated_key::less_comparator> bulk_partitions{
+        dht::decorated_key::less_comparator(schema)};
+
+    do {
+        while ((current_range = owned_iter.next(*schema))) {
+            ranges_owned_by_this_shard.push_back(std::move(*current_range));
+            if (ranges_owned_by_this_shard.size() >= max_ranges) {
+                break;
+            }
+        }
+        if (ranges_owned_by_this_shard.empty()) {
+            break;
+        }
+
+        flogger.trace("Filtering delete: processing {} ranges on this shard", ranges_owned_by_this_shard.size());
+
+        auto pager = service::pager::query_pagers::pager(
+            _proxy,
+            schema,
+            selection,
+            *query_state,
+            *query_opts,
+            command,
+            std::move(ranges_owned_by_this_shard),
+            filtering_restrictions
+        );
+
+        while (!pager->is_exhausted()) {
+            if (_shutdown) {
+                throw std::runtime_error("mapreduce_service is shutting down");
+            }
+
+            auto rs_builder = cql3::selection::result_set_builder(
+                *selection,
+                now,
+                nullptr,
+                std::vector<size_t>()
+            );
+            co_await pager->fetch_page(rs_builder, DEFAULT_DELETE_PAGING_SIZE, now, timeout_point);
+
+            auto rs = rs_builder.build();
+            auto& rows = rs->rows();
+
+            if (rows.empty()) {
+                continue;
+            }
+
+            // Build tombstone mutations from the scanned rows
+            utils::chunked_vector<mutation> mutations;
+            auto tombstone_ts = tombstone(ts, now);
+
+            for (auto& row : rows) {
+                // Extract partition key from the result row
+                std::vector<bytes> pk_values;
+                pk_values.reserve(schema->partition_key_size());
+                for (size_t i = 0; i < schema->partition_key_size(); ++i) {
+                    auto& val = row[i];
+                    if (!val) {
+                        // Should not happen for PK columns, but be safe
+                        break;
+                    }
+                    pk_values.push_back(to_bytes(*val));
+                }
+                if (pk_values.size() != schema->partition_key_size()) {
+                    continue;
+                }
+                auto pk = partition_key::from_exploded(pk_values);
+                auto dk = dht::decorate_key(*schema, pk);
+
+                if (collect_partitions) {
+                    // Collect unique partition keys; apply bulk tombstones after the scan
+                    bulk_partitions.insert(std::move(dk));
+                } else {
+                    // clustering-nonprefix / regular_column: per-row tombstones
+                    std::vector<bytes> ck_values;
+                    ck_values.reserve(schema->clustering_key_size());
+                    for (size_t i = schema->partition_key_size();
+                         i < schema->partition_key_size() + schema->clustering_key_size(); ++i) {
+                        auto& val = row[i];
+                        if (!val) {
+                            break;
+                        }
+                        ck_values.push_back(to_bytes(*val));
+                    }
+
+                    mutation m(schema, dk);
+                    if (ck_values.empty() || schema->clustering_key_size() == 0) {
+                        m.partition().apply(tombstone_ts);
+                    } else {
+                        auto ck = clustering_key::from_exploded(ck_values);
+                        m.partition().apply_delete(*schema, ck, tombstone_ts);
+                    }
+                    mutations.push_back(std::move(m));
+                    total_deleted++;
+                }
+            }
+
+            if (!mutations.empty()) {
+                auto write_timeout = db::timeout_clock::now() + std::chrono::duration_cast<db::timeout_clock::duration>(time_left);
+                co_await _proxy.mutate(std::move(mutations), cl, write_timeout, tr_state, empty_service_permit(), db::allow_per_partition_rate_limit::no);
+            }
+        }
+
+        ranges_owned_by_this_shard.clear();
+    } while (current_range);
+
+    // For partition_only/clustering-prefix, apply bulk tombstones for all collected partition keys
+    if (collect_partitions && !bulk_partitions.empty()) {
+        utils::chunked_vector<mutation> mutations;
+        auto tombstone_ts = tombstone(ts, now);
+        for (auto& dk : bulk_partitions) {
+            mutation m(schema, dk);
+            if (req.optimization_tier == query::filtering_delete_request::tier::partition_only) {
+                // Partition tombstone — deletes entire partition
+                m.partition().apply(tombstone_ts);
+            } else {
+                // Clustering-prefix: range tombstone(s) — deletes matching CK ranges
+                for (auto& range : ck_bounds_for_tombstones) {
+                    if (range.is_full()) {
+                        m.partition().apply(tombstone_ts);
+                    } else if (range.is_singular()) {
+                        m.partition().apply_delete(*schema, range.start()->value(), tombstone_ts);
+                    } else {
+                        auto bvs = bound_view::from_range(range);
+                        m.partition().apply_delete(*schema, range_tombstone(bvs.first, bvs.second, tombstone_ts));
+                    }
+                }
+            }
+            mutations.push_back(std::move(m));
+            total_deleted++;
+        }
+        auto write_timeout = db::timeout_clock::now() + std::chrono::duration_cast<db::timeout_clock::duration>(time_left);
+        co_await _proxy.mutate(std::move(mutations), cl, write_timeout, tr_state, empty_service_permit(), db::allow_per_partition_rate_limit::no);
+    }
+
+    flogger.debug("Filtering delete: deleted {} rows on this shard", total_deleted);
+    tracing::trace(tr_state, "Filtering delete: deleted {} rows on this shard", total_deleted);
+
+    co_return query::filtering_delete_result{total_deleted};
+}
+
+future<> mapreduce_service::dispatch_delete_range_and_reduce(
+    const locator::effective_replication_map_ptr& erm,
+    const query::filtering_delete_request& req,
+    query::filtering_delete_request&& req_with_modified_pr,
+    locator::host_id addr,
+    query::filtering_delete_result& shared_result,
+    tracing::trace_state_ptr tr_state
+) {
+    tracing::trace(tr_state, "Sending filtering_delete_request to {}", addr);
+    flogger.debug("dispatching filtering_delete_request={} to address={}", req_with_modified_pr, addr);
+
+    // Use filtering_delete_retrying_dispatcher for the actual dispatch
+    filtering_delete_retrying_dispatcher fd_dispatcher(const_cast<mapreduce_service&>(*this), tr_state);
+    query::filtering_delete_result partial_result = co_await fd_dispatcher.dispatch_to_node(*erm, addr, std::move(req_with_modified_pr));
+
+    tracing::trace(tr_state, "Received filtering_delete_result rows_deleted={} from {}", partial_result.rows_deleted, addr);
+    flogger.debug("received filtering_delete_result rows_deleted={} from {}", partial_result.rows_deleted, addr);
+
+    shared_result.rows_deleted += partial_result.rows_deleted;
+}
+
+future<> mapreduce_service::dispatch_delete_to_vnodes(
+    schema_ptr schema,
+    replica::column_family& cf,
+    query::filtering_delete_request& req,
+    query::filtering_delete_result& result,
+    tracing::trace_state_ptr tr_state
+) {
+    auto erm = cf.get_effective_replication_map();
+    std::map<locator::host_id, dht::partition_range_vector> vnodes_per_addr;
+    const auto& topo = erm->get_topology();
+    auto generator = query_ranges_to_vnodes_generator(erm->make_splitter(), schema, req.pr);
+    while (std::optional<dht::partition_range> vnode = get_next_partition_range(generator)) {
+        host_id_vector_replica_set live_endpoints = _proxy.get_live_endpoints(*erm, end_token(*vnode));
+        if (db::is_datacenter_local(req.cl)) {
+            retain_local_endpoints(topo, live_endpoints);
+        }
+        if (live_endpoints.empty()) {
+            throw std::runtime_error("No live endpoint available");
+        }
+        vnodes_per_addr[*live_endpoints.begin()].push_back(std::move(*vnode));
+        co_await coroutine::maybe_yield();
+    }
+
+    tracing::trace(tr_state, "Dispatching filtering_delete_request to {} endpoints", vnodes_per_addr.size());
+    flogger.debug("dispatching filtering_delete_request to {} endpoints", vnodes_per_addr.size());
+
+    co_await coroutine::parallel_for_each(vnodes_per_addr,
+            [&] (std::pair<const locator::host_id, dht::partition_range_vector>& vnodes_with_addr) -> future<> {
+        locator::host_id addr = vnodes_with_addr.first;
+        query::filtering_delete_request req_with_modified_pr = req;
+        req_with_modified_pr.pr = std::move(vnodes_with_addr.second);
+        co_await dispatch_delete_range_and_reduce(erm, req, std::move(req_with_modified_pr), addr, result, tr_state);
+    });
+}
+
+class filtering_delete_tablet_algorithm {
+public:
+    filtering_delete_tablet_algorithm(mapreduce_service& mapreducer, schema_ptr schema, replica::column_family& cf,
+        query::filtering_delete_request& req, query::filtering_delete_result& result, tracing::trace_state_ptr tr_state)
+        : _mapreducer(mapreducer)
+        , _schema(schema)
+        , _cf(cf)
+        , _req(req)
+        , _result(result)
+        , _tr_state(tr_state)
+        , _dispatcher(_mapreducer, tr_state)
+        , _limit_per_replica(2)
+    {}
+
+    future<> initialize_ranges_left() {
+        auto erm = _cf.get_effective_replication_map();
+        auto generator = query_ranges_to_vnodes_generator(erm->make_splitter(), _schema, _req.pr);
+        while (std::optional<dht::partition_range> range = get_next_partition_range(generator)) {
+            _ranges_left.insert(std::move(*range));
+            co_await coroutine::maybe_yield();
+        }
+        tracing::trace(_tr_state, "Dispatching {} delete ranges", _ranges_left.size());
+        flogger.debug("Dispatching {} delete ranges", _ranges_left.size());
+    }
+
+    future<> prepare_ranges_per_replica() {
+        auto erm = _cf.get_effective_replication_map();
+        const auto& topo = erm->get_topology();
+        auto& tablets = erm->get_token_metadata_ptr()->tablets().get_tablet_map(_schema->id());
+
+        std::map<locator::tablet_replica, dht::partition_range_vector> ranges_per_tablet_replica_map;
+        for (auto& range : _ranges_left) {
+            auto tablet_id = tablets.get_tablet_id(end_token(range));
+            const auto& tablet_info = tablets.get_tablet_info(tablet_id);
+
+            size_t skipped_replicas = 0;
+            for (auto& replica : tablet_info.replicas) {
+                bool is_alive = _mapreducer._proxy.is_alive(*erm, replica.host);
+                bool has_correct_locality = !db::is_datacenter_local(_req.cl) || topo.get_datacenter(replica.host) == topo.get_datacenter();
+                if (is_alive && has_correct_locality) {
+                    ranges_per_tablet_replica_map[replica].push_back(range);
+                } else {
+                    ++skipped_replicas;
+                    if (skipped_replicas == tablet_info.replicas.size()) {
+                        throw std::runtime_error("No live endpoint available");
+                    }
+                }
+            }
+            co_await coroutine::maybe_yield();
+        }
+        _ranges_per_replica = ranges_per_tablet_replica_t(erm->get_token_metadata_ptr()->get_version(), std::move(ranges_per_tablet_replica_map));
+    }
+
+    std::vector<locator::tablet_replica> get_processing_slots() const {
+        std::vector<locator::tablet_replica> slots;
+        for (const auto& [replica, _] : _ranges_per_replica.get_map()) {
+            for (size_t i = 0; i < _limit_per_replica; ++i) {
+                slots.push_back(replica);
+            }
+        }
+        return slots;
+    }
+
+    future<> dispatch_work_and_wait_to_finish() {
+        while (_ranges_left.size() > 0) {
+            co_await prepare_ranges_per_replica();
+
+            co_await coroutine::parallel_for_each(get_processing_slots(),
+                    [&] (locator::tablet_replica replica) -> future<> {
+                auto& ranges = _ranges_per_replica.get_map().find(replica)->second;
+                for (const auto& range : ranges) {
+                    auto erm = _cf.get_effective_replication_map();
+                    if (!_ranges_per_replica.is_up_to_date(erm->get_token_metadata_ptr())) {
+                        co_return;
+                    }
+
+                    auto it = _ranges_left.find(range);
+                    if (it != _ranges_left.end()) {
+                        _ranges_left.erase(it);
+                        query::filtering_delete_request req_with_modified_pr = _req;
+                        req_with_modified_pr.pr = dht::partition_range_vector{range};
+                        req_with_modified_pr.shard_id_hint = replica.shard;
+
+                        filtering_delete_retrying_dispatcher fd_dispatcher(_mapreducer, _tr_state);
+                        auto partial_result = co_await fd_dispatcher.dispatch_to_node(*erm, replica.host, std::move(req_with_modified_pr));
+                        _result.rows_deleted += partial_result.rows_deleted;
+                    }
+                    co_await coroutine::maybe_yield();
+                }
+            });
+        }
+    }
+
+private:
+    class ranges_per_tablet_replica_t {
+    public:
+        ranges_per_tablet_replica_t() = default;
+        ranges_per_tablet_replica_t(topology::version_t topology_version, std::map<locator::tablet_replica, dht::partition_range_vector>&& map)
+            : _topology_version(topology_version)
+            , _map(std::move(map))
+        {}
+        ranges_per_tablet_replica_t& operator=(ranges_per_tablet_replica_t&& other) noexcept = default;
+        bool is_up_to_date(locator::token_metadata_ptr token_metadata_ptr) const {
+            return _topology_version == token_metadata_ptr->get_version();
+        }
+        const std::map<locator::tablet_replica, dht::partition_range_vector>& get_map() const {
+            return _map;
+        }
+    private:
+        topology::version_t _topology_version;
+        std::map<locator::tablet_replica, dht::partition_range_vector> _map;
+    };
+
+    mapreduce_service& _mapreducer;
+    schema_ptr _schema;
+    replica::column_family& _cf;
+    query::filtering_delete_request& _req;
+    query::filtering_delete_result& _result;
+    tracing::trace_state_ptr _tr_state;
+    filtering_delete_retrying_dispatcher _dispatcher;
+    size_t _limit_per_replica;
+
+    struct partition_range_cmp {
+        bool operator() (const dht::partition_range& a, const dht::partition_range& b) const {
+            return end_token(a) < end_token(b);
+        };
+    };
+
+    std::set<dht::partition_range, partition_range_cmp> _ranges_left;
+    ranges_per_tablet_replica_t _ranges_per_replica;
+};
+
+future<> mapreduce_service::dispatch_delete_to_tablets(
+    schema_ptr schema,
+    replica::column_family& cf,
+    query::filtering_delete_request& req,
+    query::filtering_delete_result& result,
+    tracing::trace_state_ptr tr_state
+) {
+    filtering_delete_tablet_algorithm algorithm(*this, schema, cf, req, result, tr_state);
+    co_await algorithm.initialize_ranges_left();
+    co_await algorithm.dispatch_work_and_wait_to_finish();
+}
+
+future<query::filtering_delete_result> mapreduce_service::dispatch_delete(
+    query::filtering_delete_request req,
+    tracing::trace_state_ptr tr_state
+) {
+    schema_ptr schema = local_schema_registry().get(req.schema_version);
+    replica::table& cf = _db.local().find_column_family(schema);
+
+    query::filtering_delete_result result;
+    if (cf.uses_tablets()) {
+        co_await dispatch_delete_to_tablets(schema, cf, req, result, tr_state);
+    } else {
+        co_await dispatch_delete_to_vnodes(schema, cf, req, result, tr_state);
+    }
+
+    flogger.debug("filtering delete completed: {} rows deleted", result.rows_deleted);
+    tracing::trace(tr_state, "filtering delete completed: {} rows deleted", result.rows_deleted);
+
+    co_return result;
+}
+
 void mapreduce_service::register_metrics() {
     namespace sm = seastar::metrics;
     _metrics.add_group("mapreduce_service", {
diff --git a/service/mapreduce_service.hh b/service/mapreduce_service.hh
index 405be7253a..93bcd7c835 100644
--- a/service/mapreduce_service.hh
+++ b/service/mapreduce_service.hh
@@ -177,6 +177,11 @@ class mapreduce_service : public seastar::peering_sharded_service<mapreduce_serv
     // subrequests across a cluster.
     future<query::mapreduce_result> dispatch(query::mapreduce_request req, tracing::trace_state_ptr tr_state);
 
+    // Splits given \`filtering_delete_request\` and distributes execution of resulting
+    // subrequests across a cluster. Each shard scans its local data and applies
+    // tombstones for matching rows/partitions.
+    future<query::filtering_delete_result> dispatch_delete(query::filtering_delete_request req, tracing::trace_state_ptr tr_state);
+
 private:
     future<> dispatch_range_and_reduce(const locator::effective_replication_map_ptr& erm, retrying_dispatcher& dispatcher, query::mapreduce_request const& req, query::mapreduce_request&& req_with_modified_pr, locator::host_id addr, query::mapreduce_result& result_, tracing::trace_state_ptr tr_state);
     future<> dispatch_to_vnodes(schema_ptr schema, replica::column_family& cf, query::mapreduce_request& req, query::mapreduce_result& result, tracing::trace_state_ptr tr_state);
@@ -187,12 +192,21 @@ class mapreduce_service : public seastar::peering_sharded_service<mapreduce_serv
     // Used to execute a \`mapreduce_request\` on a shard.
     future<query::mapreduce_result> execute_on_this_shard(query::mapreduce_request req, std::optional<tracing::trace_info> tr_info);
 
+    // Filtering delete dispatch methods - mirror the mapreduce dispatch pattern
+    future<> dispatch_delete_range_and_reduce(const locator::effective_replication_map_ptr& erm, const query::filtering_delete_request& req, query::filtering_delete_request&& req_with_modified_pr, locator::host_id addr, query::filtering_delete_result& result, tracing::trace_state_ptr tr_state);
+    future<> dispatch_delete_to_vnodes(schema_ptr schema, replica::column_family& cf, query::filtering_delete_request& req, query::filtering_delete_result& result, tracing::trace_state_ptr tr_state);
+    future<> dispatch_delete_to_tablets(schema_ptr schema, replica::column_family& cf, query::filtering_delete_request& req, query::filtering_delete_result& result, tracing::trace_state_ptr tr_state);
+    future<query::filtering_delete_result> dispatch_delete_to_shards(query::filtering_delete_request req, std::optional<tracing::trace_info> tr_info);
+    future<query::filtering_delete_result> execute_delete_on_this_shard(query::filtering_delete_request req, std::optional<tracing::trace_info> tr_info);
+
     void register_metrics();
     void init_messaging_service();
     future<> uninit_messaging_service();
 
     friend class retrying_dispatcher;
+    friend class filtering_delete_retrying_dispatcher;
     friend class mapreduce_tablet_algorithm;
+    friend class filtering_delete_tablet_algorithm;
 };
 
 } // namespace service
diff --git a/test/boost/expr_test.cc b/test/boost/expr_test.cc
index ce1d26cc6b..211bc1c5d2 100644
--- a/test/boost/expr_test.cc
+++ b/test/boost/expr_test.cc
@@ -4818,3 +4818,101 @@ BOOST_AUTO_TEST_CASE(test_levellize_aggregation_depth) {
     // Somewhat fragile, but easiest way to test entire structure
     BOOST_REQUIRE_EQUAL(fmt::format("{:debug}", e2), "foo.my_agg(system.sum(system.$$first$$(r)), system.$$first$$(system.$$first$$(TTL(r))))");
 }
+
+// Tests for proper escaping in expression formatting.
+
+BOOST_AUTO_TEST_CASE(expr_printer_text_constant_with_quotes) {
+    // A text constant containing single quotes must be properly escaped
+    // when printed with {:user} formatter.
+    auto val = make_text_const("it's a 'test'");
+    auto result = expr_print(val);
+    BOOST_REQUIRE_EQUAL(result, "'it''s a ''test'''");
+}
+
+BOOST_AUTO_TEST_CASE(expr_printer_untyped_string_constant_with_quotes) {
+    // An untyped_constant of string type with embedded quotes must be escaped.
+    auto val = make_string_untyped("it's");
+    auto result = expr_print(val);
+    BOOST_REQUIRE_EQUAL(result, "'it''s'");
+}
+
+BOOST_AUTO_TEST_CASE(expr_printer_text_constant_round_trip) {
+    // Formatting a text constant and re-parsing should yield the same WHERE clause.
+    // This tests the full round-trip: constant -> CQL text -> parse -> CQL text
+    auto text_const = make_text_const("it's a 'test'");
+    binary_operator eq {
+        make_column("col"),
+        oper_t::EQ,
+        text_const
+    };
+    auto printed = expr_print(eq);
+    BOOST_REQUIRE_EQUAL(printed, "col = 'it''s a ''test'''");
+
+    // Parse it back and print again — should be stable
+    expression reparsed = cql3::util::where_clause_to_relations(printed, cql3::dialect{});
+    sstring reprinted = cql3::util::relations_to_where_clause(reparsed);
+    BOOST_REQUIRE_EQUAL(printed, reprinted);
+}
+
+BOOST_AUTO_TEST_CASE(expr_printer_blob_constant_format) {
+    // A blob constant should be printed with 0x prefix.
+    bytes blob_val{int8_t(0xca), int8_t(0xfe)};
+    auto raw = cql3::raw_value::make_value(blob_val);
+    constant c(raw, bytes_type);
+    auto result = expr_print(c);
+    BOOST_REQUIRE_EQUAL(result, "0xcafe");
+}
+
+BOOST_AUTO_TEST_CASE(test_inline_bind_variables) {
+    // inline_bind_variables should replace bind_variable nodes with constant nodes
+    // using values from query_options.
+    auto bv = new_bind_variable(0, int32_type);
+    binary_operator eq {
+        make_column("col"),
+        oper_t::EQ,
+        bv
+    };
+
+    // Create query options with bind variable value = 42
+    auto raw_values = cql3::raw_value_vector_with_unset({cql3::raw_value::make_value(int32_type->decompose(int32_t(42)))});
+    cql3::query_options opts(std::move(raw_values));
+
+    auto inlined = inline_bind_variables(eq, opts);
+    auto printed = expr_print(inlined);
+    BOOST_REQUIRE_EQUAL(printed, "col = 42");
+}
+
+BOOST_AUTO_TEST_CASE(test_inline_bind_variables_text_with_quotes) {
+    // inline_bind_variables + formatting should produce properly escaped CQL text.
+    auto bv = new_bind_variable(0, utf8_type);
+    binary_operator eq {
+        make_column("col"),
+        oper_t::EQ,
+        bv
+    };
+
+    // Create query options with bind variable value = "it's"
+    auto raw_values = cql3::raw_value_vector_with_unset({cql3::raw_value::make_value(utf8_type->decompose(sstring("it's")))});
+    cql3::query_options opts(std::move(raw_values));
+
+    auto inlined = inline_bind_variables(eq, opts);
+    auto printed = expr_print(inlined);
+    BOOST_REQUIRE_EQUAL(printed, "col = 'it''s'");
+}
+
+BOOST_AUTO_TEST_CASE(test_inline_bind_variables_null) {
+    // inline_bind_variables should handle null bind variable values.
+    auto bv = new_bind_variable(0, int32_type);
+    binary_operator eq {
+        make_column("col"),
+        oper_t::EQ,
+        bv
+    };
+
+    auto raw_values = cql3::raw_value_vector_with_unset({cql3::raw_value::make_null()});
+    cql3::query_options opts(std::move(raw_values));
+
+    auto inlined = inline_bind_variables(eq, opts);
+    auto printed = expr_print(inlined);
+    BOOST_REQUIRE_EQUAL(printed, "col = null");
+}
diff --git a/test/boost/types_test.cc b/test/boost/types_test.cc
index c6ba860ae0..2c9a7b94a9 100644
--- a/test/boost/types_test.cc
+++ b/test/boost/types_test.cc
@@ -23,6 +23,7 @@
 #include "types/list.hh"
 #include "types/set.hh"
 #include "types/vector.hh"
+#include "types/user.hh"
 #include "test/lib/exception_utils.hh"
 #include "test/lib/test_utils.hh"
 
@@ -1024,3 +1025,93 @@ SEASTAR_TEST_CASE(test_list_type_serialization) {
     BOOST_REQUIRE_EQUAL(list, list_type->deserialize_value(managed_bytes_view(*ser)));
     return make_ready_future<>();
 }
+
+// Tests for to_parsable_string() producing valid, re-parsable CQL literals.
+
+BOOST_AUTO_TEST_CASE(test_to_parsable_string_text_with_single_quotes) {
+    // A text value containing single quotes must be escaped by doubling them.
+    data_value val(sstring("it's a 'test'"));
+    auto result = val.to_parsable_string();
+    // Expected: 'it''s a ''test'''
+    BOOST_REQUIRE_EQUAL(result, "'it''s a ''test'''");
+}
+
+BOOST_AUTO_TEST_CASE(test_to_parsable_string_text_plain) {
+    // A text value without special characters should be wrapped in single quotes.
+    data_value val(sstring("hello world"));
+    auto result = val.to_parsable_string();
+    BOOST_REQUIRE_EQUAL(result, "'hello world'");
+}
+
+BOOST_AUTO_TEST_CASE(test_to_parsable_string_text_empty) {
+    // An empty text value should produce ''
+    data_value val(sstring(""));
+    auto result = val.to_parsable_string();
+    BOOST_REQUIRE_EQUAL(result, "''");
+}
+
+BOOST_AUTO_TEST_CASE(test_to_parsable_string_ascii_with_single_quotes) {
+    // ASCII type also uses single_quote() escaping.
+    auto val = data_value(ascii_native_type{sstring("it's")});
+    auto result = val.to_parsable_string();
+    BOOST_REQUIRE_EQUAL(result, "'it''s'");
+}
+
+BOOST_AUTO_TEST_CASE(test_to_parsable_string_blob_hex_prefix) {
+    // Blob values must have a 0x prefix in CQL.
+    bytes blob_val{int8_t(0xde), int8_t(0xad), int8_t(0xbe), int8_t(0xef)};
+    data_value val(blob_val);
+    auto result = val.to_parsable_string();
+    BOOST_REQUIRE_EQUAL(result, "0xdeadbeef");
+}
+
+BOOST_AUTO_TEST_CASE(test_to_parsable_string_blob_empty) {
+    // An empty blob should produce 0x
+    data_value val(bytes{});
+    auto result = val.to_parsable_string();
+    BOOST_REQUIRE_EQUAL(result, "0x");
+}
+
+BOOST_AUTO_TEST_CASE(test_to_parsable_string_udt_field_names_quoted) {
+    // UDT field names that are CQL reserved words or contain special
+    // characters should be properly quoted.
+    auto udt = user_type_impl::get_instance(
+        "ks", to_bytes("test_type"),
+        {to_bytes("select"), to_bytes("normal"), to_bytes("With Spaces")},
+        {int32_type, utf8_type, int32_type},
+        true);
+    std::vector<data_value> fields;
+    fields.push_back(data_value(int32_t(42)));
+    fields.push_back(data_value(sstring("hello")));
+    fields.push_back(data_value(int32_t(7)));
+    auto val = make_user_value(udt, std::move(fields));
+    auto result = val.to_parsable_string();
+    // "select" is a reserved word -> must be double-quoted
+    // "normal" needs no quoting
+    // "With Spaces" has uppercase and spaces -> must be double-quoted
+    BOOST_REQUIRE(result.find("\\"select\\"") != sstring::npos);
+    BOOST_REQUIRE(result.find("normal") != sstring::npos);
+    BOOST_REQUIRE(result.find("\\"With Spaces\\"") != sstring::npos);
+}
+
+BOOST_AUTO_TEST_CASE(test_to_parsable_string_udt_text_field_escaping) {
+    // UDT text field values should have their single quotes escaped.
+    auto udt = user_type_impl::get_instance(
+        "ks", to_bytes("test_type"),
+        {to_bytes("name")},
+        {utf8_type},
+        true);
+    std::vector<data_value> fields;
+    fields.push_back(data_value(sstring("it's")));
+    auto val = make_user_value(udt, std::move(fields));
+    auto result = val.to_parsable_string();
+    // The text value inside the UDT should be properly escaped
+    BOOST_REQUIRE(result.find("'it''s'") != sstring::npos);
+}
+
+BOOST_AUTO_TEST_CASE(test_to_parsable_string_int) {
+    // Simple integer should not be quoted.
+    data_value val(int32_t(42));
+    auto result = val.to_parsable_string();
+    BOOST_REQUIRE_EQUAL(result, "42");
+}
diff --git a/test/cluster/test_delete_allow_filtering.py b/test/cluster/test_delete_allow_filtering.py
new file mode 100644
index 0000000000..6b2025232f
--- /dev/null
+++ b/test/cluster/test_delete_allow_filtering.py
@@ -0,0 +1,116 @@
+# Copyright 2026-present ScyllaDB
+#
+# SPDX-License-Identifier: LicenseRef-ScyllaDB-Source-Available-1.0
+
+# Multi-node cluster tests for DELETE ... ALLOW FILTERING.
+#
+# Basic predicate/syntax tests live in test/cqlpy/test_delete_allow_filtering.py.
+
+import asyncio
+import logging
+import pytest
+import time
+
+from cassandra.cluster import ConsistencyLevel
+from cassandra.query import SimpleStatement
+
+from test.pylib.manager_client import ManagerClient
+from test.cluster.util import new_test_keyspace, new_test_table, wait_for_cql_and_get_hosts
+
+logger = logging.getLogger(__name__)
+
+
+@pytest.mark.asyncio
+async def test_filtering_delete_with_paging(manager: ManagerClient):
+    """Filtering delete across many partitions to exercise paging.
+    Uses enough data to force multiple pages (page size is 1000)."""
+    servers = await manager.servers_add(3, auto_rack_dc="dc1")
+    cql, hosts = await manager.get_ready_cql(servers)
+
+    async with new_test_keyspace(manager,
+            "WITH replication = {'class': 'NetworkTopologyStrategy', 'replication_factor': 3}") as ks:
+        async with new_test_table(manager, ks, "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+            stmts = []
+            for p in range(400):
+                for c in range(10):
+                    stmts.append(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {c % 3})")
+            await asyncio.gather(*[cql.run_async(s) for s in stmts])
+
+            await cql.run_async(f"DELETE FROM {table} WHERE v = 0 ALLOW FILTERING")
+
+            rows = await cql.run_async(
+                SimpleStatement(f"SELECT count(*) FROM {table}",
+                                consistency_level=ConsistencyLevel.ALL))
+            total_original = 400 * 10
+            deleted = sum(1 for p in range(400) for c in range(10) if c % 3 == 0)
+            assert rows[0].count == total_original - deleted
+
+
+@pytest.mark.asyncio
+async def test_filtering_delete_propagated(manager: ManagerClient):
+    """Writes with ALL and reads from individual nodes to confirm
+    all replicas received the tombstones."""
+    servers = await manager.servers_add(3, auto_rack_dc="dc1")
+    cql, hosts = await manager.get_ready_cql(servers)
+
+    async with new_test_keyspace(manager,
+            "WITH replication = {'class': 'NetworkTopologyStrategy', 'replication_factor': 3}") as ks:
+        async with new_test_table(manager, ks, "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+            stmts = []
+            for p in range(20):
+                for c in range(5):
+                    stmts.append(SimpleStatement(
+                        f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {c % 3})",
+                        consistency_level=ConsistencyLevel.ALL))
+            await asyncio.gather(*[cql.run_async(s) for s in stmts])
+
+            await cql.run_async(SimpleStatement(
+                f"DELETE FROM {table} WHERE v = 0 ALLOW FILTERING",
+                consistency_level=ConsistencyLevel.ALL))
+
+            expected = sorted([(p, c, c % 3) for p in range(20) for c in range(5) if c % 3 != 0])
+            for host in hosts:
+                rows = await cql.run_async(
+                    SimpleStatement(f"SELECT p, c, v FROM {table}",
+                                    consistency_level=ConsistencyLevel.ONE),
+                    host=host)
+                assert sorted(rows) == expected
+
+
+@pytest.mark.asyncio
+async def test_filtering_delete_concurrent_from_different_nodes(manager: ManagerClient):
+    """Two filtering deletes with different predicates executed concurrently
+    from different coordinator nodes. Both should complete without conflict
+    and all nodes should agree on the final state."""
+    servers = await manager.servers_add(3, auto_rack_dc="dc1")
+    cql, hosts = await manager.get_ready_cql(servers)
+
+    async with new_test_keyspace(manager,
+            "WITH replication = {'class': 'NetworkTopologyStrategy', 'replication_factor': 3}") as ks:
+        async with new_test_table(manager, ks, "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+            stmts = []
+            for p in range(20):
+                for c in range(4):
+                    stmts.append(SimpleStatement(
+                        f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {c})",
+                        consistency_level=ConsistencyLevel.ALL))
+            await asyncio.gather(*[cql.run_async(s) for s in stmts])
+
+            del1 = cql.run_async(
+                SimpleStatement(f"DELETE FROM {table} WHERE v = 0 ALLOW FILTERING",
+                                consistency_level=ConsistencyLevel.QUORUM),
+                host=hosts[0])
+            del2 = cql.run_async(
+                SimpleStatement(f"DELETE FROM {table} WHERE v = 3 ALLOW FILTERING",
+                                consistency_level=ConsistencyLevel.QUORUM),
+                host=hosts[1])
+            await asyncio.gather(del1, del2)
+
+            expected = sorted([(p, c, c) for p in range(20) for c in range(4)
+                               if c not in (0, 3)])
+            for host in hosts:
+                rows = await cql.run_async(
+                    SimpleStatement(f"SELECT p, c, v FROM {table}",
+                                    consistency_level=ConsistencyLevel.ALL),
+                    host=host)
+                assert sorted(rows) == expected
diff --git a/test/cqlpy/test_delete_allow_filtering.py b/test/cqlpy/test_delete_allow_filtering.py
new file mode 100644
index 0000000000..0bd283bf57
--- /dev/null
+++ b/test/cqlpy/test_delete_allow_filtering.py
@@ -0,0 +1,438 @@
+# Copyright 2026-present ScyllaDB
+#
+# SPDX-License-Identifier: LicenseRef-ScyllaDB-Source-Available-1.0
+
+# Tests for DELETE ... ALLOW FILTERING
+#
+# This feature allows deleting rows matching a WHERE clause that doesn't
+# fully specify the primary key. The operation fans out to all nodes/shards
+# in parallel (mapreduce-style), scans data, and writes tombstones.
+
+import pytest
+
+from cassandra.protocol import InvalidRequest, SyntaxException
+
+from .util import new_test_table
+
+# ----------------------------------------------------------------
+# Not supported syntax
+# ----------------------------------------------------------------
+
+def test_delete_allow_filtering_rejects_column_specific(cql, test_keyspace, scylla_only):
+    """Column-specific deletions (DELETE v FROM ...) are not supported with
+    ALLOW FILTERING. Only whole-row/partition deletion is allowed."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        with pytest.raises(InvalidRequest, match="Column-specific deletions are not supported"):
+            cql.execute(f"DELETE v FROM {table} WHERE v = 10 ALLOW FILTERING")
+
+
+def test_delete_allow_filtering_rejects_if_exists(cql, test_keyspace, scylla_only):
+    """Conditional DELETE (IF EXISTS) is not supported with ALLOW FILTERING."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        with pytest.raises(InvalidRequest, match="Conditional DELETE.*IF.*not supported"):
+            cql.execute(f"DELETE FROM {table} WHERE v = 10 IF EXISTS ALLOW FILTERING")
+
+
+def test_delete_allow_filtering_rejects_if_condition(cql, test_keyspace, scylla_only):
+    """Conditional DELETE (IF v = ...) is not supported with ALLOW FILTERING."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        with pytest.raises(InvalidRequest, match="Conditional DELETE.*IF.*not supported"):
+            cql.execute(f"DELETE FROM {table} WHERE p = 1 IF v = 10 ALLOW FILTERING")
+
+
+def test_delete_allow_filtering_rejects_pk_or_ck(cql, test_keyspace, scylla_only):
+    """OR combining partition key and clustering key is not supported."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        with pytest.raises(SyntaxException):
+            cql.execute(f"DELETE FROM {table} WHERE p = 0 OR c = 3 ALLOW FILTERING")
+
+
+# ----------------------------------------------------------------
+# Regular column predicates (read-before-delete)
+# ----------------------------------------------------------------
+
+def test_delete_allow_filtering_by_regular_column(cql, test_keyspace, scylla_only):
+    """Delete rows where a regular column matches a value."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(3):
+            for c in range(3):
+                cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {c})")
+
+        # Delete all rows where v = 1
+        cql.execute(f"DELETE FROM {table} WHERE v = 1 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        # v=1 rows were (0,1,1), (1,1,1), (2,1,1) -- now deleted
+        expected = sorted([(p, c, c) for p in range(3) for c in range(3) if c != 1])
+        assert remaining == expected
+
+
+def test_delete_allow_filtering_by_regular_column_inequality(cql, test_keyspace, scylla_only):
+    """Delete rows where a regular column satisfies an inequality."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(3):
+            for c in range(3):
+                cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {p * 10 + c})")
+
+        # Delete all rows where v >= 20 (i.e., p=2: values 20,21,22)
+        cql.execute(f"DELETE FROM {table} WHERE v >= 20 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        expected = sorted([(p, c, p * 10 + c) for p in range(3) for c in range(3) if p * 10 + c < 20])
+        assert remaining == expected
+
+
+def test_delete_allow_filtering_no_matching_rows(cql, test_keyspace, scylla_only):
+    """Delete with a predicate that matches nothing should be a no-op."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        cql.execute(f"INSERT INTO {table} (p, c, v) VALUES (1, 1, 10)")
+        cql.execute(f"INSERT INTO {table} (p, c, v) VALUES (2, 2, 20)")
+
+        cql.execute(f"DELETE FROM {table} WHERE v = 999 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        assert remaining == [(1, 1, 10), (2, 2, 20)]
+
+
+def test_delete_allow_filtering_all_rows(cql, test_keyspace, scylla_only):
+    """Delete all rows by matching a predicate that covers everything."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for i in range(5):
+            cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({i}, 0, 1)")
+
+        cql.execute(f"DELETE FROM {table} WHERE v = 1 ALLOW FILTERING")
+
+        remaining = list(cql.execute(f"SELECT * FROM {table}"))
+        assert remaining == []
+
+
+# ----------------------------------------------------------------
+# Partition-key-only predicates
+# ----------------------------------------------------------------
+
+def test_delete_allow_filtering_partition_key_range(cql, test_keyspace, scylla_only):
+    """Delete partitions where partition key satisfies an inequality."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(5):
+            for c in range(2):
+                cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {p})")
+
+        # Delete where p >= 3
+        cql.execute(f"DELETE FROM {table} WHERE p >= 3 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        expected = sorted([(p, c, p) for p in range(3) for c in range(2)])
+        assert remaining == expected
+
+
+def test_delete_allow_filtering_token_range(cql, test_keyspace, scylla_only):
+    """Delete by token range restriction."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(10):
+            cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, 0, {p})")
+
+        all_before = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+
+        # Delete using a token range that may cover some partitions
+        # We pick an arbitrary range; the exact partitions deleted depend on
+        # token ordering. We just verify correctness by checking that after
+        # the delete, the remaining rows are a strict subset of the originals
+        # and that the deleted rows are in the specified token range.
+        # Use a token range that should catch at least some partitions:
+        cql.execute(f"DELETE FROM {table} WHERE token(p) < 0 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        assert len(remaining) <= len(all_before)
+        # All remaining rows should have token(p) >= 0
+        for row in remaining:
+            token = list(cql.execute(f"SELECT token(p) FROM {table} WHERE p = {row.p}"))[0][0]
+            assert token >= 0
+
+
+# ----------------------------------------------------------------
+# Clustering column predicates
+# ----------------------------------------------------------------
+
+def test_delete_allow_filtering_clustering_range(cql, test_keyspace, scylla_only):
+    """Delete rows with clustering key range (no regular column predicate)."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(3):
+            for c in range(5):
+                cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {c})")
+
+        # Delete all rows where c >= 3 across all partitions
+        cql.execute(f"DELETE FROM {table} WHERE c >= 3 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        expected = sorted([(p, c, c) for p in range(3) for c in range(3)])
+        assert remaining == expected
+
+
+def test_delete_allow_filtering_pk_and_ck_restriction(cql, test_keyspace, scylla_only):
+    """Delete with both partition key and clustering key restrictions."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(4):
+            for c in range(4):
+                cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {p * 10 + c})")
+
+        # Delete rows where p < 2 AND c > 1
+        cql.execute(f"DELETE FROM {table} WHERE p < 2 AND c > 1 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        expected = sorted([(p, c, p * 10 + c) for p in range(4) for c in range(4)
+                           if not (p < 2 and c > 1)])
+        assert remaining == expected
+
+
+# ----------------------------------------------------------------
+# Mixed predicates: partition key + clustering key + regular column
+# ----------------------------------------------------------------
+
+def test_delete_allow_filtering_mixed_predicates(cql, test_keyspace, scylla_only):
+    """Delete with partition key, clustering key, and regular
+    column restrictions combined."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(3):
+            for c in range(3):
+                cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {(p + c) % 3})")
+
+        # Delete where p > 0 AND c < 2 AND v = 1
+        cql.execute(f"DELETE FROM {table} WHERE p > 0 AND c < 2 AND v = 1 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        expected = sorted([(p, c, (p + c) % 3)
+                           for p in range(3) for c in range(3)
+                           if not (p > 0 and c < 2 and (p + c) % 3 == 1)])
+        assert remaining == expected
+
+
+# ----------------------------------------------------------------
+# Edge cases
+# ----------------------------------------------------------------
+
+def test_delete_allow_filtering_empty_table(cql, test_keyspace, scylla_only):
+    """Delete from an empty table should succeed without error."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        cql.execute(f"DELETE FROM {table} WHERE v = 1 ALLOW FILTERING")
+        remaining = list(cql.execute(f"SELECT * FROM {table}"))
+        assert remaining == []
+
+
+def test_delete_allow_filtering_single_partition_key(cql, test_keyspace, scylla_only):
+    """When partition key IS fully specified, ALLOW FILTERING should still
+    work (even if it's not needed for partition lookup)."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for c in range(5):
+            cql.execute(f"INSERT INTO {table} (p, c, v) VALUES (1, {c}, {c})")
+
+        # p=1 fully specifies partition, but we also filter on v
+        cql.execute(f"DELETE FROM {table} WHERE p = 1 AND v >= 3 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        expected = sorted([(1, c, c) for c in range(3)])
+        assert remaining == expected
+
+
+def test_delete_allow_filtering_composite_partition_key(cql, test_keyspace, scylla_only):
+    """Test with composite partition key where only part of it is specified."""
+    with new_test_table(cql, test_keyspace,
+                        "p1 int, p2 int, c int, v int, PRIMARY KEY ((p1, p2), c)") as table:
+        for p1 in range(3):
+            for p2 in range(3):
+                cql.execute(f"INSERT INTO {table} (p1, p2, c, v) VALUES ({p1}, {p2}, 0, {p1 + p2})")
+
+        # Only specify p1, missing p2 -- requires ALLOW FILTERING
+        cql.execute(f"DELETE FROM {table} WHERE p1 = 1 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p1, p2, c, v FROM {table}"))
+        expected = sorted([(p1, p2, 0, p1 + p2) for p1 in range(3) for p2 in range(3) if p1 != 1])
+        assert remaining == expected
+
+
+def test_delete_allow_filtering_composite_ck(cql, test_keyspace, scylla_only):
+    """Test with composite clustering key."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c1 int, c2 int, v int, PRIMARY KEY (p, c1, c2)") as table:
+        for p in range(2):
+            for c1 in range(3):
+                for c2 in range(3):
+                    cql.execute(f"INSERT INTO {table} (p, c1, c2, v) VALUES ({p}, {c1}, {c2}, {c1 * 10 + c2})")
+
+        # Delete where c2 = 0 across all partitions (skipping c1)
+        cql.execute(f"DELETE FROM {table} WHERE c2 = 0 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c1, c2, v FROM {table}"))
+        expected = sorted([(p, c1, c2, c1 * 10 + c2)
+                           for p in range(2) for c1 in range(3) for c2 in range(3)
+                           if c2 != 0])
+        assert remaining == expected
+
+
+def test_delete_allow_filtering_with_text_column(cql, test_keyspace, scylla_only):
+    """Test with text column types."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, name text, PRIMARY KEY (p, c)") as table:
+        cql.execute(f"INSERT INTO {table} (p, c, name) VALUES (1, 1, 'alice')")
+        cql.execute(f"INSERT INTO {table} (p, c, name) VALUES (1, 2, 'bob')")
+        cql.execute(f"INSERT INTO {table} (p, c, name) VALUES (2, 1, 'alice')")
+        cql.execute(f"INSERT INTO {table} (p, c, name) VALUES (2, 2, 'charlie')")
+
+        cql.execute(f"DELETE FROM {table} WHERE name = 'alice' ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, name FROM {table}"))
+        assert remaining == [(1, 2, 'bob'), (2, 2, 'charlie')]
+
+
+def test_delete_allow_filtering_with_prepared_statement(cql, test_keyspace, scylla_only):
+    """Test using a prepared statement with bind variables."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(3):
+            cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, 0, {p})")
+
+        stmt = cql.prepare(f"DELETE FROM {table} WHERE v = ? ALLOW FILTERING")
+        cql.execute(stmt, [1])
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        assert remaining == [(0, 0, 0), (2, 0, 2)]
+
+
+def test_delete_allow_filtering_idempotent(cql, test_keyspace, scylla_only):
+    """Running the same DELETE ALLOW FILTERING twice should be idempotent."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        cql.execute(f"INSERT INTO {table} (p, c, v) VALUES (1, 1, 10)")
+        cql.execute(f"INSERT INTO {table} (p, c, v) VALUES (2, 2, 20)")
+
+        cql.execute(f"DELETE FROM {table} WHERE v = 10 ALLOW FILTERING")
+        cql.execute(f"DELETE FROM {table} WHERE v = 10 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        assert remaining == [(2, 2, 20)]
+
+
+def test_delete_allow_filtering_partition_key_and_regular(cql, test_keyspace, scylla_only):
+    """Delete with both partition key and regular column restrictions."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(3):
+            for c in range(3):
+                cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {c * 10})")
+
+        # Delete rows where p >= 1 and v = 20
+        cql.execute(f"DELETE FROM {table} WHERE p >= 1 AND v = 20 ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        expected = sorted([(p, c, c * 10) for p in range(3) for c in range(3)
+                           if not (p >= 1 and c * 10 == 20)])
+        assert remaining == expected
+
+
+def test_delete_allow_filtering_static_column(cql, test_keyspace, scylla_only):
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, s int static, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(5):
+            cql.execute(f"INSERT INTO {table} (p, s) VALUES ({p}, {p * 10})")
+            for c in range(3):
+                cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {c})")
+
+        cql.execute(f"DELETE FROM {table} WHERE s = 20 ALLOW FILTERING")
+
+        rows = list(cql.execute(f"SELECT p, c, s, v FROM {table} WHERE p = 2"))
+        assert len(rows) == 0
+
+        for p in range(5):
+            if p == 2:
+                continue
+            rows = list(cql.execute(f"SELECT p, c, s, v FROM {table} WHERE p = {p}"))
+            assert len(rows) == 3
+
+
+def test_delete_allow_filtering_static_and_regular_column(cql, test_keyspace, scylla_only):
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, s int static, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(5):
+            cql.execute(f"INSERT INTO {table} (p, s) VALUES ({p}, {p * 10})")
+            for c in range(3):
+                cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {c})")
+
+        cql.execute(f"DELETE FROM {table} WHERE s = 20 AND v IN (0, 1, 2) ALLOW FILTERING")
+
+        rows = list(cql.execute(f"SELECT p, c, s, v FROM {table} WHERE p = 2"))
+        assert len(rows) == 1
+        assert rows[0].c is None and rows[0].v is None
+        assert rows[0].s == 20
+
+        for p in range(5):
+            if p == 2:
+                continue
+            rows = list(cql.execute(f"SELECT p, c, s, v FROM {table} WHERE p = {p}"))
+            assert len(rows) == 3
+
+
+# ----------------------------------------------------------------
+# IN predicates
+# ----------------------------------------------------------------
+
+def test_delete_allow_filtering_pk_in(cql, test_keyspace, scylla_only):
+    """Delete rows where partition key is IN a set of values."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(5):
+            for c in range(3):
+                cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {p})")
+
+        cql.execute(f"DELETE FROM {table} WHERE p IN (1, 3) ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        expected = sorted([(p, c, p) for p in range(5) for c in range(3)
+                           if p not in (1, 3)])
+        assert remaining == expected
+
+
+def test_delete_allow_filtering_ck_in(cql, test_keyspace, scylla_only):
+    """Delete rows where clustering key is IN a set of values."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(3):
+            for c in range(5):
+                cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {c})")
+
+        cql.execute(f"DELETE FROM {table} WHERE c IN (0, 2, 4) ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        expected = sorted([(p, c, c) for p in range(3) for c in range(5)
+                           if c not in (0, 2, 4)])
+        assert remaining == expected
+
+
+def test_delete_allow_filtering_regular_in(cql, test_keyspace, scylla_only):
+    """Delete rows where a regular column is IN a set of values."""
+    with new_test_table(cql, test_keyspace,
+                        "p int, c int, v int, PRIMARY KEY (p, c)") as table:
+        for p in range(3):
+            for c in range(4):
+                cql.execute(f"INSERT INTO {table} (p, c, v) VALUES ({p}, {c}, {c})")
+
+        cql.execute(f"DELETE FROM {table} WHERE v IN (1, 3) ALLOW FILTERING")
+
+        remaining = sorted(cql.execute(f"SELECT p, c, v FROM {table}"))
+        expected = sorted([(p, c, c) for p in range(3) for c in range(4)
+                           if c not in (1, 3)])
+        assert remaining == expected
+
diff --git a/types/types.cc b/types/types.cc
index 31f01a9e1f..3442cc5375 100644
--- a/types/types.cc
+++ b/types/types.cc
@@ -3965,7 +3965,7 @@ sstring data_value::to_parsable_string() const {
             if (i != 0) {
                 result << ", ";
             }
-            result << user_typ->string_field_names().at(i) << ":" << (*field_values)[i].to_parsable_string();
+            result << cql3::util::maybe_quote(user_typ->string_field_names().at(i)) << ":" << (*field_values)[i].to_parsable_string();
         }
         result << "}";
         return std::move(result).str();
@@ -4009,8 +4009,15 @@ sstring data_value::to_parsable_string() const {
         || type_kind == abstract_type::kind::date
         || type_kind == abstract_type::kind::timestamp
     ) {
-        // Put quotes on types that require it
-        return fmt::format("'{}'", *this);
+        // Put quotes on types that require it.
+        // Use single_quote() to properly escape embedded single quotes
+        // (e.g. "it's" becomes "'it''s'").
+        return cql3::util::single_quote(fmt::format("{}", *this));
+    }
+
+    if (type_kind == abstract_type::kind::bytes) {
+        // Blob literals in CQL require a 0x prefix (e.g. 0xdeadbeef)
+        return fmt::format("0x{}", *this);
     }
 
     // For simple types the default operator<< should work ok
`;
