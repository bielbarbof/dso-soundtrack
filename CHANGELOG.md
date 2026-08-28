# Changelog

## v0.1.2

- Removidos os títulos redundantes `ARQUIVO // LOCAL` e `BIBLIOTECA`; busca, categorias e faixas passam a falar por si.
- Novo ícone oficial do DSO Soundtrack: uma faixa/waveform musical em Tech Noir, usado no Owlbear e no cabeçalho da extensão.
- Reforçada a semântica do controle LOOP: com `LOOP ON`, a faixa é repetida continuamente sem interromper as demais camadas do mixer.

## 0.1.1

- Sincronização refeita com o Mestre como referência autoritativa da mixagem.
- Snapshot periódico de reprodução para corrigir drift entre participantes.
- Correção suave de pequenos desvios e reposicionamento quando o desvio fica perceptível.
- Jogadores que entram depois recebem a posição atual das faixas e fazem catch-up automaticamente.
- Players de áudio agora são persistentes: Master Output, volume individual e loop não recriam nem reiniciam a faixa.
- Correção do bug que fazia músicas voltarem para 00:00 ao alterar controles do mixer.
- Volume individual refeito para não reconstruir o DOM durante o arraste, deixando o slider contínuo e suave.
- Removidos os títulos "MIXER // AO VIVO" e "AGORA TOCANDO".
- Cards de faixas em reprodução agora usam fundo vinho Tech Noir em vez de borda vermelha.
- Categorias e tags aumentadas para melhorar leitura.

## 0.1.0

- Primeira versão pública do DSO Soundtrack.
- Mixer com múltiplas faixas simultâneas.
- Master Output global sincronizado.
- Volume, loop, pause, stop e seek por faixa.
- Biblioteca de trilhas com Dropbox/URLs diretas.
- Importação e exportação CSV.
- Background audio engine.
- Sincronização de estado para entrada tardia.
- Interface Tech Noir DSO.
