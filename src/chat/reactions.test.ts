// Reações rápidas da barra da mensagem. Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { quickReactions } from "./reactions.ts";

test("no começo, as três iniciais", () => {
  assert.deepEqual(quickReactions({}), ["✅", "🫡", "🤣"]);
});

test("as mais usadas passam na frente; empate fica na ordem das iniciais", () => {
  assert.deepEqual(quickReactions({ "👍": 2 }), ["👍", "✅", "🫡"]);
  assert.deepEqual(quickReactions({ "🤣": 1, "👍": 3, "🎉": 2 }), ["👍", "🎉", "🤣"]);
  assert.deepEqual(quickReactions({ "🎉": 1, "🔥": 1 }), ["🎉", "🔥", "✅"]);
});
