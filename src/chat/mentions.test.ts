// Menções (@) na caixa de escrever do Chat. Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMentions, filterPeople, mentionAt } from "./mentions.ts";

test("acha o @ que está sendo digitado antes do cursor", () => {
  assert.deepEqual(mentionAt("oi @ped", 7), { start: 3, query: "ped" });
  assert.deepEqual(mentionAt("@", 1), { start: 0, query: "" });
  assert.deepEqual(mentionAt("linha\n@an", 9), { start: 6, query: "an" });
});

test("não abre a lista em e-mail, depois de espaço ou longe do cursor", () => {
  assert.equal(mentionAt("contato@site", 12), null);
  assert.equal(mentionAt("oi @pedro assis", 15), null);
  assert.equal(mentionAt("oi @ped e mais", 14), null);
  assert.equal(mentionAt("sem arroba", 10), null);
});

const people = [
  { id: "users/1", name: "Pedro Assis" },
  { id: "users/2", name: "Ana Júlia" },
  { id: "users/3", name: "Gabriel Vianna" },
];

test("filtra por começo de nome ou sobrenome, sem acento e sem maiúscula", () => {
  assert.deepEqual(filterPeople(people, "").map((p) => p.id), ["users/1", "users/2", "users/3"]);
  assert.deepEqual(filterPeople(people, "jul").map((p) => p.id), ["users/2"]);
  assert.deepEqual(filterPeople(people, "AS").map((p) => p.id), ["users/1"]);
  assert.deepEqual(filterPeople(people, "xyz"), []);
});

test("troca @Nome pela menção do Google na hora de enviar", () => {
  assert.equal(applyMentions("oi @Pedro Assis, veja", [people[0]]), "oi <users/1>, veja");
  assert.equal(applyMentions("@Ana Júlia e @Pedro Assis", [people[0], people[1]]), "<users/2> e <users/1>");
});

test("não troca nome apagado nem pedaço de outro nome", () => {
  assert.equal(applyMentions("oi Pedro Assis", [people[0]]), "oi Pedro Assis");
  assert.equal(applyMentions("@Pedro Assiss", [people[0]]), "@Pedro Assiss");
  // nome mais longo primeiro (um nome que começa igual a outro)
  const both = [{ id: "users/8", name: "Ana" }, { id: "users/9", name: "Ana Paula" }];
  assert.equal(applyMentions("@Ana Paula e @Ana", both), "<users/9> e <users/8>");
});
