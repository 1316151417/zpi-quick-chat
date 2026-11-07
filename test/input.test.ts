import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inputLimits,
  validateImageBytes,
  validateImageCount,
  validateImageFile,
  validateImagePixels,
  validateImages,
  validateText,
} from "../src/input.ts";

test("shared limits validate text and supported image transport before native decoding", () => {
  validateText("hello");
  validateText("", 1);
  assert.throws(() => validateText(" "), /请输入/);
  assert.throws(() => validateText("x".repeat(inputLimits.textCharacters + 1)), /32000/);
  const image = { name: "one.png", mimeType: "image/png", data: "aGVsbG8=" };
  validateImages([image]);
  validateImageCount(5);
  validateImageBytes(inputLimits.imageBytes);
  validateImagePixels(4096, 4096);
  for (const value of [
    null,
    {},
    [null],
    [{ ...image, data: "a" }],
    [{ ...image, data: "!=== " }],
    [{ ...image, mimeType: "image/svg+xml" }],
    Array(6).fill(image),
  ])
    assert.throws(() => validateImages(value), /图片/);
  assert.throws(() => validateImageFile({ type: "image/svg+xml", size: 10 }), /图片/);
  assert.throws(() => validateImageFile({ type: "image/png", size: 0 }), /图片/);
  assert.throws(() => validateImageBytes(inputLimits.imageBytes + 1), /图片/);
  assert.throws(() => validateImagePixels(4097, 4096), /像素/);
  assert.throws(() => validateImagePixels(0, 10), /图片/);
});
