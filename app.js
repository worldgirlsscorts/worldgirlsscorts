'use strict';
const seedProfiles = [
  {id:'1',name:'Isabella',age:27,city:'São Paulo',category:'Companhia',available:true,vip:true,color:'linear-gradient(145deg,#668b9c,#284b61)',bio:'Perfil fictício de demonstração. Gosto de arte, gastronomia e boas conversas. Companhia para momentos sociais e passeios pela cidade.'},
  {id:'2',name:'Sofia',age:25,city:'Lisboa',category:'City tour',available:true,vip:true,color:'linear-gradient(145deg,#718b8a,#254951)',bio:'Perfil fictício de demonstração. Descubra os cafés, a arquitetura e os lugares especiais de Lisboa em boa companhia.'},
  {id:'3',name:'Valentina',age:29,city:'Rio de Janeiro',category:'Eventos',available:false,vip:true,color:'linear-gradient(145deg,#b6a083,#685a48)',bio:'Perfil fictício de demonstração. Companhia para eventos sociais, jantares e experiências culturais no Rio de Janeiro.'},
  {id:'4',name:'Camila',age:26,city:'Madrid',category:'Companhia',available:true,vip:true,color:'linear-gradient(145deg,#527b91,#193b54)',bio:'Perfil fictício de demonstração. Cultura, música e conversas são meus programas favoritos. Português e espanhol.'},
  {id:'5',name:'Helena',age:31,city:'São Paulo',category:'Eventos',available:false,vip:false,color:'linear-gradient(145deg,#8495ac,#3d526c)',bio:'Perfil fictício de demonstração. Interesses em teatro, exposições e eventos sociais.'},
  {id:'6',name:'Alice',age:24,city:'Lisboa',category:'Companhia',available:true,vip:false,color:'linear-gradient(145deg,#9b8d96,#53506b)',bio:'Perfil fictício de demonstração. Novas conexões, passeios e experiências gastronômicas.'},
  {id:'7',name:'Laura',age:28,city:'Rio de Janeiro',category:'City tour',available:true,vip:false,color:'linear-gradient(145deg,#91a391,#47675e)',bio:'Perfil fictício de demonstração. Passeios culturais e descoberta de lugares especiais na cidade.'},
  {id:'8',name:'Victoria',age:30,city:'Madrid',category:'Eventos',available:false,vip:false,color:'linear-gradient(145deg,#a79c88,#655c4b)',bio:'Perfil fictício de demonstração. Companhia para encontros sociais e eventos culturais.'}
];
function readStorage(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
let custom = readStorage('elan-profiles',[]);
if(!Array.isArray(custom)) custom=[];
custom=custom.filter(p=>p&&typeof p.id==='string'&&typeof p.name==='string'&&typeof p.bio==='string'&&Number(p.age)>=18&&['São Paulo','Rio de Janeiro','Lisboa','Madrid'].includes(p.city)&&['Companhia','Eventos','City tour'].includes(p.category));
const legacyProfiles=custom;
custom=[];
let publicProfiles=[],accountConnected=false;
const normalizeSearch=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const savedFavorites=readStorage('elan-favorites',[]);
const legacyFavorites=[...new Set(Array.isArray(savedFavorites)?savedFavorites.filter(id=>typeof id==='string'&&id.length>0&&id.length<=128):[])];
const favorites=new Set();
let favoritePending=false;
function replaceFavorites(ids){favorites.clear();for(const id of ids)favorites.add(id);}
let tab='explore',category='';
const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let billingSubscriptions=[];
const profiles=()=>[...publicProfiles.map(p=>({...p,available:Boolean(p.available),vip:Boolean(p.vip),top:Boolean(p.top),color:'linear-gradient(145deg,#527b91,#193b54)'})),...seedProfiles];
async function refreshDirectory(){const response=await fetch('/api/directory',{cache:'no-store'});if(!response.ok)throw new Error('Não foi possível carregar os anúncios.');publicProfiles=(await response.json()).profiles;render();}
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3200);}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{toast('O navegador não permitiu salvar. Os dados duram apenas esta sessão.');return false;}}
function openPublish(profile){if(!accountConnected){toast('Entre ou crie uma conta para publicar.');$('wallet-open')?.click();return;}const form=$('publish-form');form.reset();form.dataset.localId=crypto.randomUUID();$('publish-error').textContent='';form.elements.id.value=profile?.id||'';$('publish-title').textContent=profile?'Editar perfil':'Crie seu perfil';if(profile){for(const field of ['name','age','city','category','bio'])form.elements[field].value=profile[field];form.elements.adult.checked=true;form.elements.available.checked=Boolean(profile.available);}$('publish-dialog').showModal();}
function renderMyProfiles(){$('my-profiles').innerHTML=custom.length?custom.map(p=>`<article class="my-profile"><div><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.city)} · ${escapeHtml(p.category)} · ${p.paused?'Pausado':'Publicado'}</span></div><div><button class="publish" data-pause="${escapeHtml(p.id)}">${p.paused?'Retomar':'Pausar'}</button><button class="publish" data-edit="${escapeHtml(p.id)}">Editar</button><button class="danger" data-delete="${escapeHtml(p.id)}">Excluir</button></div></article>`).join(''):'<p class="detail-note">Você ainda não criou nenhum anúncio nesta conta.</p>';}
async function toggleFavorite(id){
  if(!accountConnected){toast('Entre na sua conta para salvar favoritos.');if($('profile-dialog').open)$('profile-dialog').close();$('wallet-open')?.click();return;}
  if(favoritePending)return;
  favoritePending=true;render();
  try{await window.worldGirlsAccount.setFavorite(id,!favorites.has(id));}
  catch(error){toast(error.message);}
  finally{favoritePending=false;render();if($('profile-dialog').open)showProfile(id);}
}
function render(){
  const query=normalizeSearch($('search').value.trim());
  let list=profiles().filter(p=>(tab!=='favorites'||favorites.has(p.id))&&(!category||p.category===category)&&(!$('city').value||p.city===$('city').value)&&(!$('available').checked||p.available)&&(!query||normalizeSearch(`${p.name} ${p.city} ${p.category} ${p.bio}`).includes(query)));
  if($('sort').value==='new')list.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  if($('sort').value==='name')list.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  if($('sort').value==='featured')list.sort((a,b)=>$('city').value?(Number(Boolean(b.top))-Number(Boolean(a.top))||Number(b.vip)-Number(a.vip)):(Number(b.vip)-Number(a.vip)||Number(Boolean(b.top))-Number(Boolean(a.top))));
  $('favorite-count').textContent=favorites.size;
  $('favorites-note').hidden=tab!=='favorites';
  $('favorites-note').textContent=accountConnected?'Seus favoritos são salvos na conta e sincronizados ao voltar ao app.':'Entre ou crie uma conta para salvar e acessar seus favoritos.';
  $('section-title').firstChild.textContent=tab==='favorites'?'Seus favoritos ':tab==='account'?'Meu perfil ':'Perfis em destaque ';
  $('section-label').textContent=tab==='favorites'?'CONEXÕES QUE VOCÊ SALVOU':tab==='account'?'SEU ESPAÇO':'DESCUBRA NOVAS CONEXÕES';
  $('result-count').textContent=tab==='account'?'':`(${list.length})`;
  $('cards').hidden=tab==='account';$('account').hidden=tab!=='account';$('empty').hidden=list.length>0||tab==='account';
  $('cards').innerHTML=list.map(p=>`<article class="card"><div class="portrait" style="--portrait:${p.color}"><button class="heart" ${favoritePending?'disabled':''} data-favorite="${escapeHtml(p.id)}" aria-label="${favorites.has(p.id)?'Remover dos':'Adicionar aos'} favoritos: ${escapeHtml(p.name)}" aria-pressed="${favorites.has(p.id)}">${favorites.has(p.id)?'♥':'♡'}</button>${p.vip?'<span class="badge">◇ DESTAQUE</span>':''}<button class="profile-link initials" data-profile="${escapeHtml(p.id)}" aria-label="Ver perfil de ${escapeHtml(p.name)}">${escapeHtml(p.name.slice(0,1))}</button><span class="demo-label">PERFIL DEMONSTRATIVO</span></div><div class="card-body"><div class="card-title"><button class="profile-link" data-profile="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button><span class="age">${escapeHtml(p.age)} anos</span></div><p class="location">⌖ ${escapeHtml(p.city)}</p><div class="card-foot"><span>${escapeHtml(p.category)}</span><span class="${p.available?'status':''}">${p.available?'Disponível':'Sob consulta'}</span></div></div></article>`).join('');
  renderMyProfiles();
  document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-current',b.dataset.tab===tab?'page':'false');});
}
function showProfile(id){const p=profiles().find(p=>p.id===id);if(!p)return;$('profile-content').innerHTML=`<div class="portrait detail-portrait" style="--portrait:${p.color}"><span class="initials">${escapeHtml(p.name[0])}</span><span class="demo-label">PERFIL DEMONSTRATIVO</span></div><p class="eyebrow">${escapeHtml(p.category)}</p><h2>${escapeHtml(p.name)}, ${escapeHtml(p.age)}</h2><p class="detail-meta">⌖ ${escapeHtml(p.city)} · ${p.available?'Disponível agora':'Sob consulta'}</p><p class="detail-bio">${escapeHtml(p.bio)}</p><div class="detail-actions"><button class="primary" data-contact="${escapeHtml(p.id)}">Enviar mensagem</button><button class="publish" data-favorite="${escapeHtml(p.id)}">${favorites.has(p.id)?'♥ Remover':'♡ Favoritar'}</button></div><button class="footer-link report-link" data-report="${escapeHtml(p.id)}">Denunciar perfil ou uso indevido de imagem</button><p class="detail-note">Perfil demonstrativo. A plataforma publica anúncios; cada anunciante administra seus próprios contatos.</p>`;if(!$('profile-dialog').open)$('profile-dialog').showModal();}
document.addEventListener('click',async event=>{const favorite=event.target.closest('[data-favorite]');if(favorite){toggleFavorite(favorite.dataset.favorite);return;}const profile=event.target.closest('[data-profile]');if(profile)showProfile(profile.dataset.profile);const contact=event.target.closest('[data-contact]');if(contact){const p=profiles().find(p=>p.id===contact.dataset.contact);$('profile-dialog').close();$('contact-form').reset();$('contact-form').elements.profile.value=p.id;$('contact-title').textContent=`Mensagem para ${p.name}`;$('contact-dialog').showModal();}const report=event.target.closest('[data-report]');if(report){$('profile-dialog').close();window.worldGirlsSafety.openReport(report.dataset.report);return;}
const pause=event.target.closest('[data-pause]');if(pause){const p=custom.find(p=>p.id===pause.dataset.pause);if(!p)return;pause.disabled=true;try{await window.worldGirlsAccount.pause(p.id,!p.paused);toast(p.paused?'Perfil retomado.':'Perfil pausado e retirado da listagem pública.');}catch(error){toast(error.message);}finally{pause.disabled=false;}return;}
const edit=event.target.closest('[data-edit]');if(edit)openPublish(custom.find(p=>p.id===edit.dataset.edit));const remove=event.target.closest('[data-delete]');if(remove&&confirm('Excluir este anúncio da sua conta?')){remove.disabled=true;try{await window.worldGirlsAccount.remove(remove.dataset.delete);toast('Anúncio excluído.');}catch(error){toast(error.message);}finally{remove.disabled=false;}}const legal=event.target.closest('[data-legal]');if(legal){const privacy=legal.dataset.legal==='privacy';$('legal-content').innerHTML=privacy?'<p class="eyebrow">PRIVACIDADE</p><h2>Privacidade</h2><p>Os anúncios, favoritos e a conta são armazenados no servidor local. A confirmação de maioridade e as mensagens demonstrativas ficam neste navegador. Antes da publicação, será necessária uma política completa com controlador, base legal, retenção, direitos do titular e canal de atendimento.</p>':'<p class="eyebrow">TERMOS DE USO</p><h2>Termos essenciais</h2><p>Uso exclusivo por maiores de 18 anos. A plataforma funciona como diretório de anúncios independentes. Anunciantes respondem pela veracidade, legalidade e conteúdo de seus anúncios. Conteúdo falso, exploração, coerção, tráfico, menores de idade e atividades ilegais são proibidos.</p>';$('legal-dialog').showModal();}const nav=event.target.closest('[data-tab]');if(nav){tab=nav.dataset.tab;render();if(tab==='favorites'&&accountConnected)window.worldGirlsAccount.refreshFavorites().catch(error=>toast(error.message));document.querySelector('.directory').scrollIntoView({behavior:'smooth',block:'start'});}const chip=event.target.closest('[data-category]');if(chip){category=chip.dataset.category;document.querySelectorAll('[data-category]').forEach(b=>b.classList.toggle('active',b===chip));render();}});
['search','city','sort','available'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',render));
$('search-button').addEventListener('click',()=>{if(tab==='account')tab='explore';render();document.querySelector('.directory').scrollIntoView({behavior:'smooth'});});
$('reset').addEventListener('click',()=>{$('search').value='';$('city').value='';$('available').checked=false;category='';document.querySelectorAll('[data-category]').forEach(b=>b.classList.toggle('active',b.dataset.category===''));render();});
['publish','account-publish','banner-publish'].forEach(id=>$(id).addEventListener('click',()=>openPublish()));
document.querySelectorAll('dialog:not(.age-dialog)').forEach(dialog=>{dialog.querySelector('.close')?.addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});});
$('publish-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target,data=new FormData(form),button=form.querySelector('[type="submit"]');$('publish-error').textContent='';
  if(button.disabled||!data.get('adult'))return;
  const profile={name:String(data.get('name')).trim(),age:Number(data.get('age')),bio:String(data.get('bio')).trim(),city:String(data.get('city')),category:String(data.get('category')),available:Boolean(data.get('available'))};
  button.disabled=true;
  try{await window.worldGirlsAccount.save(String(data.get('id')||''),profile);$('publish-dialog').close();form.reset();tab='account';render();toast('Anúncio salvo na sua conta.');}catch(error){$('publish-error').textContent=error.message;}finally{button.disabled=false;}
});
$('contact-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.target);if(!data.get('adult'))return;const storedMessages=readStorage('elan-messages',[]);const messages=Array.isArray(storedMessages)?storedMessages:[];messages.push({id:globalThis.crypto?.randomUUID?.()||`message-${Date.now()}`,profile:String(data.get('profile')),name:String(data.get('name')).trim(),email:String(data.get('email')).trim(),message:String(data.get('message')).trim(),createdAt:Date.now()});save('elan-messages',messages);$('contact-dialog').close();event.target.reset();toast('Mensagem registrada nesta demonstração.');});
$('age-dialog').addEventListener('cancel',event=>event.preventDefault());
$('age-confirm').addEventListener('click',()=>{save('elan-age-confirmed',true);$('age-dialog').close();});
$('age-exit').addEventListener('click',()=>{location.href='about:blank';});
render();
if(readStorage('elan-age-confirmed',false)!==true)$('age-dialog').showModal();
if('serviceWorker' in navigator&&location.protocol!=='file:'){
  const offerUpdate=()=>{
    if(document.getElementById('app-update'))return;
    const button=document.createElement('button');button.id='app-update';button.type='button';button.className='app-update';button.textContent='Nova versão disponível · Atualizar';
    button.addEventListener('click',()=>location.reload());document.body.append(button);
  };
  navigator.serviceWorker.addEventListener('controllerchange',offerUpdate);
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(registration=>{
    if(registration.waiting)offerUpdate();
    registration.update().catch(()=>{});
  }).catch(()=>{});
}


if(location.protocol!=='file:')refreshDirectory().catch(error=>toast(error.message));
