# iOS 内核提权（Kernel Privilege Escalation）· 分析文章

> 编制日期：2026-10-02
> 数据来源：Google Project Zero / Threat Intelligence、Jamf、Trend Micro、CSA、公开 CVE 情报
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. 为什么内核提权是攻击链的"最后一道门"

在 iOS 全链条攻击中，攻击者依次突破：

```
WebKit RCE (WebContent)  →  沙箱逃逸  →  [内核提权]  →  完整设备沦陷
```

即便完成沙箱逃逸，攻击者通常仍只是**一个高权限用户态进程**，无法：
- 读写任意应用数据 / 钥匙串
- 关闭完整性保护、安装持久化 implant
- 绕过代码签名运行任意代码

**内核（XNU）掌控一切**：内存管理、进程凭证、驱动、完整性策略。因此**内核提权（把权限提升到 root / 获得内核读写）是达成"完整设备沦陷"的最终且必需的一步**。

---

## 2. iOS 内核的多层保护（提权要逐层击穿）

Apple 在内核层叠加了多道缓解，提权漏洞往往需要**组合突破**：

| 保护机制 | 作用 | 被绕过时的影响 |
|---|---|---|
| **KASLR** | 内核地址随机化 | 需信息泄露定位内核 |
| **PAC（指针认证）** | 控制流指针签名 | 绕过后可劫持控制流 |
| **PPL（Page Protection Layer）** | 保护内核页表/关键内存不被任意改写 | 绕过后可改内核结构 |
| **KTRR / SPTM** | 限制内核文本/页表可写性、隔离特权监控 | 绕过后可注入/改代码 |
| **代码签名 + AMFI** | 仅允许签名代码执行 | 绕过后可运行任意代码 |
| **W^X / 页权限** | 内存页不可同时可写可执行 | 绕过后可执行注入代码 |

**提权的典型子步骤**：信息泄露（破 KASLR）→ 内核内存破坏（获得内核读写）→ 绕过 PPL/KTRR/PAC → 覆写进程凭证（cred）提权至 root / 关闭完整性检查。

---

## 3. 内核提权的主要漏洞类型与代表 CVE

| 类型 | 说明 | 代表 CVE |
|---|---|---|
| **内核/驱动内存破坏** | UAF、越界写、类型混淆，位于 XNU 或 IOKit 驱动 | CVE-2023-32434、CVE-2025-43510、CVE-2025-43520 |
| **硬件/MMIO 保护绕过** | 绕过 GPU/硬件 MMIO 映射保护，获得越权内存访问 | CVE-2023-38606 |
| **动态链接/签名校验缺陷** | dyld 等加载器弱点，禁用签名校验与页所有权保护 | CVE-2026-20700 |
| **内存管理缺陷** | 页管理/对象缓存缺陷，用于提权或内核读写 | CVE-2025-43510/43520、CVE-2021-30952 等 |
| **IPC/Mach 内核接口缺陷** | Mach 陷阱、voucher 等处理错误 | 历史在野链条组件 |

**DarkSword 的内核阶段（示例）**：
1. 经 **dyld 弱点（CVE-2026-20700）** 禁用 Apple 签名校验与页所有权保护
2. 再以**内存管理缺陷（CVE-2025-43510 / CVE-2025-43520）** 提权至 **root**
3. 获得内核读写后注入系统服务、窃取机密、清除痕迹

**Coruna 的内核阶段（示例）**：组合 CVE-2023-32434（内核内存破坏）与 CVE-2023-38606（MMIO 保护绕过）等完成提权与持久化。

---

## 4. 攻防趋势

- **单漏洞提权越来越难**：PPL/KTRR/PAC/签名多层叠加，攻击者需"泄露 + 破坏 + 绕过"多原语组合。
- **转向驱动与加载器**：IOKit 驱动、dyld/加载器、硬件映射（MMIO）成为高价值提权面。
- **与零日组合**：内核零日通常与 Web 零日、沙箱逃逸零日打包成全链条（Coruna/DarkSword）。
- **无持久化配合**：提权后短时完成目标即清除，减少被取证发现（DarkSword）。

---

## 5. 检测与防护建议

### 个人 / 高危用户
1. **保持系统最新**：内核提权修复依赖系统更新（如 DarkSword 相关修复于 iOS 18.7.x / 26.3）。
2. **高危时启用 Lockdown Mode**：收紧攻击面，使多数全链条（含提权前置环节）失效。

### 企业 / 组织
3. 补丁管理覆盖全部 Apple 设备与 BYOD；建立版本基线。
4. 移动端 EDR/MTD 关注：异常内核级行为迹象（完整性校验异常、异常 dyld 加载、签名校验被绕过的迹象、钥匙串异常批量访问）。
5. 对高价值人群分层防护（Lockdown Mode + 专用网络 + 行为监控）。

### 研究 / 防御团队
6. 威胁建模聚焦：IOKit 驱动、dyld/加载器、MMIO/硬件映射、Mach 内核接口。
7. 回归测试 Project Zero / 厂商披露的内核提权 CVE 补丁；跟踪全链条零日组合情报。

---

## 6. 结论

内核提权是 iOS 攻击链的**最终闸门**：只有击穿 KASLR/PAC/PPL/KTRR/代码签名等多层保护、获得内核读写或 root，攻击者才能从"受限进程"变为"掌控设备"。提权漏洞以**内核/驱动内存破坏、MMIO 绕过、加载器/签名缺陷、内存管理缺陷**为主，且几乎总是与 Web 零日、沙箱逃逸零日组合使用。Apple 的多层内核缓解持续抬高门槛，推动攻击向"多零日 + 多原语组合 + 无持久化"演进。**防御要点：及时补丁 + Lockdown Mode + 针对内核级异常行为的运行时检测。**

---

## 参考来源
- [A very deep dive into iOS Exploit chains found in the wild — Google Project Zero](https://projectzero.google/2019/08/a-very-deep-dive-into-ios-exploit.html)
- [Running code in the context of iOS Kernel: LPE PoC — Jamf](https://www.jamf.com/blog/running-code-in-the-context-of-ios-kernel-part-i-lpe-poc-on-ios-137/)
- [The Proliferation of DarkSword: iOS Exploit Chain — Google Cloud Threat Intelligence](https://cloud.google.com/blog/topics/threat-intelligence/darksword-ios-exploit-chain)
- [Diving into an Old Exploit Chain and Discovering 3 new SIP bypasses — Trend Micro](https://www.trendmicro.com/en_us/research/22/l/diving-into-an-old-exploit-chain-and-discovering-3-new-sip-bypas.html)
- [Coruna iOS Exploit Kit: Observed Traffic — Centripetal](https://www.centripetal.ai/threat-research/coruna-ios-exploit-kit)
- [Coruna (exploit kit) — Wikipedia](https://en.wikipedia.org/wiki/Coruna_(exploit_kit))

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
