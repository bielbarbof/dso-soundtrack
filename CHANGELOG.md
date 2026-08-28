# Changelog

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
