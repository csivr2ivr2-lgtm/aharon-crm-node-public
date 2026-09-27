const e=(k,d="")=>process.env[k]??d;
const b=(k,d=false)=>["1","true","yes","on"].includes(String(e(k,d?"true":"false")).toLowerCase());
const n=(k,d)=>{const v=Number.parseInt(String(e(k,d)),10);return Number.isFinite(v)?v:d;};

export const config=Object.freeze({
 env:e("NODE_ENV","production"),host:e("HOST","0.0.0.0"),port:Math.max(1,n("PORT",3100)),
 publicBaseUrl:e("PUBLIC_BASE_URL").replace(/\/$/,""),
 dashboardPassword:e("DASHBOARD_PASSWORD"),sessionSecret:e("SESSION_SECRET"),
 db:{host:e("DB_HOST","127.0.0.1"),port:Math.max(1,n("DB_PORT",3306)),name:e("DB_NAME"),user:e("DB_USER"),password:e("DB_PASSWORD"),poolSize:Math.max(1,n("DB_POOL_SIZE",6))},
 coreApiToken:e("CORE_API_TOKEN"),mcpApiToken:e("MCP_API_TOKEN"),vaultKey:e("CONNECTOR_VAULT_KEY"),oauthStateSecret:e("OAUTH_STATE_SECRET"),
 dataDir:e("DATA_DIR","./runtime"),uploadDir:e("UPLOAD_DIR","./runtime/uploads"),httpTimeoutMs:Math.max(1000,n("HTTP_TIMEOUT_MS",20000)),
 localAiEnabled:b("LOCAL_AI_ENABLED",true),localAiModel:e("LOCAL_AI_MODEL","onnx-community/Qwen2.5-0.5B-Instruct"),
 localAiDtype:e("LOCAL_AI_DTYPE","q4"),localAiMaxNewTokens:Math.max(64,n("LOCAL_AI_MAX_NEW_TOKENS",320)),
 localAiMaxContextChars:Math.max(4000,n("LOCAL_AI_MAX_CONTEXT_CHARS",18000)),
 aiBaseUrl:e("AI_BASE_URL").replace(/\/$/,""),aiApiToken:e("AI_API_TOKEN"),aiModel:e("AI_MODEL"),
 googleClientId:e("GOOGLE_CLIENT_ID"),googleClientSecret:e("GOOGLE_CLIENT_SECRET"),googleRedirectUri:e("GOOGLE_REDIRECT_URI"),
 googleScopes:["openid","email","profile","https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/gmail.send","https://www.googleapis.com/auth/calendar.readonly","https://www.googleapis.com/auth/drive.metadata.readonly"],
 googleSyncQuery:e("GOOGLE_SYNC_QUERY","newer_than:14d"),googleSyncMaxResults:Math.min(100,Math.max(1,n("GOOGLE_SYNC_MAX_RESULTS",50))),
 hostingerMailEnabled:b("HOSTINGER_MAIL_ENABLED",false),hostingerImapHost:e("HOSTINGER_IMAP_HOST","imap.hostinger.com"),
 hostingerImapPort:Math.max(1,n("HOSTINGER_IMAP_PORT",993)),hostingerImapSecure:b("HOSTINGER_IMAP_SECURE",true),
 hostingerSmtpHost:e("HOSTINGER_SMTP_HOST","smtp.hostinger.com"),hostingerSmtpPort:Math.max(1,n("HOSTINGER_SMTP_PORT",465)),
 hostingerSmtpSecure:b("HOSTINGER_SMTP_SECURE",true),hostingerMailUser:e("HOSTINGER_MAIL_USER"),hostingerMailPassword:e("HOSTINGER_MAIL_PASSWORD"),
 hostingerMailSyncDays:Math.max(1,n("HOSTINGER_MAIL_SYNC_DAYS",30)),
 whatsappEnabled:b("WHATSAPP_ENABLED",false),whatsappSessionDir:e("WHATSAPP_SESSION_DIR","./runtime/whatsapp-auth"),
 syncEnabled:b("SYNC_ENABLED",true),syncIntervalSeconds:Math.max(60,n("SYNC_INTERVAL_SECONDS",60)),
 taskWorkerEnabled:b("TASK_WORKER_ENABLED",true),taskWorkerIntervalSeconds:Math.max(5,n("TASK_WORKER_INTERVAL_SECONDS",15)),
 mcpAllowWrites:b("MCP_ALLOW_WRITES",false),mcpAllowSensitiveWrites:b("MCP_ALLOW_SENSITIVE_WRITES",false)
});

export function assertConfig(){
 if(!config.db.name||!config.db.user)throw Error("DB_NAME and DB_USER are required");
 if(config.env!=="production")return;
 const req=[["DASHBOARD_PASSWORD",config.dashboardPassword],["SESSION_SECRET",config.sessionSecret],["CORE_API_TOKEN",config.coreApiToken],["MCP_API_TOKEN",config.mcpApiToken],["CONNECTOR_VAULT_KEY",config.vaultKey],["OAUTH_STATE_SECRET",config.oauthStateSecret]];
 const bad=req.filter(([,v])=>String(v).length<32).map(([k])=>k);if(bad.length)throw Error("Missing/weak production secrets: "+bad.join(", "));
}
