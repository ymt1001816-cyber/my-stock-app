# -*- coding: utf-8 -*-
"""
把 holdings.csv / watchlist.csv / history.csv / config.json 同步回 GitHub，
讓 Render 這種「重啟就洗掉磁碟」的免費方案也不會弄丟資料。

只有設定了 GITHUB_TOKEN 環境變數才會啟用（本機開發沒設就完全不會呼叫 GitHub，
行為跟以前一樣）。用 GitHub Contents API 直接讀寫檔案，不需要本機 git 指令、
不需要設定 git user.name/email。
"""
import os
import base64
import logging

import requests

logger = logging.getLogger("github_sync")

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "ymt1001816-cyber/my-stock-app")
GITHUB_BRANCH = os.environ.get("GITHUB_BRANCH", "main")

ENABLED = bool(GITHUB_TOKEN)

_API = f"https://api.github.com/repos/{GITHUB_REPO}/contents"
_HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
}


def _get_sha(repo_path):
    """拿該檔案目前在 GitHub 上的 sha（更新既有檔案一定要帶這個），沒有就回 None。"""
    r = requests.get(f"{_API}/{repo_path}", headers=_HEADERS,
                     params={"ref": GITHUB_BRANCH}, timeout=10)
    if r.status_code == 200:
        return r.json().get("sha")
    return None


def push_file(local_path, repo_path, message):
    """把本機檔案內容 commit 回 GitHub。失敗只記警告，不讓使用者的操作因此失敗。"""
    if not ENABLED:
        return
    try:
        with open(local_path, "rb") as f:
            content = f.read()
        body = {
            "message": message,
            "content": base64.b64encode(content).decode("ascii"),
            "branch": GITHUB_BRANCH,
        }
        sha = _get_sha(repo_path)
        if sha:
            body["sha"] = sha
        r = requests.put(f"{_API}/{repo_path}", headers=_HEADERS, json=body, timeout=15)
        if r.status_code not in (200, 201):
            logger.warning("push_file(%s) failed: %s %s", repo_path, r.status_code, r.text[:300])
    except Exception as e:
        logger.warning("push_file(%s) error: %s", repo_path, e)


def pull_file(repo_path, local_path):
    """啟動時把 GitHub 上最新的檔案抓回本機（Render 的磁碟每次部署都是全新的）。"""
    if not ENABLED:
        return
    try:
        r = requests.get(f"{_API}/{repo_path}", headers=_HEADERS,
                         params={"ref": GITHUB_BRANCH}, timeout=10)
        if r.status_code != 200:
            return
        content = base64.b64decode(r.json()["content"])
        with open(local_path, "wb") as f:
            f.write(content)
    except Exception as e:
        logger.warning("pull_file(%s) error: %s", repo_path, e)
