/**
 * API Trace Studio - Client Application
 */
(function () {
  'use strict';

  // State
  let currentPage = 1;
  let totalPages = 1;
  let isStreamPaused = false;
  let eventSource = null;
  let activeTraceRecord = null;
  let pollingTimer = null;

  // Auto-detect base API URL (e.g. '/logs' or custom mount path)
  const currentPath = window.location.pathname.replace(/\/+$/, '');
  const baseUrl = currentPath.endsWith('/index.html')
    ? currentPath.slice(0, -11)
    : currentPath;

  // DOM Elements
  const elServiceBadge = document.getElementById('service-badge');
  const elEnvBadge = document.getElementById('env-badge');
  const elLiveIndicator = document.getElementById('live-indicator');
  const btnPauseStream = document.getElementById('btn-pause-stream');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnTheme = document.getElementById('btn-theme');
  const btnExportJson = document.getElementById('btn-export-json');
  const btnExportCsv = document.getElementById('btn-export-csv');

  // Tabs
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  // Filters
  const filterSearch = document.getElementById('filter-search');
  const filterMethod = document.getElementById('filter-method');
  const filterStatus = document.getElementById('filter-status');
  const filterLevel = document.getElementById('filter-level');
  const filterSlow = document.getElementById('filter-slow');
  const filterError = document.getElementById('filter-error');
  const btnApplyFilters = document.getElementById('btn-apply-filters');
  const btnClearFilters = document.getElementById('btn-clear-filters');

  // Pagination
  const btnPrevPage = document.getElementById('btn-prev-page');
  const btnNextPage = document.getElementById('btn-next-page');
  const paginationInfo = document.getElementById('pagination-info');
  const paginationPageDisplay = document.getElementById('pagination-page-display');

  // Tables
  const requestsTbody = document.getElementById('requests-tbody');
  const overviewSlowTbody = document.getElementById('overview-slow-tbody');
  const overviewErrorsTbody = document.getElementById('overview-errors-tbody');
  const slowApiTbody = document.getElementById('slow-api-tbody');
  const errorsTbody = document.getElementById('errors-tbody');

  // Live Stream
  const streamContainer = document.getElementById('stream-logs-container');
  const streamAutoscroll = document.getElementById('stream-autoscroll');
  const btnClearStream = document.getElementById('btn-clear-stream');

  // Drawer
  const drawer = document.getElementById('trace-drawer');
  const drawerOverlay = document.getElementById('drawer-overlay');
  const btnCloseDrawer = document.getElementById('btn-close-drawer');
  const drawerTabs = document.querySelectorAll('.drawer-tab-btn');
  const drawerPanels = document.querySelectorAll('.drawer-panel');

  // Helper: Escape HTML
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Theme Management
  function initTheme() {
    const savedTheme = localStorage.getItem('api_trace_theme') || 'theme-dark';
    document.body.className = savedTheme;
  }

  btnTheme.addEventListener('click', () => {
    const isDark = document.body.classList.contains('theme-dark');
    const newTheme = isDark ? 'theme-light' : 'theme-dark';
    document.body.className = newTheme;
    localStorage.setItem('api_trace_theme', newTheme);
  });

  // Tab Navigation
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'));
      tabPanels.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add('active');

      if (targetId === 'tab-requests') {
        fetchRequests();
      } else if (targetId === 'tab-overview') {
        fetchStats();
      } else if (targetId === 'tab-slow') {
        fetchStats();
      } else if (targetId === 'tab-errors') {
        fetchStats();
      }
    });
  });

  // Drawer Tab Navigation
  drawerTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      drawerTabs.forEach((b) => b.classList.remove('active'));
      drawerPanels.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-drawer-tab');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  function closeDrawer() {
    drawer.classList.remove('active');
    drawerOverlay.classList.remove('active');
    activeTraceRecord = null;
  }

  btnCloseDrawer.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  // Formatting helpers
  function getMethodBadge(method) {
    const m = (method || 'GET').toUpperCase();
    const cls = `badge-method badge-method-${m.toLowerCase()}`;
    return `<span class="${cls}">${escapeHtml(m)}</span>`;
  }

  function getStatusBadge(status) {
    if (!status) return `<span class="badge-status">-</span>`;
    const s = parseInt(status, 10);
    let cls = 'badge-status badge-status-2xx';
    if (s >= 500) cls = 'badge-status badge-status-5xx';
    else if (s >= 400) cls = 'badge-status badge-status-4xx';
    else if (s >= 300) cls = 'badge-status badge-status-3xx';
    return `<span class="${cls}">${s}</span>`;
  }

  function getDurationBadge(durationMs) {
    if (durationMs === undefined || durationMs === null) return '-';
    let cls = 'badge-latency-fast';
    if (durationMs >= 1000) cls = 'badge-latency-slow';
    else if (durationMs >= 300) cls = 'badge-latency-warn';
    return `<span class="badge-latency ${cls}">${durationMs.toFixed(1)} ms</span>`;
  }

  function formatTimestamp(isoStr) {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    } catch {
      return isoStr;
    }
  }

  // Fetch System Stats & Overview
  async function fetchStats() {
    try {
      const res = await fetch(`${baseUrl}/api/stats`);
      if (!res.ok) return;
      const stats = await res.json();

      // Badges
      if (stats.serviceName) elServiceBadge.textContent = `service: ${stats.serviceName}`;
      if (stats.environment) elEnvBadge.textContent = `env: ${stats.environment}`;

      // Cards
      document.getElementById('metric-total-requests').textContent = stats.totalRequests || 0;
      document.getElementById('metric-rpm').textContent = `${stats.requestsPerMinute || 0} req/min`;
      document.getElementById('metric-error-rate').textContent = `${(stats.errorRate || 0).toFixed(1)}%`;
      document.getElementById('metric-error-count').textContent = `${stats.errorCount || 0} errors`;
      document.getElementById('metric-avg-latency').textContent = `${(stats.avgDurationMs || 0).toFixed(1)} ms`;
      document.getElementById('metric-p50').textContent = `${(stats.p50DurationMs || 0).toFixed(1)} ms`;
      document.getElementById('metric-p95-latency').textContent = `${(stats.p95DurationMs || 0).toFixed(1)} ms`;
      document.getElementById('metric-p99').textContent = `${(stats.p99DurationMs || 0).toFixed(1)} ms`;
      document.getElementById('metric-slow-count').textContent = stats.slowCount || 0;
      document.getElementById('metric-slow-rate').textContent = `${(stats.slowRate || 0).toFixed(1)}%`;

      // Status Bar
      renderStatusDistribution(stats.statusCodeDistribution || {}, stats.totalRequests || 0);

      // Top Slow Routes
      renderTopSlowRoutes(stats.topSlowRoutes || []);

      // Top Errors
      renderTopErrors(stats.topErrors || []);
    } catch (err) {
      console.warn('Failed to fetch stats:', err);
    }
  }

  function renderStatusDistribution(dist, total) {
    const bar = document.getElementById('status-distribution-bar');
    const legend = document.getElementById('status-distribution-legend');
    bar.innerHTML = '';
    legend.innerHTML = '';

    if (total === 0) {
      bar.innerHTML = '<div style="width:100%; height:100%; background:var(--bg-tertiary);"></div>';
      legend.innerHTML = '<span class="text-muted">No requests recorded yet</span>';
      return;
    }

    const groups = {
      '2xx': { count: 0, color: '#10b981', label: '2xx Success' },
      '3xx': { count: 0, color: '#06b6d4', label: '3xx Redirect' },
      '4xx': { count: 0, color: '#f59e0b', label: '4xx Client Err' },
      '5xx': { count: 0, color: '#ef4444', label: '5xx Server Err' },
    };

    for (const [code, count] of Object.entries(dist)) {
      const c = parseInt(code, 10);
      if (c >= 200 && c < 300) groups['2xx'].count += count;
      else if (c >= 300 && c < 400) groups['3xx'].count += count;
      else if (c >= 400 && c < 500) groups['4xx'].count += count;
      else if (c >= 500) groups['5xx'].count += count;
    }

    for (const [key, group] of Object.entries(groups)) {
      if (group.count > 0) {
        const pct = (group.count / total) * 100;
        const seg = document.createElement('div');
        seg.className = 'status-segment';
        seg.style.width = `${pct}%`;
        seg.style.backgroundColor = group.color;
        seg.title = `${group.label}: ${group.count} (${pct.toFixed(1)}%)`;
        bar.appendChild(seg);

        const leg = document.createElement('div');
        leg.className = 'legend-item';
        leg.innerHTML = `<span class="legend-color" style="background:${group.color}"></span><span>${group.label}: <strong>${group.count}</strong></span>`;
        legend.appendChild(leg);
      }
    }
  }

  function renderTopSlowRoutes(slowRoutes) {
    if (slowRoutes.length === 0) {
      overviewSlowTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No slow routes recorded</td></tr>';
      slowApiTbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No slow routes detected</td></tr>';
      return;
    }

    let ovHtml = '';
    let slowTabHtml = '';

    for (const r of slowRoutes) {
      ovHtml += `
        <tr>
          <td>${getMethodBadge(r.method)}</td>
          <td><code>${escapeHtml(r.route)}</code></td>
          <td>${r.count}</td>
          <td>${getDurationBadge(r.avgDurationMs)}</td>
          <td>${getDurationBadge(r.maxDurationMs)}</td>
        </tr>
      `;

      slowTabHtml += `
        <tr>
          <td>${getMethodBadge(r.method)}</td>
          <td><code>${escapeHtml(r.route)}</code></td>
          <td><strong>${r.count}</strong></td>
          <td>${getDurationBadge(r.avgDurationMs)}</td>
          <td>${getDurationBadge(r.minDurationMs)}</td>
          <td>${getDurationBadge(r.maxDurationMs)}</td>
          <td><span class="badge badge-latency-slow">Slow Threshold Exceeded</span></td>
        </tr>
      `;
    }

    overviewSlowTbody.innerHTML = ovHtml;
    slowApiTbody.innerHTML = slowTabHtml;
  }

  function renderTopErrors(errors) {
    if (errors.length === 0) {
      overviewErrorsTbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No errors recorded</td></tr>';
      errorsTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No exceptions recorded</td></tr>';
      return;
    }

    let ovHtml = '';
    let errTabHtml = '';

    for (const e of errors) {
      ovHtml += `
        <tr>
          <td><span class="text-danger font-weight-bold">${escapeHtml(e.name)}</span></td>
          <td><code>${escapeHtml(e.message)}</code></td>
          <td><strong>${e.count}</strong></td>
          <td>${formatTimestamp(e.lastSeen)}</td>
        </tr>
      `;

      errTabHtml += `
        <tr>
          <td><span class="text-danger font-weight-bold">${escapeHtml(e.name)}</span></td>
          <td><code>${escapeHtml(e.message)}</code></td>
          <td><strong>${e.count}</strong></td>
          <td>${formatTimestamp(e.firstSeen)}</td>
          <td>${formatTimestamp(e.lastSeen)}</td>
          <td><code>${escapeHtml(e.sampleTraceId || '-')}</code></td>
        </tr>
      `;
    }

    overviewErrorsTbody.innerHTML = ovHtml;
    errorsTbody.innerHTML = errTabHtml;
  }

  // Fetch Requests Table
  async function fetchRequests() {
    try {
      const params = new URLSearchParams();
      params.set('page', String(currentPage));
      params.set('limit', '25');

      if (filterSearch.value.trim()) params.set('search', filterSearch.value.trim());
      if (filterMethod.value) params.set('method', filterMethod.value);
      if (filterStatus.value) params.set('status', filterStatus.value);
      if (filterLevel.value) params.set('level', filterLevel.value);
      if (filterSlow.checked) params.set('isSlow', 'true');
      if (filterError.checked) params.set('isError', 'true');

      const res = await fetch(`${baseUrl}/api/logs?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();

      totalPages = data.totalPages || 1;
      paginationInfo.textContent = `Showing ${(data.page - 1) * data.limit + (data.records.length > 0 ? 1 : 0)}-${(data.page - 1) * data.limit + data.records.length} of ${data.total}`;
      paginationPageDisplay.textContent = `Page ${data.page} of ${totalPages}`;

      btnPrevPage.disabled = data.page <= 1;
      btnNextPage.disabled = data.page >= totalPages;

      renderRequestsTable(data.records || []);
    } catch (err) {
      console.warn('Failed to fetch requests:', err);
    }
  }

  function renderRequestsTable(records) {
    if (records.length === 0) {
      requestsTbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No requests matched current filters</td></tr>';
      return;
    }

    let html = '';
    records.forEach((rec, idx) => {
      html += `
        <tr class="clickable" data-index="${idx}">
          <td>${getMethodBadge(rec.method)}</td>
          <td>${getStatusBadge(rec.statusCode)}</td>
          <td><code>${escapeHtml(rec.route || rec.url || '/')}</code></td>
          <td>${getDurationBadge(rec.durationMs)}</td>
          <td class="text-muted">${escapeHtml(rec.clientIp || '-')}</td>
          <td class="text-muted">${formatTimestamp(rec.timestamp)}</td>
          <td><button class="btn btn-secondary btn-sm" onclick="window.viewTrace(${idx})">Inspect</button></td>
        </tr>
      `;
    });

    requestsTbody.innerHTML = html;

    // Attach click handlers
    window._currentRecords = records;
  }

  window.viewTrace = function (idx) {
    const rec = window._currentRecords ? window._currentRecords[idx] : null;
    if (rec) {
      openTraceDrawer(rec);
    }
  };

  // Open Trace Slide-out Drawer
  function openTraceDrawer(rec) {
    activeTraceRecord = rec;

    document.getElementById('drawer-title').textContent = `${rec.method || 'REQ'} ${rec.route || rec.url || '/'}`;
    document.getElementById('drawer-subtitle').textContent = `Trace ID: ${rec.traceId || '-'} | Request ID: ${rec.requestId || '-'}`;

    // Render Waterfall
    renderWaterfall(rec);

    // Render Overview Details
    renderOverviewDetails(rec);

    // Render Headers
    renderHeaders(rec.headers || {});

    // Render Body & Query
    renderBodyAndQuery(rec);

    // Render Error
    renderErrorDetails(rec.error);

    drawer.classList.add('active');
    drawerOverlay.classList.add('active');
  }

  function renderWaterfall(rec) {
    const container = document.getElementById('waterfall-container');
    const spans = rec.spans || [];
    const totalDuration = Math.max(1, rec.durationMs || 1);

    let html = `
      <div class="waterfall-header">
        <span>Operation / Span</span>
        <span>Duration: <strong>${totalDuration.toFixed(1)} ms</strong></span>
      </div>
      <div class="waterfall-list">
        <div class="waterfall-item">
          <div class="waterfall-label" title="${escapeHtml(rec.method)} ${escapeHtml(rec.url)}">
            🌐 ${escapeHtml(rec.method)} ${escapeHtml(rec.route || rec.url)}
          </div>
          <div class="waterfall-bar-area">
            <div class="waterfall-bar" style="left: 0%; width: 100%;">
              ${totalDuration.toFixed(1)} ms
            </div>
          </div>
        </div>
    `;

    if (spans.length === 0) {
      html += `
        <div class="text-muted text-center mt-4">
          No internal child spans recorded for this request.
          <br><small>Wrap functions with <code>traceFunction</code>, <code>traceAsync</code>, or instrument database/HTTP.</small>
        </div>
      `;
    } else {
      const rootStart = new Date(rec.timestamp).getTime();

      for (const span of spans) {
        const spanStart = span.startTimeMs || rootStart;
        const offsetMs = Math.max(0, spanStart - rootStart);
        const spanDur = Math.max(0.1, span.durationMs || 0.1);

        const leftPct = Math.min(95, (offsetMs / totalDuration) * 100);
        const widthPct = Math.max(2, Math.min(100 - leftPct, (spanDur / totalDuration) * 100));

        let barClass = 'waterfall-bar';
        let icon = '⚡';
        if (span.kind === 'client' && span.name.startsWith('HTTP')) {
          barClass += ' bar-client';
          icon = '🌐';
        } else if (span.name.startsWith('DB')) {
          barClass += ' bar-db';
          icon = '🗄️';
        }
        if (span.status === 'error') {
          barClass += ' bar-error';
          icon = '⚠️';
        }

        html += `
          <div class="waterfall-item">
            <div class="waterfall-label" title="${escapeHtml(span.name)}">
              ${icon} ${escapeHtml(span.name)}
            </div>
            <div class="waterfall-bar-area">
              <div class="${barClass}" style="left: ${leftPct.toFixed(1)}%; width: ${widthPct.toFixed(1)}%;">
                ${spanDur.toFixed(1)} ms
              </div>
            </div>
          </div>
        `;
      }
    }

    html += `</div>`;
    container.innerHTML = html;
  }

  function renderOverviewDetails(rec) {
    const el = document.getElementById('drawer-overview-details');
    el.innerHTML = `
      <table class="data-table">
        <tbody>
          <tr><th>Status Code</th><td>${getStatusBadge(rec.statusCode)}</td></tr>
          <tr><th>Duration</th><td>${getDurationBadge(rec.durationMs)}</td></tr>
          <tr><th>Timestamp</th><td>${escapeHtml(rec.timestamp)}</td></tr>
          <tr><th>Full URL</th><td><code>${escapeHtml(rec.url)}</code></td></tr>
          <tr><th>Client IP</th><td><code>${escapeHtml(rec.clientIp || '-')}</code></td></tr>
          <tr><th>User Agent</th><td><code>${escapeHtml(rec.userAgent || '-')}</code></td></tr>
          <tr><th>Environment</th><td>${escapeHtml(rec.env)}</td></tr>
          <tr><th>Service</th><td>${escapeHtml(rec.service)}</td></tr>
          <tr><th>Slow Flag</th><td>${rec.isSlow ? '<span class="text-danger font-weight-bold">YES</span>' : 'No'}</td></tr>
        </tbody>
      </table>
    `;
  }

  function renderHeaders(headers) {
    const el = document.getElementById('drawer-headers-content');
    const keys = Object.keys(headers);
    if (keys.length === 0) {
      el.innerHTML = '<div class="text-muted">No request headers captured.</div>';
      return;
    }

    let html = '<table class="data-table"><thead><tr><th>Header</th><th>Value</th></tr></thead><tbody>';
    for (const key of keys) {
      html += `<tr><td><strong>${escapeHtml(key)}</strong></td><td><code>${escapeHtml(headers[key])}</code></td></tr>`;
    }
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function renderBodyAndQuery(rec) {
    const el = document.getElementById('drawer-body-content');
    let html = '<h4>Query Parameters</h4>';
    if (rec.query && Object.keys(rec.query).length > 0) {
      html += `<pre>${escapeHtml(JSON.stringify(rec.query, null, 2))}</pre>`;
    } else {
      html += '<div class="text-muted mb-4">No query parameters</div>';
    }

    html += '<h4 class="mt-4">Request Body (Redacted)</h4>';
    if (rec.body !== undefined && rec.body !== null) {
      html += `<pre>${escapeHtml(JSON.stringify(rec.body, null, 2))}</pre>`;
    } else {
      html += '<div class="text-muted">No body captured or body was empty</div>';
    }

    el.innerHTML = html;
  }

  function renderErrorDetails(err) {
    const el = document.getElementById('drawer-error-content');
    if (!err) {
      el.innerHTML = '<div class="text-success">✔ No exceptions or errors recorded for this request.</div>';
      return;
    }

    let html = `
      <div class="card p-3 mb-3" style="border-left: 4px solid var(--danger);">
        <h3 class="text-danger">${escapeHtml(err.name || 'Error')}</h3>
        <p class="mt-2 font-weight-bold">${escapeHtml(err.message)}</p>
      </div>
      <h4 class="mt-4">Stack Trace</h4>
      <pre>${escapeHtml(err.stack || 'No stack trace available')}</pre>
    `;

    el.innerHTML = html;
  }

  // Filter Buttons
  btnApplyFilters.addEventListener('click', () => {
    currentPage = 1;
    fetchRequests();
  });

  btnClearFilters.addEventListener('click', () => {
    filterSearch.value = '';
    filterMethod.value = '';
    filterStatus.value = '';
    filterLevel.value = '';
    filterSlow.checked = false;
    filterError.checked = false;
    currentPage = 1;
    fetchRequests();
  });

  // Pagination buttons
  btnPrevPage.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      fetchRequests();
    }
  });

  btnNextPage.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      fetchRequests();
    }
  });

  // Export buttons
  btnExportJson.addEventListener('click', () => {
    window.open(`${baseUrl}/api/export?format=json`, '_blank');
  });

  btnExportCsv.addEventListener('click', () => {
    window.open(`${baseUrl}/api/export?format=csv`, '_blank');
  });

  // Refresh
  btnRefresh.addEventListener('click', () => {
    fetchStats();
    fetchRequests();
  });

  // Live Stream via SSE
  function startLiveStream() {
    if (typeof EventSource === 'undefined') {
      startPolling();
      return;
    }

    try {
      eventSource = new EventSource(`${baseUrl}/api/stream`);

      eventSource.onopen = function () {
        elLiveIndicator.classList.remove('paused');
        elLiveIndicator.querySelector('.text').textContent = 'LIVE';
      };

      eventSource.onmessage = function (event) {
        if (isStreamPaused) return;

        try {
          const rec = JSON.parse(event.data);
          appendStreamLine(rec);
        } catch {
          // ignore parse error
        }
      };

      eventSource.onerror = function () {
        elLiveIndicator.classList.add('paused');
        elLiveIndicator.querySelector('.text').textContent = 'RECONNECTING';
      };
    } catch {
      startPolling();
    }
  }

  function appendStreamLine(rec) {
    const line = document.createElement('div');
    line.className = 'terminal-line';

    const time = formatTimestamp(rec.timestamp);
    const method = rec.method || rec.type || 'LOG';
    const status = rec.statusCode ? `[${rec.statusCode}]` : '';
    const dur = rec.durationMs !== undefined ? `(${rec.durationMs.toFixed(1)}ms)` : '';
    const url = rec.url || rec.message || '';

    let colorCls = 'text-info';
    if (rec.level === 'error' || (rec.statusCode && rec.statusCode >= 500)) colorCls = 'text-danger';
    else if (rec.level === 'warn' || (rec.statusCode && rec.statusCode >= 400)) colorCls = 'text-warning';

    line.innerHTML = `<span class="text-muted">[${time}]</span> <span class="${colorCls}">${escapeHtml(method)}</span> <strong>${escapeHtml(status)}</strong> ${escapeHtml(url)} <span class="text-muted">${dur}</span>`;

    streamContainer.appendChild(line);

    // Keep stream buffer bounded (last 500 lines)
    while (streamContainer.childNodes.length > 500) {
      streamContainer.removeChild(streamContainer.firstChild);
    }

    if (streamAutoscroll.checked) {
      streamContainer.scrollTop = streamContainer.scrollHeight;
    }
  }

  btnClearStream.addEventListener('click', () => {
    streamContainer.innerHTML = '';
  });

  btnPauseStream.addEventListener('click', () => {
    isStreamPaused = !isStreamPaused;
    if (isStreamPaused) {
      btnPauseStream.textContent = '▶ Resume';
      elLiveIndicator.classList.add('paused');
      elLiveIndicator.querySelector('.text').textContent = 'PAUSED';
    } else {
      btnPauseStream.textContent = '⏸ Pause';
      elLiveIndicator.classList.remove('paused');
      elLiveIndicator.querySelector('.text').textContent = 'LIVE';
    }
  });

  // Polling fallback
  function startPolling() {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = setInterval(() => {
      if (!isStreamPaused) {
        fetchStats();
      }
    }, 3000);
  }

  // Initialization
  initTheme();
  fetchStats();
  fetchRequests();
  startLiveStream();
})();
