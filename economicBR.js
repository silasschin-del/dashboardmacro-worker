// economicBR.js — PARTE 4 (Brasil) — módulo independente, não toca na lógica dos 39 fatores
const SURPRISE_THRESHOLD_IPCA = 0.05; // p.p. — abaixo disso é considerado "dentro do esperado"

const RULES = {
  IPCA: {
    acima:  { usd: 'alta',  ibov: 'baixa' },
    abaixo: { usd: 'baixa', ibov: 'alta'  },
    neutro: { usd: 'neutro', ibov: 'neutro' }
  }
};

function mesReferencia(dataStr) {
  // dataStr vem como "dd/mm/yyyy" -> devolve "mm/yyyy"
  const partes = dataStr.split('/');
  return `${partes[1]}/${partes[2]}`;
}

async function buscarIPCARealizado() {
  const url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/1?formato=json';
  const res = await fetch(url);
  const json = await res.json();
  return json[0]; // { data: 'dd/mm/yyyy', valor: 'X.XX' }
}

async function buscarExpectativaIPCA(referencia) {
  // Agora busca a expectativa ESPECÍFICA do mesmo mês do valor realizado
  const filtro = encodeURIComponent(`Indicador eq 'IPCA' and DataReferencia eq '${referencia}'`);
  const url = `https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativaMercadoMensais?$top=1&$filter=${filtro}&$orderby=Data%20desc&$format=json&$select=Indicador,Data,DataReferencia,Mediana`;
  const res = await fetch(url);
  const json = await res.json();
  return json.value[0]; // pode ser undefined se não achar
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
  const realizado = await buscarIPCARealizado();
  const referencia = mesReferencia(realizado.data);
  const expectativa = await buscarExpectativaIPCA(referencia);

  if (!expectativa) {
    console.log(`[PARTE 4] Sem expectativa Focus encontrada para IPCA ${referencia} — pulando`);
    return;
  }

  const valorEsperado = parseFloat(expectativa.Mediana);
  const valorRealizado = parseFloat(realizado.valor);
  const { surpresa, usd, ibov } = classificar('IPCA', valorEsperado, valorRealizado);

  const { error } = await supabase.from('economic_events_br').upsert({
    indicador: 'IPCA',
    data_referencia: referencia,
    valor_esperado: valorEsperado,
    valor_realizado: valorRealizado,
    surpresa,
    interpretacao_usd: usd,
    interpretacao_ibov: ibov
  }, { onConflict: 'indicador,data_referencia' });

  if (error) {
    console.error('[PARTE 4] Erro ao salvar IPCA:', error.message);
  } else {
    console.log(`[PARTE 4] IPCA ${referencia} atualizado: esperado=${valorEsperado} realizado=${valorRealizado} surpresa=${surpresa.toFixed(2)}`);
  }
}

module.exports = { atualizarIPCA };
