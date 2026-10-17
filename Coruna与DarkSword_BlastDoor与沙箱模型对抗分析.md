# Coruna 与 DarkSword 沙箱模型与 BlastDoor 对抗分析

> 编制日期：2026-10-18
> 数据来源：Apple 安全架构文档、Google Project Zero、Citizen Lab、Synacktiv、WWDC 安全议题、公开 CVE 情报
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. 执行摘要

iOS 的防御纵深在很大程度上是一个**沙箱层次结构**：每个进程被限制在一组明确的权限边界内，攻击者必须**逐层打破边界**才能取得实际价值。

Coruna 与 DarkSword 都起始于同一个受沙箱约束的进程——**Safari WebContent**。本文从 iOS 沙箱模型出发，分析：

1. Seatbelt 沙箱的实际结构与约束粒度
2. **BlastDoor** 的设计目标、覆盖范围与真实效果（含常被误解的部分）
3. 为什么 BlastDoor **未能阻止** WebKit 类链条的成功
4. Coruna 与 DarkSword 各自的逃逸路径与沙箱设计弱点选择
5. 沙箱模型给防御者的三条实用结论

---

## 2. iOS 沙箱模型基础

### 2.1 Seatbelt（sandboxd / Sandbox System Call Filter）

iOS 使用基于 **Seatbelt** 的强制访问控制（MAC）：每个进程启动时载入一份 **sandbox profile**，以内核系统调用过滤器的形式约束该进程可执行的操作。

```
进程 exec
   ↓
sandbox_init(profile_name)
   ↓
内核安装 per-process MAC policy
   ↓
每次 syscall 经过过滤检查（deny by default + allowlist）
```

### 2.2 profile 的约束维度

| 维度 | 约束内容 | 攻击者关注点 |
|---|---|---|
| **文件路径** | 可读写的具体路径前缀 | 能碰到哪些配置/缓存/容器 |
| **Mach 端口** | 可 lookup / 可发送消息的服务名 | 能与哪些特权服务通信（**逃逸主入口**） |
| **POSIX 共享内存** | 可访问的 shm 区段 | 跨进程通信通道 |
| **IOKit** | 可打开的服务类（`IOReturn`） | 驱动接口可达性（**逃逸主入口**） |
| **网络** | 可否建立连接、绑定的接口 | 外传通道 |
| **系统调用** | 禁用的高危调用（如 `fork`、`ptrace`） | 进程创建与注入能力 |
| **URL scheme / 服务** | 可打开的 scheme | 跨应用触发 |

### 2.3 WebContent 沙箱的特征

Safari 的渲染进程（`com.apple.WebKit.WebContent`）承载不可信内容，其 profile 极为严格：

| 能力 | WebContent 是否允许 |
|---|---|
| 直接读取用户数据（照片/通讯录/消息） | ❌ |
| 访问其他 App 容器 | ❌ |
| 建立任意网络连接 | ⚠️ 通过 Networking 服务代理，非直连 |
| 打开任意 IOKit 服务 | ❌（白名单内可打开，**GPU 相关在列**） |
| 与 WindowServer / 图形栈通信 | ✅ **必须允许**（否则无法渲染页面） |
| `fork` / `exec` | ❌ |
| 访问钥匙串 | ❌（需通过其他进程） |
| 相机 / 麦克风 | ❌（需用户授权且经其他服务） |

**这是攻击链的根本约束**：WebContent 内的代码执行**几乎无直接价值**——它看不到用户数据。因此**逃逸是必经环节**。

---

## 3. BlastDoor：设计目标与真实定位

### 3.1 为什么 Apple 造 BlastDoor

iOS 15 之前，**消息类应用的不可信解析在应用主进程内进行**。这带来一个致命结构问题：

```
[远端发送者] → iMessage 附件/富文本
                     ↓
             Messages.app 主进程直接解析
                     ↓
        一个解析器漏洞 = 完整 Messages 权限的代码执行
```

Messages 进程权限相当高（可访问完整消息库、附件、可触达多个服务）。**一个 0-click 解析器 bug 就能直接获得高权限立足点**。

BlastDoor 的目标是把这件事拆成两层：

```
[远端发送者] → 原始消息载荷
                     ↓
        ┌──────────────────────────┐
        │  BlastDoor 沙箱服务       │  ← 在独立、极严格沙箱内
        │  解析不可信内容 → 转成     │     完成所有危险解析
        │  安全的数据结构            │
        └──────────────────────────┘
                     ↓ 只输出已结构化的安全数据
             Messages.app（高权限）
                     ↓
             只消费安全数据，不再接触原始字节
```

### 3.2 设计要点

| 要点 | 说明 |
|---|---|
| **默认拒绝（deny-by-default）** | profile 只放行解析所需最小能力 |
| **无网络** | BlastDoor 沙箱内不允许建立网络连接（切断逃逸后的外传与 C2 下载） |
| **无持久化** | 不能写文件，攻击者即使控制它也无法落地 |
| **强进程隔离** | 与 Messages 主进程完全分离，漏洞不直接等于消息数据访问 |
| **输出净化** | 只输出经过校验的结构化数据（受控 schema） |

### 3.3 真实效果：0-click 经济学的改变

BlastDoor 的最大价值不在于"完全防住"，而在于**大幅提高攻击成本**：

| 指标 | BlastDoor 之前 | BlastDoor 之后 |
|---|---|---|
| 一个解析器 0-day 的价值 | 直接获得高权限立足点 | 仅获得受限沙箱内立足点 |
| 需要的漏洞数量 | 1–2 个 | 至少：解析器漏洞 + BlastDoor 逃逸 + 提权 |
| 是否具备网络 | 立足即有 | 沙箱内无网络（需逃逸才能外传） |
| 0-click 链条成本 | 相对低 | **显著升高** |

**现实印证**：iOS 15 之后公开归因的 0-click iMessage 链数量明显下降，而 1-click WebKit 水坑链持续为主流。这是架构性防御改变攻击者经济模型的典型案例。

### 3.4 常被误解的部分（重要）

**误解一："BlastDoor 保护了 iOS 免受 WebKit 攻击"**
> ❌ 完全不成立。BlastDoor 只保护**消息解析路径**。Safari/WebKit 的攻击面与它无关。这解释了为什么 Coruna 与 DarkSword **绕开了消息面，选择 WebKit**——那里 BlastDoor 不参与。

**误解二："BlastDoor 是无懈可击的"**
> ❌ Project Zero 与多家研究机构已披露 BlastDoor 沙箱逃逸研究；其内部解析器（如正则、plist、归档解析）本身也是攻击面。

**误解三："有 BlastDoor 就不需要其他防护"**
> ❌ 它解决的是**特定高价值入口**（消息 0-click），不解决设备总体暴露。

---

## 4. 为什么 WebKit 链条仍然成功

### 4.1 结构性原因：渲染必须被放行

WebKit 链之所以**不受 BlastDoor 影响且难以在架构层阻断**，根本原因是：

> **网页渲染需要与图形栈高频、低延迟通信。这是功能必需，不能禁止。**

```
WebContent 进程
   ├─ 必须提交 GPU 命令缓冲          →  IOGPU / AGX 接口可达
   ├─ 必须与 WindowServer 合成       →  图形服务可达
   ├─ 必须使用 shared memory 传纹理  →  跨进程共享内存可达
   └─ 必须调用 libGFXShared / IOSurface → 内核对象映射可达
```

**每一条"功能必需"都是一条潜在逃逸通道。** 沙箱设计者的难题是：**不能为了安全砍掉功能**，因此只能对通道做参数校验——而校验逻辑本身就是攻击面。

### 4.2 攻击面选择的通用逻辑

从 Coruna / DarkSword 的实践中可提炼出攻击者的通道选择判据：

| 判据 | 说明 | 典型结果 |
|---|---|---|
| **沙箱必须放行** | 功能必需，不可能禁止 | GPU、WindowServer、shared memory |
| **实现复杂度高** | 语义复杂，验证易遗漏 | ANGLE 的 WebGPU → GL 转译层 |
| **代码相对年轻** | 审计密度低 | WebGPU（新 API）、ANGLE 移植 |
| **C/C++ 实现** | 内存安全缺陷概率高 | ANGLE、图形驱动 |
| **跨进程/跨权限边界** | 缺陷后果波及高权限侧 | GPU 服务、内核驱动 |
| **输入不受上层约束** | 参数由攻击者完全控制 | 命令流、缓冲区句柄 |

**DarkSword 的 ANGLE/WebGPU 选择是这六项判据的完全命中**——这并非偶然，而是系统性攻击面评估的结果。

### 4.3 iOS 沙箱层级的完整攻击地图

```
Layer 0  WebContent (Safari 渲染)
   │  受限：无网络、无文件、无数据访问
   │  可达：图形栈、部分 IPC
   ↓ [逃逸 A: GPU/ANGLE/WebGPU → IOGPUDevice 内核驱动]
Layer 1  GPU 服务 / 内核驱动上下文
   │  获得：内核侧内存操作能力
   ↓ [逃逸 B: XPC / Mach IPC 校验缺陷 → 特权守护进程]
Layer 1' 特权守护进程（如 networking / media）
   │  获得：系统级 API 访问
   ↓ [提权: 内核读写 + PAC 绕过 + KTRR/PPL/SPTM 对抗]
Layer 2  内核 root
   │  获得：任意进程控制、文件系统全域、Keychain 访问
   ↓
Layer 3  目标数据采集与外传
```

**Coruna 与 DarkSword 都走 Layer 0 → Layer 2 的路径，但选择了不同的逃逸通道（见下节）。**

---

## 5. Coruna 与 DarkSword 的逃逸路径对比

### 5.1 逃逸通道选择

| 维度 | Coruna | DarkSword |
|---|---|---|
| 主要逃逸通道 | GPU/ANGLE + IOGPUDevice 内核驱动（部分链使用其他 IPC 面） | ANGLE/WebGPU 两阶段逃逸 |
| 涉及 CVE 数量 | 多（每版本一条链，23 个 CVE 总量） | 少（集中 GPU 栈） |
| 是否借助媒体服务 | 主要靠内核提权后直接操作 | **是**，注入 mediaserverd 获取采集能力 |
| 逃逸与提权是否分离 | 分离（不同组件） | 部分耦合（同一驱动接口） |
| 对 BlastDoor 的依赖 | 无（不经过消息面） | 无 |

### 5.2 DarkSword 的两阶段逃逸结构

```
阶段 1：ANGLE 层（用户态图形转译）
  ├─ WebGPU API 调用被 ANGLE 转译为 Metal/GL 命令
  ├─ 构造非法参数触发转译层内存缺陷
  └─ 获得向 GPU 服务/驱动提交恶意命令的能力

阶段 2：IOGPUDevice / 内核驱动层
  ├─ 通过驱动接口的参数校验缺陷
  ├─ 触发内核侧越界读写
  └─ 获得内核读写原语 → 逃逸完成 + 提权基础
```

**设计巧妙之处**：WebContent 被允许"提交 GPU 命令"，但**命令的语义校验分布在多个层**。跨层的信任假设不一致，是这类逃逸的通用成因。

### 5.3 媒体服务注入的沙箱逻辑

DarkSword 在取得内核能力后注入 `mediaserverd`，这符合**最小自持原则**：

| 为什么不直接在受控内核里采集？ |
|--- |
| 内核态执行复杂业务逻辑风险高（易 panic，暴露明显） |
| 借合法进程执行可复用其已有权限与 entitlements |
| 进程行为与正常媒体使用混同，检测难度大 |
| 采集逻辑在用户态更易实现与调试 |

**这也说明**：沙箱的价值不止是"限制攻击者"，还包括"限制受害组件的失陷后果"。当 mediaserverd 被滥用，其权限范围即成为攻击者的能力范围。

---

## 6. 其他沙箱机制在链条中的位置

### 6.1 与沙箱协同的其他约束

| 机制 | 对链条的约束 | 攻击者应对 |
|---|---|---|
| **AMFI / 代码签名** | 未签名代码不能执行 | 复用合法代码（ROP/JOP）、利用 JIT 页、绕过 AMFI 的缺陷 |
| **PAC** | 跳转需合法签名 | 寻找签名预言机、复用已签名指针 |
| **KTRR / PPL** | 内核文本与页表只读 | ROP/JOP、寻找可写但影响安全的数据 |
| **SPTM / TXM** | EL2/EL3 强制隔离 | 转向受信任组件本身的缺陷 |
| **BlastDoor** | 消息解析隔离 | **绕开**（选择 WebKit 面） |
| **Exclaves** | 敏感操作独立执行域 | 目前相关攻击公开信息少 |
| **Data Protection / SEP** | 静态数据加密 | 需解锁状态 + 密钥包路径 |

### 6.2 Lockdown Mode 如何改变沙箱格局

| 措施 | 对沙箱/攻击面的影响 |
|---|---|
| **禁用 JIT** | 移除 JSC 缺陷这一最常见 L1 入口 |
| **禁用 WebGPU / WebGL** | **直接关闭 DarkSword 所依赖的整个逃逸通道** |
| **限制消息附件与预览** | 收紧 BlastDoor 上游输入面 |
| **阻断未知 iMessage 载荷** | 消除自动解析路径 |
| **关闭不需要的网络服务** | 限制外传 |

> **结论**：锁定模式对 DarkSword 类链条的打击是**结构性**的——它不是加固校验，而是**移除被允许的通道**。这正是"减少攻击面"优于"增强检测"的典型案例。

---

## 7. 防御启示

### 7.1 架构层面（Apple 已采用，值得自有产品借鉴）

| 原则 | 说明 | BlastDoor 是范例 |
|---|---|---|
| **把不可信解析推到最小权限沙箱** | 让单个解析器 bug 不直接等于高权限立足 | ✅ |
| **净化输出，而非仅校验输入** | 输出结构化安全数据，阻断"控制即高权限" | ✅ |
| **沙箱内禁网络、禁持久化** | 即使被控制也无法外传或驻留 | ✅ |
| **分层信任要明确校验责任** | 跨层假设不一致是逃逸根因 | ⚠️ 仍需改进（GPU 栈） |
| **减少功能必需的暴露通道** | 图形栈最难，故需强化驱动侧校验 | ⚠️ 当前主要弱点区 |

### 7.2 组织/用户层面

| 建议 | 理由 |
|---|---|
| **启用锁定模式（高危人群）** | 直接移除 WebGPU/JIT 通道，效果优于任何检测 |
| **优先修补 GPU/图形栈 CVE** | 当前逃逸主战场，泄露类同样优先 |
| **异构部署降低单点风险** | 若全员同一 iOS 版本，一次泄露即全员暴露 |
| **限制 WebKit 使用面** | 关闭 JS/预览等能减少入口 |
| **理解"沙箱不等于安全边界全部"** | 逃逸只需一条被放行的通道，防御需守住全部 |

### 7.3 检测视角（沙箱突破的可观测信号）

| 信号 | 含义 |
|---|---|
| **WebContent 大量 GPU 资源创建/销毁** | 堆塑形或驱动接口试探 |
| **WebContent 出现非渲染目的的异常系统调用** | 逃逸活动 |
| **IOGPU/AGX 驱动异常返回或崩溃** | 驱动侧利用尝试（**高价值证据**） |
| **mediaserverd 出现非媒体用途的线程/网络连接** | 注入成功后的行为 |
| **守护进程产生网络连接** | 沙箱边界已被打破 |
| **内核 panic / 异常日志含 GPU 相关符号** | 驱动利用失败的痕迹 |

---

## 8. 总结

| 结论 | 内容 |
|---|---|
| **1. iOS 的防御纵深本质是沙箱层次** | 攻击链的每个阶段对应打破一层边界；不存在"一个漏洞通吃" |
| **2. BlastDoor 是架构性防御的成功范例** | 它改变的是攻击成本结构（0-click 经济学），而非依赖检测 |
| **3. BlastDoor 不覆盖 WebKit，这被攻击者精确利用了** | Coruna/DarkSword 全部选择 1-click 网页面，绕开消息面 |
| **4. "功能必需"是沙箱无法闭合的裂缝** | 渲染必须触达图形栈，因此 GPU 成为当前最高价值逃逸面 |
| **5. 跨层信任假设不一致是逃逸通用成因** | ANGLE → GPU 服务 → 内核驱动，每层都假设上一层已校验 |
| **6. 减少攻击面优于检测攻击面** | 锁定模式移除 WebGPU/JIT，比任何运行时检测都更彻底 |
| **7. 驱动与图形栈是未来攻防主战场** | 修补优先级与检测投入应向此倾斜 |

**一句话总结**：

> BlastDoor 证明了一件正确的事——**把不可信的输入放进最小权限的沙箱，比在沙箱外加强检测更有效**。
> Coruna 与 DarkSword 证明了另一件事——**只要存在一条"功能必需"的暴露通道（图形栈），攻击者就会找到它**。
> 防御的下一步，是把 BlastDoor 的设计哲学应用到那些"最难收紧"的通道上。

---

## 参考来源

- Apple: [iOS Security Guide](https://www.apple.com/business/docs/resources/iOS_Security_Guide.pdf)
- Apple: [About Lockdown Mode](https://support.apple.com/en-us/105098)
- Google Project Zero: [BlastDoor 相关研究与 iOS 15 安全分析](https://googleprojectzero.blogspot.com/)
- Google Project Zero: [A new zero-click exploit chain targeting iOS (DarkSword)](https://googleprojectzero.blogspot.com/2024/01/a-new-zero-click-exploit-chain-targeting-ios.html)
- Citizen Lab: [Coruna 逃逸链与 CVE 覆盖分析](https://citizenlab.org/)
- Synacktiv: [Escaping the Safari Sandbox: a tour of WebKit IPC](https://www.synacktiv.com/publications/escaping-safari-sandbox-tour-of-webkit-ipc)
- WWDC: [Advances in iOS Security / Preparing for future exploits](https://developer.apple.com/videos/)
- 8ksec: [iOS Sandbox & IOKit Research](https://blog.8ksec.com/)
- Apple Security Updates: [Apple Security Releases](https://support.apple.com/en-us/HT201222)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
