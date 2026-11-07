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
const imageError = "最多带入 5 张图片，每张不超过 10 MiB，支持 PNG、JPEG、WebP 和 GIF";

export function validateImageCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > inputLimits.images)
    throw new Error("最多带入 5 张图片");
}
export function validateText(text: unknown, imageCount = 0): asserts text is string {
  if (
    typeof text !== "string" ||
    text.length > inputLimits.textCharacters ||
    (!text.trim() && !imageCount)
  )
    throw new Error("请输入内容（最多 32000 字）");
}
export function validateImageBytes(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > inputLimits.imageBytes)
    throw new Error(imageError);
}
export function validateImagePixels(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > inputLimits.imagePixels
  )
    throw new Error("图片为空或像素过大");
}
export function validateImageFile(file: { type: string; size: number }): void {
  if (!imageTypes.includes(file.type)) throw new Error(imageError);
  validateImageBytes(file.size);
}
export function validateImages(value: unknown): asserts value is ImageInput[] {
  if (!Array.isArray(value)) throw new Error(imageError);
  validateImageCount(value.length);
  for (const image of value) {
    if (
      !image ||
      typeof image !== "object" ||
      typeof image.name !== "string" ||
      !imageTypes.includes(image.mimeType) ||
      typeof image.data !== "string" ||
      image.data.length > Math.ceil(inputLimits.imageBytes / 3) * 4 ||
      image.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)
    )
      throw new Error(imageError);
    const padding = image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0;
    validateImageBytes((image.data.length / 4) * 3 - padding);
  }
}
