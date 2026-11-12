import type { ImageInput } from "./types.ts";

export const inputLimits = {
  textCharacters: 32000,
  images: 5,
  imageBytes: 10 * 1024 * 1024,
  imagePixels: 16 * 1024 * 1024,
  messages: 200,
  conversationBytes: 32 * 1024 * 1024,
} as const;
const imageTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const invalidImage = "图片数据无效，请重新选择";
const unsupportedImage = "不支持此图片格式";
const largeImage = "单张图片不能超过 10 MiB";

export function validateImageCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("图片数量无效");
  if (count > inputLimits.images) throw new Error("最多带入 5 张图片");
}
export function validateText(text: unknown, imageCount = 0): asserts text is string {
  if (typeof text !== "string") throw new Error("文字内容无效，请重新输入");
  if (text.length > inputLimits.textCharacters) throw new Error("文字不能超过 32000 字");
  if (!text.trim() && !imageCount) throw new Error("请输入内容");
}
export function validateImageBytes(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(invalidImage);
  if (bytes === 0) throw new Error("图片为空，请重新选择");
  if (bytes > inputLimits.imageBytes) throw new Error(largeImage);
}
export function validateImagePixels(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("图片无法识别，请重新选择");
  if (width * height > inputLimits.imagePixels) throw new Error("图片像素过多，请缩小后重试");
}
export function validateImageFile(file: { type: string; size: number }): void {
  if (!imageTypes.includes(file.type)) throw new Error(unsupportedImage);
  validateImageBytes(file.size);
}
export function validateImages(value: unknown): asserts value is ImageInput[] {
  if (!Array.isArray(value)) throw new Error(invalidImage);
  validateImageCount(value.length);
  for (const image of value) {
    if (
      !image ||
      typeof image !== "object" ||
      typeof image.name !== "string" ||
      typeof image.mimeType !== "string" ||
      typeof image.data !== "string"
    )
      throw new Error(invalidImage);
    if (!imageTypes.includes(image.mimeType)) throw new Error(unsupportedImage);
    if (image.data.length > Math.ceil(inputLimits.imageBytes / 3) * 4) throw new Error(largeImage);
    if (!image.data.length) throw new Error("图片为空，请重新选择");
    if (
      image.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)
    )
      throw new Error(invalidImage);
    const padding = image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0;
    validateImageBytes((image.data.length / 4) * 3 - padding);
  }
}
