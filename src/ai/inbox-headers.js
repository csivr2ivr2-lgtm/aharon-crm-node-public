// Only routing metadata is retained; never persist authentication/cookie headers.
const ALLOWED=['list-id','precedence','auto-submitted','content-type','content-disposition'];
export function inboxHeaders(input){
 const entries=input instanceof Map?[...input]:Array.isArray(input)?input.map(h=>[h.name,h.value]):Object.entries(input||{});
 return Object.fromEntries(entries.filter(([name])=>ALLOWED.includes(String(name).toLowerCase())).map(([name,value])=>[String(name).toLowerCase(),String(value?.value??value??'').slice(0,500)]));
}
