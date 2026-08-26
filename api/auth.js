import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL=process.env.SUPABASE_URL;
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET=process.env.APP_SECRET;

function json(res,status,data){
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(data));
}
function needEnv(){
  if(!URL||!SERVICE||!SECRET)throw new Error('Server-Konfiguration fehlt: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY oder APP_SECRET.');
}
function supa(){
  needEnv();
  return createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
}
function b64url(x){return Buffer.from(x).toString('base64url')}
function signToken(user){
  const payload={uid:user.id,role:user.role,cid:user.company_id,exp:Date.now()+1000*60*60*24*7};
  const body=b64url(JSON.stringify(payload));
  const sig=crypto.createHmac('sha256',SECRET).update(body).digest('base64url');
  return body+'.'+sig;
}
function verifyToken(token){
  try{
    const [body,sig]=String(token||'').split('.');
    if(!body||!sig)return null;
    const expected=crypto.createHmac('sha256',SECRET).update(body).digest('base64url');
    if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
    const p=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if(!p.exp||p.exp<Date.now())return null;
    return p;
  }catch{return null}
}
function authPayload(req){
  return verifyToken(String(req.headers.authorization||'').replace(/^Bearer\s+/i,''));
}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){
  const hash=crypto.pbkdf2Sync(String(password),salt,180000,32,'sha256').toString('hex');
  return {salt,hash};
}
function passwordMatches(password,salt,hash){
  const got=hashPassword(password,salt).hash;
  try{return crypto.timingSafeEqual(Buffer.from(got,'hex'),Buffer.from(hash,'hex'))}catch{return false}
}
function cleanUser(u){
  return {id:u.id,companyId:u.company_id,username:u.username,displayName:u.display_name,role:u.role,active:u.active,createdAt:u.created_at};
}
function cleanCompany(c){
  return {id:c.id,name:c.name,type:c.type,code:c.code,createdAt:c.created_at};
}
function normalizeCouponCode(code){return String(code||'').replace(/\D/g,'')}

async function ensureAdmin(db){
  let {data:admin,error}=await db.from('ks_users').select('*').eq('username','admin').maybeSingle();
  if(error)throw error;
  let company;
  if(admin?.company_id){
    const q=await db.from('ks_companies').select('*').eq('id',admin.company_id).maybeSingle();
    company=q.data;
  }
  if(!company){
    let q=await db.from('ks_companies').select('*').eq('code','STAR-001').maybeSingle();
    company=q.data;
    if(!company){
      q=await db.from('ks_companies').insert({name:'Star Markt',type:'Supermarkt',code:'STAR-001'}).select('*').single();
      if(q.error)throw q.error; company=q.data;
    }
  }
  const hp=hashPassword('1234');
  if(!admin){
    const q=await db.from('ks_users').insert({
      company_id:company.id,username:'admin',display_name:'Großer Admin',role:'superadmin',
      password_salt:hp.salt,password_hash:hp.hash,active:true
    }).select('*').single();
    if(q.error)throw q.error;admin=q.data;
  }else{
    const q=await db.from('ks_users').update({
      company_id:company.id,display_name:'Großer Admin',role:'superadmin',
      password_salt:hp.salt,password_hash:hp.hash,active:true
    }).eq('id',admin.id).select('*').single();
    if(q.error)throw q.error;admin=q.data;
  }
  await db.from('ks_company_state').upsert({
    company_id:company.id,store_name:company.name,store_type:company.type
  },{onConflict:'company_id'});
  return admin;
}

async function snapshot(db,viewer){
  const u=await db.from('ks_users').select('*').eq('id',viewer.uid).single();
  if(u.error||!u.data?.active)throw new Error('Sitzung ungültig.');
  let usersQ=db.from('ks_users').select('*').order('created_at');
  let compQ=db.from('ks_companies').select('*').order('created_at');
  if(u.data.role!=='superadmin'){
    usersQ=usersQ.eq('company_id',u.data.company_id);
    compQ=compQ.eq('id',u.data.company_id);
  }
  const [users,companies]=await Promise.all([usersQ,compQ]);
  if(users.error)throw users.error;
  if(companies.error)throw companies.error;
  return {user:cleanUser(u.data),users:users.data.map(cleanUser),companies:companies.data.map(cleanCompany)};
}

async function getMe(db,viewer){
  const q=await db.from('ks_users').select('*').eq('id',viewer.uid).single();
  if(q.error||!q.data?.active)throw new Error('Konto nicht aktiv.');
  return q.data;
}
function isAdmin(me){return ['superadmin','company_admin'].includes(me.role)}

async function companyDataSnapshot(db,me){
  const cid=me.company_id;
  const [products,coupons,receipts,stateRow,activities]=await Promise.all([
    db.from('ks_products').select('local_id,barcode,data,updated_at').eq('company_id',cid).order('local_id',{ascending:true}),
    db.from('ks_coupons').select('code,data,active,used_count,updated_at').eq('company_id',cid).order('created_at',{ascending:false}),
    db.from('ks_receipts').select('receipt_id,data,created_at').eq('company_id',cid).order('created_at',{ascending:false}).limit(2000),
    db.from('ks_company_state').select('*').eq('company_id',cid).maybeSingle(),
    db.from('ks_activity_log').select('data,created_at').eq('company_id',cid).order('created_at',{ascending:false}).limit(500)
  ]);

  for(const q of [products,coupons,receipts,stateRow,activities])if(q.error)throw q.error;

  let cs=stateRow.data;
  if(!cs){
    const co=await db.from('ks_companies').select('name,type').eq('id',cid).single();
    if(co.error)throw co.error;
    const ins=await db.from('ks_company_state').upsert({
      company_id:cid,store_name:co.data.name,store_type:co.data.type,sales:0,tx:0
    },{onConflict:'company_id'}).select('*').single();
    if(ins.error)throw ins.error;
    cs=ins.data;
  }

  return {
    products:(products.data||[]).map(r=>r.data),
    coupons:(coupons.data||[]).map(r=>({...r.data,active:r.active,usedCount:r.used_count||0})),
    receipts:(receipts.data||[]).map(r=>r.data),
    activities:(activities.data||[]).map(r=>r.data),
    companyState:{
      store:cs.store_name,
      storeType:cs.store_type,
      sales:Number(cs.sales)||0,
      tx:Number(cs.tx)||0,
      updatedAt:cs.updated_at
    }
  };
}

export default async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{ok:false,error:'Nur POST erlaubt.'});
  try{
    needEnv();
    const db=supa();
    const body=typeof req.body==='object'&&req.body?req.body:{};
    const action=String(body.action||'');

    if(action==='login'){
      const username=String(body.username||'').trim().toLowerCase();
      const password=String(body.password||'');
      if(!username||!password)return json(res,400,{ok:false,error:'Benutzername und Passwort eingeben.'});
      if(username==='admin'&&password==='1234')await ensureAdmin(db);
      const q=await db.from('ks_users').select('*').eq('username',username).maybeSingle();
      if(q.error)throw q.error;
      const user=q.data;
      if(!user||!user.active||!passwordMatches(password,user.password_salt,user.password_hash)){
        return json(res,401,{ok:false,error:'Benutzername oder Passwort falsch / Konto gesperrt.'});
      }
      const token=signToken(user);
      const snap=await snapshot(db,{uid:user.id,role:user.role,cid:user.company_id});
      return json(res,200,{ok:true,token,...snap});
    }

    if(action==='register_company'){
      const name=String(body.name||'').trim();
      const type=String(body.type||'Supermarkt');
      const username=String(body.username||'').trim().toLowerCase();
      const password=String(body.password||'');
      if(name.length<2||username.length<3||password.length<4)return json(res,400,{ok:false,error:'Bitte alle Felder gültig ausfüllen.'});
      const exists=await db.from('ks_users').select('id').eq('username',username).maybeSingle();
      if(exists.data)return json(res,409,{ok:false,error:'Benutzername bereits vergeben.'});
      let code;
      for(let i=0;i<10;i++){
        code=(name.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5)||'MARKT')+'-'+Math.floor(1000+Math.random()*9000);
        const x=await db.from('ks_companies').select('id').eq('code',code).maybeSingle();
        if(!x.data)break;
      }
      const co=await db.from('ks_companies').insert({name,type,code}).select('*').single();
      if(co.error)throw co.error;
      await db.from('ks_company_state').upsert({company_id:co.data.id,store_name:name,store_type:type},{onConflict:'company_id'});
      const hp=hashPassword(password);
      const us=await db.from('ks_users').insert({
        company_id:co.data.id,username,display_name:`${name} Admin`,role:'company_admin',
        password_salt:hp.salt,password_hash:hp.hash,active:true
      }).select('*').single();
      if(us.error)throw us.error;
      return json(res,200,{ok:true,company:cleanCompany(co.data)});
    }

    if(action==='register_employee'){
      const companyCode=String(body.companyCode||'').trim().toUpperCase();
      const username=String(body.username||'').trim().toLowerCase();
      const password=String(body.password||'');
      const displayName=String(body.displayName||username).trim();
      if(username.length<3||password.length<4)return json(res,400,{ok:false,error:'Benutzername mindestens 3 und Passwort mindestens 4 Zeichen.'});
      const co=await db.from('ks_companies').select('*').eq('code',companyCode).maybeSingle();
      if(!co.data)return json(res,404,{ok:false,error:'Firmen-Code nicht gefunden.'});
      const exists=await db.from('ks_users').select('id').eq('username',username).maybeSingle();
      if(exists.data)return json(res,409,{ok:false,error:'Benutzername bereits vergeben.'});
      const hp=hashPassword(password);
      const u=await db.from('ks_users').insert({
        company_id:co.data.id,username,display_name:displayName,role:'employee',
        password_salt:hp.salt,password_hash:hp.hash,active:true
      });
      if(u.error)throw u.error;
      return json(res,200,{ok:true});
    }

    const viewer=authPayload(req);
    if(!viewer)return json(res,401,{ok:false,error:'Nicht angemeldet oder Sitzung abgelaufen.'});

    if(action==='snapshot'){
      return json(res,200,{ok:true,...await snapshot(db,viewer)});
    }

    const me=await getMe(db,viewer);

    // ---------------- Central POS data ----------------
    if(action==='data_snapshot'){
      return json(res,200,{ok:true,data:await companyDataSnapshot(db,me)});
    }

    if(action==='seed_products'){
      const products=Array.isArray(body.products)?body.products:[];
      if(!products.length)return json(res,200,{ok:true,count:0});
      const countQ=await db.from('ks_products').select('local_id',{count:'exact',head:true}).eq('company_id',me.company_id);
      if(countQ.error)throw countQ.error;
      if((countQ.count||0)>0 && !isAdmin(me))return json(res,403,{ok:false,error:'Produktkatalog existiert bereits.'});
      if(products.length>1000)return json(res,413,{ok:false,error:'Zu viele Produkte in einem Vorgang.'});
      const rows=products.map(p=>({
        company_id:me.company_id,
        local_id:String(p.id),
        barcode:String(p.barcode||''),
        data:p,
        updated_at:new Date().toISOString()
      }));
      const q=await db.from('ks_products').upsert(rows,{onConflict:'company_id,local_id'});
      if(q.error)throw q.error;
      return json(res,200,{ok:true,count:rows.length});
    }

    if(action==='upsert_product'){
      if(!isAdmin(me))return json(res,403,{ok:false,error:'Nur Firmen-Admin oder Groß-Admin darf Artikel ändern.'});
      const p=body.product;
      if(!p||p.id===undefined||!p.name)return json(res,400,{ok:false,error:'Ungültiger Artikel.'});
      const row={company_id:me.company_id,local_id:String(p.id),barcode:String(p.barcode||''),data:p,updated_at:new Date().toISOString()};
      const q=await db.from('ks_products').upsert(row,{onConflict:'company_id,local_id'});
      if(q.error){
        if(String(q.error.code)==='23505')return json(res,409,{ok:false,error:'Barcode ist bereits einem anderen Artikel zugeordnet.'});
        throw q.error;
      }
      return json(res,200,{ok:true});
    }

    if(action==='delete_product'){
      if(!isAdmin(me))return json(res,403,{ok:false,error:'Nur Firmen-Admin oder Groß-Admin darf Artikel löschen.'});
      const q=await db.from('ks_products').delete().eq('company_id',me.company_id).eq('local_id',String(body.localId||''));
      if(q.error)throw q.error;
      return json(res,200,{ok:true});
    }

    if(action==='seed_coupons'){
      const coupons=Array.isArray(body.coupons)?body.coupons:[];
      const countQ=await db.from('ks_coupons').select('code',{count:'exact',head:true}).eq('company_id',me.company_id);
      if(countQ.error)throw countQ.error;
      if((countQ.count||0)>0 && !isAdmin(me))return json(res,403,{ok:false,error:'Coupons existieren bereits.'});
      const rows=coupons.map(c=>({
        company_id:me.company_id,
        code:normalizeCouponCode(c.code),
        data:c,
        active:c.active!==false,
        updated_at:new Date().toISOString()
      })).filter(r=>r.code);
      if(rows.length){
        const q=await db.from('ks_coupons').upsert(rows,{onConflict:'company_id,code'});
        if(q.error)throw q.error;
      }
      return json(res,200,{ok:true,count:rows.length});
    }

    if(action==='upsert_coupon'){
      if(!isAdmin(me))return json(res,403,{ok:false,error:'Nur Firmen-Admin oder Groß-Admin darf Coupons ändern.'});
      const c=body.coupon;
      const code=normalizeCouponCode(c?.code);
      if(!c||!code)return json(res,400,{ok:false,error:'Ungültiger Coupon.'});
      const q=await db.from('ks_coupons').upsert({
        company_id:me.company_id,code,data:c,active:c.active!==false,updated_at:new Date().toISOString()
      },{onConflict:'company_id,code'});
      if(q.error)throw q.error;
      return json(res,200,{ok:true});
    }

    if(action==='delete_coupon'){
      if(!isAdmin(me))return json(res,403,{ok:false,error:'Nur Firmen-Admin oder Groß-Admin darf Coupons löschen.'});
      const q=await db.from('ks_coupons').delete().eq('company_id',me.company_id).eq('code',normalizeCouponCode(body.code));
      if(q.error)throw q.error;
      return json(res,200,{ok:true});
    }

    if(action==='record_receipt'){
      const r=body.receipt;
      if(!r||!r.id)return json(res,400,{ok:false,error:'Ungültiger Bon.'});
      const receipt={
        ...r,
        companyId:me.company_id,
        cashierUsername:me.username,
        cashierName:me.display_name||me.username
      };
      const couponCode=normalizeCouponCode(receipt?.coupon?.code||'');
      const q=await db.rpc('ks_record_receipt',{
        p_company_id:me.company_id,
        p_receipt_id:String(receipt.id),
        p_data:receipt,
        p_total:Number(receipt.total)||0,
        p_cashier_user_id:me.id,
        p_coupon_code:couponCode||null
      });
      if(q.error)throw q.error;
      return json(res,200,{ok:true,totals:q.data||null});
    }

    if(action==='save_company_state'){
      const cs=body.companyState||{};
      const patch={
        company_id:me.company_id,
        store_name:String(cs.store||'').trim()||'Kasse',
        store_type:String(cs.storeType||'Supermarkt'),
        updated_at:new Date().toISOString()
      };
      const q=await db.from('ks_company_state').upsert(patch,{onConflict:'company_id'}).select('sales,tx').single();
      if(q.error)throw q.error;
      return json(res,200,{ok:true,totals:{sales:Number(q.data.sales)||0,tx:Number(q.data.tx)||0}});
    }

    if(action==='reset_day'){
      const q=await db.from('ks_company_state').upsert({
        company_id:me.company_id,sales:0,tx:0,day_started_at:new Date().toISOString(),updated_at:new Date().toISOString()
      },{onConflict:'company_id'}).select('sales,tx').single();
      if(q.error)throw q.error;
      return json(res,200,{ok:true,totals:{sales:0,tx:0}});
    }

    if(action==='add_activity'){
      const a=body.activity;
      if(!a||!a.id)return json(res,400,{ok:false,error:'Ungültige Aktivität.'});
      const data={...a,companyId:me.company_id,username:me.username,time:a.time||new Date().toISOString()};
      const q=await db.from('ks_activity_log').upsert({
        company_id:me.company_id,local_id:String(a.id),user_id:me.id,data
      },{onConflict:'company_id,local_id'});
      if(q.error)throw q.error;
      return json(res,200,{ok:true});
    }

    // ---------------- Account management ----------------
    if(action==='create_user'){
      if(!isAdmin(me))return json(res,403,{ok:false,error:'Keine Berechtigung.'});
      const companyId=me.role==='superadmin'?String(body.companyId||''):me.company_id;
      let role=String(body.role||'employee');
      if(me.role!=='superadmin')role='employee';
      if(!['company_admin','employee'].includes(role))role='employee';
      const username=String(body.username||'').trim().toLowerCase(),password=String(body.password||''),displayName=String(body.displayName||username).trim();
      if(username.length<3||password.length<4)return json(res,400,{ok:false,error:'Benutzername/Passwort zu kurz.'});
      if(role==='company_admin')await db.from('ks_users').update({role:'employee'}).eq('company_id',companyId).eq('role','company_admin');
      const hp=hashPassword(password);
      const q=await db.from('ks_users').insert({
        company_id:companyId,username,display_name:displayName,role,password_salt:hp.salt,password_hash:hp.hash,active:true
      });
      if(q.error){
        if(String(q.error.code)==='23505')return json(res,409,{ok:false,error:'Benutzername bereits vergeben.'});
        throw q.error;
      }
      return json(res,200,{ok:true});
    }

    if(action==='update_user'){
      if(!isAdmin(me))return json(res,403,{ok:false,error:'Keine Berechtigung.'});
      const id=String(body.id||'');
      const targetQ=await db.from('ks_users').select('*').eq('id',id).single();
      if(targetQ.error)throw targetQ.error;
      const t=targetQ.data;
      if(t.role==='superadmin')return json(res,403,{ok:false,error:'Groß-Admin kann hier nicht verändert werden.'});
      if(me.role!=='superadmin'&&t.company_id!==me.company_id)return json(res,403,{ok:false,error:'Andere Firma nicht erlaubt.'});
      const patch={};
      if(typeof body.username==='string'&&body.username.trim())patch.username=body.username.trim().toLowerCase();
      if(typeof body.displayName==='string')patch.display_name=body.displayName.trim();
      if(typeof body.active==='boolean')patch.active=body.active;
      if(me.role==='superadmin'){
        if(typeof body.companyId==='string'&&body.companyId)patch.company_id=body.companyId;
        if(['employee','company_admin'].includes(body.role))patch.role=body.role;
      }
      const resultingCompany=patch.company_id||t.company_id;
      if(patch.role==='company_admin'){
        await db.from('ks_users').update({role:'employee'}).eq('company_id',resultingCompany).eq('role','company_admin').neq('id',id);
      }
      if(typeof body.password==='string'&&body.password){
        if(body.password.length<4)return json(res,400,{ok:false,error:'Passwort mindestens 4 Zeichen.'});
        const hp=hashPassword(body.password);patch.password_salt=hp.salt;patch.password_hash=hp.hash;
      }
      const q=await db.from('ks_users').update(patch).eq('id',id);
      if(q.error){
        if(String(q.error.code)==='23505')return json(res,409,{ok:false,error:'Benutzername bereits vergeben.'});
        throw q.error;
      }
      return json(res,200,{ok:true});
    }

    if(action==='delete_user'){
      if(me.role!=='superadmin')return json(res,403,{ok:false,error:'Nur der große Admin darf Konten löschen.'});
      const id=String(body.id||'');
      const tq=await db.from('ks_users').select('role').eq('id',id).single();
      if(tq.data?.role==='superadmin')return json(res,403,{ok:false,error:'Groß-Admin kann nicht gelöscht werden.'});
      const q=await db.from('ks_users').delete().eq('id',id);
      if(q.error)throw q.error;
      return json(res,200,{ok:true});
    }

    return json(res,400,{ok:false,error:'Unbekannte Aktion.'});
  }catch(e){
    console.error(e);
    return json(res,500,{ok:false,error:e?.message||'Interner Serverfehler.'});
  }
}
