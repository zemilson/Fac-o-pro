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

Informe o nome e o e-mail usados na conta do cliente, escolha o plano e confirme a emissão. O histórico fica no arquivo local `history.json`, na mesma pasta de dados da chave; é possível copiar, excluir do histórico ou exportar os registros.

Os códigos são assinados com a chave privada, vinculados ao e-mail informado e vencem 30 dias (mensal) ou 365 dias (anual) após a emissão. A validação ocorre no app com a chave pública. Preserve a grafia do código ao copiá-lo; os segmentos da assinatura diferenciam maiúsculas e minúsculas.

## Limites importantes

O gerador e os dados de clientes ficam neste computador, mas a assinatura não é um serviço de ativação online: o app trabalha offline e não consegue impedir que o mesmo código seja reutilizado pelo mesmo e-mail antes do vencimento. Como o app armazena licenças localmente, esta abordagem também não impede adulterações feitas diretamente por alguém com controle do dispositivo. Para bloquear reuso, revogar licenças ou impor vencimentos contra adulteração local, é necessário validar licenças em um servidor online autenticado.
