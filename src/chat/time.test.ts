// Horário ao lado do nome, no formato do Google Chat. Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { stampLabel } from "./time.ts";

const now = new Date(2026, 10, 17, 15, 30).getTime();
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).getTime();

test("hoje: só a hora", () => {
  assert.equal(stampLabel(at(2026, 10, 17, 11, 0), now), "11:00");
  assert.equal(stampLabel(at(2026, 10, 17, 9, 5), now), "09:05");
  // mesmo de um minuto atrás: o Google Chat mostra a hora, sem "agora"
  assert.equal(stampLabel(at(2026, 10, 17, 15, 29), now), "15:29");
});

test("outro dia do mesmo ano: dia, mês curto e hora", () => {
  assert.equal(stampLabel(at(2026, 10, 5, 11, 0), now), "5 de nov., 11:00");
  assert.equal(stampLabel(at(2026, 10, 16, 18, 20), now), "16 de nov., 18:20");
  assert.equal(stampLabel(at(2026, 4, 1, 8, 0), now), "1 de mai., 08:00");
});

test("outro ano: inclui o ano", () => {
  assert.equal(stampLabel(at(2025, 11, 31, 23, 59), now), "31 de dez. de 2025, 23:59");
  assert.equal(stampLabel(at(2024, 0, 2, 7, 3), now), "2 de jan. de 2024, 07:03");
});
