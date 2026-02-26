# js-udocker / udocker.js

## 中文

- 這個 `udocker` 是基於 **udocker 1.3.17** 的原始碼重寫的JavaScript版本，只有簡單實做。  
- 此專案的程式碼 **完全由 GPT Codex 產生**。
- .
- 這邊刻意不實做run，因為主要要在安卓跑，請自行用proot運行，完整指令可以在Termux運行：
- proot-distro login <其他distro>
- 左側右滑+開新分頁
- ps -eo pid,args | grep --color=auto proot
- 根目錄：~/.udocker/containers/name or id/ROOT

### 使用方式

以下指令均以專案根目錄執行：

```bash
bun udocker.js pull ubuntu:latest
bun udocker.js create --name=myubuntu ubuntu:latest
bun udocker.js ps
bun udocker.js rm <container-id|name>
bun udocker.js rmi <repo/image:tag>
bun udocker.js rename <old-name> <new-name>
bun udocker.js images
bun udocker.js help
```

### 指令說明

- `pull <repo/image:tag>`：下載 image layers 與 metadata
- `create [--name=NAME] <repo/image:tag>`：由 image 建立 container
- `ps`：列出 container
- `rm <container-id|name>`：刪除 container
- `rmi <repo/image:tag>`：刪除 image
- `rename <old-name> <new-name>`：變更 container 名稱

---

## English

- This `udocker` is a JavaScript rewrite of the original **udocker 1.3.17** (based on its code) with only simple implementations  
- All code in this project is **generated entirely by GPT Codex** .
- It intentionally didn't implement 'run' because it's targeting Android. Please run by proot yourself. The full cmdline can be obtained by running in Termux:
- proot-distro login <other-distro>
- new session by swiping right at the left side
- ps -eo pid,args | grep --color=auto proot
- RootFs: ~/.udocker/containers/name or id/ROOT

### Usage

Run the following from the project root:

```bash
bun udocker.js pull ubuntu:latest
bun udocker.js create --name=myubuntu ubuntu:latest
bun udocker.js ps
bun udocker.js rm <container-id|name>
bun udocker.js rmi <repo/image:tag>
bun udocker.js rename <old-name> <new-name>
bun udocker.js images
bun udocker.js help
```

### Commands

- `pull <repo/image:tag>`: download image layers and metadata
- `create [--name=NAME] <repo/image:tag>`: create a container from an image
- `ps`: list containers
- `rm <container-id|name>`: delete a container
- `rmi <repo/image:tag>`: delete an image
- `rename <old-name> <new-name>`: rename a container alias
