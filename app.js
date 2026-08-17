(() => {
  const contestants = window.BP_DATA;
  const byId = Object.fromEntries(contestants.map(c => [c.id, c]));
  const STORAGE = {
    revealed: 'bp_revealed_v1',
    picks: 'bp_episode_picks_v1',
    nameVisibility: 'bp_show_names_v1',
    shuffle: 'bp_shuffle_order_v1'
  };

  const memoryStore = {};
  const store = {
    get(key) {
      try { return window.localStorage.getItem(key); }
      catch { return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, value); }
      catch { memoryStore[key] = String(value); }
    }
  };

  let revealed = new Set(readJSON(STORAGE.revealed, []));
  // Pre-show withdrawals are not part of the guessing game: show them immediately.
  contestants.filter(c => c.elimination === 'withdrawn').forEach(c => revealed.add(c.id));
  let picks = readJSON(STORAGE.picks, {});
  let showNames = store.get(STORAGE.nameVisibility) === 'true';
  let shuffleOrder = readJSON(STORAGE.shuffle, []);
  let selectedPickId = null;
  let draggedPick = null;

  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];

  function readJSON(key, fallback) {
    try { return JSON.parse(store.get(key)) ?? fallback; }
    catch { return fallback; }
  }
  function writeJSON(key, value) { store.set(key, JSON.stringify(value)); }
  function slugInitials(name) {
    return name.replace(/\([^)]*\)/g, '').split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join('').toUpperCase();
  }
  function seededShuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
  function ensureShuffle() {
    const ids = contestants.map(c => c.id);
    if (shuffleOrder.length !== ids.length || ids.some(id => !shuffleOrder.includes(id))) {
      shuffleOrder = seededShuffle(ids);
      writeJSON(STORAGE.shuffle, shuffleOrder);
    }
  }
  ensureShuffle();
  saveReveals();

  function saveReveals() { writeJSON(STORAGE.revealed, [...revealed]); }
  function savePicks() { writeJSON(STORAGE.picks, picks); }
  function currentEpisode() { return Number($('#episodeSelect').value || 1); }
  function getEpisodePicks(ep = currentEpisode()) {
    const key = String(ep);
    if (!Array.isArray(picks[key])) picks[key] = Array(11).fill(null);
    while (picks[key].length < 11) picks[key].push(null);
    return picks[key].slice(0,11);
  }
  function setEpisodePicks(ep, arr) {
    picks[String(ep)] = [...arr].slice(0,11);
    savePicks();
  }

  function displayDestination(c) {
    const destination = c.currentDestination || '';
    const status = c.status || '';

    // Current group membership always wins. Solo/acting work is treated as an
    // additional activity and stays visible in the contestant profile instead
    // of moving that contestant out of their group on the main map.
    const isCurrentGroupMember = /group member/i.test(status) && !/former group member/i.test(status);
    if (isCurrentGroupMember) {
      // Handles labels such as "PENTAGON / Solo" while keeping the person under PENTAGON.
      const groupOnly = destination
        .replace(/\s*\/\s*(solo|soloist|acting|actor).*$/i, '')
        .trim();
      return groupOnly || destination;
    }

    // Only contestants whose primary current activity is solo or acting are
    // merged into the common Soloists / Acting sections.
    if (/solo/i.test(destination) || /soloist/i.test(status)) return 'Soloists';
    if (/acting/i.test(destination) || /actor/i.test(status)) return 'Acting';
    return destination;
  }

  function destinationGroups() {
    const map = new Map();
    contestants.forEach(c => {
      const destination = displayDestination(c);
      if (!map.has(destination)) map.set(destination, []);
      map.get(destination).push(c);
    });
    return [...map.entries()].sort((a,b) => {
      const ar = Math.min(...a[1].map(x => x.rank ?? 999));
      const br = Math.min(...b[1].map(x => x.rank ?? 999));
      return ar - br || a[0].localeCompare(b[0]);
    });
  }

  function renderMap() {
    const revealedCount = revealed.size;
    $('#progressText').textContent = `${revealedCount} / ${contestants.length}`;
    $('#progressBar').style.width = `${(revealedCount / contestants.length) * 100}%`;
    $('#remainingCount').textContent = `${contestants.length - revealedCount} left`;
    $('#toggleNames').textContent = showNames ? 'Hide trainee names' : 'Show trainee names';
    $('#toggleNames').setAttribute('aria-pressed', String(showNames));

    const pool = $('#contestantPool');
    pool.innerHTML = '';
    const mapQuery = ($('#mapSearch')?.value || '').trim().toLowerCase();
    const visibleIds = shuffleOrder.filter(id => {
      const c = byId[id];
      return !mapQuery || c.name.toLowerCase().includes(mapQuery);
    });
    visibleIds.forEach((id, index) => {
      const c = byId[id];
      const button = document.createElement('button');
      const isRevealed = revealed.has(id);
      button.className = `contestant-chip ${isRevealed ? 'revealed' : ''} ${!showNames ? 'masked' : ''}`;
      button.disabled = isRevealed || !showNames;
      button.textContent = showNames ? c.name : `TRAINEE ${String(index + 1).padStart(2,'0')}`;
      button.title = !showNames ? 'Turn on trainee names to guess' : isRevealed ? 'Already revealed' : `Reveal ${c.name}`;
      button.addEventListener('click', () => revealOne(c.id, true));
      pool.appendChild(button);
    });

    const grid = $('#destinationGrid');
    grid.innerHTML = '';
    destinationGroups().forEach(([destination, members]) => {
      const card = document.createElement('article');
      card.className = 'destination-card panel';
      const visible = members.filter(m => revealed.has(m.id)).length;
      card.innerHTML = `<h3>${escapeHTML(destination)}</h3><div class="destination-meta">${visible} / ${members.length} revealed</div><div class="member-list"></div>`;
      const list = card.querySelector('.member-list');
      members.sort((a,b) => (a.rank ?? 999) - (b.rank ?? 999)).forEach(c => {
        const open = revealed.has(c.id);
        const row = document.createElement('div');
        row.className = `member-slot ${open ? 'revealed' : 'hidden'}`;
        row.innerHTML = `<span class="member-name">${open ? escapeHTML(c.name) : '████████████'}</span><span class="member-rank">${c.rank ? `#${c.rank}` : 'WITHDREW'}</span>`;
        if (open) {
          row.tabIndex = 0;
          row.setAttribute('role','button');
          row.addEventListener('click', () => showProfile(c.id));
          row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') showProfile(c.id); });
        }
        list.appendChild(row);
      });
      grid.appendChild(card);
    });
  }

  function revealOne(id, openProfile = false) {
    revealed.add(id);
    saveReveals();
    renderMap();
    if (openProfile) showProfile(id);
  }
  function revealRound(round) {
    contestants.filter(c => c.elimination === round).forEach(c => revealed.add(c.id));
    saveReveals();
    renderMap();
    toast(`Revealed ${round === 'debut' ? 'the debut 9' : round === 'finale' ? 'the finalists' : round + ' elimination'} trainees.`);
  }

  function showProfile(id) {
    const c = byId[id];
    const roundLabel = {
      first:'Eliminated — Round 1', second:'Eliminated — Round 2', third:'Eliminated — Round 3',
      finale:'Finalist', debut:'Debut lineup', withdrawn:'Withdrew'
    }[c.elimination];
    $('#profileContent').innerHTML = `
      <div class="profile-head">
        <div class="profile-avatar">${escapeHTML(slugInitials(c.name))}</div>
        <div><p class="eyebrow">${c.rank ? `BOYS PLANET #${c.rank}` : 'PRE-SHOW TRAINEE'}</p><h2>${escapeHTML(c.name)}</h2><p class="hint">${escapeHTML(c.currentDestination)}</p></div>
      </div>
      <div class="profile-tags"><span class="profile-tag">${escapeHTML(roundLabel)}</span><span class="profile-tag">${escapeHTML(c.status)}</span></div>
      <p class="profile-body">${escapeHTML(c.description)}</p>
      <div class="timeline">${c.history.map((h,i) => `<div><strong>${i+1}</strong> &nbsp; ${escapeHTML(h)}</div>`).join('')}</div>`;
    $('#profileDialog').showModal();
  }

  function initEpisodes() {
    const select = $('#episodeSelect');
    select.innerHTML = '';
    for (let i=1;i<=12;i++) {
      const option = document.createElement('option');
      option.value = i; option.textContent = `Episode ${i}`;
      select.appendChild(option);
    }
    select.value = '1';
  }

  function isAvailableAtEpisode(c, ep) {
    if (c.elimination === 'withdrawn' && c.endEpisode === 0) return false;
    return c.endEpisode >= ep || c.endEpisode === 99;
  }

  function renderPicks() {
    const ep = currentEpisode();
    const arr = getEpisodePicks(ep);
    const used = new Set(arr.filter(Boolean));
    renderSlots(arr);

    const q = $('#pickSearch').value.trim().toLowerCase();
    const hideEliminated = $('#hideEliminated').checked;
    const pool = $('#pickPool');
    pool.innerHTML = '';
    contestants
      .filter(c => c.rank !== null)
      .filter(c => !hideEliminated || isAvailableAtEpisode(c, ep))
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .sort((a,b) => a.name.localeCompare(b.name))
      .forEach(c => {
        const b = document.createElement('button');
        b.className = `pick-chip ${used.has(c.id) ? 'used' : ''} ${selectedPickId === c.id ? 'selected' : ''}`;
        b.textContent = c.name;
        b.draggable = !used.has(c.id);
        b.addEventListener('click', () => { selectedPickId = selectedPickId === c.id ? null : c.id; renderPicks(); });
        b.addEventListener('dragstart', e => { draggedPick = { type:'pool', id:c.id }; e.dataTransfer.effectAllowed = 'move'; });
        pool.appendChild(b);
      });
    renderHistory();
  }

  function renderSlots(arr) {
    const debut = $('#debutSlots');
    const potential = $('#potentialSlots');
    debut.innerHTML = ''; potential.innerHTML = '';
    arr.forEach((id, index) => {
      const slot = document.createElement('div');
      const number = index + 1;
      slot.className = `rank-slot ${number > 9 ? 'potential' : ''}`;
      slot.dataset.index = index;
      slot.innerHTML = `
        <span class="rank-number">${number}</span>
        <span class="slot-name ${id ? '' : 'slot-empty'}">${id ? escapeHTML(byId[id].name) : 'Drop or click a trainee here'}</span>
        ${id ? '<button class="remove-pick" aria-label="Remove pick">×</button>' : '<span></span>'}`;
      slot.addEventListener('click', e => {
        if (e.target.closest('.remove-pick')) {
          const next = getEpisodePicks(); next[index] = null; setEpisodePicks(currentEpisode(), next); selectedPickId = null; renderPicks(); return;
        }
        if (selectedPickId) placePick(selectedPickId, index);
      });
      if (id) {
        slot.draggable = true;
        slot.addEventListener('dragstart', e => { draggedPick = { type:'slot', index, id }; e.dataTransfer.effectAllowed = 'move'; });
      }
      slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('drag-over'); });
      slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
      slot.addEventListener('drop', e => {
        e.preventDefault(); slot.classList.remove('drag-over');
        if (!draggedPick) return;
        if (draggedPick.type === 'pool') placePick(draggedPick.id, index);
        else if (draggedPick.type === 'slot') moveSlot(draggedPick.index, index);
        draggedPick = null;
      });
      (number <= 9 ? debut : potential).appendChild(slot);
    });
  }

  function placePick(id, targetIndex) {
    const arr = getEpisodePicks();
    const old = arr.indexOf(id);
    if (old !== -1) arr[old] = null;
    if (arr[targetIndex] && arr[targetIndex] !== id) {
      if (old !== -1) arr[old] = arr[targetIndex];
      else {
        const empty = arr.findIndex(x => x === null);
        if (empty !== -1) arr[empty] = arr[targetIndex];
      }
    }
    arr[targetIndex] = id;
    setEpisodePicks(currentEpisode(), arr);
    selectedPickId = null;
    renderPicks();
  }

  function moveSlot(from, to) {
    const arr = getEpisodePicks();
    [arr[from], arr[to]] = [arr[to], arr[from]];
    setEpisodePicks(currentEpisode(), arr);
    renderPicks();
  }

  function renderHistory() {
    const grid = $('#historyGrid');
    grid.innerHTML = '';
    const episodes = Object.keys(picks).map(Number).filter(ep => picks[String(ep)]?.some(Boolean)).sort((a,b) => a-b);
    if (!episodes.length) {
      grid.innerHTML = '<p class="hint">Your saved episode lineups will appear here.</p>';
      return;
    }
    episodes.forEach(ep => {
      const card = document.createElement('article');
      card.className = 'history-card';
      const arr = getEpisodePicks(ep);
      card.innerHTML = `<h4>Episode ${ep}</h4><ol>${arr.map((id,i) => `<li>${id ? escapeHTML(byId[id].name) : '<span class="slot-empty">—</span>'}${i===8 ? '<hr>' : ''}</li>`).join('')}</ol>`;
      grid.appendChild(card);
    });
  }

  function copyPreviousEpisode() {
    const ep = currentEpisode();
    if (ep <= 1) return toast('Episode 1 has no previous episode.');
    const previous = getEpisodePicks(ep - 1);
    setEpisodePicks(ep, previous);
    renderPicks();
    toast(`Copied Episode ${ep - 1} into Episode ${ep}.`);
  }

  async function exportCurrent() {
    const ep = currentEpisode();
    const arr = getEpisodePicks(ep);
    const lines = [`MY BOYS PLANET PICKS — EPISODE ${ep}`, '', 'DEBUT'];
    arr.slice(0,9).forEach((id,i) => lines.push(`${i+1}. ${id ? byId[id].name : '—'}`));
    lines.push('', 'POTENTIAL DEBUT');
    arr.slice(9).forEach((id,i) => lines.push(`${i+10}. ${id ? byId[id].name : '—'}`));
    const text = lines.join('\n');
    try { await navigator.clipboard.writeText(text); toast('Top 11 copied to clipboard.'); }
    catch { window.prompt('Copy your Top 11:', text); }
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }
  function toast(message) {
    const old = $('.toast'); if (old) old.remove();
    const el = document.createElement('div'); el.className='toast'; el.textContent=message; document.body.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  function bindEvents() {
    $$('.tab').forEach(tab => tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.toggle('active', t === tab));
      $('#mapTab').classList.toggle('active', tab.dataset.tab === 'map');
      $('#picksTab').classList.toggle('active', tab.dataset.tab === 'picks');
      if (tab.dataset.tab === 'picks') renderPicks();
    }));
    $('#toggleNames').addEventListener('click', () => { showNames = !showNames; store.set(STORAGE.nameVisibility, String(showNames)); renderMap(); });
    $('#shuffleNames').addEventListener('click', () => { shuffleOrder = seededShuffle(contestants.map(c => c.id)); writeJSON(STORAGE.shuffle, shuffleOrder); renderMap(); });
    $$('.reveal-round').forEach(b => b.addEventListener('click', () => revealRound(b.dataset.round)));
    $('#resetReveals').addEventListener('click', () => {
      if (!confirm('Hide every revealed trainee again? Withdrawn trainees will stay visible.')) return;
      revealed.clear();
      contestants.filter(c => c.elimination === 'withdrawn').forEach(c => revealed.add(c.id));
      saveReveals();
      renderMap();
    });
    $('#closeDialog').addEventListener('click', () => $('#profileDialog').close());
    $('#profileDialog').addEventListener('click', e => { if (e.target === $('#profileDialog')) $('#profileDialog').close(); });
    $('#episodeSelect').addEventListener('change', () => { selectedPickId = null; renderPicks(); });
    $('#pickSearch').addEventListener('input', renderPicks);
  $('#mapSearch').addEventListener('input', renderMap);
    $('#hideEliminated').addEventListener('change', renderPicks);
    $('#copyPrevious').addEventListener('click', copyPreviousEpisode);
    $('#clearEpisode').addEventListener('click', () => {
      if (!confirm(`Clear your Episode ${currentEpisode()} Top 11?`)) return;
      setEpisodePicks(currentEpisode(), Array(11).fill(null)); selectedPickId = null; renderPicks();
    });
    $('#exportPicks').addEventListener('click', exportCurrent);
  }

  initEpisodes();
  bindEvents();
  renderMap();
  renderPicks();
})();
