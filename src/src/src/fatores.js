const FATORES = {
  // CÂMBIO
  'EURUSD=X': { p: 7,  dir: 'neg', cat: 'CÂMBIO' },
  'JPY=X':    { p: 7,  dir: 'pos', cat: 'CÂMBIO' },
  'BRL=X':    { p: 12, dir: 'pos', cat: 'CÂMBIO BR' },
  'CNY=X':    { p: 6,  dir: 'pos', cat: 'CHINA' },
  'MXN=X':    { p: 5,  dir: 'pos', cat: 'EMERGENTE' },
  'CHF=X':    { p: 4,  dir: 'pos', cat: 'SAFE HAVEN' },
  'GBPUSD=X': { p: 4,  dir: 'neg', cat: 'CÂMBIO' },
  'AUDUSD=X': { p: 4,  dir: 'neg', cat: 'CÂMBIO' },
  // JUROS
  '^TNX':     { p: 8,  dir: 'pos', cat: 'YIELD' },
  '^IRX':     { p: 6,  dir: 'pos', cat: 'YIELD' },
  '^FVX':     { p: 5,  dir: 'pos', cat: 'YIELD' },
  'TLT':      { p: 1,  dir: 'neg', cat: 'BOND ETF' },
  'SHY':      { p: 1,  dir: 'neg', cat: 'BOND ETF' },
  'IEF':      { p: 1,  dir: 'neg', cat: 'BOND ETF' },
  // FUTUROS EUA
  'ES=F':     { p: 10, dir: 'neg', cat: 'FUTURO' },
  'NQ=F':     { p: 8,  dir: 'neg', cat: 'FUTURO' },
  'YM=F':     { p: 6,  dir: 'neg', cat: 'FUTURO' },
  'RTY=F':    { p: 5,  dir: 'neg', cat: 'FUTURO' },
  // VOLATILIDADE
  '^VIX':     { p: 10, dir: 'pos', cat: 'VOLATIL.' },
  'EMB':      { p: 1,  dir: 'neg', cat: 'EMBI' },
  'EEM':      { p: 1,  dir: 'neg', cat: 'EMERGENTE' },
  // COMMODITIES
  'GC=F':     { p: 7,  dir: 'neg', cat: 'METAIS' },
  'CL=F':     { p: 5,  dir: 'neg', cat: 'ENERGIA' },
  'BZ=F':     { p: 4,  dir: 'neg', cat: 'ENERGIA' },
  'ZS=F':     { p: 7,  dir: 'neg', cat: 'AGRO BR' },
  'ZC=F':     { p: 4,  dir: 'neg', cat: 'AGRO BR' },
  'HG=F':     { p: 6,  dir: 'neg', cat: 'METAIS' },
  // BOLSAS MUNDO
  '^GDAXI':   { p: 4,  dir: 'neg', cat: 'EUROPA' },
  '^FTSE':    { p: 3,  dir: 'neg', cat: 'EUROPA' },
  '^N225':    { p: 4,  dir: 'neg', cat: 'ÁSIA' },
  '^HSI':     { p: 3,  dir: 'neg', cat: 'ÁSIA' },
  // BRASIL
  '^BVSP':    { p: 3,  dir: 'neg', cat: 'BRASIL' },
  'EWZ':      { p: 1,  dir: 'neg', cat: 'BRASIL' },
  'VALE':     { p: 1,  dir: 'neg', cat: 'BRASIL' },
  'PBR':      { p: 1,  dir: 'neg', cat: 'BRASIL' },
  'ITUB':     { p: 1,  dir: 'neg', cat: 'BRASIL' },
  // CRYPTO
  'BTC-USD':  { p: 5,  dir: 'neg', cat: 'CRYPTO' },
  'ETH-USD':  { p: 2,  dir: 'neg', cat: 'CRYPTO' },
  'XLF':      { p: 1,  dir: 'pos', cat: 'SETOR' },
}

const MAX_RASTRO = Object.values(FATORES).reduce((a, f) => a + f.p, 0)

module.exports = { FATORES, MAX_RASTRO }
