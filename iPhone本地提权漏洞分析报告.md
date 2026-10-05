# iPhone 本地提权漏洞（Local Privilege Escalation, LPE）· 分析报告

> 编制日期：2026-10-02
> 数据来源：Google Project Zero、Jamf、CIS Advisory、SentinelOne、Apple 安全公告、公开 CVE 情报
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. 什么是本地提权（LPE）

**本地提权（Local Privilege Escalation, LPE）** 指攻击者**已在设备上拥有低权限代码执行**（如一个普通 App、沙箱内进程、或 Web RCE 后的 WebContent 进程），利用漏洞把权限**提升到 root / 内核**。

与"远程代码执行（RCE）"的区别：
- **RCE**：从"无代码执行"到"有代码执行"（需投递，如 Web 零日、iMessage 零点击）。
- **LPE**：从"有低权限代码执行"到"高权限（root/内核）"（**假设已有立足点**）。

在 iOS 全链条中，**LPE 是"初始访问之后、完整沦陷之前"的关键一步**：

```
[初始访问 RCE / 恶意 App]  →  [沙箱逃逸]  →  [本地提权 LPE → root/内核]  →  数据窃取/持久化
```

> 恶意 App 场景：用户安装了一个看似正常的 App（或企业签名/描述文件侧载），App 内利用 LPE 漏洞提权——**无需任何远程投递**，是"本地"提权的典型。

---

## 2. LPE 的漏洞类型（按被击穿的内核/系统组件）

| 类型 | 说明 | 代表 CVE / 案例 |
|---|---|---|
| **内核内存破坏** | XNU 中 UAF / 越界写 / 类型混淆，获得内核读写后覆写凭证提权 | CVE-2023-32434、CVE-2025-43510、CVE-2025-43520、CVE-2026-20687 (UAF) |
| **IOKit 驱动缺陷** | 用户态可达的内核驱动接口内存缺陷 | Project Zero《A survey of recent iOS kernel exploits》多例 |
| **Mach 陷阱 / IPC 缺陷** | 内核 Mach 接口、voucher、端口处理错误 | 历史在野链条 |
| **加载器 / 签名校验缺陷** | dyld 等禁用签名校验/页所有权，允许提权后运行任意代码 | CVE-2026-20700 |
| **硬件 / MMIO 绕过** | 绕过 GPU/硬件映射保护，辅助提权或绕内存保护 | CVE-2023-38606 |
| **沙箱/容器策略缺陷** | 沙箱 profile 或容器权限配置错误，使低权限进程越权 | 研究级 |
| **PPL/KTRR 绕过（提权使能）** | 突破内核完整性保护，使内核读写/提权成立 | Dopamine/越狱研究、DarkSword 链条 |

**提权的典型子步骤**：信息泄露（破 KASLR）→ 内核内存破坏（内核读写）→ 绕过 PPL/KTRR/PAC → 覆写进程凭证（cred）/ 关闭完整性 → **root**。

---

## 3. LPE 在全链条与越狱中的位置

| 场景 | LPE 的角色 |
|---|---|
| **恶意全链条（Coruna/DarkSword/三角行动）** | Web RCE + 沙箱逃逸后，用内核 LPE 达 root，完成窃密 |
| **恶意 App / 侧载** | App 内直接 LPE，无需远程投递 |
| **越狱** | 越狱本质 = 用户主动触发的 LPE + 沙箱/签名绕过 |
| **取证/红队** | 以 LPE PoC 验证设备防护（如 Jamf iOS 13.7 LPE PoC） |

**关键洞察**：LPE 漏洞是**全链条与越狱的公共组件**；Apple 为堵越狱加的 PPL/KTRR/SPTM 同时抬高恶意 LPE 门槛。

---

## 4. 代表案例与研究

| 来源 / 案例 | 要点 |
|---|---|
| Project Zero《A survey of recent iOS kernel exploits》(2020) | 系统梳理 iOS 内核 LPE 手法（内存破坏、信息泄露、绕过） |
| Jamf《Running code in the context of iOS Kernel: LPE PoC on iOS 13.7》 | 公开 LPE PoC，展示从用户态到内核执行的路径 |
| CIS Advisory (2026-027) | Apple 多产品**提权类**漏洞公告，强调补丁 |
| CVE-2026-20687 (iPadOS UAF) | 近年 UAF 型提权代表 |
| DarkSword 内核阶段 | dyld（CVE-2026-20700）+ 内存管理（CVE-2025-43510/43520）提权至 root |

---

## 5. 检测与防护建议

### 个人 / 高危用户
1. **保持系统最新**：LPE 漏洞修复靠系统更新（iOS 18.7.x / 26.3+）。
2. **不侧载/不装不明 App 与描述文件**：削减"恶意 App 本地提权"入口。
3. **高危时启用 Lockdown Mode**：收紧攻击面（含侧载/描述文件限制）。

### 企业 / 组织
4. 补丁管理覆盖全部 Apple 设备与 BYOD；建立版本基线。
5. **MDM 禁止侧载/未签名 App**；监控描述文件安装。
6. 移动端 EDR/MTD 关注：低权限进程异常内核调用、异常崩溃后提权迹象、securityd/钥匙串异常访问。
7. 对高价值人群分层防护（Lockdown Mode + 专用网络 + 行为监控）。

### 研究 / 防御团队
8. 回归测试 Project Zero / 厂商披露的内核 LPE CVE 补丁；跟踪越狱社区 PPL/KTRR 绕过的武器化。
9. 以"立足点 → LPE → 数据"建模恶意 App 与全链条两类场景。

---

## 6. 结论

iPhone 本地提权（LPE）是"已有低权限立足点 → root/内核"的关键一跃，漏洞以**内核内存破坏、IOKit 驱动、Mach/IPC、加载器/签名、MMIO 绕过、PPL/KTRR 绕过**为主。它既是恶意全链条（Coruna/DarkSword/三角行动）的必经环节，也是恶意 App/侧载与越狱的公共组件。**防御要点：及时补丁 + 禁侧载/描述文件 + Lockdown Mode + 针对低权限进程异常内核行为的运行时检测。** 对攻击者而言 LPE 零日价值极高；对防御者而言，**削减立足点（不装不明 App）+ 及时补丁**是最有效的两道前置防线。

---

## 参考来源
- [A survey of recent iOS kernel exploits — Google Project Zero](https://projectzero.google/2020/06/a-survey-of-recent-ios-kernel-exploits.html)
- [Running code in the context of iOS Kernel: LPE PoC on iOS 13.7 — Jamf](https://www.jamf.com/blog/running-code-in-the-context-of-ios-kernel-part-i-lpe-poc-on-ios-137/)
- [Multiple Vulnerabilities in Apple Products Could Allow for Privilege Escalation — CIS Advisory 2026-027](https://www.cisecurity.org/advisory/multiple-vulnerabilities-in-apple-products-could-allow-for-privilege-escalation_2026-027)
- [CVE-2026-20687: Apple iPadOS Use After Free — SentinelOne](https://www.sentinelone.com/vulnerability-database/cve-2026-20687/)
- [The Proliferation of DarkSword: iOS Exploit Chain — Google Cloud TI](https://cloud.google.com/blog/topics/threat-intelligence/darksword-ios-exploit-chain)
- [iOS 越狱漏洞分析报告（本仓库）](./iOS越狱漏洞分析报告.md)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
