# iOS 凭证窃取与擦除分析报告

> 编制日期：2026-10-06
> 性质：防御性安全研究分析（Defensive Security Research）
> 范围：聚焦 iOS 上**凭证（credential）的保护体系与窃取手法**，以及两类"**擦除**"——攻击者的**反取证痕迹擦除**与**破坏性数据擦除**。结合公开案例（三角行动、DarkSword 等）说明原理，并给出检测与加固建议。

---

## 1. 执行摘要

凭证（密码、令牌、密钥、passkey、会话 cookie）是攻击者在取得设备权限后最高价值的目标；而"擦除"则有两个截然相反的含义：

- **攻击者视角的擦除（反取证）**：无持久化载荷在窃取完成后**清除内存、日志与临时文件**，规避取证与检测（三角行动、DarkSword）。
- **防御/破坏视角的擦除（数据销毁）**：iOS 的 **Crypto Erase（密码擦除）** 通过销毁 Data Protection 密钥类使数据"瞬间不可读"；这既是合法远程擦除的基础，也可能被滥用为破坏性/勒索式擦除。

**核心结论**：凭证安全依赖 **Data Protection 分级 + Secure Enclave 密钥不可导出 + 恰当的 Keychain 可访问性属性**；而对抗"擦除"（无论反取证还是破坏性）的关键是**运行时行为检测、离线备份与密钥托管（crypto-shredding）**。对普通用户，**升级到最新 iOS + 启用锁定模式 + 使用 passkey** 能显著降低凭证被窃取的风险。

**风险等级：严重（Critical）。**

---

## 2. iOS 凭证保护体系（窃取前需理解的防线）

| 机制 | 作用 | 关键点 |
|---|---|---|
| **Keychain** | 加密存储密码、令牌、证书、密钥 | 条目带**可访问性属性**（何时可解密） |
| **Data Protection** | 文件按锁屏状态分级加密（NSFileProtection*） | 分 Complete / CompleteUnlessOpen / UntilFirstUserAuthentication / None |
| **Secure Enclave (SEP)** | 生成/保管密钥，执行加密运算 | **私钥不可导出**，只能"请求使用" |
| **密钥分级 (Class A/B/C/D)** | 不同锁屏状态下密钥是否驻留内存 | 决定"锁屏后能否被离线读取" |
| **iCloud Keychain / passkey** | 端到端加密同步、无密码认证 | passkey 基于 FIDO2，抗钓鱼 |

**Keychain 可访问性属性（决定暴露面）**
- `kSecAttrAccessibleWhenUnlocked`：仅解锁后可读（最严）。
- `kSecAttrAccessibleAfterFirstUnlock`：首次解锁后可读（常用）。
- `kSecAttrAccessibleAlways`（已废弃）：**任何时候都可读**——即使设备锁定，历史上是取证/恶意工具的重点目标。

---

## 3. 凭证窃取手法（分类）

### 3.1 取得系统/内核权限后的批量窃取
- **钥匙串批量导出（Keychain Dumper）**：内核提权后绕过 Keychain 访问控制，批量导出条目（三角行动 TriangleDB 窃取钥匙串、令牌等）。
- **Data Protection 密钥滥用**：在密钥已驻留内存（解锁态）时读取受保护文件与凭证。
- **内存抓取**：经 `task_for_pid` / 内核读原语，从进程内存中提取明文口令、会话令牌、解密密钥。

### 3.2 SEP 相关（"使用而非窃取"）
- SEP 私钥**无法导出**；攻击者无法直接偷走密钥。
- 但可在设备解锁、密钥可用时**滥用授权操作**——借 SEP 完成签名/解密，冒充合法用户进行认证。

### 3.3 App 层 / 无内核权限的窃取
- **覆盖钓鱼（Overlay / Phishing）**：在合法 App 上叠加伪造登录界面骗取凭证。
- **剪贴板窥探**：读取复制到剪贴板的密码/OTP。
- **键盘记录 / 恶意输入法**：捕获输入。
- **OAuth / 令牌窃取**：滥用 URL scheme、令牌存储不当或中间人重定向窃取访问令牌。
- **第三方 SDK / 供应链**：被植入或过度索权的 SDK 回传凭证。

### 3.4 配置与社会工程
- **描述文件 / MDM 滥用**：诱导安装恶意配置描述文件，接管证书/代理以实施中间人。
- **凭证填充（Credential Stuffing）**：用泄露库批量尝试弱口令/复用口令。

> **要点**：SEP 与端到端加密使"离线偷密钥"极难；现实中凭证多经**解锁态滥用、App 层钓鱼、内存明文**被获取，而非攻破 SEP 本身。

---

## 4. "擦除"的两种含义与原理

### 4.1 攻击者的反取证痕迹擦除（Anti-Forensics）
- **内存驻留 + 用后清除**：无持久化 implant 完成任务后清除内存结构与临时数据（三角行动重启即消失）。
- **日志/痕迹清理**：删除或篡改可用于取证的记录。
- **自毁触发**：检测到分析环境、锁定模式或风险时主动擦除，减少可取证数据。
- **防御影响**：使"事后静态取证"价值大降，检测必须前移到**运行时行为与网络遥测**。

### 4.2 破坏性/合法数据擦除（Data Erase）
- **Crypto Erase（密码擦除）原理**：iOS 数据由 Data Protection 密钥类加密；擦除时**销毁对应密钥（含 SEP 包裹的密钥）**，令全盘数据在密码学意义上"瞬间不可读"，无需逐字节覆写。
- **合法用途**：远程擦除丢失设备、"抹掉所有内容和设置"、MDM 强制擦除、多次错误密码后自动擦除策略。
- **潜在滥用**：攻击者取得控制权后触发擦除，造成**破坏性数据销毁或勒索式擦除**；对未备份用户不可逆。

---

## 5. 案例映射

| 案例 | 凭证窃取 | 擦除行为 |
|---|---|---|
| **三角行动 (Operation Triangulation)** | TriangleDB 导出钥匙串、令牌、定位、录音 | **内存 implant，重启清除**（反取证擦除） |
| **DarkSword** | 向核心系统服务注入脚本聚合机密（密钥/凭据/数据） | **无持久化**，短时驻留后**清除痕迹** |
| **GHOSTBLADE** | 复用 DarkSword 组件 | 同上；检测锁定模式即中止 |
| **覆盖钓鱼 / 恶意描述文件** | 骗取登录凭证、OAuth 令牌 | —（多为持续窃取，非擦除） |

---

## 6. 检测与威胁狩猎

**凭证窃取 IOC**
- 钥匙串 / 密钥库的**异常批量访问**或高频读取。
- 异常 `task_for_pid`、进程内存被读取、可疑调试附加。
- 麦克风、相册、定位的异常并发调用（伴随凭证聚合）。
- 未预期的配置描述文件安装、异常代理/证书（中间人迹象）。
- 覆盖窗口 / 异常 URL scheme 跳转、OAuth 重定向到非白名单域。

**擦除 / 反取证 IOC**
- 进程短生命周期却完成大量敏感操作后"消失"。
- 系统/审计日志异常缺失或时间线断裂。
- WebContent/WebKit 崩溃后紧跟异常子进程与内存操作。

**网络 IOC**
- DGA / 伪随机域名外传；异常加密通道与非常规端口；定时信标心跳。

**取证与资产**
- 对可疑设备做**内存镜像**，用 Volatility / MemInspect 分析内存 implant 与解密后的凭证缓存。
- 经 MDM 遥测筛选 iOS < 18.7.3（或 < 26.3）等受影响设备。

---

## 7. 缓解与防护建议

### 7.1 立即措施
1. **升级系统**：iOS/iPadOS 至 **18.7.3+**（iOS 26 用户至 **26.3+**），其余 Apple OS 同步最新。
2. **启用 Lockdown Mode**：高危人群强烈建议——压缩攻击面，多数高级载荷检测到即中止。
3. **改用 passkey / FIDO2**：以抗钓鱼的无密码认证替代可被填充/窃取的口令。

### 7.2 开发者 / 应用侧
4. **正确设置 Keychain 可访问性**：优先 `WhenUnlocked` / `AfterFirstUnlock`，避免 `Always`。
5. **合理选择 Data Protection 分级**：敏感文件用 `NSFileProtectionComplete`，锁屏即不可读。
6. **不在内存/日志/剪贴板长期留存明文凭证**；用后及时清零。
7. **令牌最小权限 + 短时效 + 绑定设备**，降低被窃取后的可用性。

### 7.3 企业 / 组织
8. **离线备份 + 密钥托管（crypto-shredding）**：对关键数据保留离线备份与独立密钥管理，抗破坏性擦除/勒索。
9. **MDM 远程擦除策略**：为丢失/失陷设备配置可审计的擦除流程，并防止被滥用。
10. **运行时检测（MTD/EDR）**：捕捉钥匙串异常访问、进程注入、覆盖钓鱼、异常描述文件。
11. **网络管控与资产可视化**：封禁恶意门户，监控 DGA/异常外传，清点受影响设备。
12. **治理与合规**：将凭证泄露与数据擦除事件纳入安全、法务、治理联合评估。

### 7.4 个人用户
13. 不安装来源不明描述文件，不点击可疑链接，警惕伪造登录页。
14. 保持系统自动更新，开启双重认证（2FA）与定期备份。
15. 高危人群启用 Lockdown Mode，减少敏感操作暴露在不可信网络/网页中。

---

## 8. 结论

凭证窃取与擦除是 iOS 攻击链"**目标行动 + 反取证**"两端的集中体现：一端用内核权限、解锁态滥用或 App 层钓鱼**聚合最高价值凭证**，另一端用**内存清除/痕迹擦除**规避取证，或（在破坏场景下）用 **Crypto Erase** 造成不可逆数据销毁。

Apple 的 **Data Protection 分级 + Secure Enclave 密钥不可导出 + passkey** 大幅抬高了"离线偷密钥"的门槛；现实风险主要来自**解锁态滥用、内存明文、钓鱼与配置滥用**。防御方须把重心转向**运行时检测、网络遥测、正确加密分级与离线备份/密钥托管**，并以**及时补丁 + Lockdown Mode + passkey + 备份**作为普通用户与组织的务实底线。

---

## 参考来源
- [Apple Platform Security Guide — Protecting app access to user data / Data Protection](https://support.apple.com/guide/security/)
- [Operation Triangulation: TriangleDB implant — Kaspersky Securelist](https://securelist.com/operation-triangulation-triangledb-implant/)
- [The Proliferation of DarkSword: iOS Exploit Chain — Google Cloud Threat Intelligence](https://cloud.google.com/blog/topics/threat-intelligence/darksword-ios-exploit-chain)
- [CSA Research Note: DarkSword iOS Full-Chain Zero-Day, Multi-Actor](https://labs.cloudsecurityalliance.org/research/csa-research-note-darksword-ios-fullchain-zeroday-multiactor/)
- [FIDO2 / Passkeys — Apple Support](https://support.apple.com/)

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
