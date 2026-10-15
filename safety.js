'use strict';
(()=>{
  const request=(route,body)=>window.worldGirlsAccount.securityRequest(route,body===undefined?{}:{method:'POST',body});
  const makeDialog=(id,title,content)=>{
    const dialog=document.createElement('dialog');dialog.id=id;dialog.setAttribute('aria-labelledby',id+'-title');
    dialog.innerHTML='<button type="button" class="close" aria-label="Fechar">×</button><h2 id="'+id+'-title">'+title+'</h2>'+content;
    dialog.querySelector('.close').addEventListener('click',()=>dialog.close());document.body.append(dialog);return dialog;
  };
  const recovery=makeDialog('recovery-dialog','Recuperar acesso',
    '<p id="recovery-info" class="detail-note">Solicite um link de recuperação válido por 15 minutos.</p><p id="recovery-status" role="status"></p><p id="recovery-error" class="form-error" role="alert"></p><form id="recovery-request"><label>E-mail da conta<input name="email" type="email" autocomplete="username" maxlength="254" required></label><button class="primary" type="submit">Solicitar recuperação</button></form><form id="recovery-reset" hidden><label>Nova senha<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><label>Confirme a nova senha<input name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><button class="primary" type="submit">Redefinir senha e encerrar sessões</button></form>');
  let recoveryToken='';
  const report=makeDialog('report-dialog','Denunciar um problema',
    '<p class="detail-note">Relate falsificação, uso de imagem sem autorização ou outro risco. Não inclua documentos, dados financeiros ou imagens íntimas. O relato fica restrito à moderação.</p><p id="report-error" class="form-error" role="alert"></p><form id="report-form"><input type="hidden" name="profileId"><label>Motivo<select name="reason" required><option value="">Selecione</option><option value="impersonation">Perfil falso ou falsificação de identidade</option><option value="unauthorized_image">Imagem utilizada sem autorização</option><option value="underage">Suspeita de menor de idade</option><option value="coercion">Coerção ou exploração</option><option value="fraud">Fraude</option><option value="other">Outro problema</option></select></label><label>Descreva o problema<textarea name="details" minlength="10" maxlength="2000" rows="5" required></textarea></label><button class="primary" type="submit">Registrar denúncia</button></form><section id="report-result" hidden aria-live="polite"><h3>Denúncia registrada</h3><p>Aguarda revisão humana. Guarde o protocolo e o comprovante abaixo para acompanhar. Eles não serão salvos neste navegador.</p><label>Protocolo<input id="report-protocol" readonly></label><label>Comprovante privado<input id="report-receipt" readonly></label><p class="detail-note">O registro não significa que o conteúdo já foi analisado ou removido.</p></section>');
  const tracking=makeDialog('tracking-dialog','Acompanhar denúncia',
    '<p class="detail-note">Use o protocolo e o comprovante privado recebidos no registro.</p><form id="tracking-form"><label>Protocolo<input name="protocol" maxlength="64" required autocomplete="off"></label><label>Comprovante privado<input name="receipt" pattern="[a-f0-9]{64}" maxlength="64" required autocomplete="off"></label><button class="primary" type="submit">Consultar situação</button></form><p id="tracking-error" class="form-error" role="alert"></p><p id="tracking-result" role="status"></p>');
  const security=makeDialog('security-dialog','Segurança da conta',
    '<p class="detail-note">Abaixo estão os acessos ativos. Encerre os demais se não os reconhecer.</p><p id="security-error" class="form-error" role="alert"></p><p id="security-status" role="status"></p><ul id="security-sessions"></ul><button type="button" class="primary" id="revoke-sessions">Encerrar os outros acessos</button>');
  const sessionsButton=document.createElement('button');sessionsButton.type='button';sessionsButton.className='publish';sessionsButton.id='security-open';sessionsButton.textContent='Segurança da conta';$('account-status').after(sessionsButton);
  const updateAccount=()=>{
    sessionsButton.hidden=!accountConnected;
    if(!accountConnected){$('security-sessions').replaceChildren();if(security.open)security.close();}
  };
  document.addEventListener('wgs-account-change',updateAccount);updateAccount();
  async function submit(form,errorId,action){
    const button=form.querySelector('[type="submit"]');if(button.disabled)return;
    button.disabled=true;form.setAttribute('aria-busy','true');$(errorId).textContent='';
    try{await action(new FormData(form));}catch(error){$(errorId).textContent=error.message;}finally{button.disabled=false;form.removeAttribute('aria-busy');}
  }
  $('forgot-password').addEventListener('click',async()=>{
    $('wallet-dialog').close();recoveryToken='';$('recovery-request').hidden=false;$('recovery-reset').hidden=true;
    $('recovery-status').textContent='';$('recovery-error').textContent='';recovery.showModal();
    try{
      const config=await request('config');
      $('recovery-info').textContent=config.recovery.delivery==='local'?'Ambiente local: o link fica no arquivo de recuperação do servidor. Nenhum e-mail é enviado. Validade de 15 minutos.':config.recovery.delivery==='disabled'?'Recuperação indisponível neste servidor. Contate o responsável.':'Você receberá instruções pelo canal de recuperação configurado. Validade de 15 minutos.';
    }catch(error){$('recovery-error').textContent=error.message;}
  });
  $('recovery-request').addEventListener('submit',event=>{
    event.preventDefault();submit(event.target,'recovery-error',async data=>{
      const result=await request('password/forgot',{email:data.get('email')});$('recovery-status').textContent=result.message;event.target.reset();
    });
  });
  $('recovery-reset').addEventListener('submit',event=>{
    event.preventDefault();submit(event.target,'recovery-error',async data=>{
      if(data.get('password')!==data.get('confirmation'))throw new Error('As senhas precisam ser iguais.');
      await request('password/reset',{token:recoveryToken,password:data.get('password')});
      recoveryToken='';window.worldGirlsAccount.clearSession();event.target.reset();event.target.hidden=true;
      $('recovery-status').textContent='Senha redefinida. Todos os acessos foram encerrados. Entre novamente com a nova senha.';
    });
  });
  // The token stays only in memory; fragments are removed before further navigation.
  function readRecoveryLink(){
    const recoveryHash=/^#recovery=([a-f0-9]{64})$/.exec(location.hash);
    if(!recoveryHash)return;
    recoveryToken=recoveryHash[1];history.replaceState(null,'',location.pathname+location.search);
    const showRecovery=()=>{
      if($('age-dialog').open)return;
      $('recovery-status').textContent='';$('recovery-error').textContent='';$('recovery-reset').reset();
      $('recovery-request').hidden=true;$('recovery-reset').hidden=false;
      $('recovery-info').textContent='Escolha uma nova senha. Todos os acessos anteriores serão encerrados.';
      if(!recovery.open)recovery.showModal();
    };
    if($('age-dialog').open)$('age-dialog').addEventListener('close',showRecovery,{once:true});
    else showRecovery();
  }
  window.addEventListener('hashchange',readRecoveryLink);
  readRecoveryLink();
  const randomReceipt=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
  window.worldGirlsSafety={openReport(profileId){
    const form=$('report-form');form.reset();form.hidden=false;form.elements.profileId.value=profileId;
    form.dataset.requestKey=crypto.randomUUID();form.dataset.receipt=randomReceipt();$('report-error').textContent='';$('report-result').hidden=true;report.showModal();
  }};
  $('report-form').addEventListener('submit',event=>{
    event.preventDefault();submit(event.target,'report-error',async data=>{
      const form=event.target,receipt=form.dataset.receipt;
      const result=await window.worldGirlsAccount.securityRequest('reports',{method:'POST',requestKey:form.dataset.requestKey,body:{profileId:data.get('profileId'),reason:data.get('reason'),details:data.get('details'),receipt}});
      $('report-protocol').value=result.protocol;$('report-receipt').value=receipt;form.hidden=true;$('report-result').hidden=false;
    });
  });
  $('report-track').addEventListener('click',()=>{tracking.showModal();$('tracking-error').textContent='';$('tracking-result').textContent='';});
  $('tracking-form').addEventListener('submit',event=>{
    event.preventDefault();submit(event.target,'tracking-error',async data=>{
      $('tracking-result').textContent='';
      const result=await request('reports/status',{protocol:data.get('protocol').trim(),receipt:data.get('receipt').trim()});
      const status={received:'Recebida — aguarda revisão humana',reviewing:'Em análise',resolved:'Análise concluída',dismissed:'Encerrada sem ação'};
      $('tracking-result').textContent=(status[result.status]||'Situação indisponível')+'. Atualizado em '+new Date(result.updatedAt).toLocaleString('pt-BR')+'.';
    });
  });
  async function loadSessions(){
    const result=await request('sessions');if(!accountConnected)return;
    $('security-sessions').replaceChildren(...result.sessions.map(session=>{
      const item=document.createElement('li');item.textContent=(session.current?'Este acesso':'Outro acesso')+' · expira em '+new Date(session.expiresAt).toLocaleString('pt-BR');return item;
    }));
    $('revoke-sessions').disabled=!result.sessions.some(session=>!session.current);
  }
  sessionsButton.addEventListener('click',async()=>{
    security.showModal();$('security-error').textContent='';$('security-status').textContent='Carregando acessos…';$('revoke-sessions').disabled=true;
    try{await loadSessions();$('security-status').textContent='';}catch(error){$('security-error').textContent=error.message;}
  });
  $('revoke-sessions').addEventListener('click',async event=>{
    event.target.disabled=true;$('security-error').textContent='';
    try{const result=await request('sessions/revoke-others',{});$('security-status').textContent=result.revoked+' acesso(s) encerrado(s).';await loadSessions();}
    catch(error){$('security-error').textContent=error.message;event.target.disabled=false;}
  });
})();
