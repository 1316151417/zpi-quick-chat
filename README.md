# ZPI Quick Chat

ZPI Quick Chat 是 Apple Silicon Mac 上的 DeepSeek 聊天浮窗。按 **Option + Space**，就能在当前应用上方提问。读外文时可以带入选中的一句话，遇到报错时可以截取屏幕上的一小块；看完回答，收起浮窗就能继续手头的事。

[官网](http://zjyo.cn/zpi/?product=zpi-quick-chat) · [交互演示](http://zjyo.cn/zpi/demo.html?app=zpi-quick-chat&autoplay=1) · [使用手册](http://zjyo.cn/zpi/manuals/zpi-quick-chat/index.html)

## 快速开始

需要 **Apple Silicon Mac（macOS arm64）**、**Node.js 24.x** 和自己的 **DeepSeek API Key**。在 macOS 默认的 zsh 终端运行：

```zsh
read -rs 'DEEPSEEK_API_KEY?DeepSeek API Key: '; echo
export DEEPSEEK_API_KEY
npx @zpi-dev/quick-chat
```

第一行会提示输入密钥，粘贴后按回车即可，密钥不会回显。如果当前终端已经导出了 `DEEPSEEK_API_KEY`，只需运行最后一行。保持终端开着，按 **Option + Space** 叫出输入条，直接打字即可，无需授予截图权限。

**试一次选区翻译：** 在原应用选中一句英文，按 **Option + Shift + C**。原文会出现在浮窗草稿里，**不会自动发送**。补上「翻译成自然中文」，按 **Enter** 查看回答。再按 **Option + Space** 收起浮窗；下次叫出时还能接着追问。

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 显示 / 隐藏浮窗 | Option + Space |
| 清空当前会话并新建对话 | Option + Shift + Space |
| 把原应用的选中文字带入草稿 | Option + Shift + C |
| 把剪贴板中的文字或图片带入草稿 | Option + Shift + V |
| 选择屏幕区域，将截图带入草稿 | Option + Shift + A |
| 发送 / 在草稿中换行 | Enter / Shift + Enter |
| 停止生成；空闲时隐藏浮窗 | Esc |

自动复制选区需要 macOS 的**辅助功能**权限；不想授权时，可以先手动复制，再用剪贴板快捷键带入。区域截图需要**屏幕录制**权限。发送前请检查草稿，移除不想交给模型的文字或图片。

## 工具与会话

- **联网搜索**和**本机工具**默认关闭，只能在新对话首次发送前切换。本机工具包括 `Read` 和 `Bash`，默认工作目录是用户主目录；启用后，命令可以用当前用户的权限修改文件。工具返回的内容也可能发给模型。
- **隐藏不等于退出。** 隐藏浮窗会保留当前对话，也不会停止正在生成的回答。会话仅保存在内存中；新建对话或在启动终端按 `Ctrl+C` 退出前，请先复制需要保留的内容。

## 从源码运行

在 Apple Silicon Mac 上准备好 Node.js 24.x 和 Xcode Command Line Tools（构建原生组件需要 `xcrun` 和 `clang`）。在仓库根目录、已导出 `DEEPSEEK_API_KEY` 的终端中运行：

```sh
npm ci
npm run build
npm start
```

开发检查：`npm run check` 做 TypeScript 类型检查，`npm test` 运行单元测试，`npm run test:desktop` 运行桌面交互测试。
