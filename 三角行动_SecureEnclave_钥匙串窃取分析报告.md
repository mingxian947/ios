# 三角行动 × Secure Enclave × 钥匙串窃取 · 分析报告

> 编制日期：2026-10-02
> 数据来源：Kaspersky、Apple Security 文档、The Record、公开威胁情报（含 Coruna 与三角行动关联披露）
> 性质：防御性安全研究分析（Defensive Security Research）

---

## 1. 执行摘要

本报告串联三个相互支撑的主题，构成"攻击 → 硬件防线 → 数据窃取"的完整图景：

- **三角行动（Operation Triangulation）**：Kaspersky 于 2023 年发现的 iOS 间谍软件行动，**经 iMessage 零点击投递**，植入物 **TriangleDB 仅驻留内存（重启即消失）**，利用内核漏洞 + 一个**未公开的 iPhone 硬件调试特性**绕过内存保护；公开研究将其与 **Coruna 框架**关联。
- **Secure Enclave（SEP，安全隔区）**：Apple 的硬件安全协处理器，独立于主 CPU/内核，**密钥永不离开 SEP**，是 iOS 密钥与生物识别的最后硬件防线。
- **钥匙串窃取（Keychain Theft）**：攻击者在获得 root/内核权限后，试图提取钥匙串中的凭据与密钥；**SEP 托管的密钥不可导出**，但非 SEP 托管的钥匙串项在高权限下仍可能被提取。

**核心结论**：三角行动代表"零点击 + 内存驻留 + 硬件级绕过"的高端 iOS 间谍能力；Secure Enclave 是密钥层面的最后防线；而钥匙串窃取则是全链条沦陷后攻击者的主要数据目标之一。**防御 = 及时补丁 + Lockdown Mode + 以 SEP 托管关键密钥 + 高权限行为检测。**

---

## 2. 三角行动（Operation Triangulation）

### 2.1 概况
| 项目 | 内容 |
|---|---|
| 发现 | Kaspersky，2023 年（在其**自家员工 iPhone** 上经网络遥测发现） |
| 投递 | **iMessage 零点击**（无需用户交互） |
| 植入物 | **TriangleDB** |
| 驻留 | **仅内存驻留，重启即消失**（无持久化） |
| 利用 | 内核漏洞 + 未公开 **iPhone 硬件调试特性**（绕过内存保护、调整安全数据区） |
| 能力 | 访问文件系统、监控地理位置等间谍功能 |
| 关联 | 公开研究将其与 **Coruna 框架**关联（Coruna 为三角行动所用框架） |
| 补丁 | Apple 于 2023 年修补相关零日（含 WebKit 与内核/硬件 MMIO 类缺陷） |

### 2.2 攻击链要点
```
iMessage 零点击投递  →  WebKit/内核零日  →  内核提权
        →  利用未公开硬件调试特性（MMIO 类）绕过内存保护 / 调整安全数据区
        →  TriangleDB 内存驻留（重启即清除）
        →  文件系统访问 + 地理位置监控 + 数据外传
```

### 2.3 为何重要
1. **零点击 + 内存驻留**：无需交互、重启即无痕，检测与取证极难。
2. **硬件级绕过**：利用"本用于测试/调试"的芯片特性（security through obscurity），绕过软件层内存保护——说明**软件缓解可被硬件后门/调试特性架空**。
3. **与 Coruna 同源**：把三角行动与后续 Coruna/DarkSword 谱系连接，体现同一框架的长期演进与扩散。

---

## 3. Secure Enclave（SEP，安全隔区）

### 3.1 是什么
- **独立硬件协处理器**，与主 CPU/内核隔离，有自己的安全启动与加密内存。
- 负责：**密钥生成/托管、加解密运算、生物识别（Touch/Face ID）匹配、钥匙串保护、随机数**等。
- **密钥永不离开 SEP**：主 CPU/内核只能"请求 SEP 做运算"，无法读取原始密钥。

### 3.2 安全意义
- **即使内核沦陷**（如三角行动/DarkSword 提权后），攻击者**无法直接导出 SEP 内密钥**。
- SEP 为钥匙串、文件加密（Data Protection）、生物识别提供**硬件根信任**。
- 是 iOS"纵深防御"中**软件缓解全部失效后的最后硬件防线**。

### 3.3 局限（平衡视角）
- SEP 保护**密钥与运算**，不直接保护"应用层数据逻辑"：若攻击者能以合法身份**调用** SEP（如解锁状态下以用户身份请求解密），仍可间接获取解密后数据。
- SEP 不阻止**高权限进程读取已解密内存/文件**（全链条沦陷后的运行时窃取）。
- 因此 SEP 是"密钥不可导出"的防线，而非"数据不可被运行时读取"的防线。

---

## 4. 钥匙串窃取（Keychain Theft）

### 4.1 钥匙串如何保护数据
- 钥匙串项**加密存储**，访问受**访问控制列表（ACL）+ 应用沙箱 + 数据保护类（Data Protection class）**约束。
- 部分密钥/项可设为 **SEP 托管（不可导出）**：私钥运算在 SEP 内完成，私钥本身不可读。
- 项可标记 **"This Device Only"**（不随 iCloud 同步）以减少云端暴露。

### 4.2 攻击者如何窃取（全链条沦陷后）
> 以下为公开研究归纳的**窃取路径分类**，用于检测与建模，不含具体利用代码。

| 路径 | 说明 | 受 SEP 影响 |
|---|---|---|
| **root/内核 → 滥用 securityd / 钥匙串 API** | 高权限进程以系统身份调用钥匙串服务读取项 | 非 SEP 项可被读；SEP 私钥仍不可导出 |
| **备份提取** | 通过受信任配对/备份机制导出钥匙串（需解锁+信任） | 受备份加密与 SEP 约束 |
| **越狱/取证工具** | 越狱环境下用工具 dump 钥匙串数据库 | 非 SEP 项可提取 |
| **运行时内存读取** | 读取已解密内存中的凭据/会话 | SEP 不防护运行时内存 |
| **钓鱼/恶意配置描述文件** | 诱导用户安装描述文件/授权，间接获取凭据 | 与 SEP 无关（社会工程） |

### 4.3 与三角行动/全链条的关系
- 三角行动等全链条攻击提权后，**钥匙串是高价值目标**（凭据、令牌、密钥）。
- 三角行动利用**硬件调试特性"调整安全数据区"**，正是试图触及受保护数据/密钥区的体现。
- **SEP 托管的密钥**是攻击者最难拿到的部分；**非 SEP 项与运行时内存**是主要失窃面。

---

## 5. 检测与防护建议

### 个人 / 高危用户
1. **保持系统最新**：三角行动/DarkSword 类零日修复靠系统更新。
2. **高危时启用 Lockdown Mode**：收紧 iMessage 附件与 Web 入口，削弱零点击投递。
3. 关键密钥/凭据尽量使用 **SEP 托管 + This Device Only**；警惕陌生描述文件与授权请求。

### 企业 / 组织
4. 补丁管理覆盖全部 Apple 设备与 BYOD。
5. 移动端 EDR/MTD 关注：**内存驻留植入迹象**（重启即消失→需实时捕获）、iMessage/消息服务异常、钥匙串/securityd 异常批量访问、地理位置异常上报。
6. 对高价值人群分层防护（Lockdown Mode + 专用网络 + 行为监控）。
7. 应用开发侧：**默认以 SEP 托管私钥**、最小化钥匙串明文敏感项、启用强访问控制类。

### 研究 / 防御团队
8. 关注"硬件调试特性/未公开芯片功能"被武器化的情报（三角行动先例），评估软件缓解被硬件架空的风险。
9. 回归测试三角行动/Coruna/DarkSword 相关 CVE 补丁；建立"内存驻留 + 零点击"威胁模型。

---

## 6. 结论

三角行动展示了 iOS 间谍能力的顶峰形态：**iMessage 零点击 + 内存驻留（重启无痕）+ 硬件调试特性绕过内存保护**，并与 Coruna 框架同源演进。面对此类全链条攻击，**Secure Enclave 是密钥层面的最后硬件防线**——密钥不可导出、运算隔离——但它不阻止高权限下的运行时数据读取。**钥匙串窃取**因此成为沦陷后的主要数据目标：非 SEP 项与运行时内存是失窃面，SEP 托管项是最难突破的部分。**防御要点：及时补丁 + Lockdown Mode + 以 SEP 托管关键密钥 + 针对内存驻留与钥匙串异常访问的运行时检测。**

---

## 参考来源
- [Kaspersky reveals details behind the spyware used in Operation Triangulation](https://www.kaspersky.com/about/press-releases/kaspersky-reveals-details-behind-the-spyware-used-in-operation-triangulation)
- [Kaspersky discloses iPhone hardware feature vital in Operation Triangulation case](https://www.kaspersky.com/about/press-releases/kaspersky-discloses-iphone-hardware-feature-vital-in-operation-triangulation-case)
- [Apple addresses two zero-days exploited in Operation Triangulation spyware campaign — The Record](https://therecord.media/apple-patch-zero-days-exploited-in-spyware-campaign)
- [Operation Triangulation — Wikipedia](https://en.wikipedia.org/wiki/Operation_Triangulation)
- [The Secure Enclave — Apple Security Guide](https://support.apple.com/en-ie/guide/security/sec59b0b31ff/web)
- [How to extract certificates and private keys from iOS Keychain — Securitum](https://securitum.com/how_to_extract_certificates_and_private_keys_from_ios_keychain.html)
- [Coruna: The Mysterious Journey of a Powerful iOS Exploit Kit — Google Cloud TI](https://cloud.google.com/blog/topics/threat-intelligence/coruna-powerful-ios-exploit-kit)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
