import crypto from "node:crypto";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type Role="superadmin"|"company_admin"|"employee";
type DbCompany={id:string;name:string;code:string;created_at:number};
type DbUser={id:string;company_id:string|null;username:string;password_hash:string;password_salt:string;display_name:string;role:Role;active:boolean;created_at:number};

const URL=(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const SECRET=process.env.APP_SECRET||SERVICE||"kassenspiel-v16";

function reply(status:number,data:unknown){return Response.json(data,{status,headers:{"cache-control":"no-store"}})}
function needEnv(){if(!URL||!SERVICE)throw new Error("SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt in Vercel.")}
function normalizeUsername(v:unknown){return String(v||"").trim().toLowerCase()}
function normalizeCompanyCode(v:unknown){return String(v||"").trim().toUpperCase().replace(/\s+/g,"")}
function uid(prefix:string){return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`}
function hashPassword(password:string,salt=crypto.randomBytes(16).toString("hex")){return{salt,hash:crypto.pbkdf2Sync(password,salt,160000,32,"sha256").toString("hex")}}
function passwordMatches(password:string,salt:string,hash:string){try{const got=hashPassword(password,salt).hash;return crypto.timingSafeEqual(Buffer.from(got,"hex"),Buffer.from(hash,"hex"))}catch{return false}}
function publicCompany(c:DbCompany){return{id:c.id,name:c.name,code:c.code,createdAt:Number(c.created_at)||0}}
function publicUser(u:DbUser){return{id:u.id,companyId:u.company_id,username:u.username,password:"",displayName:u.display_name,role:u.role,active:u.active,createdAt:Number(u.created_at)||0}}

async function rest(path:string,init:RequestInit={}){
  needEnv();
  const r=await fetch(`${URL}/rest/v1/${path}`,{
    ...init,
    headers:{
      apikey:SERVICE,
      authorization:`Bearer ${SERVICE}`,
      "content-type":"application/json",
      ...(init.headers||{})
    },
    cache:"no-store"
  });
  const text=await r.text();
  let data:unknown=null;
  if(text){try{data=JSON.parse(text)}catch{data=text}}
  if(!r.ok){const msg=typeof data==="object"&&data&&"message" in data?String((data as {message?:unknown}).message):String(text||`Supabase ${r.status}`);throw new Error(msg)}
  return data;
}

async function getRows<T>(table:string,query:string){return await rest(`${table}?${query}`,{method:"GET"}) as T[]}
async function insertRows<T>(table:string,rows:unknown,onConflict?:string){
  const q=onConflict?`?on_conflict=${encodeURIComponent(onConflict)}`:"";
  return await rest(`${table}${q}`,{method:"POST",headers:{prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(rows)}) as T[];
}
async function patchRows<T>(table:string,query:string,patch:unknown){return await rest(`${table}?${query}`,{method:"PATCH",headers:{prefer:"return=representation"},body:JSON.stringify(patch)}) as T[]}
async function deleteRows(table:string,query:string){return await rest(`${table}?${query}`,{method:"DELETE",headers:{prefer:"return=minimal"}})}

function makeToken(user:DbUser){
  const payload={uid:user.id,role:user.role,cid:user.company_id,exp:Date.now()+7*24*60*60*1000};
  const body=Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig=crypto.createHmac("sha256",SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function readToken(req:Request){
  try{
    const raw=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";
    const [body,sig]=raw.split(".");
    if(!body||!sig)return null;
    const expected=crypto.createHmac("sha256",SECRET).update(body).digest("base64url");
    const a=Buffer.from(sig),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
    const p=JSON.parse(Buffer.from(body,"base64url").toString("utf8")) as {uid:string;role:Role;cid:string|null;exp:number};
    if(!p.uid||!p.exp||p.exp<Date.now())return null;
    return p;
  }catch{return null}
}

async function ensureDefaults(){
  const now=Date.now();
  const companies=await getRows<DbCompany>("ks_v16_companies","id=eq.star-markt&select=*");
  if(!companies.length)await insertRows<DbCompany>("ks_v16_companies",[{id:"star-markt",name:"Star Markt",code:"STAR-001",created_at:now}],"id");
  const admins=await getRows<DbUser>("ks_v16_users","id=eq.global-admin&select=*");
  if(!admins.length){
    const hp=hashPassword("1234");
    await insertRows<DbUser>("ks_v16_users",[{id:"global-admin",company_id:null,username:"admin",password_hash:hp.hash,password_salt:hp.salt,display_name:"Großer Admin",role:"superadmin",active:true,created_at:now}],"id");
  }
}

async function currentUser(req:Request){
  const token=readToken(req);if(!token)return null;
  const users=await getRows<DbUser>("ks_v16_users",`id=eq.${encodeURIComponent(token.uid)}&select=*`);
  const user=users[0];if(!user||!user.active)return null;return user;
}

async function directoryFor(user:DbUser){
  if(user.role==="superadmin"){
    const [companies,users]=await Promise.all([
      getRows<DbCompany>("ks_v16_companies","select=*&order=created_at.asc"),
      getRows<DbUser>("ks_v16_users","select=*&order=created_at.asc")
    ]);
    return{companies:companies.map(publicCompany),users:users.map(publicUser)};
  }
  const companyId=user.company_id||"";
  const [companies,users]=await Promise.all([
    companyId?getRows<DbCompany>("ks_v16_companies",`id=eq.${encodeURIComponent(companyId)}&select=*`):Promise.resolve([]),
    companyId?getRows<DbUser>("ks_v16_users",`company_id=eq.${encodeURIComponent(companyId)}&select=*&order=created_at.asc`):Promise.resolve([user])
  ]);
  return{companies:companies.map(publicCompany),users:users.map(publicUser)};
}

async function generateCompanyCode(name:string){
  const base=(name.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5)||"FIRMA");
  for(let i=0;i<30;i++){
    const code=`${base}-${Math.floor(1000+Math.random()*9000)}`;
    const found=await getRows<DbCompany>("ks_v16_companies",`code=eq.${encodeURIComponent(code)}&select=id`);
    if(!found.length)return code;
  }
  return `${base}-${Date.now().toString().slice(-4)}`;
}

export async function POST(req:Request){
  try{
    needEnv();
    const body=await req.json().catch(()=>({})) as Record<string,unknown>;
    const action=String(body.action||"");
    await ensureDefaults();

    if(action==="migrate_legacy"){
      const companies=Array.isArray(body.companies)?body.companies as Array<Record<string,unknown>>:[];
      const users=Array.isArray(body.users)?body.users as Array<Record<string,unknown>>:[];
      for(const c of companies.slice(0,100)){
        const id=String(c.id||"").trim(),name=String(c.name||"").trim(),code=normalizeCompanyCode(c.code);
        if(!id||!name||!code)continue;
        const exists=await getRows<DbCompany>("ks_v16_companies",`id=eq.${encodeURIComponent(id)}&select=id`);
        if(!exists.length){
          const codeExists=await getRows<DbCompany>("ks_v16_companies",`code=eq.${encodeURIComponent(code)}&select=id`);
          if(!codeExists.length)await insertRows<DbCompany>("ks_v16_companies",[{id,name,code,created_at:Number(c.createdAt)||Date.now()}],"id");
        }
      }
      for(const u of users.slice(0,250)){
        const username=normalizeUsername(u.username),id=String(u.id||"").trim(),password=String(u.password||"");
        if(!id||!username||username==="admin"||username==="chef"||password.length<4)continue;
        const role=(u.role==="company_admin"?"company_admin":"employee") as Role;
        const companyId=String(u.companyId||"").trim();if(!companyId)continue;
        const existing=await getRows<DbUser>("ks_v16_users",`username=eq.${encodeURIComponent(username)}&select=id`);
        if(existing.length)continue;
        const hp=hashPassword(password);
        await insertRows<DbUser>("ks_v16_users",[{id,company_id:companyId,username,password_hash:hp.hash,password_salt:hp.salt,display_name:String(u.displayName||username),role,active:u.active!==false,created_at:Number(u.createdAt)||Date.now()}],"id");
      }
      return reply(200,{ok:true});
    }

    if(action==="login"){
      const username=normalizeUsername(body.username),password=String(body.password||"");
      const users=await getRows<DbUser>("ks_v16_users",`username=eq.${encodeURIComponent(username)}&select=*`);
      const user=users[0];
      if(!user||!passwordMatches(password,user.password_salt,user.password_hash))return reply(401,{ok:false,error:"Benutzername oder Passwort ist falsch."});
      if(!user.active)return reply(403,{ok:false,error:"Dieses Konto ist gesperrt."});
      return reply(200,{ok:true,token:makeToken(user),user:publicUser(user),...(await directoryFor(user))});
    }

    if(action==="register_company"){
      const companyName=String(body.companyName||"").trim(),displayName=String(body.displayName||"").trim(),username=normalizeUsername(body.username),password=String(body.password||"");
      if(companyName.length<2||displayName.length<2||username.length<3||password.length<4)return reply(400,{ok:false,error:"Bitte alle Felder ausfüllen. Passwort mindestens 4 Zeichen."});
      const taken=await getRows<DbUser>("ks_v16_users",`username=eq.${encodeURIComponent(username)}&select=id`);if(taken.length)return reply(409,{ok:false,error:"Dieser Benutzername ist bereits vergeben."});
      const code=await generateCompanyCode(companyName),companyId=uid("company"),userId=uid("user"),now=Date.now(),hp=hashPassword(password);
      await insertRows<DbCompany>("ks_v16_companies",[{id:companyId,name:companyName,code,created_at:now}],"id");
      await insertRows<DbUser>("ks_v16_users",[{id:userId,company_id:companyId,username,password_hash:hp.hash,password_salt:hp.salt,display_name:displayName,role:"company_admin",active:true,created_at:now}],"id");
      return reply(200,{ok:true,code});
    }

    if(action==="register_employee"){
      const companyCode=normalizeCompanyCode(body.companyCode),displayName=String(body.displayName||"").trim(),username=normalizeUsername(body.username),password=String(body.password||"");
      if(displayName.length<2||username.length<3||password.length<4)return reply(400,{ok:false,error:"Bitte alle Felder ausfüllen. Passwort mindestens 4 Zeichen."});
      const companies=await getRows<DbCompany>("ks_v16_companies",`code=eq.${encodeURIComponent(companyCode)}&select=*`);const company=companies[0];if(!company)return reply(404,{ok:false,error:"Firmen-Code wurde nicht gefunden."});
      const taken=await getRows<DbUser>("ks_v16_users",`username=eq.${encodeURIComponent(username)}&select=id`);if(taken.length)return reply(409,{ok:false,error:"Dieser Benutzername ist bereits vergeben."});
      const hp=hashPassword(password),now=Date.now();
      await insertRows<DbUser>("ks_v16_users",[{id:uid("user"),company_id:company.id,username,password_hash:hp.hash,password_salt:hp.salt,display_name:displayName,role:"employee",active:true,created_at:now}],"id");
      return reply(200,{ok:true,companyName:company.name});
    }

    const me=await currentUser(req);if(!me)return reply(401,{ok:false,error:"Sitzung abgelaufen. Bitte neu anmelden."});

    if(action==="session")return reply(200,{ok:true,user:publicUser(me),...(await directoryFor(me))});

    if(action==="create_user"){
      if(me.role!=="superadmin"&&me.role!=="company_admin")return reply(403,{ok:false,error:"Keine Berechtigung."});
      const companyId=me.role==="superadmin"?String(body.companyId||""):String(me.company_id||"");
      let role:Role=me.role==="superadmin"&&body.role==="company_admin"?"company_admin":"employee";
      const displayName=String(body.displayName||"").trim(),username=normalizeUsername(body.username),password=String(body.password||"");
      if(!companyId||displayName.length<2||username.length<3||password.length<4)return reply(400,{ok:false,error:"Bitte Firma, Name, Benutzername und Passwort vollständig eingeben."});
      const company=await getRows<DbCompany>("ks_v16_companies",`id=eq.${encodeURIComponent(companyId)}&select=id`);if(!company.length)return reply(404,{ok:false,error:"Firma nicht gefunden."});
      const taken=await getRows<DbUser>("ks_v16_users",`username=eq.${encodeURIComponent(username)}&select=id`);if(taken.length)return reply(409,{ok:false,error:"Benutzername bereits vergeben."});
      if(role==="company_admin")await patchRows<DbUser>("ks_v16_users",`company_id=eq.${encodeURIComponent(companyId)}&role=eq.company_admin`,{role:"employee"});
      const hp=hashPassword(password);
      await insertRows<DbUser>("ks_v16_users",[{id:uid("user"),company_id:companyId,username,password_hash:hp.hash,password_salt:hp.salt,display_name:displayName,role,active:true,created_at:Date.now()}],"id");
      return reply(200,{ok:true,...(await directoryFor(me))});
    }

    if(action==="toggle_user"||action==="delete_user"||action==="reset_password"){
      if(me.role!=="superadmin"&&me.role!=="company_admin")return reply(403,{ok:false,error:"Keine Berechtigung."});
      const id=String(body.id||"");if(!id||id==="global-admin")return reply(400,{ok:false,error:"Dieses Konto kann nicht geändert werden."});
      const rows=await getRows<DbUser>("ks_v16_users",`id=eq.${encodeURIComponent(id)}&select=*`);const target=rows[0];if(!target)return reply(404,{ok:false,error:"Konto nicht gefunden."});
      if(me.role!=="superadmin"&&(target.company_id!==me.company_id||target.role==="superadmin"))return reply(403,{ok:false,error:"Keine Berechtigung."});
      if(action==="toggle_user")await patchRows<DbUser>("ks_v16_users",`id=eq.${encodeURIComponent(id)}`,{active:!target.active});
      if(action==="delete_user"){await deleteRows("ks_v16_account_state",`user_id=eq.${encodeURIComponent(id)}`);await deleteRows("ks_v16_users",`id=eq.${encodeURIComponent(id)}`)}
      if(action==="reset_password"){
        const password=String(body.password||"");if(password.length<4)return reply(400,{ok:false,error:"Passwort mindestens 4 Zeichen."});const hp=hashPassword(password);await patchRows<DbUser>("ks_v16_users",`id=eq.${encodeURIComponent(id)}`,{password_hash:hp.hash,password_salt:hp.salt});
      }
      return reply(200,{ok:true,...(await directoryFor(me))});
    }

    if(action==="load_state"){
      const rows=await getRows<{user_id:string;state:unknown;updated_at:number}>("ks_v16_account_state",`user_id=eq.${encodeURIComponent(me.id)}&select=user_id,state,updated_at`);
      const row=rows[0];return reply(200,{ok:true,state:row?.state??null,updatedAt:Number(row?.updated_at)||0});
    }

    if(action==="save_state"){
      const state=body.state&&typeof body.state==="object"?body.state:{};
      const updatedAt=Date.now();
      await insertRows("ks_v16_account_state",[{user_id:me.id,company_id:me.company_id,state,updated_at:updatedAt}],"user_id");
      return reply(200,{ok:true,updatedAt});
    }

    return reply(400,{ok:false,error:"Unbekannte Aktion."});
  }catch(error){
    console.error(error);
    return reply(500,{ok:false,error:error instanceof Error?error.message:"Serverfehler"});
  }
}
