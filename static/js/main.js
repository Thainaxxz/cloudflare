/* ─── DNS Manager – main.js ──────────────────────────────────────────────────── */

const API = {
  async _parseJson(r) {
    const text = await r.text();
    const data = text ? JSON.parse(text) : {};
    if (!r.ok) {
      const detail = data.detail;
      const msg = Array.isArray(detail) ? detail.map(e => e.msg).join(', ') : (detail || 'Erro desconhecido');
      throw new Error(msg);
    }
    return data;
  },
  async get(path) {
    const r = await fetch(path);
    return this._parseJson(r);
  },
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return this._parseJson(r);
  },
  async put(path, body) {
    const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return this._parseJson(r);
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE' });
    return this._parseJson(r);
  }
};

/* ─── State ──────────────────────────────────────────────────────────────────── */
const state = {
  records: [],
  filtered: [],
  editingId: null,
  zoneName: '',
};

/* ─── DOM refs ───────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const els = {
  statusBadge:    $('status-badge'),
  statusText:     $('status-text'),
  zoneName:       $('zone-name'),
  tableBody:      $('table-body'),
  searchInput:    $('search-input'),
  typeFilter:     $('type-filter'),
  totalCount:     $('total-count'),
  statsTotal:     $('stats-total'),
  statsProxied:   $('stats-proxied'),
  statsTypes:     $('stats-types'),
  statsZone:      $('stats-zone'),
  modalOverlay:   $('modal-overlay'),
  modalTitle:     $('modal-title'),
  form:           $('record-form'),
  toastContainer: $('toast-container'),
  confirmOverlay: $('confirm-overlay'),
  confirmMsg:     $('confirm-msg'),
  confirmYes:     $('confirm-yes'),
  confirmNo:      $('confirm-no'),
};

/* ─── Status ─────────────────────────────────────────────────────────────────── */
async function checkStatus() {
  try {
    const data = await API.get('/api/status');
    if (data.token_valid && data.zone_valid) {
      els.statusBadge.className = 'status-badge ok';
      els.statusText.textContent = 'Conectado';
      if (data.zone_name) {
        state.zoneName = data.zone_name;
        els.zoneName.textContent = data.zone_name;
        els.statsZone.textContent = data.zone_name;
      }
    } else {
      els.statusBadge.className = 'status-badge err';
      els.statusText.textContent = 'Erro de auth';
      showToast('Verifique o .env – token ou zone_id inválido', 'error');
    }
  } catch {
    els.statusBadge.className = 'status-badge err';
    els.statusText.textContent = 'Offline';
  }
}

/* ─── Helpers ────────────────────────────────────────────────────────────────── */
function typeClass(t) {
  const map = { A: 'badge-A', CNAME: 'badge-CNAME', MX: 'badge-MX', TXT: 'badge-TXT' };
  return map[t] || 'badge-default';
}

function ttlLabel(ttl) {
  if (ttl === 1)   return 'Auto';
  if (ttl < 60)    return `${ttl}s`;
  if (ttl < 3600)  return `${Math.round(ttl / 60)}m`;
  return `${Math.round(ttl / 3600)}h`;
}

/* Icons for table */
const icons = {
  edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
  del: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  proxyOn: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19c9-2.5 4-13-3-10C13 2 4 4 4 10c-5.5 3 .5 11 6.5 9"/></svg>`,
  proxyOff: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`
};

/* ─── Render ─────────────────────────────────────────────────────────────────── */
function renderTable(records) {
  if (!records.length) {
    els.tableBody.innerHTML = `
      <tr><td colspan="6" style="text-align:center; padding: 3rem; color: var(--text-tertiary);">
        Nenhum registro DNS encontrado.
      </td></tr>`;
    els.totalCount.textContent = '0 registros';
    return;
  }
  els.totalCount.textContent = `${records.length} registro${records.length !== 1 ? 's' : ''}`;

  els.tableBody.innerHTML = records.map(r => `
    <tr>
      <td><span class="badge ${typeClass(r.type)}">${r.type}</span></td>
      <td><div class="td-mono td-name" title="${r.name}">${r.name}</div></td>
      <td><div class="td-mono td-content" title="${r.content}">${r.content}</div></td>
      <td class="td-mono">${ttlLabel(r.ttl)}</td>
      <td>
        ${r.proxied
          ? `<span class="proxy-status proxy-on">${icons.proxyOn} Ativo</span>`
          : `<span class="proxy-status proxy-off">${icons.proxyOff} Direto</span>`}
      </td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-secondary edit-btn" style="padding: 0.3rem 0.6rem" data-id="${r.id}">${icons.edit} Editar</button>
          <button class="btn btn-danger-ghost del-btn" style="padding: 0.3rem 0.6rem" data-id="${r.id}" data-name="${r.name.replace(/"/g, '&quot;')}">${icons.del}</button>
        </div>
      </td>
    </tr>`).join('');
}

function updateStats() {
  const r = state.records;
  els.statsTotal.textContent = r.length;
  els.statsProxied.textContent = r.filter(x => x.proxied).length;
  const types = [...new Set(r.map(x => x.type))];
  els.statsTypes.textContent = types.length;
}

/* ─── Load Records ───────────────────────────────────────────────────────────── */
async function loadRecords(showSpinner = true) {
  if (showSpinner) {
    els.tableBody.innerHTML = `<tr><td colspan="6"><div class="spinner"></div></td></tr>`;
  }
  try {
    const data = await API.get('/api/records');
    state.records = data.records || [];
    applyFilters();
    updateStats();
  } catch (e) {
    showToast('Erro ao carregar: ' + e.message, 'error');
  }
}

function applyFilters() {
  const q = els.searchInput.value.toLowerCase();
  const t = els.typeFilter.value;
  state.filtered = state.records.filter(r => {
    const matchType = !t || r.type === t;
    const matchQ = !q || r.name.toLowerCase().includes(q) || r.content.toLowerCase().includes(q);
    return matchType && matchQ;
  });
  renderTable(state.filtered);
}

/* ─── Modal ──────────────────────────────────────────────────────────────────── */
function openModal(title) {
  els.modalTitle.textContent = title;
  els.modalOverlay.classList.add('open');
}
function closeModal() {
  els.modalOverlay.classList.remove('open');
  els.form.reset();
  state.editingId = null;
  $('field-priority').parentElement.style.display = 'none';
}

function openAdd() {
  state.editingId = null;
  openModal('Novo Registro DNS');
  $('field-type').value = 'A';
  $('field-proxied').checked = false;
  $('field-ttl').value = 1;
  handleTypeChange();
}

function openEdit(id) {
  const r = state.records.find(x => x.id === id);
  if (!r) return;
  state.editingId = id;
  openModal('Editar Registro');
  $('field-type').value = r.type;
  $('field-name').value = r.name;
  $('field-content').value = r.content;
  $('field-ttl').value = r.ttl;
  $('field-proxied').checked = r.proxied;
  $('field-priority').value = r.priority || 10;
  handleTypeChange();
}

function handleTypeChange() {
  const t = $('field-type').value;
  const proxied = $('field-proxied').closest('.proxy-toggle-wrapper');
  const priority = $('field-priority').parentElement;
  proxied.style.display = ['A', 'AAAA', 'CNAME'].includes(t) ? 'flex' : 'none';
  priority.style.display = t === 'MX' ? 'flex' : 'none';
}

async function submitForm(e) {
  e.preventDefault();
  const btn = $('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const isEditing = !!state.editingId;
  const payload = {
    type:    $('field-type').value,
    name:    $('field-name').value.trim(),
    content: $('field-content').value.trim(),
    ttl:     parseInt($('field-ttl').value),
    proxied: $('field-proxied').checked,
  };
  if (payload.type === 'MX') {
    payload.priority = parseInt($('field-priority').value) || 10;
  }

  try {
    if (isEditing) {
      await API.put(`/api/records/${state.editingId}`, payload);
      showToast('Registro atualizado.', 'success');
    } else {
      await API.post('/api/records', payload);
      showToast('Registro criado.', 'success');
    }
    closeModal();
    await loadRecords(false);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar Registro';
  }
}

/* ─── Delete ─────────────────────────────────────────────────────────────────── */
let pendingDeleteId = null;

function confirmDelete(id, name) {
  pendingDeleteId = id;
  els.confirmMsg.innerHTML = `Tem certeza que deseja excluir o registro <br><strong style="color:var(--text-primary)">${name}</strong>?`;
  els.confirmOverlay.classList.add('open');
}

async function executeDelete() {
  if (!pendingDeleteId) return;
  els.confirmYes.disabled = true;
  try {
    await API.del(`/api/records/${pendingDeleteId}`);
    showToast('Registro excluído.', 'success');
    els.confirmOverlay.classList.remove('open');
    await loadRecords(false);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    els.confirmYes.disabled = false;
    pendingDeleteId = null;
  }
}

/* ─── Toast ──────────────────────────────────────────────────────────────────── */
function showToast(msg, type = 'success') {
  const icon = type === 'success' 
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span style="display:flex; color: var(--${type})">${icon}</span><span>${msg}</span>`;
  els.toastContainer.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-out');
    t.addEventListener('animationend', () => t.remove());
  }, 3000);
}

/* ─── Listeners & Boot ───────────────────────────────────────────────────────── */
els.searchInput.addEventListener('input', applyFilters);
els.typeFilter.addEventListener('change', applyFilters);
els.form.addEventListener('submit', submitForm);
$('field-type').addEventListener('change', handleTypeChange);

$('btn-add').addEventListener('click', openAdd);
$('btn-refresh').addEventListener('click', () => loadRecords());
$('modal-close').addEventListener('click', closeModal);
$('btn-cancel').addEventListener('click', closeModal);
els.modalOverlay.addEventListener('click', e => { if (e.target === els.modalOverlay) closeModal(); });

els.confirmYes.addEventListener('click', executeDelete);
els.confirmNo.addEventListener('click', () => { els.confirmOverlay.classList.remove('open'); pendingDeleteId = null; });

els.tableBody.addEventListener('click', e => {
  const editBtn = e.target.closest('.edit-btn');
  const delBtn  = e.target.closest('.del-btn');
  if (editBtn) openEdit(editBtn.dataset.id);
  if (delBtn)  confirmDelete(delBtn.dataset.id, delBtn.dataset.name);
});

(async () => {
  await checkStatus();
  await loadRecords();
})();

/* ─── Theme Toggle (Light / Dark) ────────────────────────────────────────── */
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');

// Ícones SVG para o botão
const sunIcon = `<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>`;
const moonIcon = `<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`;

// Recupera o tema salvo ou usa 'dark' como padrão
const currentTheme = localStorage.getItem('theme') || 'dark';
document.body.setAttribute('data-theme', currentTheme);
themeIcon.innerHTML = currentTheme === 'light' ? moonIcon : sunIcon;

themeToggle.addEventListener('click', () => {
  const theme = document.body.getAttribute('data-theme');
  const newTheme = theme === 'dark' ? 'light' : 'dark';
  
  document.body.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  
  // Muda o ícone (se está no light, mostra a lua para mudar pro dark e vice-versa)
  themeIcon.innerHTML = newTheme === 'light' ? moonIcon : sunIcon;
});