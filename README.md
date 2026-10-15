# World Girls Scorts

Aplicativo demonstrativo de diretório para maiores de 18 anos. Inclui busca, filtros, favoritos, criação e edição de anúncios, mensagens locais de demonstração, anúncios vinculados à conta no servidor, controle de disponibilidade e maioridade, instalação como PWA e carteira GOLD em sandbox.

## Executar

No PowerShell, dentro desta pasta:

```powershell
.\start.ps1
```

Depois, abra `http://127.0.0.1:3000`.

## Testar

```powershell
.\.runtime\node-v22.23.3-win-x64\node.exe --test server/payments.test.mjs server/safety.test.mjs
.\.runtime\node-v22.23.3-win-x64\node.exe server/browser.test.mjs
```

## Pagamentos

Pix, cartão e cripto estão em sandbox. O servidor controla autenticação, cobranças, idempotência, confirmação, saldo GOLD e promoções TOP/VIP. Nenhuma movimentação financeira real ocorre. A chave Pix Santander permanece somente na configuração local ignorada pelo Git.

Para produção, ainda são necessárias as credenciais e o certificado da API Pix, checkout tokenizado de cartão, provedor de cripto, hospedagem HTTPS e documentos jurídicos definitivos.

## Anúncios e contas

Entre ou crie uma conta em “Meu perfil” para publicar. Os anúncios ficam no SQLite do servidor e aparecem no diretório público, incluindo os destaques TOP/VIP ativos. Apenas o proprietário pode editar ou excluir. A exclusão retira o anúncio da listagem e preserva as referências do histórico financeiro.

Anúncios antigos do navegador não são associados automaticamente a uma conta. Após entrar na conta correta, use “Importar anúncios antigos deste dispositivo”. Os dados locais são removidos da fila somente após cada importação bem-sucedida. Favoritos são vinculados à conta no servidor. Mensagens demonstrativas continuam locais e ainda não são entregues ao destinatário.

A migração do banco é automática e aditiva, preservando contas e saldo existentes. Faça backup da pasta `data` com o servidor parado antes de atualizar uma instalação com dados importantes.

## Validação da interface

Execute `npm run test:e2e` (ou o comando com o Node local indicado acima). O teste abre uma janela Chrome com perfil temporário e banco em memória, sem usar as contas e anúncios existentes. Confirme manualmente a maioridade nessa janela em até cinco minutos; essa ação não é automatizada.

A validação cobre cadastro, importação, criação/edição/exclusão, pausa e retomada, disponibilidade, busca sem acentos, ordenação, troca de contas, VIP público, pagamentos simulados, persistência após recarregar, favoritos, denúncias com acompanhamento, encerramento de outros acessos e abertura da recuperação na mesma aba. A submissão final da redefinição de senha é verificada pelos testes do backend. Também verifica o layout móvel de 390 px e salva capturas em `artifacts/validation-mobile.png` e `artifacts/validation-desktop.png`.

## Favoritos por conta

Entre na sua conta para adicionar e remover favoritos. Eles são salvos no SQLite do servidor, carregados no login e atualizados ao abrir a aba Favoritos ou voltar ao aplicativo. A sincronização depende da conexão com o servidor; favoritos não são alterados localmente quando a gravação falha. Ao sair, os favoritos da conta deixam de aparecer neste navegador.

Em “Meu perfil”, o botão “Importar favoritos antigos deste dispositivo” permite associar os favoritos antigos à conta conectada, após confirmação. Importe os anúncios antigos antes dos favoritos para que seus identificadores possam ser reconhecidos. Perfis indisponíveis são ignorados e favoritos repetidos não são duplicados. A exclusão de um anúncio também remove suas referências dos favoritos.

## Privacidade e segurança

Em “Meu perfil”, use “Pausar” para retirar um perfil da listagem pública sem perder os dados. “Retomar” restaura a visibilidade. Favoritos de perfis pausados deixam de aparecer e voltam após a retomada. A pausa não interrompe nem prorroga a validade dos destaques existentes. Novas compras de destaque ficam bloqueadas enquanto o perfil estiver pausado.

O botão “Segurança da conta” lista os acessos ativos e permite encerrar os demais mantendo a sessão atual. A redefinição de senha encerra todas as sessões e exige novo login.

## Recuperação de acesso local

Use “Esqueci minha senha” na entrada da conta. Com `start.ps1`, o servidor grava o link em um arquivo JSON na pasta `data/recovery/`, identificada por um hash do e-mail. O arquivo contém o e-mail para localizar o destinatário, o link e o horário de expiração. Abra o arquivo correspondente no computador do servidor para testar a recuperação. Nenhum e-mail real é enviado nesta versão.

Os links expiram em 15 minutos, funcionam uma vez e são substituídos ao solicitar um novo link. O token fica armazenado como hash no banco; no navegador, é removido do endereço e mantido apenas em memória. Os arquivos locais de entrega contêm o link completo: mantenha a pasta privada e remova arquivos vencidos. A pasta `data` não é servida por HTTP e é ignorada pelo Git.

Para publicação, substitua a entrega local por um provedor de e-mail, configure HTTPS e acesso restrito aos dados. A função `createApp` aceita `sendRecovery` para integrar a entrega; sem esse adaptador, a recuperação fica indisponível.

## Denúncias e revisão

Em cada perfil, “Denunciar perfil ou uso indevido de imagem” registra um relato sem exigir login. O sistema fornece protocolo e comprovante privado, necessários para “Acompanhar denúncia” no rodapé. Guarde ambos: o comprovante não é salvo no navegador e não há recuperação dele. Não envie documentos ou imagens íntimas no relato.

Registrar uma denúncia não representa análise nem remoção automática. A revisão é humana. Os relatos não ficam acessíveis ao proprietário do perfil nem em uma listagem pública. No computador do servidor, após inicializar o banco atualizado, o responsável pode usar:

```powershell
.\.runtime\node-v22.23.3-win-x64\node.exe server/moderation.mjs list
.\.runtime\node-v22.23.3-win-x64\node.exe server/moderation.mjs review PROTOCOLO reviewing "Análise humana iniciada pelo responsável."
```

Estados de revisão: `reviewing`, `resolved` e `dismissed`. Cada alteração exige justificativa e registra histórico. Esse comando apenas atualiza o acompanhamento; não remove o perfil automaticamente. O operador ainda precisa de um fluxo administrativo para retirar conteúdo de terceiros. A ferramenta exige acesso ao arquivo SQLite local; não há endpoint público de moderação.

A interface inclui nomes acessíveis para diálogos, foco visível, link para pular ao conteúdo e mensagens persistentes de erro nos novos formulários. Isso não substitui uma auditoria completa com leitores de tela.

## Identidade visual

Nome público: **World Girls Scorts**. Paleta: azul profundo `#102b43`, azul de ação `#163b58`, dourado `#c3a16d` e fundo claro `#f5f7fa`. A interface usa fontes do sistema (Georgia nos títulos e Arial/Helvetica no texto), sem baixar fontes de terceiros.

Logo oficial: `world-girls-logo.png`, fornecida pelo proprietário e utilizada no cabeçalho, rodapé, tela de entrada, área principal e ícone do aplicativo. O conteúdo original foi preservado; o arquivo recebido tinha extensão JPEG, mas seu formato real é PNG. Os SVG anteriores foram substituídos na interface. O manifesto, a identificação do projeto, os textos da interface e o cache da PWA usam a nova marca. Os identificadores antigos de armazenamento e sessão são mantidos internamente por compatibilidade com contas, favoritos e confirmações já existentes.
