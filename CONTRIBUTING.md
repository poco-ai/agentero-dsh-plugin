# 贡献指南

`agentero-dsh-plugin` 是 Agentero 的 DeepSeek Harness 组合包。它单独成库，本地检出放在 Agentero 工作树里，方便对照 Motif 源码开发。

```text
motif/
├── deepseek-harness/      # Harness 宿主
└── agentero-dsh-plugin/   # 本仓库
```

本仓库的 Git 远程是 <https://github.com/poco-ai/agentero-dsh-plugin>。不要把这个目录提交进 Motif。

## 如何贡献

1. 从 `main` 拉出功能分支。
2. 按下面的「体验」在 `web` profile 里确认插件能加载，并能打开一篇论文。
3. 用 [Conventional Commits](https://www.conventionalcommits.org/) 写提交说明，例如 `feat: register the agentero tool`。一次提交只做一件事。
4. 推送分支，打开 Pull Request，说明改了什么、如何验证。

问题用 GitHub Issues。破坏性改动写在 PR 描述里。

## 环境要求

对照 [DeepSeek Harness 开发指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/development.md)：

- Node.js 24.9 或更新。本仓库 `engines.node` 与宿主一致。
- pnpm 11.28.5。Harness 在根 `package.json` 的 `packageManager` 里锁定这个版本。本机若已有别的 pnpm，在仓库目录里用 Corepack 启动，避免用到旧版本：

  ```sh
  corepack enable
  corepack prepare pnpm@11.28.5 --activate
  corepack pnpm --version
  ```

- Git 2.26 或更新。
- 调用模型时再准备 DeepSeek API key。只验证插件是否加载时不需要。

当前宿主源码版本见 `deepseek-harness/package.json`（检出时为 `0.2.2-alpha.3`）。本包用 `engines.dsh` 声明 `>=0.2.1-rc.5 <0.3.0`。DSH 仍在开发者预览，升级宿主后如果安装被拒绝，先收紧这个范围再重试。

## 体验

宿主仍然是上面的并列检出，供 `pnpm dsh` 启动源码版。插件自身的类型检查改用 npm 上的 `@deepseek-ai/*` 包，不再读取旁边的检出。看文献和 PDF 还需要一份已经有论文的 Agentero Vault（含 `papers/` 和 `.agentero/catalog.sqlite`），以及本仓库上层 Motif 编出来的 `agentero-cli`（0.18 及以上）。

先构建宿主、插件和 CLI：

```sh
cd motif/deepseek-harness
corepack pnpm install
corepack pnpm run build

cd ../agentero-dsh-plugin
corepack pnpm install

cd ..
cargo build -p agentero-cli
```

宿主的 `pnpm run build` 生成仓库产物，之后 `pnpm dsh` 直接使用这些产物。已经构建过就可以跳过。插件的安装不再自动构建，改完代码后运行 `corepack pnpm build` 生成四个包的 Node 入口和浏览器 client bundle。`lib/` 和 `node_modules/` 不提交。只做类型检查时运行 `corepack pnpm typecheck`；类型依赖钉在根 `devDependencies` 的 `@deepseek-ai/*` 0.2.2-alpha.3 上，升级宿主时同步改这里。

四个包把 `@deepseek-ai/cordis` 放在 `peerDependencies`。根 `package.json` 用 `workspace:^` 依赖这四个包，`pnpm publish` 会把它写成具体版本。

装进 `dsh web` 启动的那个 profile。CLI 把第一个非选项词当成 profile 名：`dsh web` 就是 `--profile web`。不要再写一遍 `--profile`，否则会报 profile 选了两次。名为 `desktop` 的 profile 只给 Electron 用，CLI 不能启动它。

```sh
cd motif/deepseek-harness
corepack pnpm dsh plugin --profile web add ../agentero-dsh-plugin
corepack pnpm dsh web --dump-config
```

`--dump-config` 里应能看到 `# == agentero-dsh`，以及 `agentero-host`、`agentero-library`、`agentero-notes`、`agentero-pdf` 四行。

Vault 可以在文献面板顶部的「选择知识库」中指定：选择已有知识库根目录并打开，DSH 会保存到当前 profile，并记住最近的目录。切换前先保存笔记，切换后页面会重新载入。CLI 路径仍可在本机 profile 配置；也可手动配置 Vault。不要把本机路径写进会提交的 `cordis.patch.yml`。编辑 `~/.dsh/profiles/web/cordis.patch.yml`（设置了 `DSH_HOME` 时是 `$DSH_HOME/profiles/web/cordis.patch.yml`）。后一层会整段替换目标行的 `config`，不会按键合并，所以两个字段写在一起：

```yaml
- id: agentero-host
  config:
    vault: /绝对路径/到/Vault
    agenteroBin: /绝对路径/motif/target/debug/agentero-cli
```

`vault` 留空时，文献和 PDF 接口返回 503 `{ "error": "vault is not configured" }`。`agenteroBin` 也可以是 PATH 上的 `agentero`，写绝对路径更稳。

启动：

```sh
corepack pnpm dsh web --no-open
```

终端出现 `[agentero] plugin loaded` 后，用它打印的 `http://127.0.0.1:3080/?token=...` 打开。进入一个会话，右侧开始页有「文献」和「笔记」。点文献表里的一行打开 PDF。只看界面时不需要 DeepSeek API key。

卸下插件：

```sh
corepack pnpm dsh plugin --profile web remove agentero-dsh
```

profile 目录不属于任何一个 Git 仓库。

## 插件在仓库里的形态

根目录是组合包，不自己导出 `apply`。`cordis.patch.yml` 按包名插入四个 loader 行：

```yaml
- insert:
    - id: agentero-host
      name: 'agentero-dsh-host'
    - id: agentero-library
      name: 'agentero-dsh-library'
    - id: agentero-notes
      name: 'agentero-dsh-notes'
    - id: agentero-pdf
      name: 'agentero-dsh-pdf'
```

每个包的 Node 入口导出 `name` 与 `apply`。带界面的包另外声明 `dsh.client.platform: web`，`exports["./client"]` 指向 `lib/client.js`。这个文件以 `window.__ModuleLoader__.load` 开头，React 和 `@deepseek-ai/dsh-client-*` 保持为外部 `require()`。

Host 的 Node 插件名是 `agentero-host`。它读取可选配置 `vault`（默认 `""`）、`agenteroBin`（默认 `"agentero"`）和 `agenteroSettings`（默认 `$XDG_CONFIG_HOME/agentero/settings.json`），并在加载时打印 `[agentero] plugin loaded`。`vault`、`agenteroBin`、`recentVaults` 是 `.volatile()` 字段，运行时通过 `Volatile.get()` 读取，所以 Plugins 页保存后立即生效，不需要重挂载。浏览器入口提供名为 `agentero` 的服务。Host 在 `/agentero/api` 下提供论文列表、PDF 字节、标注，以及 `<vault>/notes` 的笔记列表和文件读写。`PUT` 还可以写 `papers/<id>/NOTES.md`。文献面板列出论文。笔记面板列出并编辑 `notes/`，并填进 PDF 右侧的论文笔记槽。PDF 面板用 EmbedPDF / PDFium 阅读；划词得到的选区坐标由 Host 直接写入 `marks/`，与桌面端共用同一套标注格式。它注册两个资源地址：vault 内的 `*.pdf` 文件，以及用论文目录表示的 `dsh-resource://agentero-paper/<论文目录>`。文献库点一行走后者，因为右侧标签页跨刷新只保留地址，不保留导航参数。Host 另外提供 `GET /agentero/api/pdfium.wasm`。

Host 只调用 Agentero CLI 0.18 起的命令目录（`paper` / `annotation` / `file` / `vault`）。成功时 stdout 直接是 JSON 文档，失败时 stderr 是 `{ error: { code, message, hint } }`，列表命令按 `--limit` 和 `--cursor` 分页。适配层分三处：`cli-run.ts` 负责调用、错误解析和翻页，`catalog.ts` 对应单条命令，`paper-list.ts` 负责文献列表——`paper list` 只带标题、阅读状态、标签和 revision，作者与年份由每篇一次 `paper get` 补全并按 revision 缓存；改已读状态要带上列表里的 revision（`paper update --if-revision`）。这些纯逻辑的测试在 `packages/host/tests/cli.test.ts`。`cli-install.ts` 把 CLI 装到与桌面端相同的 `<data>/Agentero/cli/v-<版本>/`，二进制旁边必须保留同一压缩包里的 PDFium，文本定位靠它加载。

设置页在 `packages/host/src/client/settings.tsx`，同时注册到 Settings 的 `settings.section`（导航名 `Agentero`）和插件详情页的 `plugins.row.config`（key 为 `agentero-dsh#agentero-host`）。两个入口共用 `AgenteroSettings` 与同一个 `AgenteroSettingsModel`；插件页的 summary 仅显示摘要，page 显示完整表单，不使用 owner 提供的通用 form。插件页契约通过 `@deepseek-ai/dsh-client-ui-plugin-manager/client` 的 type-only import 引入，注册由 `ctx.slots.inject` 管理生命周期。CLI 字段通过 `ctx.configForms.get('agentero-host')` 走 dsh 的配置表单，`settings-model.ts` 负责草稿和保存；知识库走会校验目录的 `PUT /agentero/api/vault`，成功后刷新页面。文献面板只读取当前知识库，不再提供切换器。`packages/host` 单独配置了 shadcn（`components.json`，别名 `@/*` 指向 `src/client/*`）；新增原子组件可以 `cd packages/host && npx shadcn@latest add <name>`，也可以照 `src/client/ui/` 现有写法手写。其他面板各自维护自己的组件。

生效配置从空根开始，按这个顺序叠层：

1. profile 的 `dsh.profile.bundles`，先是 `@deepseek-ai/dsh-base`，再是后安装的组合包。
2. profile 自己的 `cordis.patch.yml`。
3. `$DSH_HOME/cordis.patch.yml`。
4. 命令行上的每个 `--patch`。

后应用的层按行覆盖。patch 会替换目标行的整个 `config`，不会按键深度合并。

## 日常改代码

1. 改对应包的 `packages/<name>/src/`。
2. 在本仓库运行 `corepack pnpm build`。
3. 重启 `corepack pnpm dsh web --no-open`。

只改 profile 或 home 的 `cordis.patch.yml` 里已有行的 `config` 时，Cordis 会热替换该插件。`vault`、`agenteroBin`、`recentVaults` 是 volatile 字段，改它们只会更新运行中的引用，不会重挂载。组合包的安装和移除要重启进程后才生效。

临时用绝对路径加载 TypeScript、不经过 `lib/` 时，在本仓库写一份不提交的 `dev.patch.yml`：

```yaml
- insert:
    - id: agentero-host
      name: '/绝对路径/motif/agentero-dsh-plugin/packages/host/src/index.ts'
```

然后：

```sh
cd motif/deepseek-harness
corepack pnpm dsh web --patch ../agentero-dsh-plugin/dev.patch.yml --no-open
```

这条路径只用于冒烟。要安装、分发的仍然是声明了 `dsh.bundle` 的组合包。

## 发布到 npm

插件按产物分发：发布时构建，用户装到的是 `lib/`，安装阶段不执行构建脚本，也不需要 `allowBuilds`。

发布由 GitHub Actions 完成：推送 `v*` 标签后，`.github/workflows/release.yml` 会安装依赖、做类型检查、构建、校验标签与六个包的版本一致，然后按拓扑顺序先发子包、再发根包。仓库或组织的 Actions secrets 里需要有 `NPM_TOKEN`，它来自有这几个包发布权限的 npm 账号。

发版步骤：

```sh
corepack pnpm bump 0.1.2
git add package.json pnpm-lock.yaml packages/*/package.json
git commit -m "chore(release): v0.1.2"
git tag v0.1.2
git push origin main --tags
```

`bump` 会把根包和四个子包的版本一起改掉。带预发布后缀的版本（如 `0.1.1-beta.1`）会自动发到 `next` dist-tag，正式版发到 `latest`。

npm 对非交互发布启用了 staged publishing：CI 上传成功只代表版本进了暂存队列，不会直接上线；未批准的版本显示为 `0.0.0-stage`，不能安装。上传后需要维护者在本地用 2FA 批准：

```sh
npx npm@latest stage list
npx npm@latest stage approve <stage-id>
```

本地 npm 需要 11.15.0 或更新才有 `npm stage`（当前检出环境是 11.13，所以用 `npx npm@latest`），也可以在 npmjs.com 的包页面批准。六个包都要批。

本地手动发布（备用）：

```sh
npm login --registry=https://registry.npmjs.org
corepack pnpm release
```

`npm publish` 只认 `--otp`。账号开了 2FA 时把验证码通过 `npm_config_otp` 传进去，例如 `npm_config_otp=123456 corepack pnpm release`。

这些包不带 scope，可以直接由个人 npm 账号发布，包名在 npm 上全局唯一，六个包分别是：

| 包 | 用途 |
| --- | --- |
| `agentero-dsh` | 组合包，声明 `dsh.bundle` |
| `agentero-dsh-host` | Host 与设置页 |
| `agentero-dsh-library` | 文献库面板 |
| `agentero-dsh-notes` | 笔记面板 |
| `agentero-dsh-pdf` | PDF 面板 |

用户安装：

```sh
dsh plugin --profile web add agentero-dsh
```

不要再从 `github:` 安装：Git 安装拿到的是源码，pnpm 会拦截 `prepare`，而用户 profile 里的 `allowBuilds` 键带有 commit hash、每次推送都会失效。npm 包里已经包含构建产物。

## 提交时不要带上

- `node_modules/`
- `lib/`
- `dev.patch.yml`（里面是本机绝对路径）
- API key、`.env`、profile 目录

发布前先运行 `corepack pnpm build`，让四个包的 `lib/` 进入各自的 npm 包；`lib/` 仍然不提交。根包只携带 `cordis.patch.yml`，四个子包通过 `dependencies` 装进 profile。
