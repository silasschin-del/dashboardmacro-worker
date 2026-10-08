// economicBR.js — PARTE 4 (Brasil) — motor genérico de indicadores
const INDICADORES_MENSAIS = [
  {
    nome: 'IPCA', sgsCodigo: 433, threshold: 0.05,
    calendario: {
      '12/2025':'2026-01-09','01/2026':'2026-02-10','02/2026':'2026-03-12','03/2026':'2026-04-10',
      '04/2026':'2026-05-12','05/2026':'2026-06-12','06/2026':'2026-07-10','07/2026':'2026-08-11',
      '08/2026':'2026-09-11','09/2026':'2026-10-09','10/2026':'2026-11-12','11/2026':'2026-12-11'
    },
    regra: {
      acima:  { usd: 'alta',  ibov: 'baixa' },
      abaixo: { usd: 'baixa', ibov: 'alta'  },
      neutro: { usd: 'neutro', ibov: 'neutro' }
    }
  },
  {
    nome: 'IGP-M', sgsCodigo: 189, threshold: 0.05,
    calendario: {
      '01/2026':'2026-01-29','02/2026':'2026-02-26','03/2026':'2026-03-30','04/2026':'2026-04-29',
      '05/2026':'2026-05-28','06/2026':'2026-06-29','07/2026':'2026-07-30','08/2026':'2026-08-28',
      '09/2026':'2026-09-29','10/2026':'2026-10-29','11/2026':'2026-11-27','12/2026':'2026-12-29'
    },
    regra: {
      acima:  { usd: 'alta',  ibov: 'baixa' },
      abaixo: { usd: 'baixa', ibov: 'alta'  },
      neutro: { usd: 'neutro', ibov: 'neutro' }
    }
  }
];

const COPOM_2026 = [
  { reuniao: 'R1/2026', divulgacao: '2026-01-28' },
  { reuniao: 'R2/2026', divulgacao: '2026-03-18' },
  { reuniao: 'R3/2026', divulgacao: '2026-04-29' },
  { reuniao: 'R4/2026', divulgacao: '2026-06-17' },
  { reuniao: 'R5/2026', divulgacao: '2026-08-05' },
  { reuniao: 'R6/2026', divulgacao: '2026-09-16' },
  { reuniao: 'R7/2026', divulgacao: '2026-11-04' },
  { reuniao: 'R8/2026', divulgacao: '2026-12-09' }
];

const SELIC_SGS_CODIGO = 1178;
const SELIC_THRESHOLD = 0.05;
const SELIC_REGRA = {
  acima:  { usd: 'baixa', ibov: 'baixa' },
  abaixo: { usd: 'alta',  ibov: 'alta'  },
  neutro: { usd: 'neutro', ibov: 'neutro' }
};

function mesReferencia(dataStr) {
  const partes = dataStr.split('/');
  return `${partes[1]}/${partes[2]}`;
}

function reuniaoMaisRecente() {
  const hoje = new Date();
  const passadas = COPOM_2026.filter(r => new Date(r.divulgacao) <= hoje);
  return passadas.length ? passadas[passadas.length - 1] : null;
}

function classificar(regra, esperado, realizado, threshold) {
  const diff = Math.round((realizado - esperado) * 10000) / 10000; // arredonda, evita erro de ponto flutuante
  let faixa = 'neutro';
  if (Math.abs(diff) >= threshold) faixa = diff > 0 ? 'acima' : 'abaixo';
  return { surpresa: diff, ...regra[faixa] };
}

async function buscarSGS(codigo) {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados/ultimos/1?formato=json`;
  const res = await fetch(url);
  const json = await res.json();
  return json[0];
}

async function buscarExpectativaMensal(indicador, referencia) {
  const filtro = encodeURIComponent(`Indicador eq '${indicador}' and DataReferencia eq '${referencia}'`);
  const url = `https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativaMercadoMensais?$top=1&$filter=${filtro}&$orderby=Data%20desc&$format=json&$select=Indicador,Data,DataReferencia,Mediana`;
  const res = await fetch(url);
  const json = await res.json();
  return json.value[0];
}

async function buscarExpectativaSelic(reuniao) {
  const filtro = encodeURIComponent(`Indicador eq 'Selic' and Reuniao eq '${reuniao}'`);
  const url = `https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoSelic?$top=1&$filter=${filtro}&$orderby=Data%20desc&$format=json&$select=Indicador,Data,Reuniao,Mediana`;
  const res = await fetch(url);
  const json = await res.json();
  return json.value[0];
}

async function salvar(supabase, indicador, referencia, esperado, realizado, surpresa, usd, ibov, dataDivulgacao) {
  const { error } = await supabase.from('economic_events_br').upsert({
    indicador,
    data_referencia: referencia,
    valor_esperado: esperado,
    valor_realizado: realizado,
    surpresa,
    interpretacao_usd: usd,
    interpretacao_ibov: ibov,
    data_divulgacao: dataDivulgacao
  }, { onConflict: 'indicador,data_referencia' });

  if (error) console.error(`[PARTE 4] Erro ao salvar ${indicador}:`, error.message);
  else console.log(`[PARTE 4] ${indicador} ${referencia} (divulgado ${dataDivulgacao}): esperado=${esperado} realizado=${realizado} surpresa=${surpresa}`);
}

async function atualizarIndicadorMensal(supabase, config) {
  try {
    const realizado = await buscarSGS(config.sgsCodigo);
    const referencia = mesReferencia(realizado.data);
    const dataDivulgacao = config.calendario[referencia] || null;
    const expectativa = await buscarExpectativaMensal(config.nome, referencia);
    if (!expectativa) {
      console.log(`[PARTE 4] Sem expectativa Focus para ${config.nome} ${referencia} — pulando`);
      return;
    }
    const valorEsperado = parseFloat(expectativa.Mediana);
    const valorRealizado = parseFloat(realizado.valor);
    const { surpresa, usd, ibov } = classificar(config.regra, valorEsperado, valorRealizado, config.threshold);
    await salvar(supabase, config.nome, referencia, valorEsperado, valorRealizado, surpresa, usd, ibov, dataDivulgacao);
  } catch (e) {
    console.error(`[PARTE 4] Erro em ${config.nome}:`, e.message);
  }
}

async function atualizarSelic(supabase) {
  try {
    const reuniaoInfo = reuniaoMaisRecente();
    if (!reuniaoInfo) { console.log('[PARTE 4] Nenhuma reuniao Copom ja ocorrida em 2026'); return; }

    const expectativa = await buscarExpectativaSelic(reuniaoInfo.reuniao);
    const realizado = await buscarSGS(SELIC_SGS_CODIGO);
    if (!expectativa) {
      console.log(`[PARTE 4] Sem expectativa Focus para Selic ${reuniaoInfo.reuniao} — pulando`);
      return;
    }
    const valorEsperado = parseFloat(expectativa.Mediana);
    const valorRealizado = parseFloat(realizado.valor);
    const { surpresa, usd, ibov } = classificar(SELIC_REGRA, valorEsperado, valorRealizado, SELIC_THRESHOLD);
    await salvar(supabase, 'Selic', reuniaoInfo.reuniao, valorEsperado, valorRealizado, surpresa, usd, ibov, reuniaoInfo.divulgacao);
  } catch (e) {
    console.error('[PARTE 4] Erro em Selic:', e.message);
  }
}

async function atualizarTodos(supabase) {
  for (const config of INDICADORES_MENSAIS) {
    await atualizarIndicadorMensal(supabase, config);
  }
  await atualizarSelic(supabase);
}

module.exports = { atualizarTodos };
