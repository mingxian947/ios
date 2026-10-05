# iOS 沙箱逃逸（Sandbox Escape）· 分析文章

> 编制日期：2026-10-02
> 数据来源：Google Project Zero、Synacktiv、8ksec、CSA、公开 CVE 情报
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. 什么是沙箱，为什么攻击者必须"逃逸"

iOS 采用**强制访问控制沙箱（Seatbelt / sandbox profile）**：每个进程（尤其是处理不可信内容的进程）被限制在极小权限内——不能随意读文件、不能访问其他应用数据、不能直接碰硬件与内核接口。

对攻击者而言，即便通过 **WebKit RCE** 控制了 **WebContent 渲染进程**，也仍被困在沙箱里：拿不到用户数据、无法持久化、无法提权。因此**沙箱逃逸（Sandbox Escape）是连接"网页代码执行"与"完整设备沦陷"的必经环节**：

```
WebKit RCE (WebContent 进程内代码执行)
        │   ← 仍受沙箱限制
[沙箱逃逸]  借助第二个漏洞突破进程/权限边界
        │
内核提权 (root / 内核读写)
        │
完整设备沦陷
```

---

## 2. iOS 沙箱逃逸的常见攻击面

逃逸的本质是：**让被沙箱限制的进程，去触达一个权限更高、且存在缺陷的组件**。常见攻击面：

| 攻击面 | 说明 | 典型例子 |
|---|---|---|
| **WebKit IPC / 绑定层** | WebContent 通过 IPC 调用更高权限的服务（如网络、存储、GPU 服务）；IPC 校验缺陷可被滥用 | Synacktiv《Escaping the Safari Sandbox: a tour of WebKit IPC》 |
| **GPU / 图形栈（ANGLE / WebGPU / IOKit）** | 渲染进程可与 GPU 驱动/图形服务交互；驱动或 ANGLE 层缺陷可成为逃逸跳板 | DarkSword 经 ANGLE/WebGPU 层逃逸；CVE-2025-43529 链条 |
| **Mach / 内核相邻 IPC** | Mach 端口、voucher、IPC 消息处理缺陷 | 历史多条在野链条组件 |
| **IOKit 驱动** | 用户态可 reach 的内核驱动接口存在内存缺陷 | 经典 iOS 逃逸/提权面 |
| **媒体 / 后台服务** | 将恶意指令导入后台媒体服务等更高权限进程 | DarkSword 将指令导入后台媒体服务 |

**关键洞察**：沙箱逃逸很少是"单一漏洞"，而是**利用被允许的系统调用/IPC 通道 + 该通道上更高权限组件的缺陷**。攻击者优先选择沙箱"放行"的接口（GPU、IPC、媒体），因为这些是沙箱内进程合法可达的。

---

## 3. 代表性案例与 CVE

| CVE / 案例 | 组件 | 作用 | 备注 |
|---|---|---|---|
| CVE-2025-43529 | JavaScriptCore（DFG 层 GC 缺陷） | 提供 WebContent 内 RCE 与内存原语 | iOS 18.6–18.7；DarkSword 链条基础，逃逸经 ANGLE/GPU 层完成 |
| CVE-2025-24201 | WebKit（越界写） | 沙箱逃逸 | 在野/公开分析 |
| Project Zero 2023 在野分析 | Safari WebContent → 逃逸 | 首个系统化的在野 WebContent 沙箱逃逸剖析 | 揭示 IPC/驱动逃逸手法 |
| CVE-2023-32434 等 | WebKit/内核 | 链条组件 | 历史在野利用 |

**DarkSword 的逃逸路径（示例）**：
1. CVE-2025-43529（JSC GC 缺陷）→ WebContent 内 RCE + 任意读写原语
2. 经 **ANGLE / WebGPU（GPU 渲染栈）** 将恶意指令导入**后台媒体服务**，脱离浏览器沙箱
3. 再经 dyld / 内存管理缺陷（如 CVE-2026-20700、CVE-2025-43510/43520）提权至 root

---

## 4. Apple 的反逃逸缓解

- **细粒度沙箱 profile**：WebContent 等进程默认拒绝绝大多数系统调用与文件访问。
- **PAC（指针认证）**：抬高劫持控制流、伪造 IPC/驱动对象的难度。
- **PPL / 内核完整性保护**：限制逃逸后进一步改写内核。
- **IPC 校验与最小权限**：收紧高权限服务对来自渲染进程请求的验证。
- **驱动加固（IOKit/驱动 kit 化）**：把驱动移入用户态/受限环境，缩小内核攻击面。
- **Lockdown Mode**：禁用/收紧 GPU 特性、JIT 与部分 IPC 通道，**直接切断多条逃逸路径**（Coruna/DarkSword 检测到该模式会主动中止）。

**攻防趋势**：沙箱与缓解越强，逃逸越依赖"合法可达接口上的零日"（GPU、IPC、媒体服务），并与其他零日组合；单一逃逸漏洞价值下降，**全链条零日组合**成为主流。

---

## 5. 检测与防护建议

### 个人 / 高危用户
1. **保持系统最新**：逃逸漏洞修复依赖系统更新。
2. **高危时启用 Lockdown Mode**：切断 GPU/JIT/部分 IPC 逃逸路径。

### 企业 / 组织
3. 补丁管理覆盖全部 Apple 设备与 BYOD。
4. 移动端 EDR/MTD 关注：WebContent 异常崩溃后紧跟 GPU/媒体服务异常调用、异常 IPC/Mach 消息、异常 dyld 加载。
5. 对高价值人群分层防护（Lockdown Mode + 专用网络 + 行为监控）。

### 研究 / 防御团队
6. 以"沙箱内合法可达接口"为威胁建模起点：GPU/ANGLE、WebKit IPC、媒体服务、IOKit。
7. 回归测试 Project Zero / 厂商披露的逃逸 CVE 补丁；监控全链条零日组合情报。

---

## 6. 结论

沙箱逃逸是 iOS 全链条攻击的**中枢环节**：它把被限制的 WebContent 代码执行，转化为对更高权限组件的触达，进而衔接内核提权与完整沦陷。逃逸不靠"硬闯"沙箱，而靠**滥用沙箱放行的接口（GPU、IPC、媒体、驱动）上的缺陷**。Apple 通过细粒度沙箱、PAC、PPL、驱动 kit 化与 Lockdown Mode 持续收紧这些通道，推动攻击向"多零日组合"演进。**防御要点：及时补丁 + Lockdown Mode + 针对 GPU/IPC/媒体服务异常行为的运行时检测。**

---

## 参考来源
- [An analysis of an in-the-wild iOS Safari WebContent sandbox escape — Google Project Zero](https://projectzero.google/2023/10/an-analysis-of-an-in-the-wild-ios-safari-sandbox-escape.html)
- [Escaping the Safari Sandbox: A tour of WebKit IPC — Synacktiv](https://www.synacktiv.com/sites/default/files/2024-05/escaping_the_safari_sandbox_slides.pdf)
- [A Case Study of CVE-2025-43529 (DarkSword iOS Chain) — 8ksec](https://www.8ksec.io/how-browser-exploits-work-darksword-ios-cve-2025-43529/)
- [CVE-2025-24201: Sandbox Escape via OOB Write — Fidelis Security](https://fidelissecurity.com/vulnerabilities/cve-2025-24201/)
- [Escaping the Safari Sandbox in iOS 16 — Objective by the Sea](https://objectivebythesea.org/v6/talks/OBTS_v6_iBeer.pdf)
- [The Proliferation of DarkSword: iOS Exploit Chain — Google Cloud Threat Intelligence](https://cloud.google.com/blog/topics/threat-intelligence/darksword-ios-exploit-chain)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
