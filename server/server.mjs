import http from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { createPayments, CONFIG, PaymentError } from './payments.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const assets=new Map([['/','index.html'],...['index.html','app.js','payments.js','safety.js','styles.css','finishing.css','icon.svg','brand-mark.svg','logo.svg','world-girls-logo.png','manifest.webmanifest','sw.js'].map(name=>[`/${name}`,name])]);
const mime={png:'image/png',html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',webmanifest:'application/manifest+json'};
export function createApp({database=':memory:',webhookSecret='',clock=()=>Date.now(),pixBank=process.env.PIX_BANK||'',pixKey=process.env.PIX_KEY||'',sendRecovery=null,recoveryDelivery=sendRecovery?'configured':'disabled'}={}){
  const payments=createPayments(database,clock),attempts=new Map();
  function limit(req,res,group,max,windowMs){
    const now=clock();for(const [key,value] of attempts)if(value.expiresAt<=now)attempts.delete(key);
    const key=group+':'+req.socket.remoteAddress;
    const counter=attempts.get(key)||{count:0,expiresAt:now+windowMs};counter.count++;attempts.set(key,counter);
    if(counter.count>max){res.setHeader('Retry-After',String(Math.ceil((counter.expiresAt-now)/1000)));throw new PaymentError('Muitas tentativas. Aguarde e tente novamente.',429);}
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    try{
      const expectedHost=`127.0.0.1:${server.address().port}`;
      if(![expectedHost,`localhost:${server.address().port}`].includes(req.headers.host))throw new PaymentError('Host inválido.',403);
      const url=new URL(req.url,`http://${expectedHost}`);
      if(!url.pathname.startsWith('/api/')){
        if(!['GET','HEAD'].includes(req.method)||!assets.has(url.pathname)){json(404,{error:'Não encontrado.'});return;}
        const filename=assets.get(url.pathname),content=readFileSync(path.join(root,filename));
        res.writeHead(200,{'Content-Type':mime[filename.split('.').pop()]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);return;
      }
      let raw='',body={};
      if(req.method==='POST'){
        if(req.headers['content-type']!=='application/json')throw new PaymentError('Use application/json.',415);
        for await(const chunk of req){raw+=chunk.toString('utf8');if(Buffer.byteLength(raw)>16384)throw new PaymentError('Corpo muito grande.',413);}
        try{body=JSON.parse(raw);}catch{throw new PaymentError('JSON inválido.');}
        if(!body||Array.isArray(body)||typeof body!=='object')throw new PaymentError('Objeto JSON obrigatório.');
        const permitted={ '/api/register':['email','password'],'/api/login':['email','password'],'/api/password/forgot':['email'],'/api/password/reset':['token','password'],'/api/reports':['profileId','reason','details','receipt'],'/api/reports/status':['protocol','receipt'],'/api/sessions/revoke-others':[], '/api/logout':[], '/api/favorites':['profileId','saved'],'/api/favorites/import':['ids'], '/api/profiles':['localId','name','age','city','category','bio','available'],'/api/charges':['method','amountCents','network'],'/api/promotions':['profileId','plan'],'/api/webhooks/sandbox':['eventId','chargeId','amountCents','currency','status'] };
        const profileAction=url.pathname.match(/^\/api\/profiles\/[^/]+\/(update|delete|pause)$/);
        const fields=(profileAction?(profileAction[1]==='delete'?[]:profileAction[1]==='pause'?['paused']:['name','age','city','category','bio','available']):null)||permitted[url.pathname]||(url.pathname.match(/^\/api\/charges\/[^/]+\/simulate$/)?[]:null);
        if(fields&&Object.keys(body).some(key=>!fields.includes(key)))throw new PaymentError('Campos não permitidos. Não envie dados financeiros sensíveis.');
      }
      if(url.pathname==='/api/webhooks/sandbox'&&req.method==='POST'){
        if(webhookSecret.length<32)throw new PaymentError('Webhook de sandbox não configurado.',503);
        const timestamp=req.headers['x-webhook-timestamp'],signature=req.headers['x-webhook-signature'];
        if(typeof timestamp!=='string'||!/^\d{13}$/.test(timestamp)||Math.abs(clock()-Number(timestamp))>300000||typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature))throw new PaymentError('Assinatura inválida.',401);
        const expected=createHmac('sha256',webhookSecret).update(`${timestamp}.${raw}`).digest();
        if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))throw new PaymentError('Assinatura inválida.',401);
        json(200,payments.settle(body));return;
      }
      if(req.method==='POST'&&req.headers.origin!==`http://${req.headers.host}`)throw new PaymentError('Origem inválida.',403);
      if(url.pathname==='/api/config'&&req.method==='GET'){json(200,{...CONFIG,recovery:{delivery:recoveryDelivery,expiresMinutes:15},pix:{bank:pixBank==='santander'?'Santander':null,keyConfigured:Boolean(pixKey),status:'not_integrated'}});return;}
      if(url.pathname==='/api/directory'&&req.method==='GET'){json(200,{profiles:payments.directory()});return;}
      if(url.pathname==='/api/password/forgot'&&req.method==='POST'){
        limit(req,res,'recovery',5,15*60000);
        if(!sendRecovery)throw new PaymentError('Recuperação indisponível. Contate o suporte.',503);
        const reset=payments.requestReset(body.email);
        if(reset){try{await sendRecovery({...reset,url:`http://${req.headers.host}/#recovery=${reset.token}`});}catch{payments.cancelReset(reset.token);console.error('Falha na entrega da recuperação de acesso.');}}
        json(200,{message:'Se houver uma conta para este e-mail, as instruções de recuperação serão disponibilizadas.'});return;
      }
      if(url.pathname==='/api/password/reset'&&req.method==='POST'){
        limit(req,res,'reset',10,15*60000);const result=payments.resetPassword(body);
        res.setHeader('Set-Cookie','elan_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(200,result);return;
      }
      if(url.pathname==='/api/reports'&&req.method==='POST'){
        limit(req,res,'reports',10,3600000);json(201,payments.createReport(body,req.headers['idempotency-key']));return;
      }
      if(url.pathname==='/api/reports/status'&&req.method==='POST'){
        limit(req,res,'report-status',30,60000);json(200,payments.reportStatus(body));return;
      }
      const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('elan_session='))?.slice(13);
      if(['/api/register','/api/login'].includes(url.pathname)&&req.method==='POST'){
        limit(req,res,'auth',10,60000);
        const session=url.pathname==='/api/register'?payments.register(body.email,body.password):payments.login(body.email,body.password);
        res.setHeader('Set-Cookie',`elan_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
        json(200,{csrf:session.csrf,wallet:payments.wallet(session.userId)});return;
      }
      const auth=payments.authenticate(token);if(!auth)throw new PaymentError('Entre na sua conta.',401);
      if(req.method==='POST'&&req.headers['x-csrf-token']!==auth.csrf)throw new PaymentError('Token de segurança inválido.',403);
      if(url.pathname==='/api/sessions'&&req.method==='GET'){json(200,{sessions:payments.sessions(auth.userId,token)});return;}
      if(url.pathname==='/api/sessions/revoke-others'&&req.method==='POST'){json(200,payments.revokeOthers(auth.userId,token));return;}
      if(url.pathname==='/api/session'&&req.method==='GET'){json(200,{csrf:auth.csrf,wallet:payments.wallet(auth.userId)});return;}
      if(url.pathname==='/api/favorites'&&req.method==='GET'){json(200,{favorites:payments.favoriteIds(auth.userId)});return;}
      if(url.pathname==='/api/favorites'&&req.method==='POST'){json(200,payments.setFavorite(auth.userId,body));return;}
      if(url.pathname==='/api/favorites/import'&&req.method==='POST'){json(200,payments.importFavorites(auth.userId,body));return;}
      if(url.pathname==='/api/wallet'&&req.method==='GET'){json(200,payments.wallet(auth.userId));return;}
      if(url.pathname==='/api/logout'&&req.method==='POST'){payments.logout(token);res.setHeader('Set-Cookie','elan_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(200,{ok:true});return;}
      if(url.pathname==='/api/profiles'&&req.method==='POST'){json(201,payments.addProfile(auth.userId,body));return;}
      const profileAction=url.pathname.match(/^\/api\/profiles\/([^/]+)\/(update|delete|pause)$/);
      if(profileAction&&req.method==='POST'){json(200,profileAction[2]==='pause'?payments.pauseProfile(auth.userId,profileAction[1],body):profileAction[2]==='update'?payments.updateProfile(auth.userId,profileAction[1],body):payments.deleteProfile(auth.userId,profileAction[1]));return;}
      if(url.pathname==='/api/charges'&&req.method==='POST'){const order=payments.charge(auth.userId,body,req.headers['idempotency-key']);json(201,{id:order.id,status:order.status,mode:'sandbox'});return;}
      const simulation=url.pathname.match(/^\/api\/charges\/([^/]+)\/simulate$/);
      if(simulation&&req.method==='POST'){json(200,payments.simulate(auth.userId,simulation[1]));return;}
      if(url.pathname==='/api/promotions'&&req.method==='POST'){json(201,payments.buy(auth.userId,body,req.headers['idempotency-key']));return;}
      json(404,{error:'Não encontrado.'});
    }catch(error){if(!(error instanceof PaymentError))console.error('Falha interna:',error.message);if(!res.headersSent)json(error.status||500,{error:error instanceof PaymentError?error.message:'Erro interno no servidor.'});else res.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.on('close',()=>payments.close());return{server,payments};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if((process.env.PAYMENT_MODE||'sandbox')!=='sandbox')throw new Error('Produção bloqueada: adaptadores financeiros reais ainda não foram implementados.');
  mkdirSync(path.join(root,'data'),{recursive:true});
  const {server}=createApp({database:path.join(root,'data','sandbox.sqlite'),webhookSecret:process.env.SANDBOX_WEBHOOK_SECRET||'',recoveryDelivery:'local',sendRecovery:({email,url,expiresAt})=>{
    const outbox=path.join(root,'data','recovery');mkdirSync(outbox,{recursive:true});
    const filename=createHash('sha256').update(email).digest('hex')+'.json';
    writeFileSync(path.join(outbox,filename),JSON.stringify({email,url,expiresAt},null,2),{mode:0o600});
  }});
  server.listen(Number(process.env.PORT)||3000,'127.0.0.1',()=>console.log(`World Girls Scorts sandbox: http://127.0.0.1:${server.address().port}\nPix, cartão e cripto simulados. Nenhuma movimentação real.`));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
