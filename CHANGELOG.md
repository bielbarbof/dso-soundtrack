# Changelog

## v0.1.4

### Correção crítica — relógio e barra de progresso
- Corrigida a fórmula visual de posição em faixas com **LOOP ON**. Ao retomar uma faixa pausada, a UI agora continua exatamente do ponto em que parou em vez de voltar visualmente para `00:00`.
- A posição exibida agora é calculada como `posição-base + tempo decorrido`, aplicando o módulo da duração somente depois da soma.
- Snapshots usam `sentAt` como âncora temporal, reduzindo saltos e mantendo relógio/barra mais fiéis ao player real.
- Patches de play/resume também preservam a âncora temporal recebida.
- Faixas sem loop são limitadas visualmente à duração real em vez de ultrapassá-la.

## v0.1.3

### Interface
- `MASTER OUTPUT` agora se chama **VOLUME GLOBAL**.
- Removido o botão redundante **+ FAIXA** da área de reprodução; adicionar faixa permanece no menu principal.
- Ícone oficial substituído por uma **nota/faixa musical simples**, usado no Owlbear e no cabeçalho.
- Passe geral de alinhamento, tipografia, espaçamento e consistência dos controles Tech Noir.
- Cards em reprodução mantêm o fundo vinho escuro, sem borda vermelha chamativa.

### Reprodução e estado
- Corrigido o bug em que a UI visualmente voltava ao início ao retomar uma faixa pausada.
- A posição real do elemento de áudio passa a ser a fonte preferencial para snapshots e pause/resume.
- Pause, resume e seek enviam patches imediatos de playback para a UI e clientes remotos.
- O loop continua sendo loop real da faixa por meio do player persistente.
- Volume global, volume individual e loop não recriam o player nem reiniciam a música.
