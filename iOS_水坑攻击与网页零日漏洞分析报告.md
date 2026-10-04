# iOS 水坑攻击与网页零日漏洞 · 分析报告

> 编制日期：2026-10-02
> 数据来源：Google Project Zero、Google Cloud Threat Intelligence、WIRED、CSA、SOC Prime、公开 CVE 情报
> 性质：防御性安全研究分析（Defensive Security Research）

---

## 1. 执行摘要

**水坑攻击（Watering Hole Attack）** 指攻击者不直接攻击目标本人，而是**入侵目标群体经常访问的网站**，在其中植入恶意代码；当目标访问这些"可信"网站时即被投递漏洞利用载荷。对 iOS 而言，水坑攻击几乎总是与 **网页零日漏洞（Web Zero-Day）** 配合使用——利用 WebKit / JavaScriptCore 等浏览器引擎的未公开缺陷，在用户**仅访问网页、无需其他交互**的情况下实现远程代码执行。

近年多起重大 iOS 攻击事件均采用此模式：
- **2019** Google Project Zero 披露的在野 iOS 利用链（被入侵网站批量投递）
- **2021** 针对香港地区 Apple 设备的大规模水坑攻击
- **2023** Kaspersky "Operation Triangulation"（员工 iPhone 经水坑站点沦陷）
- **2025–2026** **Coruna / DarkSword** 利用工具包（被入侵/伪造网页投递 Web 零日，实现全链条沦陷）

**风险等级：严重（Critical）。** 网页零日 + 水坑投放使攻击具备"低交互、广覆盖、难预警"的特点。

---

## 2. 水坑攻击原理（针对 iOS）

```
[1] 选点      攻击者选定目标群体高频访问的网站（新闻/论坛/政务/行业门户）
      │
[2] 植入      入侵网站服务器或供应链（CMS、广告、第三方 JS），注入恶意脚本
      │
[3] 指纹      访客加载页面时，脚本识别设备型号 / OS 版本 / 语言 / 保护设置
      │         （若检测到 Lockdown Mode 等保护设置则主动跳过，规避分析）
      │
[4] 投递      仅对"符合条件的目标"下发 Web 零日利用代码（WebKit/JSC 漏洞）
      │
[5] 利用      浏览器引擎内存破坏 → 沙箱逃逸 → 内核提权 → 完整设备沦陷
      │
[6] 收尾      窃取数据 / 植入后门 / 清除痕迹（新一代工具无持久化）
```

**为什么水坑对 iOS 特别有效**
- 用户信任常访问的网站，不会怀疑。
- iOS 应用沙箱严格，但**浏览器（Safari/WebKit）是面向全网内容的攻击面**，Web 零日是绕过"只装 App Store 应用"防线的最直接入口。
- 攻击者可按指纹**精准筛选目标**，减少暴露、提高成功率。

---

## 3. iOS 网页零日漏洞（Web Zero-Day）概览

网页零日主要集中在 **WebKit（渲染引擎）** 与 **JavaScriptCore（JSC，JS 引擎）** 两大组件，典型类型为**内存破坏（type confusion / use-after-free / OOB write）**。

### 3.1 代表性在野利用 CVE
| CVE | 组件 | 类型 | 备注 |
|---|---|---|---|
| CVE-2025-14174 | WebKit | 内存破坏 | 2025-12 在野利用；修复于 iOS 26.2 / 18.7.3 |
| CVE-2025-31277 | WebKit/JSC | 逻辑缺陷 | DarkSword 初始访问组件 |
| CVE-2024-23222 | WebKit | 类型混淆 | 历史在野利用，Coruna 组件 |
| CVE-2023-41974 | WebKit | 内存破坏 | 在野利用 |
| CVE-2023-32434 | WebKit | 内存破坏 | 在野利用，Triangulation/其他链条组件 |
| CVE-2023-38606 | 内核 | MMIO 保护绕过 | 常与 Web 零日组合成全链条 |

### 3.2 网页零日在全链条中的位置
Web 零日通常只负责**初始访问 + 沙箱逃逸**，要达成"完整设备沦陷"还需配合**内核零日**（提权）：

```
Web 零日 (WebKit/JSC)  →  沙箱逃逸  →  内核零日 (提权/root)  →  目标行动
        ↑ 水坑站点投递                                    ↑ 无持久化/清除痕迹
```

---

## 4. 典型案例回顾

| 事件 | 时间 | 手法 | 要点 |
|---|---|---|---|
| Project Zero 在野 iOS 利用链 | 2019 | 被入侵网站批量投递多条独立利用链 | 首次系统揭示"水坑 + Web 零日 + 内核零日"的工业化 iOS 攻击 |
| 香港水坑攻击 | 2021 | 地区性网站植入 iOS/macOS 利用链 | 面向特定地区人群的长时间水坑投放 |
| Operation Triangulation | 2023 | 水坑站点投递未知 iOS 平台恶意软件 | 连安全厂商员工设备亦沦陷，凸显水坑隐蔽性 |
| Coruna | 2025–2026 | 被入侵/伪造金融门户投递 7 CVE 链条 | 面向东欧 + 加密资产持有者 |
| DarkSword | 2025–2026 | 被入侵 URL 投递 6 CVE 链条（含 2026 零日） | 无持久化、多主体共享、LLM 定制载荷 |

---

## 5. 检测与威胁狩猎

**网络 / 站点层**
- 监控常访问站点是否被注入异常第三方脚本 / iframe / 重定向
- 检测 DGA / 伪随机域名外传、异常加密通道
- 对 CMS、广告与第三方 JS 供应链做完整性校验（SRI、CSP）

**端点 / 运行时层**
- WebContent / WebKit 进程异常崩溃后紧跟异常内存操作或子进程
- JSC JIT 相关异常、GPU/WebGPU 服务被异常调用
- 钥匙串（Keychain）异常批量访问、异常 dyld 加载
- 移动端 EDR / MTD 捕捉运行时行为（因新一代工具无持久化）

**资产与暴露面**
- 清点运行受影响 iOS 版本的设备（MDM / 资产测绘）
- 对高危人群（政务、国防、记者、加密资产、特定地区）单独建模监控

---

## 6. 缓解与防护建议

### 6.1 个人 / 高危用户
1. **保持系统最新**：网页零日修复依赖系统更新（如 CVE-2025-14174 修复于 iOS 26.2 / 18.7.3）。
2. **启用 Lockdown Mode**：水坑脚本检测到保护设置会主动跳过，是最有效的单点缓解。
3. 减少在不可信/高风险地区网络下访问敏感站点；警惕异常重定向。

### 6.2 网站运营者（防"被水坑"）
4. 加固服务器与 CMS、第三方插件/广告供应链；启用 CSP、SRI、子资源完整性校验。
5. 监控页面完整性与异常脚本注入；定期做 Web 安全审计。

### 6.3 企业 / 组织
6. 补丁管理覆盖企业设备与 BYOD；建立 Apple 设备版本基线。
7. 部署可检测 Web 运行时行为的移动端 EDR/MTD；网络层封禁已知水坑/伪造门户。
8. 对高价值目标人群实施分层防护（Lockdown Mode + 专用网络 + 行为监控）。

---

## 7. 结论

iOS 水坑攻击与网页零日的组合，把"用户信任的网站"变成了攻击入口，把"浏览器引擎"变成了突破沙箱的跳板。从 2019 年 Project Zero 披露到 2025–2026 年的 Coruna/DarkSword，这一模式不断进化：**更精准的指纹筛选、更多零日、无持久化、AI 辅助、多主体共享**。防御的关键在于：**及时补丁 + Lockdown Mode + 站点供应链加固 + 运行时行为检测 + 资产可视化**。对个体而言，"系统保持最新 + 高危时开启锁定模式"仍是最有效的两道防线。

---

## 参考来源
- [A very deep dive into iOS Exploit chains found in the wild — Google Project Zero](https://projectzero.google/2019/08/a-very-deep-dive-into-ios-exploit.html)
- [Hackers Targeted Apple Devices in Hong Kong (Watering Hole) — WIRED](https://www.wired.com/story/ios-macos-hacks-hong-kong-watering-hole/)
- [The Proliferation of DarkSword: iOS Exploit Chain — Google Cloud Threat Intelligence](https://cloud.google.com/blog/topics/threat-intelligence/darksword-ios-exploit-chain)
- [Apple WebKit Zero-Day CVE-2025-14174 — op-c.net](https://op-c.net/blog/apple-webkit-zero-day-cve-2025-14174/)
- [CVE-2025-14174 Vulnerability: A New Memory Corruption — SOC Prime](https://socprime.com/blog/cve-2025-14174-vulnerability/)
- [Zero-Day Vulnerabilities in Apple WebKit — CSA Singapore Alert AL-2025-117](https://www.csa.gov.sg/alerts-and-advisories/alerts/al-2025-117/)
- [Coruna (exploit kit) — Wikipedia](https://en.wikipedia.org/wiki/Coruna_(exploit_kit))

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
