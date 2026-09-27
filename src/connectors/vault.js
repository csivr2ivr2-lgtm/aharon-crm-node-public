import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { config } from "../config.js";
function keyBytes(){const raw=config.vaultKey.trim();if(/^[0-9a-f]{64}$/i.test(raw))return Buffer.from(raw,"hex");return createHash("sha256").update(raw).digest();}
export class EncryptedVault{
 constructor(file=resolve(config.dataDir,"connector-vault.enc")){this.file=file;this.cache=null;this.writeChain=Promise.resolve();}
 async load(){if(this.cache)return this.cache;try{const packed=JSON.parse(await readFile(this.file,"utf8")),iv=Buffer.from(packed.iv,"base64"),tag=Buffer.from(packed.tag,"base64"),ciphertext=Buffer.from(packed.data,"base64"),decipher=createDecipheriv("aes-256-gcm",keyBytes(),iv);decipher.setAuthTag(tag);this.cache=JSON.parse(Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString("utf8"));}catch(error){if(error?.code!=="ENOENT")throw error;this.cache={version:1,entries:{}};}return this.cache;}
 async persist(){const data=await this.load();await mkdir(dirname(this.file),{recursive:true,mode:0o750});const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",keyBytes(),iv),ciphertext=Buffer.concat([cipher.update(JSON.stringify(data),"utf8"),cipher.final()]),packed=JSON.stringify({iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),data:ciphertext.toString("base64")}),tmp=this.file+".tmp";await writeFile(tmp,packed,{mode:0o600});await rename(tmp,this.file);}
 async get(id){return (await this.load()).entries[id]??null;}
 async set(id,value){this.writeChain=this.writeChain.catch(()=>{}).then(async()=>{const data=await this.load();data.entries[id]=value;await this.persist();});await this.writeChain;}
 async delete(id){this.writeChain=this.writeChain.catch(()=>{}).then(async()=>{const data=await this.load();delete data.entries[id];await this.persist();});await this.writeChain;}
 async entries(prefix=""){const data=await this.load();return Object.entries(data.entries).filter(([key])=>key.startsWith(prefix)).map(([key,value])=>({key,value}));}
}
