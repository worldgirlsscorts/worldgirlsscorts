import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createPayments} from './payments.mjs';
import {createApp} from './server.mjs';
import {reviewReport} from './moderation.mjs';
const password='secure-test-password-123';
const profile={localId:'safety-profile',name:'Perfil teste',age:25,city:'Lisboa',category:'Eventos',bio:'Perfil de teste',available:true};

test('pausa remove da listagem e dos favoritos visíveis sem perder dados',()=>{
  const p=createPayments();try{
    const owner=p.register('pause-owner@example.test',password),other=p.register('pause-other@example.test',password);
    const {id}=p.addProfile(owner.userId,profile);p.setFavorite(other.userId,{profileId:id,saved:true});
    assert.throws(()=>p.pauseProfile(other.userId,id,{paused:true}),/inexistente/);
    assert.throws(()=>p.pauseProfile(owner.userId,id,{paused:'true'}),/inválido/);
    const order=p.charge(owner.userId,{method:'pix',amountCents:10000},'pause-funding');p.simulate(owner.userId,order.id);p.buy(owner.userId,{profileId:id,plan:'vip'},'pause-promotion');
    const expiry=p.wallet(owner.userId).subscriptions[0].expiresAt;
    p.pauseProfile(owner.userId,id,{paused:true});assert.equal(p.directory().length,0);assert.deepEqual(p.favoriteIds(other.userId),[]);
    assert.equal(p.wallet(owner.userId).profiles[0].paused,1);assert.equal(p.wallet(owner.userId).subscriptions[0].expiresAt,expiry);
    assert.throws(()=>p.buy(owner.userId,{profileId:id,plan:'top'},'paused-buy'),/inexistente/);
    p.pauseProfile(owner.userId,id,{paused:false});assert.equal(p.directory()[0].id,id);assert.deepEqual(p.favoriteIds(other.userId),[id]);
  }finally{p.close();}
});

test('recuperação expira, invalida links antigos e encerra todas as sessões',()=>{
  let now=1000;const p=createPayments(':memory:',()=>now);try{
    const first=p.register('reset@example.test',password),second=p.login('reset@example.test',password);
    assert.equal(p.requestReset('unknown@example.test'),null);
    const old=p.requestReset('reset@example.test'),fresh=p.requestReset('RESET@example.test');
    assert.throws(()=>p.resetPassword({token:old.token,password:'new-secure-password-123'}),/inválido/);
    assert.throws(()=>p.resetPassword({token:fresh.token,password:'short'}),/senha/);
    p.resetPassword({token:fresh.token,password:'new-secure-password-123'});
    assert.equal(p.authenticate(first.token),null);assert.equal(p.authenticate(second.token),null);
    assert.throws(()=>p.login('reset@example.test',password),/inválidas/);
    assert.ok(p.login('reset@example.test','new-secure-password-123').token);
    assert.throws(()=>p.resetPassword({token:fresh.token,password:'another-password-123'}),/inválido/);
    const expired=p.requestReset('reset@example.test');now+=15*60000;
    assert.throws(()=>p.resetPassword({token:expired.token,password:'another-password-123'}),/inválido/);
    const cancelled=p.requestReset('reset@example.test');p.cancelReset(cancelled.token);
    assert.throws(()=>p.resetPassword({token:cancelled.token,password:'another-password-123'}),/inválido/);
  }finally{p.close();}
});

test('encerrar outros acessos mantém a sessão atual e outras contas',()=>{
  const p=createPayments();try{
    const a=p.register('sessions@example.test',password),b=p.login('sessions@example.test',password),other=p.register('isolated@example.test',password);
    const sessions=p.sessions(a.userId,a.token);assert.equal(sessions.length,2);assert.equal(sessions.filter(s=>s.current).length,1);assert.equal(sessions[0].token_hash,undefined);
    assert.equal(p.revokeOthers(a.userId,a.token).revoked,1);assert.ok(p.authenticate(a.token));assert.equal(p.authenticate(b.token),null);assert.ok(p.authenticate(other.token));
  }finally{p.close();}
});

test('denúncias preservam privacidade, não duplicam e mantêm histórico de revisão',()=>{
  const filename=path.join(mkdtempSync(path.join(tmpdir(),'elan-reports-')),'reports.sqlite');let p=createPayments(filename);
  const body={profileId:'1',reason:'unauthorized_image',details:'Imagem utilizada sem autorização.',receipt:'a'.repeat(64)};
  let protocol;try{
    const report=p.createReport(body,'report-request-001');protocol=report.protocol;
    assert.equal(p.createReport(body,'report-request-001').protocol,protocol);
    assert.throws(()=>p.createReport({...body,details:'Outra descrição válida.'},'report-request-001'),/outra denúncia/);
    assert.throws(()=>p.reportStatus({protocol,receipt:'b'.repeat(64)}),/inválido/);
    const status=p.reportStatus({protocol,receipt:body.receipt});assert.equal(status.status,'received');assert.equal(status.details,undefined);
    assert.throws(()=>p.createReport({...body,profileId:'missing',receipt:'c'.repeat(64)},'report-request-002'),/inexistente/);
    assert.throws(()=>p.createReport({...body,reason:'invalid'},'report-request-003'),/motivo/);
    p.close();p=createPayments(filename);assert.equal(p.reportStatus({protocol,receipt:body.receipt}).status,'received');
    const db=new DatabaseSync(filename);try{
      assert.notEqual(db.prepare('SELECT receipt_hash FROM reports').get().receipt_hash,body.receipt);
      reviewReport(db,protocol,'reviewing','Análise humana iniciada.',2000);reviewReport(db,protocol,'resolved','Relato analisado pelo responsável.',3000);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM report_history').get().n,3);
    }finally{db.close();}
    assert.equal(p.reportStatus({protocol,receipt:body.receipt}).status,'resolved');
  }finally{p.close();}
});

test('HTTP: recuperação não revela contas nem tokens; limites, CSRF e privacidade',async()=>{
  const deliveries=[];const {server}=createApp({sendRecovery:async delivery=>deliveries.push(delivery)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body,headers={})=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify(body)});
  try{
    const registration=await post('register',{email:'http-reset@example.test',password}),session=await registration.json(),cookie=registration.headers.get('set-cookie').split(';')[0];
    const headers={Cookie:cookie,'X-CSRF-Token':session.csrf};
    const known=await(await post('password/forgot',{email:'http-reset@example.test'})).json();
    const unknown=await(await post('password/forgot',{email:'unknown@example.test'})).json();assert.deepEqual(known,unknown);assert.equal(deliveries.length,1);assert.equal(known.token,undefined);
    assert.match(deliveries[0].url,/#recovery=[a-f0-9]{64}$/);
    assert.equal((await post('sessions/revoke-others',{}, {Cookie:cookie})).status,403);
    assert.equal((await post('sessions/revoke-others',{},headers)).status,200);
    const created=await post('profiles',profile,headers),{id}=await created.json();
    assert.equal((await post('profiles/'+id+'/pause',{paused:true},{Cookie:cookie})).status,403);
    assert.equal((await post('profiles/'+id+'/pause',{paused:true},headers)).status,200);
    assert.deepEqual((await(await fetch(base+'/api/directory')).json()).profiles,[]);
    assert.equal((await post('password/reset',{token:deliveries[0].token,password:'updated-password-123'})).status,200);
    assert.equal((await fetch(base+'/api/session',{headers:{Cookie:cookie}})).status,401);
    assert.equal((await post('password/reset',{token:deliveries[0].token,password:'another-password-123'})).status,400);
    assert.equal((await fetch(base+'/data/recovery/example.json')).status,404);
    assert.equal((await fetch(base+'/api/reports')).status,401);
    const receipt='d'.repeat(64),report=await post('reports',{profileId:'1',reason:'impersonation',details:'Descrição de falsificação para teste.',receipt},{'Idempotency-Key':'http-report-001'});
    assert.equal(report.status,201);const {protocol}=await report.json();
    assert.equal((await post('reports/status',{protocol,receipt})).status,200);
    assert.equal((await post('reports/status',{protocol,receipt:'e'.repeat(64)})).status,404);
    assert.equal((await post('reports',{profileId:'1',reason:'other',details:'Descrição válida.',receipt:'f'.repeat(64)},{Origin:'https://evil.test','Idempotency-Key':'http-report-002'})).status,403);
    for(let i=0;i<3;i++)await post('password/forgot',{email:'unknown@example.test'});
    const limited=await post('password/forgot',{email:'unknown@example.test'});assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
  }finally{await new Promise(r=>server.close(r));}
});
