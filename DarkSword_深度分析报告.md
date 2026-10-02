# DarkSword iOS 漏洞利用链 · 深度分析报告

> 编制日期：2026-10-02
> 数据来源：Google Cloud Threat Intelligence、Cloud Security Alliance (CSA)、runZero、Holland & Knight、Wikipedia 等公开威胁情报
> 性质：防御性安全研究分析（Defensive Security Research）

---

## 1. 执行摘要

**DarkSword** 是 2025 年末开始活跃、2026 年 3 月被公开披露的 iOS 全链条（full-chain）漏洞利用工具包，是 **Coruna** 的后继者。它复用 Coruna 的基础设施，引入多个新零日漏洞，目标为 **iOS 18.4 – 18.7** 设备，同时也影响 iPadOS、macOS、tvOS、watchOS、visionOS。

其最大特点是**无持久化（ephemeral / no long-term implant）**：攻击在短暂驻留期间注入脚本、窃取并外传机密后清除痕迹，实现"完整设备沦陷"（full device compromise），使依赖持久化特征的传统检测手段失效。

DarkSword 已被**多个独立威胁主体**并行采用（国家级间谍、商业监控公司、犯罪组织），且**利用大语言模型（LLM）定制攻击载荷**，标志着移动攻击进入"多方共享 + AI 辅助"的新阶段。

**风险等级：严重（Critical）。**

---

## 2. 受影响范围与补丁版本

| 平台 | 受影响版本 | 修复版本 |
|---|---|---|
| iOS / iPadOS（主线） | 18.4 – 18.7 | **18.7.3 或更高**（部分情报记为 18.7.5，见下注） |
| iOS 26 分支 | < 26.3 | **26.3 或更高** |
| 其他 | macOS / tvOS / watchOS / visionOS 相应版本 | 同步升级至最新 |

> **版本口径说明**：runZero 记录修复版本为 iOS **18.7.3+** 与 iOS **26.3+**（补丁于 2026 年 2 月发布）；CSA 研究记录受影响面为"早于 **18.7.5**"及"iOS 26 分支中 26.3 之前"。两者略有出入，稳妥做法是升级到**当前可用的最新 iOS 版本**。

---

## 3. 涉及的 CVE 清单

| CVE | 阶段 | 说明（基于公开情报） |
|---|---|---|
| CVE-2025-31277 | 初始访问 | WebKit / JavaScriptCore 逻辑缺陷，触发初始代码执行 |
| CVE-2025-43529 | 沙箱逃逸 | GPU / WebGPU 渲染相关缺陷 |
| CVE-2025-14174 | 内核利用 | 动态链接器（dyld）/ 签名校验相关弱点 |
| CVE-2025-43510 | 内核利用 | 内存管理缺陷，用于提权 |
| CVE-2025-43520 | 内核利用 | 内存管理 / 页面所有权保护绕过 |
| CVE-2026-20700 | 链条组件 | 2026 年新披露漏洞，DarkSword 引入的零日之一 |

> 注：具体 CVE 与各阶段的精确对应关系来自公开情报汇总，Apple 官方安全公告为权威口径，建议交叉核对。

---

## 4. 攻击链分解（Kill Chain）

```
[1] 投递           访问被入侵/伪造的 URL（含恶意 JavaScript）
        │
[2] 初始访问        利用 JavaScriptCore 逻辑缺陷 (CVE-2025-31277) 获得初始执行权
        │
[3] 沙箱逃逸        GPU 渲染缺陷经 WebGPU 将恶意指令导入后台媒体服务，脱离浏览器沙箱
        │
[4] 内核利用        dyld 弱点禁用 Apple 签名校验与页面所有权保护；
                    内存管理缺陷提权至 root
        │
[5] 目标行动        向核心系统服务注入脚本，聚合机密（密钥/凭据/数据）
        │
[6] 数据外传        经加密通道（PARS Defense 变体集成加密传输协议）回传远程服务器
        │
[7] 痕迹清除        刻意不做长期植入，短暂驻留后清除，规避取证与检测
```

**关键设计特征**
- **零点击/低交互**：仅需访问恶意网页即可触发。
- **无持久化**：不落地长期 implant，减少被 EDR/取证发现的概率。
- **反分析**：与 Coruna 类似，检测到保护性设置（如 Lockdown Mode）时主动中止。
- **AI 辅助**：使用 LLM 定制行动载荷，降低攻击者门槛、提高针对性。

---

## 5. 威胁主体与归因（多方共享基础设施）

| 主体 | 类型 | 目标 / 行为 |
|---|---|---|
| **UNC6353** | 疑似俄罗斯间谍行动 | 针对乌克兰平民的定向攻击 |
| **UNC6748** | 未归因国家/关联实体 | 对沙特用户开展社会操纵行动 |
| **PARS Defense** | 土耳其商业监控公司 | 改造框架、集成加密传输协议，用于商业监控 |

- 多个独立组织**并行使用共享基础设施**发起行动。
- 与 Coruna 存在同源关系：复用基础组件、共享部分东欧归因。

---

## 6. 与 Coruna 的对比

| 维度 | Coruna | DarkSword |
|---|---|---|
| 目标 iOS | 13 – 17.2.1（旧版本） | 18.4 – 18.7 / iOS 26 < 26.3（新版本） |
| 漏洞 | 7 个已知历史 CVE | 6 个（含 2026 新零日） |
| 初始入口 | WebKit 崩溃 | JavaScriptCore 逻辑缺陷 |
| 沙箱逃逸 | 内存保护绕过 | WebGPU / GPU 渲染缺陷 |
| 持久化 | 嵌入特权系统进程 | **无持久化**，短时驻留后清除痕迹 |
| 主要动机 | 加密货币盗窃 + 东欧间谍 | 国家级间谍 + 商业监控 + 社会操纵 |
| AI 使用 | 未见明确记录 | **使用 LLM 定制载荷** |

**演进结论**：由"已知漏洞 + 持久驻留"转向"零日漏洞 + 无痕迹短时接管 + AI 辅助"，检测难度显著上升。

---

## 7. 检测与威胁狩猎（IOC / 行为指标）

由于无持久化，检测重心应从"静态落地特征"转向"**运行时行为 + 网络遥测**"。

**网络层 IOC**
- 算法生成域名（DGA / 伪随机服务器地址）的外传流量
- 异常加密通道、非常规端口的数据回传
- 对已知被入侵网站 / 伪造金融与社会工程门户的访问记录

**端点 / 运行时行为指标**
- WebContent / WebKit 进程异常崩溃后紧跟异常子进程或内存操作
- GPU / WebGPU 相关服务（后台媒体服务）被异常调用
- 核心系统服务被注入脚本、异常 dyld 加载行为
- 钥匙串（Keychain）/ 密钥库的异常批量访问
- 签名校验、页面所有权保护被绕过的迹象

**资产发现**
- 通过资产测绘/清点和 MDM 遥测，筛选运行 iOS < 18.7.3（或 < 26.3）及受影响 macOS/其他 Apple OS 的设备
- 可借助 runZero 等工具按 OS 版本过滤受影响资产

---

## 8. 缓解与防护建议

### 8.1 立即措施（最高优先级）
1. **升级系统**：iOS/iPadOS 升级至 **18.7.3+**（iOS 26 用户升级至 **26.3+**）；macOS/tvOS/watchOS/visionOS 同步升级至最新。
2. **启用 Lockdown Mode（锁定模式）**：DarkSword 检测到保护性设置会主动中止，对高危用户（记者、政务、国防、加密资产持有者、乌克兰/沙特相关人群）强烈建议开启。

### 8.2 企业 / 组织层面
3. **补丁管理策略审查**：覆盖企业设备与"访问企业资源的个人设备（BYOD）"。
4. **资产可视化**：清点全部受影响 Apple 设备，建立版本基线与升级跟踪。
5. **检测能力升级**：部署可捕捉运行时行为（进程注入、WebGPU 异常、钥匙串异常访问）的移动端 EDR / MTD 方案，而非仅依赖持久化特征。
6. **网络管控**：封禁已知恶意/伪造门户，监控 DGA 与异常加密外传。
7. **治理与合规**：将此次事件纳入安全、法务、治理三方联合评估（Holland & Knight 建议企业"立即关注"），审视移动安全态势与监管风险。

### 8.3 个人用户
8. 不点击不明链接，警惕伪造金融/登录门户。
9. 保持系统自动更新开启。
10. 高风险人群启用 Lockdown Mode 并减少敏感操作暴露在不可信网络/网页中。

---

## 9. 结论

DarkSword 代表了移动全链条利用的三个危险趋势：**零日化**（引入 2026 新漏洞）、**无痕迹化**（无持久化，规避检测）、**扩散化 + AI 化**（多主体共享基础设施、LLM 定制载荷）。防御方必须从"依赖持久化特征"转向"**及时补丁 + Lockdown Mode + 运行时行为检测 + 网络遥测 + 资产可视化**"的综合策略。对绝大多数用户而言，**升级到最新 iOS 并按需启用锁定模式**是当前最有效的防护。

---

## 参考来源
- [The Proliferation of DarkSword: iOS Exploit Chain — Google Cloud Threat Intelligence](https://cloud.google.com/blog/topics/threat-intelligence/darksword-ios-exploit-chain)
- [CSA Research Note: DarkSword iOS Full-Chain Zero-Day, Multi-Actor](https://labs.cloudsecurityalliance.org/research/csa-research-note-darksword-ios-fullchain-zeroday-multiactor/)
- [Apple iOS vulnerabilities (DarkSword exploit): Find impacted devices — runZero](https://www.runzero.com/blog/apple-devices/)
- [New iOS Exploit "DarkSword" and a New Era of Mobile Security — Holland & Knight](https://www.hklaw.com/en/insights/publications/2026/03/new-ios-exploit-darksword-and-a-new-era-of-mobile-security)
- [Coruna (exploit kit) — Wikipedia](https://en.wikipedia.org/wiki/Coruna_(exploit_kit))
- [Coruna: The Mysterious Journey of a Powerful iOS Exploit Kit — Google Cloud Threat Intelligence](https://cloud.google.com/blog/topics/threat-intelligence/coruna-powerful-ios-exploit-kit)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
