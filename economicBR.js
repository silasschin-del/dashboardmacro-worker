// economicBR.js — PARTE 4 (Brasil) — módulo independente, não toca na lógica dos 39 fatores
const SURPRISE_THRESHOLD_IPCA = 0.05; // p.p. — abaixo disso é considerado "dentro do esperado"

// Regra de interpretação — ponto de partida simples, ajuste conforme sua experiência de mesa
const RULES = {
  IPCA: {
    acima:  { usd: 'alta',  ibov: 'baixa' }, // inflação pior que esperado = USD sobe, Ibov cai
    abaixo: { usd: 'baixa', ibov: 'alta'  }, // inflação melhor que esperado = USD cai, Ibov sobe
    neutro: { usd: 'neutro', ibov: 'neutro' }
  }
};

async function buscarExpectativaIPCA() {
  // Expectativa de mercado (Focus) — mediana mais recente
  const url = 'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativaMercadoMensais' +
    '?$top=1&$filter=Indicador%20eq%20%27IPCA%27&$orderby=Data%20desc&$format=json' +
    '&$select=Indicador,Data,DataReferencia,Mediana';
  const res = await fetch(url);
  const json = await res.json();
  return json.value[0]; // { Indicador, Data, DataReferencia, Mediana }
}

async function buscarIPCARealizado() {
  // Série 433 = IPCA variação mensal (% a.m.), SGS do BCB
  const url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/1?formato=json';
  const res = await fetch(url);
  const json = await res.json();
  return json[0]; // { data: 'dd/mm/yyyy', valor: 'X.XX' }
}

function classificar(indicador, esperado, realizado) {
  const diff = realizado - esperado;
  let faixa = 'neutro';
  if (Math.abs(diff) >= SURPRISE_THRESHOLD_IPCA) {
    faixa = diff > 0 ? 'acima' : 'abaixo';
  }
  const regra = RULES[indicador][faixa];
  return { surpresa: diff, ...regra };
}

async function atualizarIPCA(supabase) {
  const expectativa = await buscarExpectativaIPCA();
  const realizado = await buscarIPCARealizado();

  const valorEsperado = parseFloat(expectativa.Mediana);
  const valorRealizado = parseFloat(realizado.valor);
  const { surpresa, usd, ibov } = classificar('IPCA', valorEsperado, valorRealizado);

  await supabase.from('economic_events_br').upsert({
    indicador: 'IPCA',
    data_referencia: expectativa.DataReferencia,
    valor_esperado: valorEsperado,
    valor_realizado: valorRealizado,
    surpresa,
    interpretacao_usd: usd,
    interpretacao_ibov: ibov
  }, { onConflict: 'indicador,data_referencia' });
}

module.exports = { atualizarIPCA };
