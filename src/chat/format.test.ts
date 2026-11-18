// Testes do interpretador da formatação do Google Chat. Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { emojiOnly, parseChat, plainChat } from "./format.ts";

const t = (v: string) => ({ t: "text", v });
const p = (...c: unknown[]) => ({ t: "p", c });

test("texto simples com quebras de linha preservadas", () => {
  assert.deepEqual(parseChat("oi\ntudo bem?"), [p(t("oi"), { t: "br" }, t("tudo bem?"))]);
  assert.deepEqual(parseChat("a\n\nb"), [p(t("a"), { t: "br" }, { t: "br" }, t("b"))]);
});

test("negrito, itálico e tachado, também um dentro do outro", () => {
  assert.deepEqual(parseChat("*forte* _leve_ ~fora~"), [
    p({ t: "b", c: [t("forte")] }, t(" "), { t: "i", c: [t("leve")] }, t(" "), { t: "s", c: [t("fora")] }),
  ]);
  assert.deepEqual(parseChat("*_os dois_*"), [p({ t: "b", c: [{ t: "i", c: [t("os dois")] }] })]);
});

test("marcação no meio de palavra ou com espaço na borda não vale", () => {
  assert.deepEqual(parseChat("nome_do_arquivo"), [p(t("nome_do_arquivo"))]);
  assert.deepEqual(parseChat("2*3*4"), [p(t("2*3*4"))]);
  assert.deepEqual(parseChat("x * não é negrito * y"), [p(t("x * não é negrito * y"))]);
  assert.deepEqual(parseChat("*sem fim"), [p(t("*sem fim"))]);
});

test("mensagem automática com emoji e linhas em negrito", () => {
  const out = parseChat("💸 *Compra lançada (paga)*\n*Valor:* R$ 52,90");
  assert.deepEqual(out, [
    p(
      { t: "emoji", v: "💸" },
      t(" "),
      { t: "b", c: [t("Compra lançada (paga)")] },
      { t: "br" },
      { t: "b", c: [t("Valor:")] },
      t(" R$ 52,90"),
    ),
  ]);
});

test("código na linha fica literal", () => {
  assert.deepEqual(parseChat("rode `npm *run* dev` agora"), [p(t("rode "), { t: "code", v: "npm *run* dev" }, t(" agora"))]);
});

test("bloco de código com três crases, em várias linhas", () => {
  assert.deepEqual(parseChat("antes\n```\nconst a = 1;\n  *b*\n```\ndepois"), [
    p(t("antes")),
    { t: "pre", v: "const a = 1;\n  *b*" },
    p(t("depois")),
  ]);
  assert.deepEqual(parseChat("```x```"), [{ t: "pre", v: "x" }]);
  assert.deepEqual(parseChat("``` sem fim"), [p(t("``` sem fim"))]);
});

test("links com texto, links soltos e endereços perigosos", () => {
  assert.deepEqual(parseChat("veja <https://a.com/x|o painel>"), [p(t("veja "), { t: "link", href: "https://a.com/x", c: [t("o painel")] })]);
  assert.deepEqual(parseChat("<https://a.com>"), [p({ t: "link", href: "https://a.com", c: [t("a.com")] })]);
  assert.deepEqual(parseChat("em https://a.com/b_c_d. Ok"), [p(t("em "), { t: "link", href: "https://a.com/b_c_d", c: [t("a.com/b_c_d")] }, t(". Ok"))]);
  assert.deepEqual(parseChat("<javascript:alert(1)|clique>"), [p(t("<javascript:alert(1)|clique>"))]);
  assert.deepEqual(parseChat("<mailto:a@b.com|e-mail>"), [p({ t: "link", href: "mailto:a@b.com", c: [t("e-mail")] })]);
});

test("menções de pessoa e de todos", () => {
  assert.deepEqual(parseChat("oi <users/123>, <users/all>"), [p(t("oi "), { t: "mention", id: "users/123" }, t(", "), { t: "mention", id: "users/all" })]);
});

test("listas com hífen, asterisco ou bolinha", () => {
  assert.deepEqual(parseChat("Itens:\n- um\n* *dois*\n• três\nfim"), [
    p(t("Itens:")),
    { t: "ul", items: [{ c: [t("um")] }, { c: [{ t: "b", c: [t("dois")] }] }, { c: [t("três")] }] },
    p(t("fim")),
  ]);
});

test("emojis compostos ficam inteiros e símbolos comuns não viram emoji", () => {
  assert.deepEqual(parseChat("👨‍👩‍👧 👍🏽 🇧🇷 1️⃣ ❤️"), [
    p({ t: "emoji", v: "👨‍👩‍👧" }, t(" "), { t: "emoji", v: "👍🏽" }, t(" "), { t: "emoji", v: "🇧🇷" }, t(" "), { t: "emoji", v: "1️⃣" }, t(" "), { t: "emoji", v: "❤️" }),
  ]);
  assert.deepEqual(parseChat("© 2026 ™"), [p(t("© 2026 ™"))]);
});

test("emoji próprio da empresa vira imagem; nome desconhecido fica como texto", () => {
  const custom = [{ name: ":festa:", url: "https://lh3.googleusercontent.com/f" }];
  assert.deepEqual(parseChat("boa :festa: :outro:", custom), [p(t("boa "), { t: "custom", name: ":festa:", url: "https://lh3.googleusercontent.com/f" }, t(" :outro:"))]);
});

test("texto puro para citação e prévia", () => {
  assert.equal(plainChat("💸 *Compra* em <https://a.com|painel>\n- `x`"), "💸 Compra em painel\nx");
  assert.equal(plainChat("oi <users/1>", (id) => (id === "users/1" ? "Ana" : null)), "oi @Ana");
  assert.equal(plainChat("oi <users/all>"), "oi @todos");
});

test("mensagem só de emoji (até 3) aparece maior", () => {
  assert.equal(emojiOnly(parseChat("👍")), true);
  assert.equal(emojiOnly(parseChat("🎉 🎉")), true);
  assert.equal(emojiOnly(parseChat("ok 👍")), false);
  assert.equal(emojiOnly(parseChat("👍👍👍👍")), false);
  assert.equal(emojiOnly(parseChat(":festa:", [{ name: ":festa:", url: "https://x.googleusercontent.com/f" }])), true);
  assert.equal(emojiOnly(parseChat("")), false);
});

test("menção no formato novo do Google (<chat-user>) vira menção, e não texto cru", () => {
  assert.deepEqual(parseChat('oi <chat-user data-user="users/115"></chat-user>!'), [p(t("oi "), { t: "mention", id: "users/115" }, t("!"))]);
  assert.deepEqual(parseChat("<chat-user data-user='users/7'>@Ana</chat-user>"), [p({ t: "mention", id: "users/7" })]);
  assert.equal(plainChat('<chat-user data-user="users/1"></chat-user> veja', (id) => (id === "users/1" ? "Ana" : null)), "@Ana veja");
});
