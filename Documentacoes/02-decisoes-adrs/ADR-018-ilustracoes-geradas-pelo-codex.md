---
type: adr
tags: [quill, adr, design, ilustracoes, codex, desempenho]
updated: 2026-11-17
---

# ADR-018: Ilustrações da saudação e variações do ícone geradas pelo Codex

**Status:** Aceito (2026-11-17)

**Contexto**
O cartão de saudação ("Bom dia, Gabriel") pede uma imagem de fundo que mude com o horário, em versão clara e escura.
A primeira versão usava cenas desenhadas em SVG no próprio código.

**Decisão**
- As ilustrações da saudação (céu, montanhas, mar, cidade, aurora, campo, cada uma clara e escura) e as variações do
  ícone do app foram geradas pelo **Codex com o modelo Luna 6, esforço alto**.
- Ficam no app em **WebP leve**: as 12 ilustrações somam cerca de 236 KB (`src/assets/banners/`).
- No automático: céu de manhã (5h–12h), campo à tarde (12h–18h), cidade à noite. Dá para escolher outra, usar uma
  foto própria ou esconder (Ajustes → Aparência ou no próprio cartão).
- As variações do ícone (para escolher o ícone do Dock) estavam sendo ligadas ao app em 2026-11-17, fora do último
  commit.

**Consequências**
- Positivas: imagens ricas sem pesar no app.
- Negativas: refazer uma imagem depende de gerar de novo no Codex.
- Observação: isso não contraria o ADR-002; a IA foi usada para criar as imagens, não roda dentro do app.

**Alternativas consideradas**
- **Ilustrações em SVG feitas no código:** primeira versão, substituída pelas imagens do Codex.
- **Fotos de banco de imagens:** pesadas e sem versão escura combinando.
