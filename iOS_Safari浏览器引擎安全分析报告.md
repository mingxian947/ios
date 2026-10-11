# iOS Safari 浏览器引擎（WebKit）安全架构深度分析报告

> 编制日期：2026-10-11
> 数据来源：Apple 开源 WebKit 项目、Apple 平台安全文档、Google Project Zero、Chromium/WebKit 安全研究、公开 CVE 情报
> 性质：防御性安全研究分析（Defensive Security Research）

---

## 1. 执行摘要

Safari 是 iOS 上唯一的浏览器引擎——**所有第三方浏览器在 iOS 上均被强制使用 WebKit 内核**（Apple App Store 审核规则）。这意味着 WebKit 不仅是 Safari 的引擎，更是 iOS 上**所有网页内容渲染与 JavaScript 执行**的唯一通道，也是远程代码执行（RCE）攻击面中最大、最关键的组件。

本报告从**架构层面**深入剖析 iOS Safari 浏览器引擎的内部结构、进程模型、安全机制、攻击面分布与防御纵深，为安全研究者提供系统性的理解框架。

---

## 2. WebKit 引擎总体架构

### 2.1 核心组件层次

```
┌─────────────────────────────────────────────────────────┐
│                    WebKit 引擎层次                        │
├─────────────────────────────────────────────────────────┤
│  应用层   │  Safari UI / WKWebView API                    │
├──────────┼──────────────────────────────────────────────┤
│  框架层   │  WebKit2（多进程框架 / IPC / 进程管理）         │
├──────────┼──────────────────────────────────────────────┤
│  渲染层   │  WebCore（HTML/CSS 解析、DOM、布局、合成）      │
├──────────┼──────────────────────────────────────────────┤
│  脚本层   │  JavaScriptCore / JSC（JS 引擎、JIT、GC）     │
├──────────┼──────────────────────────────────────────────┤
│  平台层   │  PAL (Platform Abstraction Layer)             │
│           │  IOKit / CoreGraphics / CoreFoundation / libxslt │
├──────────┼──────────────────────────────────────────────┤
│  系统层   │  iOS 内核（XNU）/ 沙箱 / 内存管理 / PAC        │
└──────────┴──────────────────────────────────────────────┘
```

### 2.2 关键子模块

| 模块 | 职责 | 安全相关性 |
|---|---|---|
| **WebCore** | HTML/CSS 解析、DOM 树构建、布局（Layout）、绘制（Paint）、合成（Composite） | 解析器漏洞（UAF、OOB）、CSS 引擎缺陷 |
| **JavaScriptCore (JSC)** | JavaScript 解析、AST、字节码、JIT 编译、垃圾回收 | 类型混淆、JIT 缺陷、GC 漏洞——**最高频 RCE 入口** |
| **WebKit2** | 多进程架构、进程间通信（IPC）、API 层 | IPC 逻辑缺陷、沙箱配置 |
| **PAL** | 平台抽象层，封装 OS 原生 API | 间接影响——桥接系统调用的攻击面 |
| **Web Inspector** | 调试/开发工具 | 仅在启用时暴露，生产环境默认关闭 |
| **Networking** | 网络请求、Cookie、缓存、CORS | 网络层攻击（MITM、CORS 绕过） |

---

## 3. 多进程架构与沙箱模型

### 3.1 进程模型

WebKit2 采用**多进程架构**，将不同职责隔离到独立进程中，每个进程受独立沙箱约束：

```
┌──────────────────────────────────────────────────┐
│              UIProcess（主进程）                    │
│  · Safari UI / WKWebView 宿主                     │
│  · 进程管理、导航决策、策略控制                      │
│  · 沙箱：App 沙箱（标准 iOS 应用沙箱）               │
└──────┬──────────┬──────────┬──────────┬──────────┘
       │ IPC      │ IPC      │ IPC      │ IPC
  ┌────▼────┐ ┌───▼────┐ ┌──▼───┐ ┌───▼─────┐
  │WebContent│ │Network │ │ GPU  │ │Extension│
  │ (渲染)   │ │(网络)  │ │渲染  │ │(扩展)   │
  │          │ │        │ │      │ │         │
  │ 沙箱：   │ │沙箱：  │ │沙箱：│ │沙箱：   │
  │ 极严格   │ │ 网络   │ │ GPU  │ │ 受限    │
  └──────────┘ └────────┘ └──────┘ └─────────┘
```

| 进程 | 职责 | 沙箱严格度 | 攻击价值 |
|---|---|---|---|
| **UIProcess** | 浏览器 UI、导航决策、进程生命周期管理 | 标准 App 沙箱 | 高——控制浏览器行为 |
| **WebContent** | HTML/CSS/JS 解析、DOM 操作、页面渲染、脚本执行 | **极严格**（最受限） | **最高**——RCE 首站 |
| **Network** | HTTP/HTTPS 请求、Cookie 管理、缓存 | 仅网络访问 | 中——数据拦截/外传 |
| **GPU Process** | GPU 渲染、WebGPU、视频解码 | GPU 相关权限 | 高——沙箱逃逸跳板 |
| **Extension** | Safari 扩展（macOS） | 受限 | 低（iOS 无扩展） |

### 3.2 WebContent 沙箱

WebContent 进程是攻击者获得初始 RCE 后的落脚点，也是安全限制**最严格**的进程：

- **无文件系统访问**：不能读写用户数据
- **无网络访问**：不能直接发起网络请求（必须通过 IPC 委托给 Network 进程）
- **无进程创建**：不能 fork/exec
- **受限 IPC**：只能与 UIProcess 通过预定义的 Mach port 通信
- **受限系统调用**：通过 iOS 沙箱 profile（seatbelt）限制可用 syscall
- **ASLR + PAC**：地址随机化 + 指针认证（A12+ 设备）

**攻击者视角**：控制 WebContent 只是第一步，必须通过**沙箱逃逸**（第二个漏洞）才能触及用户数据。

### 3.3 进程间通信（IPC）

WebKit2 的 IPC 基于 **Mach port** 和 **XPC**，使用序列化的消息格式：

- **攻击面**：IPC 消息的解析与处理逻辑可能存在类型混淆、缓冲区溢出等缺陷
- **历史案例**：部分 CVE 涉及 IPC 消息处理中的内存破坏
- **防御**：IPC 消息格式经过严格校验；跨进程调用受策略控制

---

## 4. JavaScriptCore（JSC）引擎深度分析

JSC 是 WebKit 的 JavaScript 引擎，也是 iOS 上**最高频的 RCE 攻击入口**。

### 4.1 JSC 执行管线

```
JavaScript 源码
    │
    ▼
┌──────────┐
│  词法分析  │  Lexer / Parser
│  语法分析  │  → AST（抽象语法树）
└────┬─────┘
     ▼
┌──────────┐
│  字节码   │  Bytecode Generator
│  生成     │  → 低级字节码
└────┬─────┘
     ▼
┌──────────────────────────────────────┐
│          执行引擎（分层 JIT）           │
│                                      │
│  LLInt（低层级解释器）                  │
│    → 首次执行，收集类型信息             │
│                                      │
│  Baseline JIT（基线编译器）             │
│    → 热点函数，快速编译，基本优化        │
│                                      │
│  DFG JIT（数据流图编译器）              │
│    → 投机优化，基于类型推测              │
│    · 内联（Inlining）                  │
│  · 类型特化（Type Specialization）     │
│  · 逃逸分析（Escape Analysis）         │
│                                      │
│  FTL JIT（函数级顶层编译器）            │
│    → 激进优化，最高性能                 │
│  · B3 后端（底层优化器）               │
│    · 寄存器分配、指令选择               │
└──────────────────────────────────────┘
```

### 4.2 JSC 对象模型与安全含义

JSC 中的 JavaScript 值使用**标记联合体（tagged union）**表示：

```
JSValue（64 位）:
┌─────────────────────────────────────┐
│  63    49 │ 48  │ 47          0     │
│  Tag      │ NaN │ Payload            │
│  (15 bit) │(1)  │ (47 bit)          │
└─────────────────────────────────────┘

Nan-boxing 编码：
- 对象指针：Tag = 0xFFFF, Payload = 堆指针
- 整数：Tag = 0xFFFE, Payload = 整数值
- 双精度浮点：IEEE 754 NaN 空间
- 布尔/undefined/null：特定 Tag 值
```

**安全含义**：
- **类型混淆攻击**：如果 JIT 优化器错误推测了对象类型，攻击者可以伪造 JSValue，将整数解释为指针（`fakeobj`）或将指针解释为整数（`addrof`），从而获得**任意地址读写原语**
- **Nan-boxing 绕过**：通过操纵 Tag 字段，可以将任意 64 位值伪装成对象指针

### 4.3 垃圾回收（GC）

JSC 使用**分代式标记-清扫 GC**：

- **新生代（Young Generation）**：Eden 空间 + 两个 Survivor 空间，频繁 Minor GC
- **老生代（Old Generation）**：标记-清扫，偶尔 Major GC
- **并发标记**：标记阶段与 JS 执行并发进行
- **增量标记**：分步执行，减少暂停

**安全含义**：
- GC 的并发/增量特性引入了**竞态条件**攻击面
- GC 根集合（root set）的不完整扫描可能导致**过早释放**（premature free）→ UAF
- 屏障（barrier）机制的缺陷可能导致**悬挂指针**

### 4.4 JSC 高频漏洞模式

| 漏洞模式 | 机制 | 代表 CVE |
|---|---|---|
| **类型混淆（Type Confusion）** | DFG/FTL 优化器错误推测对象结构（Structure），生成错误机器码 | CVE-2024-23222, CVE-2023-41974 |
| **数组边界检查消除（Check Elimination）** | JIT 错误消除数组越界检查，导致 OOB 读写 | CVE-2023-32434, CVE-2023-38606 |
| **UAF（释放后使用）** | GC 或 DOM 生命周期管理缺陷导致对象过早释放 | CVE-2024-44308, CVE-2023-28205 |
| **栈溢出** | 递归或深度嵌套输入超出栈空间 | CVE-2023-42916 |
| **逻辑缺陷** | 原型链处理、PropertyGetter 等逻辑错误 | CVE-2025-31277（DarkSword） |
| **RegExp 引擎缺陷** | 正则表达式编译/执行中的内存破坏 | 多个历史 CVE |

---

## 5. WebCore 渲染引擎安全分析

### 5.1 渲染管线

```
HTML 输入
    │
    ▼
┌──────────┐    ┌──────────┐
│ HTML 解析 │───→│ DOM 树   │
└──────────┘    └────┬─────┘
                     │
┌──────────┐    ┌────▼─────┐
│ CSS 解析  │───→│ 样式计算  │ → Render Tree → Layout → Paint → Composite
└──────────┘    └──────────┘
```

### 5.2 DOM 与内存安全

- **DOM 节点生命周期**：由 GC（JS 对象）和引用计数（C++ DOM 对象）共同管理，两套内存管理机制的**交互边界**是 UAF 的高发区
- **事件分发**：事件处理可能触发 DOM 修改（如 `innerHTML` 赋值），如果在遍历过程中修改 DOM，可能导致**迭代器失效**→ UAF
- **MutationObserver**：异步回调可能在意外时机触发 DOM 操作

### 5.3 WebCore 高频漏洞模式

| 漏洞模式 | 说明 |
|---|---|
| **DOM UAF** | DOM 节点在事件处理/回调中被释放，但仍有悬挂引用 |
| **SVG 解析缺陷** | SVG 元素复杂生命周期管理导致的内存破坏 |
| **CSS 引擎缺陷** | 样式计算/布局中的越界读写 |
| **媒体引擎缺陷** | GStreamer/AVFoundation 集成层的编解码漏洞 |
| **Web Animation UAF** | 动画对象生命周期与 DOM 不同步 |

---

## 6. 安全机制与防御纵深

### 6.1 浏览器层安全机制

| 机制 | 说明 | 防御目标 |
|---|---|---|
| **同源策略（SOP）** | 限制跨源 DOM/数据访问 | 跨站数据窃取 |
| **内容安全策略（CSP）** | 白名单控制可执行脚本/资源来源 | XSS、代码注入 |
| **子资源完整性（SRI）** | 校验外部资源的哈希值 | CDN 劫持、中间人篡改 |
| **X-Frame-Options / frame-ancestors** | 控制页面是否可被嵌入 iframe | 点击劫持 |
| **SameSite Cookie** | 限制跨站请求携带 Cookie | CSRF |
| **自动播放策略** | 限制音视频/JS 自动执行 | 恶意广告、资源滥用 |
| **智能防跟踪（ITP）** | 阻止跨站跟踪 Cookie | 隐私跟踪 |
| **安全浏览** | 检测已知恶意/钓鱼网站 | 水坑攻击、钓鱼 |

### 6.2 系统层安全机制

| 机制 | 说明 | 对 WebKit 的影响 |
|---|---|---|
| **沙箱（Seatbelt/Sandbox）** | 限制 WebContent 进程的 syscall 与资源访问 | RCE 后不能直接访问用户数据 |
| **ASLR** | 地址空间布局随机化 | 增加内存利用难度 |
| **PAC（指针认证）** | A12+ 设备的指针签名，防止指针篡改 | 对抗虚表覆写、ROP gadget |
| **W^X（不可执行堆栈/堆）** | 代码页不可写，数据页不可执行 | JIT 页面是例外（需特殊处理） |
| **Hardened Runtime** | 限制动态库注入、调试器附加 | 降低注入攻击面 |
| **Lockdown Mode** | 限制 WebKit 功能（禁用 JIT、复杂 JS） | **显著缩小攻击面** |

### 6.3 JIT 安全特殊处理

JIT 编译器需要**可写且可执行（W+X）**的内存页，这与 W^X 保护矛盾。WebKit 的处理方式：

1. **JIT 代码页隔离**：JIT 生成的机器码写入专用内存页，与其他数据页严格分离
2. **权限切换**：写入完成后通过 `mprotect` 将页面标记为仅可执行（X-only）
3. **JIT 喷射缓解**：JIT 页面地址随机化，增加定位难度
4. **Lockdown Mode 下禁用 JIT**：锁定模式下 Safari 回退到解释器执行，完全消除 JIT 攻击面

---

## 7. 攻击面全景分析

### 7.1 攻击面分布

```
                    WebKit 攻击面热力图

  高 ┃ ██████████████████████████████████████████████████
  风  ┃  JSC (JavaScriptCore)
  险  ┃  · 类型混淆 / JIT 优化缺陷 / GC 竞态
     ┃  · 历史在野利用最密集的组件
  ━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     ┃  WebCore DOM
  中  ┃  · DOM UAF / SVG 解析 / 事件处理
  风  ┃  · 沙箱逃逸跳板
  险  ┃
  ━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     ┃  GPU / WebGPU / WebGL
  中  ┃  · 着色器编译 / 图形驱动交互
  风  ┃  · DarkSword 沙箱逃逸组件
  险  ┃
  ━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     ┃  媒体引擎（Audio/Video）
  中  ┃  · 编解码器缺陷（libavcodec / Apple AVFoundation）
  低  ┃  · 信息泄露 / 内存破坏
  风  ┃
  险  ┃
  ━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     ┃  网络层 / Fetch / WebSocket
  低  ┃  · CORS 绕过 / 协议处理
  风  ┃  · 数据外传通道
  险  ┃
  ━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     ┃  Web API（Storage / IndexedDB / Service Worker）
  低  ┃  · 本地存储窃取
  风  ┃  · 持久化通道
  险  ┃
```

### 7.2 攻击面入口向量

| 入口向量 | 触发方式 | 交互要求 | 代表场景 |
|---|---|---|---|
| **网页渲染** | 访问含恶意 HTML/CSS 的页面 | 低（仅需访问） | 水坑攻击、钓鱼 |
| **JavaScript 执行** | 页面内 JS 触发 JSC 漏洞 | 低（自动执行） | Drive-by 攻击 |
| **媒体处理** | 嵌入恶意音视频文件 | 低（自动加载） | 媒体引擎漏洞 |
| **WebGPU/WebGL** | 页面调用 GPU API | 低（自动执行） | DarkSword 沙箱逃逸 |
| **WebSocket** | 建立 WebSocket 连接 | 低 | C2 通信通道 |
| **Service Worker** | 注册后台服务 | 中（需用户交互或缓存） | 持久化 |
| **文件下载** | 下载并打开恶意文件 | 中 | 载荷投递 |

### 7.3 从 WebKit RCE 到完整沦陷

WebKit RCE 只是全链条的第一步。攻击者需要串联多个漏洞才能完成"完整设备沦陷"：

```
[1] WebKit/JSC RCE
    │  控制 WebContent 进程（沙箱内）
    │
[2] 沙箱逃逸
    │  利用 GPU/WebGPU 缺陷或 IPC 缺陷
    │  脱离 WebContent 沙箱 → 进入 rootless 进程空间
    │
[3] PAC 绕过（A12+ 设备）
    │  利用 dyld / 内核缺陷绕过指针认证
    │
[4] 内核提权
    │  利用内核漏洞获取 root 权限
    │
[5] 数据窃取 / 驻留
    │  访问 Keychain / SEP / 用户数据
    │  或：无持久化短暂驻留后清除痕迹
```

---

## 8. 历史漏洞趋势与统计分析

### 8.1 WebKit/JSC 在野利用时间线

| 年份 | 在野利用 CVE | 攻击链/事件 | 关键特征 |
|---|---|---|---|
| 2019 | CVE-2019-6222, CVE-2019-6233 | 多个在野利用 | JSC 类型混淆 |
| 2020 | CVE-2020-9907, CVE-2020-27950 | 内核 + WebKit 组合 | 内核提权 + WebKit RCE |
| 2021 | CVE-2021-1789, CVE-2021-30952 | FORCEDENTRY / NSO | iMessage 渲染引擎 |
| 2022 | CVE-2022-22674, CVE-2022-32917 | 多个在野利用 | WebKit 内存破坏 |
| 2023 | CVE-2023-32434, CVE-2023-38606, CVE-2023-41974, CVE-2023-42916 | Coruna 组件 | 多条链共用 |
| 2024 | CVE-2024-23222, CVE-2024-44308, CVE-2024-4558 | Coruna / 在野利用 | 类型混淆 + 媒体引擎 |
| 2025 | CVE-2025-14174, CVE-2025-31277 | DarkSword / 在野利用 | JSC 逻辑缺陷 |
| 2026 | CVE-2026-20700（dyld 组合） | DarkSword 后续 | 全链条新组合 |

### 8.2 漏洞类型分布

```
JSC 类型混淆（Type Confusion）  ████████████████  ~35%
释放后使用（UAF）               ████████████      ~25%
越界读写（OOB）                ████████          ~18%
JIT 编译缺陷                  ██████            ~12%
逻辑/权限缺陷                  ████              ~7%
其他（栈溢出/整数溢出等）         ██               ~3%
```

**趋势观察**：
- **类型混淆**始终是最主要的 RCE 入口——JIT 优化器的投机优化是根本原因
- **UAF** 在 DOM/WebCore 层更为常见——生命周期管理复杂性导致
- 近年漏洞利用趋向**逻辑缺陷**（如 DarkSword 的 JSC 逻辑漏洞），这类漏洞更难通过传统内存安全机制（如 PAC）防御
- **补丁竞速**加剧：从 Apple 发布补丁到攻击者逆向并武器化在野利用的窗口缩短至数周

---

## 9. iOS 上 WebKit 的独特性

### 9.1 强制 WebKit 策略的影响

iOS 要求**所有浏览器必须使用 WebKit 引擎**（App Store 审核规则 4.7）：

| 影响维度 | 分析 |
|---|---|
| **攻击面统一** | Chrome/Firefox/Edge 在 iOS 上均使用 WebKit——攻击一个引擎等于攻击所有浏览器 |
| **无引擎多样性** | 桌面端 Chrome 的 Blink/V8 与 Safari 的 WebKit/JSC 形成多样性屏障；iOS 上**不存在此屏障** |
| **创新受限** | WebKit 的更新节奏由 Apple 控制，安全修复与功能更新同步受限 |
| **单点故障** | WebKit 的零日漏洞影响 iOS 上**全部**浏览器用户 |

### 9.2 Safari 与 WKWebView 的差异

| 维度 | Safari（独立应用） | WKWebView（嵌入第三方 App） |
|---|---|---|
| 引擎版本 | 随 iOS 系统更新 | 随 iOS 系统更新（同一 WebKit） |
| JIT | 启用（有 entitlement） | **部分 App 可能禁用 JIT** |
| 进程模型 | 完整多进程 | 可能使用进程内模式 |
| 安全策略 | 完整 CSP/SOP | 可由宿主 App 自定义策略 |
| 攻击面 | 完整 WebKit 攻击面 | 可能缩小（取决于宿主配置） |

### 9.3 Lockdown Mode 对 WebKit 的影响

锁定模式（Lockdown Mode，iOS 16+）对 WebKit 施加了显著限制：

| 限制项 | 说明 | 安全效果 |
|---|---|---|
| **禁用 JIT** | JavaScript 回退到解释器执行 | 消除 JIT 攻击面（~35% 的漏洞类型） |
| **禁用复杂 Web API** | 禁用 WebGPU、WebGL 2.0 等 | 缩小 GPU 攻击面 |
| **限制正则表达式** | 复杂 RegExp 可能被阻止 | 减少 RegExp 引擎攻击面 |
| **限制嵌套深度** | 限制 HTML/JS 嵌套层级 | 减少栈溢出攻击面 |
| **限制字体** | 仅允许系统字体 | 减少字体解析攻击面 |

**实测效果**：Coruna 和 DarkSword 在检测到 Lockdown Mode 时**主动中止攻击**，因为禁用 JIT 后攻击复杂度急剧上升。

---

## 10. 防御建议

### 10.1 用户层面

1. **及时更新 iOS**：WebKit 漏洞修复随 iOS 更新发布，延迟更新意味着暴露于已知漏洞
2. **启用锁定模式**：高危用户（记者、活动人士、政府人员）应启用 Lockdown Mode，显著缩小 WebKit 攻击面
3. **谨慎点击链接**：水坑攻击和钓鱼页面是 WebKit 漏洞的主要投递方式
4. **禁用不必要的 Web 功能**：在 Safari 设置中禁用 JavaScript（极端场景下）可消除 JSC 攻击面

### 10.2 开发者层面

5. **WKWebView 安全配置**：
   - 设置严格的 CSP 头
   - 启用 SRI 校验外部资源
   - 禁用不必要的 Web API（如 `javaScriptCanOpenWindowsAutomatically`）
   - 使用 `WKContentWorld` 隔离扩展脚本
6. **输入校验**：对传入 WKWebView 的 HTML/URL 进行严格校验，防止注入
7. **最小权限**：通过 `WKWebpagePreferences` 限制页面能力

### 10.3 安全研究/检测层面

8. **运行时行为检测**：
   - 监控 WebContent 进程的异常行为（异常 IPC 调用、异常内存分配模式）
   - 检测 WebGPU/GPU 进程的异常着色器编译
   - 监控 JIT 页面的异常写入模式
9. **网络层检测**：
   - 检测 DGA 域名请求（WebContent 本身无网络能力，但逃逸后的进程可能有）
   - 监控异常加密流量模式
10. **漏洞狩猎重点**：
    - JSC JIT 优化器（DFG/FTL）的类型推测逻辑
    - GC 并发标记的竞态条件
    - DOM 事件处理中的 UAF
    - WebGPU 着色器编译与 GPU 驱动交互
    - 媒体引擎的编解码器缺陷

---

## 11. 总结

iOS Safari 浏览器引擎（WebKit）是一个庞大的、多层级的复杂系统，其安全架构体现了**纵深防御**的设计理念：

| 防御层 | 机制 |
|---|---|
| **引擎层** | CSP、SOP、SRI、SameSite |
| **进程层** | 多进程隔离、WebContent 严格沙箱 |
| **系统层** | iOS 沙箱、ASLR、PAC、W^X |
| **模式层** | Lockdown Mode 禁用 JIT / WebGPU |

然而，WebKit 的**攻击面仍然巨大**——作为 iOS 上唯一被允许处理网页内容的引擎，它承载了来自全网的全部不可信输入。历史上，WebKit/JSC 几乎参与了**所有已知的 iOS 全链条攻击**，是最关键的"第一入口"。

防御的核心策略：
1. **缩小攻击面**（Lockdown Mode、禁用不必要功能）
2. **及时修补**（iOS 更新）
3. **运行时检测**（不依赖持久化特征，关注行为异常）
4. **纵深联动**（WebKit 安全 + 沙箱 + PAC + 内核保护的协同）

---

## 参考来源

- [Apple Open Source — WebKit](https://opensource.apple.com/source/WebKit2/)
- [Apple Platform Security — iOS Security](https://support.apple.com/guide/security/welcome/web)
- [WebKit Bug Tracker](https://bugs.webkit.org/)
- [JavaScriptCore Hacker's Guide — WebKit](https://webkit.org/docs/javascriptcore/)
- [Google Project Zero — WebKit Vulnerabilities](https://googleprojectzero.blogspot.com/)
- [Google Cloud TI — Coruna Exploit Kit](https://cloud.google.com/blog/topics/threat-intelligence/coruna-powerful-ios-exploit-kit)
- [Google Cloud TI — DarkSword Proliferation](https://cloud.google.com/blog/topics/threat-intelligence/darksword-ios-exploit-chain)
- [Apple Security Releases](https://support.apple.com/en-us/HT201222)
- [MITRE CVE — WebKit](https://cve.mitre.org/)
- [The WebKit Open Source Project](https://webkit.org/)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
