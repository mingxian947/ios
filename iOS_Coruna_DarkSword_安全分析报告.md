# iOS 安全系统分析报告：Coruna 与 DarkSword 漏洞利用工具包

> 编制日期：2026-10-02
> 数据来源：Google Cloud Threat Intelligence、Wikipedia、Cloud Security Alliance (CSA)、Malwarebytes 等公开威胁情报
> 性质：防御性安全研究分析（Defensive Security Research）

---

## 1. 执行摘要

2026 年 3 月，安全研究界公开披露了两套关联的 iOS 全链条漏洞利用工具包：

- **Coruna**：首个被证实的、从国家级/商业间谍软件供应商扩散至有组织犯罪集团的 iOS 利用框架，影响 **iOS 13 – 17.2.1**。
- **DarkSword**：Coruna 的后继者，复用其基础设施并引入新的零日漏洞，主要针对 **iOS 18.x（18.4–18.7）** 及 iOS 26 早期版本。

两者均通过被入侵/伪造的网页投递 JavaScript 载荷，实现"完整设备沦陷"（full device compromise），可窃取加密密钥、劫持钱包应用、抓取扫描影像，并通过算法生成域名（DGA）外传数据。Apple 已针对新旧 iOS 版本发布协调补丁。

**核心风险**：无长期植入物（ephemeral / no persistent implant）的设计使传统基于持久化特征的检测手段失效；且工具已扩散至多个独立威胁主体与商业监控公司。

---

## 2. Coruna 漏洞利用工具包分析

### 2.1 概况
| 项目 | 内容 |
|---|---|
| 首次公开披露 | 2026-03-03 |
| 早期碎片发现 | 2025 年 2 月（运营片段被隔离） |
| 影响版本 | iOS 13 – 17.2.1 |
| 利用漏洞数 | 7 个 CVE |
| 补丁发布 | 2026-03-12（Apple 为旧版本 iOS 补充修复） |

### 2.2 涉及的 CVE
- CVE-2024-23222（WebKit 类型混淆，历史在野利用）
- CVE-2022-48503
- CVE-2023-43000
- CVE-2021-30952
- CVE-2023-41974
- CVE-2023-32434（内核内存破坏）
- CVE-2023-38606（内核硬件 MMIO 保护绕过，历史 Kasperovsky 链条组件）

### 2.3 攻击链与技术机制
1. **投递**：受害者访问隐藏网页，页面执行 JavaScript。
2. **指纹识别**：脚本识别设备硬件与软件配置；若检测到保护性设置（如 Lockdown Mode）则**主动中止**，规避分析。
3. **初始利用**：触发浏览器引擎（WebKit）崩溃。
4. **内存保护绕过**：绕过内存防护机制。
5. **载荷下载**：下载加密的可执行载荷。
6. **驻留与提权**：将自身嵌入特权系统进程。
7. **目标行为**：
   - 采集加密密钥
   - 捕获扫描影像
   - 劫持加密货币钱包应用
   - 通过伪随机生成服务器地址（DGA）路由外传窃取数据

### 2.4 归因与目标
- **UNC6353**：针对东欧（乌克兰机构访问者）的行动。
- **UNC6691**：全球范围加密货币盗窃，使用伪造金融门户。
- 情报显示其开发与此前被入侵的**国防承包商资产**存在关联。

---

## 3. DarkSword 漏洞利用链分析

### 3.1 概况
| 项目 | 内容 |
|---|---|
| 披露时间 | Coruna 之后不久（Google 博客 2026-03-18） |
| 活跃起始 | 2025 年末 |
| 影响版本 | iOS 18.4–18.7；早于 iOS 18.7.5 的版本，以及 iOS 26 分支中 26.3 之前的版本 |
| 关系 | Coruna 后继者，复用基础基础设施，新增零日漏洞 |

### 3.2 涉及的 CVE
- CVE-2025-31277（WebKit / JavaScriptCore 逻辑缺陷）
- CVE-2025-43529
- CVE-2025-14174
- CVE-2026-20700
- CVE-2025-43510
- CVE-2025-43520

### 3.3 攻击链阶段
| 阶段 | 技术 |
|---|---|
| **初始访问** | 访问被入侵 URL 触发 JavaScript，利用 JavaScriptCore 逻辑缺陷获得初始执行权 |
| **沙箱逃逸** | GPU 渲染缺陷，经 WebGPU 将恶意指令导入后台媒体服务，脱离浏览器环境 |
| **内核利用** | 动态链接器（dyld）弱点禁用 Apple 签名校验与页面所有权保护；随后内存管理缺陷提权至 root |
| **持久化** | **刻意不做长期植入**，短暂驻留期间向核心系统服务注入脚本，聚合并外传机密后清除痕迹（"完整设备沦陷"） |

### 3.4 归因与目标（多主体共享基础设施）
- **UNC6353**：疑似俄罗斯间谍行动，针对乌克兰平民。
- **UNC6748**：未归因国家/关联实体，对沙特用户开展社会操纵行动。
- **PARS Defense**：土耳其商业监控公司，改造框架并集成加密传输协议。
- 注：多个独立组织并行使用共享基础设施；**大语言模型（LLM）被用于定制行动载荷**。

---

## 4. 对比分析：Coruna vs DarkSword

| 维度 | Coruna | DarkSword |
|---|---|---|
| 目标 iOS | 13 – 17.2.1（旧版本） | 18.4–18.7 / iOS 26 < 26.3（新版本） |
| 漏洞类型 | 7 个已知历史 CVE | 6 个（含新零日） |
| 初始入口 | WebKit 崩溃 | JavaScriptCore 逻辑缺陷 |
| 沙箱逃逸 | 内存保护绕过 | WebGPU / GPU 渲染缺陷 |
| 持久化 | 嵌入特权进程 | 无持久化，短暂驻留后清除痕迹 |
| 主要动机 | 加密货币盗窃 + 东欧间谍 | 国家级间谍 + 商业监控 + 社会操纵 |
| 关联主体 | UNC6353 / UNC6691 | UNC6353 / UNC6748 / PARS Defense |

**演进趋势**：由"已知漏洞 + 持久驻留"转向"零日漏洞 + 无痕迹短时攻击"，显著提高了检测难度，并体现了利用工具从供应商向犯罪集团、商业监控公司扩散的供应链风险。

---

## 5. 受影响面与风险评级

- **暴露设备**：运行 iOS < 18.7.5（含 iOS 13–17 旧机型）及 iOS 26 < 26.3 的所有 iPhone。
- **高危人群**：乌克兰及东欧地区用户、沙特用户、加密货币持有者、国防/政府机构人员、访问被入侵或伪造金融门户的用户。
- **风险等级：严重（Critical）** —— 全链条远程零点击/低交互利用，可完整接管设备且无持久化痕迹。

---

## 6. 缓解与防护建议

### 6.1 立即措施
1. **升级系统**：将所有设备更新至 **iOS 18.7.5 或更高**（iOS 26 用户升级至 **26.3+**）；旧机型升级至 Apple 提供的补充补丁版本。
2. **启用 Lockdown Mode（锁定模式）**：两套工具在检测到保护性设置时会主动中止，可显著降低风险（针对高危用户）。

### 6.2 检测与响应
3. **网络层监控**：检测 DGA（伪随机域名）外传流量、异常加密通道；封禁已知恶意/伪造金融门户。
4. **端点行为检测**：因无持久化，需依赖**运行时行为**（异常进程注入、WebGPU/GPU 服务异常调用、系统服务脚本注入、密钥库异常访问）而非静态持久化特征。
5. **威胁狩猎**：排查对乌克兰/沙特/加密相关伪造门户的访问记录；结合 MDM/EDR 遥测。

### 6.3 组织层面
6. **资产清点**：识别仍运行受影响 iOS 版本的设备（可借助 runZero 等资产测绘工具）。
7. **用户教育**：警惕不明链接、伪造金融门户；针对高风险岗位强化培训。
8. **供应链治理**：关注商业监控公司（如 PARS Defense 类）改造框架带来的扩散风险。

---

## 7. 结论

Coruna 与 DarkSword 代表了移动全链条利用工具的重要转折：**从供应商专属能力扩散至犯罪集团与商业监控主体**，并从"持久驻留"演进为"无痕迹短时接管"。防御方应从"依赖持久化特征检测"转向"运行时行为 + 网络遥测 + 及时补丁 + Lockdown Mode"的综合策略。及时升级与资产可视化是当前最有效的缓解手段。

---

## 参考来源
- [Coruna: The Mysterious Journey of a Powerful iOS Exploit Kit — Google Cloud Threat Intelligence](https://cloud.google.com/blog/topics/threat-intelligence/coruna-powerful-ios-exploit-kit)
- [The Proliferation of DarkSword: iOS Exploit Chain — Google Cloud Threat Intelligence](https://cloud.google.com/blog/topics/threat-intelligence/darksword-ios-exploit-chain)
- [Coruna (exploit kit) — Wikipedia](https://en.wikipedia.org/wiki/Coruna_(exploit_kit))
- [CSA Research Note: DarkSword iOS Full-Chain Zero-Day, Multi-Actor](https://labs.cloudsecurityalliance.org/research/csa-research-note-darksword-ios-fullchain-zeroday-multiactor/)
- [Apple patches Coruna exploit kit flaws for older iOS versions — Malwarebytes](https://www.malwarebytes.com/blog/news/2026/03/apple-patches-coruna-exploit-kit-flaws-for-older-ios-versions)
- [Apple iOS vulnerabilities (DarkSword exploit): Find impacted devices — runZero](https://www.runzero.com/blog/apple-devices/)
- [New iOS Exploit "DarkSword" and a New Era of Mobile Security — Holland & Knight](https://www.hklaw.com/en/insights/publications/2026/03/new-ios-exploit-darksword-and-a-new-era-of-mobile-security)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
