// Extrai DDD, estado e região a partir do telefone do lead. Lógica pura, sem
// dependência externa.

const DDD_PARA_ESTADO = {
  '11': 'SP', '12': 'SP', '13': 'SP', '14': 'SP', '15': 'SP', '16': 'SP', '17': 'SP', '18': 'SP', '19': 'SP',
  '21': 'RJ', '22': 'RJ', '24': 'RJ',
  '27': 'ES', '28': 'ES',
  '31': 'MG', '32': 'MG', '33': 'MG', '34': 'MG', '35': 'MG', '37': 'MG', '38': 'MG',
  '41': 'PR', '42': 'PR', '43': 'PR', '44': 'PR', '45': 'PR', '46': 'PR',
  '47': 'SC', '48': 'SC', '49': 'SC',
  '51': 'RS', '53': 'RS', '54': 'RS', '55': 'RS',
  '61': 'DF', '62': 'GO', '64': 'GO', '63': 'TO',
  '65': 'MT', '66': 'MT', '67': 'MS',
  '68': 'AC', '69': 'RO',
  '71': 'BA', '73': 'BA', '74': 'BA', '75': 'BA', '77': 'BA', '79': 'SE',
  '81': 'PE', '87': 'PE', '82': 'AL', '83': 'PB', '84': 'RN', '85': 'CE', '88': 'CE',
  '86': 'PI', '89': 'PI',
  '91': 'PA', '93': 'PA', '94': 'PA', '92': 'AM', '97': 'AM', '95': 'RR', '96': 'AP',
  '98': 'MA', '99': 'MA',
};

const ESTADO_PARA_REGIAO = {
  SP: 'Sudeste', RJ: 'Sudeste', MG: 'Sudeste', ES: 'Sudeste',
  PR: 'Sul', SC: 'Sul', RS: 'Sul',
  DF: 'Centro-Oeste', GO: 'Centro-Oeste', MT: 'Centro-Oeste', MS: 'Centro-Oeste',
  BA: 'Nordeste', SE: 'Nordeste', PE: 'Nordeste', AL: 'Nordeste', PB: 'Nordeste',
  RN: 'Nordeste', CE: 'Nordeste', PI: 'Nordeste', MA: 'Nordeste',
  AC: 'Norte', RO: 'Norte', PA: 'Norte', AM: 'Norte', RR: 'Norte', AP: 'Norte', TO: 'Norte',
};

/**
 * Extrai só os dígitos de um telefone, removendo qualquer formatação.
 */
function apenasDigitos(telefone) {
  if (!telefone) return '';
  return telefone.replace(/\D/g, '');
}

/**
 * Extrai o DDD de um telefone brasileiro, em qualquer formato comum:
 * com código de país (55...) ou sem.
 * Retorna { ddd, comCodigoPais } ou null se não for possível identificar.
 */
function extrairDDD(telefone) {
  const digitos = apenasDigitos(telefone);
  if (!digitos) return null;

  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    return { ddd: digitos.slice(2, 4), comCodigoPais: true };
  }
  if (digitos.length === 10 || digitos.length === 11) {
    return { ddd: digitos.slice(0, 2), comCodigoPais: false };
  }
  return null; // formato não reconhecido — sinalizar como anomalia, não estimar
}

/**
 * Função principal: recebe um telefone e devolve a localização completa.
 * Sempre retorna um objeto, mesmo quando não é possível identificar —
 * assim o código que chama nunca precisa checar null antes de usar.
 */
function getLocalizacao(telefone) {
  const resultado = {
    ddd: null,
    estado: null,
    regiao: null,
    telefoneSemCodigoPais: false, // sinaliza possível entrada por canal diferente do bot
    formatoReconhecido: false,
  };

  const extraido = extrairDDD(telefone);
  if (!extraido) return resultado;

  resultado.ddd = extraido.ddd;
  resultado.telefoneSemCodigoPais = !extraido.comCodigoPais;
  resultado.formatoReconhecido = true;

  const estado = DDD_PARA_ESTADO[extraido.ddd];
  if (estado) {
    resultado.estado = estado;
    resultado.regiao = ESTADO_PARA_REGIAO[estado] || null;
  }

  return resultado;
}

export { getLocalizacao, extrairDDD, apenasDigitos, DDD_PARA_ESTADO, ESTADO_PARA_REGIAO };
