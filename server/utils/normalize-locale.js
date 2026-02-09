/**
 * Normalização de estado (apenas UF) e cidade (capitalização e acentos).
 */

// Todas as UFs válidas do Brasil (27)
const UFS_VALIDAS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

// Nome(s) do estado -> UF. Várias formas de escrita para o mesmo estado.
const NOMES_POR_UF = [
  ['AC', ['acre']],
  ['AL', ['alagoas']],
  ['AP', ['amapa', 'amapá']],
  ['AM', ['amazonas']],
  ['BA', ['bahia']],
  ['CE', ['ceara', 'ceará']],
  ['DF', ['distrito federal', 'df']],
  ['ES', ['espirito santo', 'espírito santo', 'es']],
  ['GO', ['goias', 'goiás']],
  ['MA', ['maranhao', 'maranhão']],
  ['MT', ['mato grosso']],
  ['MS', ['mato grosso do sul']],
  ['MG', ['minas gerais']],
  ['PA', ['para', 'pará']],
  ['PB', ['paraiba', 'paraíba']],
  ['PR', ['parana', 'paraná']],
  ['PE', ['pernambuco']],
  ['PI', ['piaui', 'piauí']],
  ['RJ', ['rio de janeiro']],
  ['RN', ['rio grande do norte']],
  ['RS', ['rio grande do sul']],
  ['RO', ['rondonia', 'rondônia']],
  ['RR', ['roraima']],
  ['SC', ['santa catarina']],
  ['SP', ['sao paulo', 'são paulo', 's. paulo', 's paulo']],
  ['SE', ['sergipe']],
  ['TO', ['tocantins']],
];

const ESTADOS_BR = new Map();
NOMES_POR_UF.forEach(([uf, nomes]) => {
  nomes.forEach(n => ESTADOS_BR.set(n, uf));
  ESTADOS_BR.set(uf.toLowerCase(), uf);
});
// Chaves sem espaços para nomes compostos (ex: "saopaulo" -> SP)
ESTADOS_BR.forEach((uf, key) => {
  const semEspacos = key.replace(/\s+/g, '');
  if (semEspacos !== key && semEspacos.length >= 2) ESTADOS_BR.set(semEspacos, uf);
});

/** Remove acentos (NFD + remove combining marks). */
function semAcentos(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Mark}/gu, '');
}

/** Limpa string para uso como chave: minúscula, sem acentos, espaços colapsados. */
function chaveEstado(s) {
  return semAcentos(s)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tenta extrair UF no final do texto: "São Paulo - SP", "Minas (MG)", "Rio, RJ". */
function extrairUFFinal(val) {
  const v = String(val || '').trim();
  const m = v.match(/\s*[-–—,(]\s*([A-Za-z]{2})\s*\)?$/);
  if (m) {
    const uf = m[1].toUpperCase();
    if (UFS_VALIDAS.has(uf)) return uf;
  }
  return null;
}

/**
 * Normaliza estado para apenas UF (2 letras).
 * - Aceita sigla (SP, sp, Sp) -> SP
 * - Aceita nome (São Paulo, SAO PAULO, etc.) -> SP
 * - Tenta extrair UF de "Texto - SP" ou "Texto (SP)"
 * - Se não reconhecer, retorna string vazia para não manter valor bagunçado.
 */
function normalizarEstado(val) {
  const v = String(val || '').trim();
  if (!v) return '';

  // Já é sigla de 2 letras?
  if (v.length === 2) {
    const uf = v.toUpperCase();
    if (UFS_VALIDAS.has(uf)) return uf;
  }

  // UF no final do texto?
  const ufFinal = extrairUFFinal(v);
  if (ufFinal) return ufFinal;

  const key = chaveEstado(v);
  if (!key) return '';

  // Lookup direto
  let uf = ESTADOS_BR.get(key);
  if (uf) return uf;

  uf = ESTADOS_BR.get(key.replace(/\s+/g, ''));
  if (uf) return uf;

  // Sem prefixo "estado de/do/da"
  const semPrefix = key.replace(/^estado\s+(de|do|da)\s+/, '');
  uf = ESTADOS_BR.get(semPrefix) || ESTADOS_BR.get(semPrefix.replace(/\s+/g, ''));
  if (uf) return uf;

  // Não reconhecido: retorna vazio para manter base limpa (só UFs válidas)
  return '';
}

/** Normaliza cidade: título (primeira letra de cada palavra maiúscula), acentos em NFC. */
function normalizarCidade(val) {
  const v = String(val || '').trim();
  if (!v) return '';
  const nfc = v.normalize('NFC');
  return nfc
    .split(/\s+/)
    .map(palavra => {
      if (!palavra.length) return palavra;
      return palavra[0].toUpperCase() + palavra.slice(1).toLowerCase();
    })
    .join(' ');
}

export { normalizarEstado, normalizarCidade, UFS_VALIDAS };
