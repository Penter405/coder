"""
Path Utilities for AI Coder Helper

This module provides helper functions for resolving paths
based on the new data.json structure with separate origin/shadow/coped sections.
"""

import os

# Script directory (coder-main)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


# ========================
# Context Types
# ========================
CONTEXT_ORIGIN = "origin"
CONTEXT_SHADOW = "shadow"


# ========================
# Path Resolution Functions
# ========================

def get_origin_path(project_name: str, data: dict) -> str:
    """
    取得 Origin 專案的絕對路徑
    
    Args:
        project_name: 專案名稱
        data: data.json 資料
    
    Returns:
        Origin 專案的絕對路徑
    """
    return data["projects"][project_name]["path"]


def get_shadow_path(project_name: str) -> str:
    """
    取得 Shadow 資料夾的絕對路徑
    
    Args:
        project_name: 專案名稱
    
    Returns:
        Shadow 資料夾的絕對路徑 (file/{project_name}/shadow/)
    """
    return os.path.join(SCRIPT_DIR, "file", project_name, "shadow")


def get_coped_path(project_name: str, coped_name: str) -> str:
    """
    取得 Coped 專案的絕對路徑
    
    Args:
        project_name: 專案名稱
        coped_name: Coped 專案名稱
    
    Returns:
        Coped 專案的絕對路徑 (file/{project_name}/{coped_name}/)
    """
    return os.path.join(SCRIPT_DIR, "file", project_name, coped_name)


def get_context_root(project_name: str, context: str, data: dict) -> str:
    """
    取得指定 context 的根目錄絕對路徑
    
    Args:
        project_name: 專案名稱
        context: "origin", "shadow", 或 coped 名稱
        data: data.json 資料
    
    Returns:
        Context 的根目錄絕對路徑
    """
    if context == CONTEXT_ORIGIN:
        return get_origin_path(project_name, data)
    elif context == CONTEXT_SHADOW:
        return get_shadow_path(project_name)
    else:
        # Assume it's a coped project name
        return get_coped_path(project_name, context)


def resolve_file_path(file_rel: str, context: str, project_name: str, data: dict) -> str:
    """
    將相對路徑解析為絕對路徑
    
    Args:
        file_rel: 相對路徑 (如 "main.py" 或 "utils/helper.py")
        context: "origin", "shadow", 或 coped 名稱
        project_name: 專案名稱
        data: data.json 資料
    
    Returns:
        絕對路徑
    """
    base = get_context_root(project_name, context, data)
    return os.path.normpath(os.path.join(base, file_rel))


def get_relative_path(abs_path: str, context: str, project_name: str, data: dict) -> str:
    """
    將絕對路徑轉換為相對於 context 根目錄的相對路徑
    
    Args:
        abs_path: 絕對路徑
        context: "origin", "shadow", 或 coped 名稱
        project_name: 專案名稱
        data: data.json 資料
    
    Returns:
        相對路徑
    """
    base = get_context_root(project_name, context, data)
    return os.path.relpath(abs_path, base)


# ========================
# Selected Files Functions
# ========================

def get_selected_files(project_name: str, context: str, data: dict) -> list:
    """
    取得指定 context 的 selected_files 清單（絕對路徑）
    
    Args:
        project_name: 專案名稱
        context: "origin", "shadow", 或 coped 名稱
        data: data.json 資料
    
    Returns:
        絕對路徑清單
    """
    proj = data["projects"][project_name]
    
    if context == CONTEXT_ORIGIN:
        rel_files = proj.get("origin", {}).get("selected_files", [])
    elif context == CONTEXT_SHADOW:
        rel_files = proj.get("shadow", {}).get("selected_files", [])
    else:
        # Coped project
        rel_files = proj.get("coped", {}).get(context, {}).get("selected_files", [])
    
    base = get_context_root(project_name, context, data)
    return [os.path.normpath(os.path.join(base, f)) for f in rel_files]


def get_selected_files_relative(project_name: str, context: str, data: dict) -> list:
    """
    取得指定 context 的 selected_files 清單（相對路徑）
    
    Args:
        project_name: 專案名稱
        context: "origin", "shadow", 或 coped 名稱
        data: data.json 資料
    
    Returns:
        相對路徑清單
    """
    proj = data["projects"][project_name]
    
    if context == CONTEXT_ORIGIN:
        return proj.get("origin", {}).get("selected_files", [])
    elif context == CONTEXT_SHADOW:
        return proj.get("shadow", {}).get("selected_files", [])
    else:
        return proj.get("coped", {}).get(context, {}).get("selected_files", [])


def set_selected_files(project_name: str, context: str, files: list, data: dict) -> None:
    """
    設定指定 context 的 selected_files（傳入相對路徑）
    
    Args:
        project_name: 專案名稱
        context: "origin", "shadow", 或 coped 名稱
        files: 相對路徑清單
        data: data.json 資料（會被修改）
    """
    proj = data["projects"][project_name]
    
    if context == CONTEXT_ORIGIN:
        if "origin" not in proj:
            proj["origin"] = {}
        proj["origin"]["selected_files"] = files
    elif context == CONTEXT_SHADOW:
        if "shadow" not in proj:
            proj["shadow"] = {}
        proj["shadow"]["selected_files"] = files
    else:
        # Coped project
        if "coped" not in proj:
            proj["coped"] = {}
        if context not in proj["coped"]:
            proj["coped"][context] = {}
        proj["coped"][context]["selected_files"] = files


# ========================
# Context Identification
# ========================

def identify_context(abs_path: str, project_name: str, data: dict) -> tuple:
    """
    根據絕對路徑判斷檔案屬於哪個 context
    
    Args:
        abs_path: 絕對路徑
        project_name: 專案名稱
        data: data.json 資料
    
    Returns:
        (context, relative_path) tuple
        context 可能是 "origin", "shadow", 或 coped 名稱
        如果無法判斷，返回 (None, None)
    """
    abs_path = os.path.normpath(abs_path)
    
    # Check Origin
    origin_root = get_origin_path(project_name, data)
    origin_root_norm = os.path.normcase(os.path.normpath(origin_root))
    abs_path_norm = os.path.normcase(abs_path)
    
    if abs_path_norm.startswith(origin_root_norm + os.sep) or abs_path_norm == origin_root_norm:
        rel = os.path.relpath(abs_path, origin_root)
        if not rel.startswith(".."):
            return (CONTEXT_ORIGIN, rel)
    
    # Check Shadow
    shadow_root = get_shadow_path(project_name)
    shadow_root_norm = os.path.normcase(os.path.normpath(shadow_root))
    
    if abs_path_norm.startswith(shadow_root_norm + os.sep) or abs_path_norm == shadow_root_norm:
        rel = os.path.relpath(abs_path, shadow_root)
        if not rel.startswith(".."):
            return (CONTEXT_SHADOW, rel)
    
    # Check Coped projects
    file_dir = os.path.join(SCRIPT_DIR, "file", project_name)
    file_dir_norm = os.path.normcase(os.path.normpath(file_dir))
    
    if abs_path_norm.startswith(file_dir_norm + os.sep):
        rel_to_file = os.path.relpath(abs_path, file_dir)
        parts = rel_to_file.split(os.sep)
        if len(parts) >= 1 and parts[0] != "shadow":
            coped_name = parts[0]
            coped_root = get_coped_path(project_name, coped_name)
            rel = os.path.relpath(abs_path, coped_root)
            if not rel.startswith(".."):
                return (coped_name, rel)
    
    return (None, None)


def list_coped_projects(project_name: str, data: dict) -> list:
    """
    列出所有 coped 專案名稱
    
    Args:
        project_name: 專案名稱
        data: data.json 資料
    
    Returns:
        Coped 專案名稱清單
    """
    proj = data["projects"].get(project_name, {})
    return list(proj.get("coped", {}).keys())


def list_all_contexts(project_name: str, data: dict) -> list:
    """
    列出所有可用的 context（包括 origin, shadow, 和所有 coped）
    
    Args:
        project_name: 專案名稱
        data: data.json 資料
    
    Returns:
        Context 名稱清單
    """
    contexts = [CONTEXT_ORIGIN, CONTEXT_SHADOW]
    contexts.extend(list_coped_projects(project_name, data))
    return contexts


# ========================
# Validation Functions
# ========================

def is_valid_context(context: str, project_name: str, data: dict) -> bool:
    """
    檢查 context 是否有效
    
    Args:
        context: Context 名稱
        project_name: 專案名稱
        data: data.json 資料
    
    Returns:
        True if valid
    """
    return context in list_all_contexts(project_name, data)


def context_exists(context: str, project_name: str, data: dict) -> bool:
    """
    檢查 context 對應的資料夾是否存在
    
    Args:
        context: Context 名稱
        project_name: 專案名稱
        data: data.json 資料
    
    Returns:
        True if folder exists
    """
    root = get_context_root(project_name, context, data)
    return os.path.exists(root)
