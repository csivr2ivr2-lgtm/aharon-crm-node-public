// Centralized, redacted failure codes. Do not echo raw provider messages, URLs, or tokens.
export function syncFailure(error){
 const status=Number(error?.response?.status||error?.status||error?.statusCode||0);
 const body=error?.response?.data?.error;
 const reasonList=[error?.code,body?.status,body?.reason,...(Array.isArray(body?.errors)?body.errors.map(x=>x?.reason):[]),
  ...(Array.isArray(body?.details)?body.details.map(x=>x?.reason):[])].filter(x=>typeof x==='string').join(' ');
 const raw=String(error?.message||'')+' '+String(body?.message||'');
 if(/accessNotConfigured|SERVICE_DISABLED|API_KEY_SERVICE_BLOCKED|API_DISABLED/i.test(reasonList)||
   /gmail api (?:has not been used|is disabled|is not enabled)/i.test(raw))return 'gmail_api_disabled';
 if(/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient authentication scopes/i.test(reasonList+' '+raw))return 'gmail_scope_missing';
 if(status===429||/rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|quotaExceeded|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(reasonList))return 'rate_limited';
 if(status===401||/invalid_grant|invalid_client|unauthorized|authenticationfailed/i.test(raw))return 'auth_expired';
 if(status===403||/forbidden|access_denied/i.test(raw))return 'permission_denied';
 if(/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout|network/i.test(String(error?.code||'')+' '+raw))return 'connection_failed';
 if(/ER_DUP_ENTRY|duplicate/i.test(String(error?.code||'')))return 'db_conflict';
 if(/ER_NO_SUCH_TABLE|ER_BAD_FIELD_ERROR|ER_PARSE_ERROR|ER_NO_DEFAULT_FOR_FIELD|ER_DATA_TOO_LONG|ER_TRUNCATED_WRONG_VALUE|ER_NO_REFERENCED_ROW/i.test(String(error?.code||'')))return 'database_schema_error';
 if(/invalid.+date|date.?invalid/i.test(raw))return 'invalid_message_date';
 return status>=500?'provider_unavailable':'unknown_error';
}
export function syncIssue(source,stage,error,account_id=''){
 return {type:'sync.error',source:String(source||'unknown').slice(0,50),stage:String(stage||'sync').slice(0,40),account_id:String(account_id||'').slice(0,254),error:syncFailure(error)};
}
export function issueSummary(issues){
 return issues.slice(0,40).map(({source,stage,error,account_id})=>({source,stage,error,account_id}));
}
