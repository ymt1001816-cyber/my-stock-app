# 📱 把 app 變成手機可用（部署到 Streamlit Cloud）

目標：程式放 GitHub → Streamlit Cloud 跑起來 → 得到一個網址，手機瀏覽器打開就能用、可加到主畫面變 app 圖示。全程免費。

---

## 步驟 1：註冊 GitHub 帳號（約 5 分鐘，免費）
1. 手機或電腦打開 [github.com](https://github.com)
2. 按 **Sign up**，填 email、設密碼、取一個使用者名稱（username，例如 `evahuang`）
3. 收信驗證 → 完成
4. 把你的 **username 告訴我**

## 步驟 2：建立一個「私人」儲存庫（我帶你做）
- 私人（Private）= 只有你看得到，你的持股資料不會公開
- 名字建議 `my-stock-app`

## 步驟 3：把這個資料夾的程式上傳
- 可用網頁直接拖拉上傳，或我給你指令，二選一

## 步驟 4：連到 Streamlit Cloud
1. 打開 [share.streamlit.io](https://share.streamlit.io)，用 GitHub 帳號登入
2. 選你的 repo、主檔案填 `app.py` → Deploy
3. 幾分鐘後得到網址 `xxx.streamlit.app`

## 步驟 5：設定 API 金鑰（放加密 secrets，不進程式）
- 在 Streamlit Cloud 的 App → Settings → Secrets 貼上：
  ```
  ANTHROPIC_API_KEY = "你的新金鑰"
  ```

## 步驟 6：手機加到主畫面
- 手機瀏覽器打開網址 → 分享 → 「加入主畫面」→ 變成 app 圖示

---

## 存檔會不會消失？
Streamlit Cloud 的檔案是暫時的，所以我會幫你把「儲存持股」改成**自動寫回你的私人 GitHub**，這樣手機上輸入也能永久記住。這一步等你 GitHub repo 建好後，我來設定並和你一起測試。

（在那之前，也可以先用 app 裡的「⬇️ 備份持股 CSV」手動存檔。）
