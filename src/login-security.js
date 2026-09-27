import {mkdir,readFile,writeFile,rename,open} from "node:fs/promises";
import {resolve} from "node:path";
import {config} from "./config.js";

export function normalizeIp(value){
 const ip=String(value||"").trim();
 return ip.startsWith("::ffff:")?ip.slice(7):ip;
}

export class LoginSecurity{
 constructor({dataDir=config.dataDir,maxAttempts=config.loginMaxAttempts}={}){
  this.dataDir=resolve(dataDir);this.maxAttempts=Math.max(1,Number(maxAttempts)||3);
  this.lockFile=resolve(this.dataDir,"CRM_LOCKED");
  this.blacklistFile=resolve(this.dataDir,"login-blacklist.json");
  this.attempts=new Map();this.writeChain=Promise.resolve();
 }
 async initialize(){await mkdir(this.dataDir,{recursive:true,mode:0o700});}
 async isLocked(){try{await readFile(this.lockFile,"utf8");return true;}catch(error){if(error?.code==="ENOENT")return false;throw error;}}
 async blacklist(){
  try{
   const parsed=JSON.parse(await readFile(this.blacklistFile,"utf8"));
   return Array.isArray(parsed?.blocked)?parsed:{version:1,blocked:[]};
  }catch(error){if(error?.code==="ENOENT")return {version:1,blocked:[]};throw Error("login_blacklist_invalid");}
 }
 async isBlacklisted(ip){const clean=normalizeIp(ip);if(!clean)return false;const data=await this.blacklist();return data.blocked.some(x=>normalizeIp(x?.ip)===clean);}
 async persistBlacklist(data){
  await this.initialize();const temp=this.blacklistFile+".tmp";
  await writeFile(temp,JSON.stringify(data,null,2)+"\n",{mode:0o600});await rename(temp,this.blacklistFile);
 }
 async blockIp(ip){
  const clean=normalizeIp(ip);if(!clean)return;
  this.writeChain=this.writeChain.catch(()=>{}).then(async()=>{const data=await this.blacklist();if(!data.blocked.some(x=>normalizeIp(x?.ip)===clean)){data.blocked.push({ip:clean,blocked_at:new Date().toISOString(),reason:`${this.maxAttempts}_failed_login_attempts`});await this.persistBlacklist(data);}});
  await this.writeChain;
 }
 async createLock(ip){
  await this.initialize();let handle;
  try{
   handle=await open(this.lockFile,"wx",0o600);
   await handle.writeFile(JSON.stringify({locked:true,locked_at:new Date().toISOString(),trigger_ip:normalizeIp(ip),reason:`${this.maxAttempts}_failed_login_attempts`,unlock:"Delete this CRM_LOCKED file after reviewing login-blacklist.json"},null,2)+"\n");
  }catch(error){if(error?.code!=="EEXIST")throw error;}finally{await handle?.close();}
 }
 async failed(ip){
  const clean=normalizeIp(ip)||"unknown";const count=(this.attempts.get(clean)||0)+1;this.attempts.set(clean,count);
  if(count>=this.maxAttempts){await this.blockIp(clean);await this.createLock(clean);this.attempts.delete(clean);return {count,remaining:0,locked:true,blocked:true};}
  return {count,remaining:this.maxAttempts-count,locked:false,blocked:false};
 }
 success(ip){this.attempts.delete(normalizeIp(ip)||"unknown");}
 paths(){return {lockFile:this.lockFile,blacklistFile:this.blacklistFile};}
}

export const loginSecurity=new LoginSecurity();