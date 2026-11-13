# Agent Note: Open-source platform selection for the WorkBuddy shared library

Status: proposed

English | [中文](2026-11-12-workbuddy-library-platform-selection.zh.md)

## Problem

Deepseek-harness needs a WorkBuddy-like shared library: members organize folders, independently uploaded files, and online documents in spaces; accounts control access; conversations reference selected materials; and agents read, create, and modify those materials. The initial collection contains tens to hundreds of items, with deployment intended for the internal server `172.24.126.12`.

The [account-bound shared library proposal](2026-11-10-account-bound-shared-library.md) selects Outline, but treats uploaded files as document attachments and excludes the conversation picker from the first release. Both choices weaken the WorkBuddy reproduction. This report compares replacement platforms; the original account requirements and Outline Feishu sign-in experiments remain useful. This report owns the current recommendation for product selection and integration scope, pending user review.

This scope excludes RAG, vector search, OCR, and automatic knowledge processing. Simultaneous editing, complex block documents, PDF export, complete online Office editing, and folder-level fine-grained authorization are not first-release requirements. Extra capabilities offered by candidates do not expand the project scope.

## Proposal

### Conclusion and recommendation order

**Use OpenCloud as the foundation for the first shared library, evaluating the pinned stable release 7.2.5; retain Seafile + SeaDoc as the second candidate and Wiki.js 3.x as the third.** OpenCloud best matches the agreed combination of spaces, members, folders, independent files, and basic online documents. Harness account integration, the conversation picker, and agent read/write adapters still require development; installing the platform does not complete the reproduction.

The OpenCloud main repository has **6,314 stars**, while its Web repository has only **300 stars**. It has several thousand followers, below ten thousand; feature fit and current maintenance support the recommendation. If a ten-thousand-star minimum becomes mandatory, it fails that requirement. Seafile has 15,451 stars in its main repository, but the SeaDoc editor and server have only 15 and 2 respectively. Main-repository popularity cannot establish document-component maturity.

| Rank | Project and stack | Why it reaches the final shortlist | Main cost |
|---|---|---|---|
| 1 | [OpenCloud](https://github.com/opencloud-eu/opencloud), Go; [Web](https://github.com/opencloud-eu/web), Vue / TypeScript | Native shared spaces and member roles; files, folders, and Markdown documents share organization and permissions; Graph and WebDAV APIs | Basic document editing; stable release does not promise real-time collaboration; Feishu and Harness adapters remain |
| 2 | [Seafile](https://github.com/haiwen/seafile) + [SeaDoc](https://github.com/haiwen/seadoc-editor), C / Python / React / Node.js | Libraries, independent files, and rich documents resemble WorkBuddy more closely; established file management | Small SeaDoc community; block-write version compatibility, concurrency, and persistence need verification |
| 3 | [Wiki.js](https://github.com/requarks/wiki), Node.js / TypeScript / Vue | Documents, folders, and independent assets; convenient API / MCP access and page-version checks | New 3.x architecture; spaces need folder/group mapping; path links can break after moves |

### WorkBuddy reference baseline

The reference directory `E:\Project\workbuddy-5.9.3-src` is an unpacked application tree containing library skills, client entry points, and API scripts. The complete library interface loads remotely, and the server implementation is absent. It supports reproducing behavior, but provides no complete deployable WorkBuddy library server source.

| Confirmed behavior | Reference location relative to the WorkBuddy directory | Selection requirement |
|---|---|---|
| Spaces own members and roles; a tree organizes materials | `resources/plugins/workbuddy-builtin/skills/library/manage/entry.md` | Space membership authorization and folders |
| Uploaded files are independent `kind=drive` nodes; replacing content preserves the node and link | `resources/plugins/workbuddy-builtin/skills/library/drive/entry.md` | Files cannot exist only as document attachments; references cannot depend solely on paths |
| Document attachments and independent files have separate handling | `resources/plugins/workbuddy-builtin/skills/library/attachment/entry.md` | Attachment uploads do not establish independent file management |
| Online documents support reading, creation, and modification; creation accepts Markdown | `resources/plugins/workbuddy-builtin/skills/library/doc/tasks/read_create.md`, `doc/tasks/text_block_edit.md` | Basic editing and agent read/write access in the first release; full block editing needs separate evaluation |
| Conversations can expand spaces/folders and select multiple materials | `renderer/assets/space-library-picker-J0ZX7Dk-.js` | Harness needs a native material picker |
| Documents export to Markdown, databases to CSV, and web pages to HTML | `resources/plugins/workbuddy-builtin/skills/library/export/entry.md` | This does not confirm document PDF export; PDF export is not a current elimination criterion |

### Research method and evidence limits

This investigation compares 24 products or product combinations through official repositories, maintenance status, licenses, deployment instructions, permission documentation, and selected API source. Stars come from a GitHub API snapshot on 2026-11-12. Maintenance dates mean the latest repository push, which can include bots and dependency updates and does not establish sustained human maintenance. Source review targets selected important implementations; not every product was installed.

The report distinguishes documented features, behavior supported by pinned source, and local request results. Feishu single sign-on, Desktop embedding, browser editing, and backup restoration need dedicated verification. The earlier successful Outline Feishu experiment does not establish compatibility for other platforms. Features without an explicit official commitment are not inferred from names or screenshots.

### Why OpenCloud

An OpenCloud Space holds shared materials and assigns can view, can edit, or can manage roles. Folders, PDFs, Office files, images, and Markdown documents live directly in the space, without requiring a wrapper document for every upload. Basic space roles belong to the public project; no commercial entitlement requirement was found. Deleting an entire Space still requires global Admin or Space Admin privileges.

The stable Web 7.1.6 text editor uses Tiptap. Official 7.2 documentation lists headings, lists, images, tables, and code blocks, with content stored as ordinary Markdown files. First-release agents can read text and modify a previously read file version without maintaining a separate block-document engine. The editor declares a 2,000,000-byte limit; this limits online text editing, not every uploaded file.

WebDAV exposes resource IDs, private links, etags, and conditional writes; Graph manages spaces and members. Harness can reference resource IDs instead of treating file paths as permanent identities. Upload, replacement, same-space move, and rename continuity require pinned-version tests. Cross-space moves need a separate policy and do not promise ID preservation.

The server uses Apache-2.0, and Web uses AGPL-3.0; distributing or modifying Web requires the corresponding source obligations. Stable 7.2.5 was released on 2026-11-11 and includes Web 7.1.6; 9.1.0 is explicitly rolling. Official Yjs collaboration documentation belongs to rolling / unreleased content and cannot establish a stable 7.2.5 feature. Extended LTS backport support requires a subscription.

### Trade-offs among the three finalists

| Dimension | OpenCloud 7.2.5 | Seafile + SeaDoc | Wiki.js 3.x |
|---|---|---|---|
| Spaces and members | Native Spaces with view / edit / manage | Community edition has library-level user/group read-only or read/write sharing; cascading subfolder permissions require Pro | Groups and site/path rules; space mapping needs development |
| Independent uploaded files | Yes, alongside folders and documents in one space | Yes, alongside `.sdoc` documents in one library | Yes, assets and pages can be organized into folders |
| Online documents | Basic visual Markdown editing | Rich documents and blocks closer to WorkBuddy | Markdown / rich-text pages and a separate LiveNotes mode |
| Agent reads and writes | Graph + WebDAV, requiring a Harness adapter | File APIs + SeaDoc APIs, requiring compatible-version and write-semantics verification | REST / PAT / MCP, with version checks for page updates |
| Stable references | Same-space overwrite, rename, and move preserve IDs in local tests; private-link routing untested | UUIDs / Smart Links; continuity untested | Page/asset IDs; inline path links can break after moves |
| Current main concern | Basic editing is not complete block editing; small frontend community | Main-project stars do not establish SeaDoc maturity | 3.0 released on 2026-11-01; 29k stars include the previous architecture |
| Account integration | Standard OIDC; Feishu unverified | OAuth configuration; Feishu unverified | OIDC; Feishu unverified |

SeaDoc's `POST /api/v1/docs/:doc_uuid/element-commands` inserts, deletes, and replaces blocks, but this investigation found it in sdoc-server 3.0.9 while Seafile 13's official deployment file still uses `sdoc-server:2.0-latest`. That route has no expected-version condition. Its source returns success after an in-memory update and saves database operation records asynchronously. It cannot be treated as a default-installation, concurrency-safe agent write API whose success guarantees persistence. A compatible pinned combination and verification or adaptation are necessary.

Wiki.js APIs and MCP are convenient for agents, but sites require distinct hostnames; a `/space-a` folder is not directly a site. Simulating spaces with folders and groups requires owned mapping logic. MCP binary uploads have size limits, and PDF / Office metadata and links do not establish body-reading capability. These do not count as existing Harness file-understanding features.

### Harness integration work

| Work item | Reused capability | Behavior this repository must implement |
|---|---|---|
| Library entry | OpenCloud Web | Sidebar entry, restricted navigation and webpage permissions; verify CSP and authentication redirects for embedding |
| Account binding | Existing Feishu account and external OIDC | Explicit Harness-to-library user association; never merge accounts automatically by email or display name |
| Conversation picker | Existing [UI reference](../../../../packages/client/ui-reference/README.md) | List spaces/folders accessible to the current user, select multiple items, insert references, and open originals |
| Agent read/write access | Graph / WebDAV | List, read, create, and conditionally update as the current user; initially support Markdown/text and original-file upload/download |
| Stable references | Resource IDs / etags | Record service instance, space ID, resource ID, and read version; use paths and titles only for display |
| Account switching | Existing [Feishu account](../../../../packages/credentials/feishu-account/README.md) | Stop old-account requests, isolate credentials, clear current lists/previews; previously logged bodies remain historical session data |
| Credential storage | Host credential capabilities | Isolate tokens by service instance and user; never configure one shared administrator token for all agents |

Current Feishu accounts identify users by `union_id`. Feishu `open_id` is application-scoped, so values from two applications, or an `open_id` and a `union_id`, cannot be compared as equal identities. OpenCloud's standard OIDC support does not establish direct compatibility with Feishu OAuth endpoints. A standard identity provider or small sign-in adapter may be needed; seamless one-scan sign-in remains unverified.

The existing custom HTTP MCP connector stores `headers` in connector configuration, so the earlier proposal's claim that entering an API key automatically stores it securely cannot be reused. This integration needs per-user credential references and sign-out handling. Clearing browser cookies does not revoke API tokens. Agents must use current-user permissions, and server authorization must enforce access independently of hidden menus.

Material content and versions actually sent to the model must be logged in the Session so replay uses the original input; historical replay must not silently fetch the latest content. Arbitrary binary uploads/downloads, browser previews, and model body-reading are separate capabilities. Downloadable PDFs or Office files do not establish first-release agent editing of their bodies.

### Deployment recommendation and sequence

The intended server remains `172.24.126.12`, with materials managed by the service. `\\172.24.126.12\worksapce\lc-camera-agent` may hold deployment deliverables, but ordinary SMB users must not directly read or write protected service data directories, which would bypass account permissions. Server operating system, container support, domain, TLS, volumes, and backup locations require deployment-stage checks.

| Stage | Deliverable | Completion condition |
|---|---|---|
| 1. Pinned-version verification | Isolated OpenCloud 7.2.5 environment with configuration and compatible versions recorded | File permissions, ID continuity, conditional writes, browser editing, and account sign-in pass without relying on rolling features |
| 2. Server library | Protected production storage, membership, access address, and backups | Two members and one nonmember verify access; restored backups preserve materials and references |
| 3. Harness integration | Library entry, account association, conversation picker, and agent text read/write access | Pages, picker, and agent operate on the same materials with the current account's permissions |

### Local verification record

This investigation started an isolated WSL Docker instance using the pinned `opencloudeu/opencloud:7.2.5` image, a loopback-only listener, and disposable accounts. It did not connect to the target server or use existing materials. Local checks supplement platform selection and do not constitute deployment acceptance.

| Check | Observed result |
|---|---|
| Create space, read roles, and grant membership | Creation returned 201; reading permissions and granting viewer/editor membership returned 200 |
| Viewer reads and overwrites | GET 200; PUT 403, rejecting the write |
| Nonmember directly reads a file | GET 404, without the body |
| Editor saves the current version | PUT with current `If-Match` returned 204 and updated the body |
| Stale-version overwrite | PUT 412, preserving the saved body |
| Overwrite, rename, and same-space move | `oc:id` and `oc:fileid` preserved; overwrite changed the etag |
| Folder creation | First MKCOL returned 201 |
| Restart persistence | Unverified: the temporary entrypoint reran initialization and exited because configuration already existed; this does not establish product persistence behavior |

Pinned-version space membership APIs actually use `/graph/v1beta1`, while space creation uses `/graph/v1.0`. Invitations require role GUIDs returned by the API rather than display names. Initial upload 500 responses came from mismatched external ports and internal callback addresses in the test configuration. Early 401 responses came from LDAP not yet being ready. Correcting the API-test address and waiting for readiness allowed the checks above to pass; this temporary configuration is not a browser or production deployment recipe.

The temporary container was stopped and removed; the downloaded image remains. Raw requests, ID snapshots, and the test summary are retained in ignored `tmp/shared-library-platform-research/`. Browser editing/login, Feishu / OIDC, account switching, binary previews, cross-space moves, private-link routing, production volumes, and backup restoration remain untested.

## Alternatives considered

### Full screening

Maintenance dates below are UTC dates of the latest GitHub push. Recent activity means repository activity only. Elimination reasons retain official evidence rather than treating personal notes, file gateways, document editors, and shared libraries as interchangeable products.

| Project | Stars and maintenance snapshot | Stack or focus | Why it is not first choice |
|---|---|---|---|
| [Seafile + SeaDoc](https://github.com/haiwen/seafile) | Main 15,451; server 549, Seahub 610, SeaDoc editor 15, sdoc-server 2; components pushed on 11-11 / 11-12 | C / Python / React / Node.js | Retain second place; stronger rich documents, greater SeaDoc compatibility and agent-write risk |
| [Wiki.js](https://github.com/requarks/wiki) | 29,260; 11-11 | TypeScript / Node.js / Vue | Retain third place; new architecture and space-mapping cost |
| [Cloudreve](https://github.com/cloudreve/Cloudreve) | 28,957; 10-20 | Go / React file management | Strong independent files; OIDC, team shared folders, and related permissions require Pro; retain as a file-management option if commercial licensing is acceptable, with document/agent integration still unverified |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | 74,473; 11-12 | TypeScript documents / whiteboards | Independent uploaded-file tree is unconfirmed; self-hosted free-seat and enterprise-license restrictions; development MCP writes cannot be counted as stable |
| [Docmost](https://github.com/docmost/docmost) | 22,312; 11-12 | TypeScript team documents | Good spaces and editing, but files are attachments and commercial API / SSO restrictions add integration cost |
| [Outline](https://github.com/outline/outline) | 41,239; 11-12 | TypeScript team documents | Retain proven Feishu sign-in evidence, but extending attachments does not appropriately address independent files |
| [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | Client 78,756; 11-02; old Cloud 2,009 and archived | Flutter / Rust workspace | Client stars do not establish a self-deployable server; current server distribution is commercial with limited free seats, requiring licensing and integration cost review |
| [SiYuan](https://github.com/siyuan-note/siyuan) | 47,193; 11-12 | Go / TypeScript notes | Primarily personal workspaces; OIDC administrative access is not multiuser space authorization |
| [TriliumNext](https://github.com/TriliumNext/Trilium) | 38,875; 11-12 | Node.js personal knowledge base | Personal-note focus; team accounts and spaces are not an existing foundation |
| [Anytype](https://github.com/anyproto/anytype-ts) | 9,079; 11-10 | Local-first / P2P / end-to-end encryption | Central server administration and unified agent access do not fit directly; client licensing also needs review |
| [CryptPad](https://github.com/cryptpad/cryptpad) | 8,071; 11-10 | JavaScript team drive / encrypted collaborative documents | Suitable file/rich-document combination; encrypted key management and automated agent access remain unconfirmed and do not outweigh OpenCloud |
| [La Suite Docs](https://github.com/suitenumerique/docs) + [Drive](https://github.com/suitenumerique/drive) | Docs 16,986, Drive 482; 11-10 / 11-11 | Separate Django / React document and file products | Requires joining two products' accounts, folders, and references; Docs stars do not establish Drive maturity |
| [Colanode](https://github.com/colanode/colanode) | 5,200; last push 04-03 | TypeScript spaces / pages / files | Close product organization, but around seven months without a push and early Web status weaken it against current candidates |
| [Filestash](https://github.com/mickael-kerjean/filestash) | 14,892; 11-11 | Go / JavaScript file gateway | Strong storage access; commercial team identity / RBAC restrictions, with a document workspace still to build |
| [Pydio Cells](https://github.com/pydio/cells) | 2,258; 11-11 | Go file collaboration | Current Cells is not PHP; smaller community and commercial OIDC / SSO restrictions offer no clear advantage |
| [ownCloud oCIS](https://github.com/owncloud/ocis) | 2,188; 11-12 | Go / TypeScript file collaboration | Not the old PHP ownCloud; suitable organization, but OpenCloud's maintenance and following are more attractive in this investigation |
| [OpenList](https://github.com/OpenListTeam/OpenList) | 25,588; 11-12 | Go storage aggregation | Mounting and aggregating storage does not establish an online-document and team-space product |
| [File Browser](https://github.com/filebrowser/filebrowser) | 35,854; archived | Go file management | No longer normally maintained; popularity does not offset archival |
| [FileBrowser Quantum](https://github.com/gtsteffaniak/filebrowser) | 9,132; 11-12 | Go file management | OIDC and file permissions exist; stable resource identity and shared online documents remain insufficiently confirmed |
| [SFTPGo](https://github.com/drakkan/sftpgo) | 12,796; 11-09 | Go file transfer | Established file service, but document editing/collaboration targets enterprise use and its focus is file transfer |
| [ONLYOFFICE DocSpace](https://github.com/ONLYOFFICE/DocSpace) | DocSpace 281; 11-10; DocumentServer 7,117 is a separate repository | C# / React Office rooms | Full Office use is heavier; editing-engine stars cannot represent DocSpace's community |
| Nextcloud, BookStack | Excluded by stack before ranking | PHP | Fail the user's explicit requirement |

**Keep Outline and add independent files.** This requires owned file nodes, permission relationships, stable references, and a picker, weakening the reason to adopt an established product. Proven Feishu sign-in reduces authentication uncertainty but does not offset the material-model gap.

**Choose Cloudreve Pro.** The user did not require a free product; commercial licensing is a cost and deployment condition. File management, Markdown editing, and identity features warrant keeping it as an option. Native document capabilities, shared-folder authorization in the target version, and agent conditional writes lack evidence equivalent to OpenCloud, so it does not rank first. A preferred interface and acceptable Pro license could justify focused verification.

**Choose Seafile + SeaDoc first.** If complex blocks, WorkBuddy-like rich documents, and simultaneous editing become mandatory, this becomes the more compelling first candidate to validate. The current release needs basic online documents, making OpenCloud's organization and direct text access a better fit.

**Build a complete library service and editor.** This can match Desktop most closely but entails long-term ownership of authorization, files, concurrent writes, editing, and restoration. This investigation found no essential difference that justifies building the entire system. Start with adapters to an existing platform.

## Acceptance criteria

1. The current user can create or enter authorized spaces, browse folders, create Markdown documents, and independently upload files; both document and file types appear in the conversation picker.
2. Nonmembers cannot read materials through direct APIs or download URLs; viewers cannot create or overwrite; editors can operate; removed members' old credentials no longer grant access.
3. Same-space renames, moves, and overwrites preserve original resource references; deletion explicitly invalidates a reference instead of redirecting it to a new file at the same path.
4. Agents modify using the etag they read; when another writer saves first, stale writes are rejected and require another read instead of overwriting that change.
5. Feishu identity mapping is verified; Desktop account switching changes pages, lists, previews, and agent access together; ordinary configuration and Sessions never contain credentials.
6. Agents read saved browser edits, and the browser shows agent creations/modifications; failed writes never appear as saved.
7. Restart, pinned upgrades, and independent backup restoration preserve documents, files, permissions, and references; backups include service configuration, identity metadata, and content.
8. The pinned stable release meets this scope; deployment does not depend on public SMB permission bypasses, RAG, or Office collaboration services.

## Risks

OpenCloud trades away complete WorkBuddy block documents for basic Markdown editing and has a separate Web repository with 300 stars. Recommending it does not equate its editor ecosystem with the main repository's following. Reconsider SeaDoc if trial users require complex blocks.

Standard OIDC, Feishu sign-in, Desktop embedding, and per-user API credentials are separate tasks; account integration cannot be promised while any remains unverified. HTTP MCP credential storage and account switching need changes. Implementation must preserve per-user authorization and must not simplify access with a shared administrator token.

This investigation does not cover the target server, real Feishu integration, real-file previews, or backup restoration. Source and official documentation support selection, while the status remains proposed until pinned-version acceptance is complete.

### Primary official sources

- OpenCloud: [stable 7.2.5](https://github.com/opencloud-eu/opencloud/releases/tag/v7.2.5), [rolling 9.1.0](https://github.com/opencloud-eu/opencloud/releases/tag/v9.1.0), [Space roles](https://docs.opencloud.eu/docs/user/roles/space-roles), [Markdown editor](https://docs.opencloud.eu/docs/user/files-and-folders/markdown-editor), [stable editor declaration](https://github.com/opencloud-eu/web/blob/v7.1.6/packages/web-app-text-editor/src/index.ts), [WebDAV](https://docs.opencloud.eu/docs/dev/server/apis/http/webdav), [Spaces API](https://docs.opencloud.eu/docs/dev/server/apis/http/graph/spaces), [authorization](https://docs.opencloud.eu/docs/dev/server/apis/http/authorization), [releases and LTS](https://docs.opencloud.eu/docs/admin/resources/lifecycle), [unreleased collaboration](https://docs.opencloud.eu/docs/next/admin/configuration/collaborative-editing).
- Seafile / SeaDoc: [community and Pro permissions](https://manual.seafile.com/13.0/introduction/file_permission_management/), [OAuth](https://manual.seafile.com/13.0/config/oauth/), [deployment file](https://manual.seafile.com/13.0/repo/docker/seadoc.yml), [3.0.9 write route](https://github.com/haiwen/sdoc-server/blob/v3.0.9/src/modules/sdoc/route.js), [document manager](https://github.com/haiwen/sdoc-server/blob/main/src/modules/sdoc/managers/document-manager.js).
- Wiki.js: [3.3.1](https://github.com/requarks/wiki/releases/tag/3.3.1), [file manager](https://docs.js.wiki/guide/file-manager), [editors](https://docs.js.wiki/guide/editors), [permissions](https://docs.js.wiki/admin/permissions), [sites](https://docs.js.wiki/admin/sites), [API](https://docs.js.wiki/dev/api), [MCP](https://docs.js.wiki/dev/mcp), [OIDC](https://docs.js.wiki/admin/auth/oidc).
- Commercial and deployment restrictions: [Cloudreve OIDC](https://docs.cloudreve.org/en/usage/oidc), [AFFiNE self-hosting](https://affine.pro/self-host), [AFFiNE MCP](https://affine.pro/mcp), [AppFlowy commercial server](https://github.com/AppFlowy-IO/AppFlowy-SelfHost-Commercial), [Filestash pricing](https://www.filestash.app/pricing/).
- CryptPad: [CryptDrive](https://docs.cryptpad.org/en/user_guide/drive.html), [team spaces](https://docs.cryptpad.org/en/user_guide/teams.html), [encryption and client protocol](https://docs.cryptpad.org/en/dev_guide/general.html).
