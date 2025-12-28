# Coder 
本專案將提升你與LLM語言模型中，全端開發的效率
## 使用指南
初始化檔案---[init.py](https://github.com/Penter405/coder/blob/main/init.py)
```
python init.py
```
專案控制---[projectIO.py](https://github.com/Penter405/coder/blob/main/projectIO.py)
```
python projectIO.py
```
執行專案---[main.py](https://github.com/Penter405/coder/blob/main/main.py)
```
python main.py
```


## 專案架構請見 [DEVELOP.txt](https://github.com/Penter405/coder/blob/main/DEVELOP.txt)

---

## 介面使用教學 (Option 2: Enter Workspace)

進入 **Option 2** 後，您將看到一個專為與 AI 協作設計的介面：

### 步驟 1: 生成提示詞 (Generate Chat)
1. 點擊 **`Generate chat.txt`** 按鈕。
2. 在彈出的視窗中輸入您的 **任務描述** (例如：「幫我新增一個登入頁面」)。
3. 程式會自動讀取您選中的檔案 (來自 Option 1 或 VS Code Extension)。
4. 生成的 `chat.txt` 內容會 **自動複製到剪貼簿**。

### 步驟 2: 與 AI 對話
1. 打開您的 LLM (ChatGPT, Claude, Gemini 等)。
2. 直接 **貼上 (Ctrl+V)** 剛才複製的內容。
3. 等待 AI 回覆程式碼。

### 步驟 3: 套用變更 (Apply Changes)
1. 複製 AI 的 **完整回覆內容**。
2. 回到本程式，將內容貼在中間的 **文字框 (Paste AI Response here...)**。
3. 點擊 **`Apply Changes from Text`**。
4. 程式會自動解析 AI 的程式碼區塊 (格式如 `## path/to/file` ...)，並更新或建立檔案。
5. 下方的 Log 視窗會顯示操作結果。

---

## VS Code Extension 使用說明

我們開發的 Extension (`ai-coder-helper`) 可以直接在 VS Code 側邊欄選擇檔案，並與 `main.py` 完美整合。

### 安裝與執行
1. 使用 VS Code 開啟 `coder/ai-coder-helper` 資料夾。
2. 按下 **F5** (或選單 `Run` -> `Start Debugging`)。
3. 這會開啟一個新的 "Extension Development Host" 視窗。
4. 在該視窗中開啟您的專案資料夾。

### 如何套用 (Integration)
當您在 VS Code Extension 中勾選檔案時，選擇結果會儲存到 `.vscode/ai-coder.json`。
**`main.py` (Option 2)** 會自動偵測並優先讀取這個設定檔：

1. 在 Extension 側邊欄勾選您要修改的檔案。
2. 執行 `python main.py` -> **Option 2** -> **Generate chat.txt**。
3. `main.py` 會自動載入您在 VS Code 中選擇的那些檔案。
