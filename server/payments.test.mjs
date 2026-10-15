import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPayments} from './payments.mjs';
import {createApp} from './server.mjs';
const password='senha-de-teste-12345';
test('Pix, cartão e cripto: confirmação exatamente uma vez e valor conferido',()=>{
  const p=createPayments();try{const u=p.register('one@example.test',password).userId;
    for(const method of ['pix','card','crypto']){
      const input={method,amountCents:2000,...(method==='crypto'?{network:'USDT:tron'}:{})};
      const charge=p.charge(u,input,`request-${method}`);assert.equal(p.charge(u,input,`request-${method}`).id,charge.id);
      assert.throws(()=>p.charge(u,{...input,amountCents:3000},`request-${method}`),/outra cobrança/);
      assert.throws(()=>p.settle({eventId:`wrong-${method}`,chargeId:charge.id,amountCents:1000,currency:'BRL',status:'paid'}),/divergente/);
      const event={eventId:`paid-${method}`,chargeId:charge.id,amountCents:2000,currency:'BRL',status:'paid'};
      p.settle(event);assert.equal(p.settle(event).duplicate,true);p.settle({...event,eventId:`second-${method}`});
      assert.throws(()=>p.settle({...event,status:'failed'}),/conteúdo diferente/);
    }assert.equal(p.wallet(u).gold,300);
    assert.throws(()=>p.charge(u,{method:'pix',amountCents:1999},'bad-amount'),/reais inteiros/);
    assert.throws(()=>p.charge(u,{method:'crypto',amountCents:2000,network:'USDT:ethereum'},'bad-network'),/moeda e a rede/);
  }finally{p.close();}
});
test('planos: propriedade, saldo, idempotência e prorrogação',()=>{
  const p=createPayments();try{const a=p.register('a@example.test',password).userId,b=p.register('b@example.test',password).userId;
    const profile=p.addProfile(a,{localId:'local-a',name:'Perfil de teste'}).id;
    assert.throws(()=>p.buy(a,{profileId:profile,plan:'vip'},'no-balance'),/insuficiente/);
    const order=p.charge(a,{method:'pix',amountCents:10000},'fund-wallet');p.simulate(a,order.id);
    assert.throws(()=>p.simulate(b,order.id),/inexistente/);assert.throws(()=>p.buy(b,{profileId:profile,plan:'top'},'wrong-owner'),/inexistente/);
    p.buy(a,{profileId:profile,plan:'top'},'buy-top-001');p.buy(a,{profileId:profile,plan:'top'},'buy-top-001');assert.equal(p.wallet(a).gold,460);
    const first=p.wallet(a).subscriptions[0].expiresAt;p.buy(a,{profileId:profile,plan:'top'},'buy-top-002');assert.equal(p.wallet(a).subscriptions[0].expiresAt-first,30*86400000);
    assert.throws(()=>p.buy(a,{profileId:profile,plan:'vip'},'buy-top-001'),/outra ativação/);assert.equal(p.wallet(a).gold,420);
  }finally{p.close();}
});
test('expiração bloqueia confirmação e login não aceita senha errada',()=>{
  let now=Date.now();const p=createPayments(':memory:',()=>now);try{const session=p.register('expiry@example.test',password);assert.equal(p.authenticate(session.token).userId,session.userId);
    assert.throws(()=>p.login('expiry@example.test','wrong'),/inválidas/);
    const charge=p.charge(session.userId,{method:'pix',amountCents:2000},'expire-test');now+=1800001;
    assert.throws(()=>p.simulate(session.userId,charge.id),/expirada/);assert.equal(p.wallet(session.userId).gold,0);
    p.logout(session.token);assert.equal(p.authenticate(session.token),null);
  }finally{p.close();}
});
test('saldo persiste após reabrir SQLite',()=>{
  const filename=path.join(mkdtempSync(path.join(tmpdir(),'elan-pay-test-')),'test.sqlite');let p=createPayments(filename);
  const u=p.register('persistent@example.test',password).userId;const charge=p.charge(u,{method:'card',amountCents:2000},'persist-order');p.simulate(u,charge.id);p.close();p=createPayments(filename);
  try{assert.equal(p.wallet(u).gold,100);assert.equal(p.wallet(u).charges[0].status,'paid');}finally{p.close();}
});
test('HTTP: autenticação, CSRF, isolamento, webhook assinado e arquivos privados',async()=>{
  const secret='sandbox-secret-for-tests-only-123456789';const configuredKey='44769766000100';const {server}=createApp({webhookSecret:secret,pixBank:'santander',pixKey:configuredKey});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(route,body,headers={})=>fetch(`${base}/api/${route}`,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:base}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  try{
    const configuration=await (await request('config')).json();assert.equal(configuration.pix.bank,'Santander');assert.equal(configuration.pix.keyConfigured,true);assert.equal(configuration.pix.status,'not_integrated');assert.ok(!JSON.stringify(configuration).includes(configuredKey));
    assert.equal((await request('wallet')).status,401);
    assert.equal((await request('register',{email:'http@example.test',password},{Origin:'https://evil.test'})).status,403);
    const registration=await request('register',{email:'http@example.test',password});assert.equal(registration.status,200);const cookie=registration.headers.get('set-cookie').split(';')[0];const {csrf}=await registration.json();const headers={Cookie:cookie,'X-CSRF-Token':csrf,'Idempotency-Key':'http-charge-001'};
    assert.equal((await request('charges',{method:'pix',amountCents:2000},{Cookie:cookie})).status,403);
    assert.equal((await request('charges',{method:'card',amountCents:2000,cvv:'123'},headers)).status,400);
    const created=await request('charges',{method:'pix',amountCents:2000},headers);assert.equal(created.status,201);const order=await created.json();
    const event={eventId:'http-event-001',chargeId:order.id,amountCents:2000,currency:'BRL',status:'paid'};
    assert.equal((await request('webhooks/sandbox',event)).status,401);
    const timestamp=String(Date.now()),signature=createHmac('sha256',secret).update(`${timestamp}.${JSON.stringify(event)}`).digest('hex');const signed={'X-Webhook-Timestamp':timestamp,'X-Webhook-Signature':signature};
    assert.equal((await request('webhooks/sandbox',event,signed)).status,200);assert.equal((await request('webhooks/sandbox',event,signed)).status,200);
    assert.equal((await (await request('wallet',undefined,{Cookie:cookie})).json()).gold,100);
    assert.equal((await fetch(`${base}/server/payments.mjs`)).status,404);assert.equal((await fetch(`${base}/data/sandbox.sqlite`)).status,404);assert.equal((await fetch(`${base}/.env`)).status,404);
    await request('logout',{},headers);assert.equal((await request('wallet',undefined,{Cookie:cookie})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('anúncios: validação, isolamento, edição, exclusão e destaques públicos',()=>{
  let now=1000;const p=createPayments(':memory:',()=>now);
  const input={localId:'original',name:'Ana',age:25,city:'São Paulo',category:'Eventos',bio:'Descrição do anúncio',available:true};
  try{
    const a=p.register('owner@example.test',password).userId,b=p.register('other@example.test',password).userId;
    assert.throws(()=>p.addProfile(a,{...input,age:17}),/idade/);
    assert.equal(p.directory().length,0);
    const {id}=p.addProfile(a,input);
    assert.equal(p.wallet(a).profiles[0].id,id);assert.equal(p.wallet(b).profiles.length,0);
    assert.equal(p.directory()[0].createdAt,1000);
    assert.throws(()=>p.updateProfile(b,id,{...input,name:'Invasão'}),/inexistente/);
    assert.throws(()=>p.deleteProfile(b,id),/inexistente/);
    now=2000;p.updateProfile(a,id,{...input,name:'Ana editada',available:false});
    assert.equal(p.directory()[0].name,'Ana editada');assert.equal(p.directory()[0].available,0);
    assert.equal(p.directory()[0].createdAt,1000);
    const charge=p.charge(a,{method:'pix',amountCents:10000},'profile-funding');p.simulate(a,charge.id);
    p.buy(a,{profileId:id,plan:'vip'},'profile-promotion');assert.equal(p.directory()[0].vip,1);
    p.deleteProfile(a,id);assert.equal(p.directory().length,0);assert.equal(p.wallet(a).profiles.length,0);
    assert.equal(p.wallet(a).subscriptions.length,0);assert.equal(p.wallet(a).gold,250);
    assert.throws(()=>p.buy(a,{profileId:id,plan:'top'},'deleted-profile'),/inexistente/);
    assert.throws(()=>p.addProfile(a,input),/excluído/);
  }finally{p.close();}
});

test('HTTP: CRUD de anúncios exige sessão, CSRF e proprietário; diretório é público',async()=>{
  const {server}=createApp();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body,auth={})=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...auth},body:JSON.stringify(body)});
  const account=async email=>{const response=await post('register',{email,password});const session=await response.json();return{Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':session.csrf};};
  try{
    const owner=await account('crud-owner@example.test'),other=await account('crud-other@example.test');
    const input={localId:'http-profile',name:'Ana',age:25,city:'Lisboa',category:'Eventos',bio:'Anúncio de teste',available:true};
    assert.equal((await post('profiles',input)).status,401);
    const created=await post('profiles',input,owner);assert.equal(created.status,201);const {id}=await created.json();
    const {localId,...update}=input;
    assert.equal((await post('profiles/'+id+'/update',update,{Cookie:owner.Cookie})).status,403);
    assert.equal((await post('profiles/'+id+'/update',update,other)).status,404);
    assert.equal((await post('profiles/'+id+'/delete',{},other)).status,404);
    assert.equal((await post('profiles/'+id+'/update',{...update,name:'Alterada'},owner)).status,200);
    const directory=await(await fetch(base+'/api/directory')).json();assert.equal(directory.profiles[0].name,'Alterada');assert.equal(directory.profiles[0].user_id,undefined);
    assert.equal((await post('profiles/'+id+'/delete',{},owner)).status,200);
    assert.equal((await(await fetch(base+'/api/directory')).json()).profiles.length,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('migração preserva anúncios do esquema anterior e permite completar o cadastro',async()=>{
  const {DatabaseSync}=await import('node:sqlite');
  const filename=path.join(mkdtempSync(path.join(tmpdir(),'elan-migration-')),'legacy.sqlite');
  const old=new DatabaseSync(filename);
  old.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE profiles(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),local_id TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(user_id,local_id));
    INSERT INTO users VALUES('owner','legacy@example.test','unused',100);
    INSERT INTO profiles VALUES('existing-profile','owner','local-existing','Nome antigo');`);
  old.close();let p=createPayments(filename);
  const complete={name:'Nome atualizado',age:28,city:'Madrid',category:'City tour',bio:'Descrição migrada',available:true};
  try{
    assert.equal(p.wallet('owner').profiles[0].id,'existing-profile');assert.equal(p.directory().length,0);
    assert.equal(p.addProfile('owner',{localId:'local-existing',...complete}).id,'existing-profile');
    p.updateProfile('owner','existing-profile',complete);
    const charge=p.charge('owner',{method:'pix',amountCents:2000},'migration-charge');p.simulate('owner',charge.id);
    p.close();p=createPayments(filename);
    assert.equal(p.wallet('owner').gold,100);assert.equal(p.directory()[0].name,'Nome atualizado');
  }finally{p.close();}
});

test('favoritos: isolamento, idempotência, importação e remoção de anúncio excluído',()=>{
  const p=createPayments();
  try{
    const a=p.register('favorites-a@example.test',password).userId,b=p.register('favorites-b@example.test',password).userId;
    const profile=p.addProfile(a,{localId:'old-favorite',name:'Teste',age:25,city:'Lisboa',category:'Eventos',bio:'Perfil público de teste',available:true}).id;
    p.setFavorite(a,{profileId:'1',saved:true});p.setFavorite(a,{profileId:'1',saved:true});
    assert.deepEqual(p.favoriteIds(a),['1']);assert.deepEqual(p.favoriteIds(b),[]);
    assert.throws(()=>p.setFavorite(a,{profileId:'missing',saved:true}),/inexistente/);
    assert.throws(()=>p.setFavorite(a,{profileId:profile,saved:'true'}),/inválido/);
    assert.throws(()=>p.importFavorites(a,{ids:['2',null]}),/inválida/);assert.deepEqual(p.favoriteIds(a),['1']);
    assert.throws(()=>p.importFavorites(a,{ids:Array(501).fill('1')}),/inválida/);
    const imported=p.importFavorites(a,{ids:['1','2','2','missing','old-favorite']});assert.equal(imported.imported,2);
    assert.deepEqual(new Set(p.favoriteIds(a)),new Set(['1','2',profile]));
    assert.equal(p.importFavorites(a,{ids:['1','2',profile]}).imported,0);
    assert.equal(p.importFavorites(b,{ids:['old-favorite']}).imported,0,'IDs locais pertencem ao proprietário');
    p.setFavorite(b,{profileId:profile,saved:true});p.deleteProfile(a,profile);
    assert.deepEqual(new Set(p.favoriteIds(a)),new Set(['1','2']));assert.deepEqual(p.favoriteIds(b),[]);
    p.setFavorite(a,{profileId:'1',saved:false});p.setFavorite(a,{profileId:'1',saved:false});assert.deepEqual(p.favoriteIds(a),['2']);
    assert.throws(()=>p.setFavorite(b,{profileId:profile,saved:true}),/inexistente/);
  }finally{p.close();}
});

test('favoritos persistem no SQLite e são compartilhados entre sessões da mesma conta',()=>{
  const filename=path.join(mkdtempSync(path.join(tmpdir(),'elan-favorites-')),'favorites.sqlite');let p=createPayments(filename);
  const first=p.register('favorites-persist@example.test',password),second=p.login('favorites-persist@example.test',password);
  p.setFavorite(first.userId,{profileId:'3',saved:true});assert.deepEqual(p.favoriteIds(p.authenticate(second.token).userId),['3']);
  p.close();p=createPayments(filename);
  try{assert.deepEqual(p.favoriteIds(first.userId),['3']);p.setFavorite(first.userId,{profileId:'3',saved:false});assert.deepEqual(p.favoriteIds(first.userId),[]);}finally{p.close();}
});

test('HTTP: favoritos exigem sessão e CSRF, não aceitam outro usuário e não duplicam',async()=>{
  const {server}=createApp();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body,auth={})=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...auth},body:JSON.stringify(body)});
  const account=async email=>{const response=await post('register',{email,password});const session=await response.json();return{Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':session.csrf};};
  const get=auth=>fetch(base+'/api/favorites',{headers:auth});
  try{
    assert.equal((await get({})).status,401);
    const a=await account('favorites-http-a@example.test'),b=await account('favorites-http-b@example.test');
    assert.equal((await post('favorites',{profileId:'1',saved:true},{Cookie:a.Cookie})).status,403);
    assert.equal((await post('favorites',{profileId:'1',saved:true,userId:'other'},a)).status,400);
    assert.equal((await post('favorites',{profileId:'1',saved:true},a)).status,200);
    assert.deepEqual((await(await get(a)).json()).favorites,['1']);assert.deepEqual((await(await get(b)).json()).favorites,[]);
    const imported=await post('favorites/import',{ids:['1','2','unknown']},a);assert.equal(imported.status,200);assert.equal((await imported.json()).imported,1);
    assert.equal((await post('favorites/import',{ids:['3']},{Cookie:a.Cookie})).status,403);
    assert.equal((await post('favorites',{profileId:'unknown',saved:true},a)).status,404);
    assert.equal((await post('favorites',{profileId:'1',saved:false},a)).status,200);
    assert.deepEqual((await(await get(a)).json()).favorites,['2']);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
