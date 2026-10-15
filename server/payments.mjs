import {createSafety} from './safety.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export const CONFIG = Object.freeze({ mode:'sandbox', currency:'BRL', minCents:2000, maxCents:1000000, centsPerGold:20, plans:{top:40,vip:250}, networks:['BTC:bitcoin','USDT:tron','USDC:polygon'] });
export class PaymentError extends Error { constructor(message,status=400){super(message);this.status=status;} }
const fail=(condition,message,status=400)=>{if(condition)throw new PaymentError(message,status);};
const hash=value=>createHash('sha256').update(value).digest('hex');

export function createPayments(filename=':memory:', clock=()=>Date.now()){
  const db=new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),local_id TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(user_id,local_id));
    CREATE TABLE IF NOT EXISTS charges(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),request_key TEXT NOT NULL,method TEXT NOT NULL,network TEXT,amount_cents INTEGER NOT NULL,gold INTEGER NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,paid_at INTEGER,UNIQUE(user_id,request_key));
    CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),delta INTEGER NOT NULL,kind TEXT NOT NULL,reference TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(kind,reference));
    CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),request_key TEXT NOT NULL,profile_id TEXT REFERENCES profiles(id),plan TEXT NOT NULL,gold INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,request_key));
    CREATE TABLE IF NOT EXISTS subscriptions(profile_id TEXT REFERENCES profiles(id),plan TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(profile_id,plan));
    CREATE TABLE IF NOT EXISTS favorites(user_id TEXT NOT NULL REFERENCES users(id),profile_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,profile_id));
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,charge_id TEXT REFERENCES charges(id),created_at INTEGER NOT NULL);`);
  // Additive migration preserves existing wallets, purchases and profile IDs.
  const columns = new Set(db.prepare('PRAGMA table_info(profiles)').all().map(column => column.name));
  for (const [name, definition] of Object.entries({age:'INTEGER', city:'TEXT', category:'TEXT', bio:'TEXT', available:'INTEGER NOT NULL DEFAULT 0', created_at:'INTEGER NOT NULL DEFAULT 0', deleted:'INTEGER NOT NULL DEFAULT 0', paused:'INTEGER NOT NULL DEFAULT 0'})) {
    if (!columns.has(name)) db.exec(`ALTER TABLE profiles ADD COLUMN ${name} ${definition}`);
  }
  const query=(sql,...params)=>db.prepare(sql).get(...params);
  const all=(sql,...params)=>db.prepare(sql).all(...params);
  const run=(sql,...params)=>db.prepare(sql).run(...params);
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  const balance=userId=>Number(query('SELECT COALESCE(SUM(delta),0) AS balance FROM ledger WHERE user_id=?',userId).balance);
  const expire=()=>run("UPDATE charges SET status='expired' WHERE status='pending' AND expires_at<=?",clock());
  const session=userId=>{const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');run('DELETE FROM sessions WHERE expires_at<=?',clock());run('INSERT INTO sessions VALUES(?,?,?,?)',hash(token),userId,csrf,clock()+86400000);return{token,csrf,userId};};
  function register(email,password){
    fail(typeof email!=='string'||typeof password!=='string','Informe e-mail e senha.');email=email.trim().toLowerCase();
    fail(email.length>254||!/^\S+@\S+\.\S+$/.test(email),'E-mail inválido.');fail(password.length<12||password.length>128,'Use uma senha entre 12 e 128 caracteres.');
    fail(Boolean(query('SELECT id FROM users WHERE email=?',email)),'E-mail já cadastrado.',409);
    const salt=randomBytes(16).toString('hex'),digest=scryptSync(password,salt,64).toString('hex'),userId=randomUUID();
    run('INSERT INTO users VALUES(?,?,?,?)',userId,email,`${salt}:${digest}`,clock());return session(userId);
  }
  function login(email,password){
    fail(typeof email!=='string'||typeof password!=='string'||password.length>128,'Credenciais inválidas.',401);
    const user=query('SELECT * FROM users WHERE email=?',email.trim().toLowerCase());
    const [salt,digest]=(user?.password||`${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const computed=scryptSync(password,salt,64);fail(!timingSafeEqual(computed,Buffer.from(digest,'hex'))||!user,'Credenciais inválidas.',401);return session(user.id);
  }
  function authenticate(token){if(typeof token!=='string'||token.length!==64)return null;return query('SELECT user_id AS userId,csrf FROM sessions WHERE token_hash=? AND expires_at>?',hash(token),clock())||null;}
  function logout(token){if(token)run('DELETE FROM sessions WHERE token_hash=?',hash(token));}
  function wallet(userId){expire();return {mode:CONFIG.mode,currency:CONFIG.currency,gold:balance(userId),charges:all('SELECT id,method,network,amount_cents AS amountCents,gold,status,created_at AS createdAt,expires_at AS expiresAt FROM charges WHERE user_id=? ORDER BY created_at DESC LIMIT 100',userId),profiles:all('SELECT id,local_id AS localId,name,age,city,category,bio,available,paused,created_at AS createdAt FROM profiles WHERE user_id=? AND deleted=0',userId),subscriptions:all('SELECT p.local_id AS profileId,s.plan,s.expires_at AS expiresAt FROM subscriptions s JOIN profiles p ON p.id=s.profile_id WHERE p.user_id=? AND p.deleted=0 AND s.expires_at>?',userId,clock())};}
  function validateProfile(input) {
    const {name,age,city,category,bio,available}=input;
    fail(typeof name!=='string'||!name.trim()||name.length>40,'Nome inválido.');
    fail(!Number.isInteger(age)||age<18||age>99,'Informe uma idade entre 18 e 99 anos.');
    fail(!['São Paulo','Rio de Janeiro','Lisboa','Madrid'].includes(city),'Cidade inválida.');
    fail(!['Companhia','Eventos','City tour'].includes(category),'Categoria inválida.');
    fail(typeof bio!=='string'||!bio.trim()||bio.length>600,'Descrição inválida.');
    fail(typeof available!=='boolean','Disponibilidade inválida.');
    return [name.trim(),age,city,category,bio.trim(),Number(available)];
  }
  function addProfile(userId,input){
    const {localId,name}=input;
    fail(typeof localId!=='string'||localId.length<1||localId.length>100||typeof name!=='string'||!name.trim()||name.length>40,'Perfil inválido.');
    const values=Object.hasOwn(input,'age')?validateProfile(input):null;
    const existing=query('SELECT id,deleted FROM profiles WHERE user_id=? AND local_id=?',userId,localId);
    if(existing){fail(Boolean(existing.deleted),'Este anúncio foi excluído.',409);return {id:existing.id};}
    const id=randomUUID();
    run('INSERT INTO profiles(id,user_id,local_id,name,created_at) VALUES(?,?,?,?,?)',id,userId,localId,name.trim(),clock());
    if(values)run('UPDATE profiles SET name=?,age=?,city=?,category=?,bio=?,available=? WHERE id=?',...values,id);
    return{id};
  }
  function updateProfile(userId,id,input){
    const values=validateProfile(input);
    fail(!query('SELECT id FROM profiles WHERE id=? AND user_id=? AND deleted=0',id,userId),'Perfil inexistente.',404);
    run('UPDATE profiles SET name=?,age=?,city=?,category=?,bio=?,available=? WHERE id=?',...values,id);
    return{id};
  }
  function pauseProfile(userId,id,{paused}){
    fail(typeof paused!=='boolean','Estado do perfil inválido.');
    fail(!query('SELECT id FROM profiles WHERE id=? AND user_id=? AND deleted=0',id,userId),'Perfil inexistente.',404);
    run('UPDATE profiles SET paused=? WHERE id=?',Number(paused),id);
    return{id,paused};
  }
  function deleteProfile(userId,id){
    fail(!query('SELECT id FROM profiles WHERE id=? AND user_id=? AND deleted=0',id,userId),'Perfil inexistente.',404);
    // Preserve financial references; removed profiles cannot be advertised or promoted.
    transaction(()=>{run('UPDATE profiles SET deleted=1 WHERE id=?',id);run('DELETE FROM favorites WHERE profile_id=?',id);});
    return{ok:true};
  }
  function directory(){
    return all(`SELECT p.id,p.name,p.age,p.city,p.category,p.bio,p.available,p.created_at AS createdAt,
      EXISTS(SELECT 1 FROM subscriptions s WHERE s.profile_id=p.id AND s.plan='vip' AND s.expires_at>?) AS vip,
      EXISTS(SELECT 1 FROM subscriptions s WHERE s.profile_id=p.id AND s.plan='top' AND s.expires_at>?) AS top
      FROM profiles p WHERE p.deleted=0 AND p.paused=0 AND p.age IS NOT NULL ORDER BY p.created_at DESC,p.id`,clock(),clock());
  }
  const isSeedProfile=id=>/^[1-8]$/.test(id);
  const isPublicProfile=id=>isSeedProfile(id)||Boolean(query('SELECT id FROM profiles WHERE id=? AND deleted=0 AND paused=0 AND age IS NOT NULL',id));
  function favoriteIds(userId){
    return all(`SELECT f.profile_id AS id FROM favorites f WHERE f.user_id=? AND
      (f.profile_id IN ('1','2','3','4','5','6','7','8') OR EXISTS(SELECT 1 FROM profiles p WHERE p.id=f.profile_id AND p.deleted=0 AND p.paused=0 AND p.age IS NOT NULL))
      ORDER BY f.created_at DESC,f.profile_id`,userId).map(row=>row.id);
  }
  function setFavorite(userId,{profileId,saved}){
    fail(typeof profileId!=='string'||!profileId||profileId.length>128||typeof saved!=='boolean','Favorito inválido.');
    if(saved){
      fail(!isPublicProfile(profileId),'Perfil inexistente.',404);
      run('INSERT INTO favorites VALUES(?,?,?) ON CONFLICT(user_id,profile_id) DO NOTHING',userId,profileId,clock());
    }else run('DELETE FROM favorites WHERE user_id=? AND profile_id=?',userId,profileId);
    return{favorites:favoriteIds(userId)};
  }
  function importFavorites(userId,{ids}){return transaction(()=>{
    fail(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string'||!id||id.length>128),'Lista de favoritos inválida.');
    let imported=0;
    for(const oldId of new Set(ids)){
      const id=isPublicProfile(oldId)?oldId:query('SELECT id FROM profiles WHERE user_id=? AND local_id=? AND deleted=0 AND paused=0 AND age IS NOT NULL',userId,oldId)?.id;
      if(!id)continue;
      imported+=Number(run('INSERT INTO favorites VALUES(?,?,?) ON CONFLICT(user_id,profile_id) DO NOTHING',userId,id,clock()).changes);
    }
    return{favorites:favoriteIds(userId),imported};
  });}
  function charge(userId,input,key){
    fail(typeof key!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(key),'Chave de idempotência inválida.');
    const {method,amountCents}=input,network=method==='crypto'?input.network:null;
    fail(!['pix','card','crypto'].includes(method),'Método inválido.');
    fail(!Number.isSafeInteger(amountCents)||amountCents<CONFIG.minCents||amountCents>CONFIG.maxCents||amountCents%100!==0,'Informe reais inteiros entre R$20 e R$10.000.');
    fail(method==='crypto'&&!CONFIG.networks.includes(network),'Selecione a moeda e a rede.');
    expire();const previous=query('SELECT * FROM charges WHERE user_id=? AND request_key=?',userId,key);
    if(previous){fail(previous.method!==method||previous.amount_cents!==amountCents||previous.network!==network,'Chave já utilizada com outra cobrança.',409);return previous;}
    const id=randomUUID(),now=clock();run('INSERT INTO charges VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,userId,key,method,network,amountCents,amountCents/CONFIG.centsPerGold,'pending',now,now+1800000,null);
    return query('SELECT * FROM charges WHERE id=?',id);
  }
  function settle(input){return transaction(()=>{
    const {eventId,chargeId,amountCents,currency,status}=input;
    fail(typeof eventId!=='string'||eventId.length<1||eventId.length>128,'Evento inválido.');
    fail(!['paid','failed'].includes(status),'Status inválido.');
    const fingerprint=hash(JSON.stringify({eventId,chargeId,amountCents,currency,status}));
    const duplicate=query('SELECT payload_hash FROM events WHERE id=?',eventId);
    if(duplicate){fail(duplicate.payload_hash!==fingerprint,'Evento repetido com conteúdo diferente.',409);return{duplicate:true};}
    expire();const order=query('SELECT * FROM charges WHERE id=?',chargeId);fail(!order,'Cobrança inexistente.',404);
    fail(!Number.isSafeInteger(amountCents)||order.amount_cents!==amountCents||currency!==CONFIG.currency,'Valor ou moeda divergente.',409);
    fail(order.status==='expired','Cobrança expirada; requer reconciliação.',409);
    fail(order.status==='failed'||(order.status==='paid'&&status!=='paid'),'Transição de status inválida.',409);
    if(order.status==='pending'){
      run('UPDATE charges SET status=?,paid_at=? WHERE id=?',status,status==='paid'?clock():null,order.id);
      if(status==='paid')run('INSERT INTO ledger VALUES(?,?,?,?,?,?)',randomUUID(),order.user_id,order.gold,'recharge',order.id,clock());
    }
    run('INSERT INTO events VALUES(?,?,?,?)',eventId,fingerprint,chargeId,clock());return{duplicate:false,status};
  });}
  function simulate(userId,chargeId){const order=query('SELECT * FROM charges WHERE id=? AND user_id=?',chargeId,userId);fail(!order,'Cobrança inexistente.',404);return settle({eventId:`sandbox-${chargeId}`,chargeId,amountCents:order.amount_cents,currency:'BRL',status:'paid'});}
  function buy(userId,{profileId,plan},key){return transaction(()=>{
    fail(typeof key!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(key),'Chave de idempotência inválida.');
    fail(!Object.hasOwn(CONFIG.plans,plan),'Plano inválido.');
    fail(!query('SELECT id FROM profiles WHERE id=? AND user_id=? AND deleted=0 AND paused=0',profileId,userId),'Perfil inexistente.',404);
    const previous=query('SELECT * FROM purchases WHERE user_id=? AND request_key=?',userId,key);
    if(previous){fail(previous.profile_id!==profileId||previous.plan!==plan,'Chave já utilizada com outra ativação.',409);return previous;}
    const gold=CONFIG.plans[plan];fail(balance(userId)<gold,'Saldo GOLD insuficiente.',409);
    const id=randomUUID(),now=clock(),old=query('SELECT expires_at FROM subscriptions WHERE profile_id=? AND plan=?',profileId,plan);
    run('INSERT INTO purchases VALUES(?,?,?,?,?,?,?)',id,userId,key,profileId,plan,gold,now);
    run('INSERT INTO ledger VALUES(?,?,?,?,?,?)',randomUUID(),userId,-gold,'promotion',id,now);
    run('INSERT INTO subscriptions VALUES(?,?,?) ON CONFLICT(profile_id,plan) DO UPDATE SET expires_at=excluded.expires_at',profileId,plan,Math.max(now,old?.expires_at||0)+30*86400000);
    return{id,plan,gold};
  });}
  return{...createSafety(db,clock),register,login,authenticate,logout,wallet,addProfile,updateProfile,pauseProfile,deleteProfile,directory,favoriteIds,setFavorite,importFavorites,charge,settle,simulate,buy,close:()=>db.close()};
}
