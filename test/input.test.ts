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

test("each image failure reports only the rule that was violated", () => {
  const image = { name: "one.png", mimeType: "image/png", data: "aGVsbG8=" };
  const cases: [() => unknown, string][] = [
    [() => validateImageCount(6), "最多带入 5 张图片"],
    [() => validateImageBytes(inputLimits.imageBytes + 1), "单张图片不能超过 10 MiB"],
    [() => validateImageFile({ type: "image/svg+xml", size: 10 }), "不支持此图片格式"],
    [() => validateImages([{ ...image, mimeType: "image/svg+xml" }]), "不支持此图片格式"],
    [() => validateImageBytes(0), "图片为空，请重新选择"],
    [() => validateImages([{ ...image, data: "" }]), "图片为空，请重新选择"],
    [() => validateImages([{ ...image, data: "!@#$" }]), "图片数据无效，请重新选择"],
    [() => validateImages([{ ...image, data: "a".repeat(Math.ceil(inputLimits.imageBytes / 3) * 4 + 4) }]), "单张图片不能超过 10 MiB"],
    [() => validateImagePixels(0, 10), "图片无法识别，请重新选择"],
    [() => validateImagePixels(4097, 4096), "图片像素过多，请缩小后重试"],
  ];
  for (const [check, message] of cases) assert.throws(check, { message });
});

test("empty, invalid and oversized text have distinct messages", () => {
  assert.throws(() => validateText(" "), { message: "请输入内容" });
  assert.throws(() => validateText(null), { message: "文字内容无效，请重新输入" });
  assert.throws(() => validateText("a".repeat(inputLimits.textCharacters + 1)), { message: "文字不能超过 32000 字" });
});
