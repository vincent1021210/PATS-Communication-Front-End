# PATS · 企業級商務通訊

前端是**託管在 GitHub Pages 的純靜態網站**，後端與資料庫是 **Google Apps Script + Google 試算表**。
支援自助註冊、帳密登入與 Google 登入，介面為手刻 CSS 並完整支援 RWD。

```
瀏覽器 ── HTTPS ──▶ GitHub Pages（HTML / CSS / JS）
   │
   └── fetch POST ──▶ Apps Script /exec ──▶ Google 試算表
```

---

## 專案結構

```
index.html                ← 網站入口，就放在 repo 根目錄
.nojekyll                 （避免 GitHub Pages 用 Jekyll 處理檔案）
assets/
├── css/styles.css        設計系統與 RWD
└── js/
    ├── config.js         ★ 唯一需要你手動修改的檔案
    ├── core.js           狀態、rpc()、共用 UI（toast / modal / menu）
    ├── auth.js           註冊、帳密登入、Google 登入、登出
    ├── chat.js           對話列表與訊息畫面
    ├── settings.js       設定區三個子畫面
    └── main.js           啟動流程與畫面切換

apps-script/              ← 部署成 Apps Script 網頁應用程式（API）
├── appsscript.json       資訊清單：執行身分、權限範圍
├── Code.gs               doPost 進入點與 apiCall 路由
├── Auth.gs               註冊、密碼雜湊、工作階段、Google ID Token 驗證
├── Db.gs                 試算表資料層（schema、CRUD、鎖、快取）
├── Api.gs                對話 / 訊息 / 聯絡人 / 封存 / 設定的商業邏輯
└── Setup.gs              可安全手動執行的初始化與診斷進入點

.github/workflows/deploy-pages.yml   推上 main 就自動發佈前端
```

### 資料表（自動建立於「PATS 資料庫」試算表）

`users`、`sessions`、`contacts`、`conversations`、`participants`、`messages`

---

## 部署步驟

順序很重要：**先部署後端拿到網址，再設定前端**。

### 第一步 — 部署 Apps Script 後端

用 [clasp](https://github.com/google/clasp)：

```bash
npm install -g @google/clasp
clasp login
clasp create --title "PATS API" --type webapp
# 把產生的 scriptId 填進 .clasp.json（可複製 .clasp.json.example），
# 並確認 rootDir 是 "apps-script"
clasp push
```

或手動：在 [script.google.com](https://script.google.com) 建立專案，把 `apps-script/`
內的四個 `.gs` 檔依相同檔名貼上，並在「專案設定」勾選顯示 `appsscript.json` 後一併貼上。

接著在編輯器中依序執行兩個函式：

1. `initializeProject()` — 建立試算表與所有工作表，並在執行紀錄回報目前狀態與下一步。
   （`setup()` 也可以，前者多印一份診斷資訊。）
2. `createAdminAccount()` — 建立第一個帳號。帳密讀自「專案設定 → 指令碼屬性」，
   請先新增 `ADMIN_EMAIL` 與 `ADMIN_PASSWORD`（可選 `ADMIN_NAME`）再執行。
   **密碼刻意不寫在程式碼裡**，因為這份程式碼會推到公開的 git repo；
   建立成功後 `ADMIN_PASSWORD` 會被自動刪除。

> 編輯器的執行選單只會出現可以安全手動執行的函式，其餘內部函式都以底線結尾而被隱藏。

然後「部署」→「新增部署作業」→ 類型選「網頁應用程式」：

| 設定 | 值 | 為什麼 |
| --- | --- | --- |
| 執行身分 | **我** | 所有使用者共用同一份試算表資料庫 |
| 具有存取權的使用者 | **任何人** | 前端在別的網域，必須允許匿名呼叫 |

複製產生的 `.../exec` 網址備用。用瀏覽器直接打開它應該會看到
`{"ok":true,"data":{"app":"PATS","status":"ready",...}}`，代表後端正常。

> **每次改完後端程式碼，都要「管理部署作業」→ 編輯 → 版本選「新版本」再儲存**，
> 否則線上跑的還是舊版。`clasp push` 只更新程式碼，不會更新對外服務的版本；
> 前端會出現「伺服器不認得這個操作」就是漏了這一步。
>
> 用 clasp 的話，要更新**同一個**部署（網址才不會變，`config.js` 不用改）：
>
> ```bash
> clasp deployments                                   # 找出 config.js 裡那個網址對應的 ID
> clasp deploy --deploymentId <那個ID> --description "改了什麼"
> ```
>
> 用 `clasp deploy` 不帶 `--deploymentId` 會建立**另一個**網址，前端仍連舊的，等於沒更新。

### 第二步 — 設定 Google 登入（選填）

不做這一步時，登入頁會顯示「僅開放帳密登入」，其餘功能不受影響。

1. 到 [Google Cloud Console → 憑證](https://console.cloud.google.com/apis/credentials)
   建立 **OAuth 用戶端 ID**，類型選「網頁應用程式」。
2. 在「**已授權的 JavaScript 來源**」加入你的前端網域，例如
   `https://your-name.github.io`（本機測試再加 `http://localhost:8080`）。
   這裡**不需要**填重新導向 URI。
3. 回到 Apps Script →「專案設定」→「指令碼屬性」，新增
   `GOOGLE_CLIENT_ID` = 剛剛的用戶端 ID。
4. 重新部署一次後端。

用 Google 登入的人若尚未有 PATS 帳號，系統會自動建立。

### 身分與信箱網域

註冊時要先選身分，**身分由學校配發的信箱網域決定，不是使用者自己說了算**：

| 身分 | 允許的信箱網域 | 聊天 | 備註 |
| --- | --- | --- | --- |
| 學生 | `@smail.hc.edu.tw` | 可以 | |
| 老師 | `@lsps.hc.edu.tw`、`@tmail.hc.edu.tw` | 可以 | 兩個網域都通 |
| 家長 | `@gmail.com` | **不可以** | 必須綁定一個已註冊的學生帳號 |

註冊表單只讓使用者填信箱的帳號部分，網域由選擇的身分自動決定（老師是下拉選單）。
家長會多出一個「孩子的學生帳號」欄位，後端會檢查那個帳號存在而且確實是學生身分。

家長登入後看到的是「違規與舉報」頁，側欄不會出現私訊、群組討論與封存。
這條界線**同時畫在前端與後端**：前端隱藏介面，後端的
`denyParent_()` 則擋掉所有聊天相關的 API，避免有人直接打 API 繞過介面。

> 「違規與舉報」的內容本身還沒實作，目前是空狀態頁面。

網域清單寫在兩個地方，修改時要一起改：後端 `apps-script/Auth.gs` 的 `ROLES`、
前端 `assets/js/auth.js` 的 `ROLES`。

### 忘記密碼

登入頁的「忘記密碼？」是三個步驟：輸入電子郵件 → 輸入信中的 6 位數驗證碼 →
設定新密碼，完成後直接登入。

驗證碼由後端產生並寄出，**寄件者就是這個 Apps Script 專案的擁有者帳號**
（Google 不允許指定成其他人的信箱）。執行 `initializeProject()` 會在紀錄中
印出「驗證碼寄件者」，可以確認是不是你要的那個帳號。一般 Gmail 帳號
每天可寄 100 封，同一份紀錄也會印出剩餘額度。

安全設計：

- 驗證碼只存雜湊值，資料庫裡看不到明碼。
- 有效期 15 分鐘，最多試 5 次，超過就作廢並需要重新申請。
- 同一個帳號 60 秒內只能索取一次，避免被拿來灌爆別人的信箱。
- 不論信箱有沒有註冊過都回報「已寄出」，否則這個匿名端點會變成
  查詢某人有沒有註冊的工具。
- 驗證通過後換發一張一次性通行證，密碼才改得動；改完會強制登出該帳號
  所有既有的裝置。

新增這個功能後 `appsscript.json` 多了寄信的權限範圍，**第一次執行時
Apps Script 會要求重新授權**，請在編輯器手動跑一次 `initializeProject()`
並按下允許，否則寄信會失敗。

### 註冊（含信箱驗證）

註冊分兩步：

1. 選身分、填顯示名稱、信箱、密碼（家長還要填孩子的學生帳號），按「寄送驗證碼」。
   後端會先把所有欄位驗證過一遍，**通過才寄信**，所以身分網域不符、信箱已註冊
   這類錯誤不會白白寄出一封信。這一步不會建立任何帳號。
2. 輸入信中的 6 位數驗證碼，按「完成註冊」。驗證通過才真正建立帳號並直接登入。

安全設計：

- 密碼不會在第一步送出，只留在瀏覽器記憶體，直到驗證碼通過才隨著建立帳號一起送出。
  待驗證的暫存資料裡沒有任何密碼欄位。
- 身分與綁定的學生一律取自第一步存下來的紀錄，不採用第二步送來的值，
  避免有人用學生信箱收驗證碼、卻把自己註冊成老師。
- 驗證碼只存雜湊、15 分鐘有效、最多試 5 次、同信箱 60 秒內只能索取一次。

### 註冊與邀請碼

登入頁的「立即註冊」可以自助建立帳號，填寫顯示名稱、電子郵件與密碼（至少 8 個字元），
成功後直接登入。顯示名稱允許重複，內部的 `username` 會依電子郵件自動產生且保證唯一。

因為 `/exec` 是匿名可存取的端點，開放註冊等於任何人都能建立帳號。要限制註冊對象時，
到「專案設定 → 指令碼屬性」新增 `REGISTRATION_CODE`，值設成你要發給同事的邀請碼。
設定後註冊表單會自動出現邀請碼欄位（前端在後端回報需要時才顯示，平時不佔版面）；
刪掉這個屬性就恢復開放註冊。

### 第三步 — 設定並發佈前端

編輯 `assets/js/config.js`：

```js
var PATS_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycb...../exec',
  googleClientId: '1234567890-abcdefg.apps.googleusercontent.com'  // 沒設定就留空字串
};
```

推上 GitHub：

```bash
git init
git add .
git commit -m "PATS 初版"
git branch -M main
git remote add origin https://github.com/<你的帳號>/<repo>.git
git push -u origin main
```

網站檔案就放在 repo 根目錄，Pages 的 Source 使用
**Deploy from a branch（main / root）**，GitHub 內建的建置流程會自動發佈，
`https://<你的帳號>.github.io/<repo>/` 就是登入頁。

> 這裡刻意**不**放自訂的 Actions workflow。兩條發佈路徑同時存在時，
> 會搶同一個 Pages 部署鎖而互相卡死。

推上 `main` 後等一兩分鐘，記得用 `Ctrl + F5` 強制重新整理，
否則瀏覽器可能還拿著舊版的 HTML。

### 本機預覽

```bash
python -m http.server 8080
# 開 http://localhost:8080
```

請用 http server 而不是直接雙擊 `index.html`，`file://` 協定會讓
跨網域請求與 Google 登入都失敗。

---

## 為什麼前端是這樣呼叫後端的

`core.js` 裡的 `rpc()` 用 `Content-Type: text/plain` 送 JSON 字串，看起來有點怪，
但這是必要的：**Apps Script 的網頁應用程式不會回應 CORS 預檢（OPTIONS）請求**。
只要帶了 `application/json`，瀏覽器就會先發預檢，然後整個請求失敗。
`text/plain` 屬於「簡單請求」不觸發預檢，後端 `doPost` 再自己解析 body。

如果你之後要改這裡，請保留這個 header，否則跨網域呼叫會全部壞掉。

---

## 使用方式

1. 以管理員帳號登入，或用 Google 登入（首次登入會自動建立帳號）。
2. 在「私訊」按右上角的新增圖示 →「邀請朋友」，輸入對方的電子郵件即可建立對話。
   對方必須已經在 PATS 註冊過（用 Google 登入過一次即可）。
3. 在「群組討論」建立群組，成員欄位可用逗號分隔多筆帳號。
4. 對話項目按右鍵（或右上角「更多」）可封存 / 取消封存。
5. 設定區有三個子頁：封存時間設定、帳號安全設定、帳號切換與登入。

---

## 響應式行為

| 視窗寬度 | 版面 |
| --- | --- |
| > 1100px | 三欄：導覽列（含文字）＋ 對話列表 ＋ 對話內容 |
| 721–1100px | 三欄，導覽列收合為圖示 |
| ≤ 720px | 單欄堆疊，導覽列移到底部；列表與對話用返回鍵切換 |

登入頁在 720px 以下由左右分割改為上下堆疊。

---

## 安全性說明

- 密碼以 **HMAC-SHA256 加鹽並迭代 1200 次**儲存，比對時使用定值時間比較。
- Google ID Token 一律交給 Google 的 tokeninfo 端點驗簽，並在後端比對
  `aud`、`iss`、`exp`，不採信前端自行解出的內容。
- 工作階段權杖存在 `sessions` 工作表，預設 12 小時；勾選「保持登入狀態」為 30 天。
- 所有需要身分的 API 都在後端重新驗證權杖與對話成員資格，前端無法繞過。
- `config.js` 裡的用戶端 ID 本來就是公開資訊，可以安全地放進 repo；
  **但用戶端密鑰（client secret）絕對不要放進來**，這個架構也不需要它。
- 試算表本身請勿設為公開共用，資料只透過 API 存取。

---

## 已知限制

- Apps Script 沒有 WebSocket，訊息以 6 秒輪詢更新。
- 試算表適合中小型團隊；訊息量很大時建議改接 Firestore 或 Cloud SQL。
- Apps Script 網頁應用程式有每日執行時間配額，輪詢頻率請視使用人數調整
  （在 `chat.js` 的 `POLL_INTERVAL_MS`）。
- 未實作檔案／圖片上傳，`messages.kind` 已預留欄位可擴充。
