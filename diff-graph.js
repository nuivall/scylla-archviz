// =============================================================================
// DIFF GRAPH — Standalone diff analysis graph renderer
// =============================================================================
// Renders a separate full-page graph in #diffGraph SVG with 2 analysis levels:
// peering_service and class. Completely independent from the architecture
// graph — has its own zoom/pan, container groups, tier bands, and node layout.
//
// Expects: DIFF_ANALYSIS_DATA (from data/diff-nodes.js)
// Reuses from engine: LAYERS, css(), getNodeColor()

(function () {
  'use strict';

  // ---- Guard: bail if no data or d3 not loaded ----
  if (typeof DIFF_ANALYSIS_DATA === 'undefined' || typeof d3 === 'undefined') return;

  // ---- Constants ----
  const LAYER_ORDER = ['storage', 'cluster', 'services', 'query', 'api'];
  const LEVELS = ['peering_service', 'class'];
  const LEVEL_LABELS = { peering_service: 'Services', class: 'Classes' };

  // ---- State ----
  let activeLevel = 'peering_service';
  let _active = false;       // is the diff graph view currently shown?
  let _rendered = false;     // have we rendered at least once?
  let _selectedNode = null;  // id of selected node in diff graph

  // ---- Own SVG setup ----
  const svg = d3.select('#diffGraph');
  if (svg.empty()) return;   // SVG not in DOM yet — will be added by index.html changes

  const container = svg.append('g');
  const tierGroup = container.append('g').attr('class', 'diff-tiers');
  const edgeGroup = container.append('g').attr('class', 'diff-edges');
  const nodeGroup = container.append('g').attr('class', 'diff-nodes');

  // Own zoom
  const _zoom = d3.zoom()
    .scaleExtent([0.1, 5])
    .on('zoom', (e) => container.attr('transform', e.transform));
  svg.call(_zoom);

  // Own defs (markers)
  const defs = svg.append('defs');

  function _createMarker(id, color) {
    defs.append('marker')
      .attr('id', id)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 10).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L10,0L0,4').attr('fill', color);
  }

  function _rebuildMarkers() {
    defs.selectAll('marker').remove();
    _createMarker('diff-arrow-default', css('--edge-color'));
    _createMarker('diff-arrow-highlight', css('--edge-highlight'));
    // Glow filter for diff nodes
    defs.selectAll('filter#diffGlow').remove();
    const glow = defs.append('filter').attr('id', 'diffGlow');
    glow.append('feGaussianBlur').attr('stdDeviation', 2.5).attr('result', 'blur');
    glow.append('feMerge').selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic']).join('feMergeNode').attr('in', d => d);
  }

  // ---- Shared panels (reuse DOM from index.html) ----
  const infoPanel = d3.select('#infoPanel');
  const depDetailPanel = d3.select('#depDetailPanel');

  function _hideInfoPanel() {
    infoPanel.classed('visible', false);
    depDetailPanel.classed('visible', false);
  }

  // ---- Check if data is empty ----
  function _hasData() {
    if (!DIFF_ANALYSIS_DATA || !DIFF_ANALYSIS_DATA.levels) return false;
    return LEVELS.some(lvl => {
      const lData = DIFF_ANALYSIS_DATA.levels[lvl];
      return lData && lData.nodes && Object.keys(lData.nodes).length > 0;
    });
  }

  // ---- Get current level data ----
  function _levelData() {
    if (!DIFF_ANALYSIS_DATA || !DIFF_ANALYSIS_DATA.levels) return { nodes: {}, edges: {} };
    return DIFF_ANALYSIS_DATA.levels[activeLevel] || { nodes: {}, edges: {} };
  }

  // ---- Node color by layer (reuse engine LAYERS) ----
  function _nodeColor(node) {
    if (typeof LAYERS !== 'undefined' && LAYERS[node.layer]) {
      return LAYERS[node.layer].color;
    }
    return css('--text-muted');
  }

  // ---- Layout & render ----
  let _currentNodes = [];
  let _currentEdges = [];
  let _currentNodeSel = null;
  let _currentLinkSel = null;

  function render() {
    tierGroup.selectAll('*').remove();
    edgeGroup.selectAll('*').remove();
    nodeGroup.selectAll('*').remove();
    _rebuildMarkers();

    const ld = _levelData();
    const rawNodes = ld.nodes || {};
    const rawEdges = ld.edges || {};

    if (Object.keys(rawNodes).length === 0) {
      _renderEmpty();
      return;
    }

    // Build node array
    const nodes = Object.entries(rawNodes).map(([id, n]) => ({
      id,
      ns: n.ns || '',
      layer: n.layer || 'services',
      summary: n.summary || '',
      files: n.files || n.file ? (n.files || [n.file]) : [],
      linesAdded: n.linesAdded || 0,
      linesRemoved: n.linesRemoved || 0,
      totalLines: (n.linesAdded || 0) + (n.linesRemoved || 0),
      // Cross-level links
      classes: n.classes || [],
      peering_service: n.peering_service || null,
    }));

    const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

    // Build edge array
    const edges = Object.entries(rawEdges).map(([key, e]) => {
      const parts = key.split('->');
      return {
        key,
        source: parts[0],
        target: parts[1],
        summary: e.summary || '',
      };
    }).filter(e => nodeMap[e.source] && nodeMap[e.target]);

    // Uniform node sizes
    const isClassLevel = activeLevel === 'class';
    nodes.forEach(n => {
      n.radius = 30;
      n.pillW = isClassLevel ? 90 : 72;
    });

    // ---- Layered layout (adaptive for node count) ----
    const svgW = window.innerWidth;
    const svgH = window.innerHeight - 48;

    // Scale usable area based on node count for better spacing
    const nodeCount = nodes.length;
    const areaScale = nodeCount > 12 ? 1 + (nodeCount - 12) * 0.15 : 1;
    const usableH = svgH * 3 * Math.max(1, areaScale * 0.8);
    const usableW = svgW * 3 * Math.max(1, areaScale);
    const tierCount = LAYER_ORDER.length;
    const tierSpacing = usableH / (tierCount + 1);
    const tierY = {};
    LAYER_ORDER.forEach((l, i) => { tierY[l] = usableH - tierSpacing * (i + 1); });

    // Group by layer
    const layerGroups = {};
    LAYER_ORDER.forEach(l => { layerGroups[l] = []; });
    nodes.forEach(n => {
      if (layerGroups[n.layer]) layerGroups[n.layer].push(n);
      else layerGroups['services'].push(n); // fallback
    });

    // Sort by connectivity (most connected in center)
    const connectivity = {};
    edges.forEach(e => {
      connectivity[e.source] = (connectivity[e.source] || 0) + 1;
      connectivity[e.target] = (connectivity[e.target] || 0) + 1;
    });
    Object.keys(layerGroups).forEach(l => {
      const group = layerGroups[l];
      group.sort((a, b) => (connectivity[b.id] || 0) - (connectivity[a.id] || 0));
      const centered = [];
      group.forEach((n, i) => {
        if (i % 2 === 0) centered.push(n);
        else centered.unshift(n);
      });
      layerGroups[l] = centered;
    });

    // Assign X positions with adaptive gap
    const baseGap = isClassLevel ? 36 : 24;
    Object.keys(layerGroups).forEach(l => {
      const group = layerGroups[l];
      const count = group.length;
      if (count === 0) return;
      if (count === 1) {
        group[0].x = usableW / 2;
        group[0].y = tierY[group[0].layer];
        return;
      }
      const gap = baseGap;
      let totalNeeded = 0;
      for (let i = 0; i < count - 1; i++) {
        totalNeeded += group[i].pillW + group[i + 1].pillW + gap;
      }
      const sc = totalNeeded > usableW - 200 ? (usableW - 200) / totalNeeded : 1;
      const startX = (usableW - totalNeeded * sc) / 2;
      let xCursor = startX;
      group.forEach((n, i) => {
        if (i === 0) {
          n.x = xCursor;
        } else {
          xCursor += (group[i - 1].pillW + n.pillW + gap) * sc;
          n.x = xCursor;
        }
        n.y = tierY[n.layer];
      });
    });

    // ---- Draw tier bands ----
    _drawTierBands(tierY, usableW, tierSpacing);

    // ---- Draw edges ----
    const link = edgeGroup.selectAll('path')
      .data(edges)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', css('--edge-color'))
      .attr('stroke-width', 1.2)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-linecap', 'round')
      .attr('marker-end', 'url(#diff-arrow-default)');

    _updateEdges(link, nodeMap);

    _currentNodes = nodes;
    _currentEdges = edges;

    // ---- Draw nodes ----
    const cFillOp = parseFloat(css('--node-fill-opacity'));
    const cStrokeOp = parseFloat(css('--node-stroke-opacity'));
    const cTextShadow = css('--text-shadow-node');
    const cMuted = css('--text-muted');

    const node = nodeGroup.selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .attr('transform', d => `translate(${d.x},${d.y})`);

    _currentNodeSel = node;
    _currentLinkSel = link;

    // Drag (horizontal only)
    node.call(d3.drag()
      .on('drag', function (e, d) {
        d.x = e.x;
        d3.select(this).attr('transform', `translate(${d.x},${d.y})`);
        _updateEdges(link, nodeMap);
      })
    );

    // Pill shape
    node.append('rect')
      .attr('x', d => -d.pillW)
      .attr('y', d => -d.radius * 0.65)
      .attr('width', d => d.pillW * 2)
      .attr('height', d => d.radius * 1.3)
      .attr('rx', d => d.radius * 0.45)
      .attr('fill', d => _nodeColor(d))
      .attr('fill-opacity', cFillOp)
      .attr('stroke', d => _nodeColor(d))
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', cStrokeOp)
      .style('filter', 'url(#diffGlow)')
      .style('transition', 'fill-opacity 0.3s, stroke-opacity 0.3s');

    // Node label (id)
    node.append('text')
      .text(d => d.id)
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.1em')
      .attr('fill', d => _nodeColor(d))
      .attr('font-size', 11.5)
      .attr('font-weight', 600)
      .attr('pointer-events', 'none')
      .style('text-shadow', cTextShadow);

    // Namespace / sub-label
    node.append('text')
      .text(d => d.ns || '')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.15em')
      .attr('fill', cMuted)
      .attr('font-size', 10)
      .attr('pointer-events', 'none');

    // Auto-fit text to node width
    node.each(function(d) {
      const g = d3.select(this);
      const maxW = d.pillW * 2 - 12;
      g.selectAll('text').each(function() {
        const el = this;
        const len = el.getComputedTextLength();
        if (len > maxW) {
          const curSize = parseFloat(el.getAttribute('font-size'));
          el.setAttribute('font-size', curSize * maxW / len);
        }
      });
    });

    // +N / -N line count badges (positioned above the pill)
    node.each(function (d) {
      if (d.linesAdded === 0 && d.linesRemoved === 0) return;
      const g = d3.select(this);
      const badgeY = -d.radius * 0.65 - 10;
      if (d.linesAdded > 0) {
        g.append('text')
          .text('+' + d.linesAdded)
          .attr('x', d.linesRemoved > 0 ? -14 : 0)
          .attr('y', badgeY)
          .attr('text-anchor', 'middle')
          .attr('fill', '#22c55e')
          .attr('font-size', 9.5)
          .attr('font-weight', 700)
          .attr('pointer-events', 'none');
      }
      if (d.linesRemoved > 0) {
        g.append('text')
          .text('-' + d.linesRemoved)
          .attr('x', d.linesAdded > 0 ? 14 : 0)
          .attr('y', badgeY)
          .attr('text-anchor', 'middle')
          .attr('fill', '#ef4444')
          .attr('font-size', 9.5)
          .attr('font-weight', 700)
          .attr('pointer-events', 'none');
      }
    });

    // ---- Interactivity ----
    node.on('click', (e, d) => {
      e.stopPropagation();
      if (_selectedNode === d.id) {
        _selectedNode = null;
        _resetHighlight();
        _showOverviewPanel();
        return;
      }
      _selectedNode = d.id;
      _highlightNode(d);
      _showNodeInfo(d);
    });

    node.on('mouseover', (e, d) => {
      if (_selectedNode) {
        // If hovering a node connected to the selected one, blink it
        if (d.id !== _selectedNode) {
          const isConnected = edges.some(edge =>
            (edge.source === _selectedNode && edge.target === d.id) ||
            (edge.target === _selectedNode && edge.source === d.id)
          );
          if (isConnected && _currentNodeSel) {
            _currentNodeSel.classed('node-blink', false);
            _currentNodeSel.filter(n => n.id === d.id).classed('node-blink', true);
            // Show the edge summary in depDetailPanel
            const hovEdge = edges.find(edge =>
              (edge.source === _selectedNode && edge.target === d.id) ||
              (edge.target === _selectedNode && edge.source === d.id)
            );
            if (hovEdge) _showEdgeDetail(hovEdge);
          }
        }
      }
    });

    node.on('mouseout', () => {
      if (_currentNodeSel) _currentNodeSel.classed('node-blink', false);
      depDetailPanel.classed('visible', false);
    });

    // Edge interactivity — hover to show summary in depDetailPanel
    link.on('mouseover', (e, d) => {
      _showEdgeDetail(d);
      // Highlight the hovered edge
      d3.select(e.currentTarget)
        .attr('stroke', css('--edge-highlight'))
        .attr('stroke-opacity', 0.85)
        .attr('stroke-width', 2.5);
    });

    link.on('mouseout', (e, d) => {
      depDetailPanel.classed('visible', false);
      // Restore edge style (depends on whether a node is selected)
      if (_selectedNode) {
        const isConnected = d.source === _selectedNode || d.target === _selectedNode;
        d3.select(e.currentTarget)
          .attr('stroke', isConnected ? css('--edge-highlight') : css('--edge-color'))
          .attr('stroke-opacity', isConnected ? 0.85 : 0.04)
          .attr('stroke-width', isConnected ? 2.2 : 1.2);
      } else {
        d3.select(e.currentTarget)
          .attr('stroke', css('--edge-color'))
          .attr('stroke-opacity', 0.35)
          .attr('stroke-width', 1.2);
      }
    });

    // Make edges wider hit area for hover
    link.attr('pointer-events', 'stroke')
      .style('cursor', 'pointer');

    // Background click
    svg.on('click', () => {
      _selectedNode = null;
      _resetHighlight();
      _showOverviewPanel();
    });

    // Auto-fit
    _zoomToFit(nodes, 100);

    // Show overview if no node selected
    if (!_selectedNode) {
      _showOverviewPanel();
    }

    _rendered = true;
  }

  // ---- Render empty state ----
  function _renderEmpty() {
    nodeGroup.selectAll('*').remove();
    edgeGroup.selectAll('*').remove();
    tierGroup.selectAll('*').remove();

    const svgW = window.innerWidth;
    const svgH = window.innerHeight - 48;

    // Reset zoom
    svg.call(_zoom.transform, d3.zoomIdentity);

    nodeGroup.append('text')
      .text('No diff analysis data available')
      .attr('x', svgW / 2)
      .attr('y', svgH / 2 - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', css('--text-muted'))
      .attr('font-size', 16)
      .attr('font-weight', 500);

    nodeGroup.append('text')
      .text('Run the generate-diff skill to populate this view')
      .attr('x', svgW / 2)
      .attr('y', svgH / 2 + 16)
      .attr('text-anchor', 'middle')
      .attr('fill', css('--text-muted'))
      .attr('font-size', 13);

    _hideInfoPanel();
    _currentNodes = [];
    _currentEdges = [];
    _rendered = true;
  }

  // ---- Tier bands ----
  function _drawTierBands(tierY, usableW, tierSpacing) {
    const bandOp = parseFloat(css('--band-opacity'));
    const tierLabelOp = parseFloat(css('--tier-label-opacity'));
    const guideOp = parseFloat(css('--guide-line-opacity'));

    LAYER_ORDER.forEach(l => {
      const y = tierY[l];
      const bandH = tierSpacing * 0.85;
      const color = (typeof LAYERS !== 'undefined' && LAYERS[l]) ? LAYERS[l].color : css('--text-muted');
      const label = (typeof LAYERS !== 'undefined' && LAYERS[l]) ? LAYERS[l].label : l;

      tierGroup.append('rect')
        .attr('x', -500).attr('y', y - bandH / 2)
        .attr('width', usableW + 1000).attr('height', bandH)
        .attr('fill', color).attr('fill-opacity', bandOp).attr('rx', 8);

      tierGroup.append('text')
        .text(label)
        .attr('x', usableW / 2).attr('y', y - bandH / 2 + 18)
        .attr('text-anchor', 'middle')
        .attr('fill', color).attr('fill-opacity', tierLabelOp)
        .attr('font-size', 14).attr('font-weight', 700)
        .attr('letter-spacing', '1px').attr('pointer-events', 'none');

      tierGroup.append('line')
        .attr('x1', -500).attr('x2', usableW + 1000)
        .attr('y1', y).attr('y2', y)
        .attr('stroke', color).attr('stroke-opacity', guideOp)
        .attr('stroke-width', 1).attr('stroke-dasharray', '6,8');
    });
  }

  // ---- Edge paths (bezier — mirrors engine updateEdges) ----
  function _updateEdges(linkSel, nodeMap) {
    linkSel.attr('d', d => {
      const src = nodeMap[d.source];
      const tgt = nodeMap[d.target];
      if (!src || !tgt) return '';
      const sx = src.x, sy = src.y;
      const tx = tgt.x, ty = tgt.y;
      const dy = ty - sy;
      const dx = tx - sx;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return '';

      // Same-tier: raised arc
      if (Math.abs(dy) < 10) {
        const arc = Math.max(40, Math.abs(dx) * 0.35);
        const sy0 = sy - (src.radius || 20) * 0.6;
        const ty0 = ty - (tgt.radius || 20) * 0.6;
        return `M${sx},${sy0} C${sx},${sy0 - arc} ${tx},${ty0 - arc} ${tx},${ty0}`;
      }

      // Cross-tier: vertical bezier
      const goingDown = dy > 0;
      const srcRy = (src.radius || 20) * 0.65;
      const tgtRy = (tgt.radius || 20) * 0.65;
      const sy0 = goingDown ? sy + srcRy : sy - srcRy;
      const ty0 = goingDown ? ty - tgtRy : ty + tgtRy;
      const effDy = ty0 - sy0;
      const cp = Math.abs(effDy) * 0.4;
      return `M${sx},${sy0} C${sx},${sy0 + Math.sign(effDy) * cp} ${tx},${ty0 - Math.sign(effDy) * cp} ${tx},${ty0}`;
    });
  }

  // ---- Zoom to fit ----
  function _zoomToFit(nodes, padding) {
    if (!nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nodes.forEach(n => {
      const r = (n.pillW || n.radius || 30) + 20;
      if (n.x - r < x0) x0 = n.x - r;
      if (n.y - r < y0) y0 = n.y - r;
      if (n.x + r > x1) x1 = n.x + r;
      if (n.y + r > y1) y1 = n.y + r;
    });
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return;
    const svgW = window.innerWidth;
    const svgH = window.innerHeight - 48;
    const scale = Math.min((svgW - padding * 2) / bw, (svgH - padding * 2) / bh, 1.5);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const tx = svgW / 2 - cx * scale;
    const ty = svgH / 2 - cy * scale;
    svg.call(_zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  // ---- Highlight selected node ----
  function _highlightNode(d) {
    if (!_currentNodeSel || !_currentLinkSel) return;
    const connected = new Set([d.id]);
    _currentEdges.forEach(e => {
      if (e.source === d.id) connected.add(e.target);
      if (e.target === d.id) connected.add(e.source);
    });

    _currentNodeSel.select('rect')
      .attr('fill-opacity', n => connected.has(n.id) ? 0.22 : 0.03)
      .attr('stroke-opacity', n => connected.has(n.id) ? 1 : 0.12)
      .attr('stroke-width', n => n.id === d.id ? 3 : connected.has(n.id) ? 2 : 1);
    _currentNodeSel.selectAll('text')
      .attr('fill-opacity', n => connected.has(n.id) ? 1 : 0.12);

    _currentLinkSel.attr('stroke-opacity', e => {
      if (e.source === d.id || e.target === d.id) return 0.85;
      return 0.04;
    }).attr('stroke', e => {
      if (e.source === d.id || e.target === d.id) return css('--edge-highlight');
      return css('--edge-color');
    }).attr('stroke-width', e => {
      if (e.source === d.id || e.target === d.id) return 2.2;
      return 1.2;
    });
  }

  function _resetHighlight() {
    if (!_currentNodeSel || !_currentLinkSel) return;
    const fillOp = parseFloat(css('--node-fill-opacity'));
    const strokeOp = parseFloat(css('--node-stroke-opacity'));
    _currentNodeSel.select('rect')
      .attr('fill-opacity', fillOp)
      .attr('stroke-opacity', strokeOp)
      .attr('stroke-width', 1.5);
    _currentNodeSel.selectAll('text').attr('fill-opacity', 1);
    _currentLinkSel
      .attr('stroke-opacity', 0.35)
      .attr('stroke', css('--edge-color'))
      .attr('stroke-width', 1.2);
  }

  // ---- Edge & node hover helpers ----

  function _showEdgeDetail(edge) {
    const srcNode = _currentNodes.find(n => n.id === edge.source);
    const tgtNode = _currentNodes.find(n => n.id === edge.target);
    const srcLabel = edge.source;
    const tgtLabel = edge.target;
    const srcColor = srcNode ? _nodeColor(srcNode) : css('--text-muted');

    document.getElementById('depDetailDot').style.background = srcColor;
    document.getElementById('depDetailTitle').textContent = srcLabel + ' \u2192 ' + tgtLabel;

    let bodyHtml = '';
    bodyHtml += '<span class="dep-detail-type" style="border:1px solid ' + srcColor + '">' + LEVEL_LABELS[activeLevel] + '</span>';
    if (edge.summary) {
      bodyHtml += '<h3>How it\'s used</h3>';
      bodyHtml += '<p class="dep-desc-text">' + _escHtml(edge.summary) + '</p>';
    } else {
      bodyHtml += '<h3>How it\'s used</h3>';
      bodyHtml += '<p class="dep-desc-text" style="color:var(--text-muted);font-style:italic">No description available.</p>';
    }
    document.getElementById('depDetailBody').innerHTML = bodyHtml;
    depDetailPanel.classed('visible', true);
  }

  // ---- Info panels ----

  function _showNodeInfo(d) {
    d3.select('#infoDot').style('background', _nodeColor(d));
    d3.select('#infoTitle').text(d.id);

    let html = '';

    // Summary
    if (d.summary) {
      html += '<p>' + _escHtml(d.summary) + '</p>';
    }

    // Line count badges
    html += '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
    if (d.linesAdded > 0) html += '<span class="diff-info-badge lines-added">+' + d.linesAdded + ' added</span>';
    if (d.linesRemoved > 0) html += '<span class="diff-info-badge lines-removed">-' + d.linesRemoved + ' removed</span>';
    html += '</div>';

    // Outgoing edges (uses)
    const outEdges = _currentEdges.filter(e => e.source === d.id);
    const inEdges = _currentEdges.filter(e => e.target === d.id);
    if (outEdges.length > 0) {
      html += '<h3>Uses (' + outEdges.length + ')</h3>';
      html += '<ul class="dep-list">';
      outEdges.forEach(e => {
        const tn = _currentNodes.find(n => n.id === e.target);
        const c = tn ? _nodeColor(tn) : css('--text-muted');
        html += '<li data-node-id="' + _escAttr(e.target) + '"><span class="dep-dot" style="background:' + c + '"></span>' + _escHtml(e.target);
        html += '</li>';
      });
      html += '</ul>';
    }
    if (inEdges.length > 0) {
      html += '<h3>Used by (' + inEdges.length + ')</h3>';
      html += '<ul class="dep-list">';
      inEdges.forEach(e => {
        const sn = _currentNodes.find(n => n.id === e.source);
        const c = sn ? _nodeColor(sn) : css('--text-muted');
        html += '<li data-node-id="' + _escAttr(e.source) + '"><span class="dep-dot" style="background:' + c + '"></span>' + _escHtml(e.source);
        html += '</li>';
      });
      html += '</ul>';
    }

    // Cross-level links
    html += _crossLevelLinks(d);

    d3.select('#infoBody').html(html);
    infoPanel.classed('visible', true);

    // Wire up clickable dep list items for diff graph navigation
    _wireInfoPanelClicks();
  }

  function _showOverviewPanel() {
    if (!_hasData()) { _hideInfoPanel(); return; }

    d3.select('#infoDot').style('background', css('--accent'));
    d3.select('#infoTitle').text('Diff Analysis');

    let html = '';
    if (DIFF_ANALYSIS_DATA.title) {
      html += '<div class="diff-commit-title">' + _escHtml(DIFF_ANALYSIS_DATA.title) + '</div>';
    }
    if (DIFF_ANALYSIS_DATA.commit) {
      html += '<div class="diff-commit-hash">' + _escHtml(DIFF_ANALYSIS_DATA.commit) + '</div>';
    }
    if (DIFF_ANALYSIS_DATA.summary) {
      html += '<p>' + _escHtml(DIFF_ANALYSIS_DATA.summary) + '</p>';
    }

    d3.select('#infoBody').html(html);
    infoPanel.classed('visible', true);
  }

  // ---- Cross-level navigation links ----
  function _crossLevelLinks(d) {
    let html = '';

    if (activeLevel === 'peering_service' && d.classes && d.classes.length > 0) {
      html += '<h3>Classes in this service</h3>';
      html += '<ul class="dep-list">';
      d.classes.forEach(cls => {
        html += '<li class="diff-cross-link" data-level="class" data-target="' + _escAttr(cls) + '" style="cursor:pointer">';
        html += '<span class="dep-dot" style="background:' + css('--accent') + '"></span>' + _escHtml(cls);
        html += '</li>';
      });
      html += '</ul>';
    }

    return html;
  }

  // ---- Wire info panel clicks for diff graph ----
  function _wireInfoPanelClicks() {
    const body = document.getElementById('infoBody');
    if (!body) return;

    // Cross-level navigation
    body.querySelectorAll('.diff-cross-link').forEach(li => {
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        const level = li.getAttribute('data-level');
        const target = li.getAttribute('data-target');
        if (level && LEVELS.includes(level)) {
          activeLevel = level;
          _selectedNode = target || null;
          _updateModeButtons();
          render();
          // If target exists in the new level, select it
          if (target) {
            const nd = _currentNodes.find(n => n.id === target);
            if (nd) {
              _selectedNode = nd.id;
              _highlightNode(nd);
              _showNodeInfo(nd);
              _panToNode(nd);
            }
          }
        }
      });
    });

    // Node links in dependency lists (navigate within same level)
    body.querySelectorAll('li[data-node-id]').forEach(li => {
      if (li.classList.contains('diff-cross-link')) return; // skip cross-level links
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        const nodeId = li.getAttribute('data-node-id');
        const nd = _currentNodes.find(n => n.id === nodeId);
        if (nd) {
          _selectedNode = nd.id;
          _highlightNode(nd);
          _showNodeInfo(nd);
          _panToNode(nd);
        }
      });
      li.addEventListener('mouseenter', () => {
        const nodeId = li.getAttribute('data-node-id');
        // Blink the node on the graph
        if (nodeId && _currentNodeSel) {
          _currentNodeSel.classed('node-blink', false);
          _currentNodeSel.filter(n => n.id === nodeId).classed('node-blink', true);
        }
        // Show edge detail in right panel
        if (_selectedNode && nodeId) {
          const edge = _currentEdges.find(e =>
            (e.source === _selectedNode && e.target === nodeId) ||
            (e.target === _selectedNode && e.source === nodeId)
          );
          if (edge) _showEdgeDetail(edge);
        }
      });
      li.addEventListener('mouseleave', () => {
        if (_currentNodeSel) _currentNodeSel.classed('node-blink', false);
        depDetailPanel.classed('visible', false);
      });
    });
  }

  function _panToNode(d) {
    const svgW = window.innerWidth;
    const svgH = window.innerHeight - 48;
    const curTransform = d3.zoomTransform(svg.node());
    const scale = Math.max(curTransform.k, 1.2);
    const panelOffset = infoPanel.classed('visible') ? 150 : 0;
    const tx = (svgW / 2 + panelOffset) - d.x * scale;
    const ty = svgH / 2 - d.y * scale;
    svg.call(_zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  // ---- Mode buttons ----
  function _updateModeButtons() {
    document.querySelectorAll('#diffToolbar .view-tab[data-level]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-level') === activeLevel);
    });
  }

  function switchLevel(level) {
    if (!LEVELS.includes(level)) return;
    activeLevel = level;
    _selectedNode = null;
    _updateModeButtons();
    render();
  }

  // ---- HTML helpers ----
  function _escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _escAttr(s) {
    return _escHtml(s);
  }

  // ---- Keyboard handler (when diff graph is active) ----
  function _onKeyDown(e) {
    if (!_active) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 'Escape') {
      if (_selectedNode) {
        _selectedNode = null;
        _resetHighlight();
        _showOverviewPanel();
      }
      return;
    }

    // 1/2 to switch levels
    if (e.key === '1') switchLevel('peering_service');
    if (e.key === '2') switchLevel('class');
  }
  document.addEventListener('keydown', _onKeyDown);

  // ---- Search support ----
  function _searchNorm(s) { return s.toLowerCase().replace(/[_ ]/g, ''); }

  function search(q) {
    if (!_currentNodeSel) return;
    if (!q) {
      _currentNodeSel.style('opacity', 1);
      if (_currentLinkSel) _currentLinkSel.style('opacity', 1);
      return;
    }
    _currentNodeSel.style('opacity', function(d) {
      return _searchNorm(d.id).includes(q) ? 1 : 0.08;
    });
    if (_currentLinkSel) _currentLinkSel.style('opacity', 0.05);
  }

  // Select and pan to the first match; returns true if at least one match found
  function searchSelect(q) {
    if (!_currentNodes.length) return false;
    const matches = _currentNodes.filter(n => _searchNorm(n.id).includes(q));
    if (matches.length === 1) {
      const nd = matches[0];
      _selectedNode = nd.id;
      _highlightNode(nd);
      _showNodeInfo(nd);
      _panToNode(nd);
      return true;
    }
    return false;
  }

  // ---- Public API ----
  function activate() {
    _active = true;
    svg.style('display', null);
    render();
  }

  function deactivate() {
    _active = false;
    _selectedNode = null;
    _hideInfoPanel();
    svg.style('display', 'none');
  }

  function isActive() {
    return _active;
  }

  // Initially hidden
  svg.style('display', 'none');

  // Expose public API
  window.diffGraph = {
    activate: activate,
    deactivate: deactivate,
    render: render,
    isActive: isActive,
    switchLevel: switchLevel,
    hasData: _hasData,
    search: search,
    searchSelect: searchSelect,
  };

  // Handle resize when active
  window.addEventListener('resize', () => {
    if (_active) render();
  });

})();
