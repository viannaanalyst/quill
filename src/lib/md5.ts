/** MD5 em texto hexadecimal (usado só para o endereço do Gravatar, que pede o e-mail nesse formato). */
export function md5(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const n = (((bytes.length + 8) >>> 6) + 1) * 16;
  const words = new Uint32Array(n);
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  words[n - 2] = bytes.length * 8;
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let i = 0; i < n; i += 16) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let j = 0; j < 64; j++) {
      let f: number, g: number;
      if (j < 16) [f, g] = [(b & c) | (~b & d), j];
      else if (j < 32) [f, g] = [(d & b) | (~d & c), (5 * j + 1) % 16];
      else if (j < 48) [f, g] = [b ^ c ^ d, (3 * j + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * j) % 16];
      const tmp = d;
      d = c;
      c = b;
      const x = (a + f + K[j] + words[i + g]) >>> 0;
      const s = S[(j >> 4) * 4 + (j % 4)];
      b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0;
      a = tmp;
    }
    [a0, b0, c0, d0] = [(a0 + a) >>> 0, (b0 + b) >>> 0, (c0 + c) >>> 0, (d0 + d) >>> 0];
  }
  return [a0, b0, c0, d0].map((v) => Array.from({ length: 4 }, (_, i) => ((v >>> (i * 8)) & 0xff).toString(16).padStart(2, "0")).join("")).join("");
}
