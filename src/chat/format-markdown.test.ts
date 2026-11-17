// Markdown e escapes no texto do Chat (notas do Gemini, bots e integrações). Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { emojiOnly, parseChat, plainChat, type Block, type Inline } from "./format.ts";

const t = (v: string): Inline => ({ t: "text", v });
const b = (...c: Inline[]): Inline => ({ t: "b", c });
const i = (...c: Inline[]): Inline => ({ t: "i", c });
const s = (...c: Inline[]): Inline => ({ t: "s", c });
const link = (href: string, ...c: Inline[]): Inline => ({ t: "link", href, c });
const p = (...c: Inline[]): Block => ({ t: "p", c });
const item = (c: Inline[], sub?: Block) => (sub ? { c, sub } : { c });

/** Junta todo o texto visível (para conferir que não sobrou marcação). */
const visible = (text: string) => plainChat(text);

/* ---------- negrito, itálico e tachado do Markdown ---------- */
test("**negrito** do Markdown vira negrito sem asteriscos", () => {
  assert.deepEqual(parseChat("**Abertura e Dinâmica Inicial**"), [p(b(t("Abertura e Dinâmica Inicial")))]);
});

test("__negrito__ do Markdown", () => {
  assert.deepEqual(parseChat("veja __isto__ agora"), [p(t("veja "), b(t("isto")), t(" agora"))]);
});

test("~~tachado~~ do Markdown", () => {
  assert.deepEqual(parseChat("~~cancelado~~ remarcado"), [p(s(t("cancelado")), t(" remarcado"))]);
});

test("negrito do Markdown colado em pontuação e no meio da frase", () => {
  assert.deepEqual(parseChat("Status:**ok**, segue."), [p(t("Status:"), b(t("ok")), t(", segue."))]);
});

test("***negrito e itálico*** não deixa asterisco sobrando", () => {
  assert.equal(visible("***muito importante***"), "muito importante");
});

test("Google Chat e Markdown misturados na mesma mensagem", () => {
  assert.deepEqual(parseChat("*Google* e **Markdown** e _itálico_"), [p(b(t("Google")), t(" e "), b(t("Markdown")), t(" e "), i(t("itálico")))]);
});

test("negrito sem par continua como texto", () => {
  assert.deepEqual(parseChat("**sem fim"), [p(t("**sem fim"))]);
  assert.deepEqual(parseChat("5 * 3 = 15"), [p(t("5 * 3 = 15"))]);
  assert.deepEqual(parseChat("2 ** 8 = 256"), [p(t("2 ** 8 = 256"))]);
});

test("sublinhado no meio de palavra não vira itálico nem negrito", () => {
  assert.deepEqual(parseChat("arquivo__final__v2.pdf e meu_arquivo_novo"), [p(t("arquivo__final__v2.pdf e meu_arquivo_novo"))]);
});

/* ---------- escapes ---------- */
test("escapes mostram só o caractere", () => {
  assert.deepEqual(parseChat("\\[Richard Reis\\] disse \\*não\\* \\_x\\_ \\~y\\~ \\(a\\) \\# \\- \\` \\\\"), [
    p(t("[Richard Reis] disse *não* _x_ ~y~ (a) # - ` \\")),
  ]);
});

test("asterisco escapado dentro do negrito fica como texto", () => {
  assert.deepEqual(parseChat("**nota 5\\*** fim"), [p(b(t("nota 5*")), t(" fim"))]);
});

test("barra invertida antes de letra fica como está (caminho do Windows)", () => {
  assert.deepEqual(parseChat("C:\\Users\\ana"), [p(t("C:\\Users\\ana"))]);
});

test("linha começando com hífen escapado não vira lista", () => {
  assert.deepEqual(parseChat("\\- não é item"), [p(t("- não é item"))]);
});

/* ---------- links ---------- */
test("link do Markdown [texto](url)", () => {
  assert.deepEqual(parseChat("abra [o painel](https://a.com/x) hoje"), [p(t("abra "), link("https://a.com/x", t("o painel")), t(" hoje"))]);
});

test("link do Markdown com parênteses no endereço", () => {
  assert.deepEqual(parseChat("[wiki](https://pt.wikipedia.org/wiki/Rio_(cidade))"), [p(link("https://pt.wikipedia.org/wiki/Rio_(cidade)", t("wiki")))]);
});

test("link do Markdown com endereço perigoso fica como texto", () => {
  assert.equal(visible("[clique](javascript:alert(1))"), "[clique](javascript:alert(1))");
  assert.ok(!JSON.stringify(parseChat("[clique](javascript:alert(1))")).includes('"link"'));
});

test("negrito com link dentro", () => {
  assert.deepEqual(parseChat("**veja [aqui](https://a.com)**"), [p(b(t("veja "), link("https://a.com", t("aqui"))))]);
});

test("link com texto em negrito", () => {
  assert.deepEqual(parseChat("[**Relatório**](https://a.com/r)"), [p(link("https://a.com/r", b(t("Relatório"))))]);
});

test("URL solta não leva o ponto, a vírgula nem o parêntese do fim", () => {
  assert.deepEqual(parseChat("(veja https://a.com/x)."), [p(t("(veja "), link("https://a.com/x", t("a.com/x")), t(")."))]);
  assert.deepEqual(parseChat("sites: https://a.com, https://b.com!"), [
    p(t("sites: "), link("https://a.com", t("a.com")), t(", "), link("https://b.com", t("b.com")), t("!")),
  ]);
});

test("URL solta dentro de negrito do Markdown não leva os asteriscos", () => {
  assert.deepEqual(parseChat("**https://a.com/x**"), [p(b(link("https://a.com/x", t("a.com/x"))))]);
});

test("link do Google Chat <url|texto> continua funcionando com Markdown ao lado", () => {
  assert.deepEqual(parseChat("<https://a.com|painel> e [b](https://b.com)"), [p(link("https://a.com", t("painel")), t(" e "), link("https://b.com", t("b")))]);
});

/* ---------- código ---------- */
test("código com asterisco e sublinhado dentro não formata", () => {
  assert.deepEqual(parseChat("rode `**a** _b_ \\[c\\]`"), [p(t("rode "), { t: "code", v: "**a** _b_ \\[c\\]" })]);
});

test("bloco de código com Markdown dentro fica literal", () => {
  assert.deepEqual(parseChat("```\n# não é título\n- nem lista\n```"), [{ t: "pre", v: "# não é título\n- nem lista" }]);
});

/* ---------- títulos, citação e linha ---------- */
test("títulos #, ## e ### viram uma linha em negrito", () => {
  const br: Inline = { t: "br" };
  assert.deepEqual(parseChat("# Um\n## Dois\n### Três\ntexto"), [p(b(t("Um")), br, b(t("Dois")), br, b(t("Três")), br, t("texto"))]);
});

test("título com # no fim e com negrito dentro", () => {
  assert.deepEqual(parseChat("## **Resumo** ##"), [p(b(b(t("Resumo"))))]);
});

test("# sem espaço (hashtag) não é título", () => {
  assert.deepEqual(parseChat("#vendas #2026"), [p(t("#vendas #2026"))]);
});

test("citação com > junta as linhas seguidas", () => {
  assert.deepEqual(parseChat("> primeira\n> **segunda**\nfora"), [{ t: "quote", c: [p(t("primeira"), { t: "br" }, b(t("segunda")))] }, p(t("fora"))]);
});

test("linha --- (ou ***) vira separador", () => {
  assert.deepEqual(parseChat("antes\n---\ndepois\n***"), [p(t("antes")), { t: "hr" }, p(t("depois")), { t: "hr" }]);
});

/* ---------- listas ---------- */
test("lista numerada com 1. e 2)", () => {
  assert.deepEqual(parseChat("1. um\n2) dois"), [{ t: "ol", start: 1, items: [item([t("um")]), item([t("dois")])] }]);
});

test("lista numerada que começa em outro número", () => {
  assert.deepEqual(parseChat("3. três\n4. quatro"), [{ t: "ol", start: 3, items: [item([t("três")]), item([t("quatro")])] }]);
});

test("lista com negrito no começo do item", () => {
  assert.deepEqual(parseChat("* **Apresentação:** abriu a reunião"), [{ t: "ul", items: [item([b(t("Apresentação:")), t(" abriu a reunião")])] }]);
});

test("lista aninhada pelo recuo (espaços e tab)", () => {
  assert.deepEqual(parseChat("- a\n    - a1\n\t- a2\n- b"), [
    { t: "ul", items: [item([t("a")], { t: "ul", items: [item([t("a1")]), item([t("a2")])] }), item([t("b")])] },
  ]);
});

test("lista numerada com subitens de marcador", () => {
  assert.deepEqual(parseChat("1. passo\n   * detalhe\n2. outro"), [
    { t: "ol", start: 1, items: [item([t("passo")], { t: "ul", items: [item([t("detalhe")])] }), item([t("outro")])] },
  ]);
});

test("linha em branco entre itens não quebra a lista", () => {
  assert.deepEqual(parseChat("- a\n\n- b"), [{ t: "ul", items: [item([t("a")]), item([t("b")])] }]);
});

test("número com ponto no meio da frase não vira lista", () => {
  assert.deepEqual(parseChat("Em 2026. Tudo certo"), [p(t("Em 2026. Tudo certo"))]);
});

/* ---------- emoji, acentos e texto longo ---------- */
test("emoji e acentos dentro do negrito do Markdown", () => {
  assert.deepEqual(parseChat("**Atenção 🚨 ação já**"), [p(b(t("Atenção "), { t: "emoji", v: "🚨" }, t(" ação já")))]);
});

test("mensagem só de emoji continua grande mesmo com Markdown por perto", () => {
  assert.equal(emojiOnly(parseChat("🎉🎉")), true);
  assert.equal(emojiOnly(parseChat("**🎉**")), false);
});

test("texto longo com muitas marcações não trava e não sobra marcação", () => {
  const line = "**Item** com _ênfase_, ~~velho~~ e [link](https://a.com/x). ";
  const long = line.repeat(400);
  const started = Date.now();
  const out = visible(long);
  assert.ok(Date.now() - started < 1500, "demorou demais");
  assert.ok(!/[*~]|\]\(/.test(out));
  assert.ok(out.startsWith("Item com ênfase, velho e link. "));
});

test("muitos asteriscos sem par em texto longo não travam", () => {
  const started = Date.now();
  const out = visible("a * b ** c ".repeat(2000));
  assert.ok(Date.now() - started < 1500, "demorou demais");
  assert.ok(out.startsWith("a * b ** c "));
});

/* ---------- notas de reunião do Gemini (exemplo real) ---------- */
const GEMINI = [
  "📝 **Anotações da reunião: alinhamento do projeto Aurora**",
  "",
  "### Resumo",
  "\\[Richard Reis\\] e \\[Gabriel Vianna\\] alinharam o cronograma e as próximas entregas.",
  "",
  "*Abertura e Dinâmica Inicial*",
  "* **Apresentação:** \\[Richard Reis\\] abriu a reunião e explicou a dinâmica.",
  "    * Cada pessoa teve 5 minutos para falar.",
  "* **Prioridades:** a equipe revisou o [Painel Aurora](https://painel.aurora.app/q4).",
  "",
  "**Próximas etapas**",
  "1. \\[Gabriel Vianna\\] Enviar a proposta revisada até sexta-feira.",
  "2. \\[Richard Reis\\] Marcar a revisão com a diretoria \\(15h\\).",
  "",
  "---",
  "Revise as anotações do Gemini. Saiba mais em https://support.google.com/meet.",
].join("\n");

test("notas do Gemini: nada de asterisco, barra invertida ou # aparecendo", () => {
  const out = visible(GEMINI);
  assert.ok(!out.includes("*"), out);
  assert.ok(!out.includes("\\"), out);
  assert.ok(!out.includes("#"), out);
  assert.ok(out.includes("[Richard Reis] abriu a reunião"));
  assert.ok(out.includes("diretoria (15h)."));
});

test("notas do Gemini: títulos em negrito, lista aninhada, numerada, separador e links", () => {
  const blocks = parseChat(GEMINI);
  assert.deepEqual(
    blocks.map((x) => x.t),
    ["p", "ul", "p", "ol", "hr", "p"],
  );
  const intro = (blocks[0] as Extract<Block, { t: "p" }>).c;
  assert.deepEqual(intro.slice(0, 3), [{ t: "emoji", v: "📝" }, t(" "), b(t("Anotações da reunião: alinhamento do projeto Aurora"))]);
  assert.ok(intro.some((n) => JSON.stringify(n) === JSON.stringify(b(t("Resumo")))), "### Resumo em negrito");
  assert.deepEqual(intro.at(-1), b(t("Abertura e Dinâmica Inicial")));
  const ul = blocks[1] as Extract<Block, { t: "ul" }>;
  assert.deepEqual(ul.items[0].c, [b(t("Apresentação:")), t(" [Richard Reis] abriu a reunião e explicou a dinâmica.")]);
  assert.deepEqual(ul.items[0].sub, { t: "ul", items: [item([t("Cada pessoa teve 5 minutos para falar.")])] });
  assert.deepEqual(ul.items[1].c.at(-2), link("https://painel.aurora.app/q4", t("Painel Aurora")));
  assert.deepEqual(blocks[2], p(b(t("Próximas etapas"))));
  const ol = blocks[3] as Extract<Block, { t: "ol" }>;
  assert.equal(ol.start, 1);
  assert.equal(ol.items.length, 2);
  assert.deepEqual((blocks[5] as Extract<Block, { t: "p" }>).c.slice(-2), [link("https://support.google.com/meet", t("support.google.com/meet")), t(".")]);
});
