// TWSE ordinary stock / NTD ETF exchange price increments, kept in cents.
export function tickSize(price,assetType='STOCK') {
  if(typeof price!=='number'||!Number.isFinite(price)||price<=0)return NaN;
  if(assetType==='ETF')return price<50?0.01:0.05;
  if(assetType!=='STOCK')return NaN;
  return price<10?0.01:price<50?0.05:price<100?0.1:price<500?0.5:price<1000?1:5;
}
export function isTickPrice(price,assetType='STOCK') {
  const tick=tickSize(price,assetType);
  return Number.isFinite(tick)&&Math.abs(price/tick-Math.round(price/tick))<1e-7&&Math.abs(price*100-Math.round(price*100))<1e-7;
}
export function alignPrice(price,assetType='STOCK',direction='DOWN') {
  const tick=tickSize(price,assetType);
  if(!Number.isFinite(tick)||!['DOWN','UP'].includes(direction))return NaN;
  const steps=direction==='UP'?Math.ceil(price/tick-1e-9):Math.floor(price/tick+1e-9);
  const aligned=Number((steps*tick).toFixed(2));
  return isTickPrice(aligned,assetType)?aligned:NaN;
}
export const displayPrice=price=>typeof price==='number'&&Number.isFinite(price)?price.toFixed(2):'未確認';
export function alignStockSetup(setup,assetType='STOCK',minRiskReward=2) {
  if(!setup)return null;
  const entry=alignPrice(setup.entry,assetType,'UP'), maxEntry=alignPrice(setup.maxEntry,assetType,'DOWN');
  const stop=alignPrice(setup.stop,assetType,'UP'), target=alignPrice(setup.target,assetType,'DOWN');
  const zoneLow=alignPrice(setup.zoneLow??setup.entry,assetType,'UP');
  if(![entry,maxEntry,stop,target,zoneLow].every(Number.isFinite) ||
     !(stop<zoneLow&&zoneLow<=entry&&entry<=maxEntry&&maxEntry<target))return null;
  const riskReward=(target-entry)/(entry-stop), worstEntryRR=(target-maxEntry)/(maxEntry-stop);
  if(riskReward+1e-9<minRiskReward||worstEntryRR+1e-9<minRiskReward)return null;
  return {...setup,entry,maxEntry,stop,target,zoneLow,riskReward,worstEntryRR,priceTickRule:'TWSE_STOCK_OR_NTD_ETF'};
}
