// Jitter avoids synchronized reconnect storms after short network outages.
// Not used for revoked authentication, impersonation, or simulated human activity.
export function reconnectDelayMs(attempt,random=Math.random){
 const n=Math.max(1,Math.min(9,Number.isFinite(attempt)?Math.trunc(attempt):1));
 const base=Math.min(120000,5000*2**Math.min(n-1,5));
 const sample=Math.max(0,Math.min(1,Number(random())||0));
 return Math.min(120000,Math.round(base*(0.8+0.4*sample)));
}
