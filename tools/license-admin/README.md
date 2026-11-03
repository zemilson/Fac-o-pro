# Gerador local de licenças

Este gerador é um utilitário independente do app: ele roda em um servidor Node local, vinculado somente a `127.0.0.1`, e não publica uma página na internet. O link temporário de acesso é mostrado no terminal a cada inicialização; mantenha o terminal aberto e não compartilhe o link.

## Preparar uma única vez

Na raiz do projeto, execute:

```powershell
npm run codes:setup
```

Isso cria um par de chaves RSA. A chave privada fica em `%LOCALAPPDATA%\AtelierCosturaPro\license-admin\signing-private.pem`, fora do repositório. A chave pública é gravada em `src/license-public-key.js` e pode ser distribuída junto com o app.

Faça backup seguro da chave privada. Quem obtiver essa chave poderá emitir licenças. Não a envie, não a inclua em builds ou commits e não apague os arquivos locais. Se a chave for perdida ou substituída, os apps que contêm a chave pública antiga não aceitarão códigos novos assinados pela chave nova.

Este computador é o posto do administrador. Em outra máquina, não rode o setup para tentar recriar a chave: sem a chave privada original, é necessário restaurar o backup ou planejar explicitamente a troca da chave e atualizar o app.

Depois de preparar a chave, gere e distribua uma build do app com a chave pública atualizada.

## Usar no Windows

Na raiz do projeto, dê dois cliques em `iniciar-gerador-licencas.bat`. Ele abre o navegador no painel local e deixa o terminal aberto enquanto o gerador estiver em uso. Para encerrar, feche a janela do terminal.

O frontend fica em `gerador-licencas.html`. Não abra o HTML diretamente com duplo clique: ele precisa do servidor local para manter a chave privada fora do navegador. O painel não é publicado na internet.

Também é possível iniciar pelo PowerShell:

```powershell
npm run codes:admin
```

No app do cliente, peça para abrir **Ativar Licença** e enviar o **código do aparelho** exibido nessa tela. No gerador, informe nome, e-mail, código do aparelho e plano. Envie o serial gerado pelo WhatsApp; ele tem quatro grupos de seis dígitos. O histórico local registra também o aparelho ao qual cada serial foi vinculado.

O app verifica o serial offline e o vincula ao identificador persistido naquela instalação. A ativação mensal vence em 30 dias e a anual em 365 dias. O app continua aceitando códigos antigos assinados com RSA.

## Limites importantes

O serial curto permite ativação sem servidor, mas não oferece proteção criptográfica forte: a chave de validação precisa estar no app e pode ser extraída por alguém que analise o aplicativo. O vínculo é com o identificador salvo na instalação, não com um identificador de hardware inviolável; apagar os dados ou reinstalar o app pode gerar outro identificador. Assim, o fluxo desencoraja o uso casual em outro aparelho, mas não impede falsificação, cópia dos dados, revogação ou adulteração local. Para essas garantias, é necessário um serviço online autenticado e códigos assinados mais longos.
