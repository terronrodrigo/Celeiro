/* Dashboard Celeiro São Paulo - Voluntários + Resend */
// API na mesma origem (frontend servido pelo Express em / e API em /api/*)
const API_BASE = '';
const AUTH_STORAGE_KEY = 'celeiro_admin_auth';
const TZ_BRASILIA = 'America/Sao_Paulo'; // Eventos de check-in: sempre horário de Brasília

/** Data de hoje em Brasília no formato YYYY-MM-DD (para filtro de check-ins). */
function getHojeDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
}

const UFS_BR = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/** Debounce: executa fn após delay ms sem novas chamadas */
function debounce(fn, delayMs) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delayMs);
  };
}

// Ministérios para lives e cadastro (lista revisada – ortografia e gramática)
const MINISTERIOS_PADRAO = [
  'Suporte Geral',
  'Welcome / Recepção',
  'Experience / Auditório',
  'Streaming / Ao Vivo',
  'Produção Ao Vivo',
  'Lab / Mídia',
  'Produção',
  'Intercessão Presencial',
  'Sala de Voluntários',
  'Kids / Min. Infantil',
  'Consolidação',
  'Care / Saúde',
  'Parking / Estacionamento',
  'Segurança',
  'Intercessão Online',
];

/** Formata e valida WhatsApp: só dígitos, 10 ou 11 caracteres. Retorna string formatada (11) 99999-9999 ou vazio se inválido. */
function formatarWhatsApp(val) {
  const digits = String(val || '').replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits.length <= 11 ? digits : digits.slice(0, 11);
}
function validarWhatsApp(val) {
  const digits = String(val || '').replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11;
}

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
let authMinisterioIds = [];
let authMinisterioNomes = [];
let authFotoUrl = null;
let authMustChangePassword = false;
let authIsMasterAdmin = false;
let authVerified = false;
let eventosCheckin = [];
let eventoSelecionadoHoje = null;
let allCheckins = []; // todos os check-ins sem filtro, para contagem histórica por pessoa
const filters = {
  areas: [], // múltiplas áreas (array)
  disponibilidade: '',
  estado: '',
  cidade: '',
  comCheckin: '', // '' = todos, 'com' = com check-in, 'sem' = sem check-in
};
const checkinFilters = {
  ministerio: '',
  search: '',
  qtdCheckins: '',
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
const emailBodyBase = document.getElementById('emailBodyBase');
const emailBodyEditor = document.getElementById('emailBodyEditor');
const btnSendEmail = document.getElementById('btnSendEmail');
const btnReenviarUltimo = document.getElementById('btnReenviarUltimo');
const btnReviewLLM = document.getElementById('btnReviewLLM');
let lastSendPayload = null; // { to, subject, html, voluntarios } para "Reenviar último envio"
const emailReviewError = document.getElementById('emailReviewError');
const sendResult = document.getElementById('sendResult');
const authOverlay = document.getElementById('authOverlay');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPass = document.getElementById('loginPass');
const loginError = document.getElementById('loginError');
const btnLogin = document.getElementById('btnLogin');
const btnLogout = document.getElementById('btnLogoutSidebar');
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
const checkinQtdCheckins = document.getElementById('checkinQtdCheckins');
const eventosCheckinBody = document.getElementById('eventosCheckinBody');
const btnNovoEvento = document.getElementById('btnNovoEvento');
const modalNovoEvento = document.getElementById('modalNovoEvento');
const formNovoEvento = document.getElementById('formNovoEvento');
const eventoData = document.getElementById('eventoData');
const eventoLabel = document.getElementById('eventoLabel');
const eventoHorarioInicio = document.getElementById('eventoHorarioInicio');
const eventoHorarioFim = document.getElementById('eventoHorarioFim');
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
const perfilDisponibilidadeGroup = document.getElementById('perfilDisponibilidadeGroup');
const perfilHorasSemana = document.getElementById('perfilHorasSemana');
const perfilAreas = document.getElementById('perfilAreas');
const perfilTestemunho = document.getElementById('perfilTestemunho');
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
const linkEsqueciSenha = document.getElementById('linkEsqueciSenha');
const forgotPasswordCard = document.getElementById('forgotPasswordCard');
const resetPasswordCard = document.getElementById('resetPasswordCard');
const setupLinkWrap = document.getElementById('setupLinkWrap');
const mustChangePasswordCard = document.getElementById('mustChangePasswordCard');

function updateAuthUi() {
  const isLogged = Boolean(authToken);
  const isVoluntario = String(authRole || '').toLowerCase() === 'voluntario';
  const hasMinisterios = (authMinisterioNomes && authMinisterioNomes.length > 0) || authMinisterioNome;
  const isLider = (authRole === 'lider' || authRole === 'admin') && hasMinisterios;
  const isAdmin = authRole === 'admin';
  if (authOverlay) {
    if (isLogged && authMustChangePassword) {
      authOverlay.style.display = 'flex';
      if (loginCard) loginCard.style.display = 'none';
      if (mustChangePasswordCard) mustChangePasswordCard.style.display = 'block';
      [forgotPasswordCard, resetPasswordCard, setupCard, registerCard].forEach(c => { if (c) c.style.display = 'none'; });
    } else if (isLogged && authVerified) {
      authOverlay.style.display = 'none';
      if (loginCard) loginCard.style.display = 'block';
      if (mustChangePasswordCard) mustChangePasswordCard.style.display = 'none';
    } else {
      authOverlay.style.display = 'flex';
      if (loginCard) loginCard.style.display = 'block';
      if (mustChangePasswordCard) mustChangePasswordCard.style.display = 'none';
    }
  }
  const dashboardEl = document.querySelector('.dashboard');
  const showDashboard = isLogged && authVerified;
  if (dashboardEl) dashboardEl.style.display = showDashboard ? '' : 'none';
  if (loadingEl) loadingEl.style.display = 'none';
  if (!isLogged || !authVerified) {
    if (contentEl) contentEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
    if (isLogged && !authVerified && loadingEl) loadingEl.style.display = 'flex';
  } else {
    if (loadingEl) loadingEl.style.display = 'none';
    if (contentEl) contentEl.style.display = authMustChangePassword ? 'none' : 'block';
  }
  if (btnLogout) btnLogout.disabled = !isLogged;
  const defaultName = isVoluntario ? 'Voluntário' : (isLider ? 'Líder' : 'Admin');
  const displayName = (authUser || defaultName).trim();
  const displayNameFormatted = displayName ? displayName.replace(/\b\w/g, (c) => c.toUpperCase()) : defaultName;
  if (authUserName) authUserName.textContent = displayNameFormatted;
  const initial = (displayNameFormatted || defaultName).slice(0, 1).toUpperCase();
  if (authUserInitial) {
    if (authFotoUrl) {
      const url = authFotoUrl.startsWith('http') ? authFotoUrl : `${API_BASE}${authFotoUrl}`;
      const img = document.createElement('img');
      img.className = 'avatar-img';
      img.alt = '';
      img.src = url;
      img.onerror = function () {
        authUserInitial.innerHTML = `<span class="avatar-initial">${escapeHtml(initial)}</span>`;
      };
      authUserInitial.innerHTML = '';
      authUserInitial.appendChild(img);
    } else {
      authUserInitial.innerHTML = `<span class="avatar-initial">${escapeHtml(initial)}</span>`;
    }
  }
  const roleEl = document.getElementById('authUserRole');
  const liderLabel = authMinisterioNomes?.length ? authMinisterioNomes.join(', ') : (authMinisterioNome || '');
  if (roleEl) roleEl.textContent = isVoluntario ? 'Voluntário' : (isLider ? (liderLabel ? `Líder · ${liderLabel}` : 'Líder') : 'Admin');
  if (navAdmin) navAdmin.style.display = isLogged && isAdmin ? 'flex' : 'none';
  const showNavLider = isLogged && !isAdmin && (authRole === 'lider' || isLider || (hasMinisterios && !isVoluntario));
  if (navLider) navLider.style.display = showNavLider ? 'flex' : 'none';
  if (navVoluntario) navVoluntario.style.display = isLogged && isVoluntario ? 'flex' : 'none';
  const navAdminCheckinMin = document.getElementById('navAdminCheckinMinisterio');
  if (navAdminCheckinMin) navAdminCheckinMin.style.display = isLogged && isAdmin && hasMinisterios ? '' : 'none';
  if (searchBox) searchBox.style.display = isLogged && isAdmin ? 'flex' : 'none';
  const btnRefresh = document.getElementById('btnRefresh');
  const filtersSection = document.querySelector('.view[data-view="resumo voluntarios"]');
  if (btnRefresh && filtersSection) btnRefresh.style.display = isLogged && (isAdmin || isLider || authRole === 'lider') ? '' : 'none';
  const cadastroLinkSection = document.getElementById('cadastroLinkSection');
  if (cadastroLinkSection) cadastroLinkSection.style.display = isLogged && isAdmin ? '' : 'none';
  const brdidSection = document.getElementById('brdidVerificacaoSection');
  if (brdidSection) brdidSection.style.display = isLogged && isAdmin ? '' : 'none';
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
  ['eventos-checkin', 'checkin-hoje', 'meus-checkins', 'perfil', 'ministros', 'usuarios', 'checkin-ministerio', 'resumo', 'voluntarios', 'escalas', 'escalas-criar'].forEach(v => setViewLoading(v, false));
  const perfilFields = [perfilNome, perfilEmail, perfilNascimento, perfilWhatsapp, perfilPais, perfilEstado, perfilCidade, perfilEvangelico, perfilIgreja, perfilTempoIgreja, perfilVoluntarioIgreja, perfilMinisterio, perfilHorasSemana, perfilAreas, perfilTestemunho];
  perfilFields.forEach(el => { if (el) el.value = ''; });
  if (perfilDisponibilidadeGroup) {
    perfilDisponibilidadeGroup.querySelectorAll('input[name="perfilDisponibilidadeDia"]').forEach(cb => { cb.checked = false; });
  }
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
  authVerified = true;
  const user = data?.user;
  authUser = typeof user === 'string' ? user : (user?.nome || user?.email || '');
  const rawRole = (user && user.role) != null ? user.role : (data?.role != null ? data.role : 'admin');
  authRole = normalizeAuthRole(rawRole);
  authEmail = (user && user.email) ? user.email : (data?.email != null ? data.email : null);
  authMinisterioId = (user && user.ministerioId) ? user.ministerioId : (data?.ministerioId != null ? data.ministerioId : null);
  authMinisterioNome = (user && user.ministerioNome) ? user.ministerioNome : (data?.ministerioNome != null ? data.ministerioNome : null);
  authMinisterioIds = Array.isArray(user?.ministerioIds) ? user.ministerioIds : (Array.isArray(data?.ministerioIds) ? data.ministerioIds : []);
  authMinisterioNomes = Array.isArray(user?.ministerioNomes) ? user.ministerioNomes : (Array.isArray(data?.ministerioNomes) ? data.ministerioNomes : []);
  authFotoUrl = (user && user.fotoUrl) ? user.fotoUrl : (data?.fotoUrl != null ? data.fotoUrl : null);
  authMustChangePassword = !!(user?.mustChangePassword || data?.mustChangePassword);
  authIsMasterAdmin = !!(user?.isMasterAdmin || data?.isMasterAdmin);
  if (authToken) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: authToken, user: authUser, role: authRole, email: authEmail, ministerioId: authMinisterioId, ministerioNome: authMinisterioNome, ministerioIds: authMinisterioIds, ministerioNomes: authMinisterioNomes, fotoUrl: authFotoUrl, mustChangePassword: authMustChangePassword, isMasterAdmin: authIsMasterAdmin }));
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
  authMinisterioIds = [];
  authMinisterioNomes = [];
  authFotoUrl = null;
  authMustChangePassword = false;
  authIsMasterAdmin = false;
  authVerified = false;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  clearUserContent();
  updateAuthUi();
}

/** Normaliza role para comparação: trim, lowercase e remove acentos ("líder" -> "lider"). */
function normalizeAuthRole(r) {
  if (r == null || r === '') return 'admin';
  const s = String(r).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
  if (s === 'lider' || s.includes('lider')) return 'lider';
  if (s === 'admin') return 'admin';
  if (s === 'voluntario') return 'voluntario';
  return s || 'admin';
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
    authRole = normalizeAuthRole(data.role ?? authRole);
    authEmail = data.email || authEmail;
    authMinisterioId = data.ministerioId != null ? data.ministerioId : authMinisterioId;
    authMinisterioNome = data.ministerioNome != null ? data.ministerioNome : authMinisterioNome;
    authMinisterioIds = Array.isArray(data.ministerioIds) ? data.ministerioIds : authMinisterioIds;
    authMinisterioNomes = Array.isArray(data.ministerioNomes) ? data.ministerioNomes : authMinisterioNomes;
    authFotoUrl = data.fotoUrl != null ? data.fotoUrl : authFotoUrl;
    authMustChangePassword = !!data.mustChangePassword;
    authIsMasterAdmin = data.isMasterAdmin !== undefined ? !!data.isMasterAdmin : authIsMasterAdmin;
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored && authToken) {
      try {
        const parsed = JSON.parse(stored);
        parsed.role = authRole;
        parsed.user = authUser;
        parsed.email = authEmail;
        parsed.ministerioId = authMinisterioId;
        parsed.ministerioNome = authMinisterioNome;
        parsed.ministerioIds = authMinisterioIds;
        parsed.ministerioNomes = authMinisterioNomes;
        parsed.fotoUrl = authFotoUrl;
        parsed.mustChangePassword = authMustChangePassword;
        parsed.isMasterAdmin = authIsMasterAdmin;
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(parsed));
      } catch (_) {}
    }
    authVerified = true;
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

const ADMIN_ONLY_VIEWS = ['ministros', 'usuarios', 'eventos-checkin', 'checkin', 'escalas-criar'];
const LIDER_VIEWS = ['checkin-ministerio', 'perfil', 'meus-checkins', 'escalas'];
const VOLUNTARIO_VIEWS = ['perfil', 'checkin-hoje', 'meus-checkins', 'escalas'];

let currentView = '';
let ministrosList = [];
let usersList = [];
let checkinsMinisterio = [];
let checkinMinisterioResumo = {};
let escalasList = [];
let escalaAtiva = null;
let candidaturasAll = [];
let candidaturasAnaliseFilters = {};
let escalasPreSelectId = null; // escalaId para pré-selecionar ao abrir view escalas

function setViewLoading(viewName, loading) {
  const section = document.querySelector(`.view[data-view="${viewName}"]`);
  if (section) section.classList.toggle('view-loading', loading);
}

const VIEW_LOAD_TIMEOUT_MS = 15000;
let viewLoadTimeoutId = null;

function getDefaultView() {
  const isVol = String(authRole || '').toLowerCase() === 'voluntario';
  const hasMinisterios = (authMinisterioNomes && authMinisterioNomes.length > 0) || authMinisterioNome;
  const isLider = (authRole === 'lider' || authRole === 'admin') && hasMinisterios;
  if (isVol) return 'perfil';
  if (authRole === 'lider' || (isLider && authRole !== 'admin')) return 'checkin-ministerio';
  return 'resumo';
}

/** Executa fetch da view com timeout; se travar, remove loading e redireciona sem animação. */
function runWithTimeout(viewName, fetchFn, timeoutMs) {
  const ms = timeoutMs || VIEW_LOAD_TIMEOUT_MS;
  if (viewLoadTimeoutId) clearTimeout(viewLoadTimeoutId);
  viewLoadTimeoutId = setTimeout(() => {
    viewLoadTimeoutId = null;
    setViewLoading(viewName, false);
    setView(getDefaultView(), { skipFetch: true });
  }, ms);
  Promise.resolve(fetchFn()).finally(() => {
    if (viewLoadTimeoutId) clearTimeout(viewLoadTimeoutId);
    viewLoadTimeoutId = null;
    setViewLoading(viewName, false);
  });
}

const LIST_PAGE_SIZE = 50;
let voluntariosPageOffset = 0;

const VIEW_META = {
  resumo: { title: 'Resumo', subtitle: 'Visão geral e indicadores.', role: 'admin' },
  voluntarios: { title: 'Voluntários', subtitle: 'Lista, filtros e envio de email.', role: 'admin' },
  ministros: { title: 'Ministérios', subtitle: 'Crie ministérios e defina líderes.', role: 'admin' },
  usuarios: { title: 'Usuários', subtitle: 'Perfis e permissões.', role: 'admin' },
  'eventos-checkin': { title: 'Eventos check-in', subtitle: 'Datas de culto para confirmação de presença.', role: 'admin' },
  checkin: { title: 'Check-in', subtitle: 'Registros por data e ministério.', role: 'admin' },
  'checkin-ministerio': { title: 'Check-ins do ministério', subtitle: 'Acompanhe quem confirmou presença (voluntários) no seu ministério.', role: 'lider' },
  perfil: { title: 'Meu perfil', subtitle: 'Seus dados de cadastro.', role: 'voluntario' },
  'checkin-hoje': { title: 'Check-in do dia', subtitle: 'Confirme presença no culto de hoje.', role: 'voluntario' },
  'meus-checkins': { title: 'Meus check-ins', subtitle: 'Histórico de presenças.', role: 'voluntario' },
  'escalas-criar': { title: 'Criar escalas', subtitle: 'Crie e edite escalas, copie links de candidatura.', role: 'admin' },
  escalas: { title: 'Escala', subtitle: 'Candidatos e aprovação de voluntários.', role: 'admin' },
};

function setView(view, options) {
  options = options || {};
  if (view === 'escalas' && options.escalaId) escalasPreSelectId = options.escalaId;
  if (viewLoadTimeoutId) {
    clearTimeout(viewLoadTimeoutId);
    viewLoadTimeoutId = null;
  }
  if (view === 'emails') view = 'voluntarios';
  const isVol = String(authRole || '').toLowerCase() === 'voluntario';
  const hasMinisterios = (authMinisterioNomes && authMinisterioNomes.length > 0) || authMinisterioNome;
  const isLider = (authRole === 'lider' || authRole === 'admin') && hasMinisterios;
  const isAdmin = authRole === 'admin';
  if (isVol && !VOLUNTARIO_VIEWS.includes(view)) view = 'perfil';
  if ((authRole === 'lider' || isLider) && !isAdmin && !LIDER_VIEWS.includes(view)) view = 'checkin-ministerio';
  if (!isVol && !isLider && !isAdmin && authRole !== 'lider') view = 'perfil';
  currentView = view;
  const meta = VIEW_META[view];
  const role = meta ? meta.role : 'admin';
  let nav = navAdmin;
  if (isVol) nav = navVoluntario;
  else if ((authRole === 'lider' || isLider) && !isAdmin) nav = navLider;
  else if (role === 'voluntario') nav = navVoluntario;
  else if (role === 'lider' || isLider) nav = navLider;
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
    const liderViewAllowed = (authRole === 'lider' || isLider) && authRole !== 'admin' && LIDER_VIEWS.includes(view);
    const volViewAllowed = isVol && VOLUNTARIO_VIEWS.includes(view);
    const match = allowed.includes(view) && (roleMatch || liderViewAllowed || volViewAllowed || perfilForLider || perfilForAdmin);
    item.classList.toggle('active', match);
  });
  if (pageTitle) pageTitle.textContent = (meta && meta.title) || 'Celeiro SP';
  if (pageSubtitle) pageSubtitle.textContent = (meta && meta.subtitle) || '';
  if (searchBox) searchBox.style.display = (isAdmin || isLider || authRole === 'lider') && view === 'voluntarios' ? 'flex' : 'none';
  if (view === 'voluntarios') voluntariosPageOffset = 0;
  if (!options.skipFetch) {
    const viewsWithFetch = ['eventos-checkin', 'checkin-hoje', 'meus-checkins', 'perfil', 'ministros', 'usuarios', 'checkin-ministerio', 'resumo', 'voluntarios', 'escalas', 'escalas-criar'];
    viewsWithFetch.forEach(v => setViewLoading(v, false)); // Limpa loading de todas as views primeiro
    if (view === 'eventos-checkin') runWithTimeout('eventos-checkin', () => fetchEventosCheckin());
    else if (view === 'checkin-hoje') runWithTimeout('checkin-hoje', () => fetchEventosHoje());
    else if (view === 'meus-checkins') runWithTimeout('meus-checkins', () => fetchMeusCheckins());
    else if (view === 'perfil') runWithTimeout('perfil', () => fetchPerfil());
    else if (view === 'ministros') runWithTimeout('ministros', () => fetchMinistros());
    else if (view === 'usuarios') runWithTimeout('usuarios', () => fetchUsers());
    else if (view === 'checkin-ministerio') runWithTimeout('checkin-ministerio', () => fetchCheckinsMinisterio());
    else if (view === 'escalas-criar') runWithTimeout('escalas-criar', () => fetchEscalasCriar());
    else if (view === 'escalas') runWithTimeout('escalas', () => fetchEscalas());
    if ((view === 'resumo' || view === 'voluntarios') && Array.isArray(voluntarios) && voluntarios.length > 0) {
      updateFilters();
    }
  }
  if (view === 'checkin' && isAdmin) {
    populateCheckinDataSelect([]);
    authFetch(`${API_BASE}/api/eventos-checkin`).then(r => r.ok ? r.json() : []).then(list => {
      eventosCheckin = list || [];
      if (checkinEvento) {
        checkinEvento.innerHTML = '<option value="">Todos os eventos</option>' + eventosCheckin.map(e => {
          const d = new Date(e.data);
          return `<option value="${e._id}">${e.label || d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })}</option>`;
        }).join('');
      }
      fetchCheckinsWithFilters();
    }).catch(() => fetchCheckinsWithFilters());
  }
  const canSeeResumoVoluntarios = isAdmin || isLider || authRole === 'lider';
  if ((view === 'resumo' || view === 'voluntarios') && canSeeResumoVoluntarios) {
    if (!Array.isArray(voluntarios) || voluntarios.length === 0) {
      const isLeaderNotAdmin = (authRole === 'lider' || isLider) && !isAdmin;
      if (isLeaderNotAdmin) render();
      fetchVoluntarios({ showGlobalLoading: !isLeaderNotAdmin });
    } else {
      render();
    }
  }
}

async function fetchVoluntarios(opts) {
  opts = opts || {};
  if (!authToken) {
    updateAuthUi();
    return;
  }
  const useGlobalLoading = opts.showGlobalLoading !== false;
  if (useGlobalLoading) showLoading(true);
  let settled = false;
  const timeoutId = setTimeout(() => {
    if (settled) return;
    settled = true;
    if (useGlobalLoading) {
      showLoading(false);
      showError('A conexão demorou. Tente novamente.');
    }
  }, VIEW_LOAD_TIMEOUT_MS);
  try {
    const r = await authFetch(`${API_BASE}/api/voluntarios`);
    if (settled) return;
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${r.status}`);
    }
    const data = await r.json();
    voluntarios = data.voluntarios || [];
    resumo = data.resumo || {};
    render();
    settled = true;
    clearTimeout(timeoutId);
    if (useGlobalLoading) showLoading(false);
  } catch (e) {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    if (e.message === 'AUTH_REQUIRED') {
      if (useGlobalLoading) showLoading(false);
      return;
    }
    if (useGlobalLoading) {
      showError(e.message || 'Verifique se o servidor está rodando em ' + API_BASE);
    } else {
      alert('Erro ao carregar voluntários: ' + (e.message || 'Servidor não respondeu'));
    }
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

/** Extrai datas únicas (YYYY-MM-DD) em Brasília para bater com o filtro do backend. Sempre inclui "Hoje". */
function populateCheckinDataSelect(checkinsArray) {
  if (!checkinData) return;
  const list = Array.isArray(checkinsArray) ? checkinsArray : [];
  const dateSet = new Set();
  const hojeStr = getHojeDateString();
  dateSet.add(hojeStr);
  list.forEach(c => {
    const d = c.dataCheckin ? new Date(c.dataCheckin) : (c.timestampMs != null || c.timestamp ? new Date(c.timestampMs ?? c.timestamp) : null);
    if (d && !Number.isNaN(d.getTime())) {
      const dateStr = d.toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
      if (dateStr) dateSet.add(dateStr);
    }
  });
  const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));
  const currentValue = checkinData.value;
  const options = ['<option value="">Todas as datas</option>'];
  const hojeLabel = 'Hoje (' + new Date(hojeStr + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA, day: '2-digit', month: '2-digit', year: 'numeric' }) + ')';
  options.push(`<option value="${escapeAttr(hojeStr)}">${escapeHtml(hojeLabel)}</option>`);
  dates.forEach(dateStr => {
    if (dateStr === hojeStr) return;
    const d = new Date(dateStr + 'T12:00:00');
    const label = d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    options.push(`<option value="${escapeAttr(dateStr)}">${escapeHtml(label)}</option>`);
  });
  checkinData.innerHTML = options.join('');
  if (currentValue === hojeStr || dates.includes(currentValue)) checkinData.value = currentValue;
}

function fetchCheckinsWithFilters(opts) {
  const params = new URLSearchParams();
  const dataOverride = opts && opts.data !== undefined ? opts.data : null;
  const dataFilter = dataOverride !== null ? dataOverride : (checkinData?.value || '');
  if (dataFilter) params.set('data', dataFilter);
  if (checkinEvento?.value) params.set('eventoId', checkinEvento.value);
  if (checkinMinisterio?.value) params.set('ministerio', checkinMinisterio.value);
  authFetch(`${API_BASE}/api/checkins?${params}`).then(r => r.json()).then(data => {
    checkins = data.checkins || [];
    checkinResumo = data.resumo || {};
    // Guarda a lista completa (sem filtros de servidor) para contar check-ins históricos por pessoa
    if (!dataFilter && !checkinEvento?.value && !checkinMinisterio?.value) {
      allCheckins = checkins;
    }
    if (!dataFilter) populateCheckinDataSelect(checkins);
    if (dataOverride !== null && checkinData) checkinData.value = dataOverride;
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
  const countEl = document.getElementById('ministrosCount');
  if (countEl) countEl.textContent = `(${(ministrosList || []).length})`;
  if (!tbody) return;
  if (!ministrosList.length) {
    tbody.innerHTML = '<tr><td colspan="3">Nenhum ministério. Clique em "Novo ministério" para criar.</td></tr>';
    return;
  }
  const list = ministrosList.slice(0, LIST_PAGE_SIZE);
  tbody.innerHTML = list.map(m => {
    const lideres = m.lideres || [];
    const liderNomes = lideres.length ? lideres.map(l => escapeHtml(l.nome || l.email || '—')).join(', ') : '—';
    return `<tr data-ministerio-id="${escapeAttr(m._id)}">
      <td>${escapeHtml(m.nome || '—')}</td>
      <td>${liderNomes}</td>
      <td>
        <button type="button" class="btn btn-sm btn-primary" data-assign-lider="${escapeAttr(m._id)}" data-ministerio-nome="${escapeAttr(m.nome || '')}">Definir líderes</button>
        <button type="button" class="btn btn-sm btn-ghost" data-edit-ministerio="${escapeAttr(m._id)}" data-edit-nome="${escapeAttr(m.nome || '')}">Editar</button>
        <button type="button" class="btn btn-sm btn-ghost" data-delete-ministerio="${escapeAttr(m._id)}" data-delete-nome="${escapeAttr(m.nome || '')}">Excluir</button>
      </td>
    </tr>`;
  }).join('');
  if (ministrosList.length > LIST_PAGE_SIZE) {
    tbody.innerHTML += `<tr><td colspan="3" class="list-more-hint">Exibindo os primeiros ${LIST_PAGE_SIZE} de ${ministrosList.length} ministérios.</td></tr>`;
  }
  tbody.querySelectorAll('[data-assign-lider]').forEach(btn => {
    btn.addEventListener('click', () => openAssignLider(btn.getAttribute('data-assign-lider'), btn.getAttribute('data-ministerio-nome')));
  });
  tbody.querySelectorAll('[data-edit-ministerio]').forEach(btn => {
    btn.addEventListener('click', () => openEditarMinisterio(btn.getAttribute('data-edit-ministerio'), btn.getAttribute('data-edit-nome')));
  });
  tbody.querySelectorAll('[data-delete-ministerio]').forEach(btn => {
    btn.addEventListener('click', () => excluirMinisterio(btn.getAttribute('data-delete-ministerio'), btn.getAttribute('data-delete-nome')));
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
/** Lista de usuários exibida no modal (pode incluir usuários adicionados pela busca por email). */
let assignLiderUserList = [];

async function openAssignLider(ministerioId, ministerioNome) {
  assignLiderMinisterioId = ministerioId;
  const nomeEl = document.getElementById('assignLiderMinisterioNome');
  if (nomeEl) nomeEl.textContent = `Ministério: ${ministerioNome || ministerioId}`;
  const msgEl = document.getElementById('assignLiderSearchMsg');
  if (msgEl) msgEl.textContent = '';
  document.getElementById('assignLiderSearchEmail')?.value && (document.getElementById('assignLiderSearchEmail').value = '');
  if (!usersList.length) {
    try {
      const r = await authFetch(`${API_BASE}/api/users`);
      if (r.ok) usersList = await r.json();
    } catch (_) {}
  }
  assignLiderUserList = (usersList || []).slice();
  renderAssignLiderCheckboxes();
  document.getElementById('modalAssignLider')?.classList.add('open');
}

function renderAssignLiderCheckboxes() {
  const ministerio = assignLiderMinisterioId && (ministrosList || []).find(m => String(m._id) === String(assignLiderMinisterioId));
  const liderIds = new Set((ministerio?.lideres || []).map(l => String(l._id)));
  const container = document.getElementById('assignLiderCheckboxes');
  if (!container) return;
  container.innerHTML = assignLiderUserList.map(u => {
    const id = u._id;
    const label = `${u.nome || u.email} (${u.role || 'voluntario'})`;
    const checked = liderIds.has(String(id)) ? ' checked' : '';
    return `<label class="checkbox-label" style="display:block; margin-bottom:6px;"><input type="checkbox" data-user-id="${escapeAttr(id)}"${checked}> ${escapeHtml(label)}</label>`;
  }).join('');
}

async function assignLiderSearchByEmail() {
  const input = document.getElementById('assignLiderSearchEmail');
  const msgEl = document.getElementById('assignLiderSearchMsg');
  const email = (input?.value || '').trim().toLowerCase();
  if (!msgEl) return;
  if (!email || !email.includes('@')) { msgEl.textContent = 'Digite um email válido.'; return; }
  msgEl.textContent = 'Buscando...';
  try {
    const r = await authFetch(`${API_BASE}/api/users/by-email?email=${encodeURIComponent(email)}`);
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      msgEl.textContent = data.error || 'Nenhum usuário com este email. A pessoa precisa ter uma conta (login) no sistema.';
      return;
    }
    const user = await r.json();
    const already = assignLiderUserList.some(u => String(u._id) === String(user._id));
    if (!already) {
      assignLiderUserList.push(user);
      const container = document.getElementById('assignLiderCheckboxes');
      if (container) {
        const label = `${user.nome || user.email} (${user.role || 'voluntario'})`;
        const div = document.createElement('label');
        div.className = 'checkbox-label';
        div.style.cssText = 'display:block; margin-bottom:6px;';
        div.innerHTML = `<input type="checkbox" data-user-id="${escapeAttr(String(user._id))}" checked> ${escapeHtml(label)}`;
        container.appendChild(div);
      }
    }
    msgEl.textContent = `Adicionado: ${user.nome || user.email}. Clique em Salvar líderes para confirmar.`;
    if (input) input.value = '';
  } catch (e) {
    msgEl.textContent = e.message === 'AUTH_REQUIRED' ? 'Sessão expirada.' : 'Erro ao buscar. Tente novamente.';
  }
}

function openEditarMinisterio(id, nome) {
  const idEl = document.getElementById('editarMinisterioId');
  const nomeEl = document.getElementById('editarMinisterioNome');
  if (idEl) idEl.value = id || '';
  if (nomeEl) nomeEl.value = (nome || '').trim();
  document.getElementById('modalEditarMinisterio')?.classList.add('open');
}

async function saveEditarMinisterio(e) {
  e.preventDefault();
  const id = document.getElementById('editarMinisterioId')?.value?.trim();
  const nome = document.getElementById('editarMinisterioNome')?.value?.trim();
  if (!id || !nome) return;
  try {
    const r = await authFetch(`${API_BASE}/api/ministros/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    document.getElementById('modalEditarMinisterio')?.classList.remove('open');
    document.getElementById('editarMinisterioId').value = '';
    document.getElementById('editarMinisterioNome').value = '';
    fetchMinistros();
  } catch (err) { alert(err.message || 'Erro ao salvar ministério.'); }
}

async function excluirMinisterio(id, nome) {
  if (!id) return;
  const msg = nome ? `Excluir o ministério "${nome.replace(/"/g, '')}"? Os líderes vinculados passarão a voluntários.` : 'Excluir este ministério?';
  if (!confirm(msg)) return;
  try {
    const r = await authFetch(`${API_BASE}/api/ministros/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    fetchMinistros();
    fetchUsers();
  } catch (err) { alert(err.message || 'Erro ao excluir ministério.'); }
}

async function assignLider() {
  if (!assignLiderMinisterioId) return;
  const container = document.getElementById('assignLiderCheckboxes');
  const checked = container ? Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.getAttribute('data-user-id')).filter(Boolean) : [];
  try {
    const r = await authFetch(`${API_BASE}/api/ministros/${assignLiderMinisterioId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liderIds: checked }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    document.getElementById('modalAssignLider')?.classList.remove('open');
    assignLiderMinisterioId = null;
    fetchMinistros();
    fetchUsers();
  } catch (err) { alert(err.message || 'Erro ao salvar líderes.'); }
}

async function fetchUsers() {
  if (!authToken) return;
  const search = document.getElementById('usuariosSearch')?.value?.trim() || '';
  const ativo = document.getElementById('usuariosFilterAtivo')?.value || '';
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (ativo) params.set('ativo', ativo);
  const qs = params.toString() ? '?' + params.toString() : '';
  try {
    const r = await authFetch(`${API_BASE}/api/users${qs}`);
    if (!r.ok) return;
    usersList = await r.json();
    if (currentView !== 'usuarios') return;
    renderUsers();
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
  finally { setViewLoading('usuarios', false); }
}

function renderUsers() {
  const tbody = document.getElementById('usuariosBody');
  const countEl = document.getElementById('usuariosCount');
  if (countEl) countEl.textContent = `(${(usersList || []).length})`;
  if (!tbody) return;
  if (!usersList.length) {
    tbody.innerHTML = '<tr><td colspan="6">Nenhum usuário encontrado.</td></tr>';
    return;
  }
  const roleLabel = r => ({ admin: 'Admin', voluntario: 'Voluntário', lider: 'Líder' }[r] || r);
  const list = usersList.slice(0, LIST_PAGE_SIZE);
  tbody.innerHTML = list.map(u => {
    const mins = u.ministerioIds || [];
    const minNomes = mins.length ? mins.map(m => (m && m.nome) ? m.nome : '').filter(Boolean).join(', ') || '—' : (u.role === 'lider' || (u.role === 'admin' && mins.length) ? '—' : '');
    const ativo = u.ativo !== false;
    const statusText = ativo ? 'Ativo' : 'Inativo';
    const statusClass = ativo ? 'evento-status-ativo' : 'evento-status-inativo';
    const btnToggleLabel = ativo ? 'Desativar' : 'Reativar';
    const btnExcluir = authIsMasterAdmin ? ` <button type="button" class="btn btn-sm btn-ghost" data-user-delete="${escapeAttr(u._id)}" data-user-delete-email="${escapeAttr(u.email)}" data-user-delete-nome="${escapeAttr(u.nome || '')}" title="Excluir usuário (apenas master admin)">Excluir</button>` : '';
    return `<tr>
      <td>${escapeHtml(capitalizeWords(u.nome) || '—')}</td>
      <td>${escapeHtml(u.email || '—')}</td>
      <td>${escapeHtml(roleLabel(u.role))}</td>
      <td>${escapeHtml(minNomes)}</td>
      <td><span class="evento-status ${statusClass}">${statusText}</span></td>
      <td><button type="button" class="btn btn-sm btn-primary" data-user-role="${escapeAttr(u._id)}" data-user-email="${escapeAttr(u.email)}">Alterar perfil</button> <button type="button" class="btn btn-sm btn-ghost" data-user-history="${escapeAttr(u._id)}">Histórico</button> <button type="button" class="btn btn-sm ${ativo ? 'btn-ghost' : 'btn-primary'}" data-user-toggle-ativo="${escapeAttr(u._id)}" data-user-ativo="${ativo}">${btnToggleLabel}</button>${btnExcluir}</td>
    </tr>`;
  }).join('');
  if (usersList.length > LIST_PAGE_SIZE) {
    tbody.innerHTML += `<tr><td colspan="6" class="list-more-hint">Exibindo os primeiros ${LIST_PAGE_SIZE} de ${usersList.length} usuários.</td></tr>`;
  }
  tbody.querySelectorAll('[data-user-role]').forEach(btn => {
    if (btn.hasAttribute('data-user-email')) btn.addEventListener('click', () => openModalUserRole(btn.getAttribute('data-user-role'), btn.getAttribute('data-user-email')));
  });
  tbody.querySelectorAll('[data-user-history]').forEach(btn => {
    btn.addEventListener('click', () => fetchUserHistory(btn.getAttribute('data-user-history')));
  });
  tbody.querySelectorAll('[data-user-toggle-ativo]').forEach(btn => {
    btn.addEventListener('click', () => toggleUserAtivo(btn.getAttribute('data-user-toggle-ativo'), btn.getAttribute('data-user-ativo') === 'true'));
  });
  tbody.querySelectorAll('[data-user-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteUser(btn.getAttribute('data-user-delete'), btn.getAttribute('data-user-delete-email'), btn.getAttribute('data-user-delete-nome')));
  });
}

async function toggleUserAtivo(userId, currentlyAtivo) {
  if (!userId || !authToken) return;
  const novoAtivo = !currentlyAtivo;
  const msg = novoAtivo ? 'Reativar este usuário? Ele poderá fazer login novamente.' : 'Desativar este usuário? Ele não poderá mais fazer login. Os dados são mantidos (não são excluídos).';
  if (!confirm(msg)) return;
  try {
    const r = await authFetch(`${API_BASE}/api/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: novoAtivo }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    fetchUsers();
  } catch (err) { alert(err.message || 'Erro ao atualizar.'); }
}

async function deleteUser(userId, email, nome) {
  if (!userId || !authToken || !authIsMasterAdmin) return;
  const msg = `Excluir permanentemente o usuário "${(nome || email || userId).replace(/"/g, '')}"? Esta ação não pode ser desfeita.`;
  if (!confirm(msg)) return;
  try {
    const r = await authFetch(`${API_BASE}/api/users/${userId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha ao excluir');
    fetchUsers();
  } catch (err) { alert(err.message || 'Erro ao excluir usuário.'); }
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
  const minContainer = document.getElementById('userMinisterioCheckboxes');
  if (roleSel) roleSel.value = u?.role || 'voluntario';
  const showMin = roleSel?.value === 'lider' || roleSel?.value === 'admin';
  if (minGrp) minGrp.style.display = showMin ? 'block' : 'none';
  if (minContainer) {
    const userMinIds = new Set((u?.ministerioIds || []).map(m => String(m._id || m)));
    minContainer.innerHTML = (ministrosList || []).map(m => {
      const checked = userMinIds.has(String(m._id)) ? ' checked' : '';
      return `<label class="checkbox-label" style="display:block; margin-bottom:6px;"><input type="checkbox" data-ministerio-id="${escapeAttr(m._id)}"${checked}> ${escapeHtml(m.nome || '')}</label>`;
    }).join('');
  }
  const formBody = document.getElementById('modalUserRoleFormBody');
  const historyBody = document.getElementById('modalUserHistoryBody');
  if (formBody) formBody.style.display = 'block';
  if (historyBody) historyBody.style.display = 'none';
  document.getElementById('modalUserRole')?.classList.add('open');
}

async function saveUserRole() {
  if (!modalUserRoleUserId) return;
  const role = document.getElementById('userRoleSelect')?.value;
  const minContainer = document.getElementById('userMinisterioCheckboxes');
  const ministerioIds = (role === 'lider' || role === 'admin') && minContainer
    ? Array.from(minContainer.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.getAttribute('data-ministerio-id')).filter(Boolean)
    : [];
  try {
    const r = await authFetch(`${API_BASE}/api/users/${modalUserRoleUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, ministerioIds: (role === 'lider' || role === 'admin') ? ministerioIds : undefined }),
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
      dateSelect.innerHTML = '<option value="">Todas as datas</option>' + dates.map(d => `<option value="${escapeAttr(d)}">${escapeHtml(new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }))}</option>`).join('');
      if (currentDataVal && dates.includes(currentDataVal)) dateSelect.value = currentDataVal;
    }
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
  finally { setViewLoading('checkin-ministerio', false); }
}

function renderCheckinsMinisterio() {
  const total = (checkinsMinisterio || []).length;
  const totalEl = document.getElementById('checkinMinisterioTotal');
  const countEl = document.getElementById('checkinMinisterioCount');
  const bodyEl = document.getElementById('checkinMinisterioBody');
  if (totalEl) totalEl.textContent = total;
  if (countEl) countEl.textContent = `(${total})`;
  if (!bodyEl) return;
  if (!checkinsMinisterio.length) {
    bodyEl.innerHTML = '<tr><td colspan="4">Nenhum voluntário confirmou presença no seu ministério para o filtro selecionado. Quando fizerem check-in, aparecerão aqui.</td></tr>';
    return;
  }
  const list = checkinsMinisterio.slice(0, LIST_PAGE_SIZE);
  bodyEl.innerHTML = list.map(c => {
    const email = (c.email || '').toLowerCase().trim();
    return `<tr>
      <td><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(c.nome || '—')}</button></td>
      <td><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(c.email || '—')}</button></td>
      <td>${escapeHtml(c.ministerio || '—')}</td>
      <td>${escapeHtml(c.timestamp || '—')}</td>
    </tr>`;
  }).join('');
  if (checkinsMinisterio.length > LIST_PAGE_SIZE) {
    bodyEl.innerHTML += `<tr><td colspan="4" class="list-more-hint">Exibindo os primeiros ${LIST_PAGE_SIZE} de ${checkinsMinisterio.length}.</td></tr>`;
  }
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
    const countEl = document.getElementById('eventosCheckinCount');
    if (countEl) countEl.textContent = `(${eventosCheckin.length})`;
    if (eventosCheckinBody) {
      if (!eventosCheckin.length) {
        eventosCheckinBody.innerHTML = '<tr><td colspan="6">Nenhum evento. Clique em "Novo evento de check-in" para criar.</td></tr>';
      } else {
        const displayList = eventosCheckin.slice(0, LIST_PAGE_SIZE);
        eventosCheckinBody.innerHTML = displayList.map(e => {
          const eventId = (e._id != null ? String(e._id) : '');
          const d = new Date(e.data);
          const label = e.label || d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA });
          const hin = (e.horarioInicio || '').trim();
          const hfi = (e.horarioFim || '').trim();
          const horarioText = (hin || hfi) ? `${hin || '—'} – ${hfi || '—'} (Brasília)` : 'Dia inteiro (Brasília)';
          const ativo = e.ativo !== false;
          const statusText = ativo ? 'Ativo' : 'Inativo';
          const btnLabel = ativo ? 'Desligar' : 'Ligar';
          return `<tr data-event-id="${escapeAttr(eventId)}">
            <td>${d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })}</td>
            <td>${escapeHtml(label)}</td>
            <td>${escapeHtml(horarioText)}</td>
            <td><span class="evento-status ${ativo ? 'evento-status-ativo' : 'evento-status-inativo'}">${statusText}</span></td>
            <td><button type="button" class="btn btn-sm btn-primary" data-event-link="${escapeAttr(eventId)}" title="Copiar link para check-in público (qualquer pessoa)">Copiar link</button></td>
            <td><button type="button" class="btn btn-sm btn-ghost" data-event-edit="${escapeAttr(eventId)}" title="Editar horários e status">Editar</button> <button type="button" class="btn btn-sm ${ativo ? 'btn-ghost' : 'btn-primary'}" data-event-toggle="${escapeAttr(eventId)}">${btnLabel}</button> <button type="button" class="btn btn-sm btn-ghost" data-event-delete="${escapeAttr(eventId)}" title="Excluir evento">Excluir</button></td>
          </tr>`;
        }).join('');
        if (eventosCheckin.length > LIST_PAGE_SIZE) {
          eventosCheckinBody.innerHTML += `<tr><td colspan="6" class="list-more-hint">Exibindo os primeiros ${LIST_PAGE_SIZE} de ${eventosCheckin.length} eventos.</td></tr>`;
        }
        eventosCheckinBody.querySelectorAll('[data-event-edit]').forEach(btn => {
          btn.addEventListener('click', () => openModalEditarEvento(btn.getAttribute('data-event-edit')));
        });
        eventosCheckinBody.querySelectorAll('[data-event-toggle]').forEach(btn => {
          btn.addEventListener('click', () => toggleEventoAtivo(btn.getAttribute('data-event-toggle')));
        });
        eventosCheckinBody.querySelectorAll('[data-event-link]').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-event-link');
            const url = `${window.location.origin}${window.location.pathname.replace(/\/$/, '') || ''}?checkin=${encodeURIComponent(id)}`;
            navigator.clipboard.writeText(url).then(() => alert('Link copiado! Compartilhe para as pessoas fazerem check-in (email + ministério).')).catch(() => prompt('Copie o link:', url));
          });
        });
        eventosCheckinBody.querySelectorAll('[data-event-delete]').forEach(btn => {
          btn.addEventListener('click', () => excluirEventoCheckin(btn.getAttribute('data-event-delete')));
        });
      }
    }
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
  finally { setViewLoading('eventos-checkin', false); }
}

async function excluirEventoCheckin(eventoId) {
  if (!eventoId || !authToken) return;
  const evento = (eventosCheckin || []).find(e => String(e._id) === String(eventoId));
  const label = evento?.label || (evento?.data ? new Date(evento.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '');
  if (!confirm(`Excluir o evento "${(label || '').replace(/"/g, '')}"? Esta ação não pode ser desfeita.`)) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin/${eventoId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    fetchEventosCheckin();
  } catch (err) { alert(err.message || 'Erro ao excluir evento.'); }
}

function openModalEditarEvento(eventoId) {
  const evento = (eventosCheckin || []).find(e => String(e._id) === String(eventoId));
  if (!evento) return;
  const modal = document.getElementById('modalEditarEvento');
  const idEl = document.getElementById('editarEventoId');
  const labelEl = document.getElementById('editarEventoLabel');
  const hinEl = document.getElementById('editarEventoHorarioInicio');
  const hfiEl = document.getElementById('editarEventoHorarioFim');
  const ativoEl = document.getElementById('editarEventoAtivo');
  if (idEl) idEl.value = String(evento._id || '');
  if (labelEl) labelEl.value = (evento.label || '').trim();
  if (hinEl) hinEl.value = (evento.horarioInicio || '').trim();
  if (hfiEl) hfiEl.value = (evento.horarioFim || '').trim();
  if (ativoEl) ativoEl.checked = evento.ativo !== false;
  if (modal) { modal.setAttribute('aria-hidden', 'false'); modal.classList.add('open'); }
}

async function toggleEventoAtivo(eventoId) {
  if (!eventoId || !authToken) return;
  const evento = (eventosCheckin || []).find(e => String(e._id) === String(eventoId));
  if (!evento) return;
  const novoAtivo = !evento.ativo;
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
          const label = e.label || d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA });
          return `<div class="kpi-card evento-hoje-card" style="margin-bottom:12px"><strong>${escapeHtml(label)}</strong><br><small>${d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })} (Brasília)</small></div>`;
        }).join('');
        if (formConfirmarCheckin) formConfirmarCheckin.style.display = 'block';
        if (confirmarMinisterio && confirmarMinisterio.options.length <= 1) {
          confirmarMinisterio.innerHTML = '<option value="">Selecione</option>' + MINISTERIOS_PADRAO.map(m => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('') + '<option value="Outro">Outro</option>';
        }
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
    confirmarMinisterio.value = '';
    await fetchMeusCheckins();
    setView('meus-checkins');
    const msgEl = document.getElementById('checkinRecebidoMsg');
    if (msgEl) {
      msgEl.textContent = 'Check-in recebido!';
      msgEl.style.display = 'block';
      setTimeout(() => { msgEl.style.display = 'none'; }, 4000);
    }
  } catch (e) {
    alert(e.message || 'Erro ao confirmar check-in.');
  }
}

function formatNascimentoParaInput(val) {
  if (!val) return '';
  const d = typeof val === 'string' ? parseNascimentoStr(val) : val;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function parseNascimentoStr(s) {
  if (!s) return null;
  const t = String(s).trim();
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return new Date(t);
}
function nascimentoDateInputToApi(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}
function renderMinisterioSelect(selectId, currentValue) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const value = (typeof currentValue === 'string' ? currentValue : (sel.dataset.lastValue || sel.value)) || '';
  const isOutro = value && value !== '__outro__' && !MINISTERIOS_PADRAO.includes(value);
  sel.innerHTML = '<option value="">Selecione</option>' + MINISTERIOS_PADRAO.map(m => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('') + '<option value="__outro__">Outro</option>';
  if (isOutro) {
    sel.value = '__outro__';
    const outroInput = document.getElementById(selectId + 'Outro');
    if (outroInput) { outroInput.value = value; outroInput.style.display = ''; }
  } else if (value && value !== '__outro__') {
    sel.value = value;
  }
  sel.dataset.lastValue = value;
}

function getMinisterioValue(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return '';
  if (sel.value === '__outro__') {
    const outro = document.getElementById(selectId + 'Outro');
    return (outro?.value || '').trim() || '';
  }
  return (sel.value || '').trim();
}

function toggleMinisterioOutroVisibility(selectId) {
  const sel = document.getElementById(selectId);
  const outro = document.getElementById(selectId + 'Outro');
  if (!sel || !outro) return;
  if (sel.value === '__outro__') {
    outro.style.display = '';
    outro.placeholder = 'Especifique o ministério';
  } else {
    outro.style.display = 'none';
    outro.value = '';
  }
}

function populatePerfilEstado() {
  const sel = document.getElementById('perfilEstado');
  if (!sel || sel.options.length > 1) return;
  sel.innerHTML = '<option value="">Selecione o estado (UF)</option>' + UFS_BR.map(uf => `<option value="${uf}">${uf}</option>`).join('');
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
      if (perfilEmail) perfilEmail.value = perfil.email || authEmail || '';
      if (perfilNascimento) perfilNascimento.value = formatNascimentoParaInput(perfil.nascimento);
      if (perfilWhatsapp) perfilWhatsapp.value = perfil.whatsapp ? (formatarWhatsApp(perfil.whatsapp) || perfil.whatsapp) : '';
      if (perfilPais) perfilPais.value = perfil.pais || '';
      if (perfilEstado) perfilEstado.value = perfil.estado || '';
      if (perfilCidade) perfilCidade.value = perfil.cidade || '';
      if (perfilEvangelico) perfilEvangelico.value = perfil.evangelico || '';
      if (perfilIgreja) perfilIgreja.value = perfil.igreja || '';
      if (perfilTempoIgreja) perfilTempoIgreja.value = perfil.tempoIgreja || '';
      if (perfilVoluntarioIgreja) perfilVoluntarioIgreja.value = perfil.voluntarioIgreja || '';
      renderMinisterioSelect('perfilMinisterio', perfil.ministerio || '');
      toggleMinisterioOutroVisibility('perfilMinisterio');
      const dispVal = (perfil.disponibilidade || '').split(',').map(d => d.trim()).filter(Boolean);
      if (perfilDisponibilidadeGroup) {
        perfilDisponibilidadeGroup.querySelectorAll('input[name="perfilDisponibilidadeDia"]').forEach(cb => {
          cb.checked = dispVal.includes(cb.value);
        });
      }
      if (perfilHorasSemana) perfilHorasSemana.value = perfil.horasSemana || '';
      if (perfilAreas) perfilAreas.value = Array.isArray(perfil.areas) ? perfil.areas.join(', ') : (perfil.areas || '');
      if (perfilTestemunho) perfilTestemunho.value = perfil.testemunho || '';
    } else {
      [perfilNome, perfilEmail, perfilNascimento, perfilWhatsapp, perfilPais, perfilCidade, perfilEvangelico, perfilIgreja, perfilTempoIgreja, perfilVoluntarioIgreja, perfilHorasSemana, perfilAreas, perfilTestemunho].forEach(el => { if (el) el.value = ''; });
      if (perfilDisponibilidadeGroup) {
        perfilDisponibilidadeGroup.querySelectorAll('input[name="perfilDisponibilidadeDia"]').forEach(cb => { cb.checked = false; });
      }
      renderMinisterioSelect('perfilMinisterio', '');
      const perfilMinisterioOutro = document.getElementById('perfilMinisterioOutro');
      if (perfilMinisterioOutro) { perfilMinisterioOutro.value = ''; perfilMinisterioOutro.style.display = 'none'; }
      if (perfilEstado) perfilEstado.value = '';
    }
    if (perfil && perfil.fotoUrl != null) {
      authFotoUrl = perfil.fotoUrl;
      if (typeof localStorage !== 'undefined') {
        try {
          const stored = localStorage.getItem(AUTH_STORAGE_KEY);
          if (stored) { const p = JSON.parse(stored); p.fotoUrl = authFotoUrl; localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(p)); }
        } catch (_) {}
      }
      updateAuthUi();
    }
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
  finally { setViewLoading('perfil', false); }
}

async function savePerfil(e) {
  e.preventDefault();
  if (!authToken) return;
  const whatsappRaw = perfilWhatsapp?.value?.trim();
  if (whatsappRaw && !validarWhatsApp(whatsappRaw)) {
    alert('WhatsApp inválido. Informe 10 ou 11 dígitos (DDD + número).');
    return;
  }
  const areasStr = perfilAreas?.value?.trim();
  const payload = {
    nome: perfilNome?.value?.trim(),
    nascimento: nascimentoDateInputToApi(perfilNascimento?.value) || undefined,
    whatsapp: whatsappRaw || undefined,
    pais: perfilPais?.value?.trim(),
    estado: perfilEstado?.value?.trim(),
    cidade: perfilCidade?.value?.trim(),
    evangelico: perfilEvangelico?.value?.trim(),
    igreja: perfilIgreja?.value?.trim(),
    tempoIgreja: perfilTempoIgreja?.value?.trim(),
    voluntarioIgreja: perfilVoluntarioIgreja?.value?.trim(),
    ministerio: getMinisterioValue('perfilMinisterio') || undefined,
    disponibilidade: perfilDisponibilidadeGroup
    ? Array.from(perfilDisponibilidadeGroup.querySelectorAll('input[name="perfilDisponibilidadeDia"]:checked')).map(cb => cb.value).join(', ')
    : '',
    horasSemana: perfilHorasSemana?.value?.trim(),
    areas: areasStr ? areasStr.split(',').map(a => a.trim()).filter(Boolean) : [],
    testemunho: perfilTestemunho?.value?.trim() || undefined,
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
      const label = e.label || d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA });
      return `<div class="kpi-card perfil-evento-card"><strong>${escapeHtml(label)}</strong><br><small>${d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })} (Brasília)</small></div>`;
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

async function fetchMeusCheckins() {
  if (!authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/checkins`);
    if (!r.ok) return;
    const data = await r.json();
    if (currentView !== 'meus-checkins') return;
    const list = data.checkins || [];
    const countEl = document.getElementById('meusCheckinsCount');
    if (countEl) countEl.textContent = `(${list.length})`;
    if (meusCheckinsBody) {
      if (!list.length) {
        meusCheckinsBody.innerHTML = '<tr><td colspan="3">Nenhum check-in registrado.</td></tr>';
      } else {
        const slice = list.slice(0, LIST_PAGE_SIZE);
        meusCheckinsBody.innerHTML = slice.map(c => {
          const dataStr = c.timestamp ? new Date(c.timestampMs || c.timestamp).toLocaleDateString('pt-BR') : '—';
          const horaStr = c.timestamp ? new Date(c.timestampMs || c.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
          return `<tr><td>${dataStr}</td><td>${escapeHtml(c.ministerio || '—')}</td><td>${horaStr}</td></tr>`;
        }).join('');
        if (list.length > LIST_PAGE_SIZE) {
          meusCheckinsBody.innerHTML += `<tr><td colspan="3" class="list-more-hint">Exibindo os primeiros ${LIST_PAGE_SIZE} de ${list.length}.</td></tr>`;
        }
      }
    }
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
  finally { setViewLoading('meus-checkins', false); }
}

async function fetchAllData() {
  await Promise.all([fetchVoluntarios(), fetchCheckins()]);
}

/** Uma única chamada a getFilteredVoluntarios e atualiza KPIs, gráficos, tabela e contadores. */
function refreshVoluntariosView() {
  const filtered = getFilteredVoluntarios();
  updateKpis(filtered);
  renderCharts(filtered);
  renderTable(filtered);
  updateSelectedCount();
  syncSelectAll();
  updateFilterUi();
}

function render() {
  const filtered = getFilteredVoluntarios();
  updateKpis(filtered);
  updateFilters();
  renderCharts(filtered);
  renderTable(filtered);
  updateSelectedCount();
  const cadastroLinkInput = document.getElementById('cadastroLinkInput');
  if (cadastroLinkInput) cadastroLinkInput.value = getCadastroLinkUrl();
}

function updateKpis(filteredInput) {
  const filtered = filteredInput !== undefined ? filteredInput : getFilteredVoluntarios();
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
  updateVoluntariosRangeAndMore(total);
}

function renderCharts(filteredInput) {
  const filtered = filteredInput !== undefined ? filteredInput : getFilteredVoluntarios();
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
          toggleFilter('area', label); // area: single toggle para gráfico; filters.areas é array
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

let _cachedEmailsComCheckin = null;
let _cachedEmailsComCheckinRef = null;
/** Set de emails (lowercase) que têm pelo menos um check-in (cruzamento voluntários x check-ins). */
function getEmailsComCheckin() {
  const list = Array.isArray(checkins) ? checkins : [];
  if (_cachedEmailsComCheckinRef === list && _cachedEmailsComCheckin) return _cachedEmailsComCheckin;
  const set = new Set();
  list.forEach(c => {
    const e = (c.email || '').toLowerCase().trim();
    if (e) set.add(e);
  });
  _cachedEmailsComCheckinRef = list;
  _cachedEmailsComCheckin = set;
  return set;
}

let _cachedSoCheckinList = null;
let _cachedSoCheckinListRef = [null, null];
/** Lista de pessoas que têm check-in mas não estão na lista de voluntários (por email). */
function getSoCheckinList() {
  const vol = Array.isArray(voluntarios) ? voluntarios : [];
  const list = Array.isArray(checkins) ? checkins : [];
  if (_cachedSoCheckinListRef[0] === vol && _cachedSoCheckinListRef[1] === list && _cachedSoCheckinList) return _cachedSoCheckinList;
  const voluntariosEmails = new Set(vol.map(v => (v.email || '').toLowerCase().trim()).filter(Boolean));
  const byEmail = new Map();
  list.forEach(c => {
    const e = (c.email || '').toLowerCase().trim();
    if (!e || voluntariosEmails.has(e)) return;
    const ts = c.timestampMs ?? (c.timestamp ? new Date(c.timestamp).getTime() : 0);
    const existing = byEmail.get(e);
    if (!existing || ts > (existing.timestampMs || 0)) byEmail.set(e, { email: c.email || e, nome: c.nome || '', ministerio: c.ministerio || '', timestampMs: ts });
  });
  const result = Array.from(byEmail.values()).map(c => ({
    email: c.email,
    nome: c.nome || '—',
    cidade: '',
    estado: '',
    areas: '',
    disponibilidade: '',
    _soCheckin: true,
  }));
  _cachedSoCheckinListRef = [vol, list];
  _cachedSoCheckinList = result;
  return result;
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
    if (filters.areas && filters.areas.length > 0) {
      const volAreas = (v.areas || '').split(',').map(a => String(a).trim()).filter(Boolean);
      const filterAreasNorm = (filters.areas || []).map(fa => String(fa).trim()).filter(Boolean);
      const hasMatch = filterAreasNorm.length === 0 || filterAreasNorm.some(fa => volAreas.includes(fa));
      if (!hasMatch) return false;
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

function updateVoluntariosRangeAndMore(total) {
  const rangeEl = document.getElementById('voluntariosRange');
  const btnMore = document.getElementById('btnVerMaisVoluntarios');
  if (!rangeEl) return;
  const showing = Math.min(voluntariosPageOffset + LIST_PAGE_SIZE, total);
  if (total <= LIST_PAGE_SIZE) {
    rangeEl.textContent = '';
    if (btnMore) btnMore.style.display = 'none';
    return;
  }
  const from = voluntariosPageOffset + 1;
  rangeEl.textContent = ` — exibindo ${from}–${showing} de ${total}`;
  if (btnMore) {
    btnMore.style.display = showing < total ? 'inline-block' : 'none';
  }
}

function renderTable(list) {
  if (!voluntariosBody) return;
  voluntariosBody.innerHTML = '';
  const arr = Array.isArray(list) ? list : [];
  const total = arr.length;
  const slice = arr.slice(voluntariosPageOffset, voluntariosPageOffset + LIST_PAGE_SIZE);
  slice.forEach(v => {
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
  updateVoluntariosRangeAndMore(total);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** Formata nome com iniciais maiúsculas (cada palavra). */
function capitalizeWords(str) {
  if (str == null || String(str).trim() === '') return str;
  return String(str).trim().replace(/\b\w/g, (c) => c.toUpperCase());
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
  const isLider = authRole === 'lider';
  
  if (v) {
    // Líder vê apenas nome, email e telefone
    if (isLider) {
      const whatsappValue = v.whatsapp || '(não cadastrado)';
      content.innerHTML = fotoBlock + (`
        ${fieldRow('Nome', v.nome)}
        ${fieldRow('Email', v.email)}
        ${fieldRow('WhatsApp', whatsappValue)}
        ${checkinsSection}
      `.trim() || '<p>Nenhum dado cadastrado.</p>');
    } else {
      // Admin vê todos os dados
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
        ${fieldRow('Testemunho', v.testemunho || null)}
        ${checkinsSection}
      `.trim() || '<p>Nenhum dado cadastrado.</p>');
    }
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
  const allFilteredEmails = filtered.map(v => (v.email || '').toLowerCase()).filter(Boolean);
  const allSelected = allFilteredEmails.length > 0 && allFilteredEmails.every(e => selectedEmails.has(e));
  const someSelected = allFilteredEmails.some(e => selectedEmails.has(e));
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

async function toggleSelectAll(checked) {
  let filtered = null;
  if (checked) {
    const params = new URLSearchParams();
    const q = (searchInput?.value || '').trim();
    if (q) params.set('q', q);
    if (filters.areas?.length) params.set('areas', filters.areas.join(','));
    if (filters.disponibilidade) params.set('disponibilidade', filters.disponibilidade);
    if (filters.estado) params.set('estado', filters.estado);
    if (filters.cidade) params.set('cidade', filters.cidade);
    if (filters.comCheckin) params.set('comCheckin', filters.comCheckin);
    try {
      const r = await authFetch(`${API_BASE}/api/voluntarios/emails?${params.toString()}`);
      const data = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(data.emails)) {
        selectedEmails.clear();
        data.emails.forEach(e => selectedEmails.add(e));
      } else {
        filtered = getFilteredVoluntarios();
        filtered.forEach(v => { const e = (v.email || '').toLowerCase().trim(); if (e) selectedEmails.add(e); });
      }
    } catch (_) {
      filtered = getFilteredVoluntarios();
      filtered.forEach(v => { const e = (v.email || '').toLowerCase().trim(); if (e) selectedEmails.add(e); });
    }
  } else {
    filtered = getFilteredVoluntarios();
    filtered.forEach(v => {
      const e = (v.email || '').toLowerCase().trim();
      if (e) selectedEmails.delete(e);
    });
  }
  if (filtered === null) filtered = getFilteredVoluntarios();
  renderTable(filtered);
  updateSelectedCount();
  syncSelectAll();
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
  const currentValue = selectEl.value;
  const list = Array.isArray(items) ? items : [];
  selectEl.innerHTML = '';

  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = placeholder || 'Todos';
  selectEl.appendChild(optAll);

  list.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = item;
    selectEl.appendChild(opt);
  });
  
  const cur = (currentValue || '').trim();
  if (cur && list.some((item) => String(item).trim() === cur)) {
    selectEl.value = list.find((item) => String(item).trim() === cur) || '';
  } else {
    selectEl.value = '';
  }
}

function updateFilters() {
  const vol = Array.isArray(voluntarios) ? voluntarios : [];
  const areas = (countByMultiValueField(vol, 'areas') || []).map(([label]) => (label || '').trim()).filter(Boolean);
  const disp = (countByMultiValueField(vol, 'disponibilidade') || []).map(([label]) => label).filter(Boolean);
  const estados = countByField(vol, 'estado').map(([label]) => label);
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
  if (filterDisp) filterDisp.value = filters.disponibilidade || '';
  if (filterEstado) filterEstado.value = filters.estado || '';
  if (filterCidade) filterCidade.value = filters.cidade || '';
  if (filterComCheckin) filterComCheckin.value = filters.comCheckin || '';
  if (filterArea) filterArea.value = (filters.areas && filters.areas[0] ? String(filters.areas[0]).trim() : '') || '';
  if (!activeFilters) return;
  const comCheckinLabel = { com: 'Com check-in', sem: 'Sem check-in', 'so-checkin': 'Só check-in (sem cadastro)' }[filters.comCheckin] || '';
  const chips = [
    ['areas', 'Área', (filters.areas || []).length ? (filters.areas || []).join(', ') : ''],
    ['disponibilidade', 'Disponibilidade', filters.disponibilidade],
    ['estado', 'Estado', filters.estado],
    ['cidade', 'Cidade', filters.cidade],
    ['comCheckin', 'Check-in', comCheckinLabel],
  ].filter(([, , value]) => value && (Array.isArray(value) ? value.length : true));
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
    btn.addEventListener('click', () => {
      if (key === 'areas') {
        filters.areas = [];
        if (filterArea) filterArea.value = '';
        voluntariosPageOffset = 0;
        refreshVoluntariosView();
      } else {
        setFilter(key, '');
      }
    });
    activeFilters.appendChild(btn);
  });
}

function setFilter(key, value) {
  if (key === 'area' || key === 'areas') {
    filters.areas = value ? (Array.isArray(value) ? value : [value]) : [];
  } else {
    filters[key] = value || '';
  }
  voluntariosPageOffset = 0;
  refreshVoluntariosView();
}

function toggleFilter(key, value) {
  if (!value) return;
  if (key === 'area') {
    const arr = filters.areas || [];
    const has = arr.includes(value);
    setFilter(key, has ? arr.filter(a => a !== value) : [...arr, value]);
  } else {
    setFilter(key, filters[key] === value ? '' : value);
  }
}

function clearFilters() {
  filters.areas = [];
  filters.disponibilidade = '';
  filters.estado = '';
  filters.cidade = '';
  filters.comCheckin = '';
  voluntariosPageOffset = 0;
  if (filterArea) filterArea.value = '';
  refreshVoluntariosView();
}

function getTodayPtBr() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function getCheckinCountByEmail() {
  // Usa allCheckins (sem filtro de data/evento) para contar o histórico total por pessoa.
  // Fallback para checkins quando allCheckins ainda não foi populado.
  const list = Array.isArray(allCheckins) && allCheckins.length ? allCheckins : (Array.isArray(checkins) ? checkins : []);
  const map = new Map();
  list.forEach(c => {
    const e = (c.email || '').toLowerCase().trim();
    if (e) map.set(e, (map.get(e) || 0) + 1);
  });
  return map;
}

function getFilteredCheckins() {
  const q = (checkinSearch?.value || '').trim().toLowerCase();
  const list = Array.isArray(checkins) ? checkins : [];
  const countMap = checkinFilters.qtdCheckins ? getCheckinCountByEmail() : null;
  const qtdTarget = checkinFilters.qtdCheckins ? parseInt(checkinFilters.qtdCheckins, 10) : 0;
  return list.filter(c => {
    if (checkinFilters.ministerio) {
      const m = String(c.ministerio || '').trim();
      if (m !== checkinFilters.ministerio) return false;
    }
    if (countMap && qtdTarget) {
      const e = (c.email || '').toLowerCase().trim();
      const count = countMap.get(e) || 0;
      // "Somente 1" = exatamente 1; "N ou mais" = count >= N
      if (qtdTarget === 1 ? count !== 1 : count < qtdTarget) return false;
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

  if (checkinQtdCheckins) {
    const countMap = getCheckinCountByEmail();
    const maxCount = countMap.size ? Math.max(...countMap.values()) : 0;
    const current = checkinFilters.qtdCheckins;
    const opts = ['<option value="">Qualquer qtd.</option>'];
    if (maxCount >= 1) opts.push('<option value="1">Somente 1 check-in</option>');
    for (let n = 2; n <= maxCount; n++) {
      opts.push(`<option value="${n}">${n} ou mais check-ins</option>`);
    }
    checkinQtdCheckins.innerHTML = opts.join('');
    if (current) checkinQtdCheckins.value = current;
  }
}

function setCheckinFilter(key, value) {
  checkinFilters[key] = value || '';
  renderCheckins();
}

function clearCheckinFilters() {
  checkinFilters.ministerio = '';
  checkinFilters.qtdCheckins = '';
  if (checkinSearch) checkinSearch.value = '';
  if (checkinQtdCheckins) checkinQtdCheckins.value = '';
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
  const total = list.length;
  const slice = list.slice(0, LIST_PAGE_SIZE);
  slice.forEach(c => {
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
  if (total > LIST_PAGE_SIZE) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" class="list-more-hint">Exibindo os primeiros ${LIST_PAGE_SIZE} de ${total} check-ins.</td>`;
    checkinBody.appendChild(tr);
  }
  checkinBody.querySelectorAll('.link-voluntario').forEach(btn => {
    btn.addEventListener('click', () => openPerfilVoluntario(btn.getAttribute('data-email')));
  });
  if (checkinCount) checkinCount.textContent = total;
  const rangeEl = document.getElementById('checkinRange');
  if (rangeEl) rangeEl.textContent = total > LIST_PAGE_SIZE ? ` — exibindo 1–${LIST_PAGE_SIZE} de ${total}` : '';
}

function renderCheckinDadosIncompletos() {
  const section = document.getElementById('dadosIncompletosSection');
  const body = document.getElementById('dadosIncompletosBody');
  const title = document.getElementById('dadosIncompletosTitle');
  if (!section || !body) return;
  const list = getSoCheckinList();
  if (!list.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  if (title) title.textContent = `Dados incompletos (${list.length})`;
  body.innerHTML = list.map(v =>
    `<tr><td>${escapeHtml(v.nome || '—')}</td><td>${escapeHtml(v.email || '')}</td></tr>`
  ).join('');
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
  renderCheckinDadosIncompletos();
}

// ─── ESCALAS ─────────────────────────────────────────────────────────────────

function statusEscalaLabel(s) {
  const map = { pendente: 'Pendente', aprovado: 'Aprovado', desistencia: 'Desistência', falta: 'Falta' };
  return map[s] || s;
}

function statusEscalaBadge(s) {
  return `<span class="escala-badge escala-badge-${s}">${statusEscalaLabel(s)}</span>`;
}

/** Criar escalas: só carrega lista de escalas (leve) */
async function fetchEscalasCriar() {
  if (!authToken) { updateAuthUi(); return; }
  const container = document.getElementById('escalasCriarContent');
  if (container) container.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Carregando…</p></div>';
  try {
    const r = await authFetch(`${API_BASE}/api/escalas`);
    if (!r.ok) {
      escalasList = [];
      const errMsg = (await r.json().catch(() => ({}))).error || `Erro ${r.status}`;
      if (container) container.innerHTML = `<div class="filters-card"><p class="auth-subtitle">Erro: ${escapeHtml(errMsg)}. Tente novamente.</p></div>`;
      return;
    }
    const data = await r.json().catch(() => null);
    escalasList = Array.isArray(data) ? data : [];
    renderEscalasCriar();
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    escalasList = [];
    if (container) container.innerHTML = `<div class="filters-card"><p class="auth-subtitle">Erro: ${escapeHtml((e.message || 'Erro de rede').toString())}. Verifique a conexão.</p></div>`;
  }
}

/** Escala (candidatos): admin/lider carrega só escalas; voluntário carrega minhas-candidaturas */
async function fetchEscalas() {
  if (!authToken) { updateAuthUi(); return; }
  const container = document.getElementById('escalasContent');
  const isVol = String(authRole || '').toLowerCase() === 'voluntario';
  if (isVol) {
    if (container) container.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Carregando suas escalas…</p></div>';
    try {
      const r = await authFetch(`${API_BASE}/api/minhas-candidaturas`);
      if (!r.ok) throw new Error('Falha');
      renderEscalasVoluntario(await r.json());
    } catch (e) {
      if (e.message === 'AUTH_REQUIRED') return;
      if (container) container.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Erro ao carregar. Tente novamente.</p></div>';
    }
    return;
  }
  if (container) container.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Carregando escalas…</p></div>';
  try {
    const r = await authFetch(`${API_BASE}/api/escalas`);
    if (!r.ok) {
      escalasList = [];
      candidaturasAll = [];
      const errMsg = (await r.json().catch(() => ({}))).error || `Erro ${r.status}`;
      if (container) container.innerHTML = `<div class="filters-card"><p class="auth-subtitle">Erro ao carregar escalas: ${escapeHtml(errMsg)}. Tente novamente.</p></div>`;
      return;
    }
    const data = await r.json().catch(() => null);
    escalasList = Array.isArray(data) ? data : [];
    candidaturasAll = [];
    renderEscalasCandidatos();
    if (escalasPreSelectId) {
      candidaturasAnaliseFilters = { ...candidaturasAnaliseFilters, escalaId: escalasPreSelectId };
      const sel = document.getElementById('analiseFilterEscala');
      if (sel) sel.value = escalasPreSelectId;
      escalasPreSelectId = null;
      fetchCandidaturasPorEscala(candidaturasAnaliseFilters.escalaId);
    }
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    escalasList = [];
    candidaturasAll = [];
    const msg = (e.message || 'Erro de rede').toString();
    if (container) container.innerHTML = `<div class="filters-card"><p class="auth-subtitle">Erro ao carregar escalas: ${escapeHtml(msg)}. Verifique a conexão e tente novamente.</p></div>`;
  }
}

/** Atualiza opções dos filtros ministério e data quando candidaturasAll muda (preserva seleção) */
function updateAnaliseFilterOptions() {
  const ministerios = [...new Set(candidaturasAll.map((c) => (c.ministerio || '').trim()).filter(Boolean))].sort();
  const datas = [...new Set(candidaturasAll.map((c) => {
    if (!c.escalaData) return '';
    const d = c.escalaData instanceof Date ? c.escalaData : new Date(c.escalaData);
    return d.toISOString().slice(0, 10);
  }).filter(Boolean))].sort().reverse();
  const selMin = document.getElementById('analiseFilterMinisterio');
  const selData = document.getElementById('analiseFilterData');
  const valMin = selMin?.value || '';
  const valData = selData?.value || '';
  if (selMin) selMin.innerHTML = '<option value="">Todos</option>' + ministerios.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('');
  if (selData) selData.innerHTML = '<option value="">Todas</option>' + datas.map((d) => `<option value="${escapeAttr(d)}">${new Date(d + 'T12:00:00').toLocaleDateString('pt-BR')}</option>`).join('');
  if (selMin && valMin && ministerios.includes(valMin)) selMin.value = valMin;
  if (selData && valData && datas.includes(valData)) selData.value = valData;
}

/** Lazy: busca candidaturas de uma escala específica (mais leve que candidaturas-all) */
async function fetchCandidaturasPorEscala(escalaId) {
  if (!authToken || !(escalaId || '').trim()) return;
  escalaId = String(escalaId).trim();
  const tbody = document.getElementById('escalasAnaliseBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10"><p class="auth-subtitle" style="margin:16px 0">Carregando candidatos…</p></td></tr>';
  try {
    const r = await authFetch(`${API_BASE}/api/escalas/${encodeURIComponent(escalaId)}/candidaturas`);
    if (!r.ok) {
      candidaturasAll = [];
      const errData = await r.json().catch(() => ({}));
      const errMsg = errData?.error || `Erro ${r.status}`;
      if (tbody) tbody.innerHTML = `<tr><td colspan="10"><p class="auth-subtitle" style="margin:16px 0;color:var(--error-color,#c00)">${escapeHtml(errMsg)}</p></td></tr>`;
      renderAnaliseTab();
      return;
    }
    const data = await r.json().catch(() => null);
    candidaturasAll = Array.isArray(data) ? data : [];
    updateAnaliseFilterOptions();
    renderAnaliseTab();
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    candidaturasAll = [];
    const msg = (e.message || 'Erro de rede').toString();
    if (tbody) tbody.innerHTML = `<tr><td colspan="10"><p class="auth-subtitle" style="margin:16px 0;color:var(--error-color,#c00)">${escapeHtml(msg)}</p></td></tr>`;
    renderAnaliseTab();
  }
}

/** Mantido para compatibilidade (bulk approve etc) */
async function fetchCandidaturasAll() {
  const escalaId = candidaturasAnaliseFilters?.escalaId || document.getElementById('analiseFilterEscala')?.value;
  if (escalaId) {
    await fetchCandidaturasPorEscala(escalaId);
  } else {
    candidaturasAll = [];
    renderAnaliseTab();
  }
}

function renderEscalasCandidatos() {
  const isAdmin = authRole === 'admin';
  if (isAdmin) renderEscalasCandidatosAdmin();
  else renderEscalasCandidatosLider();
}

function getFilteredCandidaturasAnalise() {
  const list = Array.isArray(candidaturasAll) ? candidaturasAll : [];
  const f = candidaturasAnaliseFilters || {};
  if (!(f.escalaId || '').trim()) return [];
  const q = (f.nome || '').trim().toLowerCase();
  return list.filter((c) => {
    if (f.escalaId && c.escalaId && String(c.escalaId) !== String(f.escalaId)) return false;
    if (q) {
      const match = (c.nome || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || (c.escalaNome || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    if (f.data) {
      if (!c.escalaData) return false;
      const candData = c.escalaData instanceof Date ? c.escalaData : new Date(c.escalaData);
      const filterData = String(f.data).slice(0, 10);
      const candDataStr = candData.toISOString().slice(0, 10);
      if (candDataStr !== filterData) return false;
    }
    if (f.ministerio && (c.ministerio || '').trim() !== f.ministerio) return false;
    if (f.historicoServico) {
      const nuncaServiu = !c.jaServiuAlgum;
      const jaServiu = c.jaServiuAlgum;
      const jaServiuMinLider = !!c.jaServiuMinLider;
      if (f.historicoServico === 'nunca' && !nuncaServiu) return false;
      if (f.historicoServico === 'ja-serviu' && !jaServiu) return false;
      if (f.historicoServico === 'ja-serviu-ministerio' && !jaServiuMinLider) return false;
    }
    return true;
  });
}

function escapeCsv(val) {
  const s = String(val ?? '').replace(/"/g, '""');
  return /[,"\n\r]/.test(s) ? `"${s}"` : s;
}

function exportCandidaturasCsv(list) {
  const header = ['Escala', 'Data', 'Nome', 'Email', 'Telefone', 'Ministério', 'CI', 'Part.', 'Status'];
  const rows = list.map((c) => {
    const dataStr = c.escalaData ? new Date(c.escalaData).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '';
    return [c.escalaNome || '', dataStr, c.nome || '', c.email || '', c.telefone || '', c.ministerio || '', c.totalCheckins || 0, c.totalParticipacoes || 0, c.status || ''].map(escapeCsv).join(',');
  });
  const csv = '\uFEFF' + header.map(escapeCsv).join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'candidaturas-export.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderAnaliseTab() {
  const panel = document.getElementById('escalasAnalisePanel');
  if (!panel) return;
  const filtered = getFilteredCandidaturasAnalise();
  const selectedIds = new Set(Array.from(document.querySelectorAll('#escalasAnaliseBody input.row-check-cand:checked')).map((cb) => cb.getAttribute('data-cand-id')));
  const pendentes = filtered.filter((c) => c.status !== 'aprovado');

  const rows = filtered.map((c) => {
    const dataStr = c.escalaData ? new Date(c.escalaData).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '—';
    const checked = selectedIds.has(String(c._id));
    const podeSelecionar = c.status !== 'aprovado';
    return `<tr>
      <td class="col-check"><input type="checkbox" class="row-check-cand" data-cand-id="${escapeAttr(String(c._id))}" ${podeSelecionar ? '' : 'disabled'} ${checked ? 'checked' : ''}></td>
      <td data-label="Escala">${escapeHtml(c.escalaNome || '—')}</td>
      <td data-label="Data">${dataStr}</td>
      <td data-label="Nome">${escapeHtml(c.nome || '—')}</td>
      <td data-label="Email"><button type="button" class="link-voluntario" data-email="${escapeAttr((c.email || '').toLowerCase())}">${escapeHtml(c.email || '')}</button></td>
      <td data-label="Ministério">${escapeHtml(c.ministerio || '—')}</td>
      <td class="escala-cand-stat" data-label="CI">${c.totalCheckins || 0}</td>
      <td class="escala-cand-stat" data-label="Part.">${c.totalParticipacoes || 0}</td>
      <td data-label="Histórico">${c.jaServiuAlgum ? (c.jaServiuMinLider ? 'Ministério' : 'Sim') : 'Nunca'}</td>
      <td data-label="Status">${statusEscalaBadge(c.status)}</td>
    </tr>`;
  }).join('');

  const tbody = panel.querySelector('#escalasAnaliseBody');
  const selEscala = document.getElementById('analiseFilterEscala');
  const escalaSelected = selEscala && (selEscala.value || '').trim();
  const emptyMsg = !escalaSelected ? 'Selecione uma escala para ver os candidatos.' : 'Nenhuma candidatura corresponde aos filtros.';
  if (tbody) tbody.innerHTML = rows || `<tr><td colspan="10">${emptyMsg}</td></tr>`;

  const countEl = document.getElementById('escalasAnaliseCount');
  if (countEl) countEl.textContent = filtered.length;
  const selectedCount = panel.querySelectorAll('input.row-check-cand:checked').length;
  const countSelectedEl = document.getElementById('escalasAnaliseCountSelected');
  if (countSelectedEl) countSelectedEl.textContent = selectedCount;
  const btnAprovar = document.getElementById('btnAnaliseAprovar');
  if (btnAprovar) btnAprovar.disabled = selectedCount === 0;

  panel.querySelectorAll('.link-voluntario').forEach((btn) => {
    btn.addEventListener('click', () => openPerfilVoluntario(btn.getAttribute('data-email')));
  });
  panel.querySelectorAll('input.row-check-cand').forEach((cb) => {
    cb.addEventListener('change', () => renderAnaliseTab());
  });
}

/** Criar escalas (admin): apenas tabela CRUD, leve */
function renderEscalasCriar() {
  const container = document.getElementById('escalasCriarContent');
  if (!container) return;
  const rows = escalasList.map(e => {
    const data = e.data ? new Date(e.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '—';
    const ativo = e.ativo !== false;
    return `<tr>
      <td data-label="Nome">${escapeHtml(e.nome)}</td>
      <td data-label="Data">${data}</td>
      <td data-label="Status"><span class="evento-status ${ativo ? 'evento-status-ativo' : 'evento-status-inativo'}">${ativo ? 'Aberta' : 'Inscrições fechadas'}</span></td>
      <td data-label="Candidatos">${e.totalCandidaturas || 0} <span style="color:var(--text-muted);font-size:.8em">(${e.totalAprovados || 0} aprovados)</span></td>
      <td class="escala-actions-cell" data-label="Link"><button class="btn btn-sm btn-primary escala-btn-main" data-escala-link="${escapeAttr(String(e._id))}" title="Copiar link">Copiar link</button></td>
      <td class="escala-actions-cell" data-label="">
        <div class="escala-actions-wrap">
          <button class="btn btn-sm btn-ghost" data-escala-edit="${escapeAttr(String(e._id))}">Editar</button>
          <button class="btn btn-sm btn-ghost" data-escala-toggle="${escapeAttr(String(e._id))}">${ativo ? 'Fechar inscrições' : 'Reabrir inscrições'}</button>
          <button class="btn btn-sm btn-ghost" data-escala-delete="${escapeAttr(String(e._id))}">Excluir</button>
        </div>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="6">Nenhuma escala. Clique em "Nova escala" para criar.</td></tr>';

  container.innerHTML = `
    <div class="filters-card" style="margin-bottom:20px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
      <button type="button" class="btn btn-primary" id="btnNovaEscala">+ Nova escala</button>
    </div>
    <div class="table-card escala-table-card">
      <div class="chart-header"><h2>Escalas</h2></div>
      <p class="auth-subtitle" style="margin-bottom:12px">Crie escalas, edite ou copie o link para os voluntários se candidatarem.</p>
      <div class="table-wrapper">
        <table class="data-table escala-table">
          <thead><tr><th>Nome</th><th>Data</th><th>Status</th><th>Candidaturas</th><th>Link</th><th>Ações</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btnNovaEscala')?.addEventListener('click', () => {
    const m = document.getElementById('modalNovaEscala');
    if (m) { document.getElementById('escalaNovoNome').value = ''; document.getElementById('escalaNovaData').value = ''; document.getElementById('escalaNovaDescricao').value = ''; document.getElementById('escalaNovoAtivo').checked = true; m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); }
  });
  container.querySelectorAll('[data-escala-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-escala-link');
      const url = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}?escala=${encodeURIComponent(id)}`;
      navigator.clipboard.writeText(url).then(() => alert('Link copiado!')).catch(() => prompt('Copie:', url));
    });
  });
  container.querySelectorAll('[data-escala-edit]').forEach(btn => { btn.addEventListener('click', () => openModalEditarEscala(btn.getAttribute('data-escala-edit'))); });
  container.querySelectorAll('[data-escala-toggle]').forEach(btn => { btn.addEventListener('click', () => toggleEscalaAtivo(btn.getAttribute('data-escala-toggle'))); });
  container.querySelectorAll('[data-escala-delete]').forEach(btn => { btn.addEventListener('click', () => excluirEscala(btn.getAttribute('data-escala-delete'))); });
}

function buildAnalisePanelHtml(escalasOptions, ministeriosOptions, datasUnicas) {
  return `
  <p class="auth-subtitle" style="margin-bottom:16px;margin-top:0">Selecione uma escala para ver os candidatos e analisar/aprovar.</p>
  <section class="filters-row">
    <div class="filters-card">
      <div class="filters-left" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
        <div class="form-group compact">
          <label for="analiseFilterEscala"><strong>Escala</strong></label>
          <select id="analiseFilterEscala" style="min-width:260px"><option value="">— Selecione a escala —</option>${escalasOptions}</select>
        </div>
        <div class="form-group compact"><label for="analiseFilterNome">Buscar</label><input type="text" id="analiseFilterNome" placeholder="Nome ou email..." style="min-width:160px"></div>
        <div class="form-group compact"><label for="analiseFilterData">Data</label><select id="analiseFilterData"><option value="">Todas</option>${datasUnicas}</select></div>
        <div class="form-group compact"><label for="analiseFilterMinisterio">Ministério</label><select id="analiseFilterMinisterio"><option value="">Todos</option>${ministeriosOptions}</select></div>
        <div class="form-group compact"><label for="analiseFilterHistorico">Histórico</label><select id="analiseFilterHistorico"><option value="">Todos</option><option value="nunca">Nunca serviu</option><option value="ja-serviu">Já serviu</option><option value="ja-serviu-ministerio">Já serviu no meu ministério</option></select></div>
        <button type="button" class="btn btn-primary btn-sm" id="btnAnaliseApply">Aplicar</button>
        <button type="button" class="btn btn-ghost btn-sm" id="btnAnaliseClear">Limpar</button>
      </div>
    </div>
  </section>
  <div class="table-card escala-table-card" id="escalasAnalisePanel">
    <div class="chart-header">
      <h2>Candidaturas <span id="escalasAnaliseCount">0</span></h2>
      <div class="table-actions">
        <label class="checkbox-label"><input type="checkbox" id="analiseSelectAll"><span>Selecionar pendentes</span></label>
        <button type="button" class="btn btn-primary btn-sm" id="btnAnaliseAprovar" disabled>Aprovar selecionados (<span id="escalasAnaliseCountSelected">0</span>)</button>
        <button type="button" class="btn btn-ghost btn-sm" id="btnAnaliseExportCsv">Exportar CSV (filtrado)</button>
      </div>
    </div>
    <div class="table-wrapper">
      <table class="data-table escala-table">
        <thead><tr><th class="col-check"><input type="checkbox" id="analiseSelectAllHeader"></th><th>Escala</th><th>Data</th><th>Nome</th><th>Email</th><th>Ministério</th><th>CI</th><th>Part.</th><th>Histórico</th><th>Status</th></tr></thead>
        <tbody id="escalasAnaliseBody"></tbody>
      </table>
    </div>
  </div>
  `;
}

function bindAnalisePanelEvents(container) {
  const applyAnaliseFilters = () => {
    candidaturasAnaliseFilters = {
      nome: document.getElementById('analiseFilterNome')?.value || '',
      escalaId: document.getElementById('analiseFilterEscala')?.value || '',
      data: document.getElementById('analiseFilterData')?.value || '',
      ministerio: document.getElementById('analiseFilterMinisterio')?.value || '',
      historicoServico: document.getElementById('analiseFilterHistorico')?.value || '',
    };
    const escalaId = candidaturasAnaliseFilters.escalaId;
    if (escalaId && (candidaturasAll.length === 0 || String((candidaturasAll[0]?.escalaId || '')) !== String(escalaId))) {
      fetchCandidaturasPorEscala(escalaId);
    } else {
      renderAnaliseTab();
    }
  };
  document.getElementById('analiseFilterEscala')?.addEventListener('change', () => {
    const escalaId = document.getElementById('analiseFilterEscala')?.value;
    candidaturasAnaliseFilters = { ...candidaturasAnaliseFilters, escalaId };
    if (escalaId) fetchCandidaturasPorEscala(escalaId);
    else { candidaturasAll = []; renderAnaliseTab(); }
  });
  document.getElementById('btnAnaliseApply')?.addEventListener('click', applyAnaliseFilters);
  document.getElementById('btnAnaliseClear')?.addEventListener('click', () => {
    candidaturasAnaliseFilters = {};
    ['analiseFilterNome', 'analiseFilterEscala', 'analiseFilterData', 'analiseFilterMinisterio', 'analiseFilterHistorico'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = el.tagName === 'SELECT' ? '' : '';
    });
    candidaturasAll = [];
    renderAnaliseTab();
  });
  document.getElementById('analiseSelectAll')?.addEventListener('change', (e) => {
    document.getElementById('escalasAnalisePanel')?.querySelectorAll('input.row-check-cand:not(:disabled)').forEach((cb) => { cb.checked = e.target.checked; });
    renderAnaliseTab();
  });
  document.getElementById('analiseSelectAllHeader')?.addEventListener('change', (e) => {
    document.getElementById('analiseSelectAll').checked = e.target.checked;
    document.getElementById('escalasAnalisePanel')?.querySelectorAll('input.row-check-cand:not(:disabled)').forEach((cb) => { cb.checked = e.target.checked; });
    renderAnaliseTab();
  });
  document.getElementById('btnAnaliseAprovar')?.addEventListener('click', async () => {
    const ids = [...(document.getElementById('escalasAnalisePanel')?.querySelectorAll('input.row-check-cand:checked') || [])].map((cb) => cb.getAttribute('data-cand-id')).filter(Boolean);
    if (!ids.length) { alert('Selecione ao menos uma candidatura.'); return; }
    try {
      const r = await authFetch(`${API_BASE}/api/candidaturas/bulk-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, status: 'aprovado' }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
      const escalaId = candidaturasAnaliseFilters?.escalaId;
      await fetchCandidaturasPorEscala(escalaId);
      const r2 = await authFetch(`${API_BASE}/api/escalas`);
      if (r2.ok) escalasList = await r2.json();
      renderAnaliseTab();
    } catch (e) { alert(e.message || 'Erro ao aprovar.'); }
  });
  document.getElementById('btnAnaliseExportCsv')?.addEventListener('click', () => {
    const filtered = getFilteredCandidaturasAnalise();
    if (!filtered.length) { alert('Nenhuma candidatura para exportar.'); return; }
    exportCandidaturasCsv(filtered);
  });
  document.getElementById('analiseFilterNome')?.addEventListener('input', debounce(applyAnaliseFilters, 250));
  ['analiseFilterNome', 'analiseFilterData', 'analiseFilterMinisterio', 'analiseFilterHistorico'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', applyAnaliseFilters);
  });
}

/** Escala → Candidatos (admin) */
function renderEscalasCandidatosAdmin() {
  const container = document.getElementById('escalasContent');
  if (!container) return;
  if (!escalasList.length) {
    container.innerHTML = '<p class="auth-subtitle" style="margin-bottom:16px">Nenhuma escala cadastrada. Vá em <strong>Criar escalas</strong> para criar a primeira.</p>';
    return;
  }
  const escalasOptions = escalasList.map((e) => {
    const data = e.data ? new Date(e.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '';
    return `<option value="${escapeAttr(String(e._id))}">${escapeHtml(e.nome)}${data ? ` (${data})` : ''}</option>`;
  }).join('');
  const ministeriosUnicos = [...new Set(candidaturasAll.map((c) => (c.ministerio || '').trim()).filter(Boolean))].sort();
  const ministeriosOptions = ministeriosUnicos.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('');
  const datasUnicas = [...new Set(candidaturasAll.map((c) => {
    if (!c.escalaData) return '';
    const d = c.escalaData instanceof Date ? c.escalaData : new Date(c.escalaData);
    return d.toISOString().slice(0, 10);
  }).filter(Boolean))].sort().reverse();
  const datasOptions = datasUnicas.map((d) => `<option value="${escapeAttr(d)}">${new Date(d + 'T12:00:00').toLocaleDateString('pt-BR')}</option>`).join('');

  container.innerHTML = buildAnalisePanelHtml(escalasOptions, ministeriosOptions, datasOptions);
  bindAnalisePanelEvents(container);
  renderAnaliseTab();
}

/** Escala → Candidatos (lider): mesmo painel, sem tab criar */
function renderEscalasCandidatosLider() {
  const container = document.getElementById('escalasContent');
  if (!container) return;
  if (!escalasList.length) {
    container.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Nenhuma escala disponível no momento.</p></div>';
    return;
  }
  const escalasOptions = escalasList.map((e) => {
    const data = e.data ? new Date(e.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '';
    return `<option value="${escapeAttr(String(e._id))}">${escapeHtml(e.nome)}${data ? ` (${data})` : ''}</option>`;
  }).join('');
  const ministeriosUnicos = [...new Set(candidaturasAll.map((c) => (c.ministerio || '').trim()).filter(Boolean))].sort();
  const ministeriosOptions = ministeriosUnicos.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('');
  const datasUnicas = [...new Set(candidaturasAll.map((c) => {
    if (!c.escalaData) return '';
    const d = c.escalaData instanceof Date ? c.escalaData : new Date(c.escalaData);
    return d.toISOString().slice(0, 10);
  }).filter(Boolean))].sort().reverse();
  const datasOptions = datasUnicas.map((d) => `<option value="${escapeAttr(d)}">${new Date(d + 'T12:00:00').toLocaleDateString('pt-BR')}</option>`).join('');

  container.innerHTML = buildAnalisePanelHtml(escalasOptions, ministeriosOptions, datasOptions);
  bindAnalisePanelEvents(container);
  renderAnaliseTab();
}

function renderEscalasVoluntario(list) {
  const container = document.getElementById('escalasContent');
  if (!container) return;
  if (!Array.isArray(list) || !list.length) {
    container.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Você ainda não se candidatou para nenhuma escala. Quando um líder compartilhar um link de escala, use-o para se candidatar.</p></div>';
    return;
  }
  const rows = list.map(c => {
    const data = c.escalaData ? new Date(c.escalaData).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '—';
    return `<tr>
      <td data-label="Escala">${escapeHtml(c.escalaNome || '—')}</td>
      <td data-label="Data">${data}</td>
      <td data-label="Ministério">${escapeHtml(c.ministerio || '—')}</td>
      <td data-label="Status">${statusEscalaBadge(c.status)}</td>
    </tr>`;
  }).join('');
  container.innerHTML = `
    <div class="table-card">
      <div class="chart-header"><h2>Minhas escalas</h2></div>
      <div class="table-wrapper">
        <table class="data-table escala-table">
          <thead><tr><th>Escala</th><th>Data</th><th>Ministério</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

let candidaturasEscalaList = [];
let candidaturasEscalaId = null;

function renderCandidaturasTable(list, escalaId, ministerioFilter) {
  const panel = document.getElementById('escalaCandidaturasPanel');
  if (!panel) return;
  const filtered = ministerioFilter && ministerioFilter !== ''
    ? list.filter(c => (c.ministerio || '').trim() === ministerioFilter)
    : list;
  const escala = escalasList.find(e => String(e._id) === escalaId);
  const isAdmin = authRole === 'admin';
  const acoesTpl = (c) => isAdmin
    ? `<div class="escala-cand-actions"><button class="btn btn-sm btn-primary" data-cand-id="${escapeAttr(String(c._id))}" data-cand-action="aprovado" ${c.status === 'aprovado' ? 'disabled' : ''}>Aprovar</button>
       <button class="btn btn-sm btn-ghost" data-cand-id="${escapeAttr(String(c._id))}" data-cand-action="desistencia">Desist.</button>
       <button class="btn btn-sm btn-ghost" data-cand-id="${escapeAttr(String(c._id))}" data-cand-action="falta">Falta</button></div>`
    : `<div class="escala-cand-actions"><button class="btn btn-sm btn-primary" data-cand-id="${escapeAttr(String(c._id))}" data-cand-action="aprovado" ${c.status === 'aprovado' ? 'disabled' : ''}>Aprovar</button>
       <button class="btn btn-sm btn-ghost" data-cand-id="${escapeAttr(String(c._id))}" data-cand-action="falta">Falta</button></div>`;
  const rows = filtered.map(c => `<tr>
    <td data-label="Nome">${escapeHtml(c.nome || '—')}</td>
    <td data-label="Email"><button type="button" class="link-voluntario" data-email="${escapeAttr((c.email || '').toLowerCase())}">${escapeHtml(c.email || '')}</button></td>
    <td data-label="Telefone">${escapeHtml(c.telefone || '—')}</td>
    <td data-label="Ministério">${escapeHtml(c.ministerio || '—')}</td>
    <td class="escala-cand-stat" data-label="Check-ins">${c.totalCheckins || 0}</td>
    <td class="escala-cand-stat" data-label="Participações">${c.totalParticipacoes || 0}</td>
    <td class="escala-cand-stat" data-label="Desistências">${c.totalDesistencias || 0}</td>
    <td class="escala-cand-stat" data-label="Faltas">${c.totalFaltas || 0}</td>
    <td data-label="Status">${statusEscalaBadge(c.status)}</td>
    <td data-label="">${acoesTpl(c)}</td>
  </tr>`).join('');
  const tbody = panel.querySelector('.escala-cand-tbody');
  if (tbody) tbody.innerHTML = rows;
  panel.querySelectorAll('[data-cand-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-cand-id');
      const action = btn.getAttribute('data-cand-action');
      await atualizarStatusCandidatura(id, action);
      fetchCandidaturasEscala(escalaId);
    });
  });
  panel.querySelectorAll('.link-voluntario').forEach(btn => {
    btn.addEventListener('click', () => openPerfilVoluntario(btn.getAttribute('data-email')));
  });
  const countEl = panel.querySelector('.escala-cand-filter-count');
  if (countEl) countEl.textContent = `${filtered.length}${ministerioFilter ? ` de ${list.length}` : ''}`;
}

async function fetchCandidaturasEscala(escalaId) {
  const panel = document.getElementById('escalaCandidaturasPanel');
  if (!panel) return;
  panel.style.display = '';
  panel.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Carregando candidatos…</p></div>';
  try {
    const r = await authFetch(`${API_BASE}/api/escalas/${encodeURIComponent(escalaId)}/candidaturas`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    const list = await r.json();
    candidaturasEscalaList = list;
    candidaturasEscalaId = escalaId;
    const escala = escalasList.find(e => String(e._id) === escalaId);
    const isAdmin = authRole === 'admin';
    if (!list.length) {
      panel.innerHTML = `<div class="filters-card"><div class="chart-header"><h2>Candidatos${escala ? ` — ${escapeHtml(escala.nome)}` : ''}</h2></div><p class="auth-subtitle">Nenhum candidato ainda.</p></div>`;
      return;
    }
    const ministeriosUnicos = [...new Set(list.map(c => (c.ministerio || '').trim()).filter(Boolean))].sort();
    const mostraFiltro = ministeriosUnicos.length > 1;
    const filterHtml = mostraFiltro
      ? `<div class="filters-card" style="margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <label for="escalaCandMinisterioFilter" style="font-weight:600">Filtrar por ministério:</label>
          <select id="escalaCandMinisterioFilter" style="max-width:280px;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color,#e5e7eb)">
            <option value="">Todos (${list.length})</option>
            ${ministeriosUnicos.map(m => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('')}
          </select>
          <span class="escala-cand-filter-count" style="color:var(--text-muted);font-size:.9em"></span>
        </div>`
      : '';
    panel.innerHTML = `
      ${filterHtml}
      <div class="table-card escala-table-card">
        <div class="chart-header"><h2>Candidatos${escala ? ` — ${escapeHtml(escala.nome)}` : ''}</h2></div>
        <div class="table-wrapper">
          <table class="data-table escala-table">
            <thead><tr><th>Nome</th><th>Email</th><th>Telefone</th><th>Ministério</th><th title="Total de check-ins">CI</th><th title="Participações aprovadas">Part.</th><th title="Desistências">Desist.</th><th title="Faltas">Faltas</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody class="escala-cand-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
    renderCandidaturasTable(list, escalaId, '');
    if (mostraFiltro) {
      const countEl = panel.querySelector('.escala-cand-filter-count');
      if (countEl) countEl.textContent = list.length;
      panel.querySelector('#escalaCandMinisterioFilter')?.addEventListener('change', (e) => {
        renderCandidaturasTable(candidaturasEscalaList, candidaturasEscalaId, (e.target.value || '').trim());
      });
    }
  } catch (e) {
    panel.innerHTML = `<div class="filters-card"><p class="auth-subtitle">Erro: ${escapeHtml(e.message)}</p></div>`;
  }
}

async function atualizarStatusCandidatura(id, status) {
  try {
    const r = await authFetch(`${API_BASE}/api/candidaturas/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
  } catch (e) { alert(e.message || 'Erro ao atualizar status.'); }
}

async function toggleEscalaAtivo(id) {
  const escala = escalasList.find(e => String(e._id) === id);
  if (!escala) return;
  try {
    const r = await authFetch(`${API_BASE}/api/escalas/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: !escala.ativo }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    await fetchEscalasCriar();
  } catch (e) { alert(e.message || 'Erro ao alterar status.'); }
}

async function excluirEscala(id) {
  const escala = escalasList.find(e => String(e._id) === id);
  if (!confirm(`Excluir a escala "${(escala?.nome || '').replace(/"/g, '')}"? Esta ação não pode ser desfeita.`)) return;
  try {
    const r = await authFetch(`${API_BASE}/api/escalas/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    await fetchEscalasCriar();
  } catch (e) { alert(e.message || 'Erro ao excluir escala.'); }
}

function openModalEditarEscala(id) {
  const escala = escalasList.find(e => String(e._id) === id);
  if (!escala) return;
  const m = document.getElementById('modalEditarEscala');
  if (!m) return;
  document.getElementById('editarEscalaId').value = id;
  document.getElementById('editarEscalaNome').value = escala.nome || '';
  document.getElementById('editarEscalaData').value = escala.data ? new Date(escala.data).toISOString().slice(0, 10) : '';
  document.getElementById('editarEscalaDescricao').value = escala.descricao || '';
  document.getElementById('editarEscalaAtivo').checked = escala.ativo !== false;
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
}

// ─── Form handlers: nova e editar escala ─────────────────────────────────────
document.getElementById('formNovaEscala')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('escalaNovoNome')?.value?.trim();
  const data = document.getElementById('escalaNovaData')?.value || '';
  const descricao = document.getElementById('escalaNovaDescricao')?.value?.trim() || '';
  const ativo = document.getElementById('escalaNovoAtivo')?.checked !== false;
  if (!nome) return;
  try {
    const r = await authFetch(`${API_BASE}/api/escalas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, data: data || undefined, descricao, ativo }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    document.getElementById('modalNovaEscala')?.classList.remove('open');
    fetchEscalasCriar();
  } catch (err) { alert(err.message || 'Erro ao criar escala.'); }
});

document.getElementById('formEditarEscala')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('editarEscalaId')?.value;
  if (!id) return;
  const nome = document.getElementById('editarEscalaNome')?.value?.trim();
  const data = document.getElementById('editarEscalaData')?.value || '';
  const descricao = document.getElementById('editarEscalaDescricao')?.value?.trim() || '';
  const ativo = document.getElementById('editarEscalaAtivo')?.checked !== false;
  try {
    const r = await authFetch(`${API_BASE}/api/escalas/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, data: data || null, descricao, ativo }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    document.getElementById('modalEditarEscala')?.classList.remove('open');
    fetchEscalasCriar();
  } catch (err) { alert(err.message || 'Erro ao salvar escala.'); }
});

['modalNovaEscalaClose', 'modalNovaEscalaCancel'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => { document.getElementById('modalNovaEscala')?.classList.remove('open'); });
});
['modalEditarEscalaClose', 'modalEditarEscalaCancel'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => { document.getElementById('modalEditarEscala')?.classList.remove('open'); });
});
document.getElementById('modalNovaEscala')?.querySelector('.modal-backdrop')?.addEventListener('click', () => { document.getElementById('modalNovaEscala')?.classList.remove('open'); });
document.getElementById('modalEditarEscala')?.querySelector('.modal-backdrop')?.addEventListener('click', () => { document.getElementById('modalEditarEscala')?.classList.remove('open'); });

// ─── Candidatura pública via link ?escala=XXX ─────────────────────────────

/** Modo formulário público: usa sessão limpa para evitar conflito com sessão anterior. */
function preparePublicFormSession() {
  authToken = '';
  authUser = '';
  authRole = 'admin';
  authEmail = null;
  authMinisterioId = null;
  authMinisterioNome = null;
  authMinisterioIds = [];
  authMinisterioNomes = [];
  authFotoUrl = null;
  authMustChangePassword = false;
  authIsMasterAdmin = false;
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (_) {}
  if (loadingEl) loadingEl.style.display = 'none';
  if (errorEl) errorEl.style.display = 'none';
  const dashboard = document.querySelector('.dashboard');
  if (dashboard) dashboard.style.display = 'none';
}

function restoreDashboardFromPublicForm() {
  const dashboard = document.querySelector('.dashboard');
  if (dashboard) dashboard.style.display = '';
}

function showEscalaPublicOverlay() {
  preparePublicFormSession();
  const overlay = document.getElementById('escalaPublicOverlay');
  const auth = document.getElementById('authOverlay');
  const content = document.getElementById('content');
  if (overlay) overlay.style.display = 'flex';
  if (auth) auth.style.display = 'none';
  if (content) content.style.display = 'none';
}

/** Atualiza opções do select de ministério (API) ou mantém as do HTML (fallback). */
function setMinisterioSelectOptions(selectEl, list) {
  if (!selectEl || !Array.isArray(list) || list.length === 0) return;
  const placeholder = selectEl.querySelector('option[value=""]')?.textContent || 'Selecione';
  selectEl.innerHTML = '<option value="">' + placeholder + '</option>' + list.map(m => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('');
}

async function loadEscalaPublic(escalaId) {
  const labelEl = document.getElementById('escalaPublicLabel');
  const subtitleEl = document.getElementById('escalaPublicSubtitle');
  const ministerioSel = document.getElementById('escalaPublicMinisterio');
  const errorEl = document.getElementById('escalaPublicError');
  const successEl = document.getElementById('escalaPublicSuccess');

  if (subtitleEl) subtitleEl.textContent = 'Carregando…';
  if (ministerioSel) ministerioSel.selectedIndex = 0;
  const formEl = document.getElementById('escalaPublicForm');
  const concluidaWrap = document.getElementById('escalaPublicConcluidaWrap');

  try {
    const r = await fetch(`${API_BASE}/api/escala-publica/${encodeURIComponent(escalaId)}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (subtitleEl) subtitleEl.textContent = data.error || 'Escala não encontrada ou não está ativa.';
      return;
    }
    if (data.concluida) {
      const nome = data.escala?.nome || 'Escala';
      const dt = data.escala?.data ? new Date(data.escala.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '';
      if (subtitleEl) subtitleEl.textContent = nome + (dt ? ` — ${dt}` : '');
      if (formEl) formEl.style.display = 'none';
      if (concluidaWrap) concluidaWrap.style.display = 'block';
      if (concluidaWrap) concluidaWrap.querySelector('p').textContent = data.mensagem || 'A escala deste culto já foi concluída.';
      return;
    }
    const nome = data.escala?.nome || 'Escala';
    const dt = data.escala?.data ? new Date(data.escala.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '';
    if (subtitleEl) subtitleEl.textContent = nome + (dt ? ` — ${dt}` : '');
    if (labelEl) labelEl.textContent = data.escala?.descricao || '';
    const list = Array.isArray(data.ministerios) && data.ministerios.length > 0 ? data.ministerios : MINISTERIOS_PADRAO;
    setMinisterioSelectOptions(ministerioSel, list);
    if (formEl) formEl.style.display = '';
    if (concluidaWrap) concluidaWrap.style.display = 'none';
  } catch (_) {
    if (subtitleEl) subtitleEl.textContent = 'Erro ao carregar dados da escala.';
  }

  document.getElementById('btnEscalaPublicVerMinhas')?.addEventListener('click', () => {
    const overlay = document.getElementById('escalaPublicOverlay');
    if (overlay) overlay.style.display = 'none';
    restoreDashboardFromPublicForm();
    const url = new URL(window.location.href);
    url.searchParams.delete('escala');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    if (authToken && contentEl) {
      contentEl.style.display = 'block';
      if (authOverlay) authOverlay.style.display = 'none';
      setView('escalas');
    } else {
      if (authOverlay) authOverlay.style.display = 'flex';
      updateAuthUi();
    }
  });

  document.getElementById('escalaPublicForm')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = document.getElementById('escalaPublicNome')?.value?.trim();
    const email = document.getElementById('escalaPublicEmail')?.value?.trim();
    const telefone = document.getElementById('escalaPublicTelefone')?.value?.trim() || '';
    const ministerio = document.getElementById('escalaPublicMinisterio')?.value;
    if (errorEl) errorEl.textContent = '';
    if (!nome || !email || !ministerio) { if (errorEl) errorEl.textContent = 'Preencha todos os campos obrigatórios.'; return; }
    const btn = document.getElementById('btnEscalaPublicSubmit');
    if (btn) btn.disabled = true;
    try {
      const r = await fetch(`${API_BASE}/api/candidaturas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escalaId, nome, email, telefone, ministerio }),
      });
      const data = await r.json();
      if (!r.ok && r.status !== 200) throw new Error(data.error || 'Erro ao enviar candidatura.');
      const form = document.getElementById('escalaPublicForm');
      const successWrap = document.getElementById('escalaPublicSuccessWrap');
      if (form) form.style.display = 'none';
      if (successWrap) successWrap.style.display = '';
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message || 'Erro ao enviar candidatura.';
      if (btn) btn.disabled = false;
    }
  }, { once: true });
}

// ─────────────────────────────────────────────────────────────────────────────

function openModal() {
  const list = [...selectedEmails];
  if (!list.length) return;
  if (modalDestCount) modalDestCount.textContent = list.length;
  if (emailSubject) emailSubject.value = '';
  if (emailBodyBase) emailBodyBase.value = '';
  if (emailBodyEditor) emailBodyEditor.innerHTML = '';
  if (emailReviewError) { emailReviewError.style.display = ''; emailReviewError.style.visibility = 'hidden'; emailReviewError.textContent = ''; }
  if (sendResult) { sendResult.style.display = 'none'; sendResult.innerHTML = ''; }
  if (btnReenviarUltimo) btnReenviarUltimo.style.display = lastSendPayload ? '' : 'none';
  modal?.setAttribute('aria-hidden', 'false');
  modal?.classList.add('open');
}

function closeModal() {
  modal?.setAttribute('aria-hidden', 'true');
  modal?.classList.remove('open');
}

async function sendEmails() {
  const subject = (emailSubject?.value ?? '').toString().trim();
  const baseText = (emailBodyBase?.value ?? '').toString().trim();
  const editorRaw = (emailBodyEditor?.innerHTML ?? '').toString().trim();
  const editorText = (emailBodyEditor?.innerText ?? emailBodyEditor?.textContent ?? '').toString().trim();
  const hasSubject = subject.length > 0;
  const hasBase = baseText.length > 0;
  const hasEditorContent = editorText.length > 0;
  const hasMessage = hasBase || hasEditorContent;

  if (!hasSubject) {
    alert('Preencha o assunto.');
    return;
  }
  if (!hasMessage) {
    alert('Preencha a mensagem: use o campo "Rascunho" ou o campo "Mensagem para envio".');
    return;
  }

  const to = [...selectedEmails];
  const total = to.length;
  btnSendEmail.disabled = true;
  sendResult.style.display = 'block';
  sendResult.className = 'send-result';
  sendResult.textContent = total > 0 ? `Enviando 0/${total}...` : '';

  const html = hasEditorContent && editorRaw ? editorRaw : `<p>${baseText.replace(/\n/g, '<br>')}</p>`;
  const BATCH_SIZE = 50;
  let totalSent = 0;
  let totalFailed = 0;

  try {
    const volList = Array.isArray(voluntarios) ? voluntarios : [];
    const voluntariosByEmail = new Map(volList.map(v => [(v.email || '').toLowerCase(), v]));

    for (let i = 0; i < to.length; i += BATCH_SIZE) {
      const chunk = to.slice(i, i + BATCH_SIZE);
      const voluntariosMap = {};
      chunk.forEach(email => {
        const v = voluntariosByEmail.get(email);
        if (v?.nome) voluntariosMap[email] = v.nome;
      });
      sendResult.textContent = `Enviando ${Math.min(i + BATCH_SIZE, total)}/${total}...`;
      const r = await authFetch(`${API_BASE}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: chunk,
          subject,
          html,
          voluntarios: voluntariosMap,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        sendResult.className = 'send-result error';
        sendResult.textContent = `Erro: ${data.error || 'Falha no envio.'} (lote ${Math.floor(i / BATCH_SIZE) + 1})`;
        break;
      }
      totalSent += data.sent || 0;
      totalFailed += data.failed || 0;
    }

    if (totalSent > 0 || totalFailed > 0) {
      sendResult.className = 'send-result success';
      sendResult.innerHTML = totalSent > 0
        ? `Enviados: ${totalSent}${totalFailed > 0 ? ` · Falhas: ${totalFailed}` : ''}.`
        : (totalFailed > 0 ? `Nenhum enviado. Falhas: ${totalFailed}.` : 'Nenhum destinatário válido.');
      const volList = Array.isArray(voluntarios) ? voluntarios : [];
      const voluntariosByEmail = new Map(volList.map(v => [(v.email || '').toLowerCase(), v]));
      const fullMap = {};
      to.forEach(email => {
        const v = voluntariosByEmail.get((email || '').toLowerCase());
        if (v?.nome) fullMap[email] = v.nome;
      });
      lastSendPayload = { to: [...to], subject, html, voluntarios: fullMap };
      if (btnReenviarUltimo) btnReenviarUltimo.style.display = '';
      setTimeout(() => {
        closeModal();
        if (sendResult) { sendResult.style.display = 'none'; sendResult.innerHTML = ''; }
      }, 2200);
    } else if (!sendResult.classList.contains('send-result error')) {
      sendResult.textContent = total === 0 ? 'Nenhum destinatário selecionado.' : 'Envio concluído.';
    }
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    sendResult.className = 'send-result error';
    sendResult.textContent = 'Erro de rede: ' + (e.message || 'Verifique o servidor e RESEND_API_KEY.');
  }
  btnSendEmail.disabled = false;
  btnSendEmail.textContent = 'Enviar';
}

async function reenviarUltimoEnvio() {
  if (!lastSendPayload || !lastSendPayload.to || !lastSendPayload.to.length) {
    alert('Não há último envio para reenviar.');
    return;
  }
  const { to, subject, html, voluntarios: voluntariosMap } = lastSendPayload;
  const total = to.length;
  if (btnSendEmail) { btnSendEmail.disabled = true; btnSendEmail.textContent = 'Enviando...'; }
  if (btnReenviarUltimo) btnReenviarUltimo.disabled = true;
  sendResult.style.display = 'block';
  sendResult.className = 'send-result';
  sendResult.textContent = `Reenviando 0/${total}...`;

  const BATCH_SIZE = 50;
  let totalSent = 0;
  let totalFailed = 0;

  try {
    for (let i = 0; i < to.length; i += BATCH_SIZE) {
      const chunk = to.slice(i, i + BATCH_SIZE);
      const map = {};
      chunk.forEach(email => {
        if (voluntariosMap && voluntariosMap[email]) map[email] = voluntariosMap[email];
      });
      sendResult.textContent = `Reenviando ${Math.min(i + BATCH_SIZE, total)}/${total}...`;
      const r = await authFetch(`${API_BASE}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: chunk, subject, html, voluntarios: map }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        sendResult.className = 'send-result error';
        sendResult.textContent = `Erro: ${data.error || 'Falha no envio.'} (lote ${Math.floor(i / BATCH_SIZE) + 1})`;
        break;
      }
      totalSent += data.sent || 0;
      totalFailed += data.failed || 0;
    }
    if (totalSent > 0 || totalFailed > 0) {
      sendResult.className = 'send-result success';
      sendResult.innerHTML = totalSent > 0
        ? `Reenviados: ${totalSent}${totalFailed > 0 ? ` · Falhas: ${totalFailed}` : ''}.`
        : (totalFailed > 0 ? `Nenhum reenviado. Falhas: ${totalFailed}.` : '');
    }
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    sendResult.className = 'send-result error';
    sendResult.textContent = 'Erro de rede: ' + (e.message || 'Verifique o servidor.');
  }
  if (btnSendEmail) { btnSendEmail.disabled = false; btnSendEmail.textContent = 'Enviar'; }
  if (btnReenviarUltimo) btnReenviarUltimo.disabled = false;
}

async function handleLogin(e) {
  e.preventDefault();
  if (loginError) { loginError.textContent = ''; loginError.style.color = ''; }
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
    if (authMustChangePassword) {
      updateAuthUi();
      return;
    }
    if (authOverlay) authOverlay.style.display = 'none';
    const isVol = String(authRole || '').toLowerCase() === 'voluntario';
    const hasMinisterios = (authMinisterioNomes && authMinisterioNomes.length > 0) || authMinisterioNome;
    const isLider = (authRole === 'lider' || authRole === 'admin') && hasMinisterios;
    const isLiderRole = authRole === 'lider' || isLider;
    const defaultView = isVol ? 'perfil' : (isLiderRole && authRole !== 'admin' ? 'checkin-ministerio' : 'resumo');
    setView(defaultView);
    if (authRole === 'admin') await fetchAllData();
    else if (isLiderRole && authRole !== 'admin') { await fetchCheckinsMinisterio(); await fetchMeusCheckins(); await fetchPerfil(); }
    else { await fetchEventosHoje(); await fetchMeusCheckins(); await fetchPerfil(); }
  } catch (err) {
    if (loginError) loginError.textContent = err.message || 'Erro de rede.';
  } finally {
    if (loginPass) loginPass.value = '';
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
  refreshVoluntariosView();
}, 300);
searchInput?.addEventListener('input', debouncedSearch);

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const btn = document.getElementById('sidebarToggle');
  const willBeOpen = !sidebar?.classList.contains('open');
  if (sidebar) sidebar.classList.toggle('open');
  if (overlay) { overlay.classList.toggle('show'); overlay.setAttribute('aria-hidden', willBeOpen ? 'false' : 'true'); }
  document.body.classList.toggle('sidebar-open', willBeOpen);
  if (btn) {
    btn.classList.toggle('is-open', willBeOpen);
    btn.setAttribute('aria-expanded', String(willBeOpen));
    btn.setAttribute('aria-label', willBeOpen ? 'Fechar menu' : 'Abrir menu');
  }
}
function closeSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar?.classList.contains('open')) return;
  const overlay = document.getElementById('sidebarOverlay');
  const btn = document.getElementById('sidebarToggle');
  sidebar.classList.remove('open');
  if (overlay) { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); }
  document.body.classList.remove('sidebar-open');
  if (btn) {
    btn.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Abrir menu');
  }
}
document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);
document.getElementById('sidebarOverlay')?.addEventListener('click', toggleSidebar);
document.getElementById('userCardGoPerfil')?.addEventListener('click', () => {
  setView('perfil');
  closeSidebar();
});
document.getElementById('userCardGoPerfil')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    setView('perfil');
    closeSidebar();
  }
});

selectAll?.addEventListener('change', () => toggleSelectAll(selectAll.checked));
selectAllHeader?.addEventListener('change', () => toggleSelectAll(selectAllHeader.checked));

btnOpenSend?.addEventListener('click', openModal);
modalClose?.addEventListener('click', closeModal);
modalCancel?.addEventListener('click', closeModal);
modalBackdrop?.addEventListener('click', closeModal);
btnSendEmail?.addEventListener('click', sendEmails);
btnReenviarUltimo?.addEventListener('click', reenviarUltimoEnvio);

btnReviewLLM?.addEventListener('click', async () => {
  const text = (emailBodyBase?.value || '').trim() || (emailBodyEditor?.innerText || emailBodyEditor?.textContent || '').trim();
  const showReviewError = (msg) => {
    if (!emailReviewError) return;
    emailReviewError.textContent = msg || '';
    emailReviewError.style.display = 'block';
    emailReviewError.style.visibility = 'visible';
  };
  const hideReviewError = () => {
    if (emailReviewError) { emailReviewError.textContent = ''; emailReviewError.style.visibility = 'hidden'; }
  };
  if (!text) {
    showReviewError('Digite o rascunho do email no campo acima.');
    return;
  }
  hideReviewError();
  btnReviewLLM.disabled = true;
  btnReviewLLM.textContent = 'Revisando...';
  try {
    const r = await authFetch(`${API_BASE}/api/email/review-llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    let data = {};
    try { data = await r.json(); } catch (_) { data = { error: 'Resposta inválida do servidor.' }; }
    if (!r.ok) {
      showReviewError(data.error || `Erro ${r.status}. Verifique GROK_API_KEY nas variáveis da cloud.`);
      return;
    }
    if (emailBodyEditor && data.html) {
      emailBodyEditor.innerHTML = data.html;
    } else if (data.error) {
      showReviewError(data.error);
    }
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    showReviewError(e.message || 'Erro de rede. Tente novamente.');
  } finally {
    btnReviewLLM.disabled = false;
    btnReviewLLM.textContent = '✨ Revisar com IA';
  }
});
loginForm?.addEventListener('submit', handleLogin);
btnLogout?.addEventListener('click', handleLogout);
filterArea?.addEventListener('change', () => {
  const val = (filterArea.value || '').trim();
  setFilter('areas', val ? [val] : []);
});
filterDisp?.addEventListener('change', () => setFilter('disponibilidade', filterDisp.value));
filterEstado?.addEventListener('change', () => setFilter('estado', filterEstado.value));
filterCidade?.addEventListener('change', () => setFilter('cidade', filterCidade.value));
filterComCheckin?.addEventListener('change', () => setFilter('comCheckin', filterComCheckin.value));
document.getElementById('usuariosSearch')?.addEventListener('input', debounce(() => { if (currentView === 'usuarios') fetchUsers(); }, 350));
document.getElementById('usuariosSearch')?.addEventListener('change', () => { if (currentView === 'usuarios') fetchUsers(); });
document.getElementById('usuariosFilterAtivo')?.addEventListener('change', () => { if (currentView === 'usuarios') fetchUsers(); });
btnClearFilters?.addEventListener('click', clearFilters);
document.getElementById('btnVerMaisVoluntarios')?.addEventListener('click', () => {
  voluntariosPageOffset += LIST_PAGE_SIZE;
  renderTable(getFilteredVoluntarios());
});
checkinMinisterio?.addEventListener('change', () => { checkinFilters.ministerio = checkinMinisterio?.value || ''; fetchCheckinsWithFilters(); });
checkinSearch?.addEventListener('input', debounce(() => renderCheckins(), 300));
checkinQtdCheckins?.addEventListener('change', () => { checkinFilters.qtdCheckins = checkinQtdCheckins?.value || ''; renderCheckins(); });
btnClearCheckinFilters?.addEventListener('click', () => {
  if (checkinData) checkinData.value = '';
  if (checkinEvento) checkinEvento.value = '';
  if (checkinMinisterio) checkinMinisterio.value = '';
  if (checkinQtdCheckins) checkinQtdCheckins.value = '';
  checkinFilters.ministerio = '';
  checkinFilters.qtdCheckins = '';
  fetchCheckinsWithFilters();
});
checkinData?.addEventListener('change', fetchCheckinsWithFilters);
checkinEvento?.addEventListener('change', fetchCheckinsWithFilters);

document.getElementById('btnEnviarEmailIncompletos')?.addEventListener('click', async () => {
  const btn = document.getElementById('btnEnviarEmailIncompletos');
  const status = document.getElementById('dadosIncompletosStatus');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  if (status) status.textContent = '';
  try {
    const r = await authFetch(`${API_BASE}/api/send-cadastro-incompleto`, { method: 'POST' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro ao enviar.');
    if (status) status.textContent = `✓ ${data.sent} enviados${data.failed ? `, ${data.failed} falhas` : ''}`;
  } catch (e) {
    if (status) status.textContent = `Erro: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar email de cadastro';
  }
});

btnNovoEvento?.addEventListener('click', () => { if (modalNovoEvento) { eventoData.value = new Date().toISOString().slice(0, 10); eventoLabel.value = ''; if (eventoHorarioInicio) eventoHorarioInicio.value = ''; if (eventoHorarioFim) eventoHorarioFim.value = ''; if (eventoAtivo) eventoAtivo.checked = true; modalNovoEvento.setAttribute('aria-hidden', 'false'); modalNovoEvento.classList.add('open'); } });
modalNovoEventoClose?.addEventListener('click', () => { modalNovoEvento?.classList.remove('open'); });
modalNovoEventoCancel?.addEventListener('click', () => { modalNovoEvento?.classList.remove('open'); });
modalNovoEvento?.querySelector('.modal-backdrop')?.addEventListener('click', () => { modalNovoEvento?.classList.remove('open'); });

const modalEditarEvento = document.getElementById('modalEditarEvento');
document.getElementById('modalEditarEventoClose')?.addEventListener('click', () => { modalEditarEvento?.classList.remove('open'); });
document.getElementById('modalEditarEventoCancel')?.addEventListener('click', () => { modalEditarEvento?.classList.remove('open'); });
modalEditarEvento?.querySelector('.modal-backdrop')?.addEventListener('click', () => { modalEditarEvento?.classList.remove('open'); });
document.getElementById('formEditarEvento')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('editarEventoId')?.value?.trim();
  const label = document.getElementById('editarEventoLabel')?.value?.trim() ?? '';
  const horarioInicio = (document.getElementById('editarEventoHorarioInicio')?.value || '').trim();
  const horarioFim = (document.getElementById('editarEventoHorarioFim')?.value || '').trim();
  const ativo = document.getElementById('editarEventoAtivo')?.checked !== false;
  if (!id) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, ativo, horarioInicio: horarioInicio || '', horarioFim: horarioFim || '' }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    modalEditarEvento?.classList.remove('open');
    fetchEventosCheckin();
  } catch (err) { alert(err.message || 'Erro ao salvar.'); }
});

document.getElementById('modalPerfilVoluntarioClose')?.addEventListener('click', closeModalPerfilVoluntario);
document.getElementById('modalPerfilVoluntario')?.querySelector('.modal-backdrop')?.addEventListener('click', closeModalPerfilVoluntario);

formNovoEvento?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = eventoData?.value; const label = eventoLabel?.value?.trim();
  const horarioInicio = (eventoHorarioInicio?.value || '').trim();
  const horarioFim = (eventoHorarioFim?.value || '').trim();
  const ativo = eventoAtivo ? eventoAtivo.checked : true;
  if (!data) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, label, ativo, horarioInicio: horarioInicio || undefined, horarioFim: horarioFim || undefined }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    modalNovoEvento?.classList.remove('open');
    if (formNovoEvento) formNovoEvento.reset();
    if (eventoData) eventoData.value = new Date().toISOString().slice(0, 10);
    if (eventoHorarioInicio) eventoHorarioInicio.value = '';
    if (eventoHorarioFim) eventoHorarioFim.value = '';
    if (eventoAtivo) eventoAtivo.checked = true;
    fetchEventosCheckin();
  } catch (err) { alert(err.message || 'Erro ao criar evento.'); }
});

document.getElementById('btnNovoMinisterio')?.addEventListener('click', () => { document.getElementById('ministerioNome').value = ''; document.getElementById('modalNovoMinisterio')?.classList.add('open'); });
document.getElementById('formNovoMinisterio')?.addEventListener('submit', createMinisterio);
document.getElementById('modalNovoMinisterioClose')?.addEventListener('click', () => document.getElementById('modalNovoMinisterio')?.classList.remove('open'));
document.getElementById('modalNovoMinisterioCancel')?.addEventListener('click', () => document.getElementById('modalNovoMinisterio')?.classList.remove('open'));
document.getElementById('modalNovoMinisterio')?.querySelector('.modal-backdrop')?.addEventListener('click', () => document.getElementById('modalNovoMinisterio')?.classList.remove('open'));
document.getElementById('formEditarMinisterio')?.addEventListener('submit', saveEditarMinisterio);
document.getElementById('modalEditarMinisterioClose')?.addEventListener('click', () => document.getElementById('modalEditarMinisterio')?.classList.remove('open'));
document.getElementById('modalEditarMinisterioCancel')?.addEventListener('click', () => document.getElementById('modalEditarMinisterio')?.classList.remove('open'));
document.getElementById('modalEditarMinisterio')?.querySelector('.modal-backdrop')?.addEventListener('click', () => document.getElementById('modalEditarMinisterio')?.classList.remove('open'));
document.getElementById('modalAssignLiderClose')?.addEventListener('click', () => document.getElementById('modalAssignLider')?.classList.remove('open'));
document.getElementById('modalAssignLiderCancel')?.addEventListener('click', () => document.getElementById('modalAssignLider')?.classList.remove('open'));
document.getElementById('modalAssignLider')?.querySelector('.modal-backdrop')?.addEventListener('click', () => document.getElementById('modalAssignLider')?.classList.remove('open'));
document.getElementById('btnAssignLider')?.addEventListener('click', assignLider);
document.getElementById('btnAssignLiderSearch')?.addEventListener('click', assignLiderSearchByEmail);
document.getElementById('assignLiderSearchEmail')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); assignLiderSearchByEmail(); } });

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
  const v = document.getElementById('userRoleSelect')?.value;
  if (g) g.style.display = (v === 'lider' || v === 'admin') ? 'block' : 'none';
});

const modalCriarUsuario = document.getElementById('modalCriarUsuario');
const criarUsuarioError = document.getElementById('criarUsuarioError');
function openModalCriarUsuario() {
  if (criarUsuarioError) { criarUsuarioError.style.display = 'none'; criarUsuarioError.textContent = ''; }
  document.getElementById('criarUsuarioEmail').value = '';
  document.getElementById('criarUsuarioNome').value = '';
  document.getElementById('criarUsuarioSenha').value = '';
  document.getElementById('criarUsuarioRole').value = 'voluntario';
  const minGrp = document.getElementById('criarUsuarioMinisterioGroup');
  const minContainer = document.getElementById('criarUsuarioMinisterioCheckboxes');
  if (minGrp) minGrp.style.display = 'none';
  if (minContainer) minContainer.innerHTML = '';
  if (!ministrosList.length) {
    authFetch(`${API_BASE}/api/ministros`).then(r => r.ok ? r.json() : []).then(list => { ministrosList = list || []; fillCriarUsuarioMinisterios(); }).catch(() => {});
  } else fillCriarUsuarioMinisterios();
  if (modalCriarUsuario) modalCriarUsuario.classList.add('open');
}
function fillCriarUsuarioMinisterios() {
  const role = document.getElementById('criarUsuarioRole')?.value || 'voluntario';
  const minGrp = document.getElementById('criarUsuarioMinisterioGroup');
  const minContainer = document.getElementById('criarUsuarioMinisterioCheckboxes');
  if (!minContainer) return;
  const show = role === 'lider' || role === 'admin';
  if (minGrp) minGrp.style.display = show ? 'block' : 'none';
  if (show && ministrosList.length) {
    minContainer.innerHTML = (ministrosList || []).map(m => `<label class="checkbox-label" style="display:block; margin-bottom:6px;"><input type="checkbox" data-ministerio-id="${escapeAttr(m._id)}"> ${escapeHtml(m.nome || '')}</label>`).join('');
  } else minContainer.innerHTML = '';
}
document.getElementById('btnCriarUsuario')?.addEventListener('click', openModalCriarUsuario);
document.getElementById('criarUsuarioRole')?.addEventListener('change', fillCriarUsuarioMinisterios);
document.getElementById('modalCriarUsuarioClose')?.addEventListener('click', () => modalCriarUsuario?.classList.remove('open'));
document.getElementById('modalCriarUsuarioCancel')?.addEventListener('click', () => modalCriarUsuario?.classList.remove('open'));
modalCriarUsuario?.querySelector('.modal-backdrop')?.addEventListener('click', () => modalCriarUsuario?.classList.remove('open'));
document.getElementById('formCriarUsuario')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = (document.getElementById('criarUsuarioEmail')?.value || '').trim().toLowerCase();
  const nome = (document.getElementById('criarUsuarioNome')?.value || '').trim();
  const senha = (document.getElementById('criarUsuarioSenha')?.value || '').trim();
  const role = (document.getElementById('criarUsuarioRole')?.value || 'voluntario');
  const minContainer = document.getElementById('criarUsuarioMinisterioCheckboxes');
  const ministerioIds = (role === 'lider' || role === 'admin') && minContainer
    ? Array.from(minContainer.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.getAttribute('data-ministerio-id')).filter(Boolean)
    : [];
  if (criarUsuarioError) { criarUsuarioError.style.display = 'none'; criarUsuarioError.textContent = ''; }
  if (!email || !email.includes('@')) {
    if (criarUsuarioError) { criarUsuarioError.textContent = 'Informe um email válido.'; criarUsuarioError.style.display = 'block'; }
    return;
  }
  if (!nome) {
    if (criarUsuarioError) { criarUsuarioError.textContent = 'Informe o nome.'; criarUsuarioError.style.display = 'block'; }
    return;
  }
  if (!senha || senha.length < 6) {
    if (criarUsuarioError) { criarUsuarioError.textContent = 'Senha temporária deve ter no mínimo 6 caracteres.'; criarUsuarioError.style.display = 'block'; }
    return;
  }
  try {
    const r = await authFetch(`${API_BASE}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, nome, senha, role, ministerioIds }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = body.error || body.message || `Falha ao criar usuário (${r.status}).`;
      if (criarUsuarioError) { criarUsuarioError.textContent = msg; criarUsuarioError.style.display = 'block'; }
      return;
    }
    modalCriarUsuario?.classList.remove('open');
    document.getElementById('formCriarUsuario')?.reset();
    fetchUsers();
    alert('Usuário criado. Ele deverá trocar a senha no primeiro acesso.');
  } catch (err) {
    const msg = err.message || 'Erro ao criar usuário. Verifique a conexão.';
    if (criarUsuarioError) { criarUsuarioError.textContent = msg; criarUsuarioError.style.display = 'block'; }
    else alert(msg);
  }
});
document.getElementById('btnUserRoleBack')?.addEventListener('click', () => {
  document.getElementById('modalUserRoleFormBody').style.display = 'block';
  document.getElementById('modalUserHistoryBody').style.display = 'none';
});

document.getElementById('btnRefreshCheckinMinisterio')?.addEventListener('click', () => fetchCheckinsMinisterio());
document.getElementById('checkinMinisterioData')?.addEventListener('change', () => fetchCheckinsMinisterio());

formPerfil?.addEventListener('submit', savePerfil);

/** Reduz imagem para avatar (máx. 512px no lado maior, JPEG ~82%) para não pesar no servidor e no layout. */
function resizeImageForAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(jpe?g|png|gif|webp)$/i.test(file.type)) {
      resolve(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 512;
      let w = img.width;
      let h = img.height;
      if (w <= max && h <= max) {
        resolve(file);
        return;
      }
      if (w > h) {
        h = Math.round((h * max) / w);
        w = max;
      } else {
        w = Math.round((w * max) / h);
        h = max;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else resolve(file);
        },
        'image/jpeg',
        0.82
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

btnConfirmarCheckin?.addEventListener('click', confirmarCheckin);
document.getElementById('btnPerfilConfirmarCheckin')?.addEventListener('click', confirmarCheckinDesdePerfil);

function showAuthCard(card) {
  [loginCard, registerCard, setupCard, forgotPasswordCard, resetPasswordCard, mustChangePasswordCard].forEach(c => { if (c) c.style.display = 'none'; });
  if (card) card.style.display = 'block';
}

async function fetchSetupStatus() {
  const urlParams = new URLSearchParams(window.location.search);
  const resetToken = urlParams.get('reset');
  if (resetToken && resetPasswordCard) {
    showAuthCard(resetPasswordCard);
    document.getElementById('resetPasswordForm')?.setAttribute('data-reset-token', resetToken);
    return;
  }
  const forceSetup = urlParams.get('setup') === '1';
  try {
    const r = await fetch(`${API_BASE}/api/setup/status`);
    const data = await r.json().catch(() => ({}));
    if (data.needsSetup && setupLinkWrap) setupLinkWrap.style.display = 'block';
    if ((forceSetup || data.needsSetup) && setupCard && loginCard) {
      showAuthCard(setupCard);
    }
  } catch (_) {
    if (forceSetup && setupCard && loginCard) showAuthCard(setupCard);
  }
}
if (!authToken) fetchSetupStatus();

document.getElementById('mustChangePasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('firstAccessError');
  const successEl = document.getElementById('firstAccessSuccess');
  const senhaAtual = (document.getElementById('firstAccessSenhaAtual')?.value || '').trim();
  const senhaNova = (document.getElementById('firstAccessSenhaNova')?.value || '').trim();
  const senhaConfirmar = (document.getElementById('firstAccessSenhaConfirmar')?.value || '').trim();
  if (errEl) errEl.textContent = '';
  if (successEl) successEl.style.display = 'none';
  if (!senhaAtual || !senhaNova) { if (errEl) errEl.textContent = 'Preencha a senha atual e a nova senha.'; return; }
  if (senhaNova.length < 6) { if (errEl) errEl.textContent = 'A nova senha deve ter no mínimo 6 caracteres.'; return; }
  if (senhaNova !== senhaConfirmar) { if (errEl) errEl.textContent = 'A confirmação da nova senha não confere.'; return; }
  const btn = document.getElementById('btnFirstAccessSubmit');
  if (btn) { btn.disabled = true; btn.textContent = 'Alterando...'; }
  try {
    const r = await authFetch(`${API_BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senhaAtual, senhaNova }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { if (errEl) errEl.textContent = data.error || 'Não foi possível alterar a senha.'; return; }
    authMustChangePassword = false;
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) try { const p = JSON.parse(stored); p.mustChangePassword = false; localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(p)); } catch (_) {}
    if (successEl) { successEl.textContent = 'Senha alterada. Redirecionando...'; successEl.style.display = 'block'; }
    if (errEl) errEl.textContent = '';
    updateAuthUi();
    const isVol = String(authRole || '').toLowerCase() === 'voluntario';
    const hasMinisterios = (authMinisterioNomes && authMinisterioNomes.length > 0) || authMinisterioNome;
    const isLider = (authRole === 'lider' || authRole === 'admin') && hasMinisterios;
    const isLiderRole = authRole === 'lider' || isLider;
    const defaultView = isVol ? 'perfil' : (isLiderRole && authRole !== 'admin' ? 'checkin-ministerio' : 'resumo');
    setView(defaultView);
    if (authRole === 'admin') await fetchAllData();
    else if (isLiderRole && authRole !== 'admin') { await fetchCheckinsMinisterio(); await fetchMeusCheckins(); await fetchPerfil(); }
    else { await fetchEventosHoje(); await fetchMeusCheckins(); await fetchPerfil(); }
  } catch (err) { if (errEl) errEl.textContent = err.message || 'Erro ao alterar senha.'; }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Trocar senha'; } }
});

linkRegistro?.addEventListener('click', (e) => { e.preventDefault(); showAuthCard(registerCard); });
linkLogin?.addEventListener('click', (e) => { e.preventDefault(); showAuthCard(loginCard); });
linkSetup?.addEventListener('click', (e) => { e.preventDefault(); showAuthCard(setupCard); });
linkSetupVoltar?.addEventListener('click', (e) => { e.preventDefault(); showAuthCard(loginCard); });
linkEsqueciSenha?.addEventListener('click', (e) => { e.preventDefault(); showAuthCard(forgotPasswordCard); });
document.getElementById('linkForgotVoltar')?.addEventListener('click', (e) => { e.preventDefault(); showAuthCard(loginCard); });
document.getElementById('linkResetVoltar')?.addEventListener('click', (e) => {
  e.preventDefault();
  const url = new URL(window.location.href);
  url.searchParams.delete('reset');
  window.history.replaceState({}, '', url.pathname + url.search);
  document.getElementById('resetPasswordForm')?.removeAttribute('data-reset-token');
  showAuthCard(loginCard);
});

document.getElementById('forgotPasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('forgotError');
  const okEl = document.getElementById('forgotSuccess');
  const btn = document.getElementById('btnForgotSubmit');
  if (errEl) errEl.textContent = '';
  if (okEl) { okEl.style.display = 'none'; okEl.textContent = ''; }
  const email = (document.getElementById('forgotEmail')?.value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) { if (errEl) errEl.textContent = 'Informe um email válido.'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    const r = await fetch(`${API_BASE}/api/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const data = await r.json().catch(() => ({}));
    if (okEl) { okEl.textContent = data.message || 'Se o email estiver cadastrado, você receberá um link para redefinir a senha.'; okEl.style.display = 'block'; }
    if (errEl) errEl.textContent = '';
  } catch (err) { if (errEl) errEl.textContent = err.message || 'Erro de rede.'; }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Enviar link'; } }
});

document.getElementById('resetPasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('resetError');
  const okEl = document.getElementById('resetSuccess');
  const btn = document.getElementById('btnResetSubmit');
  const token = document.getElementById('resetPasswordForm')?.getAttribute('data-reset-token') || new URLSearchParams(window.location.search).get('reset');
  const novaSenha = (document.getElementById('resetNovaSenha')?.value || '').trim();
  const confirmar = (document.getElementById('resetConfirmarSenha')?.value || '').trim();
  if (errEl) errEl.textContent = '';
  if (okEl) { okEl.style.display = 'none'; }
  if (!token) { if (errEl) errEl.textContent = 'Link inválido ou expirado.'; return; }
  if (!novaSenha || novaSenha.length < 6) { if (errEl) errEl.textContent = 'A senha deve ter no mínimo 6 caracteres.'; return; }
  if (novaSenha !== confirmar) { if (errEl) errEl.textContent = 'As senhas não coincidem.'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
  try {
    const r = await fetch(`${API_BASE}/api/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, novaSenha }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { if (errEl) errEl.textContent = data.error || 'Falha ao redefinir senha.'; return; }
    if (okEl) { okEl.textContent = data.message || 'Senha alterada. Faça login com a nova senha.'; okEl.style.display = 'block'; }
    const url = new URL(window.location.href);
    url.searchParams.delete('reset');
    window.history.replaceState({}, '', url.pathname + url.search);
    document.getElementById('resetPasswordForm')?.removeAttribute('data-reset-token');
    document.getElementById('resetNovaSenha').value = '';
    document.getElementById('resetConfirmarSenha').value = '';
    setTimeout(() => { showAuthCard(loginCard); if (loginError) loginError.textContent = ''; const msg = document.getElementById('resetSuccess')?.textContent; if (loginError && msg) loginError.style.color = 'var(--success)'; loginError.textContent = msg || ''; }, 1200);
  } catch (err) { if (errEl) errEl.textContent = err.message || 'Erro de rede.'; }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Redefinir senha'; } }
});
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
    if (setupSecret) setupSecret.value = '';
    if (setupEmail) setupEmail.value = '';
    if (setupNome) setupNome.value = '';
    if (setupSenha) setupSenha.value = '';
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
    if (registerNome) registerNome.value = '';
    if (registerEmail) registerEmail.value = '';
    if (registerPass) registerPass.value = '';
    setAuthSession(data);
    if (authOverlay) authOverlay.style.display = 'none';
    if (registerCard) registerCard.style.display = 'none'; if (loginCard) loginCard.style.display = 'block';
    await fetchEventosHoje(); await fetchMeusCheckins(); await fetchPerfil();
  } catch (err) { if (registerError) registerError.textContent = err.message || 'Erro de rede.'; }
});

navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const view = item.dataset.view || (authRole === 'voluntario' ? 'perfil' : (authRole === 'lider' ? 'checkin-ministerio' : 'resumo'));
    setView(view);
    closeSidebar();
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
  renderMinisterioSelect('cadastroMinisterio');
  toggleMinisterioOutroVisibility('cadastroMinisterio');
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
    nascimento: nascimentoDateInputToApi(document.getElementById('cadastroNascimento')?.value) || undefined,
    whatsapp: (document.getElementById('cadastroWhatsapp')?.value || '').trim() || undefined,
    pais: (document.getElementById('cadastroPais')?.value || '').trim() || undefined,
    estado: (document.getElementById('cadastroEstado')?.value || '').trim() || undefined,
    cidade: (document.getElementById('cadastroCidade')?.value || '').trim() || undefined,
    evangelico: (document.getElementById('cadastroEvangelico')?.value || '').trim() || undefined,
    igreja: (document.getElementById('cadastroIgreja')?.value || '').trim() || undefined,
    tempoIgreja: (document.getElementById('cadastroTempoIgreja')?.value || '').trim() || undefined,
    voluntarioIgreja: (document.getElementById('cadastroVoluntarioIgreja')?.value || '').trim() || undefined,
    ministerio: getMinisterioValue('cadastroMinisterio') || undefined,
    disponibilidade: (document.getElementById('cadastroDisponibilidade')?.value || '').trim() || undefined,
    horasSemana: (document.getElementById('cadastroHorasSemana')?.value || '').trim() || undefined,
    areas: (document.getElementById('cadastroAreas')?.value || '').trim() || undefined,
    testemunho: (document.getElementById('cadastroTestemunho')?.value || '').trim() || undefined,
  };
  if (!payload.email || !payload.email.includes('@')) {
    if (errEl) errEl.textContent = 'Email é obrigatório e deve ser válido.';
    return;
  }
  if (payload.whatsapp && !validarWhatsApp(payload.whatsapp)) {
    if (errEl) errEl.textContent = 'WhatsApp inválido. Informe 10 ou 11 dígitos (DDD + número).';
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
    renderMinisterioSelect('cadastroMinisterio');
    const outro = document.getElementById('cadastroMinisterioOutro');
    if (outro) { outro.value = ''; outro.style.display = 'none'; }
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

document.getElementById('btnVerCodigoWhatsApp')?.addEventListener('click', async () => {
  const resultEl = document.getElementById('brdidCodigoResult');
  if (!resultEl) return;
  resultEl.textContent = 'Carregando...';
  try {
    const r = await authFetch(`${API_BASE}/api/brdid/whatsapp-verification/latest`);
    const data = await r.json();
    if (!r.ok) { resultEl.textContent = data.error || 'Erro'; return; }
    if (data.codigo) {
      resultEl.textContent = `Código: ${data.codigo} ${data.recebidoEm ? '(recebido ' + new Date(data.recebidoEm).toLocaleTimeString('pt-BR') + ')' : ''}`;
    } else {
      resultEl.textContent = data.mensagem || 'Nenhum código recebido.';
    }
  } catch (e) {
    resultEl.textContent = 'Erro ao buscar.';
  }
});

document.getElementById('cadastroMinisterio')?.addEventListener('change', () => toggleMinisterioOutroVisibility('cadastroMinisterio'));
document.getElementById('perfilMinisterio')?.addEventListener('change', () => toggleMinisterioOutroVisibility('perfilMinisterio'));
perfilWhatsapp?.addEventListener('blur', function () {
  const v = this.value?.trim();
  if (!v) return;
  const formatted = formatarWhatsApp(v);
  if (formatted) this.value = formatted;
});
document.getElementById('cadastroWhatsapp')?.addEventListener('blur', function () {
  const v = this.value?.trim();
  if (!v) return;
  const formatted = formatarWhatsApp(v);
  if (formatted) this.value = formatted;
});

window.addEventListener('hashchange', () => {
  if (window.location.hash === '#cadastro') showCadastroPublico();
  else hideCadastroPublico();
});

let checkinPublicEventoId = null;

function showCheckinPublicOverlay() {
  preparePublicFormSession();
  const overlay = document.getElementById('checkinPublicOverlay');
  const auth = document.getElementById('authOverlay');
  const content = document.getElementById('content');
  if (overlay) overlay.style.display = 'flex';
  if (auth) auth.style.display = 'none';
  if (content) content.style.display = 'none';
}

async function loadCheckinPublic(eventoId) {
  const errEl = document.getElementById('checkinPublicError');
  const successEl = document.getElementById('checkinPublicSuccess');
  const eventLabel = document.getElementById('checkinPublicEventLabel');
  const ministerioSel = document.getElementById('checkinPublicMinisterio');
  if (errEl) errEl.textContent = '';
  if (successEl) successEl.style.display = 'none';
  if (eventLabel) eventLabel.textContent = 'Carregando...';
  if (ministerioSel) ministerioSel.selectedIndex = 0;
  try {
    const r = await fetch(`${API_BASE}/api/checkin-public/${encodeURIComponent(eventoId)}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (eventLabel) eventLabel.textContent = data.error || 'Evento não encontrado ou check-in encerrado.';
      return;
    }
    checkinPublicEventoId = data.evento?._id || eventoId;
    if (eventLabel) {
      const d = data.evento?.data ? new Date(data.evento.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '';
      eventLabel.textContent = (data.evento?.label || d) ? `Evento: ${data.evento?.label || d}${d ? ` (${d})` : ''}` : '';
    }
    const horarioEl = document.getElementById('checkinPublicEventHorario');
    if (horarioEl) {
      const hin = (data.evento?.horarioInicio || '').trim();
      const hfi = (data.evento?.horarioFim || '').trim();
      horarioEl.textContent = (hin || hfi) ? `Horário de check-in: das ${hin || '00:00'} às ${hfi || '23:59'} (horário de Brasília)` : 'Check-in disponível o dia todo (horário de Brasília).';
    }
    const list = Array.isArray(data.ministerios) && data.ministerios.length > 0 ? data.ministerios : MINISTERIOS_PADRAO;
    setMinisterioSelectOptions(ministerioSel, list);
  } catch (e) {
    if (eventLabel) eventLabel.textContent = 'Erro ao carregar. Tente novamente.';
  }
}

document.getElementById('checkinPublicForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('checkinPublicError');
  const successEl = document.getElementById('checkinPublicSuccess');
  const btn = document.getElementById('btnCheckinPublicSubmit');
  if (errEl) errEl.textContent = '';
  if (successEl) successEl.style.display = 'none';
  const email = (document.getElementById('checkinPublicEmail')?.value || '').trim().toLowerCase();
  const nome = (document.getElementById('checkinPublicNome')?.value || '').trim();
  const ministerio = (document.getElementById('checkinPublicMinisterio')?.value || '').trim();
  if (!email || !email.includes('@')) { if (errEl) errEl.textContent = 'Informe um email válido.'; return; }
  if (!ministerio) { if (errEl) errEl.textContent = 'Selecione o ministério.'; return; }
  if (!checkinPublicEventoId) { if (errEl) errEl.textContent = 'Sessão expirada. Abra o link novamente.'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    const r = await fetch(`${API_BASE}/api/checkin-public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventoId: checkinPublicEventoId, email, ministerio, nome: nome || undefined }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (errEl) errEl.textContent = data.error || 'Não foi possível registrar o check-in.';
      return;
    }
    if (successEl) { successEl.textContent = data.message || 'Check-in realizado!'; successEl.style.display = 'block'; }
    if (errEl) errEl.textContent = '';
    document.getElementById('checkinPublicEmail').value = '';
    document.getElementById('checkinPublicNome').value = '';
    document.getElementById('checkinPublicMinisterio').value = '';
  } catch (err) {
    if (errEl) errEl.textContent = err.message || 'Erro de rede. Tente novamente.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar check-in'; }
  }
});

function initPublicFormOrDashboard() {
  const urlSearchParams = new URLSearchParams(window.location.search);
  const checkinParam = urlSearchParams.get('checkin');
  if (checkinParam) {
    showCheckinPublicOverlay();
    loadCheckinPublic(checkinParam);
    return true;
  }
  const escalaParam = urlSearchParams.get('escala');
  if (escalaParam) {
    showEscalaPublicOverlay();
    loadEscalaPublic(escalaParam);
    return true;
  }
  return false;
}

window.addEventListener('pageshow', function(ev) {
  if (ev.persisted) {
    var params = new URLSearchParams(window.location.search);
    var escalaId = params.get('escala');
    var checkinId = params.get('checkin');
    if (escalaId || checkinId) {
      var loading = document.getElementById('loading');
      var dashboard = document.querySelector('.dashboard');
      if (loading) loading.style.display = 'none';
      if (dashboard) dashboard.style.display = 'none';
      if (escalaId) {
        var ov = document.getElementById('escalaPublicOverlay');
        if (ov) ov.style.display = 'flex';
      }
      if (checkinId) {
        var ov = document.getElementById('checkinPublicOverlay');
        if (ov) ov.style.display = 'flex';
      }
    }
  }
});

(() => {
  if (initPublicFormOrDashboard()) return;
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
      authRole = normalizeAuthRole(parsed.role);
      authEmail = parsed.email || null;
      authMinisterioId = parsed.ministerioId != null ? parsed.ministerioId : null;
      authMinisterioNome = parsed.ministerioNome != null ? parsed.ministerioNome : null;
      authMinisterioIds = Array.isArray(parsed.ministerioIds) ? parsed.ministerioIds : [];
      authMinisterioNomes = Array.isArray(parsed.ministerioNomes) ? parsed.ministerioNomes : [];
      authFotoUrl = parsed.fotoUrl != null ? parsed.fotoUrl : null;
      authMustChangePassword = !!parsed.mustChangePassword;
      authIsMasterAdmin = !!parsed.isMasterAdmin;
    } catch (_) {
      authToken = ''; authUser = ''; authRole = 'admin'; authEmail = null; authMinisterioId = null; authMinisterioNome = null; authMinisterioIds = []; authMinisterioNomes = []; authFotoUrl = null; authMustChangePassword = false; authIsMasterAdmin = false;
    }
  }
  updateAuthUi();
  Promise.race([
    verifyAuth(),
    new Promise(r => setTimeout(() => r(false), 8000))
  ]).then(ok => {
    if (ok && authMustChangePassword) return;
    if (ok) {
      const isVol = authRole === 'voluntario';
      const hasMinisterios = (authMinisterioNomes && authMinisterioNomes.length > 0) || authMinisterioNome;
      const isLider = (authRole === 'lider' || authRole === 'admin') && hasMinisterios;
      const isLiderRole = authRole === 'lider' || isLider;
      const defaultView = isVol ? 'perfil' : (isLiderRole && authRole !== 'admin' ? 'checkin-ministerio' : 'resumo');
      setView(defaultView);
      if (authRole === 'admin') fetchAllData();
      else if (isLiderRole && authRole !== 'admin') { fetchCheckinsMinisterio(); fetchMeusCheckins(); fetchPerfil(); }
      else { fetchEventosHoje(); fetchMeusCheckins(); fetchPerfil(); }
    } else {
      clearAuthSession();
      return;
    }
  }).catch(() => {
    clearAuthSession();
  });
})();
