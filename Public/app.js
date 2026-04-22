// ─── STATE ────────────────────────────────────────────────
let currentUser     = null;
let currentStopId   = null;
let currentStopName = null;
let favStopp = [];
let favLinje = [];
let autoRefreshTimer = null;

// Stop-search timers
let timers = {};

// Sok-rute state
let sokFraId = null; let sokFraName = null;
let sokTilId = null; let sokTilName = null;

// Planner state
let plannerFraId = null; let plannerFraName = null;
let plannerTilId = null; let plannerTilName = null;

// Admin state
let editingLinjeId    = null;
let stoppModalLinjeId = null;
let pendingStoppId    = null;
let pendingStoppName  = null;
let adminStoppTimer   = null;

// ─── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  currentUser = await apiFetch('/currentUser');
  if (!currentUser) return;

  document.getElementById('userName').textContent    = currentUser.username;
  document.getElementById('userInitial').textContent = currentUser.username.charAt(0).toUpperCase();

  if (currentUser.isAdmin) {
    document.getElementById('adminTab').style.display   = '';
    document.getElementById('adminBadge').style.display = '';
  }

  await loadFavourites();
  renderQuickFavs();

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-input-wrap') && !e.target.closest('.search-dropdown')) {
      document.querySelectorAll('.search-dropdown').forEach(d => d.classList.remove('open'));
    }
  });

  document.getElementById('stopSearchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadDepartures();
  });

  // Close modals on backdrop click
  ['linjeModal','stoppModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target === e.currentTarget) document.getElementById(id).classList.remove('open');
    });
  });
});

// ─── PAGE NAV ─────────────────────────────────────────────
function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  btn.classList.add('active');
  if (id === 'favoritt')  renderFavouritesPage();
  if (id === 'historikk') loadHistorikk();
  if (id === 'admin')     loadAdminPage();
  if (id === 'billett')   loadBillettPage();
}

// ─── GENERIC STOP SEARCH ──────────────────────────────────
function makeStopSearchHandler(inputId, dropdownId, timerKey, onSelect) {
  return function(val) {
    clearTimeout(timers[timerKey]);
    const dd = document.getElementById(dropdownId);
    if (val.length < 2) { dd.classList.remove('open'); return; }
    dd.innerHTML = '<div class="search-loading">Søkjer…</div>';
    dd.classList.add('open');
    timers[timerKey] = setTimeout(async () => {
      const data = await apiFetch('/api/stopp?q=' + encodeURIComponent(val));
      if (!data || data.error) {
        dd.innerHTML = `<div class="search-loading" style="color:var(--red)">${data?.error || 'Feil'}</div>`;
        return;
      }
      if (!data.length) { dd.innerHTML = '<div class="search-loading">Ingen stoppestader funne</div>'; return; }
      dd.innerHTML = data.slice(0, 12).map((s, i) => {
        const key = timerKey + '_' + i;
        window.__stopCb = window.__stopCb || {};
        window.__stopCb[key] = () => onSelect(s.id, s.namn);
        return `<div class="search-item" onclick="window.__stopCb['${key}']()">
          <span class="search-item-name">${s.namn}</span>
          <span class="search-item-id">${s.id}</span>
        </div>`;
      }).join('');
    }, 350);
  };
}

// ─── AVGANGER: STOP SEARCH ────────────────────────────────
function onStopSearch(val) {
  clearTimeout(timers.stopSearch);
  const dd = document.getElementById('stopDropdown');
  if (val.length < 2) { dd.classList.remove('open'); return; }
  dd.innerHTML = '<div class="search-loading">Søkjer…</div>';
  dd.classList.add('open');
  timers.stopSearch = setTimeout(() => fetchStopsInto(val, dd, (id, namn) => {
    document.querySelectorAll('.search-dropdown').forEach(d => d.classList.remove('open'));
    currentStopId = id; currentStopName = namn;
    document.getElementById('stopSearchInput').value = namn;
    loadDepartures();
  }), 350);
}

async function fetchStopsInto(q, dd, onClickFn) {
  const data = await apiFetch('/api/stopp?q=' + encodeURIComponent(q));
  if (!data || data.error) {
    dd.innerHTML = `<div class="search-loading" style="color:var(--red)">${data?.error || 'Feil ved søk'}</div>`;
    return;
  }
  if (!data.length) { dd.innerHTML = '<div class="search-loading">Ingen stoppestader funne</div>'; return; }
  dd.innerHTML = data.slice(0, 12).map((s, i) => {
    const key = 'fetchStops_' + i;
    window.__stopCb = window.__stopCb || {};
    window.__stopCb[key] = () => onClickFn(s.id, s.namn);
    return `<div class="search-item" onclick="window.__stopCb['${key}']()">
      <span class="search-item-name">${s.namn}</span>
      <span class="search-item-id">${s.id}</span>
    </div>`;
  }).join('');
}

// ─── DEPARTURES ───────────────────────────────────────────
async function loadDepartures() {
  if (!currentStopId) { showToast('Vel eit stoppested først', 'error'); return; }
  document.getElementById('departureBoard').style.display = 'block';
  document.getElementById('boardStopName').textContent = currentStopName;
  document.getElementById('boardStopId').textContent   = currentStopId;
  updateFavBtn();
  document.getElementById('boardBody').innerHTML = '<div class="board-empty skeleton" style="height:160px"></div>';
  await fetchAndRenderDepartures();
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(fetchAndRenderDepartures, 30000);
}

async function refreshDepartures() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  await fetchAndRenderDepartures();
  setTimeout(() => btn.classList.remove('spinning'), 600);
}

async function fetchAndRenderDepartures() {
  if (!currentStopId) return;
  const data = await apiFetch('/api/stopp/' + encodeURIComponent(currentStopId));
  const body = document.getElementById('boardBody');
  if (!data || data.error) {
    body.innerHTML = `<div class="board-error">${data?.error || 'Ukjend feil'}<br><small>${data?.raw || ''}</small></div>`;
    return;
  }
  const avganger = data.avganger || [];
  if (!avganger.length) { body.innerHTML = '<div class="board-empty">Ingen avganger funne</div>'; return; }
  const now = Date.now();
  body.innerHTML = `<table class="departure-table">
    <thead><tr><th>Linje</th><th>Retning</th><th>Avgang</th><th>Status</th></tr></thead>
    <tbody>${avganger.map(d => {
      const tidStr = formatDepTime(d.tid, now);
      const snart  = isSnart(d.tid, now);
      const cls    = d.forseinka ? 'dep-tid forseinka' : snart ? 'dep-tid snart' : 'dep-tid';
      return `<tr>
        <td><span class="linje-badge">${esc(d.linje)}</span></td>
        <td><span class="dep-retning">${esc(d.retning)}</span></td>
        <td><span class="${cls}">${tidStr}</span>${d.forseinka && d.forsinkMin > 0 ? `<span class="dep-forsink-badge">+${d.forsinkMin} min</span>` : ''}</td>
        <td>${d.realtime ? '<span class="dep-realtime-dot"></span><small>Sanntid</small>' : '<small style="color:var(--muted)">Rutetid</small>'}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function formatDepTime(tid, now) {
  if (!tid) return '–';
  const t = new Date(tid); if (isNaN(t)) return tid;
  const d = Math.round((t - now) / 60000);
  if (d < 0) return 'Gått'; if (d === 0) return 'Nå'; if (d < 60) return d + ' min';
  return t.toLocaleTimeString('nb-NO', { hour:'2-digit', minute:'2-digit' });
}
function isSnart(tid, now) {
  if (!tid) return false;
  const t = new Date(tid); if (isNaN(t)) return false;
  const d = Math.round((t - now) / 60000);
  return d >= 0 && d <= 3;
}

// ─── FAV STOP ─────────────────────────────────────────────
function updateFavBtn() {
  const btn = document.getElementById('favBtn');
  const isFav = favStopp.some(f => f.stopp_id === currentStopId);
  btn.textContent = isFav ? '★ Fjern favoritt' : '☆ Favoritt';
  btn.className   = isFav ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-blue';
}
async function toggleFavStopp() {
  if (!currentStopId) return;
  const isFav = favStopp.some(f => f.stopp_id === currentStopId);
  if (isFav) { await apiFetch('/favorittStopp/' + encodeURIComponent(currentStopId), 'DELETE'); showToast('Fjerna frå favorittStopp', 'success'); }
  else       { await apiFetch('/favorittStopp', 'POST', { stopp_id: currentStopId, stopp_namn: currentStopName }); showToast('Lagt til i favorittStopp!', 'success'); }
  await loadFavourites(); updateFavBtn(); renderQuickFavs();
}
async function loadFavourites() {
  [favStopp, favLinje] = await Promise.all([apiFetch('/favorittStopp'), apiFetch('/favorittLinje')]);
  favStopp = favStopp || []; favLinje = favLinje || [];
}
function renderQuickFavs() {
  const c = document.getElementById('quickFavs'), g = document.getElementById('quickFavGrid');
  if (!favStopp.length) { c.style.display = 'none'; return; }
  c.style.display = 'block';
  document.getElementById('quickFavCount').textContent = favStopp.length;
  g.innerHTML = favStopp.map(f => `
    <div class="fav-card" onclick="openFavStop('${esc(f.stopp_id)}','${esc(f.stopp_namn)}')">
      <div class="fav-card-info"><div class="fav-card-icon">🚏</div>
        <div><div class="fav-card-name">${esc(f.stopp_namn)}</div><div class="fav-card-id">${esc(f.stopp_id)}</div></div>
      </div>
      <button class="fav-remove" onclick="removeFavStopp(event,'${esc(f.stopp_id)}')">✕</button>
    </div>`).join('');
}
function openFavStop(id, namn) {
  currentStopId = id; currentStopName = namn;
  document.getElementById('stopSearchInput').value = namn;
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-page="avganger"]').classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-avganger').classList.add('active');
  loadDepartures();
}
async function removeFavStopp(e, id) {
  e.stopPropagation();
  await apiFetch('/favorittStopp/' + encodeURIComponent(id), 'DELETE');
  showToast('Fjerna', 'success'); await loadFavourites(); renderQuickFavs(); updateFavBtn();
}

// ─── FAVOURITES PAGE ──────────────────────────────────────
function renderFavouritesPage() {
  document.getElementById('statFavStopp').textContent  = favStopp.length;
  document.getElementById('statFavLinje').textContent  = favLinje.length;
  document.getElementById('favStoppCount').textContent = favStopp.length;
  document.getElementById('favLinjeCount').textContent = favLinje.length;

  document.getElementById('favStoppGrid').innerHTML = !favStopp.length
    ? '<div class="fav-empty">Ingen favorittStopp enno. Søk og trykk ☆ Favoritt.</div>'
    : favStopp.map(f => `
        <div class="fav-card" onclick="openFavStop('${esc(f.stopp_id)}','${esc(f.stopp_namn)}')">
          <div class="fav-card-info"><div class="fav-card-icon">🚏</div>
            <div><div class="fav-card-name">${esc(f.stopp_namn)}</div><div class="fav-card-id">${esc(f.stopp_id)}</div></div>
          </div>
          <button class="fav-remove" onclick="removeFavStoppFavPage(event,'${esc(f.stopp_id)}')">✕</button>
        </div>`).join('');

  document.getElementById('favLinjeGrid').innerHTML = !favLinje.length
    ? '<div class="fav-empty">Ingen favorittlinjer enno.</div>'
    : favLinje.map(f => `
        <div class="fav-card">
          <div class="fav-card-info">
            <div class="fav-card-icon" style="background:linear-gradient(135deg,var(--accent-blue),var(--accent))">🚌</div>
            <div><div class="fav-card-name">${esc(f.linje_namn)}</div><div class="fav-card-id">Linje ${esc(f.linje_nr || f.linje_id)}</div></div>
          </div>
          <button class="fav-remove" onclick="removeFavLinje(event,'${esc(f.linje_id)}')">✕</button>
        </div>`).join('');
}
async function removeFavStoppFavPage(e, id) {
  e.stopPropagation(); await apiFetch('/favorittStopp/' + encodeURIComponent(id), 'DELETE');
  showToast('Fjerna', 'success'); await loadFavourites(); renderFavouritesPage(); renderQuickFavs();
}
async function removeFavLinje(e, id) {
  e.stopPropagation(); await apiFetch('/favorittLinje/' + encodeURIComponent(id), 'DELETE');
  showToast('Fjerna', 'success'); await loadFavourites(); renderFavouritesPage();
}

// ─── SØK RUTE (local DB) ──────────────────────────────────
function onSokSearch(which, val) {
  clearTimeout(timers['sok_' + which]);
  const dd = document.getElementById(which === 'fra' ? 'sokFraDropdown' : 'sokTilDropdown');
  if (val.length < 2) { dd.classList.remove('open'); return; }
  dd.innerHTML = '<div class="search-loading">Søkjer…</div>';
  dd.classList.add('open');
  timers['sok_' + which] = setTimeout(async () => {
    // Search Skyss API for stop suggestions, but also search local DB stops
    const [apiData, localLinjer] = await Promise.all([
      apiFetch('/api/stopp?q=' + encodeURIComponent(val)),
      apiFetch('/linjer')
    ]);

    // Collect all stops from local linjer that match query
    const localStops = [];
    if (Array.isArray(localLinjer)) {
      for (const l of localLinjer) {
        // We need stopp for this linje - but to avoid too many calls, just show the linje name as context
      }
    }

    let results = [];
    if (Array.isArray(apiData)) results = apiData.slice(0, 10);

    if (!results.length) {
      dd.innerHTML = '<div class="search-loading">Ingen stoppestader funne</div>'; return;
    }

    dd.innerHTML = results.map(s =>
      `<div class="search-item" onclick="selectSokStop('${which}','${esc(s.id)}','${esc(s.namn)}')">
        <span class="search-item-name">${s.namn}</span>
        <span class="search-item-id">${s.id}</span>
      </div>`).join('');
  }, 350);
}

function selectSokStop(which, id, namn) {
  document.querySelectorAll('.search-dropdown').forEach(d => d.classList.remove('open'));
  if (which === 'fra') { sokFraId = id; sokFraName = namn; document.getElementById('sokFraInput').value = namn; }
  else                 { sokTilId = id; sokTilName = namn; document.getElementById('sokTilInput').value = namn; }
}

function swapSok() {
  [sokFraId, sokTilId] = [sokTilId, sokFraId];
  [sokFraName, sokTilName] = [sokTilName, sokFraName];
  document.getElementById('sokFraInput').value = sokFraName || '';
  document.getElementById('sokTilInput').value = sokTilName || '';
}

function clearSok() {
  sokFraId = sokFraName = sokTilId = sokTilName = null;
  document.getElementById('sokFraInput').value = '';
  document.getElementById('sokTilInput').value = '';
  document.getElementById('sokResults').innerHTML = '';
  document.getElementById('sokHint').textContent = '';
}

async function doSokRute() {
  if (!sokFraId || !sokTilId) { showToast('Vel stoppestader for frå og til', 'error'); return; }
  const hint = document.getElementById('sokHint');
  const results = document.getElementById('sokResults');
  hint.textContent = '';
  results.innerHTML = '<div class="board-empty skeleton" style="height:100px;border-radius:12px"></div>';

  const data = await apiFetch('/api/sokRute?fra=' + encodeURIComponent(sokFraId) + '&til=' + encodeURIComponent(sokTilId));

  if (!data || data.error) {
    results.innerHTML = `<div class="board-error">${data?.error || 'Feil ved søk'}</div>`;
    return;
  }

  if (!data.length) {
    results.innerHTML = `
      <div class="journey-result" style="text-align:center;padding:2rem">
        <div style="font-size:2rem;margin-bottom:0.8rem">🚌</div>
        <div style="font-weight:600;margin-bottom:0.4rem">Ingen registrerte linjer funne</div>
        <div style="color:var(--muted);font-size:0.86rem">Ingen av dei registrerte linjene i databasen har begge stoppestadene.
        Prøv <b>Reiseplan</b>-fana for Skyss sitt live-API.</div>
      </div>`;
    hint.textContent = 'Tips: Prøv Reiseplan-fana for Skyss live-data.';
    return;
  }

  results.innerHTML = data.map(r => {
    const stopp = r.stopp || [];
    return `<div class="journey-result">
      <div class="journey-header">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span class="linje-badge" style="font-size:1.3rem;padding:6px 14px">${esc(r.linje_nr)}</span>
          <div>
            <div style="font-weight:700;font-size:1rem">${esc(r.namn)}</div>
            <div style="font-size:0.78rem;color:var(--muted)">${esc(r.type)} · ${stopp.length} stoppestader på denne strekninga</div>
          </div>
        </div>
        <button class="btn btn-blue btn-sm" onclick="addFavLinjeFromSok(${r.linje_id},'${esc(r.namn)}','${esc(r.linje_nr)}')">☆ Favoritt</button>
      </div>
      <div style="margin-top:12px">
        <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:8px">Stoppestader på strekninga</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
          ${stopp.map((s, i) => `
            <span style="display:inline-flex;align-items:center;gap:5px;background:var(--surface2);border:1px solid var(--border${i===0||i===stopp.length-1?'2':''});border-radius:7px;padding:4px 10px;font-size:0.82rem;${i===0?'border-color:rgba(62,255,154,0.3);color:var(--green)':i===stopp.length-1?'border-color:rgba(255,77,77,0.3);color:var(--red)':''}">
              ${i===0?'🟢':i===stopp.length-1?'🔴':'·'} ${esc(s.stopp_namn)}
            </span>
            ${i < stopp.length-1 ? '<span style="color:var(--muted);font-size:0.9rem">›</span>' : ''}`).join('')}
        </div>
      </div>
    </div>`;
  }).join('');

  // Log to history
  await apiFetch('/historikk', 'POST', { fra_stopp_id: sokFraId, fra_stopp_namn: sokFraName, til_stopp_id: sokTilId, til_stopp_namn: sokTilName });
}

async function addFavLinjeFromSok(id, namn, nr) {
  await apiFetch('/favorittLinje', 'POST', { linje_id: String(id), linje_namn: namn, linje_nr: nr });
  showToast('Linje ' + nr + ' lagt til i favoritt!', 'success');
  await loadFavourites();
}

// ─── REISEPLAN (Skyss live) ────────────────────────────────
function onPlannerSearch(which, val) {
  clearTimeout(timers['plan_' + which]);
  const dd = document.getElementById(which === 'fra' ? 'plannerFraDropdown' : 'plannerTilDropdown');
  if (val.length < 2) { dd.classList.remove('open'); return; }
  dd.innerHTML = '<div class="search-loading">Søkjer…</div>';
  dd.classList.add('open');
  timers['plan_' + which] = setTimeout(() => fetchStopsInto(val, dd, (id, namn) => {
    document.querySelectorAll('.search-dropdown').forEach(d => d.classList.remove('open'));
    if (which === 'fra') { plannerFraId = id; plannerFraName = namn; document.getElementById('plannerFraInput').value = namn; }
    else                 { plannerTilId = id; plannerTilName = namn; document.getElementById('plannerTilInput').value = namn; }
  }), 350);
}
function swapPlanner() {
  [plannerFraId, plannerTilId] = [plannerTilId, plannerFraId];
  [plannerFraName, plannerTilName] = [plannerTilName, plannerFraName];
  document.getElementById('plannerFraInput').value = plannerFraName || '';
  document.getElementById('plannerTilInput').value = plannerTilName || '';
}
function clearPlanner() {
  plannerFraId = plannerFraName = plannerTilId = plannerTilName = null;
  document.getElementById('plannerFraInput').value = '';
  document.getElementById('plannerTilInput').value = '';
  document.getElementById('plannerResults').innerHTML = '';
}
async function doReiseplan() {
  if (!plannerFraId || !plannerTilId) {
    showToast('Vel stoppestader for frå og til', 'error');
    return;
  }

  const results = document.getElementById('plannerResults');
  results.innerHTML = '<div class="board-empty skeleton" style="height:120px;border-radius:12px"></div>';

  // Save to history
  await apiFetch('/historikk', 'POST', {
    fra_stopp_id: plannerFraId,
    fra_stopp_namn: plannerFraName,
    til_stopp_id: plannerTilId,
    til_stopp_namn: plannerTilName
  });

  // Use the local route search endpoint instead of Skyss API
  const data = await apiFetch('/api/sokRute?fra=' + encodeURIComponent(plannerFraId) + '&til=' + encodeURIComponent(plannerTilId));

  if (!data || data.error) {
    results.innerHTML = `<div class="board-error">${data?.error || 'Feil ved søk'}<br><small>Ingen registrerte ruter funne.</small></div>`;
    return;
  }

  if (!data.length) {
    results.innerHTML = `
      <div class="journey-result" style="text-align:center;padding:2rem">
        <div style="font-size:2rem;margin-bottom:0.8rem">🚌</div>
        <div style="font-weight:600;margin-bottom:0.4rem">Ingen registrerte ruter funne</div>
        <div style="color:var(--muted);font-size:0.86rem">
          Ingen av dei registrerte linjene i databasen går mellom desse stoppestadene.
        </div>
      </div>`;
    return;
  }

  // Render the routes found
  results.innerHTML = data.map(r => {
    const stopp = r.stopp || [];
    const fraIndex = stopp.findIndex(s => s.stopp_id === plannerFraId);
    const tilIndex = stopp.findIndex(s => s.stopp_id === plannerTilId);

    return `<div class="journey-result">
      <div class="journey-header">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;flex:1">
          <span class="linje-badge" style="font-size:1.3rem;padding:6px 14px">${esc(r.linje_nr)}</span>
          <div>
            <div style="font-weight:700;font-size:1rem">${esc(r.namn)}</div>
            <div style="font-size:0.78rem;color:var(--muted)">
              ${esc(r.type)} · ${Math.abs(tilIndex - fraIndex) + 1} stoppestader
            </div>
          </div>
        </div>
        <button class="btn btn-blue btn-sm" onclick="addFavLinjeFromPlanner(${r.linje_id},'${esc(r.namn)}','${esc(r.linje_nr)}')">☆ Favoritt</button>
      </div>

      <div style="margin-top:16px">
        <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:10px">
          Rute
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
          ${stopp.map((s, i) => {
            const isFra = s.stopp_id === plannerFraId;
            const isTil = s.stopp_id === plannerTilId;
            const isOnRoute = (r.rettRetning && i >= fraIndex && i <= tilIndex) ||
                             (!r.rettRetning && i >= tilIndex && i <= fraIndex);

            return `
              <span style="display:inline-flex;align-items:center;gap:5px;background:var(--surface2);border:1px solid var(--border${isFra||isTil?'2':''});border-radius:7px;padding:4px 10px;font-size:0.82rem;${
                isFra ? 'border-color:rgba(62,255,154,0.3);color:var(--green);font-weight:600' :
                isTil ? 'border-color:rgba(255,77,77,0.3);color:var(--red);font-weight:600' :
                isOnRoute ? 'opacity:1' : 'opacity:0.4'
              }">
                ${isFra ? '🟢' : isTil ? '🔴' : '·'} ${esc(s.stopp_namn)}
              </span>
              ${i < stopp.length-1 ? '<span style="color:var(--muted);font-size:0.9rem">›</span>' : ''}
            `;
          }).join('')}
        </div>
      </div>

      ${!r.rettRetning ? `
        <div style="margin-top:12px;padding:10px;background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.2);border-radius:8px;font-size:0.82rem;color:var(--muted)">
          ⚠️ Obs: Du må kanskje reise i motsett retning
        </div>
      ` : ''}
    </div>`;
  }).join('');
}

// Helper function to add favorite from planner
async function addFavLinjeFromPlanner(id, namn, nr) {
  await apiFetch('/favorittLinje', 'POST', {
    linje_id: String(id),
    linje_namn: namn,
    linje_nr: nr
  });
  showToast('Linje ' + nr + ' lagt til i favoritt!', 'success');
  await loadFavourites();
}
function formatTime(iso) {
  if (!iso) return '–'; const t = new Date(iso); if (isNaN(t)) return iso;
  return t.toLocaleTimeString('nb-NO', { hour:'2-digit', minute:'2-digit' });
}

// ─── HISTORIKK ────────────────────────────────────────────
async function loadHistorikk() {
  const data = await apiFetch('/historikk');
  const list = document.getElementById('historikkList');
  const count = document.getElementById('historikkCount');
  if (!data || !data.length) { list.innerHTML = '<div class="historikk-empty">Ingen reiser registrert enno.</div>'; count.textContent = '0'; return; }
  count.textContent = data.length;
  list.innerHTML = data.map(h => `
    <div class="historikk-item">
      <div class="historikk-route">
        <span class="historikk-stopp">${esc(h.fra_stopp_namn)}</span>
        <span class="historikk-arrow">→</span>
        <span class="historikk-stopp">${esc(h.til_stopp_namn)}</span>
      </div>
      <div class="historikk-tid">${formatHistTid(h.tidspunkt)}</div>
    </div>`).join('');
}
function formatHistTid(iso) {
  if (!iso) return ''; const t = new Date(iso); if (isNaN(t)) return iso;
  return t.toLocaleDateString('nb-NO', { day:'numeric', month:'short' }) + ' ' + t.toLocaleTimeString('nb-NO', { hour:'2-digit', minute:'2-digit' });
}

// ─── ADMIN PAGE ───────────────────────────────────────────
async function loadAdminPage() {
  if (!currentUser?.isAdmin) return;
  loadAdminLinjer();
  loadAdminBrukere();
}

async function loadAdminLinjer() {
  const data = await apiFetch('/linjer');
  const list  = document.getElementById('adminLinjeList');
  const count = document.getElementById('adminLinjeCount');
  if (!data || !data.length) {
    list.innerHTML = '<div class="board-empty">Ingen linjer registrert enno. Trykk + Ny linje for å leggje til.</div>';
    count.textContent = '0'; return;
  }
  count.textContent = data.length;
  list.innerHTML = `<table class="departure-table">
    <thead><tr><th>Nr</th><th>Namn</th><th>Type</th><th>Beskriving</th><th>Handlingar</th></tr></thead>
    <tbody>${data.map(l => `
      <tr>
        <td><span class="linje-badge">${esc(l.linje_nr)}</span></td>
        <td style="font-weight:600">${esc(l.namn)}</td>
        <td><span style="font-size:0.78rem;color:var(--muted)">${esc(l.type)}</span></td>
        <td style="color:var(--muted);font-size:0.85rem">${esc(l.beskriving || '–')}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-blue btn-sm" onclick="openStoppModal(${l.id},'${esc(l.namn)}','${esc(l.linje_nr)}')">🚏 Stopp</button>
            <button class="btn btn-ghost btn-sm" onclick="openRedigerLinjeModal(${l.id},'${esc(l.linje_nr)}','${esc(l.namn)}','${esc(l.type)}','${esc(l.beskriving||'')}')">✏️ Rediger</button>
            <button class="btn btn-sm" style="background:rgba(255,77,77,0.1);color:var(--red);border:1px solid rgba(255,77,77,0.2)" onclick="slettLinje(${l.id},'${esc(l.namn)}')">🗑️</button>
          </div>
        </td>
      </tr>`).join('')}
    </tbody></table>`;
}

async function loadAdminBrukere() {
  const data = await apiFetch('/admin/brukere');
  const list = document.getElementById('adminBrukereList');
  if (!data || !data.length) { list.innerHTML = '<div class="board-empty">Ingen brukarar</div>'; return; }
  list.innerHTML = `<table class="departure-table">
    <thead><tr><th>ID</th><th>Brukarnavn</th><th>E-post</th><th>Admin</th></tr></thead>
    <tbody>${data.map(u => `
      <tr>
        <td style="font-family:'DM Mono',monospace;color:var(--muted);font-size:0.8rem">${u.id}</td>
        <td style="font-weight:600">${esc(u.brukernavn)}</td>
        <td style="color:var(--muted);font-size:0.85rem">${esc(u.epost || '–')}</td>
        <td>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" ${u.is_admin ? 'checked' : ''} onchange="setAdmin(${u.id},this.checked)"
              style="width:16px;height:16px;accent-color:var(--accent)">
            <span style="font-size:0.83rem;color:${u.is_admin ? 'var(--accent)' : 'var(--muted)'}">${u.is_admin ? 'Admin' : 'Vanleg'}</span>
          </label>
        </td>
      </tr>`).join('')}
    </tbody></table>`;
}

async function setAdmin(userId, isAdmin) {
  const res = await apiFetch('/admin/setAdmin', 'POST', { user_id: userId, is_admin: isAdmin });
  if (res?.ok) showToast(isAdmin ? 'Admin-tilgang gitt' : 'Admin-tilgang fjerna', 'success');
  else showToast('Feil: ' + (res?.error || ''), 'error');
}

// ─── LINJE MODAL ──────────────────────────────────────────
function openNyLinjeModal() {
  editingLinjeId = null;
  document.getElementById('linjeModalTitle').textContent = 'Ny linje';
  document.getElementById('linjeModalId').value = '';
  document.getElementById('linjeNr').value   = '';
  document.getElementById('linjeNamn').value = '';
  document.getElementById('linjeType').value = 'Buss';
  document.getElementById('linjeBesk').value = '';
  document.getElementById('linjeModal').classList.add('open');
}
function openRedigerLinjeModal(id, nr, namn, type, besk) {
  editingLinjeId = id;
  document.getElementById('linjeModalTitle').textContent = 'Rediger linje';
  document.getElementById('linjeModalId').value = id;
  document.getElementById('linjeNr').value   = nr;
  document.getElementById('linjeNamn').value = namn;
  document.getElementById('linjeType').value = type;
  document.getElementById('linjeBesk').value = besk;
  document.getElementById('linjeModal').classList.add('open');
}
function closeLinjeModal() { document.getElementById('linjeModal').classList.remove('open'); }

async function saveLinje() {
  const linje_nr   = document.getElementById('linjeNr').value.trim();
  const namn       = document.getElementById('linjeNamn').value.trim();
  const type       = document.getElementById('linjeType').value;
  const beskriving = document.getElementById('linjeBesk').value.trim();
  if (!linje_nr || !namn) { showToast('Linjenummer og namn er påkravd', 'error'); return; }

  const btn = document.querySelector('#linjeModal .btn-primary');
  btn.textContent = 'Lagrar…'; btn.disabled = true;

  let res;
  if (editingLinjeId) {
    res = await apiFetch('/linjer/' + editingLinjeId, 'PUT', { linje_nr, namn, beskriving, type });
  } else {
    res = await apiFetch('/linjer', 'POST', { linje_nr, namn, beskriving, type });
  }

  btn.textContent = 'Lagre'; btn.disabled = false;

  if (res?.ok) {
    closeLinjeModal();
    showToast(editingLinjeId ? 'Linje oppdatert!' : 'Linje oppretta!', 'success');
    loadAdminLinjer();
  } else {
    showToast('Feil: ' + (res?.error || 'Ukjend'), 'error');
  }
}

async function slettLinje(id, namn) {
  if (!confirm('Slett linje "' + namn + '"? Dette slettar også alle stoppestader på linja.')) return;
  const res = await apiFetch('/linjer/' + id, 'DELETE');
  if (res?.ok) { showToast('Linje sletta', 'success'); loadAdminLinjer(); }
  else showToast('Feil: ' + (res?.error || ''), 'error');
}

// ─── STOPP MODAL ──────────────────────────────────────────
async function openStoppModal(linjeId, namn, nr) {
  stoppModalLinjeId = linjeId;
  pendingStoppId = pendingStoppName = null;
  document.getElementById('stoppModalTitle').textContent = 'Linje ' + nr + ' – ' + namn;
  document.getElementById('stoppSokInput').value = '';
  document.getElementById('stoppRekkefolge').value = '';
  document.getElementById('stoppModal').classList.add('open');
  await refreshStoppListe();
}
function closeStoppModal() { document.getElementById('stoppModal').classList.remove('open'); }

async function refreshStoppListe() {
  const data = await apiFetch('/linjer/' + stoppModalLinjeId);
  const container = document.getElementById('stoppListe');
  if (!data || !data.stopp || !data.stopp.length) {
    container.innerHTML = '<div style="color:var(--muted);font-size:0.86rem">Ingen stoppestader på denne linja enno.</div>';
    return;
  }
  container.innerHTML = data.stopp.map(s => `
    <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:9px 12px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-family:'DM Mono',monospace;font-size:0.72rem;color:var(--muted);width:20px">${s.rekkefolge}</span>
        <span style="font-weight:500;font-size:0.9rem">${esc(s.stopp_namn)}</span>
        <span style="font-family:'DM Mono',monospace;font-size:0.71rem;color:var(--muted)">${esc(s.stopp_id)}</span>
      </div>
      <button class="fav-remove" onclick="slettStopp('${esc(s.stopp_id)}')">✕</button>
    </div>`).join('');
}

function onAdminStoppSearch(val) {
  clearTimeout(adminStoppTimer);
  const dd = document.getElementById('stoppSokDropdown');
  if (val.length < 2) { dd.classList.remove('open'); return; }
  dd.innerHTML = '<div class="search-loading">Søkjer…</div>';
  dd.classList.add('open');
  adminStoppTimer = setTimeout(async () => {
    const data = await apiFetch('/api/stopp?q=' + encodeURIComponent(val));
    if (!data || data.error || !data.length) { dd.innerHTML = '<div class="search-loading">Ingen funne</div>'; return; }
    dd.innerHTML = data.slice(0, 10).map(s =>
      `<div class="search-item" onclick="selectAdminStopp('${esc(s.id)}','${esc(s.namn)}')">
        <span class="search-item-name">${s.namn}</span>
        <span class="search-item-id">${s.id}</span>
      </div>`).join('');
  }, 350);
}

function selectAdminStopp(id, namn) {
  pendingStoppId = id; pendingStoppName = namn;
  document.getElementById('stoppSokInput').value = namn;
  document.getElementById('stoppSokDropdown').classList.remove('open');
}

async function leggTilStopp() {
  if (!pendingStoppId) { showToast('Vel eit stoppested frå søket', 'error'); return; }
  const rekkefolge = parseInt(document.getElementById('stoppRekkefolge').value) || 0;
  const res = await apiFetch('/linjer/' + stoppModalLinjeId + '/stopp', 'POST', {
    stopp_id: pendingStoppId, stopp_namn: pendingStoppName, rekkefolge
  });
  if (res?.ok) {
    showToast('Stoppested lagt til!', 'success');
    pendingStoppId = pendingStoppName = null;
    document.getElementById('stoppSokInput').value = '';
    document.getElementById('stoppRekkefolge').value = '';
    await refreshStoppListe();
  } else { showToast('Feil: ' + (res?.error || ''), 'error'); }
}

async function slettStopp(stoppId) {
  const res = await apiFetch('/linjer/' + stoppModalLinjeId + '/stopp/' + encodeURIComponent(stoppId), 'DELETE');
  if (res?.ok) { showToast('Stoppested fjerna', 'success'); await refreshStoppListe(); }
  else showToast('Feil: ' + (res?.error || ''), 'error');
}

// ─── UTILS ────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
// ─── BILLETTAR ────────────────────────────────────────────
const BILLETT_IKONER = {
  enkeltbillett:  '🎟️',
  dagsbillett:    '☀️',
  periodebillett: '📅',
  klippekort:     '✂️',
};

async function loadBillettPage() {
  const [produkt, mine] = await Promise.all([
    apiFetch('/api/billett/produkt'),
    apiFetch('/api/billett/mine'),
  ]);
  renderBillettProdukt(produkt || []);
  renderMineBillettar(mine || []);
}

function renderBillettProdukt(produkt) {
  const el = document.getElementById('billettProduktList');
  if (!produkt.length) { el.innerHTML = '<div class="board-empty">Ingen billettypar.</div>'; return; }
  el.innerHTML = produkt.map(p => `
    <div class="billett-produkt-card" id="bp-${p.id}">
      <div class="billett-produkt-top">
        <span class="billett-ikon">${BILLETT_IKONER[p.type] || '🎫'}</span>
        <div class="billett-produkt-info">
          <div class="billett-produkt-namn">${esc(p.namn)}</div>
          <div class="billett-produkt-besk">${esc(p.beskriving || '')}</div>
        </div>
        <div class="billett-produkt-pris">${formatPris(p.pris)}</div>
      </div>
      <div class="billett-produkt-meta">
        <span class="billett-type-badge billett-type-${esc(p.type)}">${esc(p.type)}</span>
        <span style="color:var(--muted);font-size:0.78rem">${formatVarighet(p.varighet_min)}</span>
      </div>
      <button class="btn btn-primary billett-kjop-btn" onclick="kjopBillett(${p.id}, this)">
        Kjøp no – ${formatPris(p.pris)}
      </button>
    </div>`).join('');
}

async function kjopBillett(produktId, btn) {
  btn.disabled = true;
  btn.textContent = 'Behandlar…';
  const res = await apiFetch('/api/billett/kjop', 'POST', { produkt_id: produktId });
  if (!res || !res.ok) {
    showToast(res?.error || 'Kjøp feila', 'error');
    btn.disabled = false;
    btn.textContent = btn.textContent.replace('Behandlar…', 'Kjøp no');
    return;
  }
  showToast('✅ Billett kjøpt!', 'success');
  // refresh my tickets
  const mine = await apiFetch('/api/billett/mine');
  renderMineBillettar(mine || []);
  // re-enable button
  btn.disabled = false;
  const p = res.billett;
  btn.textContent = `Kjøp no – ${formatPris(p.pris)}`;
}

function renderMineBillettar(mine) {
  document.getElementById('mineBillettCount').textContent = mine.length;
  const el = document.getElementById('mineBillettList');
  if (!mine.length) { el.innerHTML = '<div class="board-empty">Du har ingen billettar enno. Kjøp ein til venstre!</div>'; return; }
  const now = Date.now();
  el.innerHTML = mine.map(b => {
    const gyldigTil = new Date(b.gyldig_til.replace(' ','T'));
    const gyldig = gyldigTil > now;
    const minutterIgjen = Math.max(0, Math.round((gyldigTil - now) / 60000));
    return `
    <div class="billett-card ${gyldig ? 'billett-aktiv' : 'billett-utlopt'}">
      <div class="billett-card-top">
        <span class="billett-ikon">${BILLETT_IKONER[b.produkt_type] || '🎫'}</span>
        <div style="flex:1;min-width:0">
          <div class="billett-card-namn">${esc(b.namn)}</div>
          <div class="billett-card-tid">Kjøpt ${formatDato(b.kjopt)}</div>
        </div>
        <div class="billett-status ${gyldig ? 'status-aktiv' : 'status-utlopt'}">
          ${gyldig ? (minutterIgjen < 120 ? `${minutterIgjen} min igjen` : 'AKTIV') : 'UTLØPT'}
        </div>
      </div>
      <div class="billett-card-gyldig">
        Gyldig til: <strong>${formatDatoFull(b.gyldig_til)}</strong>
      </div>
      ${gyldig ? `<div class="billett-qr">▌▌▌█▌▌ ${b.id.toString().padStart(8,'0')} ▌▌█▌▌▌</div>` : ''}
    </div>`;
  }).join('');
}

function formatPris(ore) {
  return (ore / 100).toLocaleString('nb-NO', { style:'currency', currency:'NOK', minimumFractionDigits: 0 });
}
function formatVarighet(min) {
  if (min < 60)   return `${min} min`;
  if (min < 1440) return `${min/60} timar`;
  return `${Math.round(min/1440)} dagar`;
}
function formatDato(iso) {
  return new Date(iso.replace(' ','T')).toLocaleDateString('nb-NO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
function formatDatoFull(iso) {
  return new Date(iso.replace(' ','T')).toLocaleString('nb-NO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

async function apiFetch(url, method = 'GET', body = null) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    return await (await fetch(url, opts)).json();
  } catch (e) { console.error('apiFetch:', url, e); return null; }
}
function showToast(msg, type = 'success') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : '✕'}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3000);
}
