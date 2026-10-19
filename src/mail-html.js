import {parseDocument} from 'htmlparser2';
const allowed=new Set('p div span br hr strong b em i u s blockquote pre code ul ol li h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr td th caption dl dt dd sub sup'.split(' '));
const blocked=new Set('script style iframe frame frameset object embed svg math template head title noscript form input button select textarea video audio source link meta base'.split(' '));
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function sanitizeMailHtml(value){
 if(typeof value!=='string'||!value)return '';
 if(Buffer.byteLength(value,'utf8')>256*1024)return '';
 const root=parseDocument(value,{decodeEntities:true});let count=0;
 const render=(node,depth)=>{
  if(++count>10000||depth>40)return '';
  if(node.type==='text')return escape(node.data||'');
  const tag=String(node.name||'').toLowerCase();
  if(blocked.has(tag))return '';
  if(tag==='img')return node.attribs?.alt?'['+escape(node.attribs.alt)+']':'';
  const body=(node.children||[]).map(n=>render(n,depth+1)).join('');
  if(!allowed.has(tag))return body;
  let attrs='';
  if(['rtl','ltr','auto'].includes(node.attribs?.dir))attrs+=' dir="'+node.attribs.dir+'"';
  if(['td','th'].includes(tag))for(const k of ['colspan','rowspan'])if(/^[1-9][0-9]?$/.test(node.attribs?.[k]||''))attrs+=' '+k+'="'+node.attribs[k]+'"';
  return '<'+tag+attrs+'>'+(['br','hr'].includes(tag)?'':body+'</'+tag+'>');
 };
 return render(root,0);
}
export function mailHtmlDocument(html){
 return '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;"><style>body{font:16px/1.6 system-ui;margin:16px;overflow-wrap:anywhere;color:#172337;background:white}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #69778a;padding:6px}pre{white-space:pre-wrap}blockquote{border-inline-start:3px solid #69778a;padding-inline-start:12px}</style></head><body>'+sanitizeMailHtml(html)+'</body></html>';
}
