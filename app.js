/* Dashboard Celeiro São Paulo - Voluntários + Resend */
// API na mesma origem (frontend servido pelo Express em / e API em /api/*)
const API_BASE = '';
const AUTH_STORAGE_KEY = 'celeiro_admin_auth';

const UFS_BR = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

let voluntarios = [];
let resumo = {};
let areasChart = null;
let dispChart = null;
let estadoChart = null;
let cidadeChart = null;
let checkins = [];
let checkinResumo = {};
let ministerioChart = null;
const selectedEmails = new Set();
let authToken = '';
let authUser = '';
let authRole = 'admin';
let authEmail = null;
let authMinisterioId = null;
let authMinisterioNome = null;
let authFotoUrl = null;
let eventosCheckin = [];
let eventoSelecionadoHoje = null;
const filters = {
  area: '',
  disponibilidade: '',
  estado: '',
  cidade: '',
  comCheckin: '', // '' = todos, 'com' = com check-in, 'sem' = sem check-in
};
const checkinFilters = {
  ministerio: '',
  search: '',
};

Chart.defaults.color = '#a0a0a0';
Chart.defaults.borderColor = '#2a2a2a';
Chart.defaults.font.family = "'DM Sans', sans-serif";

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const contentEl = document.getElementById('content');
const errorMsgEl = document.querySelector('.error-message');
const voluntariosBody = document.getElementById('voluntariosBody');
const searchBox = document.querySelector('.search-box');
const searchInput = document.getElementById('searchInput');
const selectAll = document.getElementById('selectAll');
const selectAllHeader = document.getElementById('selectAllHeader');
const countSelectedEl = document.getElementById('countSelected');
const btnOpenSend = document.getElementById('btnOpenSend');
const modal = document.getElementById('modalEmail');
const modalClose = document.getElementById('modalClose');
const modalCancel = document.getElementById('modalCancel');
const modalBackdrop = modal?.querySelector('.modal-backdrop');
const modalDestCount = document.getElementById('modalDestCount');
const emailSubject = document.getElementById('emailSubject');
const emailBody = document.getElementById('emailBody');
const btnSendEmail = document.getElementById('btnSendEmail');
const sendResult = document.getElementById('sendResult');
const authOverlay = document.getElementById('authOverlay');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPass = document.getElementById('loginPass');
const loginError = document.getElementById('loginError');
const btnLogin = document.getElementById('btnLogin');
const btnLogout = document.getElementById('btnLogout');
const authUserName = document.getElementById('authUserName');
const authUserInitial = document.getElementById('authUserInitial');
const filterArea = document.getElementById('filterArea');
const filterDisp = document.getElementById('filterDisponibilidade');
const filterEstado = document.getElementById('filterEstado');
const filterCidade = document.getElementById('filterCidade');
const filterComCheckin = document.getElementById('filterComCheckin');
const btnClearFilters = document.getElementById('btnClearFilters');
const activeFilters = document.getElementById('activeFilters');
const viewItems = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item');
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const checkinMinisterio = document.getElementById('checkinMinisterio');
const checkinSearch = document.getElementById('checkinSearch');
const btnClearCheckinFilters = document.getElementById('btnClearCheckinFilters');
const checkinTotal = document.getElementById('checkinTotal');
const checkinMinisterios = document.getElementById('checkinMinisterios');
const checkinHoje = document.getElementById('checkinHoje');
const checkinBody = document.getElementById('checkinBody');
const checkinCount = document.getElementById('checkinCount');
const navAdmin = document.getElementById('navAdmin');
const navLider = document.getElementById('navLider');
const navVoluntario = document.getElementById('navVoluntario');
const checkinData = document.getElementById('checkinData');
const checkinEvento = document.getElementById('checkinEvento');
const eventosCheckinBody = document.getElementById('eventosCheckinBody');
const btnNovoEvento = document.getElementById('btnNovoEvento');
const modalNovoEvento = document.getElementById('modalNovoEvento');
const formNovoEvento = document.getElementById('formNovoEvento');
const eventoData = document.getElementById('eventoData');
const eventoLabel = document.getElementById('eventoLabel');
const eventoAtivo = document.getElementById('eventoAtivo');
const modalNovoEventoClose = document.getElementById('modalNovoEventoClose');
const modalNovoEventoCancel = document.getElementById('modalNovoEventoCancel');
const formPerfil = document.getElementById('formPerfil');
const perfilNome = document.getElementById('perfilNome');
const perfilEmail = document.getElementById('perfilEmail');
const perfilNascimento = document.getElementById('perfilNascimento');
const perfilWhatsapp = document.getElementById('perfilWhatsapp');
const perfilPais = document.getElementById('perfilPais');
const perfilEstado = document.getElementById('perfilEstado');
const perfilCidade = document.getElementById('perfilCidade');
const perfilEvangelico = document.getElementById('perfilEvangelico');
const perfilIgreja = document.getElementById('perfilIgreja');
const perfilTempoIgreja = document.getElementById('perfilTempoIgreja');
const perfilVoluntarioIgreja = document.getElementById('perfilVoluntarioIgreja');
const perfilMinisterio = document.getElementById('perfilMinisterio');
const perfilDisponibilidade = document.getElementById('perfilDisponibilidade');
const perfilHorasSemana = document.getElementById('perfilHorasSemana');
const perfilAreas = document.getElementById('perfilAreas');
const eventosHojeList = document.getElementById('eventosHojeList');
const formConfirmarCheckin = document.getElementById('formConfirmarCheckin');
const confirmarMinisterio = document.getElementById('confirmarMinisterio');
const btnConfirmarCheckin = document.getElementById('btnConfirmarCheckin');
const meusCheckinsBody = document.getElementById('meusCheckinsBody');
const registerForm = document.getElementById('registerForm');
const registerNome = document.getElementById('registerNome');
const registerEmail = document.getElementById('registerEmail');
const registerPass = document.getElementById('registerPass');
const registerError = document.getElementById('registerError');
const btnRegister = document.getElementById('btnRegister');
const linkRegistro = document.getElementById('linkRegistro');
const linkLogin = document.getElementById('linkLogin');
const registerCard = document.getElementById('registerCard');
const loginCard = document.getElementById('loginCard');
const setupCard = document.getElementById('setupCard');
const setupForm = document.getElementById('setupForm');
const setupSecret = document.getElementById('setupSecret');
const setupEmail = document.getElementById('setupEmail');
const setupNome = document.getElementById('setupNome');
const setupSenha = document.getElementById('setupSenha');
const setupError = document.getElementById('setupError');
const setupSuccess = document.getElementById('setupSuccess');
const btnSetup = document.getElementById('btnSetup');
const linkSetup = document.getElementById('linkSetup');
const linkSetupVoltar = document.getElementById('linkSetupVoltar');
const setupLinkWrap = document.getElementById('setupLinkWrap');

function updateAuthUi() {
  const isLogged = Boolean(authToken);
  const isVoluntario = String(authRole || '').toLowerCase() === 'voluntario';
  const isLider = String(authRole || '').toLowerCase() === 'lider';
  const isAdmin = !isVoluntario && !isLider;
  if (authOverlay) authOverlay.style.display = isLogged ? 'none' : 'flex';
  if (!isLogged) {
    if (contentEl) contentEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
  } else {
    if (contentEl) contentEl.style.display = 'block';
  }
  if (btnLogout) btnLogout.disabled = !isLogged;
  const defaultName = isVoluntario ? 'Voluntário' : (isLider ? 'Líder' : 'Admin');
  if (authUserName) authUserName.textContent = authUser || defaultName;
  if (authUserInitial) authUserInitial.textContent = (authUser || defaultName).slice(0, 1).toUpperCase();
  const roleEl = document.getElementById('authUserRole');
  if (roleEl) roleEl.textContent = isVoluntario ? 'Voluntário' : (isLider ? (authMinisterioNome ? `Líder · ${authMinisterioNome}` : 'Líder') : 'Admin');
  if (navAdmin) navAdmin.style.display = isLogged && isAdmin ? 'flex' : 'none';
  if (navLider) navLider.style.display = isLogged && isLider ? 'flex' : 'none';
  if (navVoluntario) navVoluntario.style.display = isLogged && isVoluntario ? 'flex' : 'none';
  if (searchBox) searchBox.style.display = isLogged && isAdmin ? 'flex' : 'none';
  const btnRefresh = document.getElementById('btnRefresh');
  if (btnRefresh) btnRefresh.style.display = isLogged && isAdmin ? '' : 'none';
}

/** Limpa dados em memória e DOM de conteúdo por usuário, para não exibir tela do login anterior ao trocar de perfil. */
function clearUserContent() {
  voluntarios = [];
  resumo = {};
  checkins = [];
  checkinResumo = {};
  eventosCheckin = [];
  eventoSelecionadoHoje = null;
  selectedEmails.clear();
  currentView = '';
  ['eventos-checkin', 'checkin-hoje', 'meus-checkins', 'perfil', 'ministros', 'usuarios', 'checkin-ministerio'].forEach(v => setViewLoading(v, false));
  const perfilFields = [perfilNome, perfilEmail, perfilNascimento, perfilWhatsapp, perfilPais, perfilEstado, perfilCidade, perfilEvangelico, perfilIgreja, perfilTempoIgreja, perfilVoluntarioIgreja, perfilMinisterio, perfilDisponibilidade, perfilHorasSemana, perfilAreas];
  perfilFields.forEach(el => { if (el) el.value = ''; });
  if (meusCheckinsBody) meusCheckinsBody.innerHTML = '<tr><td colspan="3">Carregando...</td></tr>';
  if (eventosHojeList) eventosHojeList.innerHTML = '';
  if (eventosCheckinBody) eventosCheckinBody.innerHTML = '';
  if (voluntariosBody) voluntariosBody.innerHTML = '';
  if (checkinBody) checkinBody.innerHTML = '';
  if (formConfirmarCheckin) formConfirmarCheckin.style.display = 'none';
}

function setAuthSession(data) {
  clearUserContent();
  authToken = data?.token || '';
  const user = data?.user;
  authUser = typeof user === 'string' ? user : (user?.nome || user?.email || '');
  const rawRole = (user && user.role) ? user.role : (data?.role != null ? data.role : 'admin');
  authRole = (rawRole != null && rawRole !== '') ? String(rawRole).toLowerCase() : 'admin';
  authEmail = (user && user.email) ? user.email : (data?.email != null ? data.email : null);
  authMinisterioId = (user && user.ministerioId) ? user.ministerioId : (data?.ministerioId != null ? data.ministerioId : null);
  authMinisterioNome = (user && user.ministerioNome) ? user.ministerioNome : (data?.ministerioNome != null ? data.ministerioNome : null);
  authFotoUrl = (user && user.fotoUrl) ? user.fotoUrl : (data?.fotoUrl != null ? data.fotoUrl : null);
  if (authToken) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: authToken, user: authUser, role: authRole, email: authEmail, ministerioId: authMinisterioId, ministerioNome: authMinisterioNome, fotoUrl: authFotoUrl }));
  }
  updateAuthUi();
}

function clearAuthSession() {
  authToken = '';
  authUser = '';
  authRole = 'admin';
  authEmail = null;
  authMinisterioId = null;
  authMinisterioNome = null;
  authFotoUrl = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  clearUserContent();
  updateAuthUi();
}

function getAuthHeaders() {
  if (!authToken) return {};
  return { Authorization: `Bearer ${authToken}` };
}

async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}), ...getAuthHeaders() };
  const r = await fetch(url, { ...options, headers });
  if (r.status === 401) {
    clearAuthSession();
    throw new Error('AUTH_REQUIRED');
  }
  return r;
}

async function verifyAuth() {
  if (!authToken) return false;
  try {
    const r = await authFetch(`${API_BASE}/api/me`);
    if (!r.ok) return false;
    const data = await r.json();
    authUser = (data.user != null ? data.user : authUser);
    if (typeof authUser === 'object') authUser = authUser?.nome || authUser?.email || '';
    authRole = (data.role != null && data.role !== '') ? String(data.role).toLowerCase() : authRole;
    authEmail = data.email || authEmail;
    authMinisterioId = data.ministerioId != null ? data.ministerioId : authMinisterioId;
    authMinisterioNome = data.ministerioNome != null ? data.ministerioNome : authMinisterioNome;
    authFotoUrl = data.fotoUrl != null ? data.fotoUrl : authFotoUrl;
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored && authToken) {
      try {
        const parsed = JSON.parse(stored);
        parsed.role = authRole;
        parsed.user = authUser;
        parsed.email = authEmail;
        parsed.ministerioId = authMinisterioId;
        parsed.ministerioNome = authMinisterioNome;
        parsed.fotoUrl = authFotoUrl;
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(parsed));
      } catch (_) {}
    }
    updateAuthUi();
    return true;
  } catch (e) {
    clearAuthSession();
    return false;
  }
}

function showLoading(show) {
  if (loadingEl) loadingEl.style.display = show ? 'flex' : 'none';
  if (contentEl) contentEl.style.display = show ? 'none' : 'block';
  if (errorEl) errorEl.style.display = 'none';
}

function showError(msg) {
  if (loadingEl) loadingEl.style.display = 'none';
  if (contentEl) contentEl.style.display = 'none';
  if (errorEl) {
    errorEl.style.display = 'flex';
    if (errorMsgEl) errorMsgEl.textContent = msg || 'Erro ao carregar dados.';
  }
}

const ADMIN_ONLY_VIEWS = ['resumo', 'voluntarios', 'emails', 'ministros', 'usuarios', 'eventos-checkin', 'checkin'];
const LIDER_VIEWS = ['checkin-ministerio', 'perfil', 'meus-checkins'];

let currentView = '';
let ministrosList = [];
let usersList = [];
let checkinsMinisterio = [];
let checkinMinisterioResumo = {};

function setViewLoading(viewName, loading) {
  const section = document.querySelector(`.view[data-view="${viewName}"]`);
  if (section) section.classList.toggle('view-loading', loading);
}

const VIEW_META = {
  resumo: { title: 'Inscrição Voluntários', subtitle: 'Resumo das inscrições e envio de emails via Resend.', role: 'admin' },
  voluntarios: { title: 'Voluntários', subtitle: 'Lista completa e seleção para envio de email.', role: 'admin' },
  emails: { title: 'Enviar Email', subtitle: 'Selecione voluntários e envie via Resend.', role: 'admin' },
  ministros: { title: 'Ministérios', subtitle: 'Crie ministérios e defina líderes.', role: 'admin' },
  usuarios: { title: 'Usuários e perfis', subtitle: 'Altere perfil (voluntário, admin, líder) e veja histórico.', role: 'admin' },
  'eventos-checkin': { title: 'Eventos de check-in', subtitle: 'Crie um evento para o dia do culto.', role: 'admin' },
  checkin: { title: 'Check-in', subtitle: 'Registros por ministério e data. Filtre por data e evento.', role: 'admin' },
  'checkin-ministerio': { title: 'Check-ins do ministério', subtitle: 'Pessoas com check-in no seu ministério.', role: 'lider' },
  perfil: { title: 'Atualizar dados de perfil', subtitle: 'Revise e altere suas informações de cadastro.', role: 'voluntario' },
  'checkin-hoje': { title: 'Realizar check-in do dia', subtitle: 'Confirme sua presença no culto de hoje.', role: 'voluntario' },
  'meus-checkins': { title: 'Visualizar histórico próprio de check-ins', subtitle: 'Histórico de suas confirmações de presença.', role: 'voluntario' },
};

function setView(view) {
  const isVol = String(authRole || '').toLowerCase() === 'voluntario';
  const isLider = String(authRole || '').toLowerCase() === 'lider';
  const isAdmin = !isVol && !isLider;
  if (isVol && ADMIN_ONLY_VIEWS.includes(view)) view = 'perfil';
  if (isLider && !LIDER_VIEWS.includes(view)) view = 'checkin-ministerio';
  currentView = view;
  const meta = VIEW_META[view];
  const role = meta ? meta.role : 'admin';
  let nav = navAdmin;
  if (role === 'voluntario' || isVol) nav = navVoluntario;
  if (role === 'lider' || isLider) nav = navLider;
  if (nav) {
    nav.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });
  }
  viewItems.forEach(item => {
    const allowed = (item.dataset.view || '').split(' ').filter(Boolean);
    const roleMatch = (role === 'voluntario' ? isVol : (role === 'lider' ? isLider : isAdmin));
    const perfilForLider = (view === 'perfil' && isLider);
    const perfilForAdmin = (view === 'perfil' && isAdmin);
    const match = allowed.includes(view) && (roleMatch || perfilForLider || perfilForAdmin);
    item.classList.toggle('active', match);
  });
  if (pageTitle) pageTitle.textContent = (meta && meta.title) || 'Celeiro SP';
  if (pageSubtitle) pageSubtitle.textContent = (meta && meta.subtitle) || '';
  if (searchBox) searchBox.style.display = isAdmin && view !== 'checkin' && view !== 'eventos-checkin' && view !== 'ministros' && view !== 'usuarios' ? 'flex' : 'none';
  const viewsWithFetch = ['eventos-checkin', 'checkin-hoje', 'meus-checkins', 'perfil', 'ministros', 'usuarios', 'checkin-ministerio'];
  viewsWithFetch.forEach(v => setViewLoading(v, v === view));
  if (view === 'eventos-checkin') fetchEventosCheckin();
  if (view === 'checkin-hoje') fetchEventosHoje();
  if (view === 'meus-checkins') fetchMeusCheckins();
  if (view === 'perfil') fetchPerfil();
  if (view === 'ministros') fetchMinistros();
  if (view === 'usuarios') fetchUsers();
  if (view === 'checkin-ministerio') fetchCheckinsMinisterio();
  if (view === 'checkin' && isAdmin) {
    authFetch(`${API_BASE}/api/eventos-checkin`).then(r => r.ok ? r.json() : []).then(list => {
      eventosCheckin = list || [];
      if (checkinEvento) {
        checkinEvento.innerHTML = '<option value="">Todos os eventos</option>' + eventosCheckin.map(e => {
          const d = new Date(e.data);
          return `<option value="${e._id}">${e.label || d.toLocaleDateString('pt-BR')}</option>`;
        }).join('');
      }
      fetchCheckinsWithFilters();
    }).catch(() => fetchCheckinsWithFilters());
  }
}

async function fetchVoluntarios() {
  if (!authToken) {
    updateAuthUi();
    return;
  }
  showLoading(true);
  try {
    const r = await authFetch(`${API_BASE}/api/voluntarios`);
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${r.status}`);
    }
    const data = await r.json();
    voluntarios = data.voluntarios || [];
    resumo = data.resumo || {};
    render();
    showLoading(false);
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    showError(e.message || 'Verifique se o servidor está rodando em ' + API_BASE);
  }
}

async function fetchCheckins() {
  if (!authToken) { updateAuthUi(); return; }
  try {
    const r = await authFetch(`${API_BASE}/api/checkins`);
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${r.status}`);
    }
    const data = await r.json();
    checkins = data.checkins || [];
    checkinResumo = data.resumo || {};
    renderCheckins();
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    showError(e.message || 'Erro ao carregar check-ins.');
  }
}

/** Extrai datas únicas (YYYY-MM-DD) em UTC para bater com o filtro do backend. Preenche o select de filtro. */
function populateCheckinDataSelect(checkinsArray) {
  if (!checkinData) return;
  const list = Array.isArray(checkinsArray) ? checkinsArray : [];
  const dateSet = new Set();
  list.forEach(c => {
    const d = c.dataCheckin ? new Date(c.dataCheckin) : (c.timestampMs != null || c.timestamp ? new Date(c.timestampMs ?? c.timestamp) : null);
    if (d && !Number.isNaN(d.getTime())) {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      dateSet.add(`${yyyy}-${mm}-${dd}`);
    }
  });
  const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));
  const currentValue = checkinData.value;
  checkinData.innerHTML = '<option value="">Todas as datas</option>' + dates.map(dateStr => {
    const d = new Date(dateStr + 'T12:00:00');
    const label = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    return `<option value="${escapeAttr(dateStr)}">${escapeHtml(label)}</option>`;
  }).join('');
  if (dates.includes(currentValue)) checkinData.value = currentValue;
}

function fetchCheckinsWithFilters() {
  const params = new URLSearchParams();
  const dataFilter = checkinData?.value;
  if (dataFilter) params.set('data', dataFilter);
  if (checkinEvento?.value) params.set('eventoId', checkinEvento.value);
  if (checkinMinisterio?.value) params.set('ministerio', checkinMinisterio.value);
  authFetch(`${API_BASE}/api/checkins?${params}`).then(r => r.json()).then(data => {
    checkins = data.checkins || [];
    checkinResumo = data.resumo || {};
    if (!dataFilter) populateCheckinDataSelect(checkins);
    renderCheckins();
  }).catch(() => {});
}

async function fetchMinistros() {
  if (!authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/ministros`);
    if (!r.ok) return;
    ministrosList = await r.json();
    if (currentView !== 'ministros') return;
    renderMinistros();
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
  finally { setViewLoading('ministros', false); }
}

function renderMinistros() {
  const tbody = document.getElementById('ministrosBody');
  if (!tbody) return;
  if (!ministrosList.length) {
    tbody.innerHTML = '<tr><td colspan="3">Nenhum ministério. Clique em "Novo ministério" para criar.</td></tr>';
    return;
  }
  tbody.innerHTML = ministrosList.map(m => {
    const liderNome = (m.lider && m.lider.nome) ? escapeHtml(m.lider.nome) : '—';
    return `<tr data-ministerio-id="${escapeAttr(m._id)}">
      <td>${escapeHtml(m.nome || '—')}</td>
      <td>${liderNome}</td>
      <td><button type="button" class="btn btn-sm btn-primary" data-assign-lider="${escapeAttr(m._id)}" data-ministerio-nome="${escapeAttr(m.nome || '')}">Definir líder</button></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-assign-lider]').forEach(btn => {
    btn.addEventListener('click', () => openAssignLider(btn.getAttribute('data-assign-lider'), btn.getAttribute('data-ministerio-nome')));
  });
}

async function createMinisterio(e) {
  e.preventDefault();
  const nome = document.getElementById('ministerioNome')?.value?.trim();
  if (!nome) return;
  try {
    const r = await authFetch(`${API_BASE}/api/ministros`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    document.getElementById('modalNovoMinisterio')?.classList.remove('open');
    document.getElementById('formNovoMinisterio')?.reset();
    fetchMinistros();
  } catch (err) { alert(err.message || 'Erro ao criar ministério.'); }
}

let assignLiderMinisterioId = null;
async function openAssignLider(ministerioId, ministerioNome) {
  assignLiderMinisterioId = ministerioId;
  const nomeEl = document.getElementById('assignLiderMinisterioNome');
  if (nomeEl) nomeEl.textContent = `Ministério: ${ministerioNome || ministerioId}`;
  if (!usersList.length) {
    try {
      const r = await authFetch(`${API_BASE}/api/users`);
      if (r.ok) usersList = await r.json();
    } catch (_) {}
  }
  const sel = document.getElementById('assignLiderSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Selecione um usuário</option>' + (usersList || []).map(u => {
    const label = `${u.nome || u.email} (${u.role || 'voluntario'})`;
    return `<option value="${escapeAttr(u._id)}">${escapeHtml(label)}</option>`;
  }).join('');
  document.getElementById('modalAssignLider')?.classList.add('open');
}

async function assignLider() {
  if (!assignLiderMinisterioId) return;
  const userId = document.getElementById('assignLiderSelect')?.value;
  if (!userId) { alert('Selecione um usuário.'); return; }
  try {
    const r = await authFetch(`${API_BASE}/api/ministros/${assignLiderMinisterioId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liderId: userId }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    document.getElementById('modalAssignLider')?.classList.remove('open');
    assignLiderMinisterioId = null;
    fetchMinistros();
    fetchUsers();
  } catch (err) { alert(err.message || 'Erro ao definir líder.'); }
}

async function fetchUsers() {
  if (!authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/users`);
    if (!r.ok) return;
    usersList = await r.json();
    if (currentView !== 'usuarios') return;
    renderUsers();
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
  finally { setViewLoading('usuarios', false); }
}

function renderUsers() {
  const tbody = document.getElementById('usuariosBody');
  if (!tbody) return;
  if (!usersList.length) {
    tbody.innerHTML = '<tr><td colspan="5">Nenhum usuário.</td></tr>';
    return;
  }
  const roleLabel = r => ({ admin: 'Admin', voluntario: 'Voluntário', lider: 'Líder' }[r] || r);
  tbody.innerHTML = usersList.map(u => {
    const minNome = (u.ministerioId && u.ministerioId.nome) ? u.ministerioId.nome : (u.role === 'lider' ? '—' : '');
    return `<tr>
      <td>${escapeHtml(u.nome || '—')}</td>
      <td>${escapeHtml(u.email || '—')}</td>
      <td>${escapeHtml(roleLabel(u.role))}</td>
      <td>${escapeHtml(minNome)}</td>
      <td><button type="button" class="btn btn-sm btn-primary" data-user-role="${escapeAttr(u._id)}" data-user-email="${escapeAttr(u.email)}">Alterar perfil</button> <button type="button" class="btn btn-sm btn-ghost" data-user-history="${escapeAttr(u._id)}">Histórico</button></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-user-role]').forEach(btn => {
    btn.addEventListener('click', () => openModalUserRole(btn.getAttribute('data-user-role'), btn.getAttribute('data-user-email')));
  });
  tbody.querySelectorAll('[data-user-history]').forEach(btn => {
    btn.addEventListener('click', () => fetchUserHistory(btn.getAttribute('data-user-history')));
  });
}

let modalUserRoleUserId = null;
async function openModalUserRole(userId, email) {
  modalUserRoleUserId = userId;
  if (!ministrosList.length) {
    try {
      const r = await authFetch(`${API_BASE}/api/ministros`);
      if (r.ok) ministrosList = await r.json();
    } catch (_) {}
  }
  const u = (usersList || []).find(x => String(x._id) === String(userId));
  document.getElementById('modalUserRoleEmail').textContent = email || userId;
  const roleSel = document.getElementById('userRoleSelect');
  const minGrp = document.getElementById('userMinisterioGroup');
  const minSel = document.getElementById('userMinisterioSelect');
  if (roleSel) roleSel.value = u?.role || 'voluntario';
  if (minSel) {
    minSel.innerHTML = '<option value="">Selecione o ministério</option>' + (ministrosList || []).map(m => `<option value="${escapeAttr(m._id)}">${escapeHtml(m.nome)}</option>`).join('');
    if (u?.ministerioId && u.ministerioId._id) minSel.value = u.ministerioId._id;
    else if (u?.ministerioId) minSel.value = u.ministerioId;
  }
  minGrp.style.display = (roleSel?.value === 'lider') ? 'block' : 'none';
  const formBody = document.getElementById('modalUserRoleFormBody');
  const historyBody = document.getElementById('modalUserHistoryBody');
  if (formBody) formBody.style.display = 'block';
  if (historyBody) historyBody.style.display = 'none';
  document.getElementById('modalUserRole')?.classList.add('open');
}

async function saveUserRole() {
  if (!modalUserRoleUserId) return;
  const role = document.getElementById('userRoleSelect')?.value;
  const ministerioId = document.getElementById('userMinisterioSelect')?.value || null;
  try {
    const r = await authFetch(`${API_BASE}/api/users/${modalUserRoleUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, ministerioId: role === 'lider' ? ministerioId : undefined }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    closeModalUserRole();
    modalUserRoleUserId = null;
    fetchUsers();
    if (assignLiderMinisterioId === undefined) fetchMinistros();
  } catch (err) { alert(err.message || 'Erro ao salvar.'); }
}

async function fetchUserHistory(userId) {
  try {
    const r = await authFetch(`${API_BASE}/api/users/${userId}/history`);
    if (!r.ok) return;
    const list = await r.json();
    const ul = document.getElementById('userHistoryList');
    const body = document.getElementById('modalUserHistoryBody');
    const formBody = document.getElementById('modalUserRoleFormBody');
    if (!ul || !body) return;
    if (formBody) formBody.style.display = 'none';
    body.style.display = 'block';
    if (!list.length) ul.innerHTML = '<li>Nenhuma alteração registrada.</li>';
    else ul.innerHTML = list.map(h => {
      const data = h.createdAt ? new Date(h.createdAt).toLocaleString('pt-BR') : '—';
      const by = (h.changedBy && h.changedBy.nome) ? h.changedBy.nome : 'Sistema';
      const min = (h.ministerioId && h.ministerioId.nome) ? h.ministerioId.nome : '';
      const text = `${h.fromRole || '?'} → ${h.toRole} ${min ? ` · ${min}` : ''} (${data}, por ${by})`;
      return `<li>${escapeHtml(text)}</li>`;
    }).join('');
    document.getElementById('modalUserRole')?.classList.add('open');
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
}

async function fetchCheckinsMinisterio() {
  if (!authToken) return;
  try {
    const params = new URLSearchParams();
    const dataVal = document.getElementById('checkinMinisterioData')?.value;
    if (dataVal) params.set('data', dataVal);
    const r = await authFetch(`${API_BASE}/api/checkins/ministerio?${params.toString()}`);
    if (!r.ok) {
      if (currentView !== 'checkin-ministerio') return;
      document.getElementById('checkinMinisterioTotal').textContent = '0';
      const body = document.getElementById('checkinMinisterioBody');
      if (body) body.innerHTML = '<tr><td colspan="4">Sem permissão ou sem ministério.</td></tr>';
      return;
    }
    const data = await r.json();
    checkinsMinisterio = data.checkins || [];
    checkinMinisterioResumo = data.resumo || {};
    if (currentView !== 'checkin-ministerio') return;
    renderCheckinsMinisterio();
    const dateSelect = document.getElementById('checkinMinisterioData');
    if (dateSelect) {
      const currentDataVal = dateSelect.value || dataVal;
      const dateSet = new Set();
      checkinsMinisterio.forEach(c => {
        const d = c.dataCheckin ? new Date(c.dataCheckin) : (c.timestampMs != null ? new Date(c.timestampMs) : null);
        if (d && !Number.isNaN(d.getTime())) dateSet.add(d.toISOString().slice(0, 10));
      });
      if (currentDataVal) dateSet.add(currentDataVal);
      const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));
      dateSelect.innerHTML = '<option value="">Todas as datas</option>' + dates.map(d => `<option value="${escapeAttr(d)}">${escapeHtml(new Date(d + 'T12:00:00').toLocaleDateString('pt-BR'))}</option>`).join('');
      if (currentDataVal && dates.includes(currentDataVal)) dateSelect.value = currentDataVal;
    }
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
  finally { setViewLoading('checkin-ministerio', false); }
}

function renderCheckinsMinisterio() {
  const totalEl = document.getElementById('checkinMinisterioTotal');
  const bodyEl = document.getElementById('checkinMinisterioBody');
  if (totalEl) totalEl.textContent = checkinsMinisterio.length;
  if (!bodyEl) return;
  if (!checkinsMinisterio.length) {
    bodyEl.innerHTML = '<tr><td colspan="4">Nenhum check-in no ministério para o filtro selecionado.</td></tr>';
    return;
  }
  bodyEl.innerHTML = checkinsMinisterio.map(c => {
    const email = (c.email || '').toLowerCase().trim();
    return `<tr>
      <td class="cell-with-avatar"><span class="cell-avatar">${avatarHtml(c.fotoUrl, c.nome)}</span><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(c.nome || '—')}</button></td>
      <td><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(c.email || '—')}</button></td>
      <td>${escapeHtml(c.ministerio || '—')}</td>
      <td>${escapeHtml(c.timestamp || '—')}</td>
    </tr>`;
  }).join('');
  bodyEl.querySelectorAll('.link-voluntario').forEach(btn => {
    btn.addEventListener('click', () => openPerfilVoluntario(btn.getAttribute('data-email'), { checkinsList: checkinsMinisterio }));
  });
}

async function fetchEventosCheckin() {
  if (!authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin?_t=${Date.now()}`);
    if (!r.ok) return;
    const list = await r.json();
    if (currentView !== 'eventos-checkin') return;
    eventosCheckin = list || [];
    if (eventosCheckinBody) {
      if (!eventosCheckin.length) {
        eventosCheckinBody.innerHTML = '<tr><td colspan="4">Nenhum evento. Clique em "Novo evento de check-in" para criar.</td></tr>';
      } else {
        eventosCheckinBody.innerHTML = eventosCheckin.map(e => {
          const d = new Date(e.data);
          const label = e.label || d.toLocaleDateString('pt-BR');
          const ativo = e.ativo !== false;
          const statusText = ativo ? 'Ativo' : 'Inativo';
          const btnLabel = ativo ? 'Desligar' : 'Ligar';
          return `<tr data-event-id="${escapeAttr(e._id || '')}">
            <td>${d.toLocaleDateString('pt-BR')}</td>
            <td>${escapeHtml(label)}</td>
            <td><span class="evento-status ${ativo ? 'evento-status-ativo' : 'evento-status-inativo'}">${statusText}</span></td>
            <td><button type="button" class="btn btn-sm ${ativo ? 'btn-ghost' : 'btn-primary'}" data-event-toggle="${escapeAttr(e._id || '')}">${btnLabel}</button></td>
          </tr>`;
        }).join('');
        eventosCheckinBody.querySelectorAll('[data-event-toggle]').forEach(btn => {
          btn.addEventListener('click', () => toggleEventoAtivo(btn.getAttribute('data-event-toggle')));
        });
      }
    }
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
  finally { setViewLoading('eventos-checkin', false); }
}

async function toggleEventoAtivo(eventoId) {
  if (!eventoId || !authToken) return;
  const evento = (eventosCheckin || []).find(e => String(e._id) === String(eventoId));
  if (!evento) return;
  const novoAtivo = evento.ativo !== false ? false : true;
  const btn = eventosCheckinBody?.querySelector(`[data-event-toggle="${eventoId.replace(/"/g, '&quot;')}"]`);
  if (btn) btn.disabled = true;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin/${eventoId}/ativo`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: novoAtivo }),
    });
    const errData = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(errData.error || 'Falha');
    await fetchEventosCheckin();
  } catch (e) {
    alert(e.message || 'Erro ao alterar status.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function fetchEventosHoje() {
  if (!authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin/hoje`);
    const data = await r.json().catch(() => []);
    const list = Array.isArray(data) ? data : [];
    if (!r.ok) {
      if (eventosHojeList) eventosHojeList.innerHTML = '<p class="auth-subtitle">Não foi possível carregar os eventos de hoje. Tente novamente.</p>';
      if (formConfirmarCheckin) formConfirmarCheckin.style.display = 'none';
      return;
    }
    if (currentView !== 'checkin-hoje') return;
    if (eventosHojeList) {
      if (!list.length) {
        eventosHojeList.innerHTML = '<p class="auth-subtitle">Nenhum evento de check-in aberto para hoje. O admin precisa criar um evento para o dia do culto e deixá-lo <strong>ativo</strong>.</p>';
        if (formConfirmarCheckin) formConfirmarCheckin.style.display = 'none';
      } else {
        eventoSelecionadoHoje = list[0]._id;
        eventosHojeList.innerHTML = list.map(e => {
          const d = new Date(e.data);
          const label = e.label || d.toLocaleDateString('pt-BR');
          return `<div class="kpi-card evento-hoje-card" style="margin-bottom:12px"><strong>${escapeHtml(label)}</strong><br><small>${d.toLocaleDateString('pt-BR')}</small></div>`;
        }).join('');
        if (formConfirmarCheckin) formConfirmarCheckin.style.display = 'block';
      }
    }
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    if (eventosHojeList) eventosHojeList.innerHTML = '<p class="auth-subtitle">Erro ao carregar eventos. Verifique sua conexão.</p>';
    if (formConfirmarCheckin) formConfirmarCheckin.style.display = 'none';
  }
  finally { setViewLoading('checkin-hoje', false); }
}

async function confirmarCheckin() {
  if (!eventoSelecionadoHoje || !authToken) return;
  const ministerio = (confirmarMinisterio?.value || '').trim();
  try {
    const r = await authFetch(`${API_BASE}/api/checkins/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventoId: eventoSelecionadoHoje, ministerio }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Falha ao confirmar');
    alert('Check-in realizado com sucesso!');
    confirmarMinisterio.value = '';
    fetchEventosHoje();
    fetchMeusCheckins();
  } catch (e) {
    alert(e.message || 'Erro ao confirmar check-in.');
  }
}

function formatNascimentoParaInput(val) {
  if (!val) return '';
  const d = typeof val === 'string' ? new Date(val) : val;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function populatePerfilEstado() {
  const sel = document.getElementById('perfilEstado');
  if (!sel || sel.options.length > 1) return;
  sel.innerHTML = '<option value="">Selecione o estado (UF)</option>' + UFS_BR.map(uf => `<option value="${uf}">${uf}</option>`).join('');
}

function updatePerfilFotoUI() {
  const img = document.getElementById('perfilFotoImg');
  const placeholder = document.getElementById('perfilFotoPlaceholder');
  const btnUpload = document.getElementById('btnPerfilFotoUpload');
  const btnExcluir = document.getElementById('btnPerfilFotoExcluir');
  const url = authFotoUrl ? (authFotoUrl.startsWith('http') ? authFotoUrl : `${API_BASE}${authFotoUrl}`) : '';
  if (img) {
    if (url) {
      img.src = url;
      img.style.display = '';
      img.alt = 'Sua foto';
    } else {
      img.src = '';
      img.style.display = 'none';
    }
  }
  if (placeholder) placeholder.style.display = url ? 'none' : 'flex';
  if (btnUpload) {
    btnUpload.textContent = url ? 'Trocar imagem' : 'Enviar foto';
  }
  if (btnExcluir) btnExcluir.style.display = url ? '' : 'none';
}

async function fetchPerfil() {
  if (!authToken) return;
  populatePerfilEstado();
  try {
    const r = await authFetch(`${API_BASE}/api/me/perfil`);
    if (!r.ok) return;
    const perfil = await r.json();
    if (currentView !== 'perfil') return;
    if (perfil) {
      if (perfilNome) perfilNome.value = perfil.nome || '';
      if (perfilEmail) perfilEmail.value = perfil.email || '';
      if (perfilNascimento) perfilNascimento.value = formatNascimentoParaInput(perfil.nascimento);
      if (perfilWhatsapp) perfilWhatsapp.value = perfil.whatsapp || '';
      if (perfilPais) perfilPais.value = perfil.pais || '';
      if (perfilEstado) perfilEstado.value = perfil.estado || '';
      if (perfilCidade) perfilCidade.value = perfil.cidade || '';
      if (perfilEvangelico) perfilEvangelico.value = perfil.evangelico || '';
      if (perfilIgreja) perfilIgreja.value = perfil.igreja || '';
      if (perfilTempoIgreja) perfilTempoIgreja.value = perfil.tempoIgreja || '';
      if (perfilVoluntarioIgreja) perfilVoluntarioIgreja.value = perfil.voluntarioIgreja || '';
      if (perfilMinisterio) perfilMinisterio.value = perfil.ministerio || '';
      if (perfilDisponibilidade) perfilDisponibilidade.value = perfil.disponibilidade || '';
      if (perfilHorasSemana) perfilHorasSemana.value = perfil.horasSemana || '';
      if (perfilAreas) perfilAreas.value = Array.isArray(perfil.areas) ? perfil.areas.join(', ') : (perfil.areas || '');
    } else {
      [perfilNome, perfilEmail, perfilNascimento, perfilWhatsapp, perfilPais, perfilCidade, perfilEvangelico, perfilIgreja, perfilTempoIgreja, perfilVoluntarioIgreja, perfilMinisterio, perfilDisponibilidade, perfilHorasSemana, perfilAreas].forEach(el => { if (el) el.value = ''; });
      if (perfilEstado) perfilEstado.value = '';
    }
    const rMe = await authFetch(`${API_BASE}/api/me`);
    if (rMe.ok) {
      const meData = await rMe.json();
      if (meData.fotoUrl != null) authFotoUrl = meData.fotoUrl;
    }
    updatePerfilFotoUI();
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
  finally { setViewLoading('perfil', false); }
}

async function savePerfil(e) {
  e.preventDefault();
  if (!authToken) return;
  const areasStr = perfilAreas?.value?.trim();
  const payload = {
    nome: perfilNome?.value?.trim(),
    nascimento: perfilNascimento?.value?.trim() || undefined,
    whatsapp: perfilWhatsapp?.value?.trim(),
    pais: perfilPais?.value?.trim(),
    estado: perfilEstado?.value?.trim(),
    cidade: perfilCidade?.value?.trim(),
    evangelico: perfilEvangelico?.value?.trim(),
    igreja: perfilIgreja?.value?.trim(),
    tempoIgreja: perfilTempoIgreja?.value?.trim(),
    voluntarioIgreja: perfilVoluntarioIgreja?.value?.trim(),
    ministerio: perfilMinisterio?.value?.trim(),
    disponibilidade: perfilDisponibilidade?.value?.trim(),
    horasSemana: perfilHorasSemana?.value?.trim(),
    areas: areasStr ? areasStr.split(',').map(a => a.trim()).filter(Boolean) : [],
  };
  try {
    const r = await authFetch(`${API_BASE}/api/me/perfil`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha ao salvar');
    alert('Perfil salvo.');
  } catch (e) {
    alert(e.message || 'Erro ao salvar perfil.');
  }
}

async function fetchPerfilExtras() {
  if (!authToken) return;
  const containerCheckins = document.getElementById('perfilMeusCheckins');
  const containerDisponiveis = document.getElementById('perfilCheckinsDisponiveis');
  const formConfirmar = document.getElementById('perfilFormConfirmar');

  try {
    const rCheckins = await authFetch(`${API_BASE}/api/checkins`);
    if (rCheckins.ok) {
      const data = await rCheckins.json();
      const list = Array.isArray(data.checkins) ? data.checkins : [];
      checkins = list;
      if (containerCheckins) {
        const sorted = [...list].sort((a, b) => (b.timestampMs ?? (b.timestamp ? new Date(b.timestamp).getTime() : 0)) - (a.timestampMs ?? (a.timestamp ? new Date(a.timestamp).getTime() : 0)));
        if (!sorted.length) containerCheckins.innerHTML = '<p class="perfil-checkins-empty">Nenhum check-in registrado.</p>';
        else containerCheckins.innerHTML = `<div class="perfil-checkins-list">${sorted.map(c => {
          const dataStr = formatCheckinDate(c.timestamp);
          const min = escapeHtml(String(c.ministerio || '—').trim());
          return `<span class="perfil-checkin-badge">${dataStr} · ${min}</span>`;
        }).join('')}</div>`;
      }
    }
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; if (containerCheckins) containerCheckins.innerHTML = '<p class="perfil-checkins-empty">Não foi possível carregar.</p>'; }

  try {
    const rHoje = await authFetch(`${API_BASE}/api/eventos-checkin/hoje`);
    if (!rHoje.ok || !containerDisponiveis) return;
    const eventos = await rHoje.json();
    if (!eventos || !eventos.length) {
      containerDisponiveis.innerHTML = '<p class="auth-subtitle">Nenhum evento de check-in para hoje.</p>';
      if (formConfirmar) formConfirmar.style.display = 'none';
      return;
    }
    eventoSelecionadoHoje = eventos[0]._id;
    containerDisponiveis.innerHTML = eventos.map(e => {
      const d = new Date(e.data);
      const label = e.label || d.toLocaleDateString('pt-BR');
      return `<div class="kpi-card perfil-evento-card"><strong>${escapeHtml(label)}</strong><br><small>${d.toLocaleDateString('pt-BR')}</small></div>`;
    }).join('');
    if (formConfirmar) formConfirmar.style.display = 'block';
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; if (containerDisponiveis) containerDisponiveis.innerHTML = '<p class="auth-subtitle">Não foi possível carregar os eventos.</p>'; if (formConfirmar) formConfirmar.style.display = 'none'; }
}

async function confirmarCheckinDesdePerfil() {
  if (!eventoSelecionadoHoje || !authToken) return;
  const ministerio = (document.getElementById('perfilConfirmarMinisterio')?.value || '').trim();
  try {
    const r = await authFetch(`${API_BASE}/api/checkins/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventoId: eventoSelecionadoHoje, ministerio }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Falha ao confirmar');
    if (document.getElementById('perfilConfirmarMinisterio')) document.getElementById('perfilConfirmarMinisterio').value = '';
    fetchPerfilExtras();
  } catch (e) {
    alert(e.message || 'Erro ao confirmar check-in.');
  }
}

async function fetchEscalaFutura() {
  const container = document.getElementById('escalaFuturaList');
  if (!container || !authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin`);
    if (!r.ok) return;
    const list = await r.json();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const futuros = (list || []).filter(e => {
      const d = new Date(e.data);
      d.setHours(0, 0, 0, 0);
      return d >= today;
    }).sort((a, b) => new Date(a.data) - new Date(b.data));
    if (!futuros.length) {
      container.innerHTML = '<p class="auth-subtitle">Nenhum evento futuro cadastrado. Os eventos aparecem aqui quando o admin criar datas de check-in.</p>';
      return;
    }
    container.innerHTML = futuros.map(e => {
      const d = new Date(e.data);
      const label = e.label || d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return `<div class="kpi-card" style="margin-bottom:12px"><strong>${escapeHtml(label)}</strong><br><small>${d.toLocaleDateString('pt-BR')}</small></div>`;
    }).join('');
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; container.innerHTML = '<p class="auth-subtitle">Não foi possível carregar a escala.</p>'; }
}

async function fetchMeusCheckins() {
  if (!authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/checkins`);
    if (!r.ok) return;
    const data = await r.json();
    if (currentView !== 'meus-checkins') return;
    const list = data.checkins || [];
    if (meusCheckinsBody) {
      meusCheckinsBody.innerHTML = list.length ? list.map(c => {
        const dataStr = c.timestamp ? new Date(c.timestampMs || c.timestamp).toLocaleDateString('pt-BR') : '—';
        const horaStr = c.timestamp ? new Date(c.timestampMs || c.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
        return `<tr><td>${dataStr}</td><td>${escapeHtml(c.ministerio || '—')}</td><td>${horaStr}</td></tr>`;
      }).join('') : '<tr><td colspan="3">Nenhum check-in registrado.</td></tr>';
    }
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
  finally { setViewLoading('meus-checkins', false); }
}

async function fetchAllData() {
  await fetchVoluntarios();
  await fetchCheckins();
}

function render() {
  updateKpis();
  updateFilters();
  renderCharts();
  renderTable(getFilteredVoluntarios());  // Renderiza a lista filtrada, não a completa
  updateSelectedCount();
  const cadastroLinkInput = document.getElementById('cadastroLinkInput');
  if (cadastroLinkInput) cadastroLinkInput.value = getCadastroLinkUrl();
}

function updateKpis() {
  const filtered = getFilteredVoluntarios();
  const total = filtered.length;
  const emailsComCheckin = getEmailsComCheckin();
  const vol = Array.isArray(voluntarios) ? voluntarios : [];
  const comCheckinCount = vol.filter(v => emailsComCheckin.has((v.email || '').toLowerCase().trim())).length;
  const semCheckinCount = vol.length - comCheckinCount;
  const soCheckinCount = getSoCheckinList().length;
  const totalGeral = vol.length + soCheckinCount;

  const areasSet = new Set();
  filtered.forEach(v => {
    if (v._soCheckin) return;
    (v.areas || '').split(',').map(a => a.trim()).filter(Boolean).forEach(a => {
      areasSet.add(a);
    });
  });
  const areasCount = areasSet.size;

  const sel = selectedEmails.size;
  const elTotal = document.getElementById('kpiTotal');
  const elAreas = document.getElementById('kpiAreas');
  const elSelected = document.getElementById('kpiSelected');
  const elComCheckin = document.getElementById('kpiComCheckin');
  const elSemCheckin = document.getElementById('kpiSemCheckin');
  const elSoCheckin = document.getElementById('kpiSoCheckin');
  const elTotalGeral = document.getElementById('kpiTotalGeral');
  if (elTotal) elTotal.textContent = total;
  if (elAreas) elAreas.textContent = areasCount;
  if (elSelected) elSelected.textContent = sel;
  if (elComCheckin) elComCheckin.textContent = comCheckinCount;
  if (elSemCheckin) elSemCheckin.textContent = semCheckinCount;
  if (elSoCheckin) elSoCheckin.textContent = soCheckinCount;
  if (elTotalGeral) elTotalGeral.textContent = totalGeral;
  const tableCount = document.getElementById('tableCount');
  const voluntariosCountTop = document.getElementById('voluntariosCountTop');
  if (tableCount) tableCount.textContent = total;
  if (voluntariosCountTop) voluntariosCountTop.textContent = total;
}

function renderCharts() {
  const filtered = getFilteredVoluntarios();
  
  // Calcular dados baseado na lista FILTRADA
  const areasData = countByMultiValueField(filtered, 'areas');
  const dispData = countByMultiValueField(filtered, 'disponibilidade');
  const estadoData = countByField(filtered, 'estado');
  const cidadeData = countByField(filtered, 'cidade');


  const ctxAreas = document.getElementById('areasChart');
  if (ctxAreas) {
    if (areasChart) areasChart.destroy();
    const topAreas = areasData.slice(0, 12).map(([label, value]) => ({
      label,
      short: truncate(label, 25),
      value,
    }));
    areasChart = new Chart(ctxAreas, {
      type: 'bar',
      data: {
        labels: topAreas.map(a => a.short),
        datasets: [{
          label: 'Inscrições',
          data: topAreas.map(a => a.value),
          backgroundColor: 'rgba(245, 158, 11, 0.6)',
          borderColor: '#f59e0b',
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        onClick: (_, elements) => {
          const el = elements?.[0];
          if (!el) return;
          const label = topAreas[el.index]?.label;
          toggleFilter('area', label);
        },
        scales: {
          x: { beginAtZero: true, grid: { color: 'rgba(42,42,42,0.5)' } },
          y: { grid: { display: false } },
        },
      },
    });
  }

  const ctxDisp = document.getElementById('disponibilidadeChart');
  if (ctxDisp) {
    if (dispChart) dispChart.destroy();
    const colors = ['#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];
    const dispItems = dispData.map(([label, value]) => ({
      label,
      short: truncate(label, 20),
      value,
    }));
    dispChart = new Chart(ctxDisp, {
      type: 'doughnut',
      data: {
        labels: dispItems.map(d => d.short),
        datasets: [{
          data: dispItems.map(d => d.value),
          backgroundColor: dispItems.map((_, i) => colors[i % colors.length]),
          borderColor: '#1a1a1a',
          borderWidth: 2,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true } },
        },
        onClick: (_, elements) => {
          const el = elements?.[0];
          if (!el) return;
          const label = dispItems[el.index]?.label;
          toggleFilter('disponibilidade', label);
        },
      },
    });
  }

  const ctxEstado = document.getElementById('estadoChart');
  if (ctxEstado) {
    if (estadoChart) estadoChart.destroy();
    const topEstados = estadoData.slice(0, 12).map(([label, value]) => ({
      label,
      short: truncate(label, 18),
      value,
    }));
    estadoChart = new Chart(ctxEstado, {
      type: 'bar',
      data: {
        labels: topEstados.map(e => e.short),
        datasets: [{
          label: 'Inscrições',
          data: topEstados.map(e => e.value),
          backgroundColor: 'rgba(59, 130, 246, 0.6)',
          borderColor: '#3b82f6',
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        onClick: (_, elements) => {
          const el = elements?.[0];
          if (!el) return;
          const label = topEstados[el.index]?.label;
          toggleFilter('estado', label);
        },
        scales: {
          x: { beginAtZero: true, grid: { color: 'rgba(42,42,42,0.5)' } },
          y: { grid: { display: false } },
        },
      },
    });
  }

  const ctxCidade = document.getElementById('cidadeChart');
  if (ctxCidade) {
    if (cidadeChart) cidadeChart.destroy();
    const topCidades = cidadeData.slice(0, 10).map(([label, value]) => ({
      label,
      short: truncate(label, 18),
      value,
    }));
    cidadeChart = new Chart(ctxCidade, {
      type: 'bar',
      data: {
        labels: topCidades.map(c => c.short),
        datasets: [{
          label: 'Inscrições',
          data: topCidades.map(c => c.value),
          backgroundColor: 'rgba(34, 197, 94, 0.6)',
          borderColor: '#22c55e',
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: 'rgba(42,42,42,0.5)' } },
          y: { grid: { display: false } },
        },
      },
    });
  }
}

function truncate(s, max) {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max) + '…';
}

/** Set de emails (lowercase) que têm pelo menos um check-in (cruzamento voluntários x check-ins). */
function getEmailsComCheckin() {
  const set = new Set();
  const list = Array.isArray(checkins) ? checkins : [];
  list.forEach(c => {
    const e = (c.email || '').toLowerCase().trim();
    if (e) set.add(e);
  });
  return set;
}

/** Lista de pessoas que têm check-in mas não estão na lista de voluntários (por email). */
function getSoCheckinList() {
  const vol = Array.isArray(voluntarios) ? voluntarios : [];
  const list = Array.isArray(checkins) ? checkins : [];
  const voluntariosEmails = new Set(vol.map(v => (v.email || '').toLowerCase().trim()).filter(Boolean));
  const byEmail = new Map();
  list.forEach(c => {
    const e = (c.email || '').toLowerCase().trim();
    if (!e || voluntariosEmails.has(e)) return;
    const ts = c.timestampMs ?? (c.timestamp ? new Date(c.timestamp).getTime() : 0);
    const existing = byEmail.get(e);
    if (!existing || ts > (existing.timestampMs || 0)) byEmail.set(e, { email: c.email || e, nome: c.nome || '', ministerio: c.ministerio || '', timestampMs: ts });
  });
  return Array.from(byEmail.values()).map(c => ({
    email: c.email,
    nome: c.nome || '—',
    cidade: '',
    estado: '',
    areas: '',
    disponibilidade: '',
    _soCheckin: true,
  }));
}

function getFilteredVoluntarios() {
  const emailsComCheckin = getEmailsComCheckin();
  const q = (searchInput?.value || '').trim().toLowerCase();

  if (filters.comCheckin === 'so-checkin') {
    let list = getSoCheckinList();
    if (q) list = list.filter(v => (v.nome || '').toLowerCase().includes(q) || (v.email || '').toLowerCase().includes(q));
    return list;
  }

  const vol = Array.isArray(voluntarios) ? voluntarios : [];
  return vol.filter(v => {
    if (q) {
      const matchText =
        (v.nome || '').toLowerCase().includes(q) ||
        (v.email || '').toLowerCase().includes(q) ||
        (v.cidade || '').toLowerCase().includes(q) ||
        (v.areas || '').toLowerCase().includes(q);
      if (!matchText) return false;
    }
    if (filters.area) {
      const areas = (v.areas || '').split(',').map(a => a.trim());
      if (!areas.includes(filters.area)) return false;
    }
    if (filters.disponibilidade) {
      const disp = (v.disponibilidade || '').split(',').map(d => d.trim());
      if (!disp.includes(filters.disponibilidade)) return false;
    }
    if (filters.estado) {
      const estado = String(v.estado || '').trim();
      if (estado !== filters.estado) return false;
    }
    if (filters.cidade) {
      const cidade = String(v.cidade || '').trim();
      if (cidade !== filters.cidade) return false;
    }
    if (filters.comCheckin) {
      const email = (v.email || '').toLowerCase().trim();
      const temCheckin = emailsComCheckin.has(email);
      if (filters.comCheckin === 'com' && !temCheckin) return false;
      if (filters.comCheckin === 'sem' && temCheckin) return false;
    }
    return true;
  });
}

function renderTable(list) {
  if (!voluntariosBody) return;
  voluntariosBody.innerHTML = '';
  const arr = Array.isArray(list) ? list : [];
  arr.forEach(v => {
    const tr = document.createElement('tr');
    const email = (v.email || '').toLowerCase();
    const checked = selectedEmails.has(email);
    tr.innerHTML = `
      <td class="col-check"><input type="checkbox" class="row-check" data-email="${escapeAttr(email)}" ${checked ? 'checked' : ''}></td>
      <td class="cell-with-avatar"><span class="cell-avatar">${avatarHtml(v.fotoUrl, v.nome)}</span><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(v.nome || '—')}</button></td>
      <td><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(v.email || '')}</button></td>
      <td>${escapeHtml([v.cidade, v.estado].filter(Boolean).join(' / ') || '—')}</td>
      <td>${escapeHtml(truncate(v.areas || '—', 50))}</td>
      <td>${escapeHtml(truncate(v.disponibilidade || '—', 30))}</td>
    `;
    voluntariosBody.appendChild(tr);
  });
  voluntariosBody.querySelectorAll('.link-voluntario').forEach(btn => {
    btn.addEventListener('click', () => openPerfilVoluntario(btn.getAttribute('data-email')));
  });
  voluntariosBody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const em = cb.getAttribute('data-email');
      if (cb.checked) selectedEmails.add(em);
      else selectedEmails.delete(em);
      updateSelectedCount();
      syncSelectAll();
    });
  });
  syncSelectAll();
  updateKpis();
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

function getFotoUrl(url) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${API_BASE}${url}`;
}

function avatarHtml(fotoUrl, nome, sizeClass) {
  const initial = (nome || '?').trim().slice(0, 1).toUpperCase();
  const cls = sizeClass || 'avatar-sm';
  if (fotoUrl) return `<img class="avatar-img ${cls}" src="${escapeAttr(getFotoUrl(fotoUrl))}" alt="">`;
  return `<span class="avatar-initial ${cls}">${escapeHtml(initial)}</span>`;
}

function fieldRow(label, value) {
  if (value == null || value === '') return '';
  const v = Array.isArray(value) ? value.join(', ') : String(value);
  return `<div class="perfil-field"><span class="perfil-label">${escapeHtml(label)}</span><span class="perfil-value">${escapeHtml(v)}</span></div>`;
}

function formatCheckinDate(timestamp) {
  if (!timestamp) return '—';
  const d = typeof timestamp === 'object' && timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(d.getTime())) return String(timestamp).slice(0, 10);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderCheckinsBadges(emailKey, checkinsListOverride) {
  const source = Array.isArray(checkinsListOverride) ? checkinsListOverride : (Array.isArray(checkins) ? checkins : []);
  const list = source
    .filter(c => (c.email || '').toLowerCase().trim() === emailKey)
    .sort((a, b) => {
      const ta = a.timestampMs ?? (a.timestamp ? new Date(a.timestamp).getTime() : 0);
      const tb = b.timestampMs ?? (b.timestamp ? new Date(b.timestamp).getTime() : 0);
      return tb - ta;
    });
  if (!list.length) return '<p class="perfil-checkins-empty">Nenhum check-in registrado.</p>';
  const badges = list.map(c => {
    const data = formatCheckinDate(c.timestamp);
    const min = escapeHtml(String(c.ministerio || '—').trim());
    return `<span class="perfil-checkin-badge">${data} · ${min}</span>`;
  }).join('');
  return `<div class="perfil-checkins-list">${badges}</div>`;
}

async function openPerfilVoluntario(email, options) {
  const modalPerfil = document.getElementById('modalPerfilVoluntario');
  const content = document.getElementById('perfilVoluntarioConteudo');
  if (!modalPerfil || !content) return;
  const key = (email || '').toLowerCase().trim();
  const checkinsList = options && Array.isArray(options.checkinsList) ? options.checkinsList : null;
  const v = (Array.isArray(voluntarios) ? voluntarios : []).find(x => (x.email || '').toLowerCase() === key);
  let fotoUrl = v?.fotoUrl || (checkinsList && checkinsList.find(c => (c.email || '').toLowerCase() === key)?.fotoUrl) || null;
  if (!fotoUrl && (authRole === 'admin' || authRole === 'lider')) {
    try {
      const r = await authFetch(`${API_BASE}/api/users/foto?email=${encodeURIComponent(key)}`);
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        fotoUrl = data.fotoUrl || null;
      }
    } catch (_) {}
  }
  const nomeDisplay = v?.nome || (checkinsList && checkinsList.find(c => (c.email || '').toLowerCase() === key)?.nome) || email || '?';
  const fotoBlock = `<div class="perfil-modal-foto">${avatarHtml(fotoUrl, nomeDisplay, 'avatar-lg')}</div>`;
  const checkinsSection = `<div class="perfil-section"><span class="perfil-label">Check-ins</span>${renderCheckinsBadges(key, checkinsList)}</div>`;
  if (v) {
    const areasStr = Array.isArray(v.areas) ? v.areas.join(', ') : (v.areas || '');
    content.innerHTML = fotoBlock + (`
      ${fieldRow('Nome', v.nome)}
      ${fieldRow('Email', v.email)}
      ${fieldRow('Nascimento', v.nascimento ? (typeof v.nascimento === 'string' ? v.nascimento : new Date(v.nascimento).toLocaleDateString('pt-BR')) : null)}
      ${fieldRow('WhatsApp', v.whatsapp)}
      ${fieldRow('País', v.pais)}
      ${fieldRow('Estado', v.estado)}
      ${fieldRow('Cidade', v.cidade)}
      ${fieldRow('Evangélico', v.evangelico)}
      ${fieldRow('Igreja', v.igreja)}
      ${fieldRow('Tempo na igreja', v.tempoIgreja)}
      ${fieldRow('Voluntário na igreja', v.voluntarioIgreja)}
      ${fieldRow('Ministério', v.ministerio)}
      ${fieldRow('Disponibilidade', v.disponibilidade)}
      ${fieldRow('Horas por semana', v.horasSemana)}
      ${fieldRow('Áreas', areasStr || null)}
      ${checkinsSection}
    `.trim() || '<p>Nenhum dado cadastrado.</p>');
  } else {
    const sourceForCheckin = checkinsList || (Array.isArray(checkins) ? checkins : []);
    const checkin = sourceForCheckin.find(c => (c.email || '').toLowerCase() === key);
    const msg = checkin
      ? fotoBlock + `${fieldRow('Nome', checkin.nome)}${fieldRow('Email', checkin.email)}${checkinsSection}<p class="perfil-not-found" style="margin-top:12px">Dados completos não encontrados na lista de voluntários.</p>`
      : fotoBlock + '<p class="perfil-not-found">Voluntário não encontrado na lista.</p>';
    content.innerHTML = msg;
  }
  modalPerfil.classList.add('open');
  modalPerfil.setAttribute('aria-hidden', 'false');
}

function closeModalPerfilVoluntario() {
  const modalPerfil = document.getElementById('modalPerfilVoluntario');
  if (modalPerfil) {
    modalPerfil.classList.remove('open');
    modalPerfil.setAttribute('aria-hidden', 'true');
  }
}

function syncSelectAll() {
  const filtered = getFilteredVoluntarios();
  const emailsInPage = new Set(filtered.map(v => (v.email || '').toLowerCase()));
  const allSelected = emailsInPage.size > 0 && [...emailsInPage].every(e => selectedEmails.has(e));
  const someSelected = [...emailsInPage].some(e => selectedEmails.has(e));
  if (selectAll) selectAll.checked = allSelected;
  if (selectAllHeader) selectAllHeader.checked = allSelected;
  if (selectAll) selectAll.indeterminate = someSelected && !allSelected;
  if (selectAllHeader) selectAllHeader.indeterminate = someSelected && !allSelected;
}

function updateSelectedCount() {
  const n = selectedEmails.size;
  if (countSelectedEl) countSelectedEl.textContent = n;
  if (btnOpenSend) btnOpenSend.disabled = n === 0;
}

function toggleSelectAll(checked) {
  const filtered = getFilteredVoluntarios();
  filtered.forEach(v => {
    const e = (v.email || '').toLowerCase();
    if (e) (checked ? selectedEmails.add(e) : selectedEmails.delete(e));
  });
  renderTable(getFilteredVoluntarios());
  updateSelectedCount();
}

function countByField(list, field) {
  const counts = {};
  list.forEach(v => {
    const value = String(v?.[field] || '').trim();
    if (!value) return;
    counts[value] = (counts[value] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function countByMultiValueField(list, field) {
  const counts = {};
  list.forEach(v => {
    const raw = String(v?.[field] || '');
    raw.split(',').map(s => s.trim()).filter(Boolean).forEach(value => {
      counts[value] = (counts[value] || 0) + 1;
    });
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function populateSelect(selectEl, items, placeholder) {
  if (!selectEl) return;
  const currentValue = selectEl.value;  // Salva o valor atual
  selectEl.innerHTML = '';
  
  // Adiciona opção "Todas"
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = placeholder;
  selectEl.appendChild(optAll);
  
  // Adiciona as opções
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = item;
    selectEl.appendChild(opt);
  });
  
  // Restaura o valor anterior se ainda existir na lista
  if (items.includes(currentValue)) {
    selectEl.value = currentValue;
  } else {
    selectEl.value = '';  // Se não existir, volta para "Todas"
  }
}

function updateFilters() {
  const vol = Array.isArray(voluntarios) ? voluntarios : [];
  const areas = countByMultiValueField(vol, 'areas').map(([label]) => label);
  const disp = countByMultiValueField(vol, 'disponibilidade').map(([label]) => label);
  const estados = countByField(vol, 'estado').map(([label]) => label);
  // Ordena estados: UFs (2 letras) primeiro em ordem alfabética, depois o resto
  estados.sort((a, b) => {
    const aIsUF = a && a.length === 2;
    const bIsUF = b && b.length === 2;
    if (aIsUF && bIsUF) return a.localeCompare(b);
    if (aIsUF) return -1;
    if (bIsUF) return 1;
    return (a || '').localeCompare(b || '');
  });
  const cidades = countByField(vol, 'cidade').map(([label]) => label).sort((a, b) => (a || '').localeCompare(b || ''));
  populateSelect(filterArea, areas, 'Todas as áreas');
  populateSelect(filterDisp, disp, 'Todas as disponibilidades');
  populateSelect(filterEstado, estados, 'Todos os estados');
  populateSelect(filterCidade, cidades, 'Todas as cidades');
  updateFilterUi();
}

function updateFilterUi() {
  if (filterArea) filterArea.value = filters.area || '';
  if (filterDisp) filterDisp.value = filters.disponibilidade || '';
  if (filterEstado) filterEstado.value = filters.estado || '';
  if (filterCidade) filterCidade.value = filters.cidade || '';
  if (filterComCheckin) filterComCheckin.value = filters.comCheckin || '';
  if (!activeFilters) return;
  const comCheckinLabel = { com: 'Com check-in', sem: 'Sem check-in', 'so-checkin': 'Só check-in (sem cadastro)' }[filters.comCheckin] || '';
  const chips = [
    ['area', 'Área', filters.area],
    ['disponibilidade', 'Disponibilidade', filters.disponibilidade],
    ['estado', 'Estado', filters.estado],
    ['cidade', 'Cidade', filters.cidade],
    ['comCheckin', 'Check-in', comCheckinLabel],
  ].filter(([, , value]) => value);
  activeFilters.innerHTML = '';
  if (!chips.length) {
    activeFilters.style.display = 'none';
    return;
  }
  activeFilters.style.display = 'flex';
  chips.forEach(([key, label, value]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-chip';
    btn.textContent = `${label}: ${value} ×`;
    btn.addEventListener('click', () => setFilter(key, ''));
    activeFilters.appendChild(btn);
  });
}

function setFilter(key, value) {
  filters[key] = value || '';
  const filtered = getFilteredVoluntarios();
  updateKpis();
  renderCharts();
  renderTable(filtered);
  updateSelectedCount();
  updateFilterUi();
}

function toggleFilter(key, value) {
  if (!value) return;
  setFilter(key, filters[key] === value ? '' : value);
}

function clearFilters() {
  filters.area = '';
  filters.disponibilidade = '';
  filters.estado = '';
  filters.cidade = '';
  filters.comCheckin = '';
  updateKpis();
  renderCharts();
  renderTable(getFilteredVoluntarios());
  updateSelectedCount();
  updateFilterUi();
}

function getTodayPtBr() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function getFilteredCheckins() {
  const q = (checkinSearch?.value || '').trim().toLowerCase();
  const list = Array.isArray(checkins) ? checkins : [];
  return list.filter(c => {
    if (checkinFilters.ministerio) {
      const m = String(c.ministerio || '').trim();
      if (m !== checkinFilters.ministerio) return false;
    }
    if (q) {
      const nome = String(c.nome || '').toLowerCase();
      const email = String(c.email || '').toLowerCase();
      if (!nome.includes(q) && !email.includes(q)) return false;
    }
    return true;
  });
}

function updateCheckinFilters() {
  const list = Array.isArray(checkins) ? checkins : [];
  const ministerios = countByField(list, 'ministerio').map(([label]) => label);
  populateSelect(checkinMinisterio, ministerios, 'Todos os ministérios');
  if (checkinMinisterio) checkinMinisterio.value = checkinFilters.ministerio || '';
}

function setCheckinFilter(key, value) {
  checkinFilters[key] = value || '';
  renderCheckins();
}

function clearCheckinFilters() {
  checkinFilters.ministerio = '';
  if (checkinSearch) checkinSearch.value = '';
  renderCheckins();
}

function renderCheckinChart() {
  const ctx = document.getElementById('ministerioChart');
  if (!ctx) return;
  if (ministerioChart) ministerioChart.destroy();
  const items = countByField(checkins, 'ministerio').slice(0, 12).map(([label, value]) => ({
    label,
    short: truncate(label, 22),
    value,
  }));
  ministerioChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: items.map(i => i.short),
      datasets: [{
        label: 'Check-ins',
        data: items.map(i => i.value),
        backgroundColor: 'rgba(34, 197, 94, 0.6)',
        borderColor: '#22c55e',
        borderWidth: 1,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      onClick: (_, elements) => {
        const el = elements?.[0];
        if (!el) return;
        const label = items[el.index]?.label;
        setCheckinFilter('ministerio', checkinFilters.ministerio === label ? '' : label);
      },
      scales: {
        x: { beginAtZero: true, grid: { color: 'rgba(42,42,42,0.5)' } },
        y: { grid: { display: false } },
      },
    },
  });
}

function renderCheckinTable(list) {
  if (!checkinBody) return;
  checkinBody.innerHTML = '';
  list.forEach(c => {
    const tr = document.createElement('tr');
    const email = (c.email || '').toLowerCase();
    tr.innerHTML = `
      <td class="cell-with-avatar"><span class="cell-avatar">${avatarHtml(c.fotoUrl, c.nome)}</span><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(c.nome || '—')}</button></td>
      <td><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(c.email || '')}</button></td>
      <td>${escapeHtml(c.ministerio || '—')}</td>
      <td>${escapeHtml(c.timestamp || '—')}</td>
    `;
    checkinBody.appendChild(tr);
  });
  checkinBody.querySelectorAll('.link-voluntario').forEach(btn => {
    btn.addEventListener('click', () => openPerfilVoluntario(btn.getAttribute('data-email')));
  });
  if (checkinCount) checkinCount.textContent = list.length;
}

function renderCheckins() {
  updateCheckinFilters();
  const filtered = getFilteredCheckins();
  const list = Array.isArray(checkins) ? checkins : [];
  if (checkinTotal) checkinTotal.textContent = list.length;
  if (checkinMinisterios) checkinMinisterios.textContent = countByField(list, 'ministerio').length;
  if (checkinHoje) {
    const today = getTodayPtBr();
    const totalHoje = list.filter(c => String(c.timestamp || '').startsWith(today)).length;
    checkinHoje.textContent = totalHoje;
  }
  renderCheckinChart();
  renderCheckinTable(filtered);
}

function openModal() {
  const list = [...selectedEmails];
  if (!list.length) return;
  if (modalDestCount) modalDestCount.textContent = list.length;
  if (emailSubject) emailSubject.value = '';
  if (emailBody) emailBody.value = '';
  if (sendResult) { sendResult.style.display = 'none'; sendResult.innerHTML = ''; }
  modal?.setAttribute('aria-hidden', 'false');
  modal?.classList.add('open');
}

function closeModal() {
  modal?.setAttribute('aria-hidden', 'true');
  modal?.classList.remove('open');
}

async function sendEmails() {
  const subject = (emailSubject?.value || '').trim();
  const body = (emailBody?.value || '').trim();
  if (!subject || !body) {
    alert('Preencha assunto e mensagem.');
    return;
  }
  const to = [...selectedEmails];
  btnSendEmail.disabled = true;
  btnSendEmail.textContent = 'Enviando...';
  sendResult.style.display = 'none';

  try {
    const volList = Array.isArray(voluntarios) ? voluntarios : [];
    const voluntariosByEmail = new Map(volList.map(v => [(v.email || '').toLowerCase(), v]));
    const voluntariosMap = {};
    to.forEach(email => {
      const v = voluntariosByEmail.get(email);
      if (v?.nome) voluntariosMap[email] = v.nome;
    });
    const html = body.replace(/\n/g, '<br>');
    const r = await authFetch(`${API_BASE}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        subject,
        html,
        voluntarios: voluntariosMap,
      }),
    });
    const data = await r.json().catch(() => ({}));
    sendResult.style.display = 'block';
    if (data.error) {
      sendResult.className = 'send-result error';
      sendResult.innerHTML = `Erro: ${data.error}`;
    } else {
      sendResult.className = 'send-result success';
      sendResult.innerHTML = `Enviados: ${data.sent || 0}${(data.failed || 0) > 0 ? ` · Falhas: ${data.failed}` : ''}.`;
    }
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    sendResult.style.display = 'block';
    sendResult.className = 'send-result error';
    sendResult.textContent = 'Erro de rede: ' + (e.message || 'Verifique o servidor e RESEND_API_KEY.');
  }
  btnSendEmail.disabled = false;
  btnSendEmail.textContent = 'Enviar';
}

async function handleLogin(e) {
  e.preventDefault();
  if (loginError) loginError.textContent = '';
  const login = (loginEmail?.value || '').trim();
  const password = (loginPass?.value || '').trim();
  if (!login || !password) {
    if (loginError) loginError.textContent = 'Informe email/usuário e senha.';
    return;
  }
  if (btnLogin) {
    btnLogin.disabled = true;
    btnLogin.textContent = 'Entrando...';
  }
  try {
    const r = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: login, email: login, password }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (loginError) loginError.textContent = data.error || 'Falha ao autenticar.';
      return;
    }
    setAuthSession(data);
    if (authOverlay) authOverlay.style.display = 'none';
    const isVol = String(authRole || '').toLowerCase() === 'voluntario';
    const isLider = String(authRole || '').toLowerCase() === 'lider';
    const defaultView = isVol ? 'perfil' : (isLider ? 'checkin-ministerio' : 'resumo');
    setView(defaultView);
    if (authRole === 'admin') await fetchAllData();
    else if (isLider) { await fetchCheckinsMinisterio(); await fetchMeusCheckins(); await fetchPerfil(); }
    else { await fetchEventosHoje(); await fetchMeusCheckins(); await fetchPerfil(); }
  } catch (err) {
    if (loginError) loginError.textContent = err.message || 'Erro de rede.';
  } finally {
    if (btnLogin) {
      btnLogin.disabled = false;
      btnLogin.textContent = 'Entrar';
    }
  }
}

async function handleLogout() {
  if (!authToken) return;
  try {
    await authFetch(`${API_BASE}/api/logout`, { method: 'POST' });
  } catch (_) {
    // Ignora erros de logout
  } finally {
    clearAuthSession();
  }
}

document.getElementById('btnRefresh')?.addEventListener('click', fetchAllData);
document.getElementById('btnRetry')?.addEventListener('click', fetchAllData);

function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}
const debouncedSearch = debounce(() => {
  updateKpis();
  renderCharts();
  renderTable(getFilteredVoluntarios());
}, 280);
searchInput?.addEventListener('input', debouncedSearch);

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.toggle('open');
  if (overlay) { overlay.classList.toggle('show'); overlay.setAttribute('aria-hidden', sidebar?.classList.contains('open') ? 'false' : 'true'); }
}
document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);
document.getElementById('sidebarOverlay')?.addEventListener('click', toggleSidebar);

selectAll?.addEventListener('change', () => toggleSelectAll(selectAll.checked));
selectAllHeader?.addEventListener('change', () => toggleSelectAll(selectAllHeader.checked));

btnOpenSend?.addEventListener('click', openModal);
modalClose?.addEventListener('click', closeModal);
modalCancel?.addEventListener('click', closeModal);
modalBackdrop?.addEventListener('click', closeModal);
btnSendEmail?.addEventListener('click', sendEmails);
loginForm?.addEventListener('submit', handleLogin);
btnLogout?.addEventListener('click', handleLogout);
filterArea?.addEventListener('change', () => setFilter('area', filterArea.value));
filterDisp?.addEventListener('change', () => setFilter('disponibilidade', filterDisp.value));
filterEstado?.addEventListener('change', () => setFilter('estado', filterEstado.value));
filterCidade?.addEventListener('change', () => setFilter('cidade', filterCidade.value));
filterComCheckin?.addEventListener('change', () => setFilter('comCheckin', filterComCheckin.value));
btnClearFilters?.addEventListener('click', clearFilters);
checkinMinisterio?.addEventListener('change', () => { checkinFilters.ministerio = checkinMinisterio?.value || ''; fetchCheckinsWithFilters(); });
checkinSearch?.addEventListener('input', () => renderCheckins());
btnClearCheckinFilters?.addEventListener('click', () => { if (checkinData) checkinData.value = ''; if (checkinEvento) checkinEvento.value = ''; if (checkinMinisterio) checkinMinisterio.value = ''; checkinFilters.ministerio = ''; fetchCheckinsWithFilters(); });
checkinData?.addEventListener('change', fetchCheckinsWithFilters);
checkinEvento?.addEventListener('change', fetchCheckinsWithFilters);

btnNovoEvento?.addEventListener('click', () => { if (modalNovoEvento) { eventoData.value = new Date().toISOString().slice(0, 10); eventoLabel.value = ''; if (eventoAtivo) eventoAtivo.checked = true; modalNovoEvento.setAttribute('aria-hidden', 'false'); modalNovoEvento.classList.add('open'); } });
modalNovoEventoClose?.addEventListener('click', () => { modalNovoEvento?.classList.remove('open'); });
modalNovoEventoCancel?.addEventListener('click', () => { modalNovoEvento?.classList.remove('open'); });
modalNovoEvento?.querySelector('.modal-backdrop')?.addEventListener('click', () => { modalNovoEvento?.classList.remove('open'); });

document.getElementById('modalPerfilVoluntarioClose')?.addEventListener('click', closeModalPerfilVoluntario);
document.getElementById('modalPerfilVoluntario')?.querySelector('.modal-backdrop')?.addEventListener('click', closeModalPerfilVoluntario);

formNovoEvento?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = eventoData?.value; const label = eventoLabel?.value?.trim();
  const ativo = eventoAtivo ? eventoAtivo.checked : true;
  if (!data) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, label, ativo }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    modalNovoEvento?.classList.remove('open');
    fetchEventosCheckin();
  } catch (err) { alert(err.message || 'Erro ao criar evento.'); }
});

document.getElementById('btnNovoMinisterio')?.addEventListener('click', () => { document.getElementById('ministerioNome').value = ''; document.getElementById('modalNovoMinisterio')?.classList.add('open'); });
document.getElementById('formNovoMinisterio')?.addEventListener('submit', createMinisterio);
document.getElementById('modalNovoMinisterioClose')?.addEventListener('click', () => document.getElementById('modalNovoMinisterio')?.classList.remove('open'));
document.getElementById('modalNovoMinisterioCancel')?.addEventListener('click', () => document.getElementById('modalNovoMinisterio')?.classList.remove('open'));
document.getElementById('modalNovoMinisterio')?.querySelector('.modal-backdrop')?.addEventListener('click', () => document.getElementById('modalNovoMinisterio')?.classList.remove('open'));

document.getElementById('modalAssignLiderClose')?.addEventListener('click', () => document.getElementById('modalAssignLider')?.classList.remove('open'));
document.getElementById('modalAssignLiderCancel')?.addEventListener('click', () => document.getElementById('modalAssignLider')?.classList.remove('open'));
document.getElementById('modalAssignLider')?.querySelector('.modal-backdrop')?.addEventListener('click', () => document.getElementById('modalAssignLider')?.classList.remove('open'));
document.getElementById('btnAssignLider')?.addEventListener('click', assignLider);

function closeModalUserRole() {
  const modal = document.getElementById('modalUserRole');
  if (modal) modal.classList.remove('open');
  const formBody = document.getElementById('modalUserRoleFormBody');
  const historyBody = document.getElementById('modalUserHistoryBody');
  if (formBody) formBody.style.display = 'block';
  if (historyBody) historyBody.style.display = 'none';
}
document.getElementById('modalUserRoleClose')?.addEventListener('click', closeModalUserRole);
document.getElementById('modalUserRoleCancel')?.addEventListener('click', closeModalUserRole);
document.getElementById('modalUserRole')?.querySelector('.modal-backdrop')?.addEventListener('click', closeModalUserRole);
document.getElementById('btnSaveUserRole')?.addEventListener('click', saveUserRole);
document.getElementById('userRoleSelect')?.addEventListener('change', () => {
  const g = document.getElementById('userMinisterioGroup');
  if (g) g.style.display = document.getElementById('userRoleSelect')?.value === 'lider' ? 'block' : 'none';
});
document.getElementById('btnUserRoleBack')?.addEventListener('click', () => {
  document.getElementById('modalUserRoleFormBody').style.display = 'block';
  document.getElementById('modalUserHistoryBody').style.display = 'none';
});

document.getElementById('btnRefreshCheckinMinisterio')?.addEventListener('click', () => fetchCheckinsMinisterio());
document.getElementById('checkinMinisterioData')?.addEventListener('change', () => fetchCheckinsMinisterio());

formPerfil?.addEventListener('submit', savePerfil);

document.getElementById('btnPerfilFotoUpload')?.addEventListener('click', () => document.getElementById('perfilFotoInput')?.click());
document.getElementById('perfilFotoInput')?.addEventListener('change', async (e) => {
  const file = e.target?.files?.[0];
  e.target.value = '';
  if (!file || !authToken) return;
  const fd = new FormData();
  fd.append('foto', file);
  const btn = document.getElementById('btnPerfilFotoUpload');
  if (btn) btn.disabled = true;
  try {
    const r = await authFetch(`${API_BASE}/api/me/foto`, { method: 'POST', body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Falha no upload');
    authFotoUrl = data.fotoUrl || null;
    updatePerfilFotoUI();
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) try { const p = JSON.parse(stored); p.fotoUrl = authFotoUrl; localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(p)); } catch (_) {}
  } catch (err) { alert(err.message || 'Erro ao enviar foto.'); }
  if (btn) btn.disabled = false;
});
document.getElementById('btnPerfilFotoExcluir')?.addEventListener('click', async () => {
  if (!authToken) return;
  const btn = document.getElementById('btnPerfilFotoExcluir');
  if (btn) btn.disabled = true;
  try {
    const r = await authFetch(`${API_BASE}/api/me/foto`, { method: 'DELETE' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Falha ao excluir');
    authFotoUrl = null;
    updatePerfilFotoUI();
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) try { const p = JSON.parse(stored); p.fotoUrl = null; localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(p)); } catch (_) {}
  } catch (err) { alert(err.message || 'Erro ao excluir foto.'); }
  if (btn) btn.disabled = false;
});

btnConfirmarCheckin?.addEventListener('click', confirmarCheckin);
document.getElementById('btnPerfilConfirmarCheckin')?.addEventListener('click', confirmarCheckinDesdePerfil);

async function fetchSetupStatus() {
  const urlParams = new URLSearchParams(window.location.search);
  const forceSetup = urlParams.get('setup') === '1';
  try {
    const r = await fetch(`${API_BASE}/api/setup/status`);
    const data = await r.json().catch(() => ({}));
    if (data.needsSetup && setupLinkWrap) setupLinkWrap.style.display = 'block';
    if ((forceSetup || data.needsSetup) && setupCard && loginCard) {
      loginCard.style.display = 'none';
      if (registerCard) registerCard.style.display = 'none';
      setupCard.style.display = 'block';
    }
  } catch (_) {
    if (forceSetup && setupCard && loginCard) {
      loginCard.style.display = 'none';
      if (registerCard) registerCard.style.display = 'none';
      setupCard.style.display = 'block';
    }
  }
}
if (!authToken) fetchSetupStatus();

linkRegistro?.addEventListener('click', (e) => { e.preventDefault(); if (loginCard) loginCard.style.display = 'none'; if (registerCard) registerCard.style.display = 'block'; if (setupCard) setupCard.style.display = 'none'; });
linkLogin?.addEventListener('click', (e) => { e.preventDefault(); if (registerCard) registerCard.style.display = 'none'; if (loginCard) loginCard.style.display = 'block'; if (setupCard) setupCard.style.display = 'none'; });
linkSetup?.addEventListener('click', (e) => { e.preventDefault(); if (loginCard) loginCard.style.display = 'none'; if (registerCard) registerCard.style.display = 'none'; if (setupCard) setupCard.style.display = 'block'; });
linkSetupVoltar?.addEventListener('click', (e) => { e.preventDefault(); if (setupCard) setupCard.style.display = 'none'; if (loginCard) loginCard.style.display = 'block'; });
setupForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (setupError) setupError.textContent = '';
  if (setupSuccess) { setupSuccess.style.display = 'none'; setupSuccess.textContent = ''; }
  const secret = (setupSecret?.value || '').trim();
  const email = (setupEmail?.value || '').trim().toLowerCase();
  const nome = (setupNome?.value || '').trim();
  const senha = (setupSenha?.value || '').trim();
  if (!secret || !email || !nome || !senha) { if (setupError) setupError.textContent = 'Preencha todos os campos.'; return; }
  if (senha.length < 6) { if (setupError) setupError.textContent = 'Senha deve ter no mínimo 6 caracteres.'; return; }
  if (btnSetup) { btnSetup.disabled = true; btnSetup.textContent = 'Criando...'; }
  try {
    const r = await fetch(`${API_BASE}/api/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, email, nome, senha }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { if (setupError) setupError.textContent = data.error || 'Falha ao criar admin.'; return; }
    if (setupSuccess) { setupSuccess.textContent = data.message || 'Admin criado. Faça login com este email e senha.'; setupSuccess.style.display = 'block'; }
    setTimeout(() => { if (setupCard) setupCard.style.display = 'none'; if (loginCard) loginCard.style.display = 'block'; if (loginError) loginError.textContent = ''; }, 1500);
  } catch (err) { if (setupError) setupError.textContent = err.message || 'Erro de rede.'; }
  finally { if (btnSetup) { btnSetup.disabled = false; btnSetup.textContent = 'Criar admin'; } }
});

registerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (registerError) registerError.textContent = '';
  const nome = (registerNome?.value || '').trim(); const email = (registerEmail?.value || '').trim(); const senha = (registerPass?.value || '').trim();
  if (!nome || !email || !senha) { if (registerError) registerError.textContent = 'Preencha todos os campos.'; return; }
  try {
    const r = await fetch(`${API_BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, email, senha }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { if (registerError) registerError.textContent = data.error || 'Falha ao cadastrar.'; return; }
    setAuthSession(data);
    if (authOverlay) authOverlay.style.display = 'none';
    if (registerCard) registerCard.style.display = 'none'; if (loginCard) loginCard.style.display = 'block';
    await fetchEventosHoje(); await fetchMeusCheckins(); await fetchPerfil();
  } catch (err) { if (registerError) registerError.textContent = err.message || 'Erro de rede.'; }
});

navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const view = item.dataset.view || (authRole === 'voluntario' ? 'perfil' : 'resumo');
    setView(view);
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar?.classList.contains('open')) {
      sidebar.classList.remove('open');
      if (overlay) { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); }
    }
  });
});

function getCadastroLinkUrl() {
  const base = window.location.origin + window.location.pathname;
  return base.replace(/\/$/, '') + '#cadastro';
}

function showCadastroPublico() {
  const overlay = document.getElementById('cadastroOverlay');
  const auth = document.getElementById('authOverlay');
  const content = document.getElementById('content');
  if (overlay) overlay.style.display = 'flex';
  if (auth) auth.style.display = 'none';
  if (content) content.style.display = 'none';
  const estadoSelect = document.getElementById('cadastroEstado');
  if (estadoSelect && estadoSelect.options.length <= 1) {
    estadoSelect.innerHTML = '<option value="">Selecione o estado (UF)</option>' + UFS_BR.map(uf => `<option value="${uf}">${uf}</option>`).join('');
  }
}

function hideCadastroPublico() {
  const overlay = document.getElementById('cadastroOverlay');
  if (overlay) overlay.style.display = 'none';
  updateAuthUi();
  if (authToken && contentEl) contentEl.style.display = 'block';
}

document.getElementById('linkSairCadastro')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.location.hash = '';
  hideCadastroPublico();
});

document.getElementById('cadastroPublicoForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('cadastroPublicoError');
  const okEl = document.getElementById('cadastroPublicoSuccess');
  if (errEl) errEl.textContent = '';
  if (okEl) { okEl.style.display = 'none'; okEl.textContent = ''; }
  const payload = {
    nome: (document.getElementById('cadastroNome')?.value || '').trim(),
    email: (document.getElementById('cadastroEmail')?.value || '').trim().toLowerCase(),
    nascimento: (document.getElementById('cadastroNascimento')?.value || '').trim() || undefined,
    whatsapp: (document.getElementById('cadastroWhatsapp')?.value || '').trim() || undefined,
    pais: (document.getElementById('cadastroPais')?.value || '').trim() || undefined,
    estado: (document.getElementById('cadastroEstado')?.value || '').trim() || undefined,
    cidade: (document.getElementById('cadastroCidade')?.value || '').trim() || undefined,
    evangelico: (document.getElementById('cadastroEvangelico')?.value || '').trim() || undefined,
    igreja: (document.getElementById('cadastroIgreja')?.value || '').trim() || undefined,
    tempoIgreja: (document.getElementById('cadastroTempoIgreja')?.value || '').trim() || undefined,
    voluntarioIgreja: (document.getElementById('cadastroVoluntarioIgreja')?.value || '').trim() || undefined,
    ministerio: (document.getElementById('cadastroMinisterio')?.value || '').trim() || undefined,
    disponibilidade: (document.getElementById('cadastroDisponibilidade')?.value || '').trim() || undefined,
    horasSemana: (document.getElementById('cadastroHorasSemana')?.value || '').trim() || undefined,
    areas: (document.getElementById('cadastroAreas')?.value || '').trim() || undefined,
  };
  if (!payload.email || !payload.email.includes('@')) {
    if (errEl) errEl.textContent = 'Email é obrigatório e deve ser válido.';
    return;
  }
  const btn = document.getElementById('btnCadastroPublico');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API_BASE}/api/cadastro`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (errEl) errEl.textContent = data.error || 'Falha ao enviar. Tente novamente.';
      return;
    }
    if (okEl) { okEl.textContent = data.message || 'Inscrição enviada com sucesso!'; okEl.style.display = 'block'; }
    if (errEl) errEl.textContent = '';
    document.getElementById('cadastroPublicoForm')?.reset();
    if (document.getElementById('cadastroEstado')) document.getElementById('cadastroEstado').innerHTML = '<option value="">Selecione o estado (UF)</option>' + UFS_BR.map(uf => `<option value="${uf}">${uf}</option>`).join('');
  } catch (err) {
    if (errEl) errEl.textContent = err.message || 'Erro de rede. Tente novamente.';
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById('btnCopiarLinkCadastro')?.addEventListener('click', () => {
  const input = document.getElementById('cadastroLinkInput');
  if (!input?.value) return;
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById('btnCopiarLinkCadastro');
    if (btn) { const t = btn.textContent; btn.textContent = 'Copiado!'; setTimeout(() => { btn.textContent = t; }, 2000); }
  }).catch(() => {});
});

window.addEventListener('hashchange', () => {
  if (window.location.hash === '#cadastro') showCadastroPublico();
  else hideCadastroPublico();
});

(() => {
  if (window.location.hash === '#cadastro') {
    showCadastroPublico();
    return;
  }
  const stored = localStorage.getItem(AUTH_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      authToken = parsed.token || '';
      authUser = parsed.user || '';
      const r = parsed.role;
      authRole = (r != null && r !== '') ? String(r).toLowerCase() : 'admin';
      authEmail = parsed.email || null;
      authMinisterioId = parsed.ministerioId != null ? parsed.ministerioId : null;
      authMinisterioNome = parsed.ministerioNome != null ? parsed.ministerioNome : null;
      authFotoUrl = parsed.fotoUrl != null ? parsed.fotoUrl : null;
    } catch (_) {
      authToken = ''; authUser = ''; authRole = 'admin'; authEmail = null; authMinisterioId = null; authMinisterioNome = null; authFotoUrl = null;
    }
  }
  updateAuthUi();
  verifyAuth().then(ok => {
    if (ok) {
      const isVol = authRole === 'voluntario';
      const isLider = authRole === 'lider';
      const defaultView = isVol ? 'perfil' : (isLider ? 'checkin-ministerio' : 'resumo');
      setView(defaultView);
      if (authRole === 'admin') fetchAllData();
      else if (isLider) { fetchCheckinsMinisterio(); fetchMeusCheckins(); fetchPerfil(); }
      else { fetchEventosHoje(); fetchMeusCheckins(); fetchPerfil(); }
    } else {
      const isVol = authRole === 'voluntario';
      const isLider = authRole === 'lider';
      setView(isVol ? 'perfil' : (isLider ? 'checkin-ministerio' : 'resumo'));
    }
  });
})();
