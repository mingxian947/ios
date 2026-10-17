# Coruna 沙箱逃逸技术详解

> 编制日期：2026-10-13
> 数据来源：Google Project Zero、Apple Security Advisory、公开安全研究
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. 执行摘要

**Coruna 沙箱逃逸阶段**是攻击链中连接 WebKit RCE 与内核提权的关键桥梁。攻击者在 WebContent 进程内获得代码执行后，必须**脱离沙箱限制**才能访问系统资源和进一步提权。

Coruna 的沙箱逃逸主要依赖 **GPU/ANGLE 层漏洞**，通过 IOGPUDevice 用户态接口触发内核驱动缺陷，实现从 WebContent 沙箱到系统级权限的跃迁。

**核心内容**：
1. WebContent 沙箱限制分析
2. GPU/ANGLE 攻击面
3. IOGPUDevice 漏洞利用原理
4. 从沙箱逃逸到内核提权的过渡
5. 与 DarkSword 逃逸路径对比

**风险等级：严重（Critical）**。

---

## 2. WebContent 沙箱限制

### 2.1 Seatbelt 沙箱 Profile

WebContent 进程的沙箱 profile（简化）：

```lisp
(version 1)
(deny default)
(allow process-exec)
(allow file-read* (subpath "/usr/lib"))
(allow mach-lookup (global-name "com.apple.network.*"))
(allow iokit-open (user-client "IOGPUDevice"))  ; ← 允许 GPU
(deny file-read* (subpath "/private/var/mobile"))
(deny network*)
```

### 2.2 关键限制

| 限制 | 说明 | 影响 |
|---|---|---|
| **文件访问** | 不能读取用户数据 | 无法窃取照片/消息 |
| **网络访问** | 不能直接联网 | 需通过系统服务 |
| **进程访问** | 不能访问其他进程 | 无法横向移动 |
| **IOKit 访问** | 仅允许特定 User Client | GPU 是主要攻击面 |

### 2.3 允许的 IOKit 接口

```
WebContent 可访问的 User Client：
  ✓ IOGPUDevice（GPU 驱动）
  ✓ IOHIDEventService（HID 设备）
  ✗ 其他内核驱动
```

**IOGPUDevice 成为沙箱逃逸的主要攻击面**。

---

## 3. GPU/ANGLE 攻击面

### 3.1 ANGLE 架构

```
WebKit WebGL/WebGPU API
        ↓
ANGLE（OpenGL ES → Metal 转换层）
        ↓
Metal API
        ↓
IOGPUDevice（内核 GPU 驱动）
```

### 3.2 攻击面分析

| 组件 | 攻击面 | 风险 |
|---|---|---|
| **ANGLE** | Shader 解析、命令处理 | 中 |
| **Metal** | 缓冲区管理、命令提交 | 中 |
| **IOGPUDevice** | IOCTL 处理、内存管理 | **高** |

### 3.3 IOGPUDevice 漏洞类型

| 类型 | 说明 | 案例 |
|---|---|---|
| **缓冲区溢出** | Shader/命令缓冲区溢出 | Coruna 使用 |
| **整数溢出** | 尺寸计算溢出 | 历史漏洞 |
| **UAF** | GPU 对象释放后使用 | 历史漏洞 |
| **越界访问** | 纹理/缓冲区越界 | 历史漏洞 |

---

## 4. Coruna 沙箱逃逸原理

### 4.1 攻击流程

```
WebKit RCE（WebContent 内代码执行）
        ↓
准备 GPU 攻击：
  - 构造特制 Shader/命令
  - 准备堆数据
        ↓
通过 ANGLE 提交特制 GPU 命令
        ↓
IOGPUDevice 处理时触发漏洞
        ↓
在内核 GPU 驱动内代码执行
        ↓
脱离 WebContent 沙箱
        ↓
获得系统级权限
```

### 4.2 技术细节（简化）

**步骤 1：构造恶意 GPU 命令**
```
攻击者构造特制 Shader 或 GPU 命令缓冲区
        ↓
包含恶意数据（超长/格式错误）
        ↓
通过 ANGLE 提交到 GPU 驱动
```

**步骤 2：触发 IOGPUDevice 漏洞**
```
IOGPUDevice 处理命令
        ↓
解析 Shader/命令时缓冲区溢出
        ↓
覆写内核堆内存
        ↓
劫持控制流
```

**步骤 3：在内核态执行代码**
```
获得 GPU 驱动内代码执行
        ↓
修改沙箱策略 / 提升权限
        ↓
脱离 WebContent 沙箱
```

### 4.3 关键原语

| 原语 | 用途 |
|---|---|
| **内核堆溢出** | 覆写关键数据结构 |
| **控制流劫持** | 执行攻击者代码 |
| **沙箱策略修改** | 解除权限限制 |

---

## 5. 从沙箱逃逸到内核提权

### 5.1 过渡阶段

```
沙箱逃逸成功（系统级权限）
        ↓
但仍非 root / 内核读写
        ↓
需要内核提权漏洞
        ↓
利用 IOKit / 内核漏洞
        ↓
获得 root 权限
```

### 5.2 可能的提权路径

| 路径 | 组件 | 说明 |
|---|---|---|
| **IOKit 驱动** | User Client 漏洞 | 继续利用驱动缺陷 |
| **内核内存** | XNU 内存管理 | 内核堆/栈漏洞 |
| **竞态条件** | 内核竞态 | TOCTOU 漏洞 |

---

## 6. 与 DarkSword 逃逸路径对比

| 维度 | Coruna | DarkSword |
|---|---|---|
| **主要路径** | GPU/ANGLE → IOGPUDevice | ANGLE → 媒体服务注入 |
| **漏洞组件** | IOGPUDevice（内核驱动） | mediaserverd（用户态服务） |
| **逃逸方式** | 内核态代码执行 | 用户态服务注入 |
| **后续提权** | IOKit/内核漏洞 | 内核漏洞 |

**差异分析**：
- **Coruna**：直接攻击内核 GPU 驱动，一步到内核态
- **DarkSword**：先逃逸到用户态服务（mediaserverd），再提权到内核

**共同点**：
- 都利用 GPU/ANGLE 作为初始跳板
- 都需要后续内核提权
- 都针对 iOS 16–18

---

## 7. 防御与检测

### 7.1 Apple 修复

| 版本 | 修复内容 |
|---|---|
| iOS 17.3+ | 修复 IOGPUDevice 漏洞 |
| iOS 17.4+ | 加强 GPU 驱动安全 |

### 7.2 防御建议

| 措施 | 说明 |
|---|---|
| **及时更新** | 修复 GPU 驱动漏洞 |
| **Lockdown Mode** | 禁用 WebGL/WebGPU |
| **运行时检测** | 监控异常 GPU 命令 |
| **IOKit 审计** | 定期审计 User Client |

---

## 8. 总结

Coruna 沙箱逃逸是攻击链的**第三阶段**：

| 维度 | 现状 |
|---|---|
| **攻击面** | GPU/ANGLE → IOGPUDevice |
| **漏洞类型** | 内核驱动缓冲区溢出 |
| **逃逸方式** | 内核态代码执行 → 脱离沙箱 |
| **后续阶段** | 内核提权 → 数据窃取 |

**技术要点**：
1. WebContent 沙箱允许访问 IOGPUDevice
2. GPU/ANGLE 是主要攻击面
3. IOGPUDevice 漏洞实现沙箱逃逸
4. 需要后续内核提权才能完整沦陷

---

## 参考来源

- Apple Security Advisory: iOS 17.3+
- Google Project Zero: iOS sandbox escape research
- Coruna technical analysis reports

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
