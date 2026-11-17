// Resposta rápida guardada. Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { clearReplyDraft, getReplyDraft, hasText, setReplyDraft } from "./replyDrafts.ts";

test("caixa vazia do contentEditable não conta como texto", () => {
  assert.equal(hasText(""), false);
  assert.equal(hasText("<br>"), false);
  assert.equal(hasText("<div><br></div>"), false);
  assert.equal(hasText("<div>&nbsp; </div>"), false);
});

test("texto ou imagem contam", () => {
  assert.equal(hasText("<div>Oi</div>"), true);
  assert.equal(hasText('<img src="data:image/png;base64,AA">'), true);
});

test("guarda e apaga a resposta de um e-mail", () => {
  setReplyDraft("m1", { html: "<div>Oi</div>", files: [], draftId: "r-1" });
  assert.equal(getReplyDraft("m1")?.draftId, "r-1");
  assert.equal(getReplyDraft("m2"), undefined);
  clearReplyDraft("m1");
  assert.equal(getReplyDraft("m1"), undefined);
});
