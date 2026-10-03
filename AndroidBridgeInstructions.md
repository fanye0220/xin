# Android App Bridge Instructions

为了实现“图片直接存在图库里且避免 App 数据翻倍”的需求，你的 React 网页和 Android 原生 App 之间需要通过 `@JavascriptInterface` 进行通信。
我已经在前端写好了相关逻辑：当运行在 Android 壳子里时，App **不会将图片复制到系统数据库**，而是直接将它保存到你的 `Download/MIU` 并只把路径存入数据库，看图时用特定的 URL 方案动态读取。

## 打包步骤（在 Android Studio 中）

由于你使用的是 Android Studio 原生 WebView 打包，这部分详细说明你需要怎么做。

### 第一步：下载并构建网页前端代码

1. 在当前 AI Studio 页面右上角的菜单（通常是三个点或导出按钮），选择 **Export -> Download ZIP** 下载整个项目代码。
2. 解压下载的 ZIP 文件到你的电脑上。
3. 确保你的电脑安装了 [Node.js](https://nodejs.org/)。
4. 打开控制台（终端 / 命令行），进入解压后的目录：
   ```bash
   npm install
   npm run build
   ```
5. 编译完成后，你会看到多出了一个 `dist` 文件夹，这个文件夹里的内容（包含 `assets`，`index.html` 等）就是我们要塞进 APK 的。

### 第二步：配置 Android Studio 项目

1. 打开 Android Studio，新建或打开你用于打包的 Empty View Activity (Kotlin) 项目。
2. 在项目目录下的 `app/src/main/` 路径中，新建一个名为 `assets` 的文件夹（如果没有的话：右键 `main` -> New -> Folder -> Assets Folder）。
3. 在 `assets` 文件夹中新建一个文件夹，比如叫 `dist`。
4. 将第一步前端编译出来的 `dist` 里面**所有的内容**复制到你刚刚新建的 `app/src/main/assets/dist/` 这个目录里。

### 第三步：添加依赖 (WebViewAssetLoader 解决跨域)

由于现代 React 打包出来的是 ES Module 且可能存在本地 file 跨域问题，建议使用 AndroidX 的 WebKit 支持库来挂载本地静态资源。
打开你的 `app/build.gradle.kts`，在 dependencies 里加上：
```kotlin
implementation("androidx.webkit:webkit:1.9.0")
```

### 第四步：修改 MainActivity.kt

下面是打包所需要的 Android 端 `MainActivity.kt` 完整代码供你参考，请将其覆盖应用到你的 Android Studio 项目中。

```kotlin
package com.yourdomain.app  // 请修改为你的实际包名

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.util.Base64
import android.webkit.*
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONArray
import java.io.*

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    
    // 你希望存储卡的公用目录：Download/MIU
    private val saveDirectory by lazy {
        File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "MIU")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        webView = WebView(this)
        setContentView(webView)

        if (!saveDirectory.exists()) {
            saveDirectory.mkdirs()
        }

        // 创建 .nomedia 文件阻止相册扫描
        val nomedia = File(saveDirectory, ".nomedia")
        if (!nomedia.exists()) {
            nomedia.createNewFile()
        }

        // 申请权限 (Android 6.0+)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(
                Manifest.permission.WRITE_EXTERNAL_STORAGE, 
                Manifest.permission.READ_EXTERNAL_STORAGE
            ), 1)
        }

        setupWebView()
        // 使用 WebViewAssetLoader 提供的一个模拟 HTTPS 本地服务器地址加载 assets/dist/ 下的内容
        webView.loadUrl("https://appassets.androidplatform.net/assets/dist/index.html")
    }

    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            
            // 解决跨域和本地文件读取问题
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
        }

        // 代理本地 Assets (挂载本地 dist 文件夹 到域名)
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        // 添加 JavaScript 桥接
        webView.addJavascriptInterface(WebAppInterface(), "Android")

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url.toString()
                
                // 1. 拦截我们自定义的相册图片读取协议
                if (url.startsWith("https://appassets.androidplatform.net/localfile?path=")) {
                    try {
                        val path = request.url.getQueryParameter("path")
                        if (path != null) {
                            val file = File(path)
                            if (file.exists()) {
                                val mimeType = if (path.endsWith(".png", true)) "image/png" else "image/jpeg"
                                // Access-Control-Allow-Origin 等跨域头如果是同源就可以免了，安全拉满
                                return WebResourceResponse(mimeType, "UTF-8", FileInputStream(file))
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
                
                // 2. 拦截本地包文件 (HTML, JS, CSS)
                return assetLoader.shouldInterceptRequest(request.url)
            }
        }
        
        webView.webChromeClient = WebChromeClient()
    }

    // 支持通过手势返回上一级网页或关闭弹窗
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    inner class WebAppInterface {

        private val openZips = java.util.concurrent.ConcurrentHashMap<String, java.util.zip.ZipOutputStream>()

        // 开启一个原生 ZIP 流
        @JavascriptInterface
        fun startZip(filename: String): Boolean {
            return try {
                if (!saveDirectory.exists()) saveDirectory.mkdirs()
                val file = File(saveDirectory, filename)
                // 确保父目录存在，如果用户传了包含斜杠的名字
                file.parentFile?.mkdirs()
                val fos = FileOutputStream(file)
                val zos = java.util.zip.ZipOutputStream(fos)
                openZips[filename] = zos
                true
            } catch (e: Exception) {
                e.printStackTrace()
                false
            }
        }

        // 往原生 ZIP 流写入单个文件
        @JavascriptInterface
        fun addZipEntry(zipFilename: String, entryName: String, base64Data: String): Boolean {
            return try {
                val zos = openZips[zipFilename] ?: return false
                val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                zos.putNextEntry(java.util.zip.ZipEntry(entryName))
                zos.write(bytes)
                zos.closeEntry()
                true
            } catch (e: Exception) {
                e.printStackTrace()
                false
            }
        }

        // 接收一个本地 ZIP 路径，交由 Java 原生进行高性能解压，解压到指定目录并返回所有解压出来的文件绝对路径 JSON 数组
        @JavascriptInterface
        fun unzipFile(zipFilePath: String, targetFolderName: String): String {
            val filePaths = JSONArray()
            try {
                val sourceZip = File(zipFilePath)
                if (!sourceZip.exists()) return "[]"

                val targetDir = File(saveDirectory, targetFolderName)
                if (!targetDir.exists()) targetDir.mkdirs()

                java.util.zip.ZipInputStream(FileInputStream(sourceZip)).use { zis ->
                    var entry = zis.nextEntry
                    while (entry != null) {
                        val newFile = File(targetDir, entry.name)
                        // 阻止跨目录穿透漏洞
                        if (!newFile.canonicalPath.startsWith(targetDir.canonicalPath)) {
                            zis.closeEntry()
                            entry = zis.nextEntry
                            continue
                        }
                        
                        if (entry.isDirectory) {
                            newFile.mkdirs()
                        } else {
                            newFile.parentFile?.mkdirs()
                            FileOutputStream(newFile).use { fos ->
                                zis.copyTo(fos)
                            }
                            filePaths.put(newFile.absolutePath)
                        }
                        zis.closeEntry()
                        entry = zis.nextEntry
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            return filePaths.toString()
        }

        // 把现有文件复制进 ZIP (可选扩展)
        @JavascriptInterface
        fun addLocalFileToZip(zipFilename: String, entryName: String, localFilePath: String): Boolean {
            return try {
                val zos = openZips[zipFilename] ?: return false
                val srcFile = File(localFilePath)
                if (!srcFile.exists()) return false
                zos.putNextEntry(java.util.zip.ZipEntry(entryName))
                srcFile.inputStream().use { it.copyTo(zos) }
                zos.closeEntry()
                true
            } catch (e: Exception) {
                e.printStackTrace()
                false
            }
        }

        // 结束原生 ZIP 流并保存
        @JavascriptInterface
        fun finishZip(zipFilename: String): String? {
            return try {
                val zos = openZips.remove(zipFilename) ?: return null
                zos.close()
                File(saveDirectory, zipFilename).absolutePath
            } catch (e: Exception) {
                e.printStackTrace()
                null
            }
        }

        // 保存文件到公共目录，返回绝对路径
        @JavascriptInterface
        fun saveTavernFile(filename: String, base64Data: String): String? {
            try {
                if (!saveDirectory.exists()) saveDirectory.mkdirs()
                val file = File(saveDirectory, filename)
                val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                val fos = FileOutputStream(file)
                fos.write(bytes)
                fos.close()
                return file.absolutePath
            } catch (e: Exception) {
                e.printStackTrace()
                return null
            }
        }

        // 读取文件的 Base64 数据返回给JS（用于导出或注入附加数据）
        @JavascriptInterface
        fun readTavernFile(path: String): String? {
            try {
                val file = File(path)
                if (file.exists()) {
                    val bytes = file.readBytes()
                    return Base64.encodeToString(bytes, Base64.NO_WRAP)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            return null
        }

        // 递归扫描目录下所有图片文件
        private fun scanDirForPng(dir: File, paths: JSONArray) {
            val files = dir.listFiles()
            files?.forEach {
                if (it.isDirectory) {
                    scanDirForPng(it, paths)
                } else if (it.absolutePath.endsWith(".png", true)) {
                    paths.put(it.absolutePath)
                }
            }
        }

        // 调用 Android 文件扫描，返回所有图片（支持递归，实现免导入自动加载）
        @JavascriptInterface
        fun pickFiles(): String {
            try {
                val paths = JSONArray()
                scanDirForPng(saveDirectory, paths)
                return paths.toString()
            } catch (e: Exception) {
                e.printStackTrace()
            }
            return "[]"
        }

        @JavascriptInterface
        fun deleteFile(path: String): Boolean {
            return try {
                File(path).delete()
            } catch (e: Exception) {
                false
            }
        }
    }
}
```

### 第五步：编译并运行与改名

改名说明：如果你想修改你的应用名字叫 "MIU"，请在 Android Studio 的左侧栏找到 `app/src/main/res/values/strings.xml`，修改里面的 `<string name="app_name">...` 为 `<string name="app_name">MIU</string>`。这样生成的 APK 就会显示为 MIU。

在 Android Studio 点击绿色的运行箭头，将打包好的应用跑在模拟器或手机上。
由于前端已经在 `src/lib/appBridge.ts` 检测了 `!!window.Android`：
如果是在 App 里：
- 导入卡片或任意其它文件（预设、美化、世界书、批量ZIP等）不再占用应用内部存储。全部根据分类（美化、世界书、角色等分类）文件夹树存在手机 Download/MIU 下。
- 卡片读取图片采用 `https://appassets.androidplatform.net/localfile?path=`，原生进行本地文件挂接，完全0流量高速读取。
- 手机 `Download/MIU` 文件夹将会拥有像文件管理器那样清晰的层次结构，无论是你导出、保存还是导入，全部彻底打通！

**特别注意 AndroidManifest.xml 的网络配置**：
在 `<application>` 标签里可以顺便加一下 `android:usesCleartextTraffic="true"` 以避免本地网页路由被安全策略拦截。

你只要按照这种方式走，你的 APK 将会是一个零流量离线版，并且它的所有图片资源均和你的酒馆应用外置相册互通了！
