// Excluir para sempre e Esvaziar lixeira (partes sem React). Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteForeverConfirm, deletedText, emptiedText, groupByAccount, trashAccounts } from "./deleteForever.ts";

test("separa os e-mails por conta e ignora os de exemplo (sem conta)", () => {
  const groups = groupByAccount([
    { id: "a", accountEmail: "ana@gmail.com" },
    { id: "b", accountEmail: "bia@icloud.com" },
    { id: "c", accountEmail: "ana@gmail.com" },
    { id: "d" },
  ]);
  assert.deepEqual([...groups], [
    ["ana@gmail.com", ["a", "c"]],
    ["bia@icloud.com", ["b"]],
  ]);
});

test("avisos com a quantidade certa", () => {
  assert.equal(deletedText(1), "1 e-mail excluído para sempre");
  assert.equal(deletedText(12), "12 e-mails excluídos para sempre");
  assert.equal(emptiedText(0), "A Lixeira já estava vazia");
  assert.equal(emptiedText(1), "Lixeira esvaziada: 1 e-mail excluído");
  assert.equal(emptiedText(1500), "Lixeira esvaziada: 1.500 e-mails excluídos");
});

test("esvaziar vale para todas as contas ou só para a filtrada", () => {
  const all = ["ana@gmail.com", "bia@icloud.com"];
  assert.deepEqual(trashAccounts(all, "all"), all);
  assert.deepEqual(trashAccounts(all, "bia@icloud.com"), ["bia@icloud.com"]);
  // filtro de uma conta que não está mais conectada: nada
  assert.deepEqual(trashAccounts(all, "velha@x.com"), []);
});

test("a confirmação deixa claro que não tem volta", () => {
  assert.equal(deleteForeverConfirm(1).title, "Excluir este e-mail para sempre?");
  assert.equal(deleteForeverConfirm(1200).title, "Excluir 1.200 e-mails para sempre?");
  assert.match(deleteForeverConfirm(3).text, /não dá para desfazer/i);
});
