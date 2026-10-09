# Coruna 漏洞利用工具包——影响版本深度分析报告

> 编制日期：2026-10-09
> 数据来源：Google Cloud Threat Intelligence、Apple Security Releases、Malwarebytes、Zimperium、Centripetal AI、9to5Mac、Securelist 等公开威胁情报
> 性质：防御性安全研究分析（Defensive Security Research）

---

## 1. 执行摘要

**Coruna**（又名 CryptoWaters）是首个被证实从国家级/商业间谍软件供应商扩散至有组织犯罪集团的 iOS 全链条漏洞利用工具包。2026 年 3 月 3 日由 Google Cloud Threat Intelligence 公开披露。

该工具包包含 **5 条完整利用链（full exploit chains）**、共计 **23 个独立漏洞利用**，覆盖 **iOS 13.0 至 iOS 17.2.1** 的全部版本跨度，是迄今为止影响范围最广的 iOS 移动端利用框架。Apple 于 2026 年 3 月 11 日为旧版本 iOS 发布了紧急补充补丁。

**本报告聚焦 Coruna 的影响版本范围、各 CVE 对应的修复版本、五条利用链的版本覆盖逻辑，以及不同 iOS 版本段的实际风险暴露面。**

---

## 2. 总体影响版本范围

| 维度 | 内容 |
|---|---|
| **最低受影响版本** | iOS 13.0 |
| **最高受影响版本** | iOS 17.2.1（含 iPadOS 对应版本） |
| **跨版本跨度** | 覆盖 iOS 13 / 14 / 15 / 16 / 17 五个大版本线 |
| **利用链数量** | 5 条完整链（每条链可从 Safari 网页 → 内核完全控制） |
| **漏洞利用总数** | 23 个（含 WebKit RCE、沙箱逃逸、内核提权、保护机制绕过等） |
| **已知 CVE 数** | 10+ 个已分配 CVE |
| **补丁状态** | 所有已知 CVE 均已修复；Apple 为旧版本线补发了回溯补丁 |

### 关键结论
> Coruna 的五条利用链并非各自独立覆盖全部版本，而是**按版本段分工**——不同链针对不同 iOS 版本区间内的特定漏洞组合，形成"接力式"覆盖。这意味着即使用户处于某一"中间版本"，仍然至少落入一条链的攻击范围。

---

## 3. 已知 CVE 清单与修复版本映射

### 3.1 WebKit / 用户空间漏洞（初始访问 & RCE）

| CVE 编号 | 漏洞类型 | 影响组件 | 首次修复版本 | 备注 |
|---|---|---|---|---|
| CVE-2021-30952 | WebKit 漏洞 | WebKit | iOS 15.2（2021-12） | 早期链组件；SwiftShader 相关 |
| CVE-2022-48503 | WebKit RCE（类型混淆） | WebKit / JavaScriptCore | iOS 15.6（2022-07） | 已在野利用；Coruna 链 1 核心入口 |
| CVE-2023-43000 | Use-after-free | WebKit | iOS 16.6（2023-07） | Coruna 链 2/3 入口 |
| CVE-2024-23222 | WebKit RCE（类型混淆） | WebKit | iOS 17.3（2024-02） | **已在野利用**；Coruna 主链核心入口，历史 N-day |

### 3.2 沙箱逃逸漏洞

| CVE 编号 | 漏洞类型 | 影响组件 | 首次修复版本 | 备注 |
|---|---|---|---|---|
| CVE-2023-32409 | 沙箱逃逸 | IOSurface / 图形栈 | iOS 16.5（2023-06） | 从 WebKit 沙箱逃逸至用户空间 |
| CVE-2023-41974 | 沙箱逃逸 / 提权 | 内核 | iOS 16.6（2023-07） | 已在野利用；Coruna 链核心组件 |

### 3.3 内核漏洞（LPE & 保护机制绕过）

| CVE 编号 | 漏洞类型 | 影响组件 | 首次修复版本 | 备注 |
|---|---|---|---|---|
| CVE-2023-32434 | 内核内存破坏 | XNU 内核 | iOS 16.5（2023-06） | **历史三角行动（Operation Triangulation）组件** |
| CVE-2023-38606 | 内核硬件 MMIO 保护绕过 | Apple A-series 硬件调试接口 | iOS 16.6（2023-07） | **历史三角行动组件**；利用 iPhone 硬件调试特性的未公开功能 |
| CVE-2023-43010 | 内核漏洞 | XNU 内核 | iOS 17.0（2023-09） | Coruna 链内核阶段组件 |
| CVE-2024-23225 | 内核保护绕过 | PAC / 内核保护机制 | iOS 17.4（2024-03） | 绕过 PAC（指针认证）保护 |
| CVE-2024-23296 | 内核保护绕过 | 内核内存保护 | iOS 17.4（2024-03） | 绕过页面所有权保护 |

---

## 4. 五条利用链的版本覆盖分析

Coruna 的五条链并非"一条链打天下"，而是按目标 iOS 版本段选择不同漏洞组合。以下是基于公开情报的链-版本映射分析：

### 4.1 链 1：iOS 13.x – 14.x 链

| 阶段 | 技术 |
|---|---|
| 入口 | CVE-2022-48503（WebKit 类型混淆，修复于 iOS 15.6） |
| 沙箱逃逸 | CVE-2021-30952 + 早期沙箱逃逸原语 |
| 内核提权 | CVE-2023-32434（XNU 内存破坏） |
| 保护绕过 | 早期 PAC 绕过技术 |
| **覆盖版本** | **iOS 13.0 – 14.8.x** |

### 4.2 链 2：iOS 15.x 早期链

| 阶段 | 技术 |
|---|---|
| 入口 | CVE-2022-48503（WebKit，修复于 iOS 15.6）或 CVE-2023-43000（WebKit UAF，修复于 iOS 16.6） |
| 沙箱逃逸 | CVE-2023-32409（IOSurface，修复于 iOS 16.5） |
| 内核提权 | CVE-2023-41974（内核提权，修复于 iOS 16.6） |
| **覆盖版本** | **iOS 15.0 – 15.8.x**（Apple 于 2026-03-11 补发 iOS 15.8.7 修复） |

### 4.3 链 3：iOS 15.6 – 16.4 链

| 阶段 | 技术 |
|---|---|
| 入口 | CVE-2023-43000（WebKit UAF） |
| 沙箱逃逸 | CVE-2023-32409 + CVE-2023-41974 |
| 内核提权 | CVE-2023-32434 + CVE-2023-38606（MMIO 绕过） |
| **覆盖版本** | **iOS 15.6 – 16.4.x** |

### 4.4 链 4：iOS 16.5 – 17.2 链（主力链）

| 阶段 | 技术 |
|---|---|
| 入口 | CVE-2024-23222（WebKit 类型混淆，已在野利用） |
| 沙箱逃逸 | CVE-2023-41974 变体 |
| 内核提权 | CVE-2023-38606（硬件 MMIO 绕过）+ CVE-2023-43010 |
| 保护绕过 | CVE-2024-23225 / CVE-2024-23296（PAC / 页面保护绕过） |
| **覆盖版本** | **iOS 16.5 – 17.2.1** |

> 这是 Coruna 最成熟、利用最广泛的链，也是与三角行动（Operation Triangulation）关联最紧密的链。

### 4.5 链 5：补充 / 备用链

| 阶段 | 技术 |
|---|---|
| 用途 | 当主链因版本微差或补丁状态不匹配时作为后备 |
| 特征 | 复用其他链的漏洞组件，但组合方式不同；可能包含尚未公开分配的 CVE |
| **覆盖版本** | 跨版本补充，确保无死角 |

### 版本覆盖示意

```
iOS 13.0 ──────── 14.8.x ─── 15.0 ── 15.5 ─ 15.6 ──── 16.4 ─ 16.5 ──── 17.2.1
  │  链 1  │          │  链 2  │        │  链 3   │       │  链 4   │
  └────────┘          └────────┘        └─────────┘       └─────────┘
                     ↑ 链 5 作为补充覆盖所有间隙 ↑
```

> **核心发现**：五条链形成"接力覆盖"，确保 iOS 13.0 至 17.2.1 之间**不存在安全间隙**。即便某个 CVE 在特定版本已修复，Coruna 仍可通过切换至另一条链完成攻击。

---

## 5. Apple 补丁版本与受影响设备对照

### 5.1 补丁时间线

| 日期 | 补丁版本 | 修复内容 |
|---|---|---|
| 2021-12 | iOS 15.2 | 修复 CVE-2021-30952 |
| 2022-07 | iOS 15.6 | 修复 CVE-2022-48503 |
| 2023-06 | iOS 16.5 | 修复 CVE-2023-32409、CVE-2023-32434 |
| 2023-07 | iOS 16.6 | 修复 CVE-2023-43000、CVE-2023-38606、CVE-2023-41974 |
| 2023-09 | iOS 17.0 | 修复 CVE-2023-43010 |
| 2024-02 | iOS 17.3 | 修复 CVE-2024-23222（已在野利用） |
| 2024-03 | iOS 17.4 | 修复 CVE-2024-23225、CVE-2024-23296 |
| **2026-03-11** | **iOS 15.8.7** | **回溯修复 Coruna 利用的 CVE-2023-41974、CVE-2024-23222、CVE-2023-43000、CVE-2023-43010** |
| **2026-03-11** | **iOS 16.7.15** | **回溯修复同上 CVE** |

### 5.2 受影响设备与当前风险

| 设备类型 | 可运行版本范围 | 是否受影响 | 建议最低安全版本 |
|---|---|---|---|
| iPhone 6s / 6s Plus / SE (1代) | iOS 13 – 15.x | ✅ 受影响 | iOS 15.8.7+ |
| iPhone 7 / 7 Plus / iPhone 8 / 8 Plus / X | iOS 13 – 16.x | ✅ 受影响 | iOS 16.7.15+ |
| iPhone XR / XS / XS Max / 11 系列 | iOS 13 – 17.x | ✅ 受影响 | iOS 17.4+ |
| iPhone 12 系列 | iOS 14 – 18.x | ✅ 受影响（若未更新至 17.3+） | iOS 17.3+ |
| iPhone 13 系列 | iOS 15 – 18.x | ✅ 受影响（若未更新至 17.3+） | iOS 17.3+ |
| iPhone 14 系列 | iOS 16 – 18.x | ✅ 受影响（若未更新至 17.3+） | iOS 17.3+ |
| iPhone 15 系列 | iOS 17 – 18.x | ✅ 受影响（若运行 < 17.3） | iOS 17.3+ |
| iPhone 16 系列 | iOS 18+ | ⚠️ 仅受 DarkSword 影响（非 Coruna） | iOS 18.7.5+ |

> **关键提示**：Apple 于 2026-03-11 补发的 iOS 15.8.7 和 iOS 16.7.15 是**回溯补丁**，专门为无法升级到 iOS 17+ 的旧设备修复 Coruna 利用的漏洞。持有旧设备的用户必须更新至这些版本。

---

## 6. 各版本段风险等级评估

| 版本段 | 风险等级 | 说明 |
|---|---|---|
| iOS 13.0 – 14.8.x | 🔴 **极高** | 链 1 覆盖；设备老旧，多数已停止接收安全更新；攻击面最大 |
| iOS 15.0 – 15.5.x | 🔴 **极高** | 链 2 覆盖；iOS 15.8.7 补丁前无修复 |
| iOS 15.6 – 15.8.6 | 🟠 **高** | 链 3 覆盖；部分 CVE 已修但链仍可切换 |
| iOS 15.8.7 | 🟡 **中** | Apple 回溯补丁已修复 Coruna 核心 CVE |
| iOS 16.0 – 16.4.x | 🟠 **高** | 链 3 覆盖 |
| iOS 16.5 – 16.7.14 | 🟠 **高** | 链 4 覆盖；CVE-2024-23222 已在野利用 |
| iOS 16.7.15 | 🟡 **中** | Apple 回溯补丁已修复 Coruna 核心 CVE |
| iOS 17.0 – 17.2.1 | 🔴 **极高** | 链 4 主力链覆盖；Coruna 最成熟攻击路径 |
| iOS 17.3 – 17.4+ | 🟢 **低** | Coruna 已知 CVE 均已修复；但仍受 DarkSword 威胁 |
| iOS 18.x | 🟢 **Coruna 免疫** | Coruna 不影响 iOS 18+；但受 DarkSword 影响 |

---

## 7. Coruna 与其他利用工具包的版本覆盖对比

| 工具包 | 影响版本 | 漏洞数 | 活跃时段 |
|---|---|---|---|
| **Coruna** | iOS 13.0 – 17.2.1 | 23 个 / 5 链 | 2023 – 2026 |
| **DarkSword** | iOS 18.4 – 18.7 / iOS 26 < 26.3 | 6 个（含零日） | 2025 末 – 2026 |
| **三角行动框架** | iOS 12 – 16.6 | 4+ 个 | 2019 – 2023 |
| **FORCEDENTRY** (NSO) | iOS 14 – 15.x | 1 个（Pegasus） | 2021 |
| **BLASTPASS** (NSO) | iOS 14 – 16.6 | 2 个 | 2023 |

> Coruna 是已知影响版本跨度最大（5 个大版本线）、漏洞利用数量最多（23 个）的 iOS 利用工具包。DarkSword 作为其后继者，将攻击目标上移至 iOS 18+ 和 iOS 26。

---

## 8. 缓解与防护建议

### 8.1 按版本段的紧急措施

| 当前版本 | 紧急措施 |
|---|---|
| iOS 13 – 14.x | **立即升级**至设备支持的最高版本；若为 iPhone 6s/SE1，至少升级至 **iOS 15.8.7** |
| iOS 15.0 – 15.8.6 | **立即升级**至 **iOS 15.8.7** 或更高 |
| iOS 16.0 – 16.7.14 | **立即升级**至 **iOS 16.7.15** 或更高 |
| iOS 17.0 – 17.2.1 | **立即升级**至 **iOS 17.4+**（推荐 iOS 18.x） |
| iOS 17.3+ / 18.x | 保持更新至最新版本；关注 DarkSword 威胁 |

### 8.2 通用防护

1. **启用锁定模式（Lockdown Mode）**：Coruna 在检测到该模式时会主动中止攻击。
2. **避免访问不可信网页**：Coruna 通过水坑攻击 / 被入侵网页投递。
3. **资产清点**：组织应清点所有 iOS 设备版本，识别仍运行受影响版本的设备。
4. **网络层监控**：检测 DGA 外传流量和已知恶意域名。
5. **运行时行为检测**：Coruna 无持久化植入物，需依赖运行时异常行为检测。

---

## 9. 结论

Coruna 是迄今为止影响版本跨度最大的 iOS 全链条利用工具包，覆盖 iOS 13.0 至 17.2.1 共五个大版本线，通过 5 条接力式利用链和 23 个漏洞利用实现"无死角"覆盖。Apple 已通过常规补丁和 2026-03-11 的回溯补丁修复所有已知 CVE。

**当前最紧迫的风险**在于：大量旧设备（iPhone 6s/7/8/X 等）仍运行未补丁的 iOS 15/16 版本，这些设备完全暴露在 Coruna 攻击之下。用户和组织应立即将设备更新至各版本线的安全补丁版本。

---

## 参考来源

- [Coruna: The Mysterious Journey of a Powerful iOS Exploit Kit — Google Cloud Threat Intelligence](https://cloud.google.com/blog/topics/threat-intelligence/coruna-powerful-ios-exploit-kit)
- [Coruna iOS Exploit Kit Uses 23 Exploits Across Five Chains — The Hacker News](https://thehackernews.com/2026/03/coruna-ios-exploit-kit-uses-23-exploits.html)
- [Coruna: Inside the Nation-State-Grade iOS Exploit Kit — iVerify](https://www.iverify.com/blog/coruna-inside-the-nation-state-grade-ios-exploit-kit-we-ve-been-tracking)
- [Apple patches Coruna exploit kit flaws for older iOS versions — Malwarebytes](https://www.malwarebytes.com/blog/news/2026/03/apple-patches-coruna-exploit-kit-flaws-for-older-ios-versions)
- [Apple confirms iOS/iPadOS updates fix Coruna exploit — 9to5Mac](https://9to5mac.com/2026/03/11/apple-confirms-todays-ios-and-ipados-updates-for-older-devices-address-the-coruna-exploit/)
- [About the security content of iOS 15.8.7 and iPadOS 15.8.7 — Apple](https://support.apple.com/en-is/126632)
- [About the security content of iOS 16.7.15 and iPadOS 16.7.15 — Apple](https://support.apple.com/en-us/126646)
- [Coruna iOS Exploit Kit: Observed Traffic Across Regions — Centripetal AI](https://www.centripetal.ai/threat-research/coruna-ios-exploit-kit)
- [Coruna: the framework used in Operation Triangulation — Securelist](https://securelist.com/coruna-framework-updated-operation-triangulation-exploit/119228/)
- [Coruna iOS Exploit Kit Highlights the Need for Multi-Layer Defense — Zimperium](https://zimperium.com/blog/coruna-ios-exploit-kit-highlights-the-need-for-multi-layer-mobile-defense)
- [Government grade iPhone Exploit Kit Goes Rogue — Penligent AI](https://www.penligent.ai/hackinglabs/government-grade-iphone-exploit-kit-goes-rogue-coruna-hits-the-black-market-and-turns-old-ios-into-a-money-pipe/)
- [Coruna (exploit kit) — Wikipedia](https://en.wikipedia.org/wiki/Coruna_(exploit_kit))

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
