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
  let _codeReviewMode = false; // is the code-review sub-view active?
  let _codeReviewRendered = false; // has the code review been rendered at least once?
  let _parsedDiff = null;    // cached parsed diff data
  let _savedGraphState = null; // saved zoom/pan/selection when jumping to code review

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
    // Skip SVG render when in code-review mode (theme toggle calls render())
    if (_codeReviewMode) { _rebuildMarkers(); return; }
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
    const usableH = svgH * 1.5 * Math.max(1, areaScale * 0.8);
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
          .attr('fill', '#7ec89a')
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
          .attr('fill', '#ff5555')
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

    node.on('dblclick', (e, d) => {
      e.stopPropagation();
      _goToCodeForNode(d);
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

    // Determine whether other levels have data so we can show a helpful message
    var otherLevel = null;
    if (_hasData()) {
      for (var i = 0; i < LEVELS.length; i++) {
        if (LEVELS[i] !== activeLevel) {
          var ld = DIFF_ANALYSIS_DATA.levels[LEVELS[i]];
          if (ld && ld.nodes && Object.keys(ld.nodes).length > 0) {
            otherLevel = LEVELS[i];
            break;
          }
        }
      }
    }

    var heading, subtitle;
    if (otherLevel) {
      // Current level is empty but another has data
      var currentLabel = LEVEL_LABELS[activeLevel] || activeLevel;
      var otherLabel = LEVEL_LABELS[otherLevel] || otherLevel;
      var otherKey = LEVELS.indexOf(otherLevel) + 1;
      heading = 'No ' + currentLabel.toLowerCase() + ' affected by this diff';
      subtitle = 'Switch to ' + otherLabel + ' view to see affected components (press ' + otherKey + ')';
    } else {
      // No data at any level
      heading = 'No diff analysis data available';
      subtitle = 'Run the generate-diff skill to populate this view';
    }

    nodeGroup.append('text')
      .text(heading)
      .attr('x', svgW / 2)
      .attr('y', svgH / 2 - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', css('--text-muted'))
      .attr('font-size', 16)
      .attr('font-weight', 500);

    nodeGroup.append('text')
      .text(subtitle)
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

    // Go to Code link (if node has files)
    if (d.files && d.files.length > 0) {
      html += '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">';
      html += '<a class="diff-go-to-code" data-node-id="' + _escAttr(d.id) + '" href="#" style="';
      html += 'display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;';
      html += 'color:var(--accent);text-decoration:none;cursor:pointer;';
      html += 'transition:opacity .15s">';
      html += '\u2192 Go to Code (' + d.files.length + ' file' + (d.files.length > 1 ? 's' : '') + ')';
      html += '</a></div>';
    }

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

    // "Go to Code" link
    body.querySelectorAll('.diff-go-to-code').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nodeId = a.getAttribute('data-node-id');
        const nd = _currentNodes.find(n => n.id === nodeId);
        if (nd) _goToCodeForNode(nd);
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
      const lvl = btn.getAttribute('data-level');
      if (lvl === 'code-review') {
        btn.classList.toggle('active', _codeReviewMode);
      } else {
        btn.classList.toggle('active', !_codeReviewMode && lvl === activeLevel);
      }
    });
  }

  // ==========================================================================
  // CODE REVIEW MODE — Unified diff parser + renderer
  // ==========================================================================

  const _reviewContainer = document.getElementById('diffReviewContainer');
  const _reviewScroll = document.getElementById('diffReviewScroll');
  const _fileTreeEl = document.getElementById('diffFileTree');

  // ---- Unified diff parser ----
  function _parseDiff(text) {
    if (!text) return [];
    const lines = text.split('\n');
    const files = [];
    let current = null;
    let hunk = null;
    let oldLine = 0, newLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // New file header
      if (line.startsWith('diff --git ')) {
        current = { file: '', oldFile: '', hunks: [], isNew: false, isDeleted: false, isRenamed: false, isBinary: false };
        files.push(current);
        hunk = null;
        continue;
      }
      if (!current) continue;

      // old/new file names
      if (line.startsWith('--- ')) {
        const f = line.slice(4);
        current.oldFile = f.startsWith('a/') ? f.slice(2) : f;
        if (f === '/dev/null') current.isNew = true;
        continue;
      }
      if (line.startsWith('+++ ')) {
        const f = line.slice(4);
        current.file = f.startsWith('b/') ? f.slice(2) : f;
        if (f === '/dev/null') { current.isDeleted = true; current.file = current.oldFile; }
        continue;
      }
      if (line.startsWith('rename from ')) { current.isRenamed = true; continue; }
      if (line.startsWith('rename to ')) { current.isRenamed = true; continue; }
      if (line.startsWith('Binary files ')) { current.isBinary = true; continue; }

      // Hunk header
      if (line.startsWith('@@ ')) {
        const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
        oldLine = m ? parseInt(m[1]) : 0;
        newLine = m ? parseInt(m[2]) : 0;
        const ctx = m && m[3] ? m[3].trim() : '';
        hunk = { header: line, context: ctx, lines: [] };
        if (current) current.hunks.push(hunk);
        continue;
      }

      // Diff content lines
      if (!hunk) continue;
      if (line.startsWith('+')) {
        hunk.lines.push({ type: 'add', content: line.slice(1), oldNum: null, newNum: newLine });
        newLine++;
      } else if (line.startsWith('-')) {
        hunk.lines.push({ type: 'del', content: line.slice(1), oldNum: oldLine, newNum: null });
        oldLine++;
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file" — skip
        continue;
      } else {
        // Context line (starts with space or is empty)
        hunk.lines.push({ type: 'ctx', content: line.startsWith(' ') ? line.slice(1) : line, oldNum: oldLine, newNum: newLine });
        oldLine++;
        newLine++;
      }
    }

    // Compute per-file stats
    files.forEach(f => {
      f.linesAdded = 0;
      f.linesRemoved = 0;
      f.hunks.forEach(h => {
        h.lines.forEach(l => {
          if (l.type === 'add') f.linesAdded++;
          if (l.type === 'del') f.linesRemoved++;
        });
      });
    });

    return files;
  }

  // ---- Look up AI summary for a file ----
  function _fileSummary(filename) {
    if (!DIFF_ANALYSIS_DATA || !DIFF_ANALYSIS_DATA.levels) return '';
    // Search class-level nodes (most granular)
    const classNodes = DIFF_ANALYSIS_DATA.levels.class ? DIFF_ANALYSIS_DATA.levels.class.nodes : {};
    for (const id in classNodes) {
      const n = classNodes[id];
      const files = n.files || (n.file ? [n.file] : []);
      if (files.some(f => f === filename)) return n.summary || '';
    }
    // Fallback to service-level
    const svcNodes = DIFF_ANALYSIS_DATA.levels.peering_service ? DIFF_ANALYSIS_DATA.levels.peering_service.nodes : {};
    for (const id in svcNodes) {
      const n = svcNodes[id];
      const files = n.files || [];
      if (files.some(f => f === filename)) return n.summary || '';
    }
    return '';
  }

  // ---- File type badge ----
  function _fileTypeBadge(f) {
    if (f.isNew) return '<span class="diff-file-badge new-file">NEW</span>';
    if (f.isDeleted) return '<span class="diff-file-badge deleted-file">DELETED</span>';
    if (f.isRenamed) return '<span class="diff-file-badge renamed-file">RENAMED</span>';
    // Cross-reference with DIFF_ANALYSIS_DATA
    if (DIFF_ANALYSIS_DATA && DIFF_ANALYSIS_DATA.newFiles && DIFF_ANALYSIS_DATA.newFiles.includes(f.file)) {
      return '<span class="diff-file-badge new-file">NEW</span>';
    }
    return '<span class="diff-file-badge modified-file">MODIFIED</span>';
  }

  // ---- Render code review ----
  function _renderCodeReview() {
    if (!_reviewScroll) return;

    // Parse diff if not cached
    if (!_parsedDiff) {
      const rawText = typeof DIFF_RAW_TEXT !== 'undefined' ? DIFF_RAW_TEXT : null;
      _parsedDiff = _parseDiff(rawText);
    }

    if (!_parsedDiff || _parsedDiff.length === 0) {
      _reviewScroll.innerHTML =
        '<div class="diff-review-inner"><div class="diff-review-empty">' +
        '<h3>No diff data available</h3>' +
        '<p>Run the generate-diff skill to populate this view</p>' +
        '</div></div>';
      if (_fileTreeEl) _fileTreeEl.innerHTML = '';
      _codeReviewRendered = true;
      return;
    }

    const files = _parsedDiff;
    let totalAdded = 0, totalRemoved = 0;
    files.forEach(f => { totalAdded += f.linesAdded; totalRemoved += f.linesRemoved; });

    let html = '<div class="diff-review-inner">';

    // Header
    html += '<div class="diff-review-header">';
    if (DIFF_ANALYSIS_DATA && DIFF_ANALYSIS_DATA.title) {
      html += '<h2>' + _escHtml(DIFF_ANALYSIS_DATA.title) + '</h2>';
    }
    html += '<div class="diff-review-meta">';
    if (DIFF_ANALYSIS_DATA && DIFF_ANALYSIS_DATA.commit) {
      html += '<span style="font-family:\'Fira Code\',\'SF Mono\',\'Cascadia Code\',monospace">' + _escHtml(DIFF_ANALYSIS_DATA.commit) + '</span>';
    }
    html += '<span>' + files.length + ' files changed</span>';
    html += '<span style="color:#7ec89a">+' + totalAdded + '</span>';
    html += '<span style="color:#ff5555">-' + totalRemoved + '</span>';
    html += '</div>';
    if (DIFF_ANALYSIS_DATA && DIFF_ANALYSIS_DATA.summary) {
      html += '<div class="diff-review-summary">' + _escHtml(DIFF_ANALYSIS_DATA.summary) + '</div>';
    }
    html += '</div>';

    // File cards
    files.forEach((f, fi) => {
      const summary = _fileSummary(f.file);
      html += '<div class="diff-file-card expanded" data-file="' + _escAttr(f.file) + '">';

      // Header
      html += '<div class="diff-file-header" data-file-idx="' + fi + '">';
      html += '<span class="diff-file-chevron">\u25B6</span>';
      html += '<span class="diff-file-name">' + _escHtml(f.file || f.oldFile || '(unknown)') + '</span>';
      html += '<div class="diff-file-badges">';
      if (f.linesAdded > 0) html += '<span class="diff-file-badge added-count">+' + f.linesAdded + '</span>';
      if (f.linesRemoved > 0) html += '<span class="diff-file-badge removed-count">-' + f.linesRemoved + '</span>';
      html += _fileTypeBadge(f);
      html += '</div>';
      html += '</div>';

      // Summary line (from AI analysis)
      html += '<div class="diff-file-summary' + (summary ? ' has-summary' : '') + '">';
      if (summary) html += _escHtml(summary);
      html += '</div>';

      // Body
      const ext = _fileExt(f.file);
      html += '<div class="diff-file-body">';
      if (f.isBinary) {
        html += '<div style="padding:12px 14px;color:var(--text-muted);font-size:12px;font-style:italic">Binary file</div>';
      } else {
        f.hunks.forEach(h => {
          html += '<div class="diff-hunk-header">' + _escHtml(h.header) + '</div>';
          h.lines.forEach(l => {
            const cls = l.type === 'add' ? 'diff-line-add' : l.type === 'del' ? 'diff-line-del' : 'diff-line-ctx';
            const marker = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
            const oldNum = l.oldNum !== null ? l.oldNum : '';
            const newNum = l.newNum !== null ? l.newNum : '';
            html += '<div class="diff-line ' + cls + '">';
            html += '<div class="diff-line-gutter"><span>' + oldNum + '</span><span>' + newNum + '</span></div>';
            html += '<div class="diff-line-content"><span class="diff-line-marker">' + marker + '</span> ' + _highlightLine(l.content, ext) + '</div>';
            html += '</div>';
          });
        });
      }
      html += '</div>'; // .diff-file-body
      html += '</div>'; // .diff-file-card
    });

    html += '</div>'; // .diff-review-inner
    _reviewScroll.innerHTML = html;

    // Wire collapse/expand
    _reviewScroll.querySelectorAll('.diff-file-header').forEach(hdr => {
      hdr.addEventListener('click', () => {
        hdr.closest('.diff-file-card').classList.toggle('expanded');
      });
    });

    // Build file tree
    _renderFileTree(files);

    // Track scroll position to highlight active file in tree
    _wireScrollTracker();

    _codeReviewRendered = true;
  }

  // ---- File tree ----
  function _buildTree(files) {
    // Build a nested directory tree from flat file paths
    const root = { name: '', children: {}, files: [] };
    files.forEach(f => {
      const path = f.file || f.oldFile || '';
      const parts = path.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const dir = parts[i];
        if (!node.children[dir]) {
          node.children[dir] = { name: dir, children: {}, files: [] };
        }
        node = node.children[dir];
      }
      node.files.push({ name: parts[parts.length - 1], fullPath: path, data: f });
    });
    return root;
  }

  function _renderTreeNode(node, depth) {
    let html = '';
    const indent = 8 + depth * 14;

    // Sort directories first, then files
    const dirs = Object.keys(node.children).sort();
    const fileList = node.files.sort((a, b) => a.name.localeCompare(b.name));

    dirs.forEach(dirName => {
      const child = node.children[dirName];
      html += '<div class="diff-tree-dir" style="padding-left:' + indent + 'px">';
      html += '<span class="diff-tree-chevron">\u25BC</span>';
      html += '<span class="diff-tree-dir-icon">\u25A0</span>';
      html += '<span>' + _escHtml(dirName) + '</span>';
      html += '</div>';
      html += '<div class="diff-tree-children">';
      html += _renderTreeNode(child, depth + 1);
      html += '</div>';
    });

    fileList.forEach(f => {
      const iconMap = { 'cc': '\u2022', 'hh': '\u25E6', 'py': '\u2022', 'g': '\u2022' };
      const ext = _fileExt(f.fullPath);
      const icon = iconMap[ext] || '\u2022';
      html += '<div class="diff-tree-file" data-file="' + _escAttr(f.fullPath) + '" style="padding-left:' + (indent + 4) + 'px">';
      html += '<span class="diff-tree-icon">' + icon + '</span>';
      html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis">' + _escHtml(f.name) + '</span>';
      if (f.data.linesAdded > 0) html += '<span class="diff-tree-badge added">+' + f.data.linesAdded + '</span>';
      if (f.data.linesRemoved > 0) html += '<span class="diff-tree-badge removed">-' + f.data.linesRemoved + '</span>';
      html += '</div>';
    });

    return html;
  }

  // Collapse single-child directory chains for cleaner presentation
  function _collapseTree(node) {
    // Recursively collapse first
    Object.keys(node.children).forEach(k => _collapseTree(node.children[k]));

    // If this node has exactly one child dir and no files, merge them
    const dirs = Object.keys(node.children);
    if (dirs.length === 1 && node.files.length === 0) {
      const childKey = dirs[0];
      const child = node.children[childKey];
      const newName = node.name ? node.name + '/' + child.name : child.name;
      node.name = newName;
      node.children = child.children;
      node.files = child.files;
    }
  }

  function _renderFileTree(files) {
    if (!_fileTreeEl) return;

    const tree = _buildTree(files);
    // Collapse single-child chains at root level
    Object.keys(tree.children).forEach(k => _collapseTree(tree.children[k]));

    let html = '<div class="diff-file-tree-title">Files (' + files.length + ')</div>';
    html += _renderTreeNode(tree, 0);
    _fileTreeEl.innerHTML = html;

    // Wire directory toggle
    _fileTreeEl.querySelectorAll('.diff-tree-dir').forEach(dir => {
      dir.addEventListener('click', () => {
        dir.classList.toggle('collapsed');
      });
    });

    // Wire file click — scroll to file card
    _fileTreeEl.querySelectorAll('.diff-tree-file').forEach(item => {
      item.addEventListener('click', () => {
        const filePath = item.getAttribute('data-file');
        if (!_reviewScroll) return;
        const card = _reviewScroll.querySelector('.diff-file-card[data-file="' + CSS.escape(filePath) + '"]');
        if (card) {
          // Expand if collapsed
          if (!card.classList.contains('expanded')) card.classList.add('expanded');
          card.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
        // Highlight in tree
        _fileTreeEl.querySelectorAll('.diff-tree-file').forEach(f => f.classList.remove('active'));
        item.classList.add('active');
      });
    });
  }

  // ---- Scroll tracking: highlight active file in tree ----
  let _scrollRAF = null;
  function _wireScrollTracker() {
    if (!_reviewScroll || !_fileTreeEl) return;
    _reviewScroll.addEventListener('scroll', () => {
      if (_scrollRAF) return;
      _scrollRAF = requestAnimationFrame(() => {
        _scrollRAF = null;
        _updateActiveTreeFile();
      });
    });
  }

  function _updateActiveTreeFile() {
    if (!_reviewScroll || !_fileTreeEl) return;
    const cards = _reviewScroll.querySelectorAll('.diff-file-card');
    const scrollTop = _reviewScroll.scrollTop;
    const viewMid = scrollTop + _reviewScroll.clientHeight * 0.3;
    let closest = null;
    let closestDist = Infinity;

    cards.forEach(card => {
      const dist = Math.abs(card.offsetTop - viewMid);
      if (dist < closestDist) {
        closestDist = dist;
        closest = card;
      }
    });

    if (!closest) return;
    const activeFile = closest.getAttribute('data-file');
    const treeItems = _fileTreeEl.querySelectorAll('.diff-tree-file');
    treeItems.forEach(item => {
      const isActive = item.getAttribute('data-file') === activeFile;
      item.classList.toggle('active', isActive);
      // Scroll tree item into view if needed
      if (isActive) {
        const treeRect = _fileTreeEl.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        if (itemRect.top < treeRect.top || itemRect.bottom > treeRect.bottom) {
          item.scrollIntoView({ block: 'nearest' });
        }
      }
    });
  }

  // ---- Navigate to code review for a specific node's files ----
  function _goToCodeForNode(d) {
    if (!d || !d.files || d.files.length === 0) return;
    // Save current graph state so we can restore on switch-back
    _savedGraphState = {
      level: activeLevel,
      selectedNode: _selectedNode,
      transform: d3.zoomTransform(svg.node())
    };
    // Switch to code review mode
    _showCodeReview();
    // Ensure code review is rendered before manipulating cards
    if (!_reviewScroll) return;
    const cards = _reviewScroll.querySelectorAll('.diff-file-card');
    const nodeFiles = new Set(d.files.map(f => f.toLowerCase()));
    // Clear any previous search styling
    cards.forEach(c => c.classList.remove('search-hidden', 'search-match'));
    if (_fileTreeEl) _fileTreeEl.querySelectorAll('.diff-tree-file').forEach(f => f.classList.remove('search-hidden'));
    // Find the first matching card and scroll to it
    let firstMatch = null;
    cards.forEach(c => {
      const fp = (c.getAttribute('data-file') || '').toLowerCase();
      if (nodeFiles.has(fp)) {
        c.classList.add('search-match');
        if (!c.classList.contains('expanded')) c.classList.add('expanded');
        if (!firstMatch) firstMatch = c;
      }
    });
    if (firstMatch) {
      firstMatch.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  }

  // ---- Show/hide code review container ----
  function _showCodeReview() {
    _codeReviewMode = true;
    svg.style('display', 'none');
    if (_reviewContainer) _reviewContainer.classList.add('visible');
    _hideInfoPanel();
    if (!_codeReviewRendered) _renderCodeReview();
    _updateModeButtons();
  }

  function _hideCodeReview() {
    _codeReviewMode = false;
    if (_reviewContainer) _reviewContainer.classList.remove('visible');
    _updateModeButtons();
  }

  // ---- Code review search ----
  function _searchCodeReview(q) {
    if (!_reviewScroll) return;
    const cards = _reviewScroll.querySelectorAll('.diff-file-card');
    if (!q) {
      cards.forEach(c => { c.classList.remove('search-hidden', 'search-match'); });
      // Also clear tree highlight
      if (_fileTreeEl) _fileTreeEl.querySelectorAll('.diff-tree-file').forEach(f => f.classList.remove('search-hidden'));
      return;
    }
    cards.forEach(c => {
      const fname = (c.getAttribute('data-file') || '').toLowerCase().replace(/[_ ]/g, '');
      if (fname.includes(q)) {
        c.classList.remove('search-hidden');
        c.classList.add('search-match');
      } else {
        c.classList.add('search-hidden');
        c.classList.remove('search-match');
      }
    });
    // Also filter tree items
    if (_fileTreeEl) {
      _fileTreeEl.querySelectorAll('.diff-tree-file').forEach(f => {
        const fname = (f.getAttribute('data-file') || '').toLowerCase().replace(/[_ ]/g, '');
        f.classList.toggle('search-hidden', !fname.includes(q));
      });
    }
  }

  function _searchSelectCodeReview(q) {
    if (!_reviewScroll) return false;
    const cards = _reviewScroll.querySelectorAll('.diff-file-card');
    const matches = [];
    cards.forEach(c => {
      const fname = (c.getAttribute('data-file') || '').toLowerCase().replace(/[_ ]/g, '');
      if (fname.includes(q)) matches.push(c);
    });
    if (matches.length === 1) {
      // Clear search styling, scroll to match, expand it
      cards.forEach(c => c.classList.remove('search-hidden', 'search-match'));
      matches[0].classList.add('expanded');
      matches[0].scrollIntoView({ behavior: 'instant', block: 'start' });
      return true;
    }
    return false;
  }

  function switchLevel(level) {
    if (level === 'code-review') {
      _showCodeReview();
      return;
    }
    if (!LEVELS.includes(level)) return;
    // Leaving code-review mode — restore graph
    const wasCodeReview = _codeReviewMode;
    if (_codeReviewMode) {
      _hideCodeReview();
      svg.style('display', null);
    }
    // If returning to the same level we left from, restore saved state
    if (wasCodeReview && _savedGraphState && _savedGraphState.level === level) {
      activeLevel = level;
      _selectedNode = _savedGraphState.selectedNode;
      _updateModeButtons();
      render();
      // Restore saved zoom/pan transform instead of auto-fit
      svg.call(_zoom.transform, _savedGraphState.transform);
      // Re-select the node if one was selected
      if (_selectedNode) {
        const nd = _currentNodes.find(n => n.id === _selectedNode);
        if (nd) {
          _highlightNode(nd);
          _showNodeInfo(nd);
        }
      }
      _savedGraphState = null;
      return;
    }
    _savedGraphState = null;
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

  // ---- Syntax highlighting (regex-based, C++ / Python aware) ----
  const _SYN_CPP_KW = new Set([
    'auto','break','case','catch','class','const','constexpr','continue',
    'default','delete','do','else','enum','explicit','export','extern',
    'false','final','for','friend','goto','if','inline','mutable',
    'namespace','new','noexcept','nullptr','operator','override','private',
    'protected','public','register','return','sizeof','static','static_assert',
    'static_cast','dynamic_cast','reinterpret_cast','const_cast',
    'struct','switch','template','this','throw','true','try','typedef',
    'typeid','typename','union','using','virtual','void','volatile','while',
    'co_await','co_return','co_yield','concept','requires','consteval','constinit',
    // Python keywords
    'def','import','from','as','with','yield','lambda','pass','raise',
    'assert','except','finally','global','nonlocal','in','is','not','and','or',
    'elif','None','True','False','self','cls','async','await',
  ]);
  const _SYN_CPP_TYPES = new Set([
    'int','long','short','char','float','double','bool','unsigned','signed',
    'size_t','uint8_t','uint16_t','uint32_t','uint64_t','int8_t','int16_t',
    'int32_t','int64_t','string','wstring','vector','map','set','list',
    'pair','tuple','shared_ptr','unique_ptr','weak_ptr','optional','variant',
    'future','promise','function','sstring','bytes','bytes_view',
    'seastar','noncopyable_function','lw_shared_ptr','foreign_ptr',
  ]);
  // Regex: order matters — first match wins
  const _SYN_RULES = [
    // Line comments
    { re: /\/\/.*$/,                  cls: 'syn-cmt' },
    // Block comment fragments (single-line portion)
    { re: /\/\*.*?\*\//,             cls: 'syn-cmt' },
    { re: /\/\*.*/,                   cls: 'syn-cmt' },
    { re: /.*?\*\//,                  cls: 'syn-cmt' },
    // Python comments
    { re: /#.*$/,                     cls: 'syn-cmt' },
    // Preprocessor directives
    { re: /^#\s*(?:include|define|undef|ifdef|ifndef|if|elif|else|endif|pragma|error|warning)\b.*/,
                                      cls: 'syn-pp' },
    // Strings (double and single quoted)
    { re: /"(?:[^"\\]|\\.)*"/,       cls: 'syn-str' },
    { re: /'(?:[^'\\]|\\.)*'/,       cls: 'syn-str' },
    // Raw strings  R"(...)"
    { re: /R"[^"]*\([^)]*\)[^"]*"/,  cls: 'syn-str' },
    // Numbers (hex, float, int)
    { re: /\b0[xX][0-9a-fA-F]+[uUlL]*\b/, cls: 'syn-num' },
    { re: /\b\d+\.?\d*(?:[eE][+-]?\d+)?[fFlLuU]*\b/, cls: 'syn-num' },
    // Decorators (Python)
    { re: /@\w+/,                     cls: 'syn-ns' },
    // Namespace qualifiers  foo::
    { re: /\b[a-zA-Z_]\w*(?=::)/,    cls: 'syn-ns' },
    // Function calls  foo(
    { re: /\b[a-zA-Z_]\w*(?=\s*\()/,  cls: null },  // handled specially
    // Identifiers (keywords / types checked in handler)
    { re: /\b[a-zA-Z_]\w*\b/,         cls: null },  // handled specially
  ];

  function _highlightLine(raw, fileExt) {
    // Escape the entire line first, then highlight within escaped text
    const esc = _escHtml(raw);
    const tokens = [];
    let remaining = esc;
    let pos = 0;

    // We work on the escaped HTML string — regexes below are adapted
    // Build a combined regex that tokenizes the escaped line
    // Strategy: scan character by character using simpler heuristics on escaped text

    // Simpler approach: tokenize the RAW text, build spans, escape each token
    const out = [];
    let i = 0;
    const src = raw;
    const len = src.length;

    while (i < len) {
      let matched = false;

      // Line comment //
      if (src[i] === '/' && src[i+1] === '/') {
        out.push('<span class="syn-cmt">' + _escHtml(src.slice(i)) + '</span>');
        i = len; matched = true;
      }
      // Block comment start /*
      else if (src[i] === '/' && src[i+1] === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end >= 0) {
          out.push('<span class="syn-cmt">' + _escHtml(src.slice(i, end + 2)) + '</span>');
          i = end + 2;
        } else {
          out.push('<span class="syn-cmt">' + _escHtml(src.slice(i)) + '</span>');
          i = len;
        }
        matched = true;
      }
      // Python comment #  (only for .py files, not preprocessor)
      else if (src[i] === '#' && (fileExt === 'py')) {
        out.push('<span class="syn-cmt">' + _escHtml(src.slice(i)) + '</span>');
        i = len; matched = true;
      }
      // Preprocessor #include, #define etc (C++)
      else if (src[i] === '#' && fileExt !== 'py') {
        const ppMatch = src.slice(i).match(/^#\s*(?:include|define|undef|ifdef|ifndef|if|elif|else|endif|pragma|error|warning)\b.*/);
        if (ppMatch) {
          out.push('<span class="syn-pp">' + _escHtml(ppMatch[0]) + '</span>');
          i += ppMatch[0].length; matched = true;
        }
      }
      // Double-quoted string
      else if (src[i] === '"') {
        let j = i + 1;
        while (j < len && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
        if (j < len) j++; // include closing quote
        out.push('<span class="syn-str">' + _escHtml(src.slice(i, j)) + '</span>');
        i = j; matched = true;
      }
      // Single-quoted string/char
      else if (src[i] === '\'') {
        let j = i + 1;
        while (j < len && src[j] !== '\'') { if (src[j] === '\\') j++; j++; }
        if (j < len) j++;
        out.push('<span class="syn-str">' + _escHtml(src.slice(i, j)) + '</span>');
        i = j; matched = true;
      }
      // Raw string R"..."
      else if (src[i] === 'R' && src[i+1] === '"') {
        const rEnd = src.indexOf(')"', i + 2);
        if (rEnd >= 0) {
          out.push('<span class="syn-str">' + _escHtml(src.slice(i, rEnd + 2)) + '</span>');
          i = rEnd + 2;
        } else {
          out.push('<span class="syn-str">' + _escHtml(src.slice(i)) + '</span>');
          i = len;
        }
        matched = true;
      }
      // Decorator @foo (Python)
      else if (src[i] === '@' && fileExt === 'py') {
        const dm = src.slice(i).match(/^@\w+/);
        if (dm) {
          out.push('<span class="syn-ns">' + _escHtml(dm[0]) + '</span>');
          i += dm[0].length; matched = true;
        }
      }
      // Number (hex, float, int)
      else if (/\d/.test(src[i]) || (src[i] === '.' && i + 1 < len && /\d/.test(src[i+1]))) {
        const nm = src.slice(i).match(/^(?:0[xX][0-9a-fA-F]+[uUlL]*|\d+\.?\d*(?:[eE][+-]?\d+)?[fFlLuU]*)/);
        if (nm) {
          out.push('<span class="syn-num">' + _escHtml(nm[0]) + '</span>');
          i += nm[0].length; matched = true;
        }
      }
      // Identifier / keyword / type / function
      else if (/[a-zA-Z_]/.test(src[i])) {
        const wm = src.slice(i).match(/^[a-zA-Z_]\w*/);
        if (wm) {
          const word = wm[0];
          const after = src[i + word.length];
          const afterTwo = src.slice(i + word.length, i + word.length + 2);
          if (_SYN_CPP_KW.has(word)) {
            out.push('<span class="syn-kw">' + _escHtml(word) + '</span>');
          } else if (_SYN_CPP_TYPES.has(word)) {
            out.push('<span class="syn-type">' + _escHtml(word) + '</span>');
          } else if (afterTwo === '::') {
            out.push('<span class="syn-ns">' + _escHtml(word) + '</span>');
          } else if (after === '(') {
            out.push('<span class="syn-fn">' + _escHtml(word) + '</span>');
          } else {
            out.push(_escHtml(word));
          }
          i += word.length; matched = true;
        }
      }

      if (!matched) {
        // Emit single character (escaped)
        out.push(_escHtml(src[i]));
        i++;
      }
    }

    return out.join('');
  }

  function _fileExt(filename) {
    if (!filename) return '';
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
  }

  // ---- Keyboard handler (when diff graph is active) ----
  function _onKeyDown(e) {
    if (!_active) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 'Escape') {
      if (_codeReviewMode) return; // no Escape behavior in code review
      if (_selectedNode) {
        _selectedNode = null;
        _resetHighlight();
        _showOverviewPanel();
      } else {
        _hideInfoPanel();
      }
      return;
    }

    // 1/2/3 to switch levels
    if (e.key === '1') switchLevel('peering_service');
    if (e.key === '2') switchLevel('class');
    if (e.key === '3') switchLevel('code-review');
  }
  document.addEventListener('keydown', _onKeyDown);

  // ---- Search support ----
  function _searchNorm(s) { return s.toLowerCase().replace(/[_ ]/g, ''); }

  function search(q) {
    if (_codeReviewMode) { _searchCodeReview(q); return; }
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
    if (_codeReviewMode) return _searchSelectCodeReview(q);
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
    if (_codeReviewMode) {
      svg.style('display', 'none');
      if (_reviewContainer) _reviewContainer.classList.add('visible');
      if (!_codeReviewRendered) _renderCodeReview();
    } else {
      svg.style('display', null);
      render();
    }
  }

  function deactivate() {
    _active = false;
    _selectedNode = null;
    _hideInfoPanel();
    svg.style('display', 'none');
    if (_reviewContainer) _reviewContainer.classList.remove('visible');
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
    if (_active && !_codeReviewMode) render();
  });

})();
