# DarkSword 媒体服务注入技术详解

> 编制日期：2026-10-13
> 数据来源：Google Project Zero、Apple Security Advisory、公开安全研究
> 性质：防御性安全研究分析（Defensive Security Research），不提供可利用代码

---

## 1. 执行摘要

**DarkSword 媒体服务注入**是沙箱逃逸的第二阶段核心——在 ANGLE 层获得代码执行后，攻击者将恶意指令注入 **mediaserverd**（iOS 媒体服务守护进程），利用其更高权限实现完整沙箱逃逸。

本文深入解析 DarkSword 媒体服务注入的技术细节。

**核心内容**：
1. mediaserverd 架构与权限
2. 媒体服务注入原理
3. 注入技术与漏洞利用
4. 从 mediaserverd 到系统级权限
5. 与 Coruna 逃逸路径对比

**风险等级：严重（Critical）**。

---

## 2. mediaserverd 架构与权限

### 2.1 mediaserverd 概述

**mediaserverd** 是 iOS 的核心媒体服务守护进程，负责：

| 功能 | 说明 |
|---|---|
| **音频处理** | 播放、录制、混音 |
| **视频处理** | 编解码、渲染 |
| **相机控制** | 摄像头访问 |
| **AirPlay** | 无线流媒体 |
| **媒体库** | 音乐/视频库管理 |

### 2.2 mediaserverd 权限

| 权限 | 说明 |
|---|---|
| **麦克风访问** | 可录制音频 |
| **摄像头访问** | 可拍照/录像 |
| **文件系统** | 可访问媒体文件 |
| **网络** | 可进行网络流媒体 |
| **沙箱** | 比 WebContent 宽松 |

### 2.3 mediaserverd 进程模型

```
mediaserverd（系统守护进程）
        ├─ 音频引擎（CoreAudio）
        ├─ 视频引擎（AVFoundation）
        ├─ 编解码器（VideoToolbox/AudioToolbox）
        └─ 网络流（AirPlay/DLNA）
```

**关键**：mediaserverd 权限高于 WebContent，且沙箱限制更少。

---

## 3. 媒体服务注入原理

### 3.1 注入目标

```
ANGLE 层代码执行（WebContent 内）
        ↓
通过 IPC 与 mediaserverd 通信
        ↓
发送特制媒体请求
        ↓
mediaserverd 处理时触发漏洞
        ↓
在 mediaserverd 内代码执行
        ↓
沙箱逃逸成功
```

### 3.2 通信接口

WebContent 与 mediaserverd 的通信方式：

| 接口 | 说明 |
|---|---|
| **XPC** | 进程间通信 |
| **Mach IPC** | Mach 消息 |
| **共享内存** | 媒体数据共享 |
| **IOKit** | 设备控制 |

### 3.3 注入向量

| 向量 | 说明 |
|---|---|
| **音频数据** | 特制音频文件触发解析漏洞 |
| **视频数据** | 特制视频文件触发编解码漏洞 |
| **媒体命令** | 特制控制命令触发逻辑漏洞 |
| **共享内存** | 通过共享内存传递恶意数据 |

---

## 4. 注入技术与漏洞利用

### 4.1 攻击流程

```
阶段 1：ANGLE 层代码执行
        ↓
准备媒体注入载荷
  - 构造特制音频/视频数据
  - 准备 IPC 消息
        ↓
通过 IPC 发送给 mediaserverd
        ↓
mediaserverd 接收并处理
        ↓
解析媒体数据时触发漏洞
        ↓
在 mediaserverd 内代码执行
        ↓
沙箱逃逸成功
```

### 4.2 可能的漏洞类型

| 类型 | 说明 | 案例 |
|---|---|---|
| **音频解析溢出** | 音频格式解析缓冲区溢出 | 历史常见 |
| **视频编解码缺陷** | 编解码器内存破坏 | 历史常见 |
| **XPC 接口缺陷** | XPC 消息处理漏洞 | 历史常见 |
| **共享内存越界** | 共享内存访问越界 | 理论存在 |

### 4.3 利用技术

**音频注入示例**（简化）：
```
构造特制音频文件
  - 格式：AAC/MP3/WAV
  - 包含恶意数据（超长/格式错误）
        ↓
通过 IPC 发送给 mediaserverd
        ↓
mediaserverd 调用音频解码器
        ↓
解码器解析时缓冲区溢出
        ↓
覆写堆内存 → 控制流劫持
        ↓
在 mediaserverd 内执行代码
```

**视频注入示例**（简化）：
```
构造特制视频文件
  - 格式：H.264/HEVC
  - 包含恶意帧数据
        ↓
通过 IPC 发送给 mediaserverd
        ↓
mediaserverd 调用视频解码器
        ↓
解码器处理恶意帧时触发漏洞
        ↓
在 mediaserverd 内执行代码
```

---

## 5. 从 mediaserverd 到系统级权限

### 5.1 mediaserverd 内的能力

| 能力 | 说明 |
|---|---|
| **麦克风控制** | 可录制音频 |
| **摄像头控制** | 可拍照/录像 |
| **文件访问** | 可访问媒体文件 |
| **网络访问** | 可进行网络通信 |
| **部分系统 API** | 可调用部分系统功能 |

### 5.2 后续提权

```
在 mediaserverd 内代码执行
        ↓
但仍非 root / 内核读写
        ↓
需要内核提权漏洞
        ↓
利用 IOKit / 内核漏洞
        ↓
获得 root 权限
```

### 5.3 与后续阶段的衔接

```
mediaserverd 代码执行
        ↓
内核提权（IOKit/内核漏洞）
        ↓
root 权限 + 内核读写
        ↓
安装 Pegasus 载荷
        ↓
数据采集 → 外传
```

---

## 6. 与 Coruna 逃逸路径对比

| 维度 | Coruna | DarkSword |
|---|---|---|
| **逃逸路径** | ANGLE → IOGPUDevice（内核） | ANGLE → mediaserverd（用户态） |
| **目标进程** | 内核 GPU 驱动 | 用户态媒体服务 |
| **权限级别** | 直接到内核态 | 先到用户态，再提权 |
| **复杂度** | 中（单阶段） | 高（两阶段） |
| **隐蔽性** | 中 | 高（用户态操作更隐蔽） |

**分析**：
- **Coruna**：更直接，但可能更容易被检测
- **DarkSword**：更复杂，但更隐蔽，且 mediaserverd 本身有更多能力

---

## 7. 防御与检测

### 7.1 Apple 修复

| 版本 | 修复内容 |
|---|---|
| iOS 18.7+ | 修复 mediaserverd 相关漏洞 |
| iOS 18.7.1+ | 加强媒体服务安全 |

### 7.2 防御建议

| 措施 | 说明 |
|---|---|
| **及时更新** | 修复 mediaserverd 漏洞 |
| **Lockdown Mode** | 限制媒体处理 |
| **运行时检测** | 监控 mediaserverd 异常行为 |
| **媒体格式限制** | 限制支持的媒体格式 |

### 7.3 检测指标

| 指标 | 说明 |
|---|---|
| **异常 IPC** | WebContent 向 mediaserverd 发送异常消息 |
| **异常崩溃** | mediaserverd 异常崩溃/重启 |
| **异常资源使用** | mediaserverd 异常 CPU/内存使用 |
| **异常媒体处理** | 处理异常媒体文件 |

---

## 8. 总结

DarkSword 媒体服务注入是沙箱逃逸的**第二阶段**：

| 维度 | 现状 |
|---|---|
| **目标** | mediaserverd（媒体服务守护进程） |
| **注入方式** | 通过 IPC 发送特制媒体数据 |
| **漏洞类型** | 音频/视频解析内存破坏 |
| **结果** | 在 mediaserverd 内代码执行 |
| **后续** | 需要内核提权才能完整沦陷 |

**技术要点**：
1. mediaserverd 权限高于 WebContent
2. 通过 IPC 注入特制媒体数据
3. 音频/视频解析漏洞触发代码执行
4. 两阶段逃逸：ANGLE → mediaserverd → 内核

---

## 参考来源

- Apple Security Advisory: iOS 18.7+
- Google Project Zero: DarkSword analysis
- iOS media subsystem documentation

---

咨询 iOS 系统请咨询 Telegram：@DZHT333333
