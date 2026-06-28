# 佬朋友 - LinuxDo Friends

佬朋友是一个面向 [linux.do](https://linux.do/) 的浏览器插件，用来在本地管理关注对象，并主动刷新好友状态和公开动态。

项目目标是克制地把“关注”升级成更好用的“朋友”视图：列表里看最近状态，佬友圈里看公开活动。插件不绕过 Cloudflare，不读取或导出 Cookie，不使用远程服务器代请求。

## 功能

- 管理佬朋友列表，支持手动添加和从已关注列表快速添加。
- 查看好友最近状态，例如最后发帖和最后活动。
- 查看佬友圈动态，支持按用户和活动类型筛选。
- 在 linux.do 页面内集成入口，并支持浏览器侧栏视图。
- 数据优先保存在本地浏览器扩展存储中。

## 开发

需要 Node.js 22 和 npm。

```bash
npm install
npm run dev
```

开发模式会持续构建插件文件。浏览器里加载 `dist/` 目录即可调试。

## 构建

```bash
npm run build
```

构建产物会输出到 `dist/`。

## 测试

```bash
npm test
npm run typecheck
```

## 打包插件

先构建，再打包 zip：

```bash
npm run build
npm run package-extension -- --name linuxdo-friends-v1.0.0.zip
```

zip 会输出到 `packages/`，并且 `manifest.json` 位于压缩包顶层。

## 修改版本号

发版前需要保持这几个版本号一致：

- `package.json`
- `package-lock.json`
- `public/manifest.json`

可以用脚本统一修改：

```bash
npm run set-version -- 1.0.0
```

脚本也接受带 `v` 的写法：

```bash
npm run set-version -- v1.0.0
```

## GitHub CI 发包

CI 只会在推送三段式 tag 时构建插件包：

```bash
npm run set-version -- 1.0.0
npm test
npm run build
git add package.json package-lock.json public/manifest.json
git commit -m "release v1.0.0"
git tag v1.0.0
git push origin v1.0.0
```

tag 必须匹配 `v1.0.0` 这种格式。构建完成后，GitHub Actions 会创建对应的 GitHub Release，并上传 `linuxdo-friends-v1.0.0.zip`。

## 许可证

本项目基于 MIT 协议开源，详见 [LICENSE](./LICENSE)。
