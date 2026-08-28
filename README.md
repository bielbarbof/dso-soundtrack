# DSO Soundtrack v0.1.2

Extensão de áudio para Owlbear Rodeo com identidade **Tech Noir DSO**.

## Recursos

- Biblioteca de trilhas por URL, incluindo links compartilhados do Dropbox.
- Múltiplas faixas tocando simultaneamente em camadas.
- Volume individual por faixa.
- **Master Output global controlado pelo Mestre** e sincronizado para a mesa.
- Pausar, continuar, parar, buscar posição e loop individual.
- Botão **Parar Tudo**.
- Motor de áudio em `background_url`, para o som continuar mesmo com o painel fechado.
- Sincronização autoritativa pelo Mestre com correção periódica de drift.
- Entrada tardia sincronizada com a posição atual das faixas.
- Players persistentes: mudanças de volume, Master Output e loop não reiniciam o áudio.
- Controles de mixagem restritos ao GM; jogadores recebem o estado sincronizado.
- Busca e filtros por tags.
- Adicionar, editar e excluir trilhas da biblioteca.
- Importar e exportar CSV.
- Conversão automática de links Dropbox para reprodução direta.
- Interface baseada no padrão visual Tech Noir da DSO Chat.

## CSV

Cabeçalho esperado:

```csv
title,url,tags,volume,loop
Hospital Kali,https://...,Ambiente|Terror,55,true
```

`volume` vai de 0 a 100.

## Onde os dados ficam salvos

A biblioteca é salva no `localStorage` do navegador do Mestre, separada por sala e usuário.
O estado ativo da mixagem é mantido pelo motor de áudio e sincronizado via Broadcast do Owlbear.

## Hospedagem

A extensão é estática. No Render:

- Build Command: `echo "No build required"`
- Publish Directory: `.`

Se necessário, configure os headers:

- Path: `/*`
- `Access-Control-Allow-Origin` = `https://www.owlbear.rodeo`
- `Access-Control-Allow-Methods` = `GET, OPTIONS`

## Instalação no Owlbear

Depois de hospedada, instale usando:

`https://SEU-SITE.onrender.com/manifest.json`


## Ajustes v0.1.2
- Biblioteca sem cabeçalho redundante.
- Ícone oficial em forma de faixa/waveform musical.
- `LOOP ON` repete a faixa continuamente.
