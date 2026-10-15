'use strict';
(()=>{
  let csrf='',wallet=null,busy=false,favoriteRevision=0;
  const key=()=>crypto.randomUUID();
  const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
  const date=time=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(time);
  const names={pix:'Pix',card:'Cartão de crédito',crypto:'Cripto'};
  const statuses={pending:'Aguardando pagamento de teste',paid:'Confirmado em sandbox',failed:'Falhou',expired:'Expirado'};
  const panel=document.createElement('section');panel.className='billing';panel.innerHTML='<div class="billing-heading"><div><p class="eyebrow">WORLD GIRLS PAY · BRASIL</p><h3>Pix, cartão e cripto</h3></div><button class="publish" id="wallet-open">Abrir carteira GOLD</button></div><p>Saldo e confirmações gerenciados no servidor. Publicidade por 30 dias, sem renovação automática.</p><div id="billing-subscriptions"></div>';$('account').append(panel);
  const dialog=document.createElement('dialog');dialog.id='wallet-dialog';dialog.setAttribute('aria-labelledby','wallet-title');dialog.innerHTML=`<button class="close" aria-label="Fechar">×</button><p class="eyebrow">WORLD GIRLS PAY · AMBIENTE DE TESTES</p><h2 id="wallet-title">Sua carteira GOLD</h2><p class="demo-warning">Sandbox: não envie dinheiro. Pix, cartão e cripto são simulados. Os valores de teste em reais não são uma conversão dos preços em euros.</p><p id="billing-message" role="status" class="billing-message"></p><section id="billing-auth"><form id="billing-auth-form"><label>E-mail<input name="email" type="email" autocomplete="username" required maxlength="254"></label><label>Senha<input name="password" type="password" autocomplete="current-password" minlength="12" maxlength="128" required></label><div class="form-row"><button class="primary" type="submit" name="action" value="login">Entrar</button><button class="primary" type="submit" name="action" value="register">Criar conta</button></div><p class="detail-note">Use uma senha de teste com pelo menos 12 caracteres.</p><button class="footer-link" type="button" id="forgot-password">Esqueci minha senha</button></form></section><section id="billing-wallet" hidden><div class="wallet-balance"><span>Saldo sandbox</span><strong id="gold-balance">0 GOLD</strong></div><button class="publish" id="billing-logout">Sair da conta</button><h3>1. Recarregue sua carteira</h3><form id="recharge-form"><label>Valor em reais<input id="recharge-reais" name="reais" type="number" min="20" max="10000" step="1" value="20" required></label><p id="recharge-summary" class="detail-meta">R$20 = 100 GOLD de teste</p><fieldset class="payment-methods"><legend>Forma de pagamento</legend><label><input type="radio" name="method" value="pix" checked>Pix</label><label><input type="radio" name="method" value="card">Cartão de crédito</label><label><input type="radio" name="method" value="crypto">Cripto</label></fieldset><label id="crypto-network-label" hidden>Moeda e rede<select name="network"><option value="BTC:bitcoin">Bitcoin · rede Bitcoin</option><option value="USDT:tron">USDT · rede Tron</option><option value="USDC:polygon">USDC · rede Polygon</option></select></label><p class="detail-note">Nesta etapa não há QR Code Pix, formulário de cartão ou endereço cripto real. A cobrança de teste expira em 30 minutos.</p><button class="primary" type="submit">Criar cobrança de teste</button></form><h3>2. Ative um destaque</h3><label class="billing-profile">Seu anúncio<select id="billing-profile"></select></label><p id="billing-no-profile" class="detail-note">Crie um anúncio em “Meu perfil” para ativar TOP ou VIP.</p><div class="plan-grid"><article class="plan"><p class="eyebrow">TOP</p><strong>40 GOLD</strong><p>Prioridade na cidade · 30 dias</p><button class="primary" data-buy-plan="top">Ativar TOP sandbox</button></article><article class="plan"><p class="eyebrow">VIP</p><strong>250 GOLD</strong><p>Destaque na página inicial · 30 dias</p><button class="primary" data-buy-plan="vip">Ativar VIP sandbox</button></article></div><h3>Histórico de cobranças</h3><button id="billing-refresh" class="publish">Atualizar status</button><div id="billing-history"></div></section>`;document.body.append(dialog);
  const accountPanel=document.createElement('section');
  accountPanel.className='account-session';
  accountPanel.innerHTML='<p id="account-status" role="status">Conectando à sua conta…</p><button class="publish" id="account-login">Entrar ou criar conta</button><button class="publish" id="account-import" hidden>Importar anúncios antigos deste dispositivo</button><button class="publish" id="favorites-import" hidden>Importar favoritos antigos deste dispositivo</button>';
  $('account').prepend(accountPanel);
  $('account-login').addEventListener('click',()=>$('wallet-open').click());
  function clearAccount(){favoriteRevision++;replaceFavorites([]);csrf='';wallet=null;custom=[];accountConnected=false;billingSubscriptions=[];render();draw();}
  const message=text=>$('billing-message').textContent=text;
  async function api(route,{method='GET',body,requestKey}={}){
    if(location.protocol==='file:')throw new Error('Execute start.ps1 e abra http://127.0.0.1:3000 para usar o servidor.');
    const requestSession=csrf;
    const headers={};if(body!==undefined)headers['Content-Type']='application/json';if(csrf)headers['X-CSRF-Token']=csrf;if(requestKey)headers['Idempotency-Key']=requestKey;
    let response;try{response=await fetch(`/api/${route}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',cache:'no-store'});}catch{throw new Error('Servidor indisponível. Execute start.ps1.');}
    const result=await response.json();if(!response.ok){if(response.status===401&&csrf===requestSession){clearAccount();}throw new Error(result.error||'Falha na solicitação.');}return result;
  }
  async function sync(){
    if(!csrf)return;
    wallet=await api('wallet');accountConnected=true;
    custom=wallet.profiles.map(p=>({...p,available:Boolean(p.available)}));
    billingSubscriptions=wallet.subscriptions;
    await syncFavorites();
    await refreshDirectory();render();draw();
  }
  async function syncFavorites(){
    const session=csrf;if(!session||favoritePending)return;
    const revision=++favoriteRevision;
    const result=await api('favorites');
    if(csrf!==session||revision!==favoriteRevision)return;
    replaceFavorites(result.favorites);render();
  }
  window.worldGirlsAccount={
    securityRequest:api,
    clearSession:clearAccount,
    async pause(id,paused){await api(`profiles/${id}/pause`,{method:'POST',body:{paused}});await sync();},
    refreshFavorites:syncFavorites,
    async setFavorite(profileId,saved){
      const session=csrf;if(!session)throw new Error('Entre na sua conta para salvar favoritos.');
      if(busy)throw new Error('Aguarde a sincronização da conta e tente novamente.');
      const revision=++favoriteRevision;
      const result=await api('favorites',{method:'POST',body:{profileId,saved}});
      if(csrf!==session||revision!==favoriteRevision)return;
      replaceFavorites(result.favorites);render();
    },
    async save(id,profile){
      if(!csrf)throw new Error('Entre na sua conta para publicar.');
      if(id)await api(`profiles/${id}/update`,{method:'POST',body:profile});
      else await api('profiles',{method:'POST',body:{...profile,localId:$('publish-form').dataset.localId||key()}});
      await sync();
    },
    async remove(id){await api(`profiles/${id}/delete`,{method:'POST',body:{}});await sync();}
  };
  $('favorites-import').addEventListener('click',()=>task(async()=>{
    const session=csrf;
    if(!session)throw new Error('Entre na conta que deve receber os favoritos.');
    if(favoritePending)throw new Error('Aguarde o favorito ser salvo e tente novamente.');
    if(!confirm('Importar os favoritos antigos deste dispositivo para a conta conectada?'))return;
    // Process in batches and retain local items until each response succeeds.
    while(legacyFavorites.length){
      const ids=legacyFavorites.slice(0,500);
      const result=await api('favorites/import',{method:'POST',body:{ids}});
      if(csrf!==session)return;
      replaceFavorites(result.favorites);legacyFavorites.splice(0,ids.length);save('elan-favorites',legacyFavorites);
    }
    render();toast('Favoritos importados. Perfis indisponíveis foram ignorados.');
  }));
  window.addEventListener('focus',()=>{if(csrf&&!busy&&!favoritePending)task(syncFavorites);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&csrf&&!busy&&!favoritePending)task(syncFavorites);});
  $('account-import').addEventListener('click',()=>task(async()=>{
    if(!csrf)throw new Error('Entre na conta que deve receber os anúncios.');
    if(!confirm('Importar os anúncios antigos deste dispositivo para a conta conectada?'))return;
    for(const p of [...legacyProfiles]){
      const profile={name:p.name,age:Number(p.age),city:p.city,category:p.category,bio:p.bio,available:Boolean(p.available)};
      const result=await api('profiles',{method:'POST',body:{...profile,localId:p.id}});
      await api(`profiles/${result.id}/update`,{method:'POST',body:profile});
      legacyProfiles.splice(legacyProfiles.indexOf(p),1);save('elan-profiles',legacyProfiles);
    }
    await sync();message('Anúncios importados para esta conta.');toast('Anúncios importados para esta conta.');
  }));
  function draw(){
    document.dispatchEvent(new Event('wgs-account-change'));
    $('account-status').textContent=accountConnected?'Conta conectada · seus anúncios são salvos no servidor.':'Entre ou crie uma conta para administrar seus anúncios.';
    $('account-login').textContent=accountConnected?'Abrir conta e carteira':'Entrar ou criar conta';
    $('account-import').hidden=!accountConnected||!legacyProfiles.length;
    $('account-import').disabled=busy;
    $('favorites-import').hidden=!accountConnected||!legacyFavorites.length;
    $('favorites-import').disabled=busy;
    dialog.querySelectorAll('form button, #billing-logout, #billing-refresh, [data-settle]').forEach(button=>button.disabled=busy);
    $('billing-auth').hidden=Boolean(csrf);$('billing-wallet').hidden=!csrf;
    $('gold-balance').textContent=`${wallet?.gold||0} GOLD`;
    const selected=$('billing-profile').value;
    $('billing-profile').innerHTML=(wallet?.profiles||[]).filter(p=>!p.paused).map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    if([...$('billing-profile').options].some(o=>o.value===selected))$('billing-profile').value=selected;
    $('billing-no-profile').hidden=$('billing-profile').options.length>0;
    document.querySelectorAll('[data-buy-plan]').forEach(b=>b.disabled=busy||!$('billing-profile').options.length);
    $('billing-history').innerHTML=(wallet?.charges||[]).map(t=>`<article class="billing-transaction"><div><strong>${money(t.amountCents)} · ${t.gold} GOLD</strong><p>${names[t.method]}${t.network?' · '+escapeHtml(t.network):''} · ${date(t.createdAt)}</p><span>${statuses[t.status]}</span><p>Expira em ${date(t.expiresAt)}</p></div>${t.status==='pending'?`<button class="publish" data-settle="${escapeHtml(t.id)}">Simular pagamento</button>`:''}</article>`).join('')||'<p class="detail-note">Nenhuma cobrança registrada.</p>';
    $('billing-subscriptions').innerHTML=(wallet?.subscriptions||[]).map(s=>`<p class="detail-note">${escapeHtml(custom.find(p=>p.localId===s.profileId)?.name||'Anúncio')} · ${escapeHtml(s.plan.toUpperCase())} sandbox até ${date(s.expiresAt)}</p>`).join('');
  }
  async function task(fn){if(busy)return;busy=true;draw();try{await fn();}catch(error){message(error.message);}finally{busy=false;draw();}}
  $('wallet-open').addEventListener('click',()=>{dialog.showModal();task(async()=>{message('');const settings=await api('config');if(settings.pix?.keyConfigured&&settings.pix.bank==='Santander')message('Chave Pix Santander configurada no servidor. A integração bancária ainda não está ativa.');try{const session=await api('session');csrf=session.csrf;wallet=session.wallet;await sync();}catch(error){if(error.message!=='Entre na sua conta.')throw error;}});});
  dialog.querySelector('.close').addEventListener('click',()=>dialog.close());
  $('billing-auth-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.target);const action=event.submitter?.value||'login';task(async()=>{const result=await api(action,{method:'POST',body:{email:data.get('email'),password:data.get('password')}});csrf=result.csrf;wallet=result.wallet;event.target.reset();await sync();message('Conta conectada ao servidor de testes.');});});
  $('billing-logout').addEventListener('click',()=>task(async()=>{await api('logout',{method:'POST',body:{}});clearAccount();message('Você saiu da conta.');}));
  $('recharge-form').addEventListener('change',()=>{$('crypto-network-label').hidden=new FormData($('recharge-form')).get('method')!=='crypto';});
  $('recharge-reais').addEventListener('input',()=>{const amount=Number($('recharge-reais').value);$('recharge-summary').textContent=Number.isInteger(amount)&&amount>=20&&amount<=10000?`${money(amount*100)} = ${amount*5} GOLD de teste`:'Informe reais inteiros entre R$20 e R$10.000.';});
  let rechargeAttempt=null;
  $('recharge-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.target);const method=data.get('method');const body={method,amountCents:Number(data.get('reais'))*100,...(method==='crypto'?{network:data.get('network')}:{})};const fingerprint=JSON.stringify(body);if(rechargeAttempt?.fingerprint!==fingerprint)rechargeAttempt={fingerprint,key:key()};task(async()=>{await api('charges',{method:'POST',body,requestKey:rechargeAttempt.key});rechargeAttempt=null;await sync();message('Cobrança sandbox criada. Use “Simular pagamento” no histórico para testar a confirmação.');});});
  let promotionAttempt=null;
  dialog.addEventListener('click',event=>{const settle=event.target.closest('[data-settle]');if(settle){task(async()=>{await api(`charges/${settle.dataset.settle}/simulate`,{method:'POST',body:{}});await sync();message('Pagamento confirmado em sandbox. Nenhum dinheiro recebido.');});return;}const buy=event.target.closest('[data-buy-plan]');if(buy){const body={profileId:$('billing-profile').value,plan:buy.dataset.buyPlan},fingerprint=JSON.stringify(body);if(promotionAttempt?.fingerprint!==fingerprint)promotionAttempt={fingerprint,key:key()};task(async()=>{await api('promotions',{method:'POST',body,requestKey:promotionAttempt.key});promotionAttempt=null;await sync();message('Destaque sandbox ativado por 30 dias, sem renovação automática.');});}});
  $('billing-refresh').addEventListener('click',()=>task(sync));
  if(location.protocol!=='file:')task(async()=>{await api('config');try{const session=await api('session');csrf=session.csrf;wallet=session.wallet;await sync();}catch(error){if(error.message!=='Entre na sua conta.')throw error;}});
  draw();
})();
