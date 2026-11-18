// Quem recebe a resposta (Responder e Responder a todos). Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { replyRecipients } from "./replyRecipients.ts";

const me = { name: "Moradah", email: "appmoradah@gmail.com" };
const cakto = { name: "Compliance Cakto", email: "compliance@cakto.com.br" };
const suporte = { name: "Suporte", email: "suporte@cakto.com.br" };
const ana = { name: "Ana", email: "ana@x.com" };
const emails = (l: { email: string }[]) => l.map((p) => p.email);

test("responder e-mail que outra pessoa mandou vai para ela", () => {
  const r = replyRecipients({ from: cakto, recipients: [me, suporte], cc: [ana] }, [me.email], "reply");
  assert.deepEqual(emails(r.to), [cakto.email]);
  assert.deepEqual(r.cc, []);
});

test("responder e-mail que eu mandei vai para quem estava no Para, não para mim", () => {
  const r = replyRecipients({ from: me, recipients: [cakto], cc: [] }, [me.email], "reply");
  assert.deepEqual(emails(r.to), [cakto.email]);
  // mesmo com maiúscula diferente no endereço
  const r2 = replyRecipients({ from: { name: "Eu", email: "AppMoradah@Gmail.com" }, recipients: [cakto, suporte], cc: [] }, [me.email], "reply");
  assert.deepEqual(emails(r2.to), [cakto.email, suporte.email]);
});

test("e-mail que mandei só para mim continua indo para mim", () => {
  const r = replyRecipients({ from: me, recipients: [me], cc: [] }, [me.email], "reply");
  assert.deepEqual(emails(r.to), [me.email]);
});

test("Reply-To manda a resposta para o endereço pedido", () => {
  const lista = { name: "Lista", email: "lista@x.com" };
  const r = replyRecipients({ from: cakto, recipients: [me], cc: [], replyTo: lista }, [me.email], "reply");
  assert.deepEqual(emails(r.to), [lista.email]);
});

test("responder a todos inclui o Para e o Cc, sem mim e sem repetir", () => {
  const r = replyRecipients({ from: cakto, recipients: [me, suporte, cakto], cc: [ana, me] }, [me.email], "replyAll");
  assert.deepEqual(emails(r.to), [cakto.email, suporte.email]);
  assert.deepEqual(emails(r.cc), [ana.email]);
});

test("responder a todos num e-mail que eu mandei mantém o Para e o Cc originais", () => {
  const r = replyRecipients({ from: me, recipients: [cakto, suporte], cc: [ana] }, [me.email], "replyAll");
  assert.deepEqual(emails(r.to), [cakto.email, suporte.email]);
  assert.deepEqual(emails(r.cc), [ana.email]);
});
