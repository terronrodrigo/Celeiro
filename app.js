/* Plataforma de gestão de voluntários — Celeiro São Paulo (front-end + Resend) */
// API na mesma origem (frontend servido pelo Express em / e API em /api/*)
const API_BASE = '';
const AUTH_STORAGE_KEY = 'celeiro_admin_auth';
const TZ_BRASILIA = 'America/Sao_Paulo'; // Eventos de check-in: sempre horário de Brasília

/** Slug do tenant em links (?igreja=) e header X-Igreja-Slug. URL vence sessão; padrão celeiro-sp. */
function getTenantSlugForLinks() {
  try {
    const u = new URL(window.location.href);
    const q = (u.searchParams.get('igreja') || '').trim().toLowerCase();
    if (q) return q;
  } catch (_) {}
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o.igrejaSlug) return String(o.igrejaSlug).trim().toLowerCase();
    }
  } catch (_) {}
  return 'celeiro-sp';
}

/** Data de hoje em Brasília no formato YYYY-MM-DD (para filtro de check-ins). */
function getHojeDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
}

/** Formata data de escala como DD/MM/AAAA usando apenas o dia civil (evita mudança por fuso). */
function formatEscalaDateOnly(dateVal) {
  if (dateVal == null || dateVal === '') return '—';
  const str = typeof dateVal === 'string' ? dateVal.trim() : (dateVal instanceof Date ? dateVal.toISOString() : String(dateVal));
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (Number.isNaN(d.getTime())) return '—';
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

/** Retorna YYYY-MM-DD para comparação/filtro, usando apenas o dia civil. */
function escalaDataToYMD(dateVal) {
  if (dateVal == null || dateVal === '') return '';
  const str = typeof dateVal === 'string' ? dateVal.trim() : (dateVal instanceof Date ? dateVal.toISOString() : String(dateVal));
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[0];
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sortEscalasByDataDesc(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const da = escalaDataToYMD(a.data) || '';
    const db = escalaDataToYMD(b.data) || '';
    if (da !== db) return db.localeCompare(da);
    return String(b._id || '').localeCompare(String(a._id || ''));
  });
}

function sortEscalasByDataAsc(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const da = escalaDataToYMD(a.data) || '';
    const db = escalaDataToYMD(b.data) || '';
    if (da !== db) return da.localeCompare(db);
    return String(a._id || '').localeCompare(String(b._id || ''));
  });
}

/**
 * Smart sort: datas futuras (asc, mais próxima primeiro), depois datas passadas (desc, mais recente primeiro).
 * Itens sem data vão para o final. Usado em listagens de escalas e eventos de check-in para admin/líder.
 */
function sortByDataSmart(list, dataKey = 'data') {
  const todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const arr = Array.isArray(list) ? [...list] : [];
  return arr.sort((a, b) => {
    const da = escalaDataToYMD(a?.[dataKey]) || '';
    const db = escalaDataToYMD(b?.[dataKey]) || '';
    const aFut = !!da && da >= todayYmd;
    const bFut = !!db && db >= todayYmd;
    if (aFut && !bFut) return -1;
    if (!aFut && bFut) return 1;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    if (aFut && bFut) return da.localeCompare(db);
    return db.localeCompare(da);
  });
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
/** email (lowercase) → nome para personalizar [nome] em envios da aba Formulários (inscritos que não são voluntários). */
let emailExtraRecipientNames = {};
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
let authIsGlobalAdmin = false;
let authVerified = false;
/** Incrementado a cada login/setAuth; evita verify da página apagar sessão nova. */
let authVerifyGeneration = 0;
let loginInProgress = false;
let eventosCheckin = [];
let selectedEventoCheckinIds = new Set();
let eventosBatismo = [];
let eventosApresentacao = [];
let eventosNovoMembro = [];
let eventoSelecionadoHoje = null;
/** Callback após salvar/pular complemento pós-check-in (telefone/cidade/UF). */
let perfilComplementoPendingDone = null;
let allCheckins = []; // todos os check-ins sem filtro, para contagem histórica por pessoa
const filters = {
  ministerio: '',
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
if (loginForm) {
  loginForm.setAttribute('novalidate', '');
  loginForm.removeAttribute('action');
  loginForm.removeAttribute('method');
  loginForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  }, { capture: true });
}
const btnLogout = document.getElementById('btnLogoutSidebar');
const authUserName = document.getElementById('authUserName');
const authUserInitial = document.getElementById('authUserInitial');
const filterMinisterio = document.getElementById('filterMinisterio');
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
const checkinSort = document.getElementById('checkinSort');
const checkinMinisterioSort = document.getElementById('checkinMinisterioSort');
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
const eventosBatismoBody = document.getElementById('eventosBatismoBody');
const eventosApresentacaoBody = document.getElementById('eventosApresentacaoBody');
const eventosNovoMembroBody = document.getElementById('eventosNovoMembroBody');
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

function canShowMongoMigrateUi() {
  const isAdmin = normalizeAuthRole(authRole) === 'admin';
  return !!(authToken && authVerified && isAdmin && (authIsMasterAdmin || authIsGlobalAdmin));
}

function updateAuthUi() {
  const isLogged = Boolean(authToken);
  const isVoluntario = String(authRole || '').toLowerCase() === 'voluntario';
  const hasMinisterios = (authMinisterioNomes && authMinisterioNomes.length > 0) || authMinisterioNome;
  const isLider = (authRole === 'lider' || authRole === 'admin') && hasMinisterios;
  const isAdmin = authRole === 'admin';
  const isVerifying = isLogged && !authVerified;
  if (authOverlay) {
    if (isLogged && authMustChangePassword) {
      authOverlay.style.display = 'flex';
      if (loginCard) loginCard.style.display = 'none';
      if (mustChangePasswordCard) mustChangePasswordCard.style.display = 'block';
      [forgotPasswordCard, resetPasswordCard, setupCard, registerCard].forEach(c => { if (c) c.style.display = 'none'; });
    } else if (isVerifying) {
      authOverlay.style.display = 'flex';
      if (loginCard) loginCard.style.display = 'block';
      if (mustChangePasswordCard) mustChangePasswordCard.style.display = 'none';
      [forgotPasswordCard, resetPasswordCard, setupCard, registerCard].forEach((c) => { if (c) c.style.display = 'none'; });
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
  const appShellEl = document.querySelector('.app-shell');
  // Shell visível enquanto valida sessão (loading fica dentro dele).
  if (appShellEl) appShellEl.style.display = isLogged ? '' : 'none';
  if (loadingEl) loadingEl.style.display = 'none';
  if (errorEl) errorEl.style.display = 'none';
  if (isVerifying) {
    if (contentEl) contentEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
    if (loginError && !loginError.textContent && !loginInProgress) {
      loginError.style.color = 'var(--text-secondary, #a1a1aa)';
      loginError.textContent = 'Validando sessão salva… Você pode entrar de novo abaixo.';
    }
  } else if (!isLogged) {
    if (contentEl) contentEl.style.display = 'none';
  } else if (isLogged && authVerified) {
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
  // Mesma regra de setView(): busca por nome/email na view Voluntários para admin e líderes (não só admin).
  if (searchBox) {
    const showSearch = isLogged && (isAdmin || isLider || authRole === 'lider') && currentView === 'voluntarios';
    searchBox.style.display = showSearch ? 'flex' : 'none';
  }
  const btnRefresh = document.getElementById('btnRefresh');
  if (btnRefresh) {
    btnRefresh.style.display = isLogged && (isAdmin || isLider || authRole === 'lider') ? '' : 'none';
  }
  const cadastroLinkSection = document.getElementById('cadastroLinkSection');
  if (cadastroLinkSection) cadastroLinkSection.style.display = isLogged && isAdmin ? '' : 'none';
  const brdidSection = document.getElementById('brdidVerificacaoSection');
  if (brdidSection) brdidSection.style.display = isLogged && isAdmin ? '' : 'none';
  const mongoMigrateSection = document.getElementById('mongoMigrateSection');
  if (mongoMigrateSection) mongoMigrateSection.style.display = canShowMongoMigrateUi() ? '' : 'none';
  if (canShowMongoMigrateUi()) void refreshMongoMigrateStatus();
  void refreshIgrejaSelector();
}

/** Limpa dados em memória e DOM de conteúdo por usuário, para não exibir tela do login anterior ao trocar de perfil. */
function clearUserContent() {
  voluntarios = [];
  resumo = {};
  checkins = [];
  checkinResumo = {};
  eventosCheckin = [];
  selectedEventoCheckinIds.clear();
  eventoSelecionadoHoje = null;
  selectedEmails.clear();
  currentView = '';
  ['eventos-checkin', 'cultos-recorrentes', 'checkin-hoje', 'meus-checkins', 'perfil', 'ministros', 'usuarios', 'checkin-ministerio', 'resumo', 'voluntarios', 'escalas', 'escalas-criar', 'formularios'].forEach(v => setViewLoading(v, false));
  const perfilFields = [perfilNome, perfilEmail, perfilNascimento, perfilWhatsapp, perfilPais, perfilEstado, perfilCidade, perfilEvangelico, perfilIgreja, perfilTempoIgreja, perfilVoluntarioIgreja, perfilHorasSemana, perfilAreas, perfilTestemunho];
  perfilFields.forEach(el => { if (el) el.value = ''; });
  renderPerfilMinisteriosCheckboxes([]);
  const perfilMinisterioOutro = document.getElementById('perfilMinisterioOutro');
  if (perfilMinisterioOutro) { perfilMinisterioOutro.value = ''; perfilMinisterioOutro.style.display = 'none'; }
  if (perfilDisponibilidadeGroup) {
    perfilDisponibilidadeGroup.querySelectorAll('input[name="perfilDisponibilidadeDia"]').forEach(cb => { cb.checked = false; });
  }
  if (meusCheckinsBody) meusCheckinsBody.innerHTML = '<tr><td colspan="3">Carregando...</td></tr>';
  if (eventosHojeList) eventosHojeList.innerHTML = '';
  if (eventosCheckinBody) eventosCheckinBody.innerHTML = '';
  if (eventosBatismoBody) eventosBatismoBody.innerHTML = '';
  if (eventosApresentacaoBody) eventosApresentacaoBody.innerHTML = '';
  if (eventosNovoMembroBody) eventosNovoMembroBody.innerHTML = '';
  eventosBatismo = [];
  eventosApresentacao = [];
  eventosNovoMembro = [];
  if (voluntariosBody) voluntariosBody.innerHTML = '';
  if (checkinBody) checkinBody.innerHTML = '';
  if (formConfirmarCheckin) formConfirmarCheckin.style.display = 'none';
}

function setAuthSession(data, { verified = false } = {}) {
  authVerifyGeneration += 1;
  clearUserContent();
  authToken = data?.token || '';
  authVerified = !!verified;
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
  authIsGlobalAdmin = !!(typeof user === 'object' && user !== null && user.isGlobalAdmin === true) || !!(data?.isGlobalAdmin === true);
  const igrejaSlug = (user?.igrejaSlug || data?.user?.igrejaSlug || '').toString().trim().toLowerCase() || 'celeiro-sp';
  if (authToken) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
      token: authToken, user: authUser, role: authRole, email: authEmail,
      ministerioId: authMinisterioId, ministerioNome: authMinisterioNome, ministerioIds: authMinisterioIds, ministerioNomes: authMinisterioNomes,
      fotoUrl: authFotoUrl, mustChangePassword: authMustChangePassword, isMasterAdmin: authIsMasterAdmin, isGlobalAdmin: authIsGlobalAdmin, igrejaSlug,
    }));
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
  authIsGlobalAdmin = false;
  authVerified = false;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  clearUserContent();
  updateAuthUi();
}

/** Salva slug da igreja (contexto admin global) no mesmo objeto da sessão. */
function persistIgrejaSlugToStorage(slug) {
  const s = (slug || 'celeiro-sp').toString().trim().toLowerCase() || 'celeiro-sp';
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    const o = raw ? JSON.parse(raw) : {};
    if (!o.token && !authToken) return;
    o.igrejaSlug = s;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(o));
  } catch (_) {}
}

/** Limpa dados carregados da API para trocar de tenant sem perder a view atual. */
function clearTenantScopedData() {
  voluntarios = [];
  resumo = {};
  checkins = [];
  checkinResumo = {};
  allCheckins = [];
  eventosCheckin = [];
  selectedEventoCheckinIds.clear();
  eventoSelecionadoHoje = null;
  selectedEmails.clear();
  ministrosList = [];
  usersList = [];
  checkinsMinisterio = [];
  checkinMinisterioResumo = {};
  escalasList = [];
  selectedEscalaIds.clear();
  escalaAtiva = null;
  candidaturasAll = [];
  candidaturasEscalaList = [];
  candidaturasEscalaId = null;
  candidaturasAnaliseFilters = {};
  escalasPreSelectId = null;
  eventosBatismo = [];
  eventosApresentacao = [];
  eventosNovoMembro = [];
  if (voluntariosBody) voluntariosBody.innerHTML = '';
  if (checkinBody) checkinBody.innerHTML = '';
}

let igrejaSelectorLoading = false;
async function refreshIgrejaSelector() {
  const wrap = document.getElementById('igrejaSelectWrap');
  const sel = document.getElementById('topIgrejaSelect');
  if (!wrap || !sel) return;
  const show = !!(authToken && authVerified && authIsGlobalAdmin && authRole === 'admin');
  wrap.style.display = show ? 'flex' : 'none';
  if (!show) return;
  if (igrejaSelectorLoading) return;
  igrejaSelectorLoading = true;
  try {
    const r = await fetch(`${API_BASE}/api/igrejas`, { headers: getAuthHeaders() });
    if (!r.ok) {
      sel.innerHTML = '';
      return;
    }
    const list = await r.json();
    if (!Array.isArray(list) || list.length === 0) {
      sel.innerHTML = '<option value="celeiro-sp">Nenhuma igreja</option>';
      return;
    }
    const current = getTenantSlugForLinks();
    sel.innerHTML = list.map((g) => `<option value="${escapeAttr(g.slug)}">${escapeHtml(g.nome || g.slug)}</option>`).join('');
    const has = list.some((g) => (g.slug || '').toLowerCase() === current);
    const val = has ? current : String(list[0].slug || 'celeiro-sp').toLowerCase();
    sel.value = val;
    if (val !== current) persistIgrejaSlugToStorage(val);
  } catch (_) {
    sel.innerHTML = '';
  } finally {
    igrejaSelectorLoading = false;
  }
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
  const tokenAtRequest = authToken;
  const headers = { ...(options.headers || {}), ...getAuthHeaders() };
  const slug = getTenantSlugForLinks();
  if (slug) headers['X-Igreja-Slug'] = slug;
  const r = await fetch(url, { ...options, headers });
  if (r.status === 401 && authToken && authToken === tokenAtRequest && !loginInProgress) {
    clearAuthSession();
    throw new Error('AUTH_REQUIRED');
  }
  return r;
}

/** Exibe erro de login de forma visível (texto + toast + console). */
function showLoginError(message, detail) {
  const msg = String(message || 'Falha ao entrar.').trim();
  const extra = detail ? String(detail).trim() : '';
  const full = extra ? `${msg} (${extra})` : msg;
  if (loginError) {
    loginError.textContent = full;
    loginError.style.color = '';
    loginError.setAttribute('role', 'alert');
    loginError.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  showToast(msg, 'error');
  if (extra) console.warn('[login]', msg, extra);
  else console.warn('[login]', msg);
}

async function verifyAuth() {
  if (!authToken) return { ok: false, status: 0, error: 'Sem token de sessão.' };
  const tokenAtStart = authToken;
  try {
    const headers = { Authorization: `Bearer ${tokenAtStart}` };
    const slug = getTenantSlugForLinks();
    if (slug) headers['X-Igreja-Slug'] = slug;
    const r = await fetch(`${API_BASE}/api/me`, { headers });
    if (authToken !== tokenAtStart) {
      return { ok: false, stale: true, status: 0, error: 'Verificação cancelada (nova tentativa de login).' };
    }
    if (!r.ok) {
      let errBody = {};
      try { errBody = await r.json(); } catch (_) {}
      const errMsg = errBody.error || `HTTP ${r.status}`;
      if (authToken === tokenAtStart) clearAuthSession();
      return { ok: false, status: r.status, error: errMsg };
    }
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
    authIsGlobalAdmin = data.isGlobalAdmin === true;
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
        parsed.isGlobalAdmin = authIsGlobalAdmin;
        if (data.igrejaSlug) parsed.igrejaSlug = String(data.igrejaSlug).trim().toLowerCase();
        else if (!parsed.igrejaSlug) parsed.igrejaSlug = 'celeiro-sp';
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(parsed));
      } catch (_) {}
    }
    authVerified = true;
    updateAuthUi();
    return { ok: true, status: 200 };
  } catch (e) {
    if (authToken === tokenAtStart) clearAuthSession();
    return { ok: false, status: 0, error: e.message || 'Erro de rede ao validar sessão.' };
  }
}

function showLoading(show) {
  if (loadingEl) loadingEl.style.display = show ? 'flex' : 'none';
  if (contentEl) contentEl.style.display = show ? 'none' : 'block';
  if (errorEl) errorEl.style.display = 'none';
}

/**
 * Função a ser re-executada pelo botão "Tentar novamente".
 * showError("...", () => fetchX()) registra a callback; quando vazio, cai no fallback fetchAllData.
 */
let lastErrorRetryFn = null;

function showError(msg, retryFn) {
  if (typeof retryFn === 'function') lastErrorRetryFn = retryFn;
  if (loadingEl) loadingEl.style.display = 'none';
  if (contentEl) contentEl.style.display = 'none';
  if (errorEl) {
    errorEl.style.display = 'flex';
    if (errorMsgEl) errorMsgEl.textContent = msg || 'Erro ao carregar dados.';
  }
}

/** Mostra erro como toast (sem esconder a tela). Usar em fluxos não-críticos onde o usuário pode continuar. */
function showErrorToast(msg) {
  showToast?.(msg || 'Erro ao carregar dados.', 'error');
}

/**
 * Wrapper para extrair mensagem de erro útil de um Response (inclui requestId quando o servidor envia).
 * Sempre tenta o JSON; se não conseguir, devolve fallback genérico.
 */
async function extractErrorMessage(response, fallback = 'Erro ao processar requisição.') {
  try {
    const errData = await response.json();
    const base = errData?.error || errData?.message || fallback;
    if (errData?.requestId && !String(base).includes(errData.requestId)) {
      return `${base} (id ${errData.requestId})`;
    }
    return base;
  } catch (_) {
    const rid = response?.headers?.get?.('x-request-id');
    return rid ? `${fallback} (id ${rid})` : fallback;
  }
}

/** Toast leve (substitui alert em fluxos comuns). */
/** Modais dentro de `.view` ficam invisíveis por `display:none` ou `overflow` do main; move para body. */
function ensureModalPortal(modalEl) {
  if (!modalEl) return;
  if (modalEl.parentElement !== document.body) {
    document.body.appendChild(modalEl);
  }
}

const CULTOS_DIAS_SEMANA_DEFAULT = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
];

function showToast(message, type) {
  const text = String(message || '').trim();
  if (!text) return;
  let root = document.getElementById('toastRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toastRoot';
    root.className = 'toast-root';
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
  }
  const el = document.createElement('div');
  el.className = 'toast toast-' + (type === 'error' ? 'error' : type === 'success' ? 'success' : 'info');
  el.textContent = text;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

let chartJsLoadPromise = null;
function applyChartDefaults() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = '#a0a0a0';
  Chart.defaults.borderColor = '#2a2a2a';
  Chart.defaults.font.family = "'DM Sans', sans-serif";
  Chart.defaults.animation = { duration: 380 };
}
function ensureChartJs() {
  if (typeof Chart !== 'undefined') {
    applyChartDefaults();
    return Promise.resolve();
  }
  if (chartJsLoadPromise) return chartJsLoadPromise;
  chartJsLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    s.async = true;
    s.onload = () => {
      applyChartDefaults();
      resolve();
    };
    s.onerror = () => reject(new Error('Falha ao carregar gráficos'));
    document.head.appendChild(s);
  });
  return chartJsLoadPromise;
}

let prefetchAllCheckinsPromise = null;
function invalidateCheckinKpiCache() {
  _cachedEmailsComCheckin = null;
  _cachedEmailsComCheckinRef = null;
  _cachedSoCheckinList = null;
  _cachedSoCheckinListRef = [null, null];
}
/** Carrega check-ins completos em segundo plano para KPIs (sem bloquear a UI). */
function prefetchAllCheckinsForKpis() {
  if (!authToken || authRole !== 'admin') return;
  if (Array.isArray(allCheckins) && allCheckins.length > 0) return;
  if (prefetchAllCheckinsPromise) return;
  prefetchAllCheckinsPromise = authFetch(`${API_BASE}/api/checkins`)
    .then((r) => (r.ok ? r.json() : { checkins: [] }))
    .then((data) => {
      allCheckins = data.checkins || [];
      invalidateCheckinKpiCache();
      if (currentView === 'resumo' || currentView === 'voluntarios') refreshVoluntariosView();
    })
    .catch(() => {})
    .finally(() => { prefetchAllCheckinsPromise = null; });
}

const ADMIN_ONLY_VIEWS = ['ministros', 'usuarios', 'eventos-checkin', 'cultos-recorrentes', 'checkin', 'escalas-criar'];
const LIDER_VIEWS = ['checkin-ministerio', 'perfil', 'meus-checkins', 'escalas'];
const VOLUNTARIO_VIEWS = ['perfil', 'checkin-hoje', 'meus-checkins', 'escalas'];

let currentView = '';
let ministrosList = [];
/** Links de cadastro de líder por ministério (admin). */
let convitesLiderByMinId = {};
let convitesLiderBulkText = '';
/** Token do link ?convite-lider= (cadastro público de líder). */
let conviteLiderToken = '';
let usersList = [];
let checkinsMinisterio = [];
let checkinMinisterioResumo = {};
let escalasList = [];
let selectedEscalaIds = new Set();
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
let checkinsDisplayLimit = LIST_PAGE_SIZE;
let checkinsMinisterioDisplayLimit = LIST_PAGE_SIZE;
let eventosCheckinDisplayLimit = LIST_PAGE_SIZE;
let eventosCheckinSortOrder = 'smart';
const eventosCheckinFilters = { search: '', status: '' };
let checkinSortOrder = 'date-desc';
let checkinMinisterioSortOrder = 'date-desc';

const VIEW_META = {
  resumo: { title: 'Resumo', subtitle: 'Visão geral da plataforma e indicadores.', role: 'admin' },
  voluntarios: { title: 'Voluntários', subtitle: 'Lista, filtros e envio de email.', role: 'admin' },
  ministros: { title: 'Ministérios', subtitle: 'Crie ministérios e defina líderes.', role: 'admin' },
  usuarios: { title: 'Usuários', subtitle: 'Perfis e permissões.', role: 'admin' },
  'eventos-checkin': { title: 'Eventos check-in', subtitle: 'Datas de culto para confirmação de presença.', role: 'admin' },
  'cultos-recorrentes': { title: 'Cultos recorrentes', subtitle: 'Escalas e check-ins gerados automaticamente por dia da semana (horário de Brasília).', role: 'admin' },
  checkin: { title: 'Check-in', subtitle: 'Registros por data e ministério.', role: 'admin' },
  'checkin-ministerio': { title: 'Check-ins do ministério', subtitle: 'Acompanhe confirmações de presença nos ministérios sob sua liderança (você pode liderar mais de um).', role: 'lider' },
  perfil: { title: 'Meu perfil', subtitle: 'Seus dados de cadastro.', role: 'voluntario' },
  'checkin-hoje': { title: 'Check-in do dia', subtitle: 'Confirme presença no culto de hoje.', role: 'voluntario' },
  'meus-checkins': { title: 'Meus check-ins', subtitle: 'Histórico de presenças.', role: 'voluntario' },
  'escalas-criar': { title: 'Criar escalas', subtitle: 'Crie e edite escalas, copie links de candidatura.', role: 'admin' },
  escalas: { title: 'Escala', subtitle: 'Candidatos e aprovação de voluntários.', role: 'admin' },
  formularios: { title: 'Formulários', subtitle: 'Novos membros, consolidação, batismo e apresentação de bebês.', role: 'admin' },
};

function setView(view, options) {
  options = options || {};
  // Garante que overlays públicos (Novos Membros/Batismo/Apresentação/Check-in/escala link público)
  // não fiquem aparecendo em telas admin/líder/voluntário.
  if (authToken) hideAllPublicOverlays();
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
  if (pageTitle) {
    pageTitle.textContent = (view === 'escalas' && isVol)
      ? 'Escalas'
      : ((meta && meta.title) || 'Voluntários · Celeiro São Paulo');
  }
  if (pageSubtitle) {
    if (view === 'escalas' && isVol) {
      pageSubtitle.textContent = 'Veja cultos disponíveis, inscreva-se e faça check-in.';
    } else {
      pageSubtitle.textContent = (meta && meta.subtitle) || '';
    }
  }
  if (searchBox) searchBox.style.display = (isAdmin || isLider || authRole === 'lider') && view === 'voluntarios' ? 'flex' : 'none';
  if (view === 'voluntarios') voluntariosPageOffset = 0;
  if (view === 'checkin') resetCheckinsListPage();
  if (view === 'checkin-ministerio') resetCheckinsMinisterioListPage();
  if (!options.skipFetch) {
    const viewsWithFetch = ['eventos-checkin', 'cultos-recorrentes', 'checkin-hoje', 'meus-checkins', 'perfil', 'ministros', 'usuarios', 'checkin-ministerio', 'resumo', 'voluntarios', 'escalas', 'escalas-criar', 'formularios'];
    viewsWithFetch.forEach(v => setViewLoading(v, false)); // Limpa loading de todas as views primeiro
    if (view === 'eventos-checkin') runWithTimeout('eventos-checkin', () => fetchEventosCheckin());
    else if (view === 'cultos-recorrentes') runWithTimeout('cultos-recorrentes', () => fetchCultosRecorrentes());
    else if (view === 'formularios') runWithTimeout('formularios', () => fetchFormularios());
    else if (view === 'checkin-hoje') runWithTimeout('checkin-hoje', () => fetchEventosHoje());
    else if (view === 'meus-checkins') runWithTimeout('meus-checkins', () => fetchMeusCheckins());
    else if (view === 'perfil') runWithTimeout('perfil', () => fetchPerfil());
    else if (view === 'ministros') runWithTimeout('ministros', () => fetchMinistros());
    else if (view === 'usuarios') runWithTimeout('usuarios', () => fetchUsers());
    else if (view === 'checkin-ministerio') runWithTimeout('checkin-ministerio', () => fetchCheckinsMinisterio());
    else if (view === 'escalas-criar') runWithTimeout('escalas-criar', () => fetchEscalasCriar());
    else if (view === 'escalas') runWithTimeout('escalas', () => fetchEscalas());
    if (view === 'voluntarios' && Array.isArray(voluntarios) && voluntarios.length > 0) {
      updateFilters();
    }
    if (view === 'resumo' && (isAdmin || isLider || authRole === 'lider')) {
      fetchEscalaEmDestaque();
      fetchResumoGlobal();
    } else {
      const w = document.getElementById('escalaDestaqueWidget');
      if (w) w.innerHTML = '';
    }
  }
  if (view === 'checkin' && isAdmin) {
    setViewLoading('checkin', true);
    const hoje = getHojeDateString();
    if (checkinData && !checkinData.value) checkinData.value = hoje;
    Promise.all([
      fetchCheckinDateOptions(),
      authFetch(`${API_BASE}/api/eventos-checkin`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([, list]) => {
      eventosCheckin = list || [];
      if (checkinEvento) {
        checkinEvento.innerHTML = '<option value="">Todos os eventos</option>' + eventosCheckin.map((e) => {
          const d = new Date(e.data);
          return `<option value="${e._id}">${e.label || d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })}</option>`;
        }).join('');
      }
      return fetchCheckinsWithFilters({ data: checkinData?.value || hoje });
    }).catch(() => fetchCheckinsWithFilters({ data: hoje }))
      .finally(() => setViewLoading('checkin', false));
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
      showError('A conexão demorou. Tente novamente.', () => fetchVoluntarios(opts));
    }
  }, VIEW_LOAD_TIMEOUT_MS);
  try {
    const r = await authFetch(`${API_BASE}/api/voluntarios`);
    if (settled) return;
    if (!r.ok) {
      const msg = await extractErrorMessage(r, `HTTP ${r.status}`);
      throw new Error(msg);
    }
    const data = await r.json();
    voluntarios = data.voluntarios || [];
    resumo = data.resumo || {};
    render();
    if (authRole === 'admin') prefetchAllCheckinsForKpis();
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
      showError(e.message || 'Verifique se o servidor está rodando em ' + API_BASE, () => fetchVoluntarios(opts));
    } else {
      showToast('Erro ao carregar voluntários: ' + (e.message || 'Servidor não respondeu'), 'error');
    }
  }
}

async function fetchCheckins() {
  if (!authToken) { updateAuthUi(); return; }
  try {
    const r = await authFetch(`${API_BASE}/api/checkins`);
    if (!r.ok) {
      const msg = await extractErrorMessage(r, `HTTP ${r.status}`);
      throw new Error(msg);
    }
    const data = await r.json();
    checkins = data.checkins || [];
    checkinResumo = data.resumo || {};
    resetCheckinsListPage();
    renderCheckins();
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    showError(e.message || 'Erro ao carregar check-ins.', () => fetchCheckins());
  }
}

/** Preenche o select de data com YMDs (mais recentes primeiro). Sempre inclui "Hoje". */
function populateCheckinDataSelectFromDates(dateStrings) {
  if (!checkinData) return;
  const hojeStr = getHojeDateString();
  const dateSet = new Set([hojeStr]);
  (dateStrings || []).forEach((ymd) => {
    if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(String(ymd).slice(0, 10))) {
      dateSet.add(String(ymd).slice(0, 10));
    }
  });
  const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));
  const currentValue = checkinData.value;
  const options = ['<option value="">Todas as datas</option>'];
  const hojeLabel = 'Hoje (' + new Date(hojeStr + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA, day: '2-digit', month: '2-digit', year: 'numeric' }) + ')';
  options.push(`<option value="${escapeAttr(hojeStr)}">${escapeHtml(hojeLabel)}</option>`);
  dates.forEach((dateStr) => {
    if (dateStr === hojeStr) return;
    const d = new Date(dateStr + 'T12:00:00');
    const label = d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    options.push(`<option value="${escapeAttr(dateStr)}">${escapeHtml(label)}</option>`);
  });
  checkinData.innerHTML = options.join('');
  if (currentValue === '' || currentValue === hojeStr || dates.includes(currentValue)) {
    checkinData.value = currentValue;
  }
}

/** @deprecated use populateCheckinDataSelectFromDates — extrai datas de check-ins já carregados */
function populateCheckinDataSelect(checkinsArray) {
  const list = Array.isArray(checkinsArray) ? checkinsArray : [];
  const dateSet = new Set();
  list.forEach((c) => {
    const d = c.dataCheckin ? new Date(c.dataCheckin) : (c.timestampMs != null || c.timestamp ? new Date(c.timestampMs ?? c.timestamp) : null);
    if (d && !Number.isNaN(d.getTime())) {
      const dateStr = d.toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
      if (dateStr) dateSet.add(dateStr);
    }
  });
  populateCheckinDataSelectFromDates([...dateSet]);
}

async function fetchCheckinDateOptions() {
  try {
    const r = await authFetch(`${API_BASE}/api/checkins/datas`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Falha');
    populateCheckinDataSelectFromDates(d.datas || []);
  } catch (_) {
    populateCheckinDataSelectFromDates([]);
  }
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
      invalidateCheckinKpiCache();
    }
    if (dataOverride !== null && checkinData) checkinData.value = dataOverride;
    resetCheckinsListPage();
    renderCheckins();
  }).catch(() => {});
}

async function fetchMinistros() {
  if (!authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/ministros`);
    if (!r.ok) {
      const msg = await extractErrorMessage(r, `Não foi possível carregar os ministérios.`);
      showErrorToast(msg);
      return;
    }
    ministrosList = await r.json();
    await fetchConvitesLider();
    if (currentView !== 'ministros') return;
    renderMinistros();
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    showErrorToast(e.message || 'Erro ao carregar ministérios.');
  } finally { setViewLoading('ministros', false); }
}

async function fetchConvitesLider() {
  try {
    const r = await authFetch(`${API_BASE}/api/convites-lider`);
    if (!r.ok) return;
    const data = await r.json().catch(() => ({}));
    const list = data.convites || [];
    convitesLiderByMinId = {};
    list.forEach((c) => {
      if (c.ministerioId) convitesLiderByMinId[String(c.ministerioId)] = c;
    });
    updateConvitesLiderBulkUi();
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
}

function formatConvitesLiderBulkText(convites) {
  return (convites || [])
    .filter((c) => c.link)
    .map((c) => `${c.ministerioNome || 'Ministério'}:\n${c.link}`)
    .join('\n\n');
}

function updateConvitesLiderBulkUi() {
  const wrap = document.getElementById('convitesLiderBulkWrap');
  const pre = document.getElementById('convitesLiderBulkText');
  const btnCopyAll = document.getElementById('btnCopiarTodosConvitesLider');
  if (!convitesLiderBulkText) {
    if (wrap) wrap.style.display = 'none';
    if (btnCopyAll) btnCopyAll.disabled = true;
    return;
  }
  if (wrap) wrap.style.display = 'block';
  if (pre) pre.textContent = convitesLiderBulkText;
  if (btnCopyAll) btnCopyAll.disabled = false;
}

async function gerarConviteLider(ministerioId, { regenerar = false } = {}) {
  const r = await authFetch(`${API_BASE}/api/convites-lider/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ministerioId, regenerar }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Falha ao gerar link.');
  if (data.ministerioId) {
    convitesLiderByMinId[String(data.ministerioId)] = {
      ministerioId: data.ministerioId,
      ministerioNome: data.ministerioNome,
      link: data.link,
      expiresAt: data.expiresAt,
    };
  }
  return data;
}

async function copiarLinkConviteLider(ministerioId) {
  let link = convitesLiderByMinId[String(ministerioId)]?.link;
  if (!link) {
    const data = await gerarConviteLider(ministerioId);
    link = data.link;
  }
  if (!link) { showToast('Não foi possível obter o link.', 'error'); return; }
  try {
    await navigator.clipboard.writeText(link);
    showToast('Link copiado!', 'success');
  } catch (_) {
    prompt('Copie o link:', link);
  }
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
    const temLink = !!convitesLiderByMinId[String(m._id)]?.link;
    return `<tr data-ministerio-id="${escapeAttr(m._id)}">
      <td>${escapeHtml(m.nome || '—')}</td>
      <td>${liderNomes}</td>
      <td>
        <button type="button" class="btn btn-sm btn-ghost" data-convite-lider="${escapeAttr(m._id)}" title="Link para o líder criar email e senha">${temLink ? 'Copiar link cadastro' : 'Gerar link cadastro'}</button>
        <button type="button" class="btn btn-sm btn-primary" data-assign-lider="${escapeAttr(m._id)}" data-ministerio-nome="${escapeAttr(m.nome || '')}">Definir líderes</button>
        <button type="button" class="btn btn-sm btn-ghost" data-edit-ministerio="${escapeAttr(m._id)}" data-edit-nome="${escapeAttr(m.nome || '')}">Editar</button>
        <button type="button" class="btn btn-sm btn-ghost" data-delete-ministerio="${escapeAttr(m._id)}" data-delete-nome="${escapeAttr(m.nome || '')}">Excluir</button>
      </td>
    </tr>`;
  }).join('');
  if (ministrosList.length > LIST_PAGE_SIZE) {
    tbody.innerHTML += `<tr><td colspan="3" class="list-more-hint">Exibindo os primeiros ${LIST_PAGE_SIZE} de ${ministrosList.length} ministérios.</td></tr>`;
  }
  tbody.querySelectorAll('[data-convite-lider]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-convite-lider');
      btn.disabled = true;
      try { await copiarLinkConviteLider(id); renderMinistros(); }
      catch (err) { showToast(err.message || 'Erro ao gerar link.', 'error'); }
      finally { btn.disabled = false; }
    });
  });
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
    if (!r.ok) {
      const msg = await extractErrorMessage(r, `Não foi possível carregar os usuários.`);
      showErrorToast(msg);
      return;
    }
    usersList = await r.json();
    if (currentView !== 'usuarios') return;
    renderUsers();
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    showErrorToast(e.message || 'Erro ao carregar usuários.');
  } finally { setViewLoading('usuarios', false); }
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
      if (body) body.innerHTML = '<tr><td colspan="5">Sem permissão ou sem ministério.</td></tr>';
      return;
    }
    const data = await r.json();
    checkinsMinisterio = data.checkins || [];
    checkinMinisterioResumo = data.resumo || {};
    if (currentView !== 'checkin-ministerio') return;
    resetCheckinsMinisterioListPage();
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
  const sorted = sortCheckinsList(checkinsMinisterio, checkinMinisterioSortOrder);
  const total = sorted.length;
  const totalEl = document.getElementById('checkinMinisterioTotal');
  const countEl = document.getElementById('checkinMinisterioCount');
  const bodyEl = document.getElementById('checkinMinisterioBody');
  if (totalEl) totalEl.textContent = total;
  if (countEl) countEl.textContent = `(${total})`;
  const listCountEl = document.getElementById('checkinMinisterioListCount');
  if (listCountEl) listCountEl.textContent = total;
  if (!bodyEl) return;
  if (!total) {
    bodyEl.innerHTML = '<tr><td colspan="5">Nenhum voluntário confirmou presença no seu ministério para o filtro selecionado. Quando fizerem check-in, aparecerão aqui.</td></tr>';
    updateCheckinMinisterioRangeAndMore(0, 0);
    return;
  }
  const shown = Math.min(checkinsMinisterioDisplayLimit, total);
  const list = sorted.slice(0, shown);
  bodyEl.innerHTML = list.map(c => {
    const email = (c.email || '').toLowerCase().trim();
    const batizadoLabel = c.batizado === true ? 'Sim' : (c.batizado === false ? 'Não' : '—');
    return `<tr>
      <td><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(c.nome || '—')}</button></td>
      <td><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(c.email || '—')}</button></td>
      <td>${escapeHtml(c.ministerio || '—')}</td>
      <td>${escapeHtml(batizadoLabel)}</td>
      <td>${escapeHtml(c.timestamp || '—')}</td>
    </tr>`;
  }).join('');
  bodyEl.querySelectorAll('.link-voluntario').forEach(btn => {
    btn.addEventListener('click', () => openPerfilVoluntario(btn.getAttribute('data-email'), { checkinsList: checkinsMinisterio }));
  });
  updateCheckinMinisterioRangeAndMore(total, shown);
}

function exportCheckinsMinisterioCsv() {
  const list = Array.isArray(checkinsMinisterio) ? checkinsMinisterio : [];
  if (!list.length) {
    alert('Nenhum check-in para exportar. Ajuste os filtros ou clique em Atualizar.');
    return;
  }
  const header = ['Nome', 'Email', 'Ministério', 'Batizado', 'Data/Hora'];
  const rows = list.map((c) => {
    const nome = c.nome || '';
    const email = c.email || '';
    const ministerio = c.ministerio || '';
    const batizado = c.batizado === true ? 'Sim' : (c.batizado === false ? 'Não' : '');
    const dataHora = c.timestamp || '';
    return [nome, email, ministerio, batizado, dataHora].map(escapeCsv).join(',');
  });
  const csv = '\uFEFF' + header.map(escapeCsv).join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'checkins-ministerio.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function getEventoDataMs(e) {
  if (!e?.data) return 0;
  const d = e.data instanceof Date ? e.data : new Date(e.data);
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
}

function sortEventosCheckinList(list, order) {
  const arr = Array.isArray(list) ? [...list] : [];
  const sortKey = order || eventosCheckinSortOrder || 'smart';
  if (sortKey === 'smart') return sortByDataSmart(arr, 'data');
  return arr.sort((a, b) => {
    if (sortKey === 'date-asc') return getEventoDataMs(a) - getEventoDataMs(b);
    if (sortKey === 'label-asc') {
      const la = (a.label || '').trim() || new Date(a.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA });
      const lb = (b.label || '').trim() || new Date(b.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA });
      return la.localeCompare(lb, 'pt-BR', { sensitivity: 'base' });
    }
    return getEventoDataMs(b) - getEventoDataMs(a);
  });
}

function resetEventosCheckinListPage() {
  eventosCheckinDisplayLimit = LIST_PAGE_SIZE;
}

function getFilteredEventosCheckin() {
  const q = (eventosCheckinFilters.search || '').trim().toLowerCase();
  const status = eventosCheckinFilters.status || '';
  const list = Array.isArray(eventosCheckin) ? eventosCheckin : [];
  const filtered = list.filter((e) => {
    const ativo = e.ativo !== false;
    if (status === 'ativo' && !ativo) return false;
    if (status === 'inativo' && ativo) return false;
    if (q) {
      const d = new Date(e.data);
      const label = (e.label || d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })).toLowerCase();
      const dataStr = d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }).toLowerCase();
      if (!label.includes(q) && !dataStr.includes(q)) return false;
    }
    return true;
  });
  return sortEventosCheckinList(filtered, eventosCheckinSortOrder);
}

function pruneSelectedEventoCheckinIds() {
  const valid = new Set((eventosCheckin || []).map((e) => String(e._id)));
  selectedEventoCheckinIds = new Set([...selectedEventoCheckinIds].filter((id) => valid.has(String(id))));
}

function updateEventosCheckinSelectionUi() {
  const n = selectedEventoCheckinIds.size;
  const countEl = document.getElementById('eventosCheckinSelectedCount');
  const btn = document.getElementById('btnExcluirEventosCheckinSelecionados');
  if (countEl) countEl.textContent = String(n);
  if (btn) btn.disabled = n === 0;
  const allIds = getFilteredEventosCheckin().map((e) => String(e._id));
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedEventoCheckinIds.has(id));
  const someSelected = allIds.some((id) => selectedEventoCheckinIds.has(id));
  const selectAll = document.getElementById('selectAllEventosCheckin');
  if (selectAll) {
    selectAll.checked = allSelected;
    selectAll.indeterminate = someSelected && !allSelected;
  }
}

function updateEventosCheckinRangeAndMore(total, shown) {
  const rangeEl = document.getElementById('eventosCheckinRange');
  const btnMore = document.getElementById('btnVerMaisEventosCheckin');
  const countEl = document.getElementById('eventosCheckinCount');
  if (countEl) countEl.textContent = total ? `(${total})` : '(0)';
  if (!rangeEl) return;
  if (total <= LIST_PAGE_SIZE) {
    rangeEl.textContent = total ? ` ${total} evento${total === 1 ? '' : 's'}` : '';
    if (btnMore) btnMore.style.display = 'none';
    return;
  }
  rangeEl.textContent = shown < total ? ` — exibindo 1–${shown} de ${total}` : ` — exibindo todos os ${total}`;
  if (btnMore) btnMore.style.display = shown < total ? 'inline-block' : 'none';
}

function renderEventoCheckinRowHtml(e) {
  const eventId = (e._id != null ? String(e._id) : '');
  const d = new Date(e.data);
  const label = e.label || d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA });
  const hin = (e.horarioInicio || '').trim();
  const hfi = (e.horarioFim || '').trim();
  const horarioText = (hin || hfi) ? `${hin || '—'} – ${hfi || '—'} (Brasília)` : 'Dia inteiro (Brasília)';
  const ativo = e.ativo !== false;
  const statusText = ativo ? 'Ativo' : 'Inativo';
  const btnLabel = ativo ? 'Desligar' : 'Ligar';
  const emailSentBadge = e.emailAberturaEnviadoEm
    ? ' <span class="evento-status evento-status-ativo" style="font-size:.75rem;margin-left:4px" title="Email de abertura enviado">✉️</span>'
    : '';
  const vinc = Array.isArray(e.escalasVinculadas) ? e.escalasVinculadas : [];
  const escalaBadge = vinc.length
    ? ` <span class="evento-status evento-status-ativo" style="font-size:.75rem;margin-left:4px" title="${escapeAttr(vinc.map((s) => s.nome).join(', '))}">🔗 ${vinc.length} escala${vinc.length > 1 ? 's' : ''}</span>`
    : '';
  const checked = selectedEventoCheckinIds.has(eventId);
  return `<tr data-event-id="${escapeAttr(eventId)}">
    <td class="col-check" data-label=""><input type="checkbox" class="row-check-evento-checkin" data-evento-id="${escapeAttr(eventId)}" ${checked ? 'checked' : ''} aria-label="Selecionar evento"></td>
    <td>${d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })}</td>
    <td>${escapeHtml(label)}${emailSentBadge}${escalaBadge}</td>
    <td>${escapeHtml(horarioText)}</td>
    <td><span class="evento-status ${ativo ? 'evento-status-ativo' : 'evento-status-inativo'}">${statusText}</span></td>
    <td class="escala-actions-cell">
      <button type="button" class="btn btn-sm btn-primary" data-event-link="${escapeAttr(eventId)}" title="Copiar link para check-in público">Copiar link</button>
      <button type="button" class="btn btn-sm btn-ghost" data-event-qr="${escapeAttr(eventId)}" title="Baixar QR code (PNG)">QR PNG</button>
    </td>
    <td><button type="button" class="btn btn-sm btn-ghost" data-event-email-abertura="${escapeAttr(eventId)}" title="Enviar email de abertura aos voluntários">Email abertura</button></td>
    <td><button type="button" class="btn btn-sm btn-ghost" data-event-associar-escala="${escapeAttr(eventId)}" title="Vincular este check-in a uma escala ativa">Associar escala</button> <button type="button" class="btn btn-sm btn-ghost" data-event-edit="${escapeAttr(eventId)}" title="Editar horários e status">Editar</button> <button type="button" class="btn btn-sm ${ativo ? 'btn-ghost' : 'btn-primary'}" data-event-toggle="${escapeAttr(eventId)}">${btnLabel}</button> <button type="button" class="btn btn-sm btn-ghost" data-event-delete="${escapeAttr(eventId)}" title="Excluir evento">Excluir</button></td>
  </tr>`;
}

function wireEventosCheckinTableActions() {
  if (!eventosCheckinBody) return;
  eventosCheckinBody.querySelectorAll('[data-event-edit]').forEach(btn => {
    btn.addEventListener('click', () => openModalEditarEvento(btn.getAttribute('data-event-edit')));
  });
  eventosCheckinBody.querySelectorAll('[data-event-toggle]').forEach(btn => {
    btn.addEventListener('click', () => toggleEventoAtivo(btn.getAttribute('data-event-toggle')));
  });
  eventosCheckinBody.querySelectorAll('[data-event-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-event-link');
      const ig = encodeURIComponent(getTenantSlugForLinks());
      const base = `${window.location.origin}${window.location.pathname.replace(/\/$/, '') || ''}`;
      const url = `${base}?checkin=${encodeURIComponent(id)}&igreja=${ig}`;
      navigator.clipboard.writeText(url).then(() => alert('Link copiado! Compartilhe para as pessoas fazerem check-in (email + ministério).')).catch(() => prompt('Copie o link:', url));
    });
  });
  eventosCheckinBody.querySelectorAll('[data-event-qr]').forEach(btn => {
    btn.addEventListener('click', () => downloadEventoCheckinQr(btn.getAttribute('data-event-qr')));
  });
  eventosCheckinBody.querySelectorAll('[data-event-email-abertura]').forEach(btn => {
    btn.addEventListener('click', () => enviarEmailAberturaEvento(btn.getAttribute('data-event-email-abertura')));
  });
  eventosCheckinBody.querySelectorAll('[data-event-associar-escala]').forEach(btn => {
    btn.addEventListener('click', () => openModalAssociarEventoEscala(btn.getAttribute('data-event-associar-escala')));
  });
  eventosCheckinBody.querySelectorAll('[data-event-delete]').forEach(btn => {
    btn.addEventListener('click', () => excluirEventoCheckin(btn.getAttribute('data-event-delete')));
  });
  eventosCheckinBody.querySelectorAll('.row-check-evento-checkin').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.getAttribute('data-evento-id');
      if (!id) return;
      if (cb.checked) selectedEventoCheckinIds.add(id);
      else selectedEventoCheckinIds.delete(id);
      updateEventosCheckinSelectionUi();
    });
  });
  updateEventosCheckinSelectionUi();
}

function renderEventosCheckin() {
  if (!eventosCheckinBody) return;
  const filtered = getFilteredEventosCheckin();
  const total = filtered.length;
  const shown = Math.min(eventosCheckinDisplayLimit, total);
  const displayList = filtered.slice(0, shown);
  if (!total) {
    const hasAny = (eventosCheckin || []).length > 0;
    eventosCheckinBody.innerHTML = hasAny
      ? '<tr><td colspan="8">Nenhum evento corresponde aos filtros.</td></tr>'
      : '<tr><td colspan="8">Nenhum evento. Clique em "Novo evento de check-in" para criar.</td></tr>';
  } else {
    eventosCheckinBody.innerHTML = displayList.map(renderEventoCheckinRowHtml).join('');
    wireEventosCheckinTableActions();
  }
  updateEventosCheckinRangeAndMore(total, shown);
  updateEventosCheckinSelectionUi();
}

function closeModalAssociarEventoEscala() {
  const modal = document.getElementById('modalAssociarEventoEscala');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

async function openModalAssociarEventoEscala(eventoId) {
  const id = (eventoId || '').trim();
  if (!id || !authToken) return;
  const modal = document.getElementById('modalAssociarEventoEscala');
  const idEl = document.getElementById('associarEventoId');
  const resumo = document.getElementById('associarEventoResumo');
  const sel = document.getElementById('associarEventoEscalaSelect');
  const vincWrap = document.getElementById('associarEventoVinculadasWrap');
  const vincList = document.getElementById('associarEventoVinculadasList');
  if (!modal || !sel) return;
  if (idEl) idEl.value = id;
  sel.innerHTML = '<option value="">Carregando…</option>';
  if (resumo) resumo.textContent = 'Carregando escalas…';
  ensureModalPortal(modal);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin/${encodeURIComponent(id)}/vinculo-escala`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Falha ao carregar escalas.');
    const ev = data.evento || {};
    const d = ev.data ? new Date(ev.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '—';
    if (resumo) resumo.textContent = `Evento: ${(ev.label || d).trim()} (${d})`;
    const vinculadas = Array.isArray(data.vinculadas) ? data.vinculadas : [];
    if (vincWrap && vincList) {
      if (vinculadas.length) {
        vincWrap.style.display = '';
        vincList.innerHTML = vinculadas.map((s) => {
          const sd = s.data ? formatEscalaDateOnly(s.data) : '—';
          return `<li>${escapeHtml(s.nome || 'Escala')} — ${escapeHtml(sd)}</li>`;
        }).join('');
      } else {
        vincWrap.style.display = 'none';
        vincList.innerHTML = '';
      }
    }
    const candidatas = Array.isArray(data.candidatas) ? data.candidatas : [];
    if (!candidatas.length) {
      sel.innerHTML = '<option value="">Nenhuma escala ativa disponível</option>';
      return;
    }
    sel.innerHTML = '<option value="">Selecione uma escala…</option>' + candidatas.map((s) => {
      const sd = s.data ? formatEscalaDateOnly(s.data) : '—';
      let tag = '';
      if (s.vinculadaAEste) tag = ' ✓ já vinculada';
      else if (s.temOutroEvento) tag = ' ⚠ outro check-in';
      else if (s.mesmaData) tag = ' · mesma data';
      return `<option value="${escapeAttr(String(s._id))}">${escapeHtml((s.nome || 'Escala') + ' — ' + sd + tag)}</option>`;
    }).join('');
    const prefer = candidatas.find((s) => s.mesmaData && !s.temOutroEvento)
      || candidatas.find((s) => s.mesmaData)
      || candidatas.find((s) => !s.temOutroEvento)
      || candidatas[0];
    if (prefer && !prefer.vinculadaAEste) sel.value = String(prefer._id);
  } catch (err) {
    if (resumo) resumo.textContent = err.message || 'Erro ao carregar.';
    sel.innerHTML = '<option value="">Erro ao carregar</option>';
  }
}

async function submitAssociarEventoEscala(ev, forceReplace = false) {
  ev?.preventDefault?.();
  const eventoId = (document.getElementById('associarEventoId')?.value || '').trim();
  const escalaId = (document.getElementById('associarEventoEscalaSelect')?.value || '').trim();
  if (!eventoId || !escalaId) {
    alert('Selecione uma escala.');
    return;
  }
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin/${encodeURIComponent(eventoId)}/associar-escala`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escalaId, forceReplace }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409 && data.needConfirm) {
      if (!confirm(`${data.error || 'Substituir vínculo?'}\n\nConfirmar substituição do check-in vinculado à escala?`)) return;
      return submitAssociarEventoEscala(null, true);
    }
    if (!r.ok) throw new Error(data.error || 'Falha ao associar.');
    closeModalAssociarEventoEscala();
    showToast(data.message || 'Evento associado à escala.');
    await fetchEventosCheckin();
  } catch (err) {
    alert(err.message || 'Erro ao associar escala.');
  }
}

async function purgeEventosCheckinOrfaos() {
  if (!authToken) return;
  const btn = document.getElementById('btnPurgeEventosCheckinOrfaos');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }
  try {
    const preview = await authFetch(`${API_BASE}/api/eventos-checkin/purge-orfaos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    });
    const prev = await preview.json().catch(() => ({}));
    if (!preview.ok) throw new Error(prev.error || 'Falha ao verificar órfãos.');
    const n = Number(prev.orphansCount) || 0;
    const ck = Number(prev.checkinsCount) || 0;
    if (!n) {
      showToast('Nenhum evento órfão (sem escala ativa).');
      return;
    }
    const sample = (prev.sample || []).slice(0, 5).map((o) => {
      const d = o.data ? new Date(o.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '—';
      return `• ${d} — ${(o.label || 'sem nome').slice(0, 40)}`;
    }).join('\n');
    const extra = sample ? `\n\nExemplos:\n${sample}${n > 5 ? `\n… e mais ${n - 5}` : ''}` : '';
    if (!confirm(
      `Encontrados ${n} evento(s) de check-in sem escala ativa vinculada`
      + (ck ? ` (${ck} registro(s) de presença serão removidos)` : '')
      + '.\n\nExcluir todos? Esta ação não pode ser desfeita.'
      + extra,
    )) return;
    if (btn) btn.textContent = 'Limpando…';
    const r = await authFetch(`${API_BASE}/api/eventos-checkin/purge-orfaos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: false }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Falha ao limpar.');
    showToast(data.message || 'Limpeza concluída.');
    selectedEventoCheckinIds.clear();
    await fetchEventosCheckin();
  } catch (err) {
    alert(err.message || 'Erro ao limpar órfãos.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Limpar órfãos';
    }
  }
}

async function fetchEventosCheckin() {
  if (!authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin?_t=${Date.now()}`);
    if (!r.ok) {
      const msg = await extractErrorMessage(r, `Não foi possível carregar os eventos de check-in.`);
      showErrorToast(msg);
      return;
    }
    const list = await r.json();
    if (currentView !== 'eventos-checkin') return;
    eventosCheckin = list || [];
    pruneSelectedEventoCheckinIds();
    renderEventosCheckin();
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    showErrorToast(e.message || 'Erro ao carregar eventos de check-in.');
  } finally { setViewLoading('eventos-checkin', false); }
}

async function downloadEventoCheckinQr(eventoId) {
  const id = (eventoId || '').trim();
  if (!id) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin/${encodeURIComponent(id)}/qr.png`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha ao gerar QR code.');
    const blob = await r.blob();
    const ev = eventosCheckin.find((e) => String(e._id) === id);
    const label = (ev?.label || 'checkin').replace(/[^\w\-]+/g, '-').slice(0, 40) || 'checkin';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `checkin-qr-${label}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message || 'Erro ao baixar QR code.');
  }
}

async function enviarEmailAberturaEvento(eventoId) {
  const id = (eventoId || '').trim();
  if (!id) return;
  const ev = eventosCheckin.find((e) => String(e._id) === id);
  const label = ev?.label || 'este evento';
  const force = !!ev?.emailAberturaEnviadoEm;
  const msg = force
    ? `Reenviar email de abertura do check-in para todos os voluntários de "${label}"?`
    : `Enviar email de abertura (com link e QR code) para todos os voluntários de "${label}"?`;
  if (!confirm(msg)) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin/${encodeURIComponent(id)}/enviar-email-abertura`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409) {
      if (confirm((data.error || 'Email já enviado.') + '\n\nDeseja reenviar mesmo assim?')) {
        const r2 = await authFetch(`${API_BASE}/api/eventos-checkin/${encodeURIComponent(id)}/enviar-email-abertura`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true }),
        });
        const d2 = await r2.json().catch(() => ({}));
        if (!r2.ok) throw new Error(d2.error || 'Falha ao reenviar.');
        if (d2.started) {
          alert(`Envio iniciado! ${d2.total || 0} email(s) serão enviados em segundo plano (pode levar alguns minutos).`);
        } else {
          alert(`${d2.sent || 0} email(s) enviado(s) de ${d2.total || 0}.`);
        }
        await fetchEventosCheckin();
        return;
      }
      return;
    }
    if (!r.ok) throw new Error(data.error || 'Falha ao enviar emails.');
    if (data.started) {
      alert(`Envio iniciado! ${data.total || 0} email(s) serão enviados em segundo plano (pode levar alguns minutos).`);
      await fetchEventosCheckin();
      return;
    }
    alert(`${data.sent || 0} email(s) enviado(s) de ${data.total || 0}.`);
    await fetchEventosCheckin();
  } catch (e) {
    alert(e.message || 'Erro ao enviar emails de abertura.');
  }
}

let cultosRecorrentesList = [];
let cultosRecorrentesDias = [];

function diaSemanaLabel(n) {
  const d = cultosRecorrentesDias.find((x) => x.value === n);
  return d ? d.label : String(n);
}

function formatHorarioCheckinJanela(c) {
  const a = (c.horarioCheckinInicio || '').trim();
  const b = (c.horarioCheckinFim || '').trim();
  if (!a && !b) return 'Dia inteiro';
  if (a && b) return `${a} – ${b}`;
  return a || b;
}

async function fetchCultosRecorrentes() {
  if (!authToken) { updateAuthUi(); return; }
  const tbody = document.getElementById('cultosRecorrentesBody');
  const tzHint = document.getElementById('cultosRecorrentesTzHint');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8"><p class="auth-subtitle">Carregando…</p></td></tr>';
  try {
    const [rMeta, rList] = await Promise.all([
      authFetch(`${API_BASE}/api/cultos-recorrentes/meta`),
      authFetch(`${API_BASE}/api/cultos-recorrentes?_t=${Date.now()}`),
    ]);
    if (rMeta.ok) {
      const meta = await rMeta.json();
      cultosRecorrentesDias = meta.diasSemana || [];
      if (tzHint) tzHint.textContent = `Fuso: ${meta.timezone || TZ_BRASILIA}. Cultos e check-ins usam o calendário de Brasília.`;
    }
    if (!rList.ok) {
      const err = (await rList.json().catch(() => ({}))).error || `Erro ${rList.status}`;
      if (tbody) {
        const hint = rList.status === 503
          ? `${escapeHtml(err)} <br><small>Confirme no Railway: <code>DB_PROVIDER=postgres</code> e <code>DATABASE_URL</code> configurados.</small>`
          : escapeHtml(err);
        tbody.innerHTML = `<tr><td colspan="8"><p class="auth-subtitle">${hint}</p></td></tr>`;
      }
      return;
    }
    cultosRecorrentesList = await rList.json();
    if (currentView !== 'cultos-recorrentes') return;
    if (!tbody) return;
    if (!cultosRecorrentesList.length) {
      tbody.innerHTML = '<tr><td colspan="8"><p class="auth-subtitle">Nenhum culto recorrente. Clique em “Novo culto recorrente”.</p></td></tr>';
      return;
    }
    tbody.innerHTML = cultosRecorrentesList.map((c) => `
      <tr>
        <td>${escapeHtml(c.nome)}</td>
        <td>${escapeHtml(diaSemanaLabel(c.diaSemana))}</td>
        <td>${escapeHtml(c.horario || '')}</td>
        <td>${escapeHtml(formatHorarioCheckinJanela(c))}</td>
        <td>${escapeHtml(String(c.semanasAFrente || 8))}</td>
        <td>${escapeHtml(String(c.totalOcorrencias || 0))}</td>
        <td>${c.ativo ? '<span class="escala-badge escala-badge-aprovado">Ativo</span>' : '<span class="escala-badge escala-badge-falta">Inativo</span>'}</td>
        <td>
          <button type="button" class="btn btn-ghost btn-sm" data-culto-edit="${escapeAttr(c._id)}">Editar</button>
          <button type="button" class="btn btn-ghost btn-sm" data-culto-delete="${escapeAttr(c._id)}">Excluir</button>
        </td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-culto-edit]').forEach((btn) => {
      btn.addEventListener('click', () => openModalCultoRecorrente(btn.getAttribute('data-culto-edit')));
    });
    tbody.querySelectorAll('[data-culto-delete]').forEach((btn) => {
      btn.addEventListener('click', () => excluirCultoRecorrente(btn.getAttribute('data-culto-delete')));
    });
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    if (tbody) tbody.innerHTML = `<tr><td colspan="8"><p class="auth-subtitle">Erro: ${escapeHtml(e.message || 'rede')}</p></td></tr>`;
  } finally {
    setViewLoading('cultos-recorrentes', false);
  }
}

function fillCultoRecorrenteDiaSelect() {
  const sel = document.getElementById('cultoRecorrenteDia');
  if (!sel) return;
  const dias = cultosRecorrentesDias.length ? cultosRecorrentesDias : CULTOS_DIAS_SEMANA_DEFAULT;
  sel.innerHTML = dias.map((d) => `<option value="${d.value}">${escapeHtml(d.label)}</option>`).join('');
}

function openModalCultoRecorrente(id) {
  const modal = document.getElementById('modalCultoRecorrente');
  if (!modal) {
    showToast('Formulário de culto recorrente não encontrado. Atualize a página (Ctrl+F5).', 'error');
    return;
  }
  ensureModalPortal(modal);
  const title = document.getElementById('modalCultoRecorrenteTitle');
  fillCultoRecorrenteDiaSelect();
  const culto = id ? cultosRecorrentesList.find((c) => String(c._id) === String(id)) : null;
  document.getElementById('cultoRecorrenteId').value = culto?._id || '';
  document.getElementById('cultoRecorrenteNome').value = culto?.nome || '';
  document.getElementById('cultoRecorrenteDia').value = culto != null ? String(culto.diaSemana) : '0';
  document.getElementById('cultoRecorrenteHorario').value = culto?.horario || '10:00';
  document.getElementById('cultoRecorrenteCheckinInicio').value = culto?.horarioCheckinInicio || '';
  document.getElementById('cultoRecorrenteCheckinFim').value = culto?.horarioCheckinFim || '';
  document.getElementById('cultoRecorrenteSemanas').value = culto?.semanasAFrente || 8;
  document.getElementById('cultoRecorrenteGerarEscala').checked = culto ? culto.gerarEscala !== false : true;
  document.getElementById('cultoRecorrenteGerarCheckin').checked = culto ? culto.gerarCheckin !== false : true;
  document.getElementById('cultoRecorrenteAtivo').checked = culto ? culto.ativo !== false : true;
  if (title) title.textContent = culto ? 'Editar culto recorrente' : 'Novo culto recorrente';
  if (modal) { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
}

function closeModalCultoRecorrente() {
  const modal = document.getElementById('modalCultoRecorrente');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

async function excluirCultoRecorrente(id) {
  const c = cultosRecorrentesList.find((x) => String(x._id) === String(id));
  if (!c || !confirm(`Excluir "${c.nome}"? Ocorrências já geradas permanecem em Escalas e Eventos check-in.`)) return;
  try {
    const r = await authFetch(`${API_BASE}/api/cultos-recorrentes/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    fetchCultosRecorrentes();
  } catch (e) { alert(e.message || 'Erro ao excluir.'); }
}

async function syncAllCultosRecorrentes() {
  try {
    const r = await authFetch(`${API_BASE}/api/cultos-recorrentes/sync`, { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Falha na sincronização');
    alert(`Sincronizado: ${data.criadas || 0} nova(s) ocorrência(s).`);
    fetchCultosRecorrentes();
  } catch (e) { alert(e.message || 'Erro ao sincronizar.'); }
}

async function excluirEventoCheckin(eventoId) {
  await excluirEventosCheckinPorIds([eventoId]);
}

function normalizeExcluirEventoCheckinIds(input) {
  const arr = Array.isArray(input) ? input : [input];
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
}

function labelEventoCheckinResumo(id) {
  const evento = (eventosCheckin || []).find((e) => String(e._id) === String(id));
  if (!evento) return 'evento';
  const d = evento.data ? new Date(evento.data) : null;
  return (evento.label || (d ? d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '')).replace(/"/g, '') || 'evento';
}

async function excluirEventosCheckinSelecionados() {
  const ids = [...selectedEventoCheckinIds];
  if (!ids.length) {
    alert('Selecione ao menos um evento.');
    return;
  }
  await excluirEventosCheckinPorIds(ids);
}

async function excluirEventosCheckinPorIds(input) {
  const ids = normalizeExcluirEventoCheckinIds(input);
  if (!ids.length || !authToken) return;
  const label = ids.length === 1
    ? `"${labelEventoCheckinResumo(ids[0])}"`
    : `${ids.length} eventos`;
  const extra = '\n\nCheck-ins registrados permanecem no histórico, mas ficam sem evento vinculado.';
  if (!confirm(`Excluir ${label}? Esta ação não pode ser desfeita.${extra}`)) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Falha ao excluir.');
    ids.forEach((id) => selectedEventoCheckinIds.delete(id));
    updateEventosCheckinSelectionUi();
    fetchEventosCheckin();
    if (data.deleted > 1) showToast(`${data.deleted} eventos excluídos.`);
  } catch (err) {
    alert(err.message || 'Erro ao excluir evento(s).');
  }
}

function openModalEditarEvento(eventoId) {
  const evento = (eventosCheckin || []).find(e => String(e._id) === String(eventoId));
  if (!evento) return;
  const modal = document.getElementById('modalEditarEvento');
  const idEl = document.getElementById('editarEventoId');
  const dataEl = document.getElementById('editarEventoData');
  const labelEl = document.getElementById('editarEventoLabel');
  const hinEl = document.getElementById('editarEventoHorarioInicio');
  const hfiEl = document.getElementById('editarEventoHorarioFim');
  const ativoEl = document.getElementById('editarEventoAtivo');
  if (idEl) idEl.value = String(evento._id || '');
  if (dataEl) dataEl.value = escalaDataToYMD(evento.data) || '';
  if (labelEl) labelEl.value = (evento.label || '').trim();
  if (hinEl) hinEl.value = (evento.horarioInicio || '').trim();
  if (hfiEl) hfiEl.value = (evento.horarioFim || '').trim();
  if (ativoEl) ativoEl.checked = evento.ativo !== false;
  if (modal) {
    ensureModalPortal(modal);
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');
  }
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

function getFormularioMembroLinkUrl() {
  const base = window.location.origin + window.location.pathname;
  const ig = encodeURIComponent(getTenantSlugForLinks());
  return `${base.replace(/\/$/, '')}?igreja=${ig}#formulario-membro`;
}

function getFormularioConsolidacaoLinkUrl() {
  const base = window.location.origin + window.location.pathname;
  const ig = encodeURIComponent(getTenantSlugForLinks());
  return `${base.replace(/\/$/, '')}?igreja=${ig}#formulario-consolidacao`;
}

/** Abre o modal de e-mail (mesmo da aba Voluntários) com destinatários deduplicados por e-mail. */
function openEmailModalFromRecipients(recipients) {
  const seen = new Map();
  (Array.isArray(recipients) ? recipients : []).forEach(({ email, nome }) => {
    const em = String(email || '').trim().toLowerCase();
    if (!em.includes('@')) return;
    const n = String(nome || '').trim();
    if (!seen.has(em)) seen.set(em, n);
  });
  const list = [...seen.entries()].map(([email, nome]) => ({ email, nome }));
  if (!list.length) {
    alert('Nenhum e-mail válido nas inscrições deste evento.');
    return;
  }
  selectedEmails.clear();
  emailExtraRecipientNames = {};
  list.forEach(({ email, nome }) => {
    selectedEmails.add(email);
    if (nome) emailExtraRecipientNames[email] = nome;
  });
  openModal();
}

async function openEmailModalForBatismoEvento(eventoId) {
  if (!eventoId || !authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/formularios/batismo/${encodeURIComponent(eventoId)}?_t=${Date.now()}`);
    const list = r.ok ? (await r.json().catch(() => [])) : [];
    const recipients = (Array.isArray(list) ? list : []).map((row) => ({
      email: row.email,
      nome: row.nomeCompleto,
    }));
    openEmailModalFromRecipients(recipients);
  } catch (_) {
    alert('Não foi possível carregar as inscrições de batismo.');
  }
}

async function openEmailModalForApresentacaoEvento(eventoId) {
  if (!eventoId || !authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/formularios/apresentacao/${encodeURIComponent(eventoId)}?_t=${Date.now()}`);
    const list = r.ok ? (await r.json().catch(() => [])) : [];
    const recipients = (Array.isArray(list) ? list : []).map((row) => {
      const parts = [row.nomeMae, row.nomePai].map((x) => String(x || '').trim()).filter(Boolean);
      return { email: row.emailContato, nome: parts.length ? parts.join(' e ') : 'Responsável' };
    });
    openEmailModalFromRecipients(recipients);
  } catch (_) {
    alert('Não foi possível carregar as inscrições de apresentação.');
  }
}

function resolveNomeForSendEmail(email) {
  const em = (email || '').toLowerCase().trim();
  const volList = Array.isArray(voluntarios) ? voluntarios : [];
  const voluntariosByEmail = new Map(volList.map((v) => [(v.email || '').toLowerCase(), v]));
  const v = voluntariosByEmail.get(em);
  if (v?.nome) return v.nome;
  if (emailExtraRecipientNames[em]) return emailExtraRecipientNames[em];
  return '';
}

async function openEmailModalForNovoMembroEvento(eventoId) {
  if (!eventoId || !authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/formularios/novo-membro/${encodeURIComponent(eventoId)}?_t=${Date.now()}`);
    const list = r.ok ? (await r.json().catch(() => [])) : [];
    const recipients = (Array.isArray(list) ? list : []).map((row) => ({
      email: row.email,
      nome: row.nomeCompleto,
    }));
    openEmailModalFromRecipients(recipients);
  } catch (_) {
    alert('Não foi possível carregar as inscrições de novos membros.');
  }
}

async function fetchFormularios() {
  if (!authToken) return;
  try {
    const [rNovoMembro, rBatismo, rApres, rCons] = await Promise.all([
      authFetch(`${API_BASE}/api/eventos-formulario?tipo=novo_membro&_t=${Date.now()}`),
      authFetch(`${API_BASE}/api/eventos-formulario?tipo=batismo&_t=${Date.now()}`),
      authFetch(`${API_BASE}/api/eventos-formulario?tipo=apresentacao&_t=${Date.now()}`),
      authFetch(`${API_BASE}/api/formularios/consolidacao?_t=${Date.now()}`),
    ]);
    if (currentView !== 'formularios') return;
    const responses = [
      { r: rNovoMembro, name: 'eventos de novos membros' },
      { r: rBatismo, name: 'eventos de batismo' },
      { r: rApres, name: 'eventos de apresentação' },
      { r: rCons, name: 'formulários de consolidação' },
    ];
    for (const { r, name } of responses) {
      if (r && !r.ok && r.status >= 500) {
        const msg = await extractErrorMessage(r, `Erro ao carregar ${name}.`);
        showErrorToast(msg);
      }
    }
    eventosNovoMembro = rNovoMembro.ok ? (await rNovoMembro.json()) || [] : [];
    eventosBatismo = rBatismo.ok ? (await rBatismo.json()) || [] : [];
    eventosApresentacao = rApres.ok ? (await rApres.json()) || [] : [];
    const consList = rCons?.ok ? (await rCons.json()) || [] : [];
    const totalCons = Array.isArray(consList) ? consList.length : 0;
    const countNovoMembro = document.getElementById('eventosNovoMembroCount');
    const countBatismo = document.getElementById('eventosBatismoCount');
    const countApres = document.getElementById('eventosApresentacaoCount');
    if (countNovoMembro) countNovoMembro.textContent = `(${eventosNovoMembro.length})`;
    if (countBatismo) countBatismo.textContent = `(${eventosBatismo.length})`;
    if (countApres) countApres.textContent = `(${eventosApresentacao.length})`;
    const totalConsEl = document.getElementById('formulariosConsolidacaoCount');
    if (totalConsEl) totalConsEl.textContent = `(${totalCons})`;
    const totalNovoMembroEl = document.getElementById('formulariosNovoMembroTotalCount');
    const totalBatismoEl = document.getElementById('formulariosBatismoTotalCount');
    const totalApresEl = document.getElementById('formulariosApresentacaoTotalCount');

    const filledNovoMembroById = new Map();
    const filledBatismoById = new Map();
    const filledApresById = new Map();
    let totalFilledNovoMembro = 0;
    let totalFilledBatismo = 0;
    let totalFilledApres = 0;

    const novoMembroCountPromises = (eventosNovoMembro || []).map(async (e) => {
      const id = e?._id;
      if (!id) return;
      try {
        const rr = await authFetch(`${API_BASE}/api/formularios/novo-membro/${encodeURIComponent(String(id))}?_t=${Date.now()}`);
        if (!rr.ok) return;
        const list = await rr.json().catch(() => []);
        const qtd = Array.isArray(list) ? list.length : 0;
        filledNovoMembroById.set(String(id), qtd);
        totalFilledNovoMembro += qtd;
      } catch (_) {}
    });
    const batismoCountPromises = (eventosBatismo || []).map(async (e) => {
      const id = e?._id;
      if (!id) return;
      try {
        const rr = await authFetch(`${API_BASE}/api/formularios/batismo/${encodeURIComponent(String(id))}?_t=${Date.now()}`);
        if (!rr.ok) return;
        const list = await rr.json().catch(() => []);
        const qtd = Array.isArray(list) ? list.length : 0;
        filledBatismoById.set(String(id), qtd);
        totalFilledBatismo += qtd;
      } catch (_) {}
    });
    const apresCountPromises = (eventosApresentacao || []).map(async (e) => {
      const id = e?._id;
      if (!id) return;
      try {
        const rr = await authFetch(`${API_BASE}/api/formularios/apresentacao/${encodeURIComponent(String(id))}?_t=${Date.now()}`);
        if (!rr.ok) return;
        const list = await rr.json().catch(() => []);
        const qtd = Array.isArray(list) ? list.length : 0;
        filledApresById.set(String(id), qtd);
        totalFilledApres += qtd;
      } catch (_) {}
    });
    await Promise.all([...novoMembroCountPromises, ...batismoCountPromises, ...apresCountPromises]);

    if (totalNovoMembroEl) totalNovoMembroEl.textContent = `(${totalFilledNovoMembro})`;
    if (totalBatismoEl) totalBatismoEl.textContent = `(${totalFilledBatismo})`;
    if (totalApresEl) totalApresEl.textContent = `(${totalFilledApres})`;

    const formularioConsolidacaoLinkInput = document.getElementById('formularioConsolidacaoLinkInput');
    if (formularioConsolidacaoLinkInput) formularioConsolidacaoLinkInput.value = getFormularioConsolidacaoLinkUrl();

    if (eventosNovoMembroBody) {
      if (!eventosNovoMembro.length) {
        eventosNovoMembroBody.innerHTML = '<tr><td colspan="7">Nenhum evento. Clique em "Novo evento de novos membros" para criar.</td></tr>';
      } else {
        eventosNovoMembroBody.innerHTML = eventosNovoMembro.map(e => {
          const eventId = (e._id != null ? String(e._id) : '');
          const d = new Date(e.data);
          const label = e.label || d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA });
          const ativo = e.ativo !== false;
          const statusText = ativo ? 'Inscrições abertas' : 'Inscrições fechadas';
          const filled = filledNovoMembroById.get(eventId) || 0;
          return `<tr data-event-id="${escapeAttr(eventId)}">
            <td>${d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })}</td>
            <td>${escapeHtml(label)}</td>
            <td><span class="evento-status ${ativo ? 'evento-status-ativo' : 'evento-status-inativo'}">${statusText}</span></td>
            <td>${filled}</td>
            <td><button type="button" class="btn btn-sm btn-primary" data-form-link="novo-membro" data-event-id="${escapeAttr(eventId)}" title="Copiar link">Copiar link</button></td>
            <td><button type="button" class="btn btn-sm btn-ghost" data-form-email-novo-membro="${escapeAttr(eventId)}" title="Enviar e-mail às pessoas que preencheram este evento" ${filled ? '' : 'disabled'}>✉️ E-mail</button></td>
            <td>
              <button type="button" class="btn btn-sm btn-ghost" data-export-novo-membro-csv="${escapeAttr(eventId)}" data-export-novo-membro-label="${escapeAttr(label)}" title="Baixar CSV só deste evento">Baixar CSV</button>
              <button type="button" class="btn btn-sm ${ativo ? 'btn-ghost' : 'btn-primary'}" data-form-toggle-formulario-ativo="${escapeAttr(eventId)}" data-ativo="${ativo ? 'true' : 'false'}" title="${ativo ? 'O link público deixa de aceitar novas inscrições' : 'Permitir novas inscrições pelo link'}">${ativo ? 'Fechar inscrições' : 'Reabrir inscrições'}</button>
              <button type="button" class="btn btn-sm btn-ghost" data-form-delete="novo-membro" data-event-id="${escapeAttr(eventId)}" title="Excluir evento">Excluir</button>
            </td>
          </tr>`;
        }).join('');
        eventosNovoMembroBody.querySelectorAll('[data-export-novo-membro-csv]').forEach((btn) => {
          btn.addEventListener('click', () => exportFormularioNovoMembroCsvForEvent(
            btn.getAttribute('data-export-novo-membro-csv'),
            btn.getAttribute('data-export-novo-membro-label') || '',
          ));
        });
        eventosNovoMembroBody.querySelectorAll('[data-form-link="novo-membro"]').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-event-id');
            const ig = encodeURIComponent(getTenantSlugForLinks());
            const base = `${window.location.origin}${window.location.pathname.replace(/\/$/, '') || ''}`;
            const url = `${base}?novo-membro=${encodeURIComponent(id)}&igreja=${ig}`;
            navigator.clipboard.writeText(url).then(() => alert('Link copiado!')).catch(() => prompt('Copie o link:', url));
          });
        });
        eventosNovoMembroBody.querySelectorAll('[data-form-email-novo-membro]').forEach((btn) => {
          btn.addEventListener('click', () => openEmailModalForNovoMembroEvento(btn.getAttribute('data-form-email-novo-membro')));
        });
        eventosNovoMembroBody.querySelectorAll('[data-form-toggle-formulario-ativo]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-form-toggle-formulario-ativo');
            const ativo = btn.getAttribute('data-ativo') === 'true';
            toggleFormularioEventoAtivo(id, ativo);
          });
        });
        eventosNovoMembroBody.querySelectorAll('[data-form-delete="novo-membro"]').forEach(btn => {
          btn.addEventListener('click', () => excluirEventoFormulario(btn.getAttribute('data-event-id'), 'novo_membro'));
        });
      }
    }

    if (eventosBatismoBody) {
      if (!eventosBatismo.length) {
        eventosBatismoBody.innerHTML = '<tr><td colspan="7">Nenhum evento. Clique em "Novo evento de batismo" para criar.</td></tr>';
      } else {
        eventosBatismoBody.innerHTML = eventosBatismo.map(e => {
          const eventId = (e._id != null ? String(e._id) : '');
          const d = new Date(e.data);
          const label = e.label || d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA });
          const ativo = e.ativo !== false;
          const statusText = ativo ? 'Inscrições abertas' : 'Inscrições fechadas';
          const filled = filledBatismoById.get(eventId) || 0;
          return `<tr data-event-id="${escapeAttr(eventId)}">
            <td>${d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })}</td>
            <td>${escapeHtml(label)}</td>
            <td><span class="evento-status ${ativo ? 'evento-status-ativo' : 'evento-status-inativo'}">${statusText}</span></td>
            <td>${filled}</td>
            <td><button type="button" class="btn btn-sm btn-primary" data-form-link="batismo" data-event-id="${escapeAttr(eventId)}" title="Copiar link">Copiar link</button></td>
            <td><button type="button" class="btn btn-sm btn-ghost" data-form-email-batismo="${escapeAttr(eventId)}" title="Enviar e-mail às pessoas que preencheram este evento" ${filled ? '' : 'disabled'}>✉️ E-mail</button></td>
            <td>
              <button type="button" class="btn btn-sm btn-ghost" data-export-batismo-csv="${escapeAttr(eventId)}" data-export-batismo-label="${escapeAttr(label)}" title="Baixar CSV só deste evento">Baixar CSV</button>
              <button type="button" class="btn btn-sm ${ativo ? 'btn-ghost' : 'btn-primary'}" data-form-toggle-formulario-ativo="${escapeAttr(eventId)}" data-ativo="${ativo ? 'true' : 'false'}" title="${ativo ? 'O link público deixa de aceitar novas inscrições' : 'Permitir novas inscrições pelo link'}">${ativo ? 'Fechar inscrições' : 'Reabrir inscrições'}</button>
              <button type="button" class="btn btn-sm btn-ghost" data-form-delete="batismo" data-event-id="${escapeAttr(eventId)}" title="Excluir evento">Excluir</button>
            </td>
          </tr>`;
        }).join('');
        eventosBatismoBody.querySelectorAll('[data-export-batismo-csv]').forEach((btn) => {
          btn.addEventListener('click', () => exportFormularioBatismoCsvForEvent(
            btn.getAttribute('data-export-batismo-csv'),
            btn.getAttribute('data-export-batismo-label') || '',
          ));
        });
        eventosBatismoBody.querySelectorAll('[data-form-link="batismo"]').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-event-id');
            const ig = encodeURIComponent(getTenantSlugForLinks());
            const base = `${window.location.origin}${window.location.pathname.replace(/\/$/, '') || ''}`;
            const url = `${base}?batismo=${encodeURIComponent(id)}&igreja=${ig}`;
            navigator.clipboard.writeText(url).then(() => alert('Link copiado!')).catch(() => prompt('Copie o link:', url));
          });
        });
        eventosBatismoBody.querySelectorAll('[data-form-email-batismo]').forEach((btn) => {
          btn.addEventListener('click', () => openEmailModalForBatismoEvento(btn.getAttribute('data-form-email-batismo')));
        });
        eventosBatismoBody.querySelectorAll('[data-form-toggle-formulario-ativo]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-form-toggle-formulario-ativo');
            const ativo = btn.getAttribute('data-ativo') === 'true';
            toggleFormularioEventoAtivo(id, ativo);
          });
        });
        eventosBatismoBody.querySelectorAll('[data-form-delete="batismo"]').forEach(btn => {
          btn.addEventListener('click', () => excluirEventoFormulario(btn.getAttribute('data-event-id'), 'batismo'));
        });
      }
    }
    if (eventosApresentacaoBody) {
      if (!eventosApresentacao.length) {
        eventosApresentacaoBody.innerHTML = '<tr><td colspan="7">Nenhum evento. Clique em "Novo evento de apresentação" para criar.</td></tr>';
      } else {
        eventosApresentacaoBody.innerHTML = eventosApresentacao.map(e => {
          const eventId = (e._id != null ? String(e._id) : '');
          const d = new Date(e.data);
          const label = e.label || d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA });
          const ativo = e.ativo !== false;
          const statusText = ativo ? 'Inscrições abertas' : 'Inscrições fechadas';
          const filled = filledApresById.get(eventId) || 0;
          return `<tr data-event-id="${escapeAttr(eventId)}">
            <td>${d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })}</td>
            <td>${escapeHtml(label)}</td>
            <td><span class="evento-status ${ativo ? 'evento-status-ativo' : 'evento-status-inativo'}">${statusText}</span></td>
            <td>${filled}</td>
            <td><button type="button" class="btn btn-sm btn-primary" data-form-link="apresentacao" data-event-id="${escapeAttr(eventId)}" title="Copiar link">Copiar link</button></td>
            <td><button type="button" class="btn btn-sm btn-ghost" data-form-email-apresentacao="${escapeAttr(eventId)}" title="Enviar e-mail aos responsáveis que preencheram este evento" ${filled ? '' : 'disabled'}>✉️ E-mail</button></td>
            <td>
              <button type="button" class="btn btn-sm btn-ghost" data-export-apresentacao-csv="${escapeAttr(eventId)}" data-export-apresentacao-label="${escapeAttr(label)}" title="Baixar CSV só deste evento">Baixar CSV</button>
              <button type="button" class="btn btn-sm ${ativo ? 'btn-ghost' : 'btn-primary'}" data-form-toggle-formulario-ativo="${escapeAttr(eventId)}" data-ativo="${ativo ? 'true' : 'false'}" title="${ativo ? 'O link público deixa de aceitar novas inscrições' : 'Permitir novas inscrições pelo link'}">${ativo ? 'Fechar inscrições' : 'Reabrir inscrições'}</button>
              <button type="button" class="btn btn-sm btn-ghost" data-form-delete="apresentacao" data-event-id="${escapeAttr(eventId)}" title="Excluir evento">Excluir</button>
            </td>
          </tr>`;
        }).join('');
        eventosApresentacaoBody.querySelectorAll('[data-export-apresentacao-csv]').forEach((btn) => {
          btn.addEventListener('click', () => exportFormularioApresentacaoCsvForEvent(
            btn.getAttribute('data-export-apresentacao-csv'),
            btn.getAttribute('data-export-apresentacao-label') || '',
          ));
        });
        eventosApresentacaoBody.querySelectorAll('[data-form-link="apresentacao"]').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-event-id');
            const ig = encodeURIComponent(getTenantSlugForLinks());
            const base = `${window.location.origin}${window.location.pathname.replace(/\/$/, '') || ''}`;
            const url = `${base}?apresentacao=${encodeURIComponent(id)}&igreja=${ig}`;
            navigator.clipboard.writeText(url).then(() => alert('Link copiado!')).catch(() => prompt('Copie o link:', url));
          });
        });
        eventosApresentacaoBody.querySelectorAll('[data-form-email-apresentacao]').forEach((btn) => {
          btn.addEventListener('click', () => openEmailModalForApresentacaoEvento(btn.getAttribute('data-form-email-apresentacao')));
        });
        eventosApresentacaoBody.querySelectorAll('[data-form-toggle-formulario-ativo]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-form-toggle-formulario-ativo');
            const ativo = btn.getAttribute('data-ativo') === 'true';
            toggleFormularioEventoAtivo(id, ativo);
          });
        });
        eventosApresentacaoBody.querySelectorAll('[data-form-delete="apresentacao"]').forEach(btn => {
          btn.addEventListener('click', () => excluirEventoFormulario(btn.getAttribute('data-event-id'), 'apresentacao'));
        });
      }
    }
  } catch (e) { if (e.message === 'AUTH_REQUIRED') return; }
  finally { setViewLoading('formularios', false); }
}

async function toggleFormularioEventoAtivo(eventoId, currentlyActive) {
  if (!eventoId || !authToken) return;
  const novoAtivo = !currentlyActive;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-formulario/${encodeURIComponent(eventoId)}/ativo`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: novoAtivo }),
    });
    const errData = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(errData.error || 'Falha ao atualizar.');
    await fetchFormularios();
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    alert(e.message || 'Erro ao fechar/reabrir inscrições.');
  }
}

async function excluirEventoFormulario(eventoId, tipo) {
  if (!eventoId || !authToken) return;
  const list = tipo === 'batismo' ? eventosBatismo : tipo === 'apresentacao' ? eventosApresentacao : eventosNovoMembro;
  const evento = list.find(e => String(e._id) === String(eventoId));
  const label = evento?.label || (evento?.data ? new Date(evento.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }) : '');
  if (!confirm(`Excluir o evento "${(label || '').replace(/"/g, '')}"?`)) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-formulario/${eventoId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    fetchFormularios();
  } catch (err) { alert(err.message || 'Erro ao excluir evento.'); }
}

/** Após check-in ou candidatura em escala (voluntário logado com o mesmo e-mail), oferece completar telefone/cidade/UF uma única vez. */
async function maybeOfferPerfilCheckinComplemento(done) {
  if (!authToken) {
    if (typeof done === 'function') done();
    return;
  }
  try {
    const r = await authFetch(`${API_BASE}/api/me/perfil-checkin-gap`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.needsComplement) {
      if (typeof done === 'function') done();
      return;
    }
    perfilComplementoPendingDone = typeof done === 'function' ? done : null;
    const tEl = document.getElementById('complementoCheckinTelefone');
    const wEl = document.getElementById('complementoCheckinWhatsapp');
    const cEl = document.getElementById('complementoCheckinCidade');
    const eEl = document.getElementById('complementoCheckinEstado');
    if (tEl) tEl.value = '';
    if (wEl) wEl.value = '';
    if (cEl) cEl.value = '';
    if (eEl) eEl.value = '';
    populateComplementoCheckinEstado();
    const m = document.getElementById('modalComplementoCheckin');
    if (m) {
      m.classList.add('open');
      m.setAttribute('aria-hidden', 'false');
    } else if (typeof done === 'function') {
      done();
    }
  } catch (e) {
    if (e.message !== 'AUTH_REQUIRED' && typeof done === 'function') done();
  }
}

function populateComplementoCheckinEstado() {
  const sel = document.getElementById('complementoCheckinEstado');
  if (!sel || sel.options.length > 1) return;
  sel.innerHTML = '<option value="">Selecione o estado (UF)</option>' + UFS_BR.map((uf) => `<option value="${escapeAttr(uf)}">${escapeHtml(uf)}</option>`).join('');
}

function closeModalComplementoCheckinUi() {
  const m = document.getElementById('modalComplementoCheckin');
  if (m) {
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
  }
}

function finishPerfilComplementoFlow() {
  const fn = perfilComplementoPendingDone;
  perfilComplementoPendingDone = null;
  closeModalComplementoCheckinUi();
  if (typeof fn === 'function') fn();
}

async function refreshCheckinBatizadoUi() {
  if (!authToken) return;
  const wrap = document.getElementById('confirmarBatizadoWrap');
  const sel = document.getElementById('confirmarBatizado');
  if (!wrap || !sel) return;
  try {
    const r = await authFetch(`${API_BASE}/api/me/perfil`);
    const p = await r.json().catch(() => ({}));
    if (!r.ok) {
      wrap.style.display = '';
      sel.removeAttribute('required');
      return;
    }
    const known = p.batizado === true || p.batizado === false;
    if (known) {
      wrap.style.display = 'none';
      sel.value = '';
      sel.removeAttribute('required');
    } else {
      wrap.style.display = '';
      sel.setAttribute('required', 'required');
    }
  } catch (_) {
    wrap.style.display = '';
    sel.removeAttribute('required');
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
    const abertos = list.filter((e) => e.checkinAberto !== false);
    if (eventosHojeList) {
      if (!abertos.length) {
        const hint = list.length
          ? 'Há evento(s) hoje, mas o check-in ainda não está na janela de horário ou foi encerrado.'
          : 'Nenhum evento de check-in para hoje. O administrador precisa criar/ativar o evento do culto.';
        eventosHojeList.innerHTML = '<p class="auth-subtitle">' + hint + '</p>';
        if (formConfirmarCheckin) formConfirmarCheckin.style.display = 'none';
        eventoSelecionadoHoje = null;
      } else {
        eventoSelecionadoHoje = abertos[0]._id;
        eventosHojeList.innerHTML = abertos.map(e => {
          const d = new Date(e.data);
          const label = e.label || d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA });
          const hin = (e.horarioInicio || '').trim();
          const hfi = (e.horarioFim || '').trim();
          const horarioTxt = (hin || hfi)
            ? '<br><small>Check-in: ' + escapeHtml(hin || '00:00') + ' – ' + escapeHtml(hfi || '23:59') + ' (Brasília)</small>'
            : '<br><small>Check-in disponível o dia todo (Brasília)</small>';
          return '<div class="kpi-card evento-hoje-card" style="margin-bottom:12px"><strong>' + escapeHtml(label) + '</strong>' + horarioTxt + '</div>';
        }).join('');
        if (formConfirmarCheckin) formConfirmarCheckin.style.display = 'block';
        if (confirmarMinisterio && confirmarMinisterio.options.length <= 1) {
          confirmarMinisterio.innerHTML = '<option value="">Selecione</option>' + MINISTERIOS_PADRAO.map(m => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('') + '<option value="Outro">Outro</option>';
        }
        await refreshCheckinBatizadoUi();
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
  const batizadoWrap = document.getElementById('confirmarBatizadoWrap');
  let batizado;
  if (batizadoWrap && batizadoWrap.style.display === 'none') {
    batizado = undefined;
  } else {
    batizado = (document.getElementById('confirmarBatizado')?.value || '').trim() || undefined;
  }
  if (!(batizadoWrap && batizadoWrap.style.display === 'none') && !batizado) {
    alert('Informe se você já é batizado.');
    return;
  }
  try {
    const r = await authFetch(`${API_BASE}/api/checkins/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventoId: eventoSelecionadoHoje, ministerio, batizado }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Falha ao confirmar');
    confirmarMinisterio.value = '';
    const confirmarBatizadoEl = document.getElementById('confirmarBatizado');
    if (confirmarBatizadoEl) confirmarBatizadoEl.value = '';
    await fetchMeusCheckins();
    await maybeOfferPerfilCheckinComplemento(() => {
      setView('meus-checkins');
      const msgEl = document.getElementById('checkinRecebidoMsg');
      if (msgEl) {
        msgEl.textContent = 'Check-in recebido!';
        msgEl.style.display = 'block';
        setTimeout(() => { msgEl.style.display = 'none'; }, 4000);
      }
    });
    await refreshCheckinBatizadoUi();
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

function ministeriosListFromVolApi(v) {
  if (!v) return [];
  if (Array.isArray(v.ministerios) && v.ministerios.length) {
    return [...new Set(v.ministerios.map((x) => String(x ?? '').trim()).filter(Boolean))];
  }
  return String(v.ministerio || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function voluntarioMinisteriosDisplay(v) {
  const a = ministeriosListFromVolApi(v);
  return a.length ? a.join(', ') : '';
}

function renderPerfilMinisteriosCheckboxes(selectedList) {
  const container = document.getElementById('perfilMinisterioGroup');
  if (!container) return;
  const sel = new Set((selectedList || []).map((s) => String(s).trim()).filter(Boolean));
  const padraoSet = new Set(MINISTERIOS_PADRAO);
  const extras = [...sel].filter((s) => !padraoSet.has(s));
  const outroVal = extras.join(', ');

  let html = MINISTERIOS_PADRAO.map((m) => {
    const checked = sel.has(m) ? ' checked' : '';
    return `<label class="checkbox-label" style="display:block;margin-bottom:6px;"><input type="checkbox" name="perfilMinisterioCb" value="${escapeAttr(m)}"${checked}> ${escapeHtml(m)}</label>`;
  }).join('');
  html += `<label class="checkbox-label" style="display:block;margin-bottom:6px;"><input type="checkbox" id="perfilMinisterioOutroCb"${outroVal ? ' checked' : ''}> Outro</label>`;
  container.innerHTML = html;

  const outroInput = document.getElementById('perfilMinisterioOutro');
  const outroCb = document.getElementById('perfilMinisterioOutroCb');
  if (outroInput && outroCb) {
    outroInput.value = outroVal;
    outroInput.style.display = outroCb.checked ? '' : 'none';
    outroCb.addEventListener('change', () => {
      outroInput.style.display = outroCb.checked ? '' : 'none';
      if (!outroCb.checked) outroInput.value = '';
    });
  }
}

function getPerfilMinisteriosFromForm() {
  const g = document.getElementById('perfilMinisterioGroup');
  if (!g) return [];
  const out = [];
  g.querySelectorAll('input[type="checkbox"][name="perfilMinisterioCb"]:checked').forEach((cb) => {
    const val = cb.value;
    if (val) out.push(val);
  });
  const outroCb = document.getElementById('perfilMinisterioOutroCb');
  const outroIn = document.getElementById('perfilMinisterioOutro');
  if (outroCb?.checked && outroIn) {
    outroIn.value.split(',').map((s) => s.trim()).filter(Boolean).forEach((x) => out.push(x));
  }
  return [...new Set(out)];
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
    if (!r.ok) {
      if (r.status >= 500) {
        const msg = await extractErrorMessage(r, 'Não foi possível carregar seu perfil.');
        showErrorToast(msg);
      }
      return;
    }
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
      renderPerfilMinisteriosCheckboxes(ministeriosListFromVolApi(perfil));
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
      renderPerfilMinisteriosCheckboxes([]);
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
    ministerios: getPerfilMinisteriosFromForm(),
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
    await maybeOfferPerfilCheckinComplemento(() => fetchPerfilExtras());
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
  await fetchVoluntarios({ showGlobalLoading: true });
  prefetchAllCheckinsForKpis();
}

let refreshChartsTimer = null;
/** Uma única chamada a getFilteredVoluntarios e atualiza KPIs, gráficos, tabela e contadores. */
function refreshVoluntariosView() {
  const filtered = getFilteredVoluntarios();
  updateKpis(filtered);
  if (refreshChartsTimer) clearTimeout(refreshChartsTimer);
  refreshChartsTimer = setTimeout(() => renderCharts(filtered), 180);
  renderTable(filtered);
  updateSelectedCount();
  syncSelectAll();
  updateFilterUi();
}

function render() {
  updateFilters();
  const filtered = getFilteredVoluntarios();
  updateKpis(filtered);
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

  const ministerioSet = new Set();
  filtered.forEach(v => {
    if (v._soCheckin) return;
    ministeriosListFromVolApi(v).forEach((m) => {
      if (m) ministerioSet.add(m);
    });
  });
  const ministeriosDistintos = ministerioSet.size;

  const sel = selectedEmails.size;
  const elTotal = document.getElementById('kpiTotal');
  const elAreas = document.getElementById('kpiAreas');
  const elSelected = document.getElementById('kpiSelected');
  const elComCheckin = document.getElementById('kpiComCheckin');
  const elSemCheckin = document.getElementById('kpiSemCheckin');
  const elSoCheckin = document.getElementById('kpiSoCheckin');
  const elTotalGeral = document.getElementById('kpiTotalGeral');
  if (elTotal) elTotal.textContent = total;
  if (elAreas) elAreas.textContent = ministeriosDistintos;
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

async function renderCharts(filteredInput) {
  try {
    await ensureChartJs();
  } catch (_) {
    return;
  }
  const filtered = filteredInput !== undefined ? filteredInput : getFilteredVoluntarios();
  const ministeriosData = countByMultiValueField(filtered, 'ministerio');
  const dispData = countByMultiValueField(filtered, 'disponibilidade');
  const estadoData = countByField(filtered, 'estado');
  const cidadeData = countByField(filtered, 'cidade');

  const ctxAreas = document.getElementById('areasChart');
  if (ctxAreas) {
    if (areasChart) areasChart.destroy();
    const topMin = ministeriosData.slice(0, 12).map(([label, value]) => ({
      label,
      short: truncate(label, 25),
      value,
    }));
    areasChart = new Chart(ctxAreas, {
      type: 'bar',
      data: {
        labels: topMin.map(a => a.short),
        datasets: [{
          label: 'Voluntários',
          data: topMin.map(a => a.value),
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
          const label = topMin[el.index]?.label;
          toggleFilter('ministerio', label);
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
        onClick: (_, elements) => {
          const el = elements?.[0];
          if (!el) return;
          const label = topCidades[el.index]?.label;
          toggleFilter('cidade', label);
        },
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
  const list = (Array.isArray(allCheckins) && allCheckins.length)
    ? allCheckins
    : (Array.isArray(checkins) ? checkins : []);
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
    ministerio: c.ministerio || '',
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
      const minList = ministeriosListFromVolApi(v);
      const minBlob = minList.join(' ').toLowerCase();
      const matchText =
        (v.nome || '').toLowerCase().includes(q) ||
        (v.email || '').toLowerCase().includes(q) ||
        (v.cidade || '').toLowerCase().includes(q) ||
        minBlob.includes(q) ||
        String(v.ministerio || '').toLowerCase().includes(q);
      if (!matchText) return false;
    }
    if (filters.ministerio) {
      const want = String(filters.ministerio).trim();
      const mins = ministeriosListFromVolApi(v).map((x) => String(x).trim());
      if (!mins.includes(want)) return false;
    }
    if (filters.disponibilidade) {
      const disp = (v.disponibilidade || '').split(',').map(d => d.trim());
      const want = String(filters.disponibilidade).trim();
      if (!disp.includes(want)) return false;
    }
    if (filters.estado) {
      const estado = String(v.estado || '').trim();
      if (estado !== String(filters.estado).trim()) return false;
    }
    if (filters.cidade) {
      const cidade = String(v.cidade || '').trim();
      if (cidade !== String(filters.cidade).trim()) return false;
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
    const origemBadge = v.fonte === 'checkin'
      ? '<span title="Adicionado automaticamente após check-in" style="margin-left:6px;font-size:.7rem;background:#e0e7ff;color:#3730a3;border:1px solid #a5b4fc;padding:1px 6px;border-radius:6px;font-weight:600">via check-in</span>'
      : v.fonte === 'formulario_novo_membro'
        ? '<span title="Cadastrado pelo formulário de novos membros" style="margin-left:6px;font-size:.7rem;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;padding:1px 6px;border-radius:6px;font-weight:600">potencial voluntário</span>'
        : '';
    tr.innerHTML = `
      <td class="col-check"><input type="checkbox" class="row-check" data-email="${escapeAttr(email)}" ${checked ? 'checked' : ''}></td>
      <td class="cell-with-avatar"><span class="cell-avatar">${avatarHtml(v.fotoUrl, v.nome)}</span><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(v.nome || '—')}</button>${origemBadge}</td>
      <td><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(v.email || '')}</button></td>
      <td>${escapeHtml([v.cidade, v.estado].filter(Boolean).join(' / ') || '—')}</td>
      <td class="num-cell" title="Inscrições na escala (todas): ${Number(v.vezesEscalaInscricao) || 0}">${Number(v.vezesEscalaAprovado) || 0}</td>
      <td class="num-cell">${Number(v.vezesCheckin) || 0}</td>
      <td>${escapeHtml(truncate(voluntarioMinisteriosDisplay(v) || '—', 48))}</td>
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
        ${fieldRow('Ministérios (cadastro / check-in)', voluntarioMinisteriosDisplay(v) || null)}
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
        ${fieldRow('Ministérios (cadastro / check-in)', voluntarioMinisteriosDisplay(v) || null)}
        ${fieldRow('Batizado (nas águas)', v.batizado === true ? 'Sim' : v.batizado === false ? 'Não' : null)}
        ${fieldRow('Disponibilidade', v.disponibilidade)}
        ${fieldRow('Horas por semana', v.horasSemana)}
        ${areasStr.trim() ? fieldRow('Áreas de interesse (legado)', areasStr) : ''}
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
    if (filters.ministerio) params.set('ministerio', filters.ministerio);
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
  const ministerios = (countByMultiValueField(vol, 'ministerio') || []).map(([label]) => (label || '').trim()).filter(Boolean);
  const disp = (countByMultiValueField(vol, 'disponibilidade') || []).map(([label]) => String(label || '').trim()).filter(Boolean);
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
  populateSelect(filterMinisterio, ministerios, 'Todos os ministérios');
  const mWant = String(filters.ministerio || '').trim();
  if (mWant && !ministerios.some((x) => String(x).trim() === mWant)) filters.ministerio = '';
  populateSelect(filterDisp, disp, 'Todas as disponibilidades');
  const dWant = String(filters.disponibilidade || '').trim();
  if (dWant && !disp.some((x) => String(x).trim() === dWant)) filters.disponibilidade = '';
  populateSelect(filterEstado, estados, 'Todos os estados');
  const eWant = String(filters.estado || '').trim();
  if (eWant && !estados.some((x) => String(x).trim() === eWant)) filters.estado = '';
  populateSelect(filterCidade, cidades, 'Todas as cidades');
  const cWant = String(filters.cidade || '').trim();
  if (cWant && !cidades.some((x) => String(x).trim() === cWant)) filters.cidade = '';
  updateFilterUi();
}

function updateFilterUi() {
  if (filterDisp) filterDisp.value = filters.disponibilidade || '';
  if (filterEstado) filterEstado.value = filters.estado || '';
  if (filterCidade) filterCidade.value = filters.cidade || '';
  if (filterComCheckin) filterComCheckin.value = filters.comCheckin || '';
  if (filterMinisterio) filterMinisterio.value = filters.ministerio || '';
  if (!activeFilters) return;
  const comCheckinLabel = { com: 'Com check-in', sem: 'Sem check-in', 'so-checkin': 'Só check-in (sem cadastro)' }[filters.comCheckin] || '';
  const chips = [
    ['ministerio', 'Ministério', filters.ministerio],
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
      if (key === 'ministerio') {
        filters.ministerio = '';
        if (filterMinisterio) filterMinisterio.value = '';
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
    filters.ministerio = Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
  } else if (key === 'ministerio') {
    filters.ministerio = String(value || '').trim();
  } else {
    filters[key] = value || '';
  }
  voluntariosPageOffset = 0;
  refreshVoluntariosView();
}

function toggleFilter(key, value) {
  if (!value) return;
  if (key === 'ministerio' || key === 'area') {
    setFilter('ministerio', filters.ministerio === value ? '' : value);
  } else {
    setFilter(key, filters[key] === value ? '' : value);
  }
}

function clearFilters() {
  filters.ministerio = '';
  filters.disponibilidade = '';
  filters.estado = '';
  filters.cidade = '';
  filters.comCheckin = '';
  voluntariosPageOffset = 0;
  if (searchInput) searchInput.value = '';
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

function getCheckinTimestampMs(c) {
  if (c == null) return 0;
  if (c.timestampMs != null && Number.isFinite(Number(c.timestampMs))) return Number(c.timestampMs);
  if (c.dataCheckin) {
    const d = new Date(c.dataCheckin);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  if (c.timestamp) {
    const d = new Date(c.timestamp);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return 0;
}

function sortCheckinsList(list, order) {
  const arr = Array.isArray(list) ? [...list] : [];
  const sortKey = order || checkinSortOrder || 'date-desc';
  return arr.sort((a, b) => {
    if (sortKey === 'date-asc') return getCheckinTimestampMs(a) - getCheckinTimestampMs(b);
    if (sortKey === 'nome-asc') {
      return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' });
    }
    if (sortKey === 'ministerio-asc') {
      return String(a.ministerio || '').localeCompare(String(b.ministerio || ''), 'pt-BR', { sensitivity: 'base' });
    }
    return getCheckinTimestampMs(b) - getCheckinTimestampMs(a);
  });
}

function resetCheckinsListPage() {
  checkinsDisplayLimit = LIST_PAGE_SIZE;
}

function resetCheckinsMinisterioListPage() {
  checkinsMinisterioDisplayLimit = LIST_PAGE_SIZE;
}

function getFilteredCheckins() {
  const q = (checkinSearch?.value || '').trim().toLowerCase();
  const list = Array.isArray(checkins) ? checkins : [];
  const countMap = checkinFilters.qtdCheckins ? getCheckinCountByEmail() : null;
  const qtdTarget = checkinFilters.qtdCheckins ? parseInt(checkinFilters.qtdCheckins, 10) : 0;
  const filtered = list.filter(c => {
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
  return sortCheckinsList(filtered, checkinSortOrder);
}

function updateCheckinRangeAndMore(total, shown) {
  const rangeEl = document.getElementById('checkinRange');
  const btnMore = document.getElementById('btnVerMaisCheckins');
  if (!rangeEl) return;
  if (total <= LIST_PAGE_SIZE) {
    rangeEl.textContent = '';
    if (btnMore) btnMore.style.display = 'none';
    return;
  }
  rangeEl.textContent = shown < total ? ` — exibindo 1–${shown} de ${total}` : ` — exibindo todos os ${total}`;
  if (btnMore) btnMore.style.display = shown < total ? 'inline-block' : 'none';
}

function updateCheckinMinisterioRangeAndMore(total, shown) {
  const rangeEl = document.getElementById('checkinMinisterioRange');
  const btnMore = document.getElementById('btnVerMaisCheckinMinisterio');
  if (!rangeEl) return;
  if (total <= LIST_PAGE_SIZE) {
    rangeEl.textContent = '';
    if (btnMore) btnMore.style.display = 'none';
    return;
  }
  rangeEl.textContent = shown < total ? ` — exibindo 1–${shown} de ${total}` : ` — exibindo todos os ${total}`;
  if (btnMore) btnMore.style.display = shown < total ? 'inline-block' : 'none';
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
  resetCheckinsListPage();
  renderCheckins();
}

function clearCheckinFilters() {
  checkinFilters.ministerio = '';
  checkinFilters.qtdCheckins = '';
  if (checkinSearch) checkinSearch.value = '';
  if (checkinQtdCheckins) checkinQtdCheckins.value = '';
  resetCheckinsListPage();
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
  const shown = Math.min(checkinsDisplayLimit, total);
  const slice = list.slice(0, shown);
  slice.forEach(c => {
    const tr = document.createElement('tr');
    const email = (c.email || '').toLowerCase();
    const batizadoLabel = c.batizado === true ? 'Sim' : (c.batizado === false ? 'Não' : '—');
    tr.innerHTML = `
      <td class="cell-with-avatar"><span class="cell-avatar">${avatarHtml(c.fotoUrl, c.nome)}</span><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(c.nome || '—')}</button></td>
      <td><button type="button" class="link-voluntario" data-email="${escapeAttr(email)}" title="Ver perfil">${escapeHtml(c.email || '')}</button></td>
      <td>${escapeHtml(c.ministerio || '—')}</td>
      <td>${escapeHtml(batizadoLabel)}</td>
      <td>${escapeHtml(c.timestamp || '—')}</td>
    `;
    checkinBody.appendChild(tr);
  });
  checkinBody.querySelectorAll('.link-voluntario').forEach(btn => {
    btn.addEventListener('click', () => openPerfilVoluntario(btn.getAttribute('data-email')));
  });
  if (checkinCount) checkinCount.textContent = total;
  updateCheckinRangeAndMore(total, shown);
}

function exportCheckinsCsv() {
  const list = getFilteredCheckins();
  if (!list.length) {
    alert('Nenhum check-in para exportar. Ajuste os filtros.');
    return;
  }
  const header = ['Nome', 'Email', 'Ministério', 'Batizado', 'Data/Hora'];
  const rows = list.map((c) => {
    const nome = c.nome || '';
    const email = c.email || '';
    const ministerio = c.ministerio || '';
    const batizado = c.batizado === true ? 'Sim' : (c.batizado === false ? 'Não' : '');
    const dataHora = c.timestamp || '';
    return [nome, email, ministerio, batizado, dataHora].map(escapeCsv).join(',');
  });
  const csv = '\uFEFF' + header.map(escapeCsv).join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'checkins-filtrados.csv';
  a.click();
  URL.revokeObjectURL(a.href);
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

/** Criar escalas: carrega lista leve primeiro, depois contagens em background */
async function fetchEscalasCriar() {
  if (!authToken) { updateAuthUi(); return; }
  const container = document.getElementById('escalasCriarContent');
  if (container) container.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Carregando…</p></div>';
  try {
    const r = await authFetch(`${API_BASE}/api/escalas?light=1`);
    if (!r.ok) {
      escalasList = [];
      const errMsg = (await r.json().catch(() => ({}))).error || `Erro ${r.status}`;
      if (container) container.innerHTML = `<div class="filters-card"><p class="auth-subtitle">Erro: ${escapeHtml(errMsg)}. Tente novamente.</p></div>`;
      return;
    }
    const data = await r.json().catch(() => null);
    escalasList = sortByDataSmart(Array.isArray(data) ? data : [], 'data');
    pruneSelectedEscalaIds();
    renderEscalasCriar();
    authFetch(`${API_BASE}/api/escalas`).then(r2 => r2.ok ? r2.json() : null).then(full => {
      if (Array.isArray(full)) { escalasList = sortByDataSmart(full, 'data'); pruneSelectedEscalaIds(); renderEscalasCriar(); }
    }).catch(() => {});
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    escalasList = [];
    if (container) container.innerHTML = `<div class="filters-card"><p class="auth-subtitle">Erro: ${escapeHtml((e.message || 'Erro de rede').toString())}. Verifique a conexão.</p></div>`;
  }
}

/** Escala (candidatos): admin/lider carrega só escalas; voluntário carrega visão unificada de cultos */
async function fetchEscalas() {
  if (!authToken) { updateAuthUi(); return; }
  const container = document.getElementById('escalasContent');
  const isVol = String(authRole || '').toLowerCase() === 'voluntario';
  if (isVol) {
    if (container) container.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Carregando seus cultos…</p></div>';
    try {
      const r = await authFetch(`${API_BASE}/api/me/cultos`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
      const payload = await r.json().catch(() => ({}));
      renderMeusCultos(Array.isArray(payload?.itens) ? payload.itens : []);
    } catch (e) {
      if (e.message === 'AUTH_REQUIRED') return;
      if (container) container.innerHTML = `<div class="filters-card"><p class="auth-subtitle">${escapeHtml(e.message || 'Erro ao carregar')}. <button id="btnRetryMeusCultos" class="btn btn-ghost btn-sm">Tentar novamente</button></p></div>`;
      document.getElementById('btnRetryMeusCultos')?.addEventListener('click', () => fetchEscalas());
    }
    return;
  }
  if (container) container.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Carregando escalas…</p></div>';
  try {
    if (authRole === 'lider') await verifyAuth();
    const r = await authFetch(`${API_BASE}/api/escalas?light=1`);
    if (!r.ok) {
      escalasList = [];
      candidaturasAll = [];
      const errMsg = (await r.json().catch(() => ({}))).error || `Erro ${r.status}`;
      if (container) container.innerHTML = `<div class="filters-card"><p class="auth-subtitle">Erro ao carregar escalas: ${escapeHtml(errMsg)}. Tente novamente.</p></div>`;
      return;
    }
    const data = await r.json().catch(() => null);
    escalasList = sortByDataSmart(Array.isArray(data) ? data : [], 'data');
    candidaturasAll = [];
    renderEscalasCandidatos();
    if (escalasPreSelectId) {
      candidaturasAnaliseFilters = { ...candidaturasAnaliseFilters, escalaId: escalasPreSelectId };
      const sel = document.getElementById('analiseFilterEscala');
      if (sel) sel.value = escalasPreSelectId;
      escalasPreSelectId = null;
      fetchCandidaturasPorEscala(candidaturasAnaliseFilters.escalaId);
    }
    authFetch(`${API_BASE}/api/escalas`).then(r2 => r2.ok ? r2.json() : null).then(full => {
      if (Array.isArray(full)) {
        const prevEscalaId = candidaturasAnaliseFilters?.escalaId || document.getElementById('analiseFilterEscala')?.value;
        escalasList = sortByDataSmart(full, 'data');
        renderEscalasCandidatos();
        if (prevEscalaId) {
          const sel = document.getElementById('analiseFilterEscala');
          if (sel) { sel.value = prevEscalaId; candidaturasAnaliseFilters = { ...candidaturasAnaliseFilters, escalaId: prevEscalaId }; }
        }
      }
    }).catch(() => {});
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
  const datas = [...new Set(candidaturasAll.map((c) => escalaDataToYMD(c.escalaData)).filter(Boolean))].sort().reverse();
  const selMin = document.getElementById('analiseFilterMinisterio');
  const selData = document.getElementById('analiseFilterData');
  const valMin = selMin?.value || '';
  const valData = selData?.value || '';
  if (selMin) selMin.innerHTML = '<option value="">Todos</option>' + ministerios.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('');
  if (selData) selData.innerHTML = '<option value="">Todas</option>' + datas.map((d) => `<option value="${escapeAttr(d)}">${formatEscalaDateOnly(d)}</option>`).join('');
  if (selMin && valMin && ministerios.includes(valMin)) selMin.value = valMin;
  if (selData && valData && datas.includes(valData)) selData.value = valData;
}

/** Lazy: busca candidaturas de uma escala específica (mais leve que candidaturas-all) */
async function fetchCandidaturasPorEscala(escalaId) {
  if (!authToken || !(escalaId || '').trim()) return;
  escalaId = String(escalaId).trim();
  const tbody = document.getElementById('escalasAnaliseBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="12"><p class="auth-subtitle" style="margin:16px 0">Carregando candidatos…</p></td></tr>';
  try {
    const r = await authFetch(`${API_BASE}/api/escalas/${encodeURIComponent(escalaId)}/candidaturas`);
    if (!r.ok) {
      candidaturasAll = [];
      const errData = await r.json().catch(() => ({}));
      const errMsg = errData?.error || `Erro ${r.status}`;
      if (tbody) tbody.innerHTML = `<tr><td colspan="12"><p class="auth-subtitle" style="margin:16px 0;color:var(--error-color,#c00)">${escapeHtml(errMsg)}</p></td></tr>`;
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
    if (tbody) tbody.innerHTML = `<tr><td colspan="12"><p class="auth-subtitle" style="margin:16px 0;color:var(--error-color,#c00)">${escapeHtml(msg)}</p></td></tr>`;
    renderAnaliseTab();
  }
}

/** Fase 4: acompanhamento da escala (escalados × presentes × faltaram × aguardando) */
async function fetchAcompanhamentoEscala(escalaId) {
  if (!authToken || !(escalaId || '').trim()) return;
  const wrap = document.getElementById('escalaAcompanhamento');
  if (!wrap) return;
  wrap.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Carregando acompanhamento…</p></div>';
  try {
    const r = await authFetch(`${API_BASE}/api/escalas/${encodeURIComponent(escalaId)}/acompanhamento`);
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      wrap.innerHTML = `<div class="filters-card"><p class="auth-subtitle">${escapeHtml(data.error || 'Não foi possível carregar o acompanhamento.')}</p></div>`;
      return;
    }
    const data = await r.json().catch(() => ({}));
    renderAcompanhamentoEscala(data);
  } catch (e) {
    if (e.message === 'AUTH_REQUIRED') return;
    wrap.innerHTML = `<div class="filters-card"><p class="auth-subtitle">Erro: ${escapeHtml(e.message || 'rede')}.</p></div>`;
  }
}

function renderAcompanhamentoEscala(data) {
  const wrap = document.getElementById('escalaAcompanhamento');
  if (!wrap) return;
  const totals = data?.totals || { aprovados: 0, presentes: 0, faltaram: 0, pendentes: 0 };
  const itens = Array.isArray(data?.itens) ? data.itens : [];
  if (!itens.length) {
    wrap.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Nenhuma inscrição nesta escala ainda.</p></div>';
    return;
  }
  const taxa = totals.aprovados > 0 ? Math.round((totals.presentes / totals.aprovados) * 100) : 0;
  const encerrado = !!data?.evento?.encerrado;

  // KPIs
  const kpi = (label, v, color, hint) => `
    <div style="background:#fff;border:1px solid var(--border-color);border-radius:10px;padding:14px 16px;min-width:120px;flex:1">
      <div style="font-size:.78rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">${escapeHtml(label)}</div>
      <div style="font-size:1.7rem;font-weight:700;color:${color};margin-top:4px">${v}</div>
      ${hint ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:4px">${escapeHtml(hint)}</div>` : ''}
    </div>`;

  const presencaBadge = (p) => {
    const m = {
      presente: ['#dcfce7', '#166534', '#86efac', 'Presente'],
      faltou:   ['#fee2e2', '#991b1b', '#fca5a5', 'Faltou'],
      aguardando: ['#fef3c7', '#92400e', '#fcd34d', 'Aguardando'],
      pendente: ['#e0e7ff', '#3730a3', '#a5b4fc', 'Pendente'],
    };
    const [bg, fg, bd, label] = m[p] || m.pendente;
    return `<span class="status-badge" style="background:${bg};color:${fg};border:1px solid ${bd}">${label}</span>`;
  };

  const rows = itens.map((it) => {
    const data = it.inscritoEm ? new Date(it.inscritoEm).toLocaleDateString('pt-BR') : '—';
    const hora = it.checkinTimestamp ? new Date(it.checkinTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    return `<tr>
      <td data-label="Voluntário">${escapeHtml(it.nome || '—')}<br><small style="color:var(--text-muted)">${escapeHtml(it.email || '')}</small></td>
      <td data-label="Ministério">${escapeHtml(it.ministerio || '—')}</td>
      <td data-label="Inscrito em">${escapeHtml(data)}</td>
      <td data-label="Presença">${presencaBadge(it.presenca)}${hora ? ` <small style="color:var(--text-muted)">${escapeHtml(hora)}</small>` : ''}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="filters-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <h2 style="font-size:1.1rem;margin:0">Acompanhamento</h2>
        <div style="color:var(--text-muted);font-size:.88em">${encerrado ? 'Evento encerrado' : 'Evento ainda não encerrado'}</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${kpi('Aprovados', totals.aprovados, '#1a1a2e', '')}
        ${kpi('Presentes', totals.presentes, '#166534', `Taxa ${taxa}%`)}
        ${kpi('Faltaram', totals.faltaram, '#991b1b', '')}
        ${kpi('Aguardando', totals.pendentes, '#3730a3', '')}
      </div>
    </div>
    <div class="table-card" style="margin-top:12px">
      <div class="chart-header"><h2>Detalhe por voluntário <span class="list-count">(${itens.length})</span></h2></div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>Voluntário</th><th>Ministério</th><th>Inscrito em</th><th>Presença</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

/** Resumo executivo da plataforma: cards globais + série 7d + top ministérios. */
async function fetchResumoGlobal() {
  if (!authToken) return;
  const isAdmin = authRole === 'admin';
  const isLider = authRole === 'lider' || (authMinisterioNomes && authMinisterioNomes.length);
  if (!isAdmin && !isLider) return;
  try {
    const r = await authFetch(`${API_BASE}/api/dashboard/resumo`);
    if (!r.ok) return;
    const data = await r.json();
    renderResumoGlobal(data);
  } catch (_) {}
}

function renderResumoGlobal(data) {
  const p = data?.pessoas || { voluntarios: 0, soCheckin: 0, total: 0 };
  const c = data?.checkins || { ontem: 0, semana: 0, mes: 0, serie7d: [] };
  const pm = data?.presencaMedia || { taxa: null, baseEscalas: 0 };
  const top = Array.isArray(data?.topMinisterios) ? data.topMinisterios : [];
  const f = data?.formularios || { membros: 0, consolidacao: 0, batismo: 0, apresentacao: 0 };

  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('resumoPessoasTotal', p.total);
  setTxt('resumoPessoasVoluntarios', p.voluntarios);
  setTxt('resumoPessoasSoCheckin', p.soCheckin);
  setTxt('resumoCkOntem', c.ontem);
  setTxt('resumoCkSemana', c.semana);
  setTxt('resumoCkMes', c.mes);
  setTxt('resumoPresencaTaxa', pm.taxa != null ? `${pm.taxa}%` : '—');
  setTxt('resumoPresencaBase', pm.baseEscalas || 0);
  const fTotal = (f.membros || 0) + (f.consolidacao || 0) + (f.batismo || 0) + (f.apresentacao || 0);
  setTxt('resumoFormTotal', fTotal);
  setTxt('resumoFormMembros', f.membros || 0);
  setTxt('resumoFormConsolidacao', f.consolidacao || 0);
  setTxt('resumoFormBatismo', f.batismo || 0);
  setTxt('resumoFormApresentacao', f.apresentacao || 0);

  // Top ministérios — barras simples sem Chart.js
  const tBox = document.getElementById('resumoTopMinisteriosBox');
  if (tBox) {
    if (!top.length) {
      tBox.innerHTML = '<p class="auth-subtitle" style="margin:0">Sem check-ins este mês ainda.</p>';
    } else {
      const max = Math.max(...top.map((t) => t.total)) || 1;
      tBox.innerHTML = top.map((t) => {
        const pct = Math.round((t.total / max) * 100);
        return `
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-size:.88rem;color:var(--text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.nome)}</div>
              <div style="height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:#f59e0b"></div>
              </div>
            </div>
            <div style="font-weight:700;color:#1a1a2e;min-width:36px;text-align:right">${t.total}</div>
          </div>`;
      }).join('');
    }
  }

  // Série 7d — chart simples de barras (lazy load do Chart.js)
  renderResumoCheckins7d(c.serie7d || []);
}

let _resumoCkChart = null;
async function renderResumoCheckins7d(serie) {
  try { await ensureChartJs(); } catch (_) { return; }
  const canvas = document.getElementById('resumoCheckins7dChart');
  if (!canvas) return;
  const labels = serie.map((p) => {
    const d = new Date(p.ymd + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' });
  });
  const values = serie.map((p) => Number(p.total) || 0);
  if (_resumoCkChart) { try { _resumoCkChart.destroy(); } catch (_) {} _resumoCkChart = null; }
  // eslint-disable-next-line no-undef
  _resumoCkChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Check-ins', data: values, backgroundColor: '#f59e0b' }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

/** Widget no resumo (Fase 5) — chama /api/dashboard/escala-em-destaque */
async function fetchEscalaEmDestaque() {
  const wrap = document.getElementById('escalaDestaqueWidget');
  if (!wrap || !authToken) return;
  try {
    const r = await authFetch(`${API_BASE}/api/dashboard/escala-em-destaque`);
    if (!r.ok) { wrap.innerHTML = ''; return; }
    const data = await r.json().catch(() => ({}));
    if (!data?.escala) { wrap.innerHTML = ''; return; }
    const totals = data.totals || { aprovados: 0, presentes: 0, faltaram: 0, pendentes: 0 };
    const dataLabel = formatEscalaDateOnly(data.escala.data || '');
    const sitMap = {
      'em-aberto': ['#dcfce7', '#166534', 'Check-in aberto agora'],
      'futura':    ['#fef3c7', '#92400e', 'Próxima escala'],
      'passada':   ['#f1f5f9', '#475569', 'Última escala'],
    };
    const [bg, fg, label] = sitMap[data.situacao] || sitMap.futura;
    const taxa = totals.aprovados > 0 ? Math.round((totals.presentes / totals.aprovados) * 100) : 0;
    const tile = (l, v, c) => `
      <div style="background:#fff;border:1px solid var(--border-color);border-radius:8px;padding:10px 14px;flex:1 1 110px;min-width:110px">
        <div style="font-size:.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">${l}</div>
        <div style="font-size:1.35rem;font-weight:700;color:${c}">${v}</div>
      </div>`;
    wrap.innerHTML = `
      <div class="filters-card" style="border-left:4px solid ${fg};cursor:pointer" id="escalaDestaqueClick" title="Abrir esta escala">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
          <div>
            <span style="display:inline-block;background:${bg};color:${fg};border:1px solid ${fg};padding:2px 8px;border-radius:6px;font-size:.78rem;font-weight:600">${label}</span>
            <h3 style="font-size:1.05rem;margin:8px 0 2px">${escapeHtml(data.escala.nome || '—')}</h3>
            <div style="color:var(--text-muted);font-size:.88rem">${escapeHtml(dataLabel)}</div>
          </div>
          <div style="color:var(--text-muted);font-size:.85rem">Taxa de presença: <strong style="color:#166534">${taxa}%</strong></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${tile('Aprovados', totals.aprovados, '#1a1a2e')}
          ${tile('Presentes', totals.presentes, '#166534')}
          ${tile('Faltaram', totals.faltaram, '#991b1b')}
          ${tile('Aguardando', totals.pendentes, '#3730a3')}
        </div>
      </div>`;
    document.getElementById('escalaDestaqueClick')?.addEventListener('click', () => {
      setView('escalas', { escalaId: data.escala._id });
    });
  } catch (_) {
    wrap.innerHTML = '';
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
      const candYmd = escalaDataToYMD(c.escalaData);
      if (candYmd !== String(f.data).slice(0, 10)) return false;
    }
    if (f.ministerio && (c.ministerio || '').trim() !== f.ministerio) return false;
    if (f.historicoServico) {
      const nuncaServiu = !c.jaServiuAlgum;
      const jaServiu = c.jaServiuAlgum;
      const jaServiuMinLider = !!c.jaServiuMinLider;
      const totalCi = Number(c.totalCheckins) || 0;
      if (f.historicoServico === 'nunca' && !nuncaServiu) return false;
      if (f.historicoServico === 'ja-serviu' && !jaServiu) return false;
      if (f.historicoServico === 'ja-serviu-ministerio' && !jaServiuMinLider) return false;
      if (f.historicoServico === 'ausentes' && totalCi > 0) return false;
    }
    return true;
  });
}

function escapeCsv(val) {
  const s = String(val ?? '').replace(/"/g, '""');
  return /[,"\n\r]/.test(s) ? `"${s}"` : s;
}

function exportCandidaturasCsv(list) {
  const header = ['Escala', 'Data', 'Nome', 'Email', 'Telefone', 'Ministério', 'CI', 'Part.', 'Ausências', 'Status'];
  const rows = list.map((c) => {
    const dataStr = formatEscalaDateOnly(c.escalaData) || '';
    return [c.escalaNome || '', dataStr, c.nome || '', c.email || '', c.telefone || '', c.ministerio || '', c.totalCheckins || 0, c.totalParticipacoes || 0, c.totalFaltas ?? 0, c.status || ''].map(escapeCsv).join(',');
  });
  const csv = '\uFEFF' + header.map(escapeCsv).join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'candidaturas-export.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function formatDatePtBR(dateVal) {
  if (dateVal == null || dateVal === '') return '';
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA });
}

function formatDateTimePtBR(dateVal) {
  if (dateVal == null || dateVal === '') return '';
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    timeZone: TZ_BRASILIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function safeFileName(val) {
  const s = String(val ?? '').trim();
  const cleaned = s
    .replace(/[\/\\?%*:|"<>]/g, '-') // caracteres proibidos em nomes
    .replace(/\s+/g, '-')            // espaços
    .replace(/-+/g, '-');           // repetidos
  return (cleaned || 'evento').slice(0, 70);
}

async function exportFormularioMembroCsv() {
  if (!authToken) return updateAuthUi();
  try {
    setViewLoading('formularios', true);
    const r = await authFetch(`${API_BASE}/api/formularios/membro?_t=${Date.now()}`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || body.message || 'Falha ao carregar dados.');
    const items = Array.isArray(body) ? body : (Array.isArray(body.formularios) ? body.formularios : []);
    if (!items.length) return alert('Nenhum formulário de Novos Membros para exportar.');

    const header = [
      'Nome completo',
      'Data nascimento',
      'E-mail',
      'Endereço completo',
      'Telefone/WhatsApp',
      'Batizado',
      'Voluntário',
      'Grupo de Oração',
      'Quer membro Celeiro São Paulo',
      'Compromisso respeitar/honrar',
      'Testemunho',
      'Criado em',
    ];

    const rows = items.map((c) => ([
      c.nomeCompleto || '',
      formatDatePtBR(c.dataNascimento),
      c.email || '',
      c.enderecoCompleto || '',
      c.telefoneWhatsapp || '',
      (c.batizado || '').trim(),
      (c.voluntario || '').trim(),
      (c.grupoOracao || '').trim(),
      (c.querMembroCeleiro || '').trim(),
      (c.compromissoRespeitar || '').trim(),
      c.testemunho || '',
      formatDateTimePtBR(c.createdAt),
    ]).map(escapeCsv).join(','));

    const csv = '\uFEFF' + header.map(escapeCsv).join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'formularios-novos-membros-export.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert(err.message || 'Erro ao exportar.');
  } finally {
    setViewLoading('formularios', false);
  }
}

async function exportFormularioConsolidacaoCsv() {
  if (!authToken) return updateAuthUi();
  try {
    setViewLoading('formularios', true);
    const r = await authFetch(`${API_BASE}/api/formularios/consolidacao?_t=${Date.now()}`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || body.message || 'Falha ao carregar dados.');
    const items = Array.isArray(body) ? body : [];
    if (!items.length) return alert('Nenhum formulário de Consolidação para exportar.');

    const header = [
      'Nome completo',
      'Data nascimento',
      'Idade',
      'Gênero',
      'Estado civil',
      'Batismo nas águas',
      'WhatsApp',
      'E-mail (opcional)',
      'Bairro e cidade',
      'Decisão hoje',
      'Grupo de oração',
      'Pode contato',
      'Melhor dia',
      'Melhor horário',
      'Preferência contato',
      'Pedido / oração',
      'Criado em',
    ];

    const rows = items.map((c) => ([
      c.nomeCompleto || '',
      formatDatePtBR(c.dataNascimento),
      c.idade || '',
      c.genero || '',
      c.estadoCivil || '',
      c.batizadoAguas || '',
      c.telefoneWhatsapp || '',
      c.emailOpcional || '',
      c.bairroCidade || '',
      c.decisaoHoje || '',
      c.grupoOracao || '',
      c.podeContato || '',
      c.melhorDiaContato || '',
      c.melhorHorarioContato || '',
      c.preferenciaContato || '',
      c.pedidoOracao || '',
      formatDateTimePtBR(c.createdAt),
    ]).map(escapeCsv).join(','));

    const csv = '\uFEFF' + header.map(escapeCsv).join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'formularios-consolidacao-export.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert(err.message || 'Erro ao exportar.');
  } finally {
    setViewLoading('formularios', false);
  }
}

/** CSV apenas das inscrições do evento de novos membros escolhido. */
async function exportFormularioNovoMembroCsvForEvent(eventId, eventLabel) {
  if (!authToken) return updateAuthUi();
  if (!eventId) return;
  try {
    setViewLoading('formularios', true);
    const rList = await authFetch(`${API_BASE}/api/formularios/novo-membro/${encodeURIComponent(eventId)}?_t=${Date.now()}`);
    if (!rList.ok) {
      const body = await rList.json().catch(() => ({}));
      throw new Error(body.error || body.message || 'Falha ao carregar inscrições deste evento.');
    }
    const list = await rList.json().catch(() => []);
    const items = Array.isArray(list) ? list : [];
    if (!items.length) return alert('Nenhum formulário preenchido neste evento.');

    const header = [
      'Nome completo',
      'Celular/WhatsApp',
      'Endereço',
      'E-mail',
      'Idade',
      'Estado civil',
      'Batizado',
      'Tempo na igreja',
      'Interesse em servir',
      'Ministérios de interesse',
      'Criado em',
    ];

    const rows = items.map((doc) => ([
      doc.nomeCompleto || '',
      doc.telefoneWhatsapp || '',
      doc.endereco || '',
      doc.email || '',
      doc.idade || '',
      doc.estadoCivil || '',
      (doc.batizado || '').trim(),
      doc.tempoFrequentaIgreja || '',
      (doc.interesseServir || '').trim(),
      Array.isArray(doc.ministeriosInteresse) ? doc.ministeriosInteresse.join('; ') : '',
      formatDateTimePtBR(doc.createdAt),
    ]).map(escapeCsv).join(','));

    const csv = '\uFEFF' + header.map(escapeCsv).join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `novos-membros-${safeFileName(eventLabel || eventId)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert(err.message || 'Erro ao exportar.');
  } finally {
    setViewLoading('formularios', false);
  }
}

/** CSV apenas das inscrições do evento de batismo escolhido (um arquivo por clique). */
async function exportFormularioBatismoCsvForEvent(eventId, eventLabel) {
  if (!authToken) return updateAuthUi();
  if (!eventId) return;
  try {
    setViewLoading('formularios', true);
    const rList = await authFetch(`${API_BASE}/api/formularios/batismo/${encodeURIComponent(eventId)}?_t=${Date.now()}`);
    if (!rList.ok) {
      const body = await rList.json().catch(() => ({}));
      throw new Error(body.error || body.message || 'Falha ao carregar inscrições deste evento.');
    }
    const list = await rList.json().catch(() => []);
    const items = Array.isArray(list) ? list : [];
    if (!items.length) return alert('Nenhum formulário preenchido neste evento de batismo.');

    const header = [
      'Data nascimento',
      'Nome completo',
      'E-mail',
      'Telefone/WhatsApp',
      'Reconhece Jesus',
      'Quer membro Celeiro São Paulo',
      'Vai se batizar próximo',
      'Curso de Batismo',
      'Criado em',
    ];

    const rows = items.map((doc) => ([
      formatDatePtBR(doc.dataNascimento),
      doc.nomeCompleto || '',
      doc.email || '',
      doc.telefoneWhatsapp || '',
      (doc.reconheceJesus || '').trim(),
      (doc.querMembroCeleiro || '').trim(),
      (doc.batizarProximo || '').trim(),
      (doc.cursoBatismo || '').trim(),
      formatDateTimePtBR(doc.createdAt),
    ]).map(escapeCsv).join(','));

    const csv = '\uFEFF' + header.map(escapeCsv).join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `batismo-${safeFileName(eventLabel || eventId)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert(err.message || 'Erro ao exportar.');
  } finally {
    setViewLoading('formularios', false);
  }
}

/** CSV apenas das inscrições do evento de apresentação escolhido (um arquivo por clique). */
async function exportFormularioApresentacaoCsvForEvent(eventId, eventLabel) {
  if (!authToken) return updateAuthUi();
  if (!eventId) return;
  try {
    setViewLoading('formularios', true);
    const rList = await authFetch(`${API_BASE}/api/formularios/apresentacao/${encodeURIComponent(eventId)}?_t=${Date.now()}`);
    if (!rList.ok) {
      const body = await rList.json().catch(() => ({}));
      throw new Error(body.error || body.message || 'Falha ao carregar inscrições deste evento.');
    }
    const list = await rList.json().catch(() => []);
    const items = Array.isArray(list) ? list : [];
    if (!items.length) return alert('Nenhum formulário preenchido neste evento de apresentação.');

    const header = [
      'Nome mãe',
      'Nome pai',
      'Quantidade crianças',
      'Crianças (nome; nascimento)',
      'Endereço',
      'Pais membros Celeiro',
      'E-mail contato',
      'WhatsApp contato',
      'Compromisso educar',
      'Criado em',
    ];

    const rows = items.map((doc) => {
      const criancas = Array.isArray(doc.criancas) ? doc.criancas : [];
      const criancasStr = criancas.map(c => {
        const nome = (c.nomeCompleto || '').trim();
        const nasc = formatDatePtBR(c.dataNascimento);
        return nome ? `${nome}${nasc ? ` (${nasc})` : ''}` : '';
      }).filter(Boolean).join('; ');
      return ([
        doc.nomeMae || '',
        doc.nomePai || '',
        Number(doc.quantidadeCriancas) || criancas.length || 0,
        criancasStr,
        doc.endereco || '',
        (doc.paisMembrosCeleiro || '').trim(),
        doc.emailContato || '',
        doc.whatsappContato || '',
        (doc.compromissoEducar || '').trim(),
        formatDateTimePtBR(doc.createdAt),
      ]).map(escapeCsv).join(',');
    });

    const csv = '\uFEFF' + header.map(escapeCsv).join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `apresentacao-${safeFileName(eventLabel || eventId)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert(err.message || 'Erro ao exportar.');
  } finally {
    setViewLoading('formularios', false);
  }
}

function renderAnaliseTab() {
  const panel = document.getElementById('escalasAnalisePanel');
  if (!panel) return;
  const filtered = getFilteredCandidaturasAnalise();
  const selectedIds = new Set(Array.from(document.querySelectorAll('#escalasAnaliseBody input.row-check-cand:checked')).map((cb) => cb.getAttribute('data-cand-id')));
  const pendentes = filtered.filter((c) => c.status !== 'aprovado');

  const statusOptions = [
    { v: 'pendente', l: 'Pendente' },
    { v: 'aprovado', l: 'Aprovado' },
    { v: 'desistencia', l: 'Desistência / Cancelar' },
    { v: 'falta', l: 'Falta' },
  ];
  const rows = filtered.map((c) => {
    const dataStr = formatEscalaDateOnly(c.escalaData);
    const checked = selectedIds.has(String(c._id));
    const podeSelecionar = c.status !== 'aprovado';
    const statusOpts = statusOptions.map((o) => `<option value="${escapeAttr(o.v)}" ${c.status === o.v ? 'selected' : ''}>${escapeHtml(o.l)}</option>`).join('');
    return `<tr>
      <td class="col-check"><input type="checkbox" class="row-check-cand" data-cand-id="${escapeAttr(String(c._id))}" ${podeSelecionar ? '' : 'disabled'} ${checked ? 'checked' : ''}></td>
      <td data-label="Escala">${escapeHtml(c.escalaNome || '—')}</td>
      <td data-label="Data">${dataStr}</td>
      <td data-label="Nome">${escapeHtml(c.nome || '—')}</td>
      <td data-label="Email"><button type="button" class="link-voluntario" data-email="${escapeAttr((c.email || '').toLowerCase())}">${escapeHtml(c.email || '')}</button></td>
      <td data-label="Ministério">${escapeHtml(c.ministerio || '—')}</td>
      <td class="escala-cand-stat" data-label="CI">${Number(c.totalCheckins) || 0}</td>
      <td class="escala-cand-stat" data-label="Part.">${Number(c.totalParticipacoes) || 0}</td>
      <td class="escala-cand-stat" data-label="Ausências">${Number(c.totalFaltas) || 0}</td>
      <td data-label="Histórico">${c.jaServiuAlgum ? (c.jaServiuMinLider ? 'Ministério' : 'Sim') : 'Nunca'}</td>
      <td data-label="Status">${statusEscalaBadge(c.status)}</td>
      <td data-label="Ações"><select class="escala-status-select" data-cand-id="${escapeAttr(String(c._id))}" aria-label="Alterar status">${statusOpts}</select></td>
    </tr>`;
  }).join('');

  const tbody = panel.querySelector('#escalasAnaliseBody');
  const selEscala = document.getElementById('analiseFilterEscala');
  const escalaSelected = selEscala && (selEscala.value || '').trim();
  const emptyMsg = !escalaSelected
    ? `<div class="escala-empty-state"><p class="escala-empty-state-title">Selecione uma escala</p><p class="escala-empty-state-text">No filtro <strong>Escala</strong> acima, escolha um culto para carregar candidaturas, totais e aprovações em lote.</p></div>`
    : `<div class="escala-empty-state"><p class="escala-empty-state-title">Nenhuma candidatura nesta visão</p><p class="escala-empty-state-text">Tente limpar filtros ou aguarde novas inscrições. Para outro culto, troque a escala no filtro.</p></div>`;
  if (tbody) tbody.innerHTML = rows || `<tr><td colspan="12" class="escala-table-empty-cell">${emptyMsg}</td></tr>`;

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
  panel.querySelectorAll('select.escala-status-select').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const id = e.target.getAttribute('data-cand-id');
      const status = e.target.value;
      if (!id || !status) return;
      const cand = filtered.find((c) => String(c._id) === id);
      const prevStatus = cand?.status;
      const escalaId = cand?.escalaId || candidaturasAnaliseFilters?.escalaId || document.getElementById('analiseFilterEscala')?.value;
      const ok = await atualizarStatusCandidatura(id, status, cand ? {
        escalaId, nome: cand.nome, telefone: cand.telefone,
      } : null);
      if (!ok && prevStatus) e.target.value = prevStatus;
      else if (escalaId) await fetchCandidaturasPorEscala(escalaId);
    });
  });
}

/** Datas futuras com inscrições abertas (para lembrete por email). */
function buildEscalasLembreteDateOptions() {
  const todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const byDate = new Map();
  for (const e of escalasList || []) {
    if (!e || e.candidaturaAberta !== true) continue;
    const ymd = escalaDataToYMD(e.data);
    if (!ymd || ymd < todayYmd) continue;
    byDate.set(ymd, (byDate.get(ymd) || 0) + 1);
  }
  return sortEscalasByDataAsc([...byDate.entries()].map(([ymd, count]) => ({ ymd, count })));
}

async function enviarLembreteEscalaVoluntarios(force = false) {
  const sel = document.getElementById('escalaLembreteDataSelect');
  const cultoData = sel?.value?.trim();
  if (!cultoData) {
    alert('Nenhuma escala com inscrições abertas no momento.');
    return;
  }
  const label = sel?.selectedOptions?.[0]?.textContent?.trim() || cultoData;
  const msg = force
    ? `Reenviar email de lembrete de inscrição na escala para todos os voluntários?\n\n${label}`
    : `Enviar email de lembrete de inscrição na escala para todos os voluntários?\n\n${label}`;
  if (!confirm(msg)) return;
  const btn = document.getElementById('btnEnviarLembreteEscala');
  if (btn) btn.disabled = true;
  try {
    const r = await authFetch(`${API_BASE}/api/escalas/enviar-lembrete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cultoData, force }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409) {
      if (confirm((data.error || 'Lembrete já enviado.') + '\n\nDeseja reenviar mesmo assim?')) {
        await enviarLembreteEscalaVoluntarios(true);
      }
      return;
    }
    if (!r.ok) throw new Error(data.error || 'Falha ao enviar emails.');
    if (data.started) {
      alert(`Envio iniciado! ${data.total || 0} email(s) serão enviados em segundo plano (pode levar alguns minutos).`);
      return;
    }
    if (data.skipped && data.reason === 'no_escalas') {
      alert('Não há escalas ativas nesta data para incluir no email.');
      return;
    }
    alert(`${data.sent || 0} email(s) enviado(s) de ${data.total || 0}.`);
  } catch (e) {
    alert(e.message || 'Erro ao enviar lembrete de escala.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** Criar escalas (admin): apenas tabela CRUD, leve */
function pruneSelectedEscalaIds() {
  const valid = new Set((escalasList || []).map((e) => String(e._id)));
  selectedEscalaIds = new Set([...selectedEscalaIds].filter((id) => valid.has(String(id))));
}

function updateEscalasCriarSelectionUi() {
  const n = selectedEscalaIds.size;
  const countEl = document.getElementById('escalasCriarSelectedCount');
  const btn = document.getElementById('btnExcluirEscalasSelecionadas');
  if (countEl) countEl.textContent = String(n);
  if (btn) btn.disabled = n === 0;
  const allIds = (escalasList || []).map((e) => String(e._id));
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedEscalaIds.has(id));
  const someSelected = allIds.some((id) => selectedEscalaIds.has(id));
  const selectAll = document.getElementById('selectAllEscalasCriar');
  if (selectAll) {
    selectAll.checked = allSelected;
    selectAll.indeterminate = someSelected && !allSelected;
  }
}

function renderEscalasCriar() {
  const container = document.getElementById('escalasCriarContent');
  if (!container) return;
  const rows = escalasList.map(e => {
    const data = formatEscalaDateOnly(e.data);
    const aberta = e.candidaturaAberta === true;
    const ativoFlag = e.ativo !== false;
    const statusLabel = aberta ? 'Aberta' : (ativoFlag ? 'Fora do prazo' : 'Inscrições fechadas');
    const statusClass = aberta ? 'evento-status-ativo' : 'evento-status-inativo';
    const eid = String(e._id);
    const checked = selectedEscalaIds.has(eid);
    return `<tr>
      <td class="col-check" data-label=""><input type="checkbox" class="row-check-escala" data-escala-id="${escapeAttr(eid)}" ${checked ? 'checked' : ''} aria-label="Selecionar escala"></td>
      <td data-label="Nome">${escapeHtml(e.nome)}</td>
      <td data-label="Data">${data}</td>
      <td data-label="Status"><span class="evento-status ${statusClass}">${statusLabel}</span></td>
      <td data-label="Candidatos">${e.totalCandidaturas || 0} <span style="color:var(--text-muted);font-size:.8em">(${e.totalAprovados || 0} aprovados)</span></td>
      <td class="escala-actions-cell" data-label="Link"><button class="btn btn-sm btn-primary escala-btn-main" data-escala-link="${escapeAttr(eid)}" title="Copiar link (qualquer ministério)">Copiar link</button> <button class="btn btn-sm btn-ghost" data-escala-link-ministerio="${escapeAttr(eid)}" title="Link só para um ministério">Por ministério</button></td>
      <td class="escala-actions-cell" data-label="">
        <div class="escala-actions-wrap">
          <button class="btn btn-sm btn-ghost" data-escala-edit="${escapeAttr(eid)}">Editar</button>
          <button class="btn btn-sm btn-ghost" data-escala-toggle="${escapeAttr(eid)}">${ativoFlag ? 'Fechar inscrições' : 'Reabrir inscrições'}</button>
          <button class="btn btn-sm btn-ghost" data-escala-delete="${escapeAttr(eid)}">Excluir</button>
        </div>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="7">Nenhuma escala. Clique em "Nova escala" para criar.</td></tr>';

  const lembreteOpcoes = buildEscalasLembreteDateOptions();
  const lembreteSelectHtml = lembreteOpcoes.length
    ? lembreteOpcoes.map(({ ymd, count }) => {
      const label = formatEscalaDateOnly(ymd);
      return `<option value="${escapeAttr(ymd)}">${escapeHtml(label)} (${count} escala${count !== 1 ? 's' : ''})</option>`;
    }).join('')
    : '<option value="">Sem escalas abertas</option>';

  container.innerHTML = `
    <div class="filters-card" style="margin-bottom:20px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
      <button type="button" class="btn btn-primary" id="btnNovaEscala">+ Nova escala</button>
      <button type="button" class="btn btn-ghost" id="btnExcluirEscalasSelecionadas" disabled style="color:var(--danger,#ef4444)">
        Excluir selecionadas (<span id="escalasCriarSelectedCount">0</span>)
      </button>
      <div class="escala-lembrete-actions" style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <label for="escalaLembreteDataSelect" class="form-hint" style="margin:0">Reforço por email:</label>
        <select id="escalaLembreteDataSelect" class="igreja-select" style="min-width:180px" ${lembreteOpcoes.length ? '' : 'disabled'}>${lembreteSelectHtml}</select>
        <button type="button" class="btn btn-ghost" id="btnEnviarLembreteEscala" ${lembreteOpcoes.length ? '' : 'disabled'} title="Envia lembrete de inscrição na escala para todos os voluntários">Email · todos</button>
      </div>
    </div>
    <div class="table-card escala-table-card">
      <div class="chart-header"><h2>Escalas</h2></div>
      <p class="auth-subtitle" style="margin-bottom:12px">Crie escalas, edite ou copie o link para os voluntários se candidatarem. Selecione várias para excluir em lote.</p>
      <div class="table-wrapper">
        <table class="data-table escala-table">
          <thead><tr>
            <th class="col-check"><input type="checkbox" id="selectAllEscalasCriar" title="Selecionar todas"></th>
            <th>Nome</th><th>Data</th><th>Status</th><th>Candidaturas</th><th>Link</th><th>Ações</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btnEnviarLembreteEscala')?.addEventListener('click', () => enviarLembreteEscalaVoluntarios(false));
  document.getElementById('btnNovaEscala')?.addEventListener('click', () => {
    const m = document.getElementById('modalNovaEscala');
    if (m) {
      document.getElementById('escalaNovoNome').value = '';
      document.getElementById('escalaNovaData').value = '';
      document.getElementById('escalaNovaDescricao').value = '';
      document.getElementById('escalaNovoAtivo').checked = true;
      const chk = document.getElementById('escalaNovoCriarCheckin'); if (chk) chk.checked = true;
      const hi = document.getElementById('escalaNovoHorarioInicio'); if (hi) hi.value = '';
      const hf = document.getElementById('escalaNovoHorarioFim'); if (hf) hf.value = '';
      const cap = document.getElementById('escalaNovoCapacidades'); if (cap) cap.value = '';
      m.classList.add('open'); m.setAttribute('aria-hidden', 'false');
    }
  });
  container.querySelectorAll('[data-escala-link]').forEach(btn => {
    if (btn.hasAttribute('data-escala-link-ministerio')) return;
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-escala-link');
      const ig = getTenantSlugForLinks();
      const url = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}?escala=${encodeURIComponent(id)}&igreja=${encodeURIComponent(ig)}`;
      navigator.clipboard.writeText(url).then(() => alert('Link copiado!')).catch(() => prompt('Copie:', url));
    });
  });
  container.querySelectorAll('[data-escala-link-ministerio]').forEach(btn => {
    btn.addEventListener('click', () => openModalCopiarLinkMinisterio(btn.getAttribute('data-escala-link-ministerio')));
  });
  container.querySelectorAll('[data-escala-edit]').forEach(btn => { btn.addEventListener('click', () => openModalEditarEscala(btn.getAttribute('data-escala-edit'))); });
  container.querySelectorAll('[data-escala-toggle]').forEach(btn => { btn.addEventListener('click', () => toggleEscalaAtivo(btn.getAttribute('data-escala-toggle'))); });
  container.querySelectorAll('[data-escala-delete]').forEach(btn => { btn.addEventListener('click', () => excluirEscala(btn.getAttribute('data-escala-delete'))); });
  container.querySelectorAll('.row-check-escala').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.getAttribute('data-escala-id');
      if (!id) return;
      if (cb.checked) selectedEscalaIds.add(id);
      else selectedEscalaIds.delete(id);
      updateEscalasCriarSelectionUi();
    });
  });
  document.getElementById('selectAllEscalasCriar')?.addEventListener('change', (ev) => {
    const checked = ev.target.checked;
    (escalasList || []).forEach((e) => {
      const id = String(e._id);
      if (checked) selectedEscalaIds.add(id);
      else selectedEscalaIds.delete(id);
    });
    container.querySelectorAll('.row-check-escala').forEach((cb) => { cb.checked = checked; });
    updateEscalasCriarSelectionUi();
  });
  document.getElementById('btnExcluirEscalasSelecionadas')?.addEventListener('click', () => {
    void excluirEscalasSelecionadas();
  });
  updateEscalasCriarSelectionUi();
}

function buildVisaoConsolidadaSectionHtml() {
  return `
  <section class="filters-card visao-consolidada-card" id="visaoConsolidadaWrap">
    <div class="visao-consolidada-header">
      <h2 class="visao-consolidada-title">Visão consolidada (domingo)</h2>
      <p class="auth-subtitle visao-consolidada-desc">Contagem por ministério e interseção (voluntários inscritos na manhã <strong>e</strong> na tarde). Atualiza ao mudar a data.</p>
    </div>
    <div class="visao-consolidada-controls">
      <div class="visao-consolidada-date">
        <label for="visaoConsolidadaData">Domingo</label>
        <input type="date" id="visaoConsolidadaData" class="visao-consolidada-date-input" autocomplete="off">
      </div>
      <div class="visao-consolidada-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="btnVisaoProximoDomingo">Próximo domingo</button>
        <button type="button" class="btn btn-ghost btn-sm" id="btnVisaoConsolidadaCopiar" disabled title="Copiar texto para WhatsApp">Copiar texto</button>
      </div>
    </div>
    <div id="visaoConsolidadaMeta" class="visao-consolidada-meta" hidden></div>
    <div id="visaoConsolidadaContent" class="visao-consolidada-content">
      <p class="visao-consolidada-placeholder-text">Carregando visão consolidada…</p>
    </div>
    <pre id="visaoConsolidadaTexto" class="visao-consolidada-pre" hidden aria-hidden="true"></pre>
  </section>`;
}

function formatVisaoTurnoCell(entries) {
  if (!Array.isArray(entries) || !entries.length) return '—';
  return entries.map((e) => escapeHtml((e.ministerio || e.ministerioKey || '—').trim())).join(', ');
}

function renderVisaoConsolidadaTables(d) {
  const content = document.getElementById('visaoConsolidadaContent');
  const meta = document.getElementById('visaoConsolidadaMeta');
  const pre = document.getElementById('visaoConsolidadaTexto');
  const btnCopy = document.getElementById('btnVisaoConsolidadaCopiar');
  if (!content) return;

  const ministerios = Array.isArray(d?.ministerios) ? d.ministerios : [];
  const intersecao = Array.isArray(d?.intersecao) ? d.intersecao : [];
  const escManha = (d?.escalasManha || []).map((e) => e.nome).filter(Boolean).join(' · ') || '—';
  const escTarde = (d?.escalasTarde || []).map((e) => e.nome).filter(Boolean).join(' · ') || '—';
  const dataLabel = d?.dataLabel || (d?.data ? formatEscalaDateOnly(d.data) : '—');
  const diaNomes = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const diaNome = Number.isInteger(d?.diaSemana) ? diaNomes[d.diaSemana] : '';

  if (meta) {
    meta.hidden = false;
    meta.innerHTML = `
      <p class="visao-consolidada-meta-line"><strong>${escapeHtml(diaNome ? `${diaNome} ${dataLabel}` : dataLabel)}</strong></p>
      <p class="visao-consolidada-meta-line">Manhã: ${escapeHtml(escManha)} · Tarde: ${escapeHtml(escTarde)}</p>
      <p class="visao-consolidada-meta-line">Almoço (2 cultos): <strong>${d?.totalAlmoco || 0}</strong> pessoa(s) · Intercessão — M:${d?.intercessao?.manha || 0} / A:${d?.intercessao?.almoco || 0} / T:${d?.intercessao?.tarde || 0}</p>`;
  }

  if (!ministerios.length && !intersecao.length) {
    content.innerHTML = '<p class="visao-consolidada-empty">Nenhuma candidatura aprovada para escalas de manhã/tarde nesta data. Verifique se as escalas têm “Manhã” ou “Tarde” no nome.</p>';
  } else {
    const minRows = ministerios.map((m) => `
      <tr>
        <td data-label="Ministério"><strong>${escapeHtml(m.key)}</strong></td>
        <td data-label="Manhã" class="num">${m.manha || 0}</td>
        <td data-label="Almoço" class="num visao-col-intersecao">${m.almoco || 0}</td>
        <td data-label="Tarde" class="num">${m.tarde || 0}</td>
      </tr>`).join('');

    const interRows = intersecao.length
      ? intersecao.map((p) => `
      <tr>
        <td data-label="Nome">${escapeHtml(p.nome || '—')}</td>
        <td data-label="Email">${escapeHtml(p.email || '')}</td>
        <td data-label="Manhã">${formatVisaoTurnoCell(p.manha)}</td>
        <td data-label="Tarde">${formatVisaoTurnoCell(p.tarde)}</td>
      </tr>`).join('')
      : '<tr><td colspan="4" class="visao-consolidada-empty-cell">Ninguém inscrito nos dois cultos nesta data.</td></tr>';

    content.innerHTML = `
      <div class="visao-consolidada-grid">
        <div class="table-card visao-consolidada-table-wrap">
          <div class="chart-header"><h3>Por ministério</h3></div>
          <div class="table-wrapper">
            <table class="data-table visao-consolidada-table">
              <thead><tr><th>Ministério</th><th>Manhã</th><th>Almoço ∩</th><th>Tarde</th></tr></thead>
              <tbody>${minRows || '<tr><td colspan="4" class="visao-consolidada-empty-cell">Sem dados</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div class="table-card visao-consolidada-table-wrap">
          <div class="chart-header"><h3>Interseção — 2 cultos (${intersecao.length})</h3></div>
          <p class="visao-consolidada-table-hint">Voluntários aprovados na escala da manhã <em>e</em> da tarde (inner join por email).</p>
          <div class="table-wrapper">
            <table class="data-table visao-consolidada-table">
              <thead><tr><th>Nome</th><th>Email</th><th>Manhã</th><th>Tarde</th></tr></thead>
              <tbody>${interRows}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  if (pre) {
    pre.textContent = d?.texto || '';
    pre.dataset.visaoTexto = pre.textContent;
  }
  if (btnCopy) btnCopy.disabled = !(d?.texto || '').trim();
}

async function loadVisaoConsolidada(opts = {}) {
  const content = document.getElementById('visaoConsolidadaContent');
  const btnCopy = document.getElementById('btnVisaoConsolidadaCopiar');
  const meta = document.getElementById('visaoConsolidadaMeta');
  if (!content) return;
  const params = new URLSearchParams();
  if (opts.proximoDomingo) params.set('proximoDomingo', '1');
  else if (opts.data) params.set('data', opts.data);
  else params.set('proximoDomingo', '1');
  if (meta) meta.hidden = true;
  content.innerHTML = '<p class="visao-consolidada-placeholder-text visao-consolidada-pre--loading">Carregando…</p>';
  if (btnCopy) btnCopy.disabled = true;
  try {
    const r = await authFetch(`${API_BASE}/api/escalas/visao-consolidada?${params}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Falha ao carregar visão');
    renderVisaoConsolidadaTables(d);
    const dateInput = document.getElementById('visaoConsolidadaData');
    if (dateInput && d.data) dateInput.value = d.data;
  } catch (e) {
    content.innerHTML = `<p class="visao-consolidada-empty">${escapeHtml(e.message || 'Erro ao carregar.')}</p>`;
    if (btnCopy) btnCopy.disabled = true;
  }
}

function bindVisaoConsolidadaEvents() {
  const reloadFromInput = () => {
    const data = document.getElementById('visaoConsolidadaData')?.value || '';
    loadVisaoConsolidada(data ? { data } : { proximoDomingo: true });
  };
  document.getElementById('visaoConsolidadaData')?.addEventListener('change', reloadFromInput);
  document.getElementById('btnVisaoProximoDomingo')?.addEventListener('click', () => {
    const dateInput = document.getElementById('visaoConsolidadaData');
    if (dateInput) dateInput.value = '';
    loadVisaoConsolidada({ proximoDomingo: true });
  });
  document.getElementById('btnVisaoConsolidadaCopiar')?.addEventListener('click', async () => {
    const txt = document.getElementById('visaoConsolidadaTexto')?.dataset?.visaoTexto || document.getElementById('visaoConsolidadaTexto')?.textContent || '';
    if (!txt.trim()) return;
    try {
      await navigator.clipboard.writeText(txt);
      showToast('Relatório copiado!', 'success');
    } catch (_) {
      prompt('Copie o relatório:', txt);
    }
  });
  loadVisaoConsolidada({ proximoDomingo: true });
}

function buildAnalisePanelHtml(escalasOptions, ministeriosOptions, datasUnicas) {
  return `
  ${buildVisaoConsolidadaSectionHtml()}
  <p class="auth-subtitle escala-candidatos-intro">Escolha uma <strong>escala</strong> abaixo para ver candidatos, aprovar em lote e exportar.</p>
  <section class="filters-row escala-analise-filters-wrap">
    <div class="filters-card escala-analise-filters">
      <div class="escala-analise-filters-inner">
        <div class="form-group compact escala-filter-field">
          <label for="analiseFilterEscala"><strong>Escala</strong></label>
          <select id="analiseFilterEscala"><option value="">— Selecione a escala —</option>${escalasOptions}</select>
        </div>
        <div class="form-group compact escala-filter-field"><label for="analiseFilterNome">Buscar</label><input type="text" id="analiseFilterNome" placeholder="Nome ou email..."></div>
        <div class="form-group compact escala-filter-field"><label for="analiseFilterData">Data</label><select id="analiseFilterData"><option value="">Todas</option>${datasUnicas}</select></div>
        <div class="form-group compact escala-filter-field"><label for="analiseFilterMinisterio">Ministério</label><select id="analiseFilterMinisterio"><option value="">Todos</option>${ministeriosOptions}</select></div>
        <div class="form-group compact escala-filter-field"><label for="analiseFilterHistorico">Histórico</label><select id="analiseFilterHistorico"><option value="">Todos</option><option value="nunca">Nunca serviu</option><option value="ja-serviu">Já serviu</option><option value="ja-serviu-ministerio">Já serviu no meu ministério</option><option value="ausentes">Ausentes (inscreveu, sem check-in)</option></select></div>
        <div class="escala-analise-filters-btns">
          <button type="button" class="btn btn-primary btn-sm" id="btnAnaliseApply">Aplicar</button>
          <button type="button" class="btn btn-ghost btn-sm" id="btnAnaliseClear">Limpar</button>
        </div>
      </div>
    </div>
  </section>
  <div id="escalaAcompanhamento" style="margin-bottom:16px"></div>
  <div class="filters-card" id="escalaMinisterioTogglesWrap" style="display:none;margin: 0 0 12px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div class="chart-header" style="margin:0">
        <h2 style="font-size:1rem;margin:0">Inscrições por ministério</h2>
      </div>
      <div style="color:var(--text-muted);font-size:.9em;margin-left:auto" id="escalaMinisterioTogglesHint"></div>
    </div>
    <div id="escalaMinisterioTogglesList" style="display:flex;flex-direction:column;gap:10px;margin-top:10px;"></div>
  </div>
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
        <thead><tr><th class="col-check"><input type="checkbox" id="analiseSelectAllHeader"></th><th>Escala</th><th>Data</th><th>Nome</th><th>Email</th><th>Ministério</th><th>CI</th><th>Part.</th><th>Ausências</th><th>Histórico</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody id="escalasAnaliseBody"></tbody>
      </table>
    </div>
  </div>
  `;
}

function bindAnalisePanelEvents(container) {
  bindVisaoConsolidadaEvents();
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
    if (escalaId) {
      fetchCandidaturasPorEscala(escalaId);
      fetchAcompanhamentoEscala(escalaId);
    } else {
      candidaturasAll = []; renderAnaliseTab();
      const ac = document.getElementById('escalaAcompanhamento');
      if (ac) ac.innerHTML = '';
    }
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
      const approved = getFilteredCandidaturasAnalise().filter((c) => ids.includes(String(c._id)));
      const comTel = approved.filter((c) => c.telefone && validarWhatsApp(c.telefone));
      if (comTel.length && confirm(`Aprovação concluída.\n\nAbrir WhatsApp para ${comTel.length} voluntário(s)?\n(uma aba por pessoa — envio grátis do seu número)`)) {
        for (const c of comTel) {
          try {
            await abrirWhatsAppMensagemEscala({
              escalaId: c.escalaId || escalaId,
              nome: c.nome,
              telefone: c.telefone,
            });
          } catch (_) { /* segue próximo */ }
          await new Promise((r) => setTimeout(r, 600));
        }
      }
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

  // (Líder) Controle de inscrição fechada por ministério na escala selecionada
  const wrapToggle = document.getElementById('escalaMinisterioTogglesWrap');
  const togglesListEl = document.getElementById('escalaMinisterioTogglesList');
  const hintEl = document.getElementById('escalaMinisterioTogglesHint');
  if (wrapToggle && togglesListEl && hintEl && authRole === 'lider' && !wrapToggle.dataset.bound) {
    wrapToggle.dataset.bound = '1';

    const getLeaderMinisterios = () => {
      const list = Array.isArray(authMinisterioNomes) && authMinisterioNomes.length
        ? authMinisterioNomes
        : (authMinisterioNome ? [authMinisterioNome] : []);
      return list.map((m) => String(m || '').trim()).filter(Boolean);
    };

    const updateTogglesState = async () => {
      const escalaId = document.getElementById('analiseFilterEscala')?.value || '';
      const ministerios = getLeaderMinisterios();

      if (!escalaId || !ministerios.length) {
        wrapToggle.style.display = 'none';
        togglesListEl.innerHTML = '';
        hintEl.textContent = '';
        return;
      }

      // Se a escala geral estiver concluída, desabilita todos os toggles
      const escalaObj = Array.isArray(escalasList) ? escalasList.find(e => String(e._id) === String(escalaId)) : null;
      const isEscalaConcluida = !!(escalaObj && escalaObj.ativo === false);
      wrapToggle.style.display = '';
      togglesListEl.innerHTML = '';

      if (isEscalaConcluida) {
        hintEl.textContent = 'Escala concluída: sem inscrições.';
        togglesListEl.innerHTML = ministerios.map((m, i) => `
          <div class="escala-ministerio-toggle-row" style="display:flex;align-items:center;gap:12px;justify-content:space-between">
            <div style="font-weight:600">${escapeHtml(m)}</div>
            <button type="button" class="btn btn-ghost btn-sm" disabled>Escala concluída</button>
            <span style="color:var(--text-muted);font-size:.9em"></span>
          </div>
        `).join('');
        return;
      }

      hintEl.textContent = 'Controle por ministério (se estiver fechado, bloqueia novas inscrições desse ministério).';

      // HTML base + busca em paralelo
      togglesListEl.innerHTML = ministerios.map((m, i) => `
        <div class="escala-ministerio-toggle-row" style="display:flex;align-items:center;gap:12px;justify-content:space-between">
          <div style="font-weight:600">${escapeHtml(m)}</div>
          <button type="button" class="btn btn-ghost btn-sm" data-ministerio-toggle-index="${i}" data-ministerio="${escapeAttr(m)}" data-ativo="true" disabled>Carregando...</button>
          <span class="escala-ministerio-toggle-status" data-ministerio-status-index="${i}" style="color:var(--text-muted);font-size:.9em"></span>
        </div>
      `).join('');

      const fetchStatusFor = async (ministerio, i) => {
        try {
          const r = await authFetch(
            `${API_BASE}/api/escalas/${encodeURIComponent(escalaId)}/inscricoes-por-ministerio?ministerio=${encodeURIComponent(ministerio)}`
          );
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
          const data = await r.json();
          const ativo = data.ativo !== false;
          return { i, ministerio, ativo };
        } catch (e) {
          return { i, ministerio, error: e?.message || 'Erro ao carregar' };
        }
      };

      const results = await Promise.all(ministerios.map((m, i) => fetchStatusFor(m, i)));
      results.forEach((r) => {
        const btn = togglesListEl.querySelector(`button[data-ministerio-toggle-index="${r.i}"]`);
        const st = togglesListEl.querySelector(`span[data-ministerio-status-index="${r.i}"]`);
        if (!btn || !st) return;
        if (r.error) {
          btn.disabled = false;
          btn.textContent = 'Erro';
          st.textContent = r.error;
          return;
        }
        btn.disabled = false;
        btn.dataset.ativo = String(r.ativo);
        btn.textContent = r.ativo ? 'Fechar inscrições' : 'Reabrir inscrições';
        st.textContent = r.ativo ? 'Aberta' : 'Fechada';
      });
    };

    // Delegação: um único listener para todos os botões re-renderizados
    togglesListEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-ministerio-toggle-index]');
      if (!btn) return;
      const ministerioAtual = btn.getAttribute('data-ministerio') || '';
      const escalaId = document.getElementById('analiseFilterEscala')?.value || '';
      if (!escalaId || !ministerioAtual) return;

      const ativoAtual = btn.dataset.ativo === 'true';
      const novoAtivo = !ativoAtual;

      btn.disabled = true;
      btn.textContent = novoAtivo ? 'Reabrindo...' : 'Fechando...';

      const row = btn.closest('.escala-ministerio-toggle-row');
      const st = row ? row.querySelector('.escala-ministerio-toggle-status') : null;
      if (st) st.textContent = '';

      try {
        const r = await authFetch(
          `${API_BASE}/api/escalas/${encodeURIComponent(escalaId)}/inscricoes-por-ministerio`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ministerio: ministerioAtual, ativo: novoAtivo }),
          }
        );
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
        await updateTogglesState();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Erro';
        if (st) st.textContent = err?.message || 'Erro ao atualizar';
      }
    });

    document.getElementById('analiseFilterEscala')?.addEventListener('change', updateTogglesState);
    // Carrega estado inicial (se já houver escala pré-selecionada)
    setTimeout(updateTogglesState, 0);
  }
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
    return `<option value="${escapeAttr(String(e._id))}">${escapeHtml(e.nome)}</option>`;
  }).join('');
  const ministeriosUnicos = [...new Set(candidaturasAll.map((c) => (c.ministerio || '').trim()).filter(Boolean))].sort();
  const ministeriosOptions = ministeriosUnicos.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('');
  const datasUnicas = [...new Set(candidaturasAll.map((c) => escalaDataToYMD(c.escalaData)).filter(Boolean))].sort().reverse();
  const datasOptions = datasUnicas.map((d) => `<option value="${escapeAttr(d)}">${formatEscalaDateOnly(d)}</option>`).join('');

  container.innerHTML = buildAnalisePanelHtml(escalasOptions, ministeriosOptions, datasOptions);
  bindAnalisePanelEvents(container);
  renderAnaliseTab();
}

/** Escala → Candidatos (lider): mesmo painel, sem tab criar */
function renderEscalasCandidatosLider() {
  const container = document.getElementById('escalasContent');
  if (!container) return;
  const hasMinisterios = (authMinisterioNomes && authMinisterioNomes.length > 0) || (authMinisterioNome && String(authMinisterioNome).trim());
  if (!hasMinisterios) {
    container.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Seu usuário ainda não tem ministério(s) vinculado(s). Peça a um administrador para definir seus ministérios em <strong>Ministros</strong> &gt; <strong>Definir líderes</strong>. Depois, atualize a página (F5) para carregar os candidatos.</p></div>';
    return;
  }
  if (!escalasList.length) {
    container.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Nenhuma escala disponível no momento.</p></div>';
    return;
  }

  const leaderMinisterios = Array.isArray(authMinisterioNomes) && authMinisterioNomes.length > 0
    ? authMinisterioNomes
    : (authMinisterioNome ? [authMinisterioNome] : []);
  const leaderMinisteriosClean = [...new Set(leaderMinisterios.map(m => String(m || '').trim()).filter(Boolean))];

  const openEscalas = sortEscalasByDataAsc(
    (Array.isArray(escalasList) ? escalasList : []).filter((e) => e && e.candidaturaAberta === true),
  );
  const ig = getTenantSlugForLinks();

  const openLinksHtml = (openEscalas.length && leaderMinisteriosClean.length)
    ? `
      <section class="filters-row" style="margin-bottom:16px">
        <div class="filters-card" style="width:100%">
          <h3 style="font-size:1.05rem;margin-bottom:10px">Escalas abertas (copie o link)</h3>
          <p class="auth-subtitle" style="margin:0 0 14px;color:var(--text-muted);font-size:.95em">
            Links já pré-parametrizados para o seu(s) ministério(s).
          </p>
          <div style="display:flex;flex-direction:column;gap:12px">
            ${openEscalas.map(e => `
              <div style="border-top:1px solid var(--border-color);padding-top:12px">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
                  <div>
                    <div style="font-weight:700">${escapeHtml(e.nome || '—')}</div>
                    <div style="color:var(--text-muted);font-size:.9em;margin-top:2px">
                      Data: ${escapeHtml(formatEscalaDateOnly(e.data || ''))}
                    </div>
                  </div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
                    ${leaderMinisteriosClean.map((m) => `
                      <button
                        type="button"
                        class="btn btn-sm btn-primary"
                        data-escala-open-copy="${escapeAttr(String(e._id))}"
                        data-escala-open-copy-ministerio="${escapeAttr(String(m))}"
                        title="Copiar link para seu ministério"
                      >
                        Copiar link (${escapeHtml(m)})
                      </button>
                    `).join('')}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </section>
    `
    : '';

  const escalasOptions = escalasList.map((e) => {
    return `<option value="${escapeAttr(String(e._id))}">${escapeHtml(e.nome)}</option>`;
  }).join('');
  const ministeriosUnicos = [...new Set(candidaturasAll.map((c) => (c.ministerio || '').trim()).filter(Boolean))].sort();
  const ministeriosOptions = ministeriosUnicos.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('');
  const datasUnicas = [...new Set(candidaturasAll.map((c) => escalaDataToYMD(c.escalaData)).filter(Boolean))].sort().reverse();
  const datasOptions = datasUnicas.map((d) => `<option value="${escapeAttr(d)}">${formatEscalaDateOnly(d)}</option>`).join('');

  container.innerHTML = openLinksHtml + buildAnalisePanelHtml(escalasOptions, ministeriosOptions, datasOptions);
  bindAnalisePanelEvents(container);
  renderAnaliseTab();

  container.querySelectorAll('[data-escala-open-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const escalaId = btn.getAttribute('data-escala-open-copy') || '';
      const ministerio = btn.getAttribute('data-escala-open-copy-ministerio') || '';
      if (!escalaId || !ministerio) return;
      const url = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}?escala=${encodeURIComponent(escalaId)}&ministerio=${encodeURIComponent(ministerio)}&igreja=${encodeURIComponent(ig)}`;
      try {
        await navigator.clipboard.writeText(url);
        alert('Link copiado!');
      } catch (_) {
        prompt('Copie o link:', url);
      }
    });
  });
}

// ─── Voluntário: visão unificada de "Meus cultos" (Fase 3) ─────────────────
function renderMeusCultos(itens) {
  const container = document.getElementById('escalasContent');
  if (!container) return;
  const list = Array.isArray(itens) ? itens : [];
  if (!list.length) {
    container.innerHTML = '<div class="filters-card"><p class="auth-subtitle">Nenhum culto disponível no momento. Aguarde a liderança abrir uma nova escala.</p></div>';
    return;
  }

  // 3 grupos: ação agora (check-in aberto), próximos (aprovada/pendente/aberta), histórico (presente/faltou/recusada e passados)
  const acaoAgora = [];
  const proximos = [];
  const passados = [];
  for (const it of list) {
    if (it.situacao === 'checkin-aberto') acaoAgora.push(it);
    else if (['presente', 'faltou', 'recusada'].includes(it.situacao)) passados.push(it);
    else proximos.push(it);
  }

  const renderCard = (it) => {
    const data = formatEscalaDateOnly(it.escalaData);
    const ministerio = it.ministerio ? escapeHtml(it.ministerio) : '';
    let badge = '';
    let cta = '';
    switch (it.situacao) {
      case 'checkin-aberto':
        badge = '<span class="status-badge" style="background:#dcfce7;color:#166534;border:1px solid #86efac;font-weight:600">Check-in aberto agora</span>';
        cta = `<button type="button" class="btn btn-primary btn-meu-checkin" data-evento-id="${escapeAttr(it.eventoCheckinId || '')}" data-ministerio="${escapeAttr(it.ministerio || '')}">Fazer check-in</button>`;
        break;
      case 'aprovada':
        badge = '<span class="status-badge" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d">Aprovado — aguardando o dia</span>';
        cta = '<span style="color:var(--text-muted);font-size:.88em">O botão de check-in aparece quando abrir.</span>';
        break;
      case 'pendente':
        badge = '<span class="status-badge" style="background:#e0e7ff;color:#3730a3;border:1px solid #a5b4fc">Aguardando aprovação</span>';
        cta = '<span style="color:var(--text-muted);font-size:.88em">A liderança vai revisar sua inscrição.</span>';
        break;
      case 'aberta-nao-inscrita':
        if (it.candidaturaAberta === false) {
          badge = '<span class="status-badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1">Inscrições encerradas</span>';
          cta = '<span style="color:var(--text-muted);font-size:.88em">As inscrições para este culto não estão abertas.</span>';
        } else {
          badge = '<span class="status-badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1">Aberta para inscrição</span>';
          cta = `<button type="button" class="btn btn-primary btn-me-inscrever" data-escala-id="${escapeAttr(it.escalaId)}">Me inscrever</button>`;
        }
        break;
      case 'presente':
        badge = '<span class="status-badge" style="background:#dcfce7;color:#166534;border:1px solid #86efac">Presente</span>';
        cta = '<span style="color:var(--text-muted);font-size:.88em">Obrigado por servir!</span>';
        break;
      case 'faltou':
        badge = '<span class="status-badge" style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5">Faltou</span>';
        cta = '';
        break;
      case 'recusada':
        badge = '<span class="status-badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1">Não participou</span>';
        cta = '';
        break;
      default:
        badge = `<span class="status-badge">${escapeHtml(it.situacao || '—')}</span>`;
    }
    return `
      <div class="filters-card" style="margin-bottom:12px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="flex:1 1 240px;min-width:0">
            <h3 style="font-size:1.05rem;margin-bottom:4px">${escapeHtml(it.escalaNome || '—')}</h3>
            <div style="color:var(--text-muted);font-size:.92em;margin-bottom:6px">${escapeHtml(data)}${ministerio ? ` · ${ministerio}` : ''}</div>
            <div>${badge}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">${cta}</div>
        </div>
      </div>`;
  };

  const section = (titulo, arr) => arr.length
    ? `<div style="margin-bottom:20px"><h2 style="font-size:1.15rem;margin-bottom:10px;color:var(--text-color)">${escapeHtml(titulo)}</h2>${arr.map(renderCard).join('')}</div>`
    : '';

  container.innerHTML = `
    ${section('Faça check-in agora', acaoAgora)}
    ${section('Próximos cultos', proximos)}
    ${section('Histórico', passados)}
  `;

  container.querySelectorAll('.btn-me-inscrever').forEach((btn) => {
    btn.addEventListener('click', () => {
      const escalaId = btn.getAttribute('data-escala-id');
      if (!escalaId) return;
      showEscalaPublicOverlay();
      loadEscalaPublic(escalaId, '');
    });
  });
  container.querySelectorAll('.btn-meu-checkin').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eventoId = btn.getAttribute('data-evento-id');
      const ministerio = btn.getAttribute('data-ministerio') || '';
      if (!eventoId) return;
      btn.disabled = true; btn.textContent = 'Confirmando…';
      try {
        const r = await authFetch(`${API_BASE}/api/checkins/confirmar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventoId, ministerio }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || 'Falha ao confirmar check-in.');
        btn.disabled = false; btn.textContent = 'Fazer check-in';
        await maybeOfferPerfilCheckinComplemento(() => {
          showToast('Check-in confirmado!');
          fetchEscalas();
        });
      } catch (err) {
        showToast(err.message || 'Erro ao confirmar.', 'error');
        btn.disabled = false; btn.textContent = 'Fazer check-in';
      }
    });
  });
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
  const waBtn = (c) => (c.status === 'aprovado' && c.telefone && validarWhatsApp(c.telefone))
    ? `<button type="button" class="btn btn-sm btn-ghost" data-cand-wa="${escapeAttr(String(c._id))}" title="Abrir WhatsApp (grátis) com aviso e link de check-in">WhatsApp</button>`
    : '';
  const acoesTpl = (c) => isAdmin
    ? `<div class="escala-cand-actions"><button class="btn btn-sm btn-primary" data-cand-id="${escapeAttr(String(c._id))}" data-cand-action="aprovado" ${c.status === 'aprovado' ? 'disabled' : ''}>Aprovar</button>
       ${waBtn(c)}
       <button class="btn btn-sm btn-ghost" data-cand-id="${escapeAttr(String(c._id))}" data-cand-action="desistencia">Desist.</button>
       <button class="btn btn-sm btn-ghost" data-cand-id="${escapeAttr(String(c._id))}" data-cand-action="falta">Falta</button></div>`
    : `<div class="escala-cand-actions"><button class="btn btn-sm btn-primary" data-cand-id="${escapeAttr(String(c._id))}" data-cand-action="aprovado" ${c.status === 'aprovado' ? 'disabled' : ''}>Aprovar</button>
       ${waBtn(c)}
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
      const cand = filtered.find((c) => String(c._id) === String(id)) || list.find((c) => String(c._id) === String(id));
      const ok = await atualizarStatusCandidatura(id, action, cand ? {
        escalaId, nome: cand.nome, telefone: cand.telefone,
      } : null);
      if (ok) fetchCandidaturasEscala(escalaId);
    });
  });
  panel.querySelectorAll('[data-cand-wa]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-cand-wa');
      const cand = filtered.find((c) => String(c._id) === String(id)) || list.find((c) => String(c._id) === String(id));
      if (!cand) return;
      try {
        await abrirWhatsAppMensagemEscala({ escalaId, nome: cand.nome, telefone: cand.telefone });
      } catch (e) { alert(e.message || 'Erro ao abrir WhatsApp.'); }
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

async function abrirWhatsAppMensagemEscala({ escalaId, nome, telefone }) {
  if (!telefone || !validarWhatsApp(telefone)) {
    alert('Cadastre um telefone válido (DDD + número) para avisar por WhatsApp.');
    return;
  }
  const q = new URLSearchParams({
    escalaId: String(escalaId || ''),
    nome: String(nome || ''),
    telefone: String(telefone).replace(/\D/g, ''),
  });
  const r = await authFetch(`${API_BASE}/api/whatsapp/mensagem-escala?${q}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Falha ao montar mensagem.');
  if (data.waUrl) window.open(data.waUrl, '_blank', 'noopener');
  else alert('Link do WhatsApp indisponível.');
}

async function atualizarStatusCandidatura(id, status, meta = null) {
  try {
    const r = await authFetch(`${API_BASE}/api/candidaturas/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    if (status === 'aprovado' && meta?.telefone && validarWhatsApp(meta.telefone) && meta.escalaId) {
      if (confirm('Participação confirmada.\n\nAbrir WhatsApp para enviar o aviso com link de check-in? (grátis — você envia do seu número)')) {
        await abrirWhatsAppMensagemEscala({
          escalaId: meta.escalaId,
          nome: meta.nome,
          telefone: meta.telefone,
        });
      }
    }
    return true;
  } catch (e) {
    alert(e.message || 'Erro ao atualizar status.');
    return false;
  }
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
  await excluirEscalasPorIds([id]);
}

async function excluirEscalasSelecionadas() {
  const ids = [...selectedEscalaIds];
  if (!ids.length) {
    alert('Selecione ao menos uma escala.');
    return;
  }
  await excluirEscalasPorIds(ids);
}

function normalizeExcluirEscalaIds(input) {
  const arr = Array.isArray(input) ? input : [input];
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
}

function sumCandidaturasEscalas(ids) {
  return ids.reduce((sum, id) => {
    const e = escalasList.find((x) => String(x._id) === String(id));
    return sum + (Number(e?.totalCandidaturas) || 0);
  }, 0);
}

async function excluirEscalasPorIds(input) {
  const ids = normalizeExcluirEscalaIds(input);
  if (!ids.length) return;
  const totalCand = sumCandidaturasEscalas(ids);
  if (totalCand > 0) {
    openModalExcluirEscala(ids);
    return;
  }
  const label = ids.length === 1
    ? `"${(escalasList.find((e) => String(e._id) === ids[0])?.nome || '').replace(/"/g, '')}"`
    : `${ids.length} escalas`;
  if (!confirm(`Excluir ${label}? Esta ação não pode ser desfeita.`)) return;
  await executarExclusaoEscalas(ids, {});
}

function listEscalasFuturasAtivas(excludeIds) {
  const exclude = new Set(normalizeExcluirEscalaIds(excludeIds));
  const hoje = getHojeDateString();
  return (Array.isArray(escalasList) ? escalasList : []).filter((e) => {
    if (exclude.has(String(e._id))) return false;
    if (e.ativo === false) return false;
    const ymd = escalaDataToYMD(e.data);
    return ymd && ymd >= hoje;
  });
}

function getExcluirEscalaIdsFromModal() {
  const raw = document.getElementById('excluirEscalaIds')?.value || '';
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return normalizeExcluirEscalaIds(parsed);
  } catch (_) { /* legado */ }
  const legacy = (document.getElementById('excluirEscalaId')?.value || '').trim();
  return legacy ? [legacy] : [];
}

function openModalExcluirEscala(input) {
  const ids = normalizeExcluirEscalaIds(input);
  if (!ids.length) return;
  const modal = document.getElementById('modalExcluirEscala');
  if (!modal) return;
  const total = sumCandidaturasEscalas(ids);
  const msg = document.getElementById('modalExcluirEscalaMsg');
  const idsEl = document.getElementById('excluirEscalaIds');
  const legacyIdEl = document.getElementById('excluirEscalaId');
  const titleEl = document.getElementById('modalExcluirEscalaTitle');
  const confirmBtn = document.getElementById('btnConfirmExcluirEscala');
  const sel = document.getElementById('excluirEscalaRedirectSelect');
  const redirectGroup = document.getElementById('excluirEscalaRedirectGroup');
  const semDestino = document.getElementById('excluirEscalaSemDestino');
  const forceCb = document.getElementById('excluirEscalaForce');
  if (idsEl) idsEl.value = JSON.stringify(ids);
  if (legacyIdEl) legacyIdEl.value = ids.length === 1 ? ids[0] : '';
  if (titleEl) titleEl.textContent = ids.length === 1 ? 'Excluir escala' : `Excluir ${ids.length} escalas`;
  if (confirmBtn) confirmBtn.textContent = ids.length === 1 ? 'Excluir escala' : `Excluir ${ids.length} escalas`;
  const forceText = document.getElementById('excluirEscalaForceText');
  if (forceText) {
    forceText.textContent = ids.length === 1
      ? 'Excluir sem redirecionar (apaga todas as inscrições desta escala)'
      : 'Excluir sem redirecionar (apaga todas as inscrições das escalas selecionadas)';
  }
  if (msg) {
    if (ids.length === 1) {
      const escala = escalasList.find((e) => String(e._id) === ids[0]);
      msg.textContent = `A escala "${escala?.nome || '—'}" tem ${total} candidatura(s). Você pode mover as inscrições para outra escala futura ativa antes de excluir.`;
    } else {
      msg.textContent = `${ids.length} escalas selecionadas, com ${total} candidatura(s) no total. Você pode mover todas as inscrições para uma escala futura ativa antes de excluir.`;
    }
  }
  const destinos = listEscalasFuturasAtivas(ids);
  if (sel) {
    sel.innerHTML = destinos.length
      ? '<option value="">Selecione uma escala…</option>'
        + destinos.map((e) => {
          const data = formatEscalaDateOnly(e.data);
          return `<option value="${escapeAttr(String(e._id))}">${escapeHtml(e.nome || '—')} — ${escapeHtml(data)}</option>`;
        }).join('')
      : '<option value="">Nenhuma escala futura ativa disponível</option>';
    sel.disabled = destinos.length === 0;
  }
  if (redirectGroup) redirectGroup.style.display = destinos.length ? '' : 'none';
  if (semDestino) semDestino.style.display = destinos.length ? 'none' : '';
  if (forceCb) forceCb.checked = destinos.length === 0;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModalExcluirEscala() {
  const modal = document.getElementById('modalExcluirEscala');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

async function executarExclusaoEscalas(ids, { redirectToEscalaId, forceWithoutRedirect } = {}) {
  const normalized = normalizeExcluirEscalaIds(ids);
  if (!normalized.length) return;
  try {
    let r;
    let data = {};
    if (normalized.length === 1) {
      r = await authFetch(`${API_BASE}/api/escalas/${encodeURIComponent(normalized[0])}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirectToEscalaId: redirectToEscalaId || undefined, forceWithoutRedirect: !!forceWithoutRedirect }),
      });
      data = await r.json().catch(() => ({}));
    } else {
      r = await authFetch(`${API_BASE}/api/escalas/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: normalized,
          redirectToEscalaId: redirectToEscalaId || undefined,
          forceWithoutRedirect: !!forceWithoutRedirect,
        }),
      });
      data = await r.json().catch(() => ({}));
    }
    if (r.status === 409 && data.needRedirect) {
      openModalExcluirEscala(normalized);
      return;
    }
    if (!r.ok) throw new Error(data.error || 'Falha ao excluir escala(s).');
    closeModalExcluirEscala();
    normalized.forEach((id) => selectedEscalaIds.delete(id));
    const deleted = normalized.length === 1 ? 1 : (Number(data.deleted) || normalized.length);
    const moved = Number(data.moved) || 0;
    if (data.redirectedTo && moved > 0) {
      alert(`${moved} inscrição(ões) redirecionada(s). ${deleted} escala(s) excluída(s).`);
    } else if (data.redirectedTo) {
      alert(`${deleted} escala(s) excluída(s). Inscrições já existentes na escala de destino foram mantidas.`);
    } else if (deleted > 1) {
      alert(`${deleted} escalas excluídas.`);
    }
    await fetchEscalasCriar();
  } catch (e) {
    alert(e.message || 'Erro ao excluir escala(s).');
  }
}

async function confirmarExclusaoEscalaComOpcoes() {
  const ids = getExcluirEscalaIdsFromModal();
  if (!ids.length) return;
  const force = document.getElementById('excluirEscalaForce')?.checked === true;
  const redirectToEscalaId = (document.getElementById('excluirEscalaRedirectSelect')?.value || '').trim();
  const total = sumCandidaturasEscalas(ids);
  if (total > 0 && !force && !redirectToEscalaId) {
    alert('Selecione uma escala de destino ou marque "Excluir sem redirecionar".');
    return;
  }
  const n = ids.length;
  if (force) {
    const msg = n === 1
      ? `Excluir a escala selecionada e remover ${total} inscrição(ões)? Esta ação não pode ser desfeita.`
      : `Excluir ${n} escalas e remover ${total} inscrição(ões)? Esta ação não pode ser desfeita.`;
    if (!confirm(msg)) return;
    await executarExclusaoEscalas(ids, { forceWithoutRedirect: true });
    return;
  }
  const dest = escalasList.find((e) => String(e._id) === redirectToEscalaId);
  const destLabel = dest ? `${dest.nome} (${formatEscalaDateOnly(dest.data)})` : 'escala selecionada';
  const msg = n === 1
    ? `Excluir a escala e mover ${total} inscrição(ões) para "${destLabel}"?`
    : `Excluir ${n} escalas e mover ${total} inscrição(ões) para "${destLabel}"?`;
  if (!confirm(msg)) return;
  await executarExclusaoEscalas(ids, { redirectToEscalaId });
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
  const capEl = document.getElementById('editarEscalaCapacidades');
  if (capEl) capEl.value = capacidadesToTextarea(escala.capacidades);
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
}

// ─── Form handlers: nova e editar escala ─────────────────────────────────────
// Aceita formato "Min: 8" por linha; valores inválidos/zerados são ignorados.
function parseCapacidadesTextarea(text) {
  const out = {};
  if (!text) return out;
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([^:]+?)\s*:\s*(\d+)\s*$/);
    if (!m) continue;
    const min = m[1].trim();
    const n = parseInt(m[2], 10);
    if (min && Number.isFinite(n) && n > 0) out[min] = n;
  }
  return out;
}
function capacidadesToTextarea(cap) {
  if (!cap || typeof cap !== 'object') return '';
  return Object.entries(cap)
    .filter(([k, v]) => k && Number(v) > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

document.getElementById('formNovaEscala')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('escalaNovoNome')?.value?.trim();
  const data = document.getElementById('escalaNovaData')?.value || '';
  const descricao = document.getElementById('escalaNovaDescricao')?.value?.trim() || '';
  const ativo = document.getElementById('escalaNovoAtivo')?.checked !== false;
  const criarEventoCheckin = document.getElementById('escalaNovoCriarCheckin')?.checked !== false;
  const horarioInicio = document.getElementById('escalaNovoHorarioInicio')?.value || '';
  const horarioFim = document.getElementById('escalaNovoHorarioFim')?.value || '';
  const capacidades = parseCapacidadesTextarea(document.getElementById('escalaNovoCapacidades')?.value);
  if (!nome) return;
  try {
    const r = await authFetch(`${API_BASE}/api/escalas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome, data: data || undefined, descricao, ativo,
        criarEventoCheckin, horarioInicio, horarioFim, capacidades,
      }),
    });
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
  const capacidades = parseCapacidadesTextarea(document.getElementById('editarEscalaCapacidades')?.value);
  try {
    const r = await authFetch(`${API_BASE}/api/escalas/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, data: data || null, descricao, ativo, capacidades }),
    });
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

document.getElementById('btnConfirmExcluirEscala')?.addEventListener('click', () => { void confirmarExclusaoEscalaComOpcoes(); });
['modalExcluirEscalaClose', 'modalExcluirEscalaCancel'].forEach((id) => {
  document.getElementById(id)?.addEventListener('click', closeModalExcluirEscala);
});
document.getElementById('modalExcluirEscala')?.querySelector('.modal-backdrop')?.addEventListener('click', closeModalExcluirEscala);
document.getElementById('excluirEscalaForce')?.addEventListener('change', (ev) => {
  const sel = document.getElementById('excluirEscalaRedirectSelect');
  if (sel) sel.disabled = ev.target.checked;
});

let _modalCopiarLinkEscalaId = null;
let _modalCopiarLinkMinisterios = [];
async function openModalCopiarLinkMinisterio(escalaId) {
  _modalCopiarLinkEscalaId = (escalaId || '').toString().trim();
  _modalCopiarLinkMinisterios = [];
  const modal = document.getElementById('modalCopiarLinkMinisterio');
  const sel = document.getElementById('modalCopiarLinkMinisterioSelect');
  if (!modal || !sel) return;
  sel.innerHTML = '<option value="">Carregando…</option>';
  sel.disabled = true;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  const listWrap = document.getElementById('modalCopiarLinkMinisterioListWrap');
  const listArea = document.getElementById('modalCopiarLinkMinisterioList');
  try {
    const ig = getTenantSlugForLinks();
    const r = await fetch(`${API_BASE}/api/escala-publica/${encodeURIComponent(_modalCopiarLinkEscalaId)}?igreja=${encodeURIComponent(ig)}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.concluida) {
      sel.innerHTML = '<option value="">Escala não encontrada ou inativa</option>';
      if (listWrap) listWrap.style.display = 'none';
    } else {
      const list = Array.isArray(data.ministerios) && data.ministerios.length > 0 ? data.ministerios : MINISTERIOS_PADRAO;
      _modalCopiarLinkMinisterios = list.slice();
      sel.innerHTML = '<option value="">Selecione o ministério</option>' + list.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('');
      const base = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}`;
      const blocks = list.map((m) => {
        const url = `${base}?escala=${encodeURIComponent(_modalCopiarLinkEscalaId)}&ministerio=${encodeURIComponent(m)}&igreja=${encodeURIComponent(ig)}`;
        return `${m}\n${url}`;
      });
      const text = blocks.join('\n\n');
      if (listArea) listArea.value = text;
      if (listWrap) listWrap.style.display = 'block';
    }
    sel.disabled = false;
  } catch (_) {
    sel.innerHTML = '<option value="">Erro ao carregar</option>';
    sel.disabled = false;
    if (listWrap) listWrap.style.display = 'none';
  }
}
['modalCopiarLinkMinisterioClose', 'modalCopiarLinkMinisterioCancel'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => {
    document.getElementById('modalCopiarLinkMinisterio')?.classList.remove('open');
  });
});
document.getElementById('modalCopiarLinkMinisterio')?.querySelector('.modal-backdrop')?.addEventListener('click', () => {
  document.getElementById('modalCopiarLinkMinisterio')?.classList.remove('open');
});
document.getElementById('modalCopiarLinkMinisterioCopiar')?.addEventListener('click', () => {
  const sel = document.getElementById('modalCopiarLinkMinisterioSelect');
  const ministerio = sel?.value?.trim();
  if (!_modalCopiarLinkEscalaId || !ministerio) {
    alert('Selecione um ministério.');
    return;
  }
  const base = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}`;
  const ig = getTenantSlugForLinks();
  const url = `${base}?escala=${encodeURIComponent(_modalCopiarLinkEscalaId)}&ministerio=${encodeURIComponent(ministerio)}&igreja=${encodeURIComponent(ig)}`;
  navigator.clipboard.writeText(url).then(() => {
    alert('Link copiado! Quem abrir só poderá se candidatar a esse ministério.');
    document.getElementById('modalCopiarLinkMinisterio')?.classList.remove('open');
  }).catch(() => prompt('Copie o link:', url));
});
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
  const appShell = document.querySelector('.app-shell');
  if (appShell) appShell.style.display = 'none';
}

function restoreAppShellFromPublicForm() {
  const appShell = document.querySelector('.app-shell');
  if (appShell) appShell.style.display = '';
}

function showEscalaPublicOverlay() {
  preparePublicFormSession();
  hideAllPublicOverlays();
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

function finishEscalaPublicInscricaoSuccess() {
  const form = document.getElementById('escalaPublicForm');
  const successWrap = document.getElementById('escalaPublicSuccessWrap');
  if (form) form.style.display = 'none';
  if (successWrap) successWrap.style.display = '';
}

async function loadEscalaPublic(escalaId, ministerioFromUrl) {
  const labelEl = document.getElementById('escalaPublicLabel');
  const subtitleEl = document.getElementById('escalaPublicSubtitle');
  const ministerioSel = document.getElementById('escalaPublicMinisterio');
  const ministerioWrap = document.getElementById('escalaPublicMinisterioWrap');
  const errorEl = document.getElementById('escalaPublicError');
  const successEl = document.getElementById('escalaPublicSuccess');

  if (subtitleEl) subtitleEl.textContent = 'Carregando…';
  if (ministerioSel) ministerioSel.selectedIndex = 0;
  const formEl = document.getElementById('escalaPublicForm');
  const concluidaWrap = document.getElementById('escalaPublicConcluidaWrap');

  const escalaIdClean = (escalaId || '').toString().trim();
  const ministerioParam = (ministerioFromUrl || '').toString().trim();
  if (!escalaIdClean) {
    if (subtitleEl) subtitleEl.textContent = 'Link inválido. Verifique o endereço.';
    return;
  }

  try {
    const ig = getTenantSlugForLinks();
    const qs = new URLSearchParams();
    qs.set('igreja', ig);
    if (ministerioParam) qs.set('ministerio', ministerioParam);
    const url = `${API_BASE}/api/escala-publica/${encodeURIComponent(escalaIdClean)}?${qs}`;
    const r = await fetch(url);
    let data = {};
    try {
      const text = await r.text();
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      if (subtitleEl) subtitleEl.textContent = 'Erro ao carregar dados da escala.';
      return;
    }
    if (!r.ok) {
      if (subtitleEl) subtitleEl.textContent = data.error || 'Escala não encontrada ou não está ativa.';
      return;
    }
    if (data.concluida) {
      const nome = data.escala?.nome || 'Escala';
      if (subtitleEl) subtitleEl.textContent = nome;
      if (formEl) formEl.style.display = 'none';
      if (concluidaWrap) concluidaWrap.style.display = 'block';
      if (concluidaWrap) concluidaWrap.querySelector('p').textContent = data.mensagem || 'A escala deste culto já foi concluída.';
      return;
    }
    const nome = data.escala?.nome || 'Escala';
    if (subtitleEl) subtitleEl.textContent = nome;
    if (labelEl) labelEl.textContent = data.escala?.descricao || '';
    const list = Array.isArray(data.ministerios) && data.ministerios.length > 0 ? data.ministerios : MINISTERIOS_PADRAO;
    const ministerioFixo = data.ministerioFixo || null;
    if (ministerioFixo) {
      if (ministerioSel) {
        ministerioSel.innerHTML = `<option value="${escapeAttr(ministerioFixo)}">${escapeHtml(ministerioFixo)}</option>`;
        ministerioSel.value = ministerioFixo;
        ministerioSel.disabled = true;
      }
      if (ministerioWrap) {
        const hint = ministerioWrap.querySelector('.form-hint-ministerio');
        if (hint) hint.textContent = 'Este link é apenas para o ministério indicado.';
      }
    } else {
      if (ministerioSel) ministerioSel.disabled = false;
      setMinisterioSelectOptions(ministerioSel, list);
      if (ministerioWrap) {
        const hint = ministerioWrap.querySelector('.form-hint-ministerio');
        if (hint) hint.textContent = '';
      }
    }
    if (formEl) formEl.style.display = '';
    if (concluidaWrap) concluidaWrap.style.display = 'none';
    if (authToken && authEmail) {
      const nomeIn = document.getElementById('escalaPublicNome');
      const emailIn = document.getElementById('escalaPublicEmail');
      if (emailIn && !emailIn.value.trim()) emailIn.value = authEmail;
      if (nomeIn && !nomeIn.value.trim() && authUser) nomeIn.value = authUser;
    }
  } catch (e) {
    console.error('loadEscalaPublic:', e);
    if (subtitleEl) subtitleEl.textContent = 'Erro ao carregar dados da escala. Verifique a conexão e tente novamente.';
  }

  document.getElementById('btnEscalaPublicVerMinhas')?.addEventListener('click', () => {
    const overlay = document.getElementById('escalaPublicOverlay');
    if (overlay) overlay.style.display = 'none';
    restoreAppShellFromPublicForm();
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
        body: JSON.stringify({
          escalaId: escalaIdClean, nome, email, telefone, ministerio,
          igrejaSlug: getTenantSlugForLinks(),
        }),
      });
      const data = await r.json();
      if (!r.ok && r.status !== 200) throw new Error(data.error || 'Erro ao enviar candidatura.');
      const logged = (authEmail || '').toString().trim().toLowerCase();
      const sub = (email || '').toString().trim().toLowerCase();
      const afterSuccess = () => {
        finishEscalaPublicInscricaoSuccess();
        if (btn) btn.disabled = false;
      };
      if (authToken && logged && sub && logged === sub) {
        await maybeOfferPerfilCheckinComplemento(afterSuccess);
      } else {
        afterSuccess();
      }
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
    for (let i = 0; i < to.length; i += BATCH_SIZE) {
      const chunk = to.slice(i, i + BATCH_SIZE);
      const voluntariosMap = {};
      chunk.forEach((email) => {
        const nome = resolveNomeForSendEmail(email);
        if (nome) voluntariosMap[email] = nome;
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
      const fullMap = {};
      to.forEach((email) => {
        const nome = resolveNomeForSendEmail(email);
        if (nome) fullMap[email] = nome;
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
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (loginInProgress) return;
  loginInProgress = true;
  authVerifyGeneration += 1;
  if (loginError) { loginError.textContent = ''; loginError.style.color = ''; loginError.removeAttribute('role'); }
  const savedLogin = (loginEmail?.value || '').trim();
  const login = savedLogin;
  const password = (loginPass?.value || '').trim();
  const loginIgrejaWrap = document.getElementById('loginIgrejaWrap');
  const loginIgrejaSelect = document.getElementById('loginIgrejaSelect');
  const igrejaSlugChosen = (loginIgrejaWrap && loginIgrejaWrap.style.display !== 'none' && loginIgrejaSelect?.value)
    ? loginIgrejaSelect.value.trim()
    : '';
  if (btnLogin) {
    btnLogin.disabled = true;
    btnLogin.textContent = 'Entrando...';
  }
  let loginFullySucceeded = false;
  try {
    if (!login || !password) {
      showLoginError('Informe email/usuário e senha.');
      return;
    }
    if (authToken) {
      clearAuthSession();
    }
    const payload = { username: login, email: login, password };
    if (igrejaSlugChosen) payload.igrejaSlug = igrejaSlugChosen;
    let r;
    try {
      r = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (netErr) {
      showLoginError('Não foi possível contactar o servidor.', netErr.message || 'verifique sua conexão');
      return;
    }
    let data = {};
    try {
      data = await r.json();
    } catch (_) {
      showLoginError('Resposta inválida do servidor.', `HTTP ${r.status}`);
      return;
    }
    if (r.status === 409 && data.needIgrejaChoice && Array.isArray(data.igrejas) && data.igrejas.length > 0) {
      fillIgrejaChoiceSelect(loginIgrejaSelect, data.igrejas);
      if (loginIgrejaWrap) loginIgrejaWrap.style.display = 'block';
      if (loginIgrejaSelect) loginIgrejaSelect.setAttribute('required', 'required');
      if (loginError) {
        loginError.style.color = 'var(--text-secondary, #a1a1aa)';
        loginError.textContent = data.error || 'Escolha a igreja e clique em Entrar de novo.';
      }
      showToast(data.error || 'Escolha a igreja e entre de novo.', 'info');
      return;
    }
    if (!r.ok) {
      const hint = data.hint ? ` ${data.hint}` : '';
      showLoginError(data.error || 'Falha ao autenticar.', `código ${r.status}${hint}`);
      return;
    }
    if (!data.token) {
      showLoginError('Servidor não devolveu token de sessão.', 'tente de novo ou contate o suporte');
      return;
    }
    resetLoginIgrejaChoiceUi();
    setAuthSession(data, { verified: true });
    if (data.sessionWarning) showToast(data.sessionWarning, 'info');
    if (authMustChangePassword) {
      updateAuthUi();
      loginFullySucceeded = true;
      return;
    }
    if (authOverlay) authOverlay.style.display = 'none';
    const isVol = String(authRole || '').toLowerCase() === 'voluntario';
    const hasMinisterios = (authMinisterioNomes && authMinisterioNomes.length > 0) || authMinisterioNome;
    const isLider = (authRole === 'lider' || authRole === 'admin') && hasMinisterios;
    const isLiderRole = authRole === 'lider' || isLider;
    const defaultView = isVol ? 'perfil' : (isLiderRole && authRole !== 'admin' ? 'checkin-ministerio' : 'resumo');
    setView(defaultView);
    try {
      if (authRole === 'admin') await fetchAllData();
      else if (isLiderRole && authRole !== 'admin') { await fetchCheckinsMinisterio(); await fetchMeusCheckins(); await fetchPerfil(); }
      else { await fetchEventosHoje(); await fetchMeusCheckins(); await fetchPerfil(); }
    } catch (loadErr) {
      if (loadErr.message === 'AUTH_REQUIRED') {
        showLoginError('Sessão recusada ao carregar dados.', 'faça login novamente');
        return;
      }
      showToast('Entrou, mas alguns dados não carregaram: ' + (loadErr.message || 'erro'), 'error');
    }
    loginFullySucceeded = true;
    void verifyAuth().then((vr) => {
      if (!vr.ok) console.warn('[login] Revalidação /api/me:', vr.error);
    });
  } catch (err) {
    clearAuthSession();
    updateAuthUi();
    showLoginError('Erro inesperado ao entrar.', err.message || String(err));
  } finally {
    loginInProgress = false;
    if (!loginFullySucceeded) {
      updateAuthUi();
      if (loginEmail && savedLogin) loginEmail.value = savedLogin;
    } else if (loginPass) {
      loginPass.value = '';
    }
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
document.getElementById('btnRetry')?.addEventListener('click', () => {
  if (typeof lastErrorRetryFn === 'function') {
    try { lastErrorRetryFn(); return; } catch (_) {}
  }
  fetchAllData();
});

document.getElementById('btnKpiToggleMore')?.addEventListener('click', () => {
  const grid = document.getElementById('kpiGridResumo');
  const btn = document.getElementById('btnKpiToggleMore');
  if (!grid || !btn) return;
  const expanded = grid.classList.toggle('kpis-expanded');
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  btn.textContent = expanded ? 'Menos indicadores' : 'Mais indicadores';
});

document.getElementById('topIgrejaSelect')?.addEventListener('change', async () => {
  if (!authIsGlobalAdmin || !authToken) return;
  const sel = document.getElementById('topIgrejaSelect');
  if (!sel) return;
  persistIgrejaSlugToStorage(sel.value);
  if (!document.getElementById('mongoMigrateAllIgrejas')?.checked) invalidateMongoPreflight();
  const viewKeep = currentView || 'resumo';
  clearTenantScopedData();
  showLoading(true);
  try {
    await Promise.all([
      fetchVoluntarios({ showGlobalLoading: false }),
      fetchCheckins(),
    ]);
    setView(viewKeep, { skipFetch: false });
    const cadastroLinkInput = document.getElementById('cadastroLinkInput');
    if (cadastroLinkInput) cadastroLinkInput.value = getCadastroLinkUrl();
  } catch (e) {
    console.error(e);
  } finally {
    showLoading(false);
  }
});

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

btnOpenSend?.addEventListener('click', () => {
  emailExtraRecipientNames = {};
  openModal();
});

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
if (loginForm) {
  loginForm.addEventListener('submit', handleLogin);
  if (btnLogin) {
    btnLogin.setAttribute('type', 'button');
    btnLogin.addEventListener('click', () => { handleLogin(); });
  }
  loginPass?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      handleLogin();
    }
  });
}
window.__celeiroHandleLogin = handleLogin;
btnLogout?.addEventListener('click', handleLogout);
filterMinisterio?.addEventListener('change', () => {
  const val = (filterMinisterio.value || '').trim();
  setFilter('ministerio', val);
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
checkinSearch?.addEventListener('input', debounce(() => { resetCheckinsListPage(); renderCheckins(); }, 300));
checkinQtdCheckins?.addEventListener('change', () => { checkinFilters.qtdCheckins = checkinQtdCheckins?.value || ''; resetCheckinsListPage(); renderCheckins(); });
checkinSort?.addEventListener('change', () => {
  checkinSortOrder = checkinSort.value || 'date-desc';
  resetCheckinsListPage();
  renderCheckins();
});
document.getElementById('btnVerMaisCheckins')?.addEventListener('click', () => {
  checkinsDisplayLimit += LIST_PAGE_SIZE;
  renderCheckinTable(getFilteredCheckins());
});
document.getElementById('btnVerMaisEventosCheckin')?.addEventListener('click', () => {
  eventosCheckinDisplayLimit += LIST_PAGE_SIZE;
  renderEventosCheckin();
});
document.getElementById('eventosCheckinSearch')?.addEventListener('input', debounce(() => {
  eventosCheckinFilters.search = document.getElementById('eventosCheckinSearch')?.value || '';
  resetEventosCheckinListPage();
  renderEventosCheckin();
}, 300));
document.getElementById('eventosCheckinStatus')?.addEventListener('change', () => {
  eventosCheckinFilters.status = document.getElementById('eventosCheckinStatus')?.value || '';
  resetEventosCheckinListPage();
  renderEventosCheckin();
});
document.getElementById('eventosCheckinSort')?.addEventListener('change', () => {
  eventosCheckinSortOrder = document.getElementById('eventosCheckinSort')?.value || 'smart';
  resetEventosCheckinListPage();
  renderEventosCheckin();
});
document.getElementById('btnClearEventosCheckinFilters')?.addEventListener('click', () => {
  eventosCheckinFilters.search = '';
  eventosCheckinFilters.status = '';
  eventosCheckinSortOrder = 'smart';
  const searchEl = document.getElementById('eventosCheckinSearch');
  const statusEl = document.getElementById('eventosCheckinStatus');
  const sortEl = document.getElementById('eventosCheckinSort');
  if (searchEl) searchEl.value = '';
  if (statusEl) statusEl.value = '';
  if (sortEl) sortEl.value = 'smart';
  resetEventosCheckinListPage();
  renderEventosCheckin();
});
document.getElementById('selectAllEventosCheckin')?.addEventListener('change', (ev) => {
  const checked = ev.target.checked;
  getFilteredEventosCheckin().forEach((e) => {
    const id = String(e._id);
    if (checked) selectedEventoCheckinIds.add(id);
    else selectedEventoCheckinIds.delete(id);
  });
  renderEventosCheckin();
});
document.getElementById('btnExcluirEventosCheckinSelecionados')?.addEventListener('click', () => {
  excluirEventosCheckinSelecionados();
});
document.getElementById('btnPurgeEventosCheckinOrfaos')?.addEventListener('click', () => {
  purgeEventosCheckinOrfaos();
});
checkinMinisterioSort?.addEventListener('change', () => {
  checkinMinisterioSortOrder = checkinMinisterioSort.value || 'date-desc';
  resetCheckinsMinisterioListPage();
  renderCheckinsMinisterio();
});
document.getElementById('btnVerMaisCheckinMinisterio')?.addEventListener('click', () => {
  checkinsMinisterioDisplayLimit += LIST_PAGE_SIZE;
  renderCheckinsMinisterio();
});
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

document.getElementById('btnNovoCultoRecorrente')?.addEventListener('click', () => openModalCultoRecorrente(null));
document.getElementById('btnSyncCultosRecorrentes')?.addEventListener('click', () => syncAllCultosRecorrentes());
document.getElementById('modalCultoRecorrenteClose')?.addEventListener('click', closeModalCultoRecorrente);
document.getElementById('modalCultoRecorrenteCancel')?.addEventListener('click', closeModalCultoRecorrente);
document.querySelector('#modalCultoRecorrente .modal-backdrop')?.addEventListener('click', closeModalCultoRecorrente);
document.getElementById('formCultoRecorrente')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = (document.getElementById('cultoRecorrenteId')?.value || '').trim();
  const body = {
    nome: document.getElementById('cultoRecorrenteNome')?.value,
    diaSemana: Number(document.getElementById('cultoRecorrenteDia')?.value),
    horario: document.getElementById('cultoRecorrenteHorario')?.value,
    horarioCheckinInicio: document.getElementById('cultoRecorrenteCheckinInicio')?.value || '',
    horarioCheckinFim: document.getElementById('cultoRecorrenteCheckinFim')?.value || '',
    semanasAFrente: Number(document.getElementById('cultoRecorrenteSemanas')?.value || 8),
    gerarEscala: document.getElementById('cultoRecorrenteGerarEscala')?.checked,
    gerarCheckin: document.getElementById('cultoRecorrenteGerarCheckin')?.checked,
    ativo: document.getElementById('cultoRecorrenteAtivo')?.checked,
  };
  try {
    const r = await authFetch(`${API_BASE}/api/cultos-recorrentes${id ? `/${id}` : ''}`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Falha ao salvar');
    closeModalCultoRecorrente();
    const criadas = data.sync?.criadas;
    if (criadas > 0) showToast(`Salvo! ${criadas} nova(s) escala(s)/check-in(s) gerados.`, 'success');
    else showToast('Culto salvo com sucesso.', 'success');
    fetchCultosRecorrentes();
  } catch (err) { showToast(err.message || 'Erro ao salvar culto.', 'error'); }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('#btnNovoCultoRecorrente')) {
    e.preventDefault();
    openModalCultoRecorrente(null);
  }
  if (e.target.closest('#btnSyncCultosRecorrentes')) {
    e.preventDefault();
    syncAllCultosRecorrentes();
  }
});

btnNovoEvento?.addEventListener('click', () => {
  if (!modalNovoEvento) return;
  ensureModalPortal(modalNovoEvento);
  eventoData.value = getHojeDateString();
  eventoLabel.value = '';
  if (eventoHorarioInicio) eventoHorarioInicio.value = '';
  if (eventoHorarioFim) eventoHorarioFim.value = '';
  if (eventoAtivo) eventoAtivo.checked = true;
  modalNovoEvento.setAttribute('aria-hidden', 'false');
  modalNovoEvento.classList.add('open');
});
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
  const data = document.getElementById('editarEventoData')?.value?.trim();
  const label = document.getElementById('editarEventoLabel')?.value?.trim() ?? '';
  const horarioInicio = (document.getElementById('editarEventoHorarioInicio')?.value || '').trim();
  const horarioFim = (document.getElementById('editarEventoHorarioFim')?.value || '').trim();
  const ativo = document.getElementById('editarEventoAtivo')?.checked !== false;
  if (!id) return;
  if (!data) {
    alert('Informe a data do culto.');
    return;
  }
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-checkin/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, label, ativo, horarioInicio: horarioInicio || '', horarioFim: horarioFim || '' }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    modalEditarEvento?.classList.remove('open');
    fetchEventosCheckin();
  } catch (err) { alert(err.message || 'Erro ao salvar.'); }
});

const modalAssociarEventoEscala = document.getElementById('modalAssociarEventoEscala');
document.getElementById('modalAssociarEventoEscalaClose')?.addEventListener('click', closeModalAssociarEventoEscala);
document.getElementById('modalAssociarEventoEscalaCancel')?.addEventListener('click', closeModalAssociarEventoEscala);
modalAssociarEventoEscala?.querySelector('.modal-backdrop')?.addEventListener('click', closeModalAssociarEventoEscala);
document.getElementById('formAssociarEventoEscala')?.addEventListener('submit', (e) => submitAssociarEventoEscala(e, false));

document.getElementById('modalPerfilVoluntarioClose')?.addEventListener('click', closeModalPerfilVoluntario);
document.getElementById('modalPerfilVoluntario')?.querySelector('.modal-backdrop')?.addEventListener('click', closeModalPerfilVoluntario);

function dismissComplementoCheckinModalAndContinue() {
  const fn = perfilComplementoPendingDone;
  perfilComplementoPendingDone = null;
  closeModalComplementoCheckinUi();
  if (typeof fn === 'function') fn();
}

document.getElementById('modalComplementoCheckinClose')?.addEventListener('click', dismissComplementoCheckinModalAndContinue);
document.getElementById('modalComplementoCheckin')?.querySelector('.modal-backdrop')?.addEventListener('click', dismissComplementoCheckinModalAndContinue);

document.getElementById('btnComplementoCheckinPular')?.addEventListener('click', async () => {
  try {
    const r = await authFetch(`${API_BASE}/api/me/perfil-checkin-complemento`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skip: true }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha ao salvar preferência.');
    finishPerfilComplementoFlow();
  } catch (e) {
    if (e.message !== 'AUTH_REQUIRED') alert(e.message || 'Erro.');
  }
});

document.getElementById('btnComplementoCheckinSalvar')?.addEventListener('click', async () => {
  const telefone = (document.getElementById('complementoCheckinTelefone')?.value || '').trim();
  const whatsapp = (document.getElementById('complementoCheckinWhatsapp')?.value || '').trim();
  const cidade = (document.getElementById('complementoCheckinCidade')?.value || '').trim();
  const estado = (document.getElementById('complementoCheckinEstado')?.value || '').trim();
  if (!telefone && !whatsapp) {
    alert('Informe telefone ou WhatsApp.');
    return;
  }
  if (!cidade || !estado) {
    alert('Informe cidade e UF.');
    return;
  }
  try {
    const r = await authFetch(`${API_BASE}/api/me/perfil-checkin-complemento`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telefone: telefone || undefined,
        whatsapp: whatsapp || undefined,
        cidade,
        estado,
      }),
    });
    const errData = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(errData.error || 'Falha ao salvar.');
    finishPerfilComplementoFlow();
  } catch (e) {
    if (e.message !== 'AUTH_REQUIRED') alert(e.message || 'Erro ao salvar.');
  }
});

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

const modalNovoEventoFormulario = document.getElementById('modalNovoEventoFormulario');
const formNovoEventoFormulario = document.getElementById('formNovoEventoFormulario');
const eventoFormularioTipo = document.getElementById('eventoFormularioTipo');
const eventoFormularioData = document.getElementById('eventoFormularioData');
const eventoFormularioLabel = document.getElementById('eventoFormularioLabel');
const eventoFormularioAtivo = document.getElementById('eventoFormularioAtivo');
document.getElementById('btnNovoEventoBatismo')?.addEventListener('click', () => {
  if (modalNovoEventoFormulario && eventoFormularioTipo) {
    eventoFormularioTipo.value = 'batismo';
    document.getElementById('modalNovoEventoFormularioTitle').textContent = 'Novo evento de batismo';
    if (eventoFormularioData) eventoFormularioData.value = new Date().toISOString().slice(0, 10);
    if (eventoFormularioLabel) eventoFormularioLabel.value = '';
    if (eventoFormularioAtivo) eventoFormularioAtivo.checked = true;
    modalNovoEventoFormulario.setAttribute('aria-hidden', 'false');
    modalNovoEventoFormulario.classList.add('open');
  }
});
document.getElementById('btnNovoEventoApresentacao')?.addEventListener('click', () => {
  if (modalNovoEventoFormulario && eventoFormularioTipo) {
    eventoFormularioTipo.value = 'apresentacao';
    document.getElementById('modalNovoEventoFormularioTitle').textContent = 'Novo evento de apresentação de bebês';
    if (eventoFormularioData) eventoFormularioData.value = new Date().toISOString().slice(0, 10);
    if (eventoFormularioLabel) eventoFormularioLabel.value = '';
    if (eventoFormularioAtivo) eventoFormularioAtivo.checked = true;
    modalNovoEventoFormulario.setAttribute('aria-hidden', 'false');
    modalNovoEventoFormulario.classList.add('open');
  }
});
document.getElementById('btnNovoEventoNovoMembro')?.addEventListener('click', () => {
  if (modalNovoEventoFormulario && eventoFormularioTipo) {
    eventoFormularioTipo.value = 'novo_membro';
    document.getElementById('modalNovoEventoFormularioTitle').textContent = 'Novo evento de novos membros';
    if (eventoFormularioData) eventoFormularioData.value = new Date().toISOString().slice(0, 10);
    if (eventoFormularioLabel) eventoFormularioLabel.value = '';
    if (eventoFormularioAtivo) eventoFormularioAtivo.checked = true;
    modalNovoEventoFormulario.setAttribute('aria-hidden', 'false');
    modalNovoEventoFormulario.classList.add('open');
  }
});
document.getElementById('modalNovoEventoFormularioClose')?.addEventListener('click', () => modalNovoEventoFormulario?.classList.remove('open'));
document.getElementById('modalNovoEventoFormularioCancel')?.addEventListener('click', () => modalNovoEventoFormulario?.classList.remove('open'));
modalNovoEventoFormulario?.querySelector('.modal-backdrop')?.addEventListener('click', () => modalNovoEventoFormulario?.classList.remove('open'));
formNovoEventoFormulario?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const tipo = eventoFormularioTipo?.value?.trim();
  const data = eventoFormularioData?.value;
  const label = (eventoFormularioLabel?.value || '').trim();
  const ativo = eventoFormularioAtivo ? eventoFormularioAtivo.checked : true;
  if (!tipo || !data) return;
  try {
    const r = await authFetch(`${API_BASE}/api/eventos-formulario`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, label, tipo, ativo }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha');
    modalNovoEventoFormulario?.classList.remove('open');
    if (formNovoEventoFormulario) formNovoEventoFormulario.reset();
    fetchFormularios();
  } catch (err) { alert(err.message || 'Erro ao criar evento.'); }
});

document.getElementById('btnNovoMinisterio')?.addEventListener('click', () => { document.getElementById('ministerioNome').value = ''; document.getElementById('modalNovoMinisterio')?.classList.add('open'); });
document.getElementById('btnGerarTodosConvitesLider')?.addEventListener('click', async () => {
  const btn = document.getElementById('btnGerarTodosConvitesLider');
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando...'; }
  try {
    const r = await authFetch(`${API_BASE}/api/convites-lider/generate-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerar: false }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Falha ao gerar links.');
    (data.convites || []).forEach((c) => {
      if (c.ministerioId) convitesLiderByMinId[String(c.ministerioId)] = c;
    });
    convitesLiderBulkText = formatConvitesLiderBulkText(data.convites);
    updateConvitesLiderBulkUi();
    renderMinistros();
    showToast(`${data.total || 0} link(s) gerado(s).`, 'success');
  } catch (err) { showToast(err.message || 'Erro ao gerar links.', 'error'); }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Gerar links de cadastro (todos)'; }
  }
});
document.getElementById('btnCopiarTodosConvitesLider')?.addEventListener('click', async () => {
  if (!convitesLiderBulkText) {
    showToast('Gere os links primeiro.', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(convitesLiderBulkText);
    showToast('Todos os links copiados!', 'success');
  } catch (_) {
    prompt('Copie os links:', convitesLiderBulkText);
  }
});
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
document.getElementById('btnExportCheckinMinisterio')?.addEventListener('click', () => exportCheckinsMinisterioCsv());
document.getElementById('checkinMinisterioData')?.addEventListener('change', () => {
  resetCheckinsMinisterioListPage();
  fetchCheckinsMinisterio();
});
document.getElementById('btnExportCheckinsCsv')?.addEventListener('click', () => exportCheckinsCsv());
document.getElementById('btnExportFormularioMembroCsv')?.addEventListener('click', () => exportFormularioMembroCsv());
document.getElementById('btnExportFormularioConsolidacaoCsv')?.addEventListener('click', () => exportFormularioConsolidacaoCsv());
document.getElementById('btnCopiarLinkFormularioConsolidacao')?.addEventListener('click', () => {
  const input = document.getElementById('formularioConsolidacaoLinkInput');
  const url = input?.value || getFormularioConsolidacaoLinkUrl();
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('btnCopiarLinkFormularioConsolidacao');
    if (btn) { const t = btn.textContent; btn.textContent = 'Copiado!'; setTimeout(() => { btn.textContent = t; }, 2000); }
  }).catch(() => prompt('Copie o link:', url));
});
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

function resetLoginIgrejaChoiceUi() {
  const wrap = document.getElementById('loginIgrejaWrap');
  const sel = document.getElementById('loginIgrejaSelect');
  if (wrap) wrap.style.display = 'none';
  if (sel) {
    sel.innerHTML = '';
    sel.removeAttribute('required');
  }
}

function resetForgotIgrejaChoiceUi() {
  const wrap = document.getElementById('forgotIgrejaWrap');
  const sel = document.getElementById('forgotIgrejaSelect');
  if (wrap) wrap.style.display = 'none';
  if (sel) sel.innerHTML = '';
}

function fillIgrejaChoiceSelect(selectEl, igrejas) {
  if (!selectEl || !Array.isArray(igrejas)) return;
  selectEl.innerHTML = '';
  igrejas.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.igrejaSlug || '';
    opt.textContent = o.igrejaNome || o.igrejaSlug || 'Igreja';
    selectEl.appendChild(opt);
  });
}

function showAuthCard(card) {
  [loginCard, registerCard, setupCard, forgotPasswordCard, resetPasswordCard, mustChangePasswordCard].forEach(c => { if (c) c.style.display = 'none'; });
  if (card) card.style.display = 'block';
  if (card === loginCard) resetLoginIgrejaChoiceUi();
  if (card === forgotPasswordCard) resetForgotIgrejaChoiceUi();
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
  const forgotIgrejaWrap = document.getElementById('forgotIgrejaWrap');
  const forgotIgrejaSelect = document.getElementById('forgotIgrejaSelect');
  if (errEl) errEl.textContent = '';
  if (okEl) { okEl.style.display = 'none'; okEl.textContent = ''; }
  const email = (document.getElementById('forgotEmail')?.value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) { if (errEl) errEl.textContent = 'Informe um email válido.'; return; }
  const igrejaSlug = (forgotIgrejaWrap && forgotIgrejaWrap.style.display !== 'none' && forgotIgrejaSelect?.value)
    ? forgotIgrejaSelect.value.trim()
    : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    const body = { email, ...(igrejaSlug ? { igrejaSlug } : {}) };
    const r = await fetch(`${API_BASE}/api/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409 && data.needIgrejaChoice && Array.isArray(data.igrejas) && data.igrejas.length > 0) {
      fillIgrejaChoiceSelect(forgotIgrejaSelect, data.igrejas);
      if (forgotIgrejaWrap) forgotIgrejaWrap.style.display = 'block';
      if (errEl) errEl.textContent = data.error || 'Escolha a igreja e envie de novo.';
      return;
    }
    if (okEl) { okEl.textContent = data.message || 'Se o email estiver cadastrado, você receberá um link para redefinir a senha.'; okEl.style.display = 'block'; }
    if (errEl) errEl.textContent = data.error || '';
    if (r.ok && forgotIgrejaWrap) forgotIgrejaWrap.style.display = 'none';
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
    const r = await fetch(`${API_BASE}/api/auth/register?igreja=${encodeURIComponent(getTenantSlugForLinks())}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, email, senha, igrejaSlug: getTenantSlugForLinks() }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { if (registerError) registerError.textContent = data.error || 'Falha ao cadastrar.'; return; }
    if (registerNome) registerNome.value = '';
    if (registerEmail) registerEmail.value = '';
    if (registerPass) registerPass.value = '';
    setAuthSession(data, { verified: true });
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
  const ig = encodeURIComponent(getTenantSlugForLinks());
  return `${base.replace(/\/$/, '')}?igreja=${ig}#cadastro`;
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
    const r = await fetch(`${API_BASE}/api/cadastro?igreja=${encodeURIComponent(getTenantSlugForLinks())}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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

document.getElementById('btnCopiarLinkFormularioMembro')?.addEventListener('click', () => {
  const input = document.getElementById('formularioMembroLinkInput');
  const url = input?.value || getFormularioMembroLinkUrl();
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('btnCopiarLinkFormularioMembro');
    if (btn) { const t = btn.textContent; btn.textContent = 'Copiado!'; setTimeout(() => { btn.textContent = t; }, 2000); }
  }).catch(() => prompt('Copie o link:', url));
});

async function refreshMongoMigrateStatus() {
  const statusEl = document.getElementById('mongoMigrateStatus');
  if (!statusEl || !canShowMongoMigrateUi()) return;
  statusEl.textContent = 'Verificando...';
  try {
    const r = await authFetch(`${API_BASE}/api/admin/migrate-mongo-to-pg/status`);
    const data = await r.json();
    if (!r.ok) {
      statusEl.textContent = data.error || 'Erro ao verificar';
      return;
    }
    const parts = [];
    parts.push(data.postgresReady ? 'Postgres OK' : 'Postgres indisponível');
    if (!data.mongodbUriConfigured) parts.push('MONGODB_URI não configurado no Railway');
    else if (data.mongoConnected) parts.push('Mongo conectado');
    else parts.push(`Mongo: ${data.mongoError || 'sem conexão'}`);
    if (data.migrationRunning) parts.push('migração em andamento…');
    statusEl.textContent = `(${parts.join(' · ')})`;
    if (data.progress?.running) updateMongoMigrateProgressUI(data.progress);
  } catch (_) {
    statusEl.textContent = '(erro ao verificar status)';
  }
}

let mongoMigratePollTimer = null;
let mongoMigratePreflightToken = null;

function getMongoMigrateOptions() {
  return {
    dryRun: !!document.getElementById('mongoMigrateDryRun')?.checked,
    allIgrejas: !!document.getElementById('mongoMigrateAllIgrejas')?.checked,
    igrejaSlug: getTenantSlugForLinks() || 'celeiro-sp',
  };
}

function invalidateMongoPreflight() {
  mongoMigratePreflightToken = null;
  const btnContinue = document.getElementById('btnMongoMigrate');
  const badge = document.getElementById('mongoMigratePreflightBadge');
  if (btnContinue) {
    btnContinue.disabled = true;
    btnContinue.title = 'Execute o teste de acesso antes';
  }
  if (badge) {
    badge.style.display = 'none';
    badge.textContent = '';
  }
}

function applyMongoPreflightSuccess(data) {
  mongoMigratePreflightToken = data.preflightToken || null;
  const btnContinue = document.getElementById('btnMongoMigrate');
  const badge = document.getElementById('mongoMigratePreflightBadge');
  if (btnContinue) {
    btnContinue.disabled = !mongoMigratePreflightToken;
    btnContinue.title = mongoMigratePreflightToken
      ? 'Teste OK — clique para migrar'
      : 'Teste sem dados ou com erro — corrija antes de continuar';
  }
  if (badge && mongoMigratePreflightToken) {
    badge.style.display = 'inline';
    const min = Math.floor((data.preflightExpiresInSec || 1800) / 60);
    badge.textContent = `✓ Teste OK · válido por ${min} min`;
  }
}

function formatMongoPreflightReport(data) {
  const lines = [];
  lines.push(data.message || '');
  lines.push('');
  lines.push(`Mongo ping: ${data.mongoPingMs}ms · Postgres ping: ${data.postgresPingMs}ms`);
  lines.push(`Postgres: ${data.postgresIgrejasAtivas} igreja(s) ativa(s) · Admins globais no Mongo: ${data.globalAdmins ?? 0}`);
  lines.push(`Total estimado a migrar: ${data.grandTotal ?? 0} registro(s)`);
  lines.push('');
  for (const g of (data.igrejas || [])) {
    lines.push(`── ${g.nome || g.slug} (${g.slug}) ${g.ok === false ? '✗ ERRO' : '✓'}`);
    if (g.error) {
      lines.push(`   Erro: ${g.error}`);
      continue;
    }
    lines.push(`   Postgres: ${g.postgresReady ? 'igreja cadastrada' : 'igreja será criada na migração'}`);
    const c = g.counts || {};
    lines.push(`   users ${c.users ?? 0} · voluntários ${c.voluntarios ?? 0} · check-ins ${c.checkins ?? 0} · escalas ${c.escalas ?? 0} · candidaturas ${c.candidaturas ?? 0}`);
    lines.push(`   eventos check-in ${c.eventosCheckin ?? 0} · formulários ${(c.formularioMembro ?? 0) + (c.formularioBatismo ?? 0) + (c.formularioApresentacao ?? 0) + (c.formularioNovoMembro ?? 0) + (c.formularioConsolidacao ?? 0)}`);
    if (g.samples?.user) lines.push(`   amostra user: ${g.samples.user.email} (${g.samples.user.role})`);
    if (g.samples?.voluntario) lines.push(`   amostra voluntário: ${g.samples.voluntario.email}`);
    if (g.samples?.checkin) lines.push(`   amostra check-in: ${g.samples.checkin.email} · ${g.samples.checkin.ministerio || '-'}`);
    for (const w of (g.warnings || [])) lines.push(`   ⚠ ${w}`);
    lines.push('');
  }
  if ((data.errors || []).length) {
    lines.push('Erros:');
    data.errors.forEach((e) => lines.push(`  • ${e}`));
  }
  if (data.ready && data.preflightToken) {
    lines.push('');
    lines.push('→ Acesso verificado. Clique em "2. Continuar migração" para prosseguir.');
  }
  return lines.join('\n');
}

document.getElementById('mongoMigrateAllIgrejas')?.addEventListener('change', invalidateMongoPreflight);

document.getElementById('btnMongoMigrateTest')?.addEventListener('click', async () => {
  if (!canShowMongoMigrateUi()) return;
  const { allIgrejas, igrejaSlug } = getMongoMigrateOptions();
  const btnTest = document.getElementById('btnMongoMigrateTest');
  const resultEl = document.getElementById('mongoMigrateResult');
  invalidateMongoPreflight();
  resetMongoMigrateProgressUI();
  if (btnTest) btnTest.disabled = true;
  if (resultEl) {
    resultEl.style.display = 'block';
    resultEl.textContent = 'Testando acesso ao MongoDB e contando registros…';
  }
  try {
    const r = await authFetch(`${API_BASE}/api/admin/migrate-mongo-to-pg/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allIgrejas, igrejaSlug }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro no teste');
    if (resultEl) resultEl.textContent = formatMongoPreflightReport(data);
    if (data.ready && data.preflightToken) {
      applyMongoPreflightSuccess(data);
    } else {
      invalidateMongoPreflight();
    }
    await refreshMongoMigrateStatus();
  } catch (e) {
    invalidateMongoPreflight();
    if (resultEl) resultEl.textContent = e.message || 'Erro no teste de acesso';
  } finally {
    if (btnTest) btnTest.disabled = false;
  }
});

function stopMongoMigratePoll() {
  if (mongoMigratePollTimer) {
    clearInterval(mongoMigratePollTimer);
    mongoMigratePollTimer = null;
  }
}

function resetMongoMigrateProgressUI() {
  const btn = document.getElementById('btnMongoMigrate');
  const fill = document.getElementById('mongoMigrateProgressFill');
  const label = document.getElementById('btnMongoMigrateLabel');
  const text = document.getElementById('mongoMigrateProgressText');
  if (btn) {
    btn.classList.remove('is-running', 'is-done', 'is-error');
    btn.disabled = false;
  }
  if (fill) fill.style.width = '0%';
  if (label) label.textContent = '2. Continuar migração';
  if (text) {
    text.style.display = 'none';
    text.textContent = '';
  }
}

function updateMongoMigrateProgressUI(p) {
  const btn = document.getElementById('btnMongoMigrate');
  const fill = document.getElementById('mongoMigrateProgressFill');
  const label = document.getElementById('btnMongoMigrateLabel');
  const text = document.getElementById('mongoMigrateProgressText');
  const pct = Math.max(0, Math.min(100, Number(p?.percent) || 0));
  if (fill) fill.style.width = `${pct}%`;
  if (label) {
    if (p?.running) label.textContent = `${pct}% · migrando…`;
    else if (p?.error) label.textContent = 'Erro na migração';
    else if (p?.done) label.textContent = 'Concluído';
    else label.textContent = '2. Continuar migração';
  }
  if (text && (p?.stage || p?.step)) {
    text.style.display = 'inline';
    const stepTxt = p.totalSteps ? ` (${p.step}/${p.totalSteps})` : '';
    text.textContent = `${p.stage || ''}${stepTxt}`;
  }
  if (btn) {
    btn.classList.toggle('is-running', !!p?.running);
    btn.classList.toggle('is-done', !!p?.done && !p?.error);
    btn.classList.toggle('is-error', !!p?.error);
    if (p?.running) btn.disabled = true;
  }
}

function startMongoMigratePoll(onComplete) {
  stopMongoMigratePoll();
  mongoMigratePollTimer = setInterval(async () => {
    try {
      const r = await authFetch(`${API_BASE}/api/admin/migrate-mongo-to-pg/progress`);
      const p = await r.json();
      updateMongoMigrateProgressUI(p);
      if (p.done || p.error) {
        stopMongoMigratePoll();
        if (typeof onComplete === 'function') onComplete(p);
      }
    } catch (_) { /* ignora falha pontual de poll */ }
  }, 400);
}

document.getElementById('btnMongoMigrate')?.addEventListener('click', async () => {
  if (!canShowMongoMigrateUi()) return;
  if (!mongoMigratePreflightToken) {
    window.alert('Execute primeiro o teste de acesso aos dados (botão "1. Testar acesso").');
    return;
  }
  const { dryRun, allIgrejas, igrejaSlug } = getMongoMigrateOptions();
  const action = dryRun ? 'simular' : 'executar';
  const scope = allIgrejas ? 'todas as igrejas' : `igreja "${igrejaSlug}"`;
  if (!window.confirm(`Confirma ${action} a migração MongoDB → PostgreSQL para ${scope}?\n\n${dryRun ? 'Modo simulação: nada será gravado.' : 'ATENÇÃO: os dados serão copiados para o PostgreSQL. Depois você poderá desativar o MongoDB.'}`)) return;
  const btn = document.getElementById('btnMongoMigrate');
  const resultEl = document.getElementById('mongoMigrateResult');
  resetMongoMigrateProgressUI();
  if (btn) {
    btn.disabled = true;
    btn.classList.add('is-running');
  }
  updateMongoMigrateProgressUI({ running: true, percent: 0, stage: 'Iniciando…', step: 0, totalSteps: 0 });
  if (resultEl) resultEl.style.display = 'block';
  startMongoMigratePoll(null);
  try {
    const r = await authFetch(`${API_BASE}/api/admin/migrate-mongo-to-pg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun, allIgrejas, igrejaSlug, preflightToken: mongoMigratePreflightToken }),
    });
    const data = await r.json();
    stopMongoMigratePoll();
    if (!r.ok) throw new Error(data.error || 'Erro na migração');
    updateMongoMigrateProgressUI({
      running: false,
      done: true,
      percent: 100,
      stage: data.message || 'Concluído',
    });
    if (resultEl) {
      resultEl.textContent = `${data.message || 'Concluído'}\n\n${JSON.stringify(data, null, 2)}`;
    }
    invalidateMongoPreflight();
    await refreshMongoMigrateStatus();
    if (!dryRun) {
      clearTenantScopedData();
      await fetchAllData();
    }
  } catch (e) {
    stopMongoMigratePoll();
    updateMongoMigrateProgressUI({
      running: false,
      done: true,
      error: e.message || 'Erro',
      percent: 100,
      stage: e.message || 'Erro na migração',
    });
    if (resultEl) resultEl.textContent = e.message || 'Erro na migração';
  } finally {
    if (btn) btn.disabled = !mongoMigratePreflightToken;
  }
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
  hideAllPublicOverlays();
  if (window.location.hash === '#cadastro') showCadastroPublico();
  else if (window.location.hash === '#formulario-membro') showFormularioMembroPublico();
  else if (window.location.hash === '#formulario-consolidacao') showFormularioConsolidacaoPublico();
  else { hideCadastroPublico(); hideFormularioMembroPublico(); hideFormularioConsolidacaoPublico(); }
});

let checkinPublicEventoId = null;
let formularioBatismoPublicEventoId = null;
let formularioApresentacaoPublicEventoId = null;
let formularioNovoMembroPublicEventoId = null;
let novoMembroMinisteriosPublic = [];

function showFormularioMembroPublico() {
  preparePublicFormSession();
  hideAllPublicOverlays();
  const overlay = document.getElementById('formularioMembroOverlay');
  const auth = document.getElementById('authOverlay');
  const content = document.getElementById('content');
  if (overlay) overlay.style.display = 'block';
  if (auth) auth.style.display = 'none';
  if (content) content.style.display = 'none';
}

function hideFormularioMembroPublico() {
  const overlay = document.getElementById('formularioMembroOverlay');
  if (overlay) overlay.style.display = 'none';
  updateAuthUi();
  if (authToken && contentEl) contentEl.style.display = 'block';
}

function showFormularioConsolidacaoPublico() {
  preparePublicFormSession();
  hideAllPublicOverlays();
  const overlay = document.getElementById('formularioConsolidacaoOverlay');
  const auth = document.getElementById('authOverlay');
  const content = document.getElementById('content');
  if (overlay) overlay.style.display = 'block';
  if (auth) auth.style.display = 'none';
  if (content) content.style.display = 'none';
}

function hideFormularioConsolidacaoPublico() {
  const overlay = document.getElementById('formularioConsolidacaoOverlay');
  if (overlay) overlay.style.display = 'none';
  updateAuthUi();
  if (authToken && contentEl) contentEl.style.display = 'block';
}

/** Esconde apenas os overlays de formulários públicos (sem alterar login/shell). */
function hidePublicOverlayElements() {
  [
    'cadastroOverlay',
    'formularioMembroOverlay',
    'formularioNovoMembroPublicOverlay',
    'formularioConsolidacaoOverlay',
    'formularioBatismoPublicOverlay',
    'formularioApresentacaoPublicOverlay',
    'checkinPublicOverlay',
    'escalaPublicOverlay',
    'conviteLiderOverlay',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

// Usuário autenticado: esconde overlays públicos (links ?checkin=, ?batismo=, etc.)
function hideAllPublicOverlays() {
  hidePublicOverlayElements();
  if (authToken && authVerified) {
    if (contentEl) contentEl.style.display = 'block';
    if (authOverlay) authOverlay.style.display = 'none';
  }
}

function clearPublicOverlayQueryParamsAndHash() {
  try {
    const url = new URL(window.location.href);
    ['checkin', 'batismo', 'apresentacao', 'novo-membro', 'escala', 'convite-lider'].forEach((k) => url.searchParams.delete(k));
    url.hash = '';
    const qs = url.searchParams.toString();
    url.search = qs ? `?${qs}` : '';
    window.history.replaceState({}, '', url.toString());
  } catch (_) {
    // Se algo der errado, não bloqueia o fluxo.
  }
}

function showFormularioNovoMembroPublicOverlay() {
  preparePublicFormSession();
  hideAllPublicOverlays();
  const overlay = document.getElementById('formularioNovoMembroPublicOverlay');
  const auth = document.getElementById('authOverlay');
  const content = document.getElementById('content');
  if (overlay) overlay.style.display = 'block';
  if (auth) auth.style.display = 'none';
  if (content) content.style.display = 'none';
}

function renderNovoMembroMinisteriosCheckboxes(ministerios) {
  const container = document.getElementById('formNovoMembroMinisteriosList');
  if (!container) return;
  const list = Array.isArray(ministerios) ? ministerios.filter(Boolean) : [];
  container.innerHTML = list.map((m) =>
    `<label class="checkbox-label" style="display:block;margin-bottom:6px;"><input type="checkbox" name="formNovoMembroMinisterioCb" value="${escapeAttr(m)}"> ${escapeHtml(m)}</label>`,
  ).join('');
  container.querySelectorAll('input[name="formNovoMembroMinisterioCb"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const checked = container.querySelectorAll('input[name="formNovoMembroMinisterioCb"]:checked');
      if (checked.length > 3) {
        cb.checked = false;
        alert('Selecione no máximo 3 ministérios.');
      }
    });
  });
}

function toggleNovoMembroMinisteriosVisibility() {
  const sel = document.getElementById('formNovoMembroInteresseServir');
  const wrap = document.getElementById('formNovoMembroMinisteriosWrap');
  if (!sel || !wrap) return;
  wrap.style.display = sel.value === 'sim' ? '' : 'none';
  if (sel.value !== 'sim') {
    document.querySelectorAll('input[name="formNovoMembroMinisterioCb"]').forEach((cb) => { cb.checked = false; });
  }
}

async function loadFormularioNovoMembroPublic(eventoId) {
  const errEl = document.getElementById('formularioNovoMembroError');
  const successEl = document.getElementById('formularioNovoMembroSuccess');
  const labelEl = document.getElementById('formularioNovoMembroEventLabel');
  if (errEl) errEl.textContent = '';
  if (successEl) successEl.style.display = 'none';
  if (labelEl) labelEl.textContent = 'Carregando...';
  try {
    const ig = encodeURIComponent(getTenantSlugForLinks());
    const r = await fetch(`${API_BASE}/api/formulario-publico/novo_membro/${encodeURIComponent(eventoId)}?igreja=${ig}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (labelEl) labelEl.textContent = data.error || 'Evento não encontrado ou formulário encerrado.';
      return;
    }
    formularioNovoMembroPublicEventoId = data.evento?._id || eventoId;
    novoMembroMinisteriosPublic = Array.isArray(data.ministerios) ? data.ministerios : [];
    renderNovoMembroMinisteriosCheckboxes(novoMembroMinisteriosPublic);
    toggleNovoMembroMinisteriosVisibility();
    if (labelEl) labelEl.textContent = data.evento?.label || 'Novos Membros';
  } catch (e) {
    if (labelEl) labelEl.textContent = 'Erro ao carregar. Tente novamente.';
  }
}

function showFormularioBatismoPublicOverlay() {
  preparePublicFormSession();
  hideAllPublicOverlays();
  const overlay = document.getElementById('formularioBatismoPublicOverlay');
  const auth = document.getElementById('authOverlay');
  const content = document.getElementById('content');
  if (overlay) overlay.style.display = 'block';
  if (auth) auth.style.display = 'none';
  if (content) content.style.display = 'none';
}

function showFormularioApresentacaoPublicOverlay() {
  preparePublicFormSession();
  hideAllPublicOverlays();
  const overlay = document.getElementById('formularioApresentacaoPublicOverlay');
  const auth = document.getElementById('authOverlay');
  const content = document.getElementById('content');
  if (overlay) overlay.style.display = 'block';
  if (auth) auth.style.display = 'none';
  if (content) content.style.display = 'none';
  renderApresentacaoCriancasFields();
}

async function loadFormularioBatismoPublic(eventoId) {
  const errEl = document.getElementById('formularioBatismoError');
  const successEl = document.getElementById('formularioBatismoSuccess');
  const labelEl = document.getElementById('formularioBatismoEventLabel');
  if (errEl) errEl.textContent = '';
  if (successEl) successEl.style.display = 'none';
  if (labelEl) labelEl.textContent = 'Carregando...';
  try {
    const r = await fetch(`${API_BASE}/api/formulario-publico/batismo/${encodeURIComponent(eventoId)}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (labelEl) labelEl.textContent = data.error || 'Evento não encontrado ou formulário encerrado.';
      return;
    }
    formularioBatismoPublicEventoId = data.evento?._id || eventoId;
    if (labelEl) labelEl.textContent = data.evento?.label || 'Batismo';
  } catch (e) {
    if (labelEl) labelEl.textContent = 'Erro ao carregar. Tente novamente.';
  }
}

async function loadFormularioApresentacaoPublic(eventoId) {
  const errEl = document.getElementById('formularioApresentacaoError');
  const successEl = document.getElementById('formularioApresentacaoSuccess');
  const labelEl = document.getElementById('formularioApresentacaoEventLabel');
  if (errEl) errEl.textContent = '';
  if (successEl) successEl.style.display = 'none';
  if (labelEl) labelEl.textContent = 'Carregando...';
  try {
    const r = await fetch(`${API_BASE}/api/formulario-publico/apresentacao/${encodeURIComponent(eventoId)}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (labelEl) labelEl.textContent = data.error || 'Evento não encontrado ou formulário encerrado.';
      return;
    }
    formularioApresentacaoPublicEventoId = data.evento?._id || eventoId;
    if (labelEl) {
      let label = (data.evento?.label || 'Apresentação de Bebês').trim();
      label = label.replace(/^Apresentação de Bebês:\s*/i, '').replace(/\s*\(\d{1,2}\/\d{1,2}\/\d{2,4}\)\s*$/, '').replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '').trim();
      labelEl.textContent = label || 'Apresentação de Bebês';
    }
    renderApresentacaoCriancasFields();
  } catch (e) {
    if (labelEl) labelEl.textContent = 'Erro ao carregar. Tente novamente.';
  }
}

function renderApresentacaoCriancasFields() {
  const container = document.getElementById('formApresCriancasContainer');
  const qtdInput = document.getElementById('formApresQuantidade');
  if (!container || !qtdInput) return;
  const n = Math.min(20, Math.max(1, parseInt(qtdInput.value, 10) || 1));
  container.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const idx = i + 1;
    const wrap = document.createElement('div');
    wrap.className = 'form-row form-row-2';
    wrap.innerHTML = `
      <div class="form-group"><label>Criança ${idx} – Nome completo</label><input type="text" data-apres-crianca-nome data-idx="${idx}" placeholder="Nome completo"></div>
      <div class="form-group"><label>Criança ${idx} – Data de nascimento</label><input type="date" data-apres-crianca-nascimento data-idx="${idx}" min="2016-01-01" max="${new Date().toISOString().slice(0, 10)}"></div>
    `;
    container.appendChild(wrap);
  }
}

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
    const r = await fetch(`${API_BASE}/api/checkin-public/${encodeURIComponent(eventoId)}?igreja=${encodeURIComponent(getTenantSlugForLinks())}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (eventLabel) eventLabel.textContent = data.error || 'Evento não encontrado ou check-in encerrado.';
      return;
    }
    checkinPublicEventoId = data.evento?._id || eventoId;
    if (eventLabel) eventLabel.textContent = data.evento?.label || 'Check-in de presença';
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
  const batizado = (document.getElementById('checkinPublicBatizado')?.value || '').trim() || undefined;
  if (!email || !email.includes('@')) { if (errEl) errEl.textContent = 'Informe um email válido.'; return; }
  if (!ministerio) { if (errEl) errEl.textContent = 'Selecione o ministério.'; return; }
  if (!checkinPublicEventoId) { if (errEl) errEl.textContent = 'Sessão expirada. Abra o link novamente.'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  try {
    const r = await fetch(`${API_BASE}/api/checkin-public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventoId: checkinPublicEventoId, email, ministerio, nome: nome || undefined, batizado,
        igrejaSlug: getTenantSlugForLinks(),
      }),
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
    const batizadoEl = document.getElementById('checkinPublicBatizado');
    if (batizadoEl) batizadoEl.value = '';
  } catch (err) {
    if (errEl) errEl.textContent = err.message || 'Erro de rede. Tente novamente.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar check-in'; }
  }
});

document.getElementById('formApresQuantidade')?.addEventListener('input', renderApresentacaoCriancasFields);
document.getElementById('formApresQuantidade')?.addEventListener('change', renderApresentacaoCriancasFields);

document.getElementById('linkSairFormularioMembro')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.location.hash = '';
  hideFormularioMembroPublico();
});

document.getElementById('linkSairFormularioConsolidacao')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.location.hash = '';
  hideFormularioConsolidacaoPublico();
});

document.getElementById('formConsWhatsapp')?.addEventListener('blur', function () {
  const v = this.value?.trim();
  if (!v) return;
  const formatted = formatarWhatsApp(v);
  if (formatted) this.value = formatted;
});

document.getElementById('formularioMembroForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('formularioMembroError');
  const successEl = document.getElementById('formularioMembroSuccess');
  const btn = document.getElementById('btnFormularioMembroSubmit');
  if (errEl) errEl.textContent = '';
  if (successEl) successEl.style.display = 'none';
  const payload = {
    nomeCompleto: (document.getElementById('formMembroNome')?.value || '').trim(),
    dataNascimento: (document.getElementById('formMembroNascimento')?.value || '').trim() || undefined,
    email: (document.getElementById('formMembroEmail')?.value || '').trim().toLowerCase(),
    enderecoCompleto: (document.getElementById('formMembroEndereco')?.value || '').trim() || '',
    telefoneWhatsapp: (document.getElementById('formMembroWhatsapp')?.value || '').trim() || '',
    batizado: (document.getElementById('formMembroBatizado')?.value || '').trim() || '',
    voluntario: (document.getElementById('formMembroVoluntario')?.value || '').trim() || '',
    grupoOracao: (document.getElementById('formMembroGrupoOracao')?.value || '').trim() || '',
    querMembroCeleiro: (document.getElementById('formMembroQuerMembro')?.value || '').trim() || '',
    compromissoRespeitar: (document.getElementById('formMembroCompromisso')?.value || '').trim() || '',
    testemunho: (document.getElementById('formMembroTestemunho')?.value || '').trim() || '',
    igrejaSlug: getTenantSlugForLinks(),
  };
  if (!payload.email || !payload.email.includes('@')) { if (errEl) errEl.textContent = 'E-mail é obrigatório e deve ser válido.'; return; }
  if (!payload.nomeCompleto) { if (errEl) errEl.textContent = 'Nome completo é obrigatório.'; return; }
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API_BASE}/api/formularios/membro?igreja=${encodeURIComponent(getTenantSlugForLinks())}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { if (errEl) errEl.textContent = data.error || 'Falha ao enviar.'; return; }
    if (successEl) { successEl.textContent = data.message || 'Formulário enviado com sucesso!'; successEl.style.display = 'block'; }
    if (errEl) errEl.textContent = '';
    document.getElementById('formularioMembroForm')?.reset();
  } catch (err) { if (errEl) errEl.textContent = err.message || 'Erro de rede.'; }
  finally { if (btn) btn.disabled = false; }
});

document.getElementById('formularioConsolidacaoForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('formularioConsolidacaoError');
  const successEl = document.getElementById('formularioConsolidacaoSuccess');
  const btn = document.getElementById('btnFormularioConsolidacaoSubmit');
  if (errEl) errEl.textContent = '';
  if (successEl) successEl.style.display = 'none';
  const emailOpcional = (document.getElementById('formConsEmailOpcional')?.value || '').trim().toLowerCase();
  if (emailOpcional && !emailOpcional.includes('@')) {
    if (errEl) errEl.textContent = 'E-mail opcional inválido.';
    return;
  }
  const payload = {
    nomeCompleto: (document.getElementById('formConsNome')?.value || '').trim(),
    dataNascimento: (document.getElementById('formConsNascimento')?.value || '').trim() || undefined,
    idade: (document.getElementById('formConsIdade')?.value || '').trim(),
    genero: (document.getElementById('formConsGenero')?.value || '').trim(),
    estadoCivil: (document.getElementById('formConsEstadoCivil')?.value || '').trim(),
    batizadoAguas: (document.getElementById('formConsBatizado')?.value || '').trim(),
    telefoneWhatsapp: (document.getElementById('formConsWhatsapp')?.value || '').trim(),
    emailOpcional: emailOpcional || undefined,
    bairroCidade: (document.getElementById('formConsBairroCidade')?.value || '').trim(),
    decisaoHoje: (document.getElementById('formConsDecisao')?.value || '').trim(),
    grupoOracao: (document.getElementById('formConsGrupoOracao')?.value || '').trim(),
    podeContato: (document.getElementById('formConsPodeContato')?.value || '').trim(),
    melhorDiaContato: (document.getElementById('formConsMelhorDia')?.value || '').trim() || undefined,
    melhorHorarioContato: (document.getElementById('formConsMelhorHorario')?.value || '').trim() || undefined,
    preferenciaContato: (document.getElementById('formConsPreferenciaContato')?.value || '').trim() || undefined,
    pedidoOracao: (document.getElementById('formConsPedidoOracao')?.value || '').trim(),
    igrejaSlug: getTenantSlugForLinks(),
  };
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API_BASE}/api/formularios/consolidacao?igreja=${encodeURIComponent(getTenantSlugForLinks())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { if (errEl) errEl.textContent = data.error || 'Falha ao enviar.'; return; }
    if (successEl) { successEl.textContent = data.message || 'Formulário enviado com sucesso!'; successEl.style.display = 'block'; }
    if (errEl) errEl.textContent = '';
    document.getElementById('formularioConsolidacaoForm')?.reset();
  } catch (err) { if (errEl) errEl.textContent = err.message || 'Erro de rede.'; }
  finally { if (btn) btn.disabled = false; }
});

document.getElementById('formNovoMembroInteresseServir')?.addEventListener('change', toggleNovoMembroMinisteriosVisibility);

document.getElementById('formularioNovoMembroForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('formularioNovoMembroError');
  const successEl = document.getElementById('formularioNovoMembroSuccess');
  const btn = document.getElementById('btnFormularioNovoMembroSubmit');
  if (errEl) errEl.textContent = '';
  if (successEl) successEl.style.display = 'none';
  if (!formularioNovoMembroPublicEventoId) { if (errEl) errEl.textContent = 'Sessão expirada. Abra o link novamente.'; return; }
  const ministeriosInteresse = [];
  document.querySelectorAll('input[name="formNovoMembroMinisterioCb"]:checked').forEach((cb) => {
    const v = (cb.value || '').trim();
    if (v) ministeriosInteresse.push(v);
  });
  const interesseServir = (document.getElementById('formNovoMembroInteresseServir')?.value || '').trim();
  const payload = {
    tipo: 'novo_membro',
    eventoId: formularioNovoMembroPublicEventoId,
    igrejaSlug: getTenantSlugForLinks(),
    nomeCompleto: (document.getElementById('formNovoMembroNome')?.value || '').trim(),
    telefoneWhatsapp: (document.getElementById('formNovoMembroCelular')?.value || '').trim(),
    endereco: (document.getElementById('formNovoMembroEndereco')?.value || '').trim(),
    email: (document.getElementById('formNovoMembroEmail')?.value || '').trim().toLowerCase(),
    idade: (document.getElementById('formNovoMembroIdade')?.value || '').trim(),
    estadoCivil: (document.getElementById('formNovoMembroEstadoCivil')?.value || '').trim(),
    batizado: (document.getElementById('formNovoMembroBatizado')?.value || '').trim(),
    tempoFrequentaIgreja: (document.getElementById('formNovoMembroTempoIgreja')?.value || '').trim(),
    interesseServir,
    ministeriosInteresse: interesseServir === 'sim' ? ministeriosInteresse.slice(0, 3) : [],
  };
  if (!payload.nomeCompleto) { if (errEl) errEl.textContent = 'Nome completo é obrigatório.'; return; }
  if (!payload.telefoneWhatsapp) { if (errEl) errEl.textContent = 'Celular é obrigatório.'; return; }
  if (!payload.email || !payload.email.includes('@')) { if (errEl) errEl.textContent = 'E-mail é obrigatório e válido.'; return; }
  if (interesseServir === 'sim' && ministeriosInteresse.length > 3) { if (errEl) errEl.textContent = 'Selecione no máximo 3 ministérios.'; return; }
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API_BASE}/api/formulario-publico`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { if (errEl) errEl.textContent = data.error || 'Falha ao enviar.'; return; }
    if (successEl) { successEl.textContent = data.message || 'Formulário enviado com sucesso!'; successEl.style.display = 'block'; }
    if (errEl) errEl.textContent = '';
    document.getElementById('formularioNovoMembroForm')?.reset();
    toggleNovoMembroMinisteriosVisibility();
  } catch (err) { if (errEl) errEl.textContent = err.message || 'Erro de rede.'; }
  finally { if (btn) btn.disabled = false; }
});

document.getElementById('formularioBatismoForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('formularioBatismoError');
  const successEl = document.getElementById('formularioBatismoSuccess');
  const btn = document.getElementById('btnFormularioBatismoSubmit');
  if (errEl) errEl.textContent = '';
  if (successEl) successEl.style.display = 'none';
  if (!formularioBatismoPublicEventoId) { if (errEl) errEl.textContent = 'Sessão expirada. Abra o link novamente.'; return; }
  const payload = {
    tipo: 'batismo',
    eventoId: formularioBatismoPublicEventoId,
    nomeCompleto: (document.getElementById('formBatismoNome')?.value || '').trim(),
    dataNascimento: (document.getElementById('formBatismoNascimento')?.value || '').trim() || undefined,
    email: (document.getElementById('formBatismoEmail')?.value || '').trim().toLowerCase(),
    telefoneWhatsapp: (document.getElementById('formBatismoWhatsapp')?.value || '').trim() || '',
    reconheceJesus: (document.getElementById('formBatismoReconheceJesus')?.value || '').trim() || '',
    querMembroCeleiro: (document.getElementById('formBatismoQuerMembro')?.value || '').trim() || '',
    batizarProximo: (document.getElementById('formBatismoProximo')?.value || '').trim() || '',
    cursoBatismo: (document.getElementById('formBatismoCurso')?.value || '').trim() || '',
  };
  if (!payload.nomeCompleto) { if (errEl) errEl.textContent = 'Nome completo é obrigatório.'; return; }
  if (!payload.email || !payload.email.includes('@')) { if (errEl) errEl.textContent = 'E-mail é obrigatório e válido.'; return; }
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API_BASE}/api/formulario-publico`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { if (errEl) errEl.textContent = data.error || 'Falha ao enviar.'; return; }
    if (successEl) { successEl.textContent = data.message || 'Formulário enviado com sucesso!'; successEl.style.display = 'block'; }
    if (errEl) errEl.textContent = '';
    document.getElementById('formularioBatismoForm')?.reset();
  } catch (err) { if (errEl) errEl.textContent = err.message || 'Erro de rede.'; }
  finally { if (btn) btn.disabled = false; }
});

document.getElementById('formularioApresentacaoForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('formularioApresentacaoError');
  const successEl = document.getElementById('formularioApresentacaoSuccess');
  const btn = document.getElementById('btnFormularioApresentacaoSubmit');
  if (errEl) errEl.textContent = '';
  if (successEl) successEl.style.display = 'none';
  if (!formularioApresentacaoPublicEventoId) { if (errEl) errEl.textContent = 'Sessão expirada. Abra o link novamente.'; return; }
  const quantidade = Math.min(20, Math.max(1, parseInt(document.getElementById('formApresQuantidade')?.value, 10) || 1));
  const criancas = [];
  for (let i = 1; i <= quantidade; i++) {
    const nomeEl = document.querySelector(`[data-apres-crianca-nome][data-idx="${i}"]`);
    const nascEl = document.querySelector(`[data-apres-crianca-nascimento][data-idx="${i}"]`);
    const nome = (nomeEl?.value || '').trim();
    const nascimento = (nascEl?.value || '').trim();
    if (nome || nascimento) criancas.push({ nomeCompleto: nome, dataNascimento: nascimento || undefined });
  }
  const payload = {
    tipo: 'apresentacao',
    eventoId: formularioApresentacaoPublicEventoId,
    nomeMae: (document.getElementById('formApresNomeMae')?.value || '').trim(),
    nomePai: (document.getElementById('formApresNomePai')?.value || '').trim(),
    quantidadeCriancas: quantidade,
    criancas,
    endereco: (document.getElementById('formApresEndereco')?.value || '').trim() || '',
    paisMembrosCeleiro: (document.getElementById('formApresPaisMembros')?.value || '').trim() || '',
    emailContato: (document.getElementById('formApresEmail')?.value || '').trim().toLowerCase(),
    whatsappContato: (document.getElementById('formApresWhatsapp')?.value || '').trim() || '',
    compromissoEducar: (document.getElementById('formApresCompromisso')?.value || '').trim() || '',
  };
  if (!payload.emailContato || !payload.emailContato.includes('@')) { if (errEl) errEl.textContent = 'E-mail de contato é obrigatório e válido.'; return; }
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API_BASE}/api/formulario-publico`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { if (errEl) errEl.textContent = data.error || 'Falha ao enviar.'; return; }
    if (successEl) { successEl.textContent = data.message || 'Formulário enviado com sucesso!'; successEl.style.display = 'block'; }
    if (errEl) errEl.textContent = '';
    document.getElementById('formularioApresentacaoForm')?.reset();
    renderApresentacaoCriancasFields();
  } catch (err) { if (errEl) errEl.textContent = err.message || 'Erro de rede.'; }
  finally { if (btn) btn.disabled = false; }
});

function initPublicFormOrShell() {
  // Evita sobreposição de overlays públicos por estado anterior/cached navigation.
  hidePublicOverlayElements();
  const urlSearchParams = new URLSearchParams(window.location.search);
  const checkinParam = urlSearchParams.get('checkin');
  if (checkinParam) {
    showCheckinPublicOverlay();
    loadCheckinPublic(checkinParam);
    return true;
  }
  const batismoParam = urlSearchParams.get('batismo');
  if (batismoParam) {
    showFormularioBatismoPublicOverlay();
    loadFormularioBatismoPublic(batismoParam);
    return true;
  }
  const apresentacaoParam = urlSearchParams.get('apresentacao');
  if (apresentacaoParam) {
    showFormularioApresentacaoPublicOverlay();
    loadFormularioApresentacaoPublic(apresentacaoParam);
    return true;
  }
  const novoMembroParam = urlSearchParams.get('novo-membro');
  if (novoMembroParam) {
    showFormularioNovoMembroPublicOverlay();
    loadFormularioNovoMembroPublic(novoMembroParam);
    return true;
  }
  const escalaParam = urlSearchParams.get('escala');
  const ministerioParam = urlSearchParams.get('ministerio') || '';
  if (escalaParam) {
    showEscalaPublicOverlay();
    loadEscalaPublic(escalaParam, ministerioParam);
    return true;
  }
  const conviteLiderParam = urlSearchParams.get('convite-lider');
  if (conviteLiderParam) {
    showConviteLiderPublicOverlay();
    loadConviteLiderPublic(conviteLiderParam);
    return true;
  }
  return false;
}

function showConviteLiderPublicOverlay() {
  preparePublicFormSession();
  hideAllPublicOverlays();
  const overlay = document.getElementById('conviteLiderOverlay');
  const auth = document.getElementById('authOverlay');
  const content = document.getElementById('content');
  if (overlay) overlay.style.display = 'flex';
  if (auth) auth.style.display = 'none';
  if (content) content.style.display = 'none';
}

function hideConviteLiderPublicOverlay() {
  const overlay = document.getElementById('conviteLiderOverlay');
  if (overlay) overlay.style.display = 'none';
  conviteLiderToken = '';
  restoreAppShellFromPublicForm();
  clearPublicOverlayQueryParamsAndHash();
  updateAuthUi();
  if (authToken && contentEl) contentEl.style.display = 'block';
}

async function loadConviteLiderPublic(token) {
  conviteLiderToken = (token || '').trim();
  const errEl = document.getElementById('conviteLiderError');
  const labelEl = document.getElementById('conviteLiderMinisterioLabel');
  const subEl = document.getElementById('conviteLiderSubtitle');
  if (errEl) errEl.textContent = '';
  if (labelEl) labelEl.textContent = 'Carregando...';
  if (subEl) subEl.textContent = 'Cadastro de liderança';
  try {
    const r = await fetch(`${API_BASE}/api/convite-lider?token=${encodeURIComponent(conviteLiderToken)}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (labelEl) labelEl.textContent = '';
      if (errEl) errEl.textContent = data.error || 'Link inválido ou expirado.';
      return;
    }
    if (labelEl) labelEl.textContent = `Ministério: ${data.ministerioNome || '—'}`;
    if (subEl) subEl.textContent = data.igrejaNome ? `Igreja: ${data.igrejaNome}` : 'Cadastro de liderança';
  } catch (_) {
    if (labelEl) labelEl.textContent = '';
    if (errEl) errEl.textContent = 'Erro ao carregar. Tente novamente.';
  }
}

document.getElementById('linkSairConviteLider')?.addEventListener('click', (e) => {
  e.preventDefault();
  hideConviteLiderPublicOverlay();
  if (authOverlay) authOverlay.style.display = 'flex';
});

document.getElementById('conviteLiderForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('conviteLiderError');
  const okEl = document.getElementById('conviteLiderSuccess');
  if (errEl) errEl.textContent = '';
  if (okEl) { okEl.style.display = 'none'; okEl.textContent = ''; }
  if (!conviteLiderToken) {
    if (errEl) errEl.textContent = 'Link inválido. Peça um novo link ao administrador.';
    return;
  }
  const nome = (document.getElementById('conviteLiderNome')?.value || '').trim();
  const email = (document.getElementById('conviteLiderEmail')?.value || '').trim().toLowerCase();
  const senha = (document.getElementById('conviteLiderSenha')?.value || '').trim();
  if (!nome || !email || !senha) {
    if (errEl) errEl.textContent = 'Preencha nome, email e senha.';
    return;
  }
  if (!email.includes('@')) {
    if (errEl) errEl.textContent = 'Email inválido.';
    return;
  }
  if (senha.length < 6) {
    if (errEl) errEl.textContent = 'Senha deve ter no mínimo 6 caracteres.';
    return;
  }
  const btn = document.getElementById('btnConviteLiderSubmit');
  if (btn) { btn.disabled = true; btn.textContent = 'Criando conta...'; }
  try {
    const r = await fetch(`${API_BASE}/api/auth/register-lider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: conviteLiderToken, nome, email, senha }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (errEl) errEl.textContent = data.error || 'Falha ao cadastrar.';
      return;
    }
    hideConviteLiderPublicOverlay();
    setAuthSession(data, { verified: true });
    if (authOverlay) authOverlay.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';
    restoreAppShellFromPublicForm();
    setView('checkin-ministerio');
    await fetchCheckinsMinisterio();
    await fetchMeusCheckins();
    await fetchPerfil();
    showToast(data.message || 'Conta criada!', 'success');
  } catch (err) {
    if (errEl) errEl.textContent = err.message || 'Erro de rede.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Criar conta e entrar'; }
  }
});

window.addEventListener('pageshow', function(ev) {
  if (ev.persisted) {
    var params = new URLSearchParams(window.location.search);
    var escalaId = params.get('escala');
    var checkinId = params.get('checkin');
    var batismoId = params.get('batismo');
    var apresentacaoId = params.get('apresentacao');
    var novoMembroId = params.get('novo-membro');
    var conviteLiderId = params.get('convite-lider');
    if (escalaId || checkinId || batismoId || apresentacaoId || novoMembroId || conviteLiderId) {
      var loading = document.getElementById('loading');
      var appShell = document.querySelector('.app-shell');
      if (loading) loading.style.display = 'none';
      if (appShell) appShell.style.display = 'none';
      if (escalaId) {
        var ov = document.getElementById('escalaPublicOverlay');
        if (ov) ov.style.display = 'flex';
      }
      if (checkinId) {
        var ov = document.getElementById('checkinPublicOverlay');
        if (ov) ov.style.display = 'flex';
      }
      if (batismoId) {
        var ov = document.getElementById('formularioBatismoPublicOverlay');
        if (ov) ov.style.display = 'block';
      }
      if (apresentacaoId) {
        var ov = document.getElementById('formularioApresentacaoPublicOverlay');
        if (ov) ov.style.display = 'block';
      }
      if (novoMembroId) {
        var ov = document.getElementById('formularioNovoMembroPublicOverlay');
        if (ov) ov.style.display = 'block';
      }
      if (conviteLiderId) {
        var ov = document.getElementById('conviteLiderOverlay');
        if (ov) ov.style.display = 'flex';
      }
    }
  }
});

(() => {
  hidePublicOverlayElements();
  if (initPublicFormOrShell()) return;
  if (window.location.hash === '#cadastro') {
    showCadastroPublico();
    return;
  }
  if (window.location.hash === '#formulario-membro') {
    showFormularioMembroPublico();
    return;
  }
  if (window.location.hash === '#formulario-consolidacao') {
    showFormularioConsolidacaoPublico();
    return;
  }
  const stored = localStorage.getItem(AUTH_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      authToken = parsed.token || '';
      authVerified = false;
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
      authIsGlobalAdmin = !!parsed.isGlobalAdmin;
      if (!parsed.igrejaSlug) parsed.igrejaSlug = 'celeiro-sp';
    } catch (_) {
      authToken = ''; authUser = ''; authRole = 'admin'; authEmail = null; authMinisterioId = null; authMinisterioNome = null; authMinisterioIds = []; authMinisterioNomes = []; authFotoUrl = null; authMustChangePassword = false; authIsMasterAdmin = false; authIsGlobalAdmin = false;
    }
  }
  updateAuthUi();
  if (!authToken) return;
  const initVerifyGen = authVerifyGeneration;
  Promise.race([
    verifyAuth(),
    new Promise((resolve) => setTimeout(
      () => resolve({ ok: false, status: 0, error: 'Tempo esgotado ao validar sessão (15s).' }),
      15000,
    )),
  ]).then((vr) => {
    if (loginInProgress || authVerifyGeneration !== initVerifyGen || vr?.stale) return;
    const ok = !!(vr && vr.ok);
    if (ok && authMustChangePassword) return;
    if (ok) {
      hideAllPublicOverlays();
      clearPublicOverlayQueryParamsAndHash();
      const isVol = authRole === 'voluntario';
      const hasMinisterios = (authMinisterioNomes && authMinisterioNomes.length > 0) || authMinisterioNome;
      const isLider = (authRole === 'lider' || authRole === 'admin') && hasMinisterios;
      const isLiderRole = authRole === 'lider' || isLider;
      const defaultView = isVol ? 'perfil' : (isLiderRole && authRole !== 'admin' ? 'checkin-ministerio' : 'resumo');
      setView(defaultView);
      if (authRole === 'admin') prefetchAllCheckinsForKpis();
      else if (isLiderRole && authRole !== 'admin') { fetchCheckinsMinisterio(); fetchMeusCheckins(); fetchPerfil(); }
      else { fetchEventosHoje(); fetchMeusCheckins(); fetchPerfil(); }
    } else if (authToken) {
      clearAuthSession();
      updateAuthUi();
      showLoginError('Não foi possível restaurar sua sessão.', vr?.error || 'faça login novamente');
    } else {
      updateAuthUi();
    }
  }).catch((err) => {
    if (loginInProgress || authVerifyGeneration !== initVerifyGen) return;
    if (authToken) {
      clearAuthSession();
      updateAuthUi();
      showLoginError('Erro ao validar sessão salva.', err?.message || String(err));
    } else {
      updateAuthUi();
    }
  });
})();
