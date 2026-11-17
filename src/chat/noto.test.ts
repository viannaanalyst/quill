// Endereços dos emojis do Google (Noto Animated Emoji). Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { notoCode, notoUrl } from "./noto.ts";

test("emoji simples em hexadecimal minúsculo", () => {
  assert.equal(notoCode("😀"), "1f600");
  assert.equal(notoCode("🫡"), "1fae1");
});

test("tira o seletor de cor (fe0f)", () => {
  assert.equal(notoCode("❤️"), "2764");
  assert.equal(notoCode("✅"), "2705");
});

test("sequências com _ (tom de pele, família, bandeira)", () => {
  assert.equal(notoCode("👍🏽"), "1f44d_1f3fd");
  assert.equal(notoCode("👨‍👩‍👧"), "1f468_200d_1f469_200d_1f467");
  assert.equal(notoCode("🇧🇷"), "1f1e7_1f1f7");
});

test("códigos curtos com 4 dígitos (tecla e símbolo)", () => {
  assert.equal(notoCode("1️⃣"), "0031_20e3");
  assert.equal(notoCode("©️"), "00a9");
});

test("endereço do animado e do parado", () => {
  assert.equal(notoUrl("🎉", "anim"), "https://fonts.gstatic.com/s/e/notoemoji/latest/1f389/512.webp");
  assert.equal(notoUrl("🎉", "still"), "https://fonts.gstatic.com/s/e/notoemoji/latest/1f389/emoji.svg");
});
