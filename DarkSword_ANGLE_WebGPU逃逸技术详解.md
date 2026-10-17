# DarkSword ANGLE/WebGPU 逃逸技术详解

> 编制日期：2026-10-13
> 数据来源：Google Project Zero、Apple Security Advisory、公开安全研究
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. 执行摘要

**DarkSword 沙箱逃逸阶段**的核心创新在于利用 **ANGLE/WebGPU 图形栈**作为逃逸跳板。与 Coruna 直接攻击 IOGPUDevice 内核驱动不同，DarkSword 采用**两阶段逃逸**：先通过 ANGLE 层获得中间权限，再通过媒体服务注入实现完整沙箱逃逸。

本文深入解析 DarkSword 的 ANGLE/WebGPU 逃逸技术。

**核心内容**：
1. ANGLE 架构与攻击面
2. WebGPU 新增攻击面
3. DarkSword 两阶段逃逸原理
4. CVE-2025-43529 与逃逸链
5. 与 Coruna GPU 逃逸对比

**风险等级：严重（Critical）**。

---

## 2. ANGLE 架构与攻击面

### 2.1 ANGLE 在 WebKit 中的位置

```
JavaScript WebGL/WebGPU API
        ↓
WebKit WebGraphicsContext3D
        ↓
ANGLE（Almost Native Graphics Layer Engine）
  ├─ OpenGL ES → Metal 转换
  ├─ Shader 编译/优化
  └─ 命令缓冲管理
        ↓
Metal API
        ↓
IOGPUDevice（内核 GPU 驱动）
```

### 2.2 ANGLE 攻击面

| 组件 | 功能 | 攻击面 |
|---|---|---|
| **Shader 解析** | 解析 GLSL shader | 高（复杂语法） |
| **纹理处理** | 纹理上传/采样 | 中 |
| **命令缓冲** | GPU 命令提交 | 高 |
| **缓冲区管理** | 顶点/索引缓冲区 | 中 |
| **状态管理** | OpenGL 状态机 | 中 |

### 2.3 ANGLE 进程模型

```
WebContent 进程（沙箱内）
        ↓
ANGLE 库（链接在 WebContent 内）
        ↓
Metal API（系统框架）
        ↓
IOGPUDevice（内核驱动）
```

**关键**：ANGLE 运行在 WebContent 进程内，但通过 Metal 与内核 GPU 驱动交互。

---

## 3. WebGPU 新增攻击面

### 3.1 WebGPU vs WebGL

| 维度 | WebGL | WebGPU |
|---|---|---|
| **API 层级** | 高层（OpenGL ES） | 低层（类 Vulkan/Metal） |
| **控制粒度** | 粗粒度 | 细粒度 |
| **Shader 语言** | GLSL ES | WGSL |
| **攻击面** | 较小 | **更大** |

### 3.2 WebGPU 新增攻击面

| 攻击面 | 说明 |
|---|---|
| **WGSL Shader** | 新语言，新解析器 |
| **Compute Shader** | 通用计算，更多内存操作 |
| **缓冲区绑定** | 更细粒度的内存映射 |
| **管线状态** | 复杂状态对象管理 |
| **同步原语** | Fence/Semaphore 管理 |

**结论**：WebGPU 比 WebGL 攻击面更大，是 DarkSword 的重要突破口。

---

## 4. DarkSword 两阶段逃逸

### 4.1 逃逸架构

```
阶段 1：ANGLE/WebGPU 漏洞
  WebContent 内 → ANGLE 层代码执行
        ↓
阶段 2：媒体服务注入
  ANGLE 层 → mediaserverd 注入
        ↓
结果：脱离 WebContent 沙箱
```

### 4.2 阶段 1：ANGLE 层利用

**CVE-2025-43529**（JSC DFG GC 缺陷）提供初始原语：

```
JSC DFG JIT GC 缺陷
        ↓
在 WebContent 内获得内存原语
        ↓
构造特制 WebGL/WebGPU 命令
        ↓
通过 ANGLE 提交
        ↓
ANGLE 解析时触发内存破坏
        ↓
在 ANGLE 层获得代码执行
```

**技术细节**：
- ANGLE Shader 解析时缓冲区溢出
- 或 WebGPU 命令缓冲处理缺陷
- 在 WebContent 进程内但超出 WebKit 控制

### 4.3 阶段 2：媒体服务注入

```
ANGLE 层代码执行
        ↓
构造恶意媒体命令
        ↓
通过 IPC 传递给 mediaserverd
        ↓
mediaserverd 处理时触发漏洞
        ↓
在 mediaserverd 内代码执行
        ↓
mediaserverd 权限更高（无 WebContent 沙箱）
        ↓
沙箱逃逸成功
```

**关键**：mediaserverd 处理音频/视频，权限高于 WebContent，且沙箱更宽松。

---

## 5. CVE-2025-43529 详解

### 5.1 漏洞概述

| 维度 | 说明 |
|---|---|
| **CVE** | CVE-2025-43529 |
| **组件** | JavaScriptCore DFG JIT |
| **类型** | GC（垃圾回收）缺陷 |
| **影响** | iOS 18.6–18.7 |
| **作用** | 提供 WebContent 内内存原语 |

### 5.2 漏洞原理（简化）

```
DFG JIT 优化 GC 相关操作
        ↓
错误处理某些对象的引用跟踪
        ↓
对象被提前回收（UAF）
        ↓
或 GC 标记位错误 → 类型混淆
        ↓
提供 addrof/fakeobj 等原语
```

### 5.3 在逃逸链中的作用

```
CVE-2025-43529（JSC GC 缺陷）
        ↓
提供内存原语（addrof/fakeobj/任意读写）
        ↓
构造 ANGLE/WebGPU 攻击载荷
        ↓
触发 ANGLE 层漏洞
        ↓
阶段 1 完成
```

---

## 6. 与 Coruna GPU 逃逸对比

| 维度 | Coruna | DarkSword |
|---|---|---|
| **初始漏洞** | CVE-2024-23222（JSC 类型混淆） | CVE-2025-43529（JSC GC 缺陷） |
| **逃逸路径** | ANGLE → IOGPUDevice（内核） | ANGLE → mediaserverd（用户态） |
| **逃逸阶段** | 单阶段（直接到内核态） | 两阶段（先用户态，再提权） |
| **目标组件** | IOGPUDevice 内核驱动 | mediaserverd 用户态服务 |
| **复杂度** | 中 | 高 |

**分析**：
- **Coruna**：更直接，一步到内核态
- **DarkSword**：更复杂，但可能更稳定/隐蔽

---

## 7. 防御与检测

### 7.1 Apple 修复

| 版本 | 修复内容 |
|---|---|
| iOS 18.7+ | 修复 CVE-2025-43529 |
| iOS 18.7.1+ | 加强 ANGLE/WebGPU 安全 |

### 7.2 防御建议

| 措施 | 说明 |
|---|---|
| **及时更新** | 修复 JSC/ANGLE 漏洞 |
| **Lockdown Mode** | 禁用 WebGL/WebGPU |
| **运行时检测** | 监控异常 GPU 命令 |
| **WebGPU 谨慎使用** | 评估 WebGPU 安全风险 |

---

## 8. 总结

DarkSword ANGLE/WebGPU 逃逸是攻击链的**第三阶段**：

| 维度 | 现状 |
|---|---|
| **初始漏洞** | CVE-2025-43529（JSC GC 缺陷） |
| **逃逸路径** | ANGLE → mediaserverd（两阶段） |
| **创新点** | 利用 WebGPU 新攻击面 |
| **与 Coruna 差异** | 两阶段 vs 单阶段 |

**技术要点**：
1. WebGPU 比 WebGL 攻击面更大
2. 两阶段逃逸：ANGLE → 媒体服务
3. CVE-2025-43529 提供初始原语
4. mediaserverd 作为逃逸跳板

---

## 参考来源

- Apple Security Advisory: iOS 18.7+
- Google Project Zero: DarkSword analysis
- WebKit Open Source: ANGLE/WebGPU implementation

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
