# Agent Note: WorkBuddy 共用资料空间开源项目选型报告

Status: proposed

[English](2026-11-12-workbuddy-library-platform-selection.md) | 中文

## Problem

deepseek-harness 需要类似 WorkBuddy 的共用资料空间：成员在空间中管理目录、独立上传的文件和在线文档，通过账号控制访问，在对话中选择资料，并让 agent（智能体）读取、创建和修改资料。初期规模为几十到几百份，部署目标为内网服务器 `172.24.126.12`。

[账号绑定的共用资料空间方案书](2026-11-10-account-bound-shared-library.zh.md)选择了 Outline，但它把上传文件作为文档附件，并将聊天资料选择器排除在本期之外。这两项削弱了对 WorkBuddy 的复刻。本报告重新比较基础项目；原方案中有价值的账号需求和 Outline 飞书登录实验记录继续保留，产品选型与补齐范围以本报告为当前建议，仍待用户审核。

本次范围不包含 RAG、向量检索、OCR 或自动知识加工。多人同时编辑、复杂块文档、PDF 导出、完整 Office 在线编辑和精细到子目录的授权均未作为第一版硬性要求，也不把候选产品额外提供的这些能力加入项目范围。

## Proposal

### 结论与推荐顺序

**推荐 OpenCloud 作为第一版共用资料空间的基础，固定评估稳定版 7.2.5；Seafile + SeaDoc 为第二候选，Wiki.js 3.x 为第三候选。** OpenCloud 最贴合本次已经明确的“空间、成员、目录、独立文件、基本在线文档”组合。它仍需开发 Harness 账号接入、聊天资料选择器和 agent 读写适配，不能直接安装后就称为完整复刻。

OpenCloud 主仓库有 **6,314 stars**，Web 仓库只有 **300 stars**。它达到了数千关注量，但没有达到一万；推荐依据是功能匹配度和当前维护情况。若把“一万 stars 以上”追加为硬门槛，它不满足。Seafile 主仓库虽然有 15,451 stars，其 SeaDoc 编辑器和服务端分别只有 15、2 stars，同样不能用主仓库数字替代文档组件的成熟度。

| 顺位 | 项目与技术栈 | 为什么进入最终候选 | 主要代价 |
|---|---|---|---|
| 1 | [OpenCloud](https://github.com/opencloud-eu/opencloud)，Go；[Web](https://github.com/opencloud-eu/web)，Vue / TypeScript | 原生共享空间和成员角色；文件、目录、Markdown 文档使用同一套组织和权限；有 Graph 与 WebDAV | 文档编辑较简单；稳定版不承诺实时协同；飞书与 Harness 适配待开发 |
| 2 | [Seafile](https://github.com/haiwen/seafile) + [SeaDoc](https://github.com/haiwen/seadoc-editor)，C / Python / React / Node.js | 资料库、独立文件和富文档组合更接近 WorkBuddy；文件管理成熟 | SeaDoc 社区小；块写入接口的版本组合、并发和落盘语义需要验证 |
| 3 | [Wiki.js](https://github.com/requarks/wiki)，Node.js / TypeScript / Vue | 文档、目录、独立资源文件；API / MCP 和页面版本检查较方便 | 3.x 是新架构；共享空间需目录与用户组映射；路径链接在移动后可能失效 |

### WorkBuddy 对照基线

参考目录 `E:\Project\workbuddy-5.9.3-src` 是安装包解包树，包含资料库技能、客户端入口和调用脚本；资料库完整主界面从远程加载，服务端实现不在该目录。因此有依据复刻行为，没有可直接部署的完整 WorkBuddy 资料库服务端源码。

| 已确认的行为 | 参考位置，相对于 WorkBuddy 目录 | 对选型的要求 |
|---|---|---|
| 空间拥有成员和角色，目录树组织资料 | `resources/plugins/workbuddy-builtin/skills/library/manage/entry.md` | 空间级成员授权和目录 |
| 上传文件是独立的 `kind=drive` 节点，替换内容保留节点和链接 | `resources/plugins/workbuddy-builtin/skills/library/drive/entry.md` | 文件不能只能作为文档附件；引用不能只依赖路径 |
| 文档附件与独立文件分开处理 | `resources/plugins/workbuddy-builtin/skills/library/attachment/entry.md` | 不能把“支持附件上传”等同“支持独立文件管理” |
| 在线文档可读、可新建、可修改，新建接受 Markdown | `resources/plugins/workbuddy-builtin/skills/library/doc/tasks/read_create.md`、`doc/tasks/text_block_edit.md` | 第一版需要基本编辑和 agent 读写；完整块编辑需另评估 |
| 对话中可展开空间、目录并多选资料 | `renderer/assets/space-library-picker-J0ZX7Dk-.js` | Harness 需要原生资料选择器 |
| 导出文档为 Markdown、数据库为 CSV、网页为 HTML | `resources/plugins/workbuddy-builtin/skills/library/export/entry.md` | 没有据此确认文档 PDF 导出；PDF 导出不构成当前淘汰条件 |

### 调查方法和证据限制

本轮比较 24 个产品或产品组合，检查官方仓库、维护状态、许可、部署文档、权限文档及关键 API 源码。表中 stars 来自 2026-11-12 的 GitHub API 快照；维护日期指仓库最近 push，可能包含机器人和依赖更新，不等同持续人工维护。只对少数关键实现做了源码检查，未逐个安装全部产品。

结论区分三个层次：官方文档声明的功能、固定版本源码支持的行为、本机实际请求结果。飞书单点登录、Desktop 内嵌、浏览器编辑体验及备份恢复仍需专门验证；旧方案中 Outline 的飞书登录成功不能外推到其他系统。候选没有官方文档明确承诺的能力，不按名称或宣传图推断。

### 为什么选择 OpenCloud

OpenCloud 的 Space 是共同持有的资料空间，成员可以拥有 can view、can edit、can manage 角色。空间中直接放目录、PDF、Office 文件、图片和 Markdown 文档，不必为每个上传文件先建一篇说明文档。基本空间角色属于公开项目能力，未发现需要商业授权才能启用的限制；删除整个 Space 仍需要全局 Admin 或 Space Admin。

稳定版 Web 7.1.6 的文本编辑器使用 Tiptap，官方 7.2 文档列出标题、列表、图片、表格和代码块；内容保存为普通 Markdown 文件。这让第一版 agent 可以读取文本，并基于已读取版本修改文件，不需要自己维护一套块文档引擎。编辑器声明的大小上限为 2,000,000 字节，这是在线文本编辑限制，不是所有上传文件的大小上限。

WebDAV 提供资源 ID、私有链接、etag 和条件写入基础；Graph 提供空间及成员管理。Harness 可以围绕资源 ID 建资料引用，而不把文件路径当永久身份。上传、替换、同空间移动和重命名的连续性必须通过固定版本测试；跨空间移动另行定义，不承诺保持原 ID。

服务端许可为 Apache-2.0，Web 为 AGPL-3.0；如分发或修改 Web，需要遵守相应源码义务。稳定版 7.2.5 于 2026-11-11 发布，包含 Web 7.1.6；9.1.0 明确标为 rolling。官方 Yjs 协同编辑文档属于 rolling / unreleased 内容，不能当作 7.2.5 的稳定能力；额外长期回补维护的 LTS 服务需要订阅。

### 三个候选的实际取舍

| 维度 | OpenCloud 7.2.5 | Seafile + SeaDoc | Wiki.js 3.x |
|---|---|---|---|
| 空间与成员 | 原生 Spaces，查看 / 编辑 / 管理 | 社区版支持资料库级用户、组只读 / 读写；子目录级联权限属于 Pro | 用户组及站点 / 路径规则；需自行映射空间 |
| 独立上传文件 | 有，与目录和文档放在同一空间 | 有，与 `.sdoc` 文档放在同一资料库 | 有，资源文件和页面可在目录中组织 |
| 在线文档 | 基本 Markdown 可视化编辑 | 更接近 WorkBuddy 的富文档 / 块编辑 | Markdown / 富文本页面及独立的 LiveNotes 模式 |
| Agent 读取与修改 | Graph + WebDAV，需 Harness 适配 | 文件 API + SeaDoc 接口，需验证兼容版本与写入语义 | REST / PAT / MCP，页面更新有版本检查 |
| 稳定引用 | 同空间覆盖、重命名和移动保持 ID 已实测；私链跳转未测 | 有 UUID / Smart Link；连续性待测试 | 页面和资源有 ID；正文内路径链接在移动后可能失效 |
| 当前最应注意的问题 | 基本文档能力不等于完整块文档；前端社区较小 | 大 stars 不代表 SeaDoc 社区成熟 | 3.0 于 2026-11-01 发布；29k stars 包含旧架构积累 |
| 账号互通 | 标准 OIDC；飞书未验证 | OAuth 配置；飞书未验证 | OIDC；飞书未验证 |

SeaDoc 的 `POST /api/v1/docs/:doc_uuid/element-commands` 可以插入、删除和替换块，但此次查到它存在于 sdoc-server 3.0.9，Seafile 13 官方部署文件仍使用 `sdoc-server:2.0-latest`。该路由没有 expected-version 条件，源码在更新内存文档后返回成功，数据库操作记录异步保存。不能直接把它当作默认安装可用、可安全并发且返回成功就已持久化的 agent 写接口；需要固定兼容组合并补验证或适配。

Wiki.js 的接口与 MCP 对 agent 较方便，但站点需要独立主机名，不能直接把每个 `/space-a` 目录等同一个站点。若采用目录加用户组来模拟空间，需要自己维护映射。它的 MCP 二进制上传有大小限制，PDF / Office 文件工具提供的元信息和链接也不等于可读取正文；这些不能计为 Harness 已具备的文件理解能力。

### Harness 需要补齐的部分

| 工作项 | 复用内容 | 本仓库需要实现的行为 |
|---|---|---|
| 资料库入口 | OpenCloud Web | 侧边栏入口，限制网页导航和权限；先验证内嵌所需的 CSP / 登录跳转 |
| 账号绑定 | 现有飞书账号、外部系统 OIDC | 显式关联 Harness 用户与资料库用户；不能用邮箱或显示名自动合并账号 |
| 聊天选资料 | 现有 [UI reference](../../../../packages/client/ui-reference/README.zh.md) | 列出当前账号能访问的空间与目录，多选、插入引用，打开原资料 |
| Agent 读写 | Graph / WebDAV | 当前用户身份列出、读取、新建和条件更新；首次先支持 Markdown / 文本及原文件上传下载 |
| 固定引用 | 资源 ID / etag | 保存服务实例、空间 ID、资源 ID 与读取版本；路径和标题仅作显示 |
| 账号切换 | 现有 [飞书账号](../../../../packages/credentials/feishu-account/README.zh.md) | 停止旧账号请求、隔离凭据、清空当前资料列表及预览；旧会话中的已记录正文仍属于历史数据 |
| 凭据保存 | 宿主凭据能力 | 按服务实例和用户隔离令牌；不把共享管理员令牌配置给所有 agent |

当前飞书账号以 `union_id` 标识用户，飞书 `open_id` 具有应用范围，不能把两个应用的 `open_id` 或它与 `union_id` 直接相等比较。OpenCloud 能接标准 OIDC，不代表飞书的 OAuth 接口可以原样接入；必要时需要标准身份提供方或小型登录适配，验证前不承诺“一次扫码后完全无感”。

现有自定义 HTTP MCP 连接器的 `headers` 保存在连接器配置中，不能沿用旧方案“填入 API key 就自动安全保存”的表述。此次应提供按用户隔离的凭据引用和退出处理；清除网页登录 cookie 不会自动撤销 API 令牌。agent 必须使用当前用户权限，后台也必须检查权限，不能靠隐藏菜单实现访问控制。

真正发送给模型的资料内容及版本需要记录到 Session，保证重放使用当时读到的内容；历史会话不能在重放时静默读取最新资料。任意二进制文件的上传下载、浏览器预览和模型读取正文是三件不同的事，第一版不能因为能下载 PDF 或 Office 就宣称 agent 能编辑其正文。

### 部署建议与实施顺序

目标服务器仍为 `172.24.126.12`，资料由服务端管理；`\\172.24.126.12\worksapce\lc-camera-agent` 可以作为部署资料交付位置，但不能让普通 SMB 用户直接读写服务端受保护的数据目录，否则会绕过账号权限。实际系统、容器支持、域名、TLS、存储卷和备份位置需在部署阶段检查。

| 阶段 | 交付结果 | 完成条件 |
|---|---|---|
| 1. 固定版本验证 | OpenCloud 7.2.5 隔离环境；记录配置与兼容版本 | 文件权限、ID 连续性、条件写入、网页编辑和账号登录通过；不靠 rolling 功能补齐 |
| 2. 服务器资料空间 | 正式受保护存储、成员、访问地址和备份 | 两名成员与一名非成员验证权限；恢复备份能打开原资料和引用 |
| 3. Harness 接入 | 资料库入口、账号关联、聊天选择器、agent 文本读写 | 当前账号的页面、选择器和 agent 使用同一份资料及相同权限 |

### 本机验证记录

本轮启动了 WSL Docker 中的隔离临时实例，固定镜像为 `opencloudeu/opencloud:7.2.5`，仅监听本机回环地址，使用一次性测试账号；没有连接目标服务器或使用现有资料。本机验证只用于补充产品选型证据，不代替正式部署验收。

| 检查 | 实际结果 |
|---|---|
| 创建空间、读取角色、添加成员 | 创建返回 201；读取权限及添加只读 / 编辑成员返回 200 |
| 只读成员读取和覆盖 | GET 200；PUT 403，拒绝写入 |
| 非成员直接读取文件 | GET 404，未取得正文 |
| 编辑成员按当前版本保存 | 带当前 `If-Match` 的 PUT 204，正文更新 |
| 使用旧版本覆盖 | PUT 412，已保存正文保持不变 |
| 覆盖、重命名、同空间移动 | `oc:id` 和 `oc:fileid` 保持；覆盖后 etag 改变 |
| 创建目录 | 首次 MKCOL 201 |
| 重启持久性 | 未验证：临时启动脚本重跑初始化，因已有配置而退出；未据此判断产品持久化能力 |

固定版本的空间成员接口实际在 `/graph/v1beta1`，创建空间在 `/graph/v1.0`；邀请需使用接口返回的角色 GUID，不能直接提交显示名称。最初的上传 500 来自测试配置中外部端口与容器内部回调地址不一致；启动初期的 401 来自内部 LDAP 尚未就绪。更正 API 测试访问地址并等待就绪后，上表检查通过；该临时配置不能原样用于网页或正式部署。

临时容器已停止并删除，下载镜像保留。原始请求、ID 快照与测试摘要保存在忽略的 `tmp/shared-library-platform-research/`。本轮没有验证网页编辑、浏览器登录、飞书 / OIDC、账号切换、二进制预览、跨空间移动、私链跳转、正式存储卷或备份恢复。

## Alternatives considered

### 全量筛选

下表的维护日期按 UTC 记录 GitHub 最近 push；“活跃”只表示近期存在代码仓库活动。保留有直接官方来源的淘汰原因，避免把个人笔记、文件网关、文档编辑器和共享资料产品混为一类。

| 项目 | Stars 与维护快照 | 技术或定位 | 不作为首选的原因 |
|---|---|---|---|
| [Seafile + SeaDoc](https://github.com/haiwen/seafile) | 主仓库 15,451；server 549、Seahub 610、SeaDoc editor 15、sdoc-server 2；各组件 11-11 / 11-12 有 push | C / Python / React / Node.js | 保留第二候选；富文档更强，SeaDoc 版本组合和 agent 写入风险更大 |
| [Wiki.js](https://github.com/requarks/wiki) | 29,260；11-11 | TypeScript / Node.js / Vue | 保留第三候选；新架构和空间映射成本 |
| [Cloudreve](https://github.com/cloudreve/Cloudreve) | 28,957；10-20 | Go / React 文件管理 | 独立文件强；OIDC、团队共享目录与相关权限需要 Pro；接受商业授权时可作文件管理备选，文档组合及 agent 接入仍待验证 |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | 74,473；11-12 | TypeScript 文档 / 白板工作区 | 独立上传文件树不明确；自托管免费席位和企业许可限制；稳定 MCP 写能力不能按开发版宣传计算 |
| [Docmost](https://github.com/docmost/docmost) | 22,312；11-12 | TypeScript 团队文档 | 空间与编辑体验好，但文件偏附件，API / SSO 商业限制增加接入成本 |
| [Outline](https://github.com/outline/outline) | 41,239；11-12 | TypeScript 团队文档 | 已验证飞书登录值得保留，但独立文件这一核心缺口不应靠继续扩展附件来弥补 |
| [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | 客户端 78,756；11-02；旧 Cloud 2,009，已归档 | Flutter / Rust 工作区 | 不能把客户端 stars 等同可自部署服务端；当前服务端转向商业发行，免费席位受限，需另审授权和集成成本 |
| [SiYuan](https://github.com/siyuan-note/siyuan) | 47,193；11-12 | Go / TypeScript 笔记 | 主要是个人工作空间；OIDC 管理访问不等于多成员共享空间权限 |
| [TriliumNext](https://github.com/TriliumNext/Trilium) | 38,875；11-12 | Node.js 个人知识库 | 个人笔记定位，团队账号和空间不是现成基础 |
| [Anytype](https://github.com/anyproto/anytype-ts) | 9,079；11-10 | 本地优先 / P2P / 端到端加密 | 集中服务器管理和 agent 统一访问的实现方式不匹配；还需审查客户端许可 |
| [CryptPad](https://github.com/cryptpad/cryptpad) | 8,071；11-10 | JavaScript 团队网盘 / 加密协作文档 | 文件和富文档组合合适；端到端加密的密钥管理与 agent 自动读写接入尚未确认，不优于 OpenCloud |
| [La Suite Docs](https://github.com/suitenumerique/docs) + [Drive](https://github.com/suitenumerique/drive) | Docs 16,986、Drive 482；11-10 / 11-11 | Django / React 文档与文件两个项目 | 需要拼接两个产品的账号、目录与引用；不能以 Docs stars 代表 Drive 成熟度 |
| [Colanode](https://github.com/colanode/colanode) | 5,200；最近 push 为 04-03 | TypeScript 共享空间 / 页面 / 文件 | 产品结构接近，但维护间隔约七个月、Web 仍偏早期，不优于当前候选 |
| [Filestash](https://github.com/mickael-kerjean/filestash) | 14,892；11-11 | Go / JavaScript 文件网关 | 文件接入强，团队身份和 RBAC 有商业限制，共享文档工作区仍需补齐 |
| [Pydio Cells](https://github.com/pydio/cells) | 2,258；11-11 | Go 文件协作 | 当前 Cells 不是 PHP；关注量较小，OIDC / SSO 商业限制，无明显优势 |
| [ownCloud oCIS](https://github.com/owncloud/ocis) | 2,188；11-12 | Go / TypeScript 文件协作 | 不是旧 PHP ownCloud；结构合适，但本轮 OpenCloud 维护与关注度更有吸引力 |
| [OpenList](https://github.com/OpenListTeam/OpenList) | 25,588；11-12 | Go 存储聚合 | 以挂载和聚合多种存储为主，不能等同在线文档与团队空间产品 |
| [File Browser](https://github.com/filebrowser/filebrowser) | 35,854；已归档 | Go 文件管理 | 已停止正常维护，不因 stars 高而选择 |
| [FileBrowser Quantum](https://github.com/gtsteffaniak/filebrowser) | 9,132；11-12 | Go 文件管理 | OIDC / 文件权限可用，但稳定资源身份和共享在线文档组合仍未充分确认 |
| [SFTPGo](https://github.com/drakkan/sftpgo) | 12,796；11-09 | Go 文件传输 | 文件服务成熟，文档编辑协作属于企业方向，产品用途偏文件传输 |
| [ONLYOFFICE DocSpace](https://github.com/ONLYOFFICE/DocSpace) | DocSpace 281；11-10；DocumentServer 7,117 是另一仓库 | C# / React，Office 房间 | 完整 Office 场景较重；不能用编辑引擎仓库 stars 替代 DocSpace 的项目规模 |
| Nextcloud、BookStack | 按技术栈排除，未继续排名 | PHP | 不符合用户明确要求 |

**继续使用 Outline 并补独立文件。** 需要额外维护文件节点、权限关联、稳定引用与选择器，反而绕开了选择成熟现成产品的初衷。飞书登录已验证能减少登录接入的不确定性，但不足以抵消资料模型缺口。

**选择 Cloudreve Pro。** 用户没有要求必须免费；商业授权属于成本和部署条件。它的文件管理、Markdown 编辑与账号功能值得保留，但原生文档能力、共享目录在目标版本的权限行为以及 agent 条件写入尚未取得与 OpenCloud 同等的证据，因此不排第一。若其界面更符合试用者习惯且接受 Pro 授权，可以再做定向验证。

**优先 Seafile + SeaDoc。** 如果把复杂块编辑、接近 WorkBuddy 的富文档体验和多人实时编辑提升为硬要求，它会成为更值得优先验证的候选。目前第一版只要求基本在线文档，OpenCloud 的资料组织与直接文本读写更合适。

**自建完整资料服务和编辑器。** 能最大程度贴合 Desktop，但需要承担账号权限、文件操作、并发写入、文档编辑和备份恢复的长期维护。本轮没有发现足以支持完全自建的必需差异；先做现成系统的接入适配。

## Acceptance criteria

1. 当前用户能创建空间或进入被授权的空间，浏览目录、新建 Markdown 文档并独立上传文件；两种资料都能出现在聊天选择器中。
2. 非成员无法通过直接 API 或下载地址读取资料；只读成员不能创建或覆盖；编辑成员可以操作；移除成员后旧凭据请求也应被拒绝。
3. 同空间重命名、移动、覆盖文件后，原资源引用仍能找到资料；删除后明确显示失效，不重新指向同路径的新文件。
4. Agent 基于读取的 etag 修改资料；其他人先保存后，过期写入被拒绝并要求重新读取，不覆盖他人的修改。
5. 飞书身份映射经过验证，Desktop 切换账号后资料页面、列表、预览与 agent 同时切换；凭据不写入普通配置或 Session。
6. 网页编辑后 agent 能读到保存内容，agent 创建或修改后网页可见；失败写入不显示已保存。
7. 服务重启、固定版本升级及独立备份恢复后，文件、文档、成员权限和资源引用可用；备份包含服务配置、身份元数据和内容数据。
8. 固定稳定版能够满足本期要求；部署不依赖公开 SMB 绕过权限，也不增加 RAG 或 Office 协同服务作为默认前提。

## Risks

OpenCloud 的主要代价是基本 Markdown 编辑能力与 WorkBuddy 完整块文档之间仍有差距，以及 300 stars 的独立 Web 仓库。推荐它不表示其编辑器生态已达到主仓库的关注量；若试用者明确需要复杂块文档，应重新评估 SeaDoc。

标准 OIDC 接入、飞书登录、Desktop 嵌入和当前用户 API 凭据是不同工作，任一项没验证都不能承诺账号已经打通。HTTP MCP 的凭据保存和账号切换需要补齐；实施时必须保持按用户授权，禁止用共享管理员令牌简化接入。

本轮验证不覆盖目标服务器、真实飞书账号接入、真实文件预览或备份恢复。源码与官方文档只能支持选型；固定版本验收未完成前，推荐状态保持 proposed。

### 主要官方来源

- OpenCloud：[稳定版 7.2.5](https://github.com/opencloud-eu/opencloud/releases/tag/v7.2.5)、[rolling 9.1.0](https://github.com/opencloud-eu/opencloud/releases/tag/v9.1.0)、[Space 角色](https://docs.opencloud.eu/docs/user/roles/space-roles)、[Markdown 编辑器](https://docs.opencloud.eu/docs/user/files-and-folders/markdown-editor)、[稳定编辑器声明](https://github.com/opencloud-eu/web/blob/v7.1.6/packages/web-app-text-editor/src/index.ts)、[WebDAV](https://docs.opencloud.eu/docs/dev/server/apis/http/webdav)、[Spaces API](https://docs.opencloud.eu/docs/dev/server/apis/http/graph/spaces)、[身份授权](https://docs.opencloud.eu/docs/dev/server/apis/http/authorization)、[发布与 LTS](https://docs.opencloud.eu/docs/admin/resources/lifecycle)、[未发布的协同编辑](https://docs.opencloud.eu/docs/next/admin/configuration/collaborative-editing)。
- Seafile / SeaDoc：[社区版与 Pro 权限](https://manual.seafile.com/13.0/introduction/file_permission_management/)、[OAuth](https://manual.seafile.com/13.0/config/oauth/)、[部署文件](https://manual.seafile.com/13.0/repo/docker/seadoc.yml)、[3.0.9 写入路由](https://github.com/haiwen/sdoc-server/blob/v3.0.9/src/modules/sdoc/route.js)、[文档管理实现](https://github.com/haiwen/sdoc-server/blob/main/src/modules/sdoc/managers/document-manager.js)。
- Wiki.js：[3.3.1](https://github.com/requarks/wiki/releases/tag/3.3.1)、[文件管理](https://docs.js.wiki/guide/file-manager)、[编辑器](https://docs.js.wiki/guide/editors)、[权限](https://docs.js.wiki/admin/permissions)、[站点](https://docs.js.wiki/admin/sites)、[API](https://docs.js.wiki/dev/api)、[MCP](https://docs.js.wiki/dev/mcp)、[OIDC](https://docs.js.wiki/admin/auth/oidc)。
- 商业与部署限制：[Cloudreve OIDC](https://docs.cloudreve.org/en/usage/oidc)、[AFFiNE 自托管](https://affine.pro/self-host)、[AFFiNE MCP](https://affine.pro/mcp)、[AppFlowy 商业服务端](https://github.com/AppFlowy-IO/AppFlowy-SelfHost-Commercial)、[Filestash 定价](https://www.filestash.app/pricing/)。
- CryptPad：[CryptDrive](https://docs.cryptpad.org/en/user_guide/drive.html)、[团队空间](https://docs.cryptpad.org/en/user_guide/teams.html)、[加密及客户端协议](https://docs.cryptpad.org/en/dev_guide/general.html)。
