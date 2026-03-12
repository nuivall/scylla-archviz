// =============================================================================
// DIFF OVERLAY
// Loads pre-analyzed diff data and overlays it on the architecture graph.
// Touched components are highlighted green; clicking them shows diff analysis.
// =============================================================================

(function () {
  'use strict';

  const DIFF_GREEN = '#22c55e';
  const DIFF_GREEN_DIM = 'rgba(34,197,94,0.15)';
  const DIFF_GREEN_EDGE = 'rgba(34,197,94,0.7)';
  const DIFF_BLUE = '#3b82f6';
  const DIFF_BLUE_EDGE = 'rgba(59,130,246,0.7)';

  let diffActive = false;
  let analysisData = null;
  let touchedNodeIds = new Set();
  let touchedEdgeKeys = new Set(); // "source->target" format (no dep type)
  let newEdgeKeys = new Set();     // subset of touchedEdgeKeys that don't exist in the graph

  // ---- Button setup ----
  const btnDiff = document.getElementById('btnDiff');
  if (!btnDiff) return;

  btnDiff.addEventListener('click', () => {
    if (diffActive) {
      deactivateDiff();
      return;
    }
    activateDiff();
  });

  // ---- Activate / Deactivate ----

  function activateDiff() {
    // Load analysis data from the global set by data/diff-nodes.js
    if (!analysisData) {
      if (typeof DIFF_ANALYSIS_DATA === 'undefined') {
        console.error('Diff overlay: DIFF_ANALYSIS_DATA not found. Ensure data/diff-nodes.js is loaded before diff-overlay.js.');
        btnDiff.textContent = 'Diff (error)';
        return;
      }
      analysisData = DIFF_ANALYSIS_DATA;
    }

    // Build touched sets
    touchedNodeIds = new Set(Object.keys(analysisData.nodes || {}));
    touchedEdgeKeys = new Set();
    Object.keys(analysisData.edges || {}).forEach(key => {
      const parts = key.split('->');
      if (parts.length >= 2) {
        touchedEdgeKeys.add(parts[0] + '->' + parts[1]);
      }
    });

    diffActive = true;
    btnDiff.classList.add('active');

    // Clear any existing selection/analysis
    clearAnalysis();
    selectedNode = null;
    hideInfoPanel();

    // Install intercept handlers
    overlayClickHandler = handleDiffClick;
    overlayHoverHandler = handleDiffHover;
    overlayHoverOutHandler = handleDiffHoverOut;
    overlayBgClickHandler = function () { showDiffOverviewPanel(); };
    overlayNodeHoverHandler = handleDiffNodeHover;
    overlayNodeHoverOutHandler = handleDiffNodeHoverOut;
    overlayDeactivateHandler = deactivateDiff;

    applyDiffHighlight();
    showDiffOverviewPanel();
  }

  function deactivateDiff() {
    diffActive = false;
    btnDiff.classList.remove('active');

    // Remove intercept handlers
    overlayClickHandler = null;
    overlayHoverHandler = null;
    overlayHoverOutHandler = null;
    overlayBgClickHandler = null;
    overlayNodeHoverHandler = null;
    overlayNodeHoverOutHandler = null;
    overlayDeactivateHandler = null;

    // Reset graph to normal state
    selectedNode = null;
    hideInfoPanel();
    if (currentNodeSel && currentLinkSel) {
      // Restore node rect fill/stroke colors and opacities
      const fillOp = parseFloat(css('--node-fill-opacity'));
      const strokeOp = parseFloat(css('--node-stroke-opacity'));
      currentNodeSel.select('rect')
        .attr('fill', d => getNodeColor(d))
        .attr('fill-opacity', fillOp)
        .attr('stroke', d => getNodeColor(d))
        .attr('stroke-opacity', strokeOp)
        .attr('stroke-width', 1.5);

      // Restore text colors and opacity
      currentNodeSel.select('text')
        .attr('fill', d => getNodeColor(d))
        .attr('fill-opacity', 1);
      currentNodeSel.selectAll('text')
        .attr('fill-opacity', 1);

      // Restore edge colors, widths, and opacities
      currentLinkSel
        .attr('stroke', d => edgeColor(d))
        .attr('stroke-width', d => edgeStrokeWidth(d.strength))
        .attr('stroke-opacity', d => d.mutual ? 0.8 : (0.15 + Math.min(d.strength, 8) * 0.08));
    }

    // Remove diff markers and new-edge paths
    if (currentNodeSel) {
      currentNodeSel.selectAll('.diff-marker').remove();
    }
    d3.select('.edges').selectAll('.diff-new-edge').remove();
  }

  // Re-apply highlight after re-render (theme change, resize)
  postRenderCallbacks.push(() => {
    if (diffActive) {
      applyDiffHighlight();
    }
  });

  // ---- Visual Highlighting ----

  function applyDiffHighlight() {
    if (!currentNodeSel || !currentLinkSel) return;

    // Re-detect new edges against the current graph edges on every call.
    // This is important because toggling detailed mode changes currentEdges,
    // so "new" vs "existing" classification must be re-evaluated.
    newEdgeKeys = new Set();
    if (currentEdges) {
      const existingEdgeKeys = new Set();
      currentEdges.forEach(e => {
        const sid = typeof e.source === 'object' ? e.source.id : e.source;
        const tid = typeof e.target === 'object' ? e.target.id : e.target;
        existingEdgeKeys.add(sid + '->' + tid);
      });
      touchedEdgeKeys.forEach(key => {
        if (!existingEdgeKeys.has(key)) newEdgeKeys.add(key);
      });
    }

    // Dim all nodes, brighten touched ones
    currentNodeSel.select('rect')
      .attr('fill-opacity', n => touchedNodeIds.has(n.id) ? 0.25 : 0.03)
      .attr('stroke-opacity', n => touchedNodeIds.has(n.id) ? 1 : 0.1)
      .attr('stroke-width', n => touchedNodeIds.has(n.id) ? 2.5 : 1)
      .attr('stroke', n => touchedNodeIds.has(n.id) ? DIFF_GREEN : getNodeColor(n))
      .attr('fill', n => touchedNodeIds.has(n.id) ? DIFF_GREEN : getNodeColor(n));

    currentNodeSel.selectAll('text')
      .attr('fill-opacity', n => touchedNodeIds.has(n.id) ? 1 : 0.1);

    // Overwrite text fill color for touched nodes
    currentNodeSel.each(function (n) {
      if (touchedNodeIds.has(n.id)) {
        d3.select(this).select('text').attr('fill', DIFF_GREEN);
      }
    });

    // Highlight edges between touched nodes
    currentLinkSel
      .attr('stroke-opacity', e => {
        const sid = typeof e.source === 'object' ? e.source.id : e.source;
        const tid = typeof e.target === 'object' ? e.target.id : e.target;
        const key = sid + '->' + tid;
        if (touchedEdgeKeys.has(key)) return 0.85;
        if (touchedNodeIds.has(sid) && touchedNodeIds.has(tid)) return 0.5;
        return 0.03;
      })
      .attr('stroke', e => {
        const sid = typeof e.source === 'object' ? e.source.id : e.source;
        const tid = typeof e.target === 'object' ? e.target.id : e.target;
        const key = sid + '->' + tid;
        if (touchedEdgeKeys.has(key)) return newEdgeKeys.has(key) ? DIFF_BLUE : DIFF_GREEN;
        if (touchedNodeIds.has(sid) && touchedNodeIds.has(tid)) return DIFF_GREEN_EDGE;
        return edgeColor(e);
      })
      .attr('stroke-width', e => {
        const sid = typeof e.source === 'object' ? e.source.id : e.source;
        const tid = typeof e.target === 'object' ? e.target.id : e.target;
        const key = sid + '->' + tid;
        if (touchedEdgeKeys.has(key)) return 3;
        if (touchedNodeIds.has(sid) && touchedNodeIds.has(tid)) return 2;
        return edgeStrokeWidth(e.strength);
      });

    // Draw new edges that don't exist in the graph
    d3.select('.edges').selectAll('.diff-new-edge').remove();
    if (newEdgeKeys.size > 0 && currentNodes) {
      const nodeMap = Object.fromEntries(currentNodes.map(n => [n.id, n]));
      newEdgeKeys.forEach(key => {
        const parts = key.split('->');
        const src = nodeMap[parts[0]];
        const tgt = nodeMap[parts[1]];
        if (!src || !tgt) return;
        const pathD = computeEdgePath(src, tgt);
        if (!pathD) return;
        d3.select('.edges').append('path')
          .attr('class', 'diff-new-edge')
          .attr('d', pathD)
          .attr('fill', 'none')
          .attr('stroke', DIFF_BLUE)
          .attr('stroke-width', 3)
          .attr('stroke-opacity', 0.85)
          .attr('stroke-dasharray', '8,4')
          .attr('stroke-linecap', 'round')
          .attr('pointer-events', 'none');
      });
    }

    // Add +lines / -lines text labels at top-right corner outside each touched node
    currentNodeSel.selectAll('.diff-marker').remove();
    currentNodeSel.filter(n => touchedNodeIds.has(n.id)).each(function (n) {
      const g = d3.select(this);
      const info = analysisData.nodes[n.id];
      if (!info) return;
      const added = info.linesAdded || 0;
      const removed = info.linesRemoved || 0;
      const fontSize = Math.max(8, Math.min(10, n.radius * 0.25));
      // Position just outside the top-right corner of the node rect
      const baseX = n.pillW + 3;
      const baseY = -n.radius * 0.65 - 1;

      if (added > 0) {
        g.append('text')
          .attr('class', 'diff-marker')
          .attr('text-anchor', 'start')
          .attr('x', baseX)
          .attr('y', baseY)
          .attr('font-size', fontSize)
          .attr('font-weight', 700)
          .attr('fill', DIFF_GREEN)
          .attr('pointer-events', 'none')
          .text('+' + added);
      }
      if (removed > 0) {
        g.append('text')
          .attr('class', 'diff-marker')
          .attr('text-anchor', 'start')
          .attr('x', baseX)
          .attr('y', baseY + fontSize + 1)
          .attr('font-size', fontSize)
          .attr('font-weight', 700)
          .attr('fill', '#ef4444')
          .attr('pointer-events', 'none')
          .text('-' + removed);
      }
    });
  }

  // ---- Edge Path Computation (mirrors updateEdges in index.html) ----

  function computeEdgePath(src, tgt) {
    const sx = src.x, sy = src.y;
    const tx = tgt.x, ty = tgt.y;
    const dy = ty - sy;
    const dx = tx - sx;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return '';

    if (Math.abs(dy) < 10) {
      const arc = Math.max(40, Math.abs(dx) * 0.35);
      const sy0 = sy - (src.radius || 20) * 0.6;
      const ty0 = ty - (tgt.radius || 20) * 0.6;
      return 'M' + sx + ',' + sy0 + ' C' + sx + ',' + (sy0 - arc) + ' ' + tx + ',' + (ty0 - arc) + ' ' + tx + ',' + ty0;
    }

    const goingDown = dy > 0;
    const srcRy = (src.radius || 20) * 0.65;
    const tgtRy = (tgt.radius || 20) * 0.65;
    const sy0 = goingDown ? sy + srcRy : sy - srcRy;
    const ty0 = goingDown ? ty - tgtRy : ty + tgtRy;
    const effDy = ty0 - sy0;
    const cp = Math.abs(effDy) * 0.4;
    const sign = Math.sign(effDy);
    return 'M' + sx + ',' + sy0 + ' C' + sx + ',' + (sy0 + sign * cp) + ' ' + tx + ',' + (ty0 - sign * cp) + ' ' + tx + ',' + ty0;
  }

  // ---- Overview Panel (shown when diff is first activated) ----

  function showDiffOverviewPanel() {
    const data = analysisData;
    d3.select('#infoDot').style('background', DIFF_GREEN);
    d3.select('#infoTitle').text('Diff Overview');

    let html = '';
    html += '<div class="diff-commit-hash">' + (data.commit || '') + '</div>';
    html += '<div class="diff-commit-title">' + escHtml(data.title || '') + '</div>';
    html += '<p>' + escHtml(data.summary || '') + '</p>';

    // Touched components
    const nodeIds = Object.keys(data.nodes || {});
    if (nodeIds.length) {
      html += '<h3>Touched Components (' + nodeIds.length + ')</h3>';
      html += '<ul class="dep-list">';
      nodeIds.forEach(nodeId => {
        const info = data.nodes[nodeId];
        const cn = activeNodes.find(n => n.id === nodeId);
        html += '<li data-node-id="' + nodeId + '" style="cursor:pointer">';
        html += '<span class="dep-dot" style="background:' + DIFF_GREEN + '"></span>';
        html += (cn ? cn.ns + '::' : '') + nodeId;
        html += '<span style="margin-left:auto;display:flex;gap:4px">';
        html += '<span class="diff-info-badge lines-added">+' + (info.linesAdded || 0) + '</span>';
        if (info.linesRemoved) {
          html += '<span class="diff-info-badge lines-removed">-' + info.linesRemoved + '</span>';
        }
        html += '</span>';
        html += '</li>';
      });
      html += '</ul>';
    }

    d3.select('#infoBody').html(html);
    infoPanel.classed('visible', true);
  }

  // ---- Click Handler (intercept) ----

  function handleDiffClick(d, edges) {
    if (!diffActive) return false;

    // If clicking a touched node, show diff analysis without disrupting overlay visuals
    if (touchedNodeIds.has(d.id)) {
      selectedNode = d.id;
      showDiffNodeInfo(d, edges);
      return true;
    }

    // Non-touched node: consume the click so normal behavior doesn't break diff state
    return true;
  }

  function showDiffNodeInfo(d, edges) {
    const data = analysisData;
    const nodeInfo = data.nodes[d.id];
    if (!nodeInfo) return;

    d3.select('#infoDot').style('background', DIFF_GREEN);
    d3.select('#infoTitle').text((d.ns ? d.ns + '::' : '') + d.id);

    let html = '';

    html += '<p>' + escHtml(nodeInfo.summary) + '</p>';

    // Lines changed — subtle inline note after summary
    var added = nodeInfo.linesAdded || 0;
    var removed = nodeInfo.linesRemoved || 0;
    var parts = [];
    if (added > 0) parts.push('<span style="color:#22c55e">+' + added + '</span>');
    if (removed > 0) parts.push('<span style="color:#ef4444">\u2212' + removed + '</span>');
    if (parts.length) {
      html += '<p style="font-size:11px;color:var(--text-muted);margin-top:-4px">' + parts.join(' \u2215 ') + ' lines</p>';
    }

    // Files
    if (nodeInfo.files && nodeInfo.files.length) {
      html += '<h3>Files Changed</h3>';
      html += '<ul class="diff-files-list">';
      nodeInfo.files.forEach(f => {
        html += '<li>' + escHtml(f) + '</li>';
      });
      html += '</ul>';
    }

    // Only show diff-affected dependencies (including new edges not in the graph)
    const nodeMap = Object.fromEntries(activeNodes.map(n => [n.id, n]));

    // Collect outgoing diff edges (existing + new)
    const outItems = [];
    const inItems = [];
    touchedEdgeKeys.forEach(key => {
      const parts = key.split('->');
      const sid = parts[0], tid = parts[1];
      const isNew = newEdgeKeys.has(key);
      const color = isNew ? DIFF_BLUE : DIFF_GREEN;
      if (sid === d.id) {
        // Find the graph edge for type info, or use 'new' for new edges
        const graphEdge = edges.find(e => {
          const es = typeof e.source === 'object' ? e.source.id : e.source;
          const et = typeof e.target === 'object' ? e.target.id : e.target;
          return es === sid && et === tid;
        });
        outItems.push({ nodeId: tid, edgeKey: key, type: graphEdge ? graphEdge.type : 'new', strength: graphEdge ? graphEdge.strength : 1, color: color, isNew: isNew });
      }
      if (tid === d.id) {
        const graphEdge = edges.find(e => {
          const es = typeof e.source === 'object' ? e.source.id : e.source;
          const et = typeof e.target === 'object' ? e.target.id : e.target;
          return es === sid && et === tid;
        });
        inItems.push({ nodeId: sid, edgeKey: key, type: graphEdge ? graphEdge.type : 'new', strength: graphEdge ? graphEdge.strength : 1, color: color, isNew: isNew });
      }
    });

    if (outItems.length) {
      html += '<h3>Affected Dependencies (' + outItems.length + ')</h3><ul class="dep-list">';
      outItems.forEach(item => {
        const tn = nodeMap[item.nodeId];
        const tLabel = tn ? tn.ns + '::' + item.nodeId : item.nodeId;
        const depKey = d.id + '->' + item.nodeId + '->' + item.type;
        html += '<li data-node-id="' + item.nodeId + '" data-dep-key="' + depKey + '" data-dep-strength="' + item.strength + '" data-dep-dir="out"' +
          ' data-diff-edge="' + item.edgeKey + '">';
        html += '<span class="dep-dot" style="background:' + item.color + '"></span>' + tLabel;
        if (item.isNew) {
          html += ' <span class="diff-info-badge" style="color:' + DIFF_BLUE + ';border-color:rgba(59,130,246,0.3);background:rgba(59,130,246,0.12)">new</span>';
        }
        html += ' <span class="dep-type">' + item.type + '</span></li>';
      });
      html += '</ul>';
    }

    if (inItems.length) {
      html += '<h3>Affected by (' + inItems.length + ')</h3><ul class="dep-list">';
      inItems.forEach(item => {
        const sn = nodeMap[item.nodeId];
        const sLabel = sn ? sn.ns + '::' + item.nodeId : item.nodeId;
        const depKey = item.nodeId + '->' + d.id + '->' + item.type;
        html += '<li data-node-id="' + item.nodeId + '" data-dep-key="' + depKey + '" data-dep-strength="' + item.strength + '" data-dep-dir="in"' +
          ' data-diff-edge="' + item.edgeKey + '">';
        html += '<span class="dep-dot" style="background:' + item.color + '"></span>' + sLabel;
        if (item.isNew) {
          html += ' <span class="diff-info-badge" style="color:' + DIFF_BLUE + ';border-color:rgba(59,130,246,0.3);background:rgba(59,130,246,0.12)">new</span>';
        }
        html += ' <span class="dep-type">' + item.type + '</span></li>';
      });
      html += '</ul>';
    }

    d3.select('#infoBody').html(html);
    infoPanel.classed('visible', true);
  }

  // ---- Hover Handler (intercept for dependency items) ----

  function handleDiffHover(depKey, depStrength, depDir, li) {
    if (!diffActive) return false;

    // Check if this dependency has a diff edge entry
    const diffEdgeKey = li.getAttribute('data-diff-edge');
    if (!diffEdgeKey) return false; // Let the default handler run

    const edgeInfo = analysisData.edges[diffEdgeKey];
    if (!edgeInfo) return false;

    // Blink the dependency node
    const depNodeId = li.getAttribute('data-node-id');
    if (depNodeId && currentNodeSel) {
      currentNodeSel.classed('node-blink', false);
      currentNodeSel.filter(d => d.id === depNodeId).classed('node-blink', true);
    }

    // Show diff-specific edge info in the right detail panel
    const parts = diffEdgeKey.split('->');
    const srcId = parts[0];
    const tgtId = parts[1];
    const nodeMap = Object.fromEntries(activeNodes.map(n => [n.id, n]));
    const srcNode = nodeMap[srcId];
    const tgtNode = nodeMap[tgtId];

    const srcLabel = srcNode ? srcNode.ns + '::' + srcId : srcId;
    const tgtLabel = tgtNode ? tgtNode.ns + '::' + tgtId : tgtId;

    var isNewEdge = newEdgeKeys.has(diffEdgeKey);
    document.getElementById('depDetailDot').style.background = isNewEdge ? DIFF_BLUE : DIFF_GREEN;
    document.getElementById('depDetailTitle').textContent = srcLabel + ' \u2192 ' + tgtLabel;

    let bodyHtml = '';
    bodyHtml += '<p class="dep-desc-text">' + escHtml(edgeInfo.summary) + '</p>';

    document.getElementById('depDetailBody').innerHTML = bodyHtml;
    depDetailPanel.classed('visible', true);

    return true; // Handled — don't run default
  }

  function handleDiffHoverOut() {
    // No special behavior needed beyond default
  }

  // ---- Graph Node Hover Handlers (overlay mode) ----
  // Called when hovering a graph node while a node is already selected (left panel open).
  // Shows the dependency between selectedNode and the hovered node in the RIGHT detail panel.

  function handleDiffNodeHover(d, edges) {
    if (!diffActive) return;
    // Don't gate on touchedNodeIds — a node may be an edge target without being
    // a touched (modified) node (e.g. storage_proxy). The edge lookup below
    // already filters out nodes with no diff edge to the selected node.

    // Find the diff edge between selectedNode and hovered node
    var edgeKey = null;
    var edgeInfo = null;
    touchedEdgeKeys.forEach(function(key) {
      var parts = key.split('->');
      if ((parts[0] === selectedNode && parts[1] === d.id) || (parts[0] === d.id && parts[1] === selectedNode)) {
        edgeKey = key;
        edgeInfo = analysisData.edges[key];
      }
    });

    if (!edgeKey || !edgeInfo) return;

    // Blink the hovered node (only when we have a diff edge to display)
    if (currentNodeSel) {
      currentNodeSel.classed('node-blink', false);
      currentNodeSel.filter(function(n) { return n.id === d.id; }).classed('node-blink', true);
    }

    var isNew = newEdgeKeys.has(edgeKey);
    var parts = edgeKey.split('->');
    var srcId = parts[0], tgtId = parts[1];
    var nodeMap = Object.fromEntries(activeNodes.map(function(n) { return [n.id, n]; }));
    var srcNode = nodeMap[srcId];
    var tgtNode = nodeMap[tgtId];
    var srcLabel = srcNode ? srcNode.ns + '::' + srcId : srcId;
    var tgtLabel = tgtNode ? tgtNode.ns + '::' + tgtId : tgtId;

    document.getElementById('depDetailDot').style.background = isNew ? DIFF_BLUE : DIFF_GREEN;
    document.getElementById('depDetailTitle').textContent = srcLabel + ' \u2192 ' + tgtLabel;

    var bodyHtml = '<p class="dep-desc-text">' + escHtml(edgeInfo.summary) + '</p>';
    if (isNew) {
      bodyHtml += '<span class="diff-info-badge" style="color:' + DIFF_BLUE + ';border-color:rgba(59,130,246,0.3);background:rgba(59,130,246,0.12)">new</span>';
    }

    document.getElementById('depDetailBody').innerHTML = bodyHtml;
    depDetailPanel.classed('visible', true);
  }

  function handleDiffNodeHoverOut() {
    if (!diffActive) return;
    depDetailPanel.classed('visible', false);
  }

  // ---- Utility ----

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
