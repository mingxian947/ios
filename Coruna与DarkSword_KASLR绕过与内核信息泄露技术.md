# Coruna 与 DarkSword KASLR 绕过与内核信息泄露技术

> 编制日期：2026-10-18
> 数据来源：Google Project Zero、XNU 开源源码、Synacktiv、8ksec、Marks (Alex Ions)、Apple 安全公告
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. 执行摘要

**KASLR（Kernel Address Space Layout Randomization）** 是内核利用的第一道门槛。攻击者即便获得了任意读写原语，如果不知道内核代码与数据在哪里，也无法完成提权。

在 iOS 攻击链中，**信息泄露（Information Disclosure）是与代码执行同等重要的独立能力**——它决定了后续每一步"往哪里读写"。Coruna 与 DarkSword 都必须在链条早期解决泄露问题，而其解决方式深刻反映了两代攻击面的演化。

本文系统梳理：

1. iOS KASLR 模型的真实结构（内核 slide、dyld shared cache slide、用户态随机化）
2. 内核地址泄露的**五类来源**及其在 XNU 中的成因
3. Coruna 与 DarkSword 各自的泄露路径与依赖组件
4. Mach 端口、kobject、IPC 消息等**结构性泄露面**
5. PAC、SPTM/TXM 如何改变泄露与利用的成本
6. 防御者如何从 CVE 类型反推链条阶段、并评估补丁有效性

---

## 2. iOS 的地址随机化模型

### 2.1 三层随机化

iOS 上"随机化"实际包含多个独立机制，攻击者需分别解决：

```
┌─────────────────────────────────────────────┐
│ ① 内核 slide（kernel slide / kslide）        │
│    内核 Mach-O 映像被加载到随机基址            │
│    → 内核函数、全局变量、静态数据地址未知       │
├─────────────────────────────────────────────┤
│ ② dyld shared cache slide                    │
│    系统框架与库打包为共享缓存，整体随机映射      │
│    → libSystem、Foundation 等地址未知          │
├─────────────────────────────────────────────┤
│ ③ 用户态堆与栈随机化                          │
│    libmalloc 分配器随机化、栈位置随机            │
│    → 进程内布局不确定，需要堆塑形               │
└─────────────────────────────────────────────┘
```

| 随机化 | 熵量级 | 突破所需 |
|---|---|---|
| 内核 slide | 受页对齐与地址空间约束，实际可搜索空间远小于理论值 | 一个内核指针/一个可暴力搜索的判定 |
| dyld shared cache slide | 同上 | 进程内任一系统库函数指针 |
| 用户态堆 | 相对低 | 分配/释放模式控制（堆塑形） |

**关键工程事实**：`kslide` 的对齐粒度与地址空间限制，使**可穷举空间在实践中常小于"必须泄露"的门槛**。历史上多条 iOS 链条通过暴力搜索 kslide（而非精确泄露）完成定位——这会消耗时间并提高崩溃概率，但确实可行。

### 2.2 内核 slide 的攻击意义

一旦知道 `kslide`，攻击者可计算：

- 任意内核函数地址（`符号地址 + kslide`）
- 关键全局结构（如 `allproc`、各类开关变量）
- PAC 密钥与相关表的位置
- 各类操作函数表（vnode ops、fileops、syscall 表）

**因此"泄露 kslide"几乎是所有内核利用的第一个必要步骤。**

### 2.3 KASLR 与 PAC 的分工

| 机制 | 防的是什么 |
|---|---|
| KASLR | 让攻击者**不知道**地址 |
| PAC | 让攻击者**即使知道地址也不能随意跳转**（指针带签名） |

两者必须同时突破：只解决 KASLR 而没绕过 PAC，控制流劫持仍会触发签名校验失败（崩溃）。Coruna/DarkSword 链条中，泄露阶段在前、PAC 绕过在后，正是这一逻辑的体现。

---

## 3. 内核信息泄露的五类来源

信息泄露不是一个漏洞类型，而是**多种缺陷模式的共同后果**。以下五类覆盖了 iOS 历史上的主要泄露面。

### 3.1 类型一：未初始化内存泄露（Info Leak via Uninitialized Memory）

**成因**：结构体在内核栈/堆上声明后未清零，直接拷贝到用户态。

```
内核态:
  struct some_reply reply;      // 栈上，含 padding/未赋值字段
  reply.field_a = ...;
  copyout(&reply, userbuf, sizeof(reply));  // 未赋值部分泄露内核栈内容
```

**泄露内容**：内核栈上的残留值，往往包含**返回地址、kobject 指针、slide 相关量**。

| 特征 | 说明 |
|---|---|
| 常见位置 | IOKit 用户客户端方法、Mach 系统调用返回结构、XPC 回复 |
| 利用难度 | 低（直接读取即可） |
| 检测难度 | 高（正常功能不受影响，无异常行为） |
| 修补方式 | `bzero` / `= {0}` 初始化；Apple 大量 CVE 属此类 |

### 3.2 类型二：越界读取（Out-of-Bounds Read）

**成因**：长度/索引校验缺失，读取超出分配区域的内存。

**在 WebKit 中的特殊性**：这是 JSC 链条最主要的泄露方式。
- 类型混淆后，把一个对象当作另一种尺寸/类型的对象处理
- 读取"越界"部分实际落在**相邻堆块**，其中可能包含其他对象的指针
- 通过指针与已知的对象地址做差，推算出 shared cache base / kslide

**Coruna 的路径示例**（CVE-2024-23222 类）：

```
JSC 类型混淆
  → 获得"读任意相邻内存"能力
  → 读取其他 JS 对象的内部指针（指向 JSC 堆、指向共享缓存）
  → 计算 dyld shared cache slide
  → 继续读取，寻找内核侧泄露线索
```

### 3.3 类型三：Mach 端口与 kobject 泄露

这是 iOS 内核研究中最经典、也最强大的泄露面。

**原理**：
- XNU 用 `ipc_kmsg` / port 结构在内核中管理 Mach 端口
- 端口的 `ip_kobject` 字段指向对应的内核对象（如 `proc` 结构）
- 某些 API 会让用户态得到与内核对象关联的信息

**攻击价值**：
- 若泄露某进程的 `proc` 结构地址 → 该进程凭证（`ucred`）可被改写 → **提权**
- `proc` 结构的定位通常需要 kslide

**历史上被滥用的接口类型**（用于泄露/构造）：
- `host_get_special_port`、`mach_port_*` 系列
- 某些 `mach_msg` 回复结构
- `thread_get_state` 等状态读取

### 3.4 类型四：内核地址通过异常/崩溃路径泄露

| 途径 | 说明 |
|---|---|
| **异常信息（exception message）** | 某些异常上报中携带地址信息 |
| **`thread_get_state`** | 读取线程寄存器状态，可能含内核返回地址 |
| **Crash Report** | 调用栈含内核地址（对攻击者是情报，对防御者是证据） |
| **系统日志** | 内核告警/panic 日志中的地址 |

**特殊意义**：这类泄露"泄露在错误路径上"，功能正常时不可见，因此**长期存在风险**。

### 3.5 类型五：结构性/侧信道泄露

| 手法 | 说明 |
|---|---|
| **页表/映射时间差** | 通过访问时延推断地址布局（较脆弱，受缓解影响大） |
| **共享内存/映射重叠** | 用户态映射与内核布局关系推导 |
| **图形/GPU 驱动接口** | 驱动返回的缓冲区句柄含内核侧信息 |
| **文件/IO 接口返回值** | I/O Kit 方法输出结构未清零 |
| **`vm_remap`/共享缓存探测** | 通过映射行为推断系统库基址 |

**趋势观察**：随着传统 Mach/IOKit 泄露被逐步修补，攻击者越来越多转向**图形栈与驱动接口**——这正是 DarkSword 选择 ANGLE/GPU 面所面对的同一趋势。

---

## 4. Coruna 的泄露策略

### 4.1 以 WebKit 原语为泄露起点

Coruna 的核心特征是**从 JSC 漏洞派生出所有后续能力**：

```
[CVE-2024-23222 JSC 类型混淆]
        ↓
[addrof / fakeObj]        ← 地址 ↔ 对象双向转换原语
        ↓
[Relative Read / Write]   ← 相对某基址的读写能力
        ↓
[扫描相邻内存]            ← 寻找含系统库/内核指针的对象
        ↓
[dyld shared cache slide] ← 用户态代码/ROP gadget 可用
        ↓
[内核侧泄露（经驱动/IPC 通道）]
        ↓
[kslide]
```

### 4.2 多链 = 多泄露路径

Coruna 维护 5 条链覆盖 iOS 13–17.2.1，其含义是**每个版本窗口需要不同的泄露组件**：

| 版本窗口 | 泄露面特征 |
|---|---|
| iOS 13–14 | JSC 老组件漏洞 + 宽松的 Mach 接口；kslide 常可暴力搜索 |
| iOS 15 | IOKit/GPU 驱动泄露增多，PAC 普及使纯 ROP 变难 |
| iOS 16 | JIT 硬化、更严格的 IPC 校验，泄露窗口收窄 |
| iOS 17.0–17.2.1 | 需组合多个 CVE 才能凑齐泄露 + 写原语 |

**关键推论**：Coruna 之所以需要 23 个 CVE，正是因为**每个版本修补了上一代所用的泄露面**，必须找到替代来源。

### 4.3 泄露的复用设计

Coruna 工程上的成熟之处在于**泄露模块的复用**：一旦取得 kslide 与 shared cache base，后续所有阶段（PAC 绕过、逃逸、提权）都基于这两个值计算地址，形成统一地址模型。

---

## 5. DarkSword 的泄露策略

### 5.1 DFG GC 缺陷作为泄露源

DarkSword 的起点（CVE-2025-43529 一类，JSC DFG 层 GC 缺陷）在泄露能力上有其特点：

| 特点 | 说明 |
|---|---|
| **由 GC 状态不一致触发** | GC 回收/移动对象时，DFG 优化的假设与实际不符 |
| **天然产生"悬垂引用"** | 对象已被释放但引用仍存在 → 读取已释放内存（UAF 式泄露） |
| **堆相邻性可利用** | 已释放块会被新对象复用，可精确控制读到什么 |
| **确定性较高** | GC 触发时机可控，比纯类型混淆更易稳定复现 |

### 5.2 泄露与逃逸耦合在图形栈

DarkSword 的独特之处：**它的内核侧泄露与沙箱逃逸发生在同一个攻击面（GPU/ANGLE）**。

```
[WebContent 内: JSC 泄露 → shared cache base → 用户态原语]
        ↓
[GPU 服务/内核驱动接口: 构造非法参数]
        ↓
[驱动返回结构未清零 → 泄露内核地址 → kslide]
        ↓
[同一驱动接口的另一缺陷 → 任意内核读写 → 逃逸 + 提权]
```

**工程优势**：一个组件同时提供逃逸路径与泄露来源，减少链条长度与不确定性。
**工程代价**：单点依赖，该组件一旦被修补整链失效。

### 5.3 无持久化对泄露的影响

DarkSword 不落地，因此其**泄露结果只存在于内存中，会话结束即消失**：

- 无法把 kslide 等值保存下来供下次使用
- 每次重启后需完整重新计算
- 这要求泄露步骤**必须足够快且高成功率**（不能长时间暴力搜索）

这一约束反过来解释了 DarkSword 为什么偏好**确定性泄露**（结构性读取）而非**暴力搜索**。

---

## 6. 对比分析

| 维度 | Coruna | DarkSword |
|---|---|---|
| 初始泄露来源 | JSC 类型混淆 | JSC DFG GC 缺陷 |
| 用户态基址 | 扫描相邻对象指针推导 | 同类方法，更侧重 UAF 读取 |
| 内核基址来源 | 多版本各异（IPC/IOKit/驱动） | 集中于 GPU/驱动接口 |
| 是否使用 kslide 暴力搜索 | 老版本链常见 | 尽量避免（时间约束） |
| 泄露与逃逸是否同面 | 分离（不同组件） | 耦合（同为 GPU 面） |
| 版本适配方式 | 每版本一条独立链 | 窄窗口单链 |
| 泄露结果留存 | 可持久化 | 仅内存、重启丢失 |
| CVE 消耗（泄露类） | 多个（分散） | 少但关键 |

---

## 7. 缓解机制如何改变泄露与利用

### 7.1 PAC（Pointer Authentication Code）

| 影响 | 说明 |
|---|---|
| 限制 | 泄露到地址后不能直接跳转（签名校验） |
| 攻击者应对 | 寻找合法签名的指针（签名预言机）、复用已有签名指针、利用 PAC 密钥可预测的实现缺陷 |
| 净效果 | 抬高了"泄露→控制流"的转换成本，但**未消除对泄露的需求** |

### 7.2 KTRR / PPL

| 机制 | 影响 |
|---|---|
| **KTRR** | 只读保护内核文本与页表；即使获得任意写也无法直接改代码 → 必须改 PPL 保护状态或使用 ROP/JOP |
| **PPL** | 限制谁可修改关键安全结构 → 需寻找 PPL 信任绕过或影响 PPL 的组件 |
| 对泄露的影响 | 间接：使"写入"变难，从而更依赖精确泄露（无法靠猜） |

### 7.3 SPTM / TXM（A17+ 新架构）

| 变化 | 说明 |
|---|---|
| SPTM 在 EL2 强制页表隔离 | 内核即使被写也无法破坏受信任状态，绕过难度显著提升 |
| TXM 作为独立可信监视器 | 关键策略由硬件强制，不再依赖内核自觉 |
| 对泄露的影响 | 地址随机化与权限模型更严格，泄露价值下降、利用成功率下降 |

**趋势判断**：硬件层强制机制正在让"仅靠泄露 + 写原语即提权"的经典模型失效。这也是新一代链条必须寻找**受信任组件缺陷**（如 GPU 驱动、媒体服务）的原因之一。

### 7.4 JIT 硬化与 Lockdown Mode

| 措施 | 对泄露链的影响 |
|---|---|
| JIT 硬化（Gigacage、指针分流、copy-on-write 页保护） | 削弱 JSC 内构造稳定原语的能力 |
| **Lockdown Mode 禁用 JIT** | **直接切断整条泄露链起点**——无 JIT 即无 DFG 层，无 DFG 即无此类缺陷可利用 |

> 这是锁定模式最有效的价值之一：它不是在链条末端加防护，而是**移除链条的第一步**。

---

## 8. 防御者视角：从 CVE 类型推断链条阶段

泄露类 CVE 的公开，本身就是攻击链情报。以下为实用推断表：

| CVE 描述特征 | 对应的链条阶段 | 攻击价值 |
|---|---|---|
| "Improper memory initialization"、"may disclose sensitive information" | 内核/驱动信息泄露 | **高**——使 KASLR 失效 |
| "Type confusion in JavaScriptCore" | L1 执行 + L2 原语 | **极高**——链条起点 |
| "Out-of-bounds read in WebKit" | 用户态泄露 | 高 |
| "Use-after-free read" | 泄露（若为 read） | 中高 |
| "Validation issues in IOGPU / AGX / AppleParavirtGPU" | 逃逸 + 内核泄露 | **极高**（DarkSword 面） |
| "Improper access control in IOKit kernel extension" | 逃逸/提权 | 高 |
| "Memory corruption in mediaserverd / CoreMedia" | 注入/采集能力 | 中高 |
| "Buffer overflow in ImageIO / CoreText" | 0-click 面 | 极高 |

### 8.1 补丁优先级实践

| 原则 | 说明 |
|---|---|
| **信息泄露 CVE 常被低估** | 它不直接导致 RCE，但它是所有内核利用的必要前提，应与 RCE 同等优先 |
| **一个链条 = 多个 CVE** | Apple 单次更新修补数十个 CVE，其中往往是同一套件用到的组合；关注"批量修补"信号 |
| **修补时间线可反推攻击活跃期** | 某 CVE 被"紧急单独修补"通常意味着在野利用被发现 |
| **关注 GPU/图形栈** | 该面近年从低关注变为高价值，属于当前漏洞密度上升趋势区 |

### 8.2 资产暴露评估方法

结合本仓库 #15（Coruna 影响版本分析）：

```
1. 清点设备 iOS 版本分布
2. 对每个版本，检查该版本的已知泄露类 CVE 是否已修补
3. 若某版本存在"泄露 + JSC RCE + 逃逸"三类已修补漏洞
   → 该版本处于可利用窗口（若攻击者持有旧 exploit）
4. 优先级 = 版本暴露面 × 人群风险 × 补丁部署时延
```

**结论性建议**：**把"是否存在任一已知泄露类 CVE"作为暴露判据**，比询问"是否有 RCE"更早一步切断链条。

---

## 9. 总结

| 结论 | 内容 |
|---|---|
| **1. 泄露是与执行同等重要的独立能力** | 链条中每一层的地址都要靠泄露确定；没有泄露，读写原语毫无用处 |
| **2. KASLR 的实际强度受工程约束限制** | 对齐粒度与可搜索空间使暴力搜索在部分版本上可行，"熵"不等于"安全" |
| **3. 五类泄露来源反映攻击面迁移** | 从 Mach/IOKit 传统面 → JSC 相邻内存 → GPU/驱动结构面，修补史就是迁移史 |
| **4. Coruna 靠广度、DarkSword 靠耦合** | 多链多泄露路径 vs 单一组件同时提供逃逸与泄露 |
| **5. 硬件强制正在改写规则** | SPTM/TXM 让"泄露 + 任意写 = 提权"的经典范式失效，迫使攻击者转向受信任组件 |
| **6. 禁用 JIT 从根上移除链条** | 锁定模式消除 DFG/JIT 缺陷这一最常见起点，性价比远超末端防护 |
| **7. 泄露类 CVE 应与 RCE 同优先级修补** | 低估其价值是组织暴露的常见根因 |

---

## 参考来源

- Google Project Zero: [A new zero-click exploit chain targeting iOS (DarkSword)](https://googleprojectzero.blogspot.com/2024/01/a-new-zero-click-exploit-chain-targeting-ios.html)
- Alex Ions: [Attacking iOS Kernel IPC](https://ioncodes.space/)
- XNU Open Source: [Apple Open Source — xnu](https://opensource.apple.com/source/xnu/)
- Synacktiv: [iOS Kernel Exploitation](https://www.synacktiv.com/en/publications)
- 8ksec: [iOS Kernel Exploitation Series](https://blog.8ksec.com/)
- Microsoft Security Intelligence: [Breaking PAC: Pointer Authentication on Apple A7-A11](https://www.microsoft.com/en-us/security/blog/)
- Apple Security Updates: [Apple Security Releases](https://support.apple.com/en-us/HT201222)
- Citizen Lab: [Coruna 版本与 CVE 覆盖分析](https://citizenlab.org/)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
