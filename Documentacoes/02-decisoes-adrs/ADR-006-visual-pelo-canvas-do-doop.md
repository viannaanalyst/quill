---
type: adr
tags: [quill, adr, design, visual, doop]
updated: 2026-11-17
---

# ADR-006: Visual com o canvas do Doop como fonte da verdade

**Status:** Aceito (2026-11-17)

**Contexto**
O Gabriel aprovou as telas desenhadas no canvas "Quill" do Doop antes de programar. Sem uma fonte única, cada tela
acabaria com um jeito diferente.

**Decisão**
- A fonte da verdade é o canvas "Quill" no Doop, guideline `quill-estilo`. Cópia em `docs/design.md` e imagens em
  `design/telas/`. Cada tela fica **igual ao desenho aprovado, em claro e escuro**.
- Regras fixadas:
  - fundo **branco suave, nunca creme**; neutros sem tom quente;
  - **uma única linha fina** contornando o painel principal (margem de 10px, borda de 1px, cantos de 22px), sem linhas
    a mais na janela do Mac;
  - botões em **pílula com degradê e brilho no topo** (acabamento do runelay); principal preto no claro e branco no
    escuro; **nunca botão verde**;
  - eventos **sem barrinha lateral colorida**, só fundo suave na cor da agenda;
  - **barra lateral compacta** de ícones, com o avatar no canto direito do cabeçalho (nunca na barra lateral);
  - fonte Inter; ícones Lucide; logos reais dos serviços, nunca emoji.

**Consequências**
- Positivas: visual coerente; qualquer agente sabe onde conferir.
- Negativas: mudança de visual exige atualizar o canvas e o `docs/design.md`.
- Atenção: o canvas fica na VPS e só abre pela rede Tailscale.

**Alternativas consideradas**
- **Visual padrão do macOS:** não seria igual ao desenho aprovado nem igual no Windows.
- **Biblioteca de componentes pronta (MUI, Chakra, Ant):** visual próprio dela e peso a mais.
