// Centralized, redacted failure codes; never return raw provider errors to the browser.
export function syncFailure(error){
 const status=Number(error?.response?.status||error?.status||error?.statusCode||0);
 const raw=String(error?.code||error?.response?.data?.error||error?.message||'');
 if(status===401||/invalid_grant|invalid_client|unauthorized|authenticationfailed/i.test(raw))return 'auth_expired';
 if(status===403||/insufficient.?permission|forbidden|access_denied|insufficientpermissions/i.test(raw))return 'permission_denied';
 if(status===429||/rate.?limit|quota|too_many_requests/i.test(raw))return 'rate_limited';
 if(/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout|network/i.test(raw))return 'connection_failed';
 if(/ER_DUP_ENTRY|duplicate/i.test(raw))return 'db_conflict';
 if(/ER_NO_SUCH_TABLE|ER_BAD_FIELD_ERROR|ER_PARSE_ERROR|ER_NO_DEFAULT_FOR_FIELD|ER_DATA_TOO_LONG|ER_TRUNCATED_WRONG_VALUE|ER_NO_REFERENCED_ROW/i.test(raw))return 'database_schema_error';
 if(/invalid.+date|date.?invalid/i.test(raw))return 'invalid_message_date';
 return status>=500?'provider_unavailable':'unknown_error';
}
export function syncIssue(source,stage,error,account_id=''){
 return {type:'sync.error',source:String(source||'unknown').slice(0,50),stage:String(stage||'sync').slice(0,40),account_id:String(account_id||'').slice(0,254),error:syncFailure(error)};
}
export function issueSummary(issues){
 return issues.slice(0,40).map(({source,stage,error,account_id})=>({source,stage,error,account_id}));
}
