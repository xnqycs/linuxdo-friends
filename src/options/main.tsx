import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useAtom, useSetAtom } from "jotai";
import {
  appStateAtom,
  checkForUpdatesAtom,
  clearCacheAtom,
  exportConfigAtom,
  identifyCurrentAccountAtom,
  importConfigAtom,
  loadStateAtom,
  loadUpdateCheckAtom,
  observeUpdateCheckAtom,
  resetExtensionAtom,
  updateCheckAtom
} from "../state/atoms";
import { sendCommand } from "../messages/client";
import { VersionBadge, VersionDiagnostics } from "../app/VersionStatus";
import "../styles/app.css";

export function OptionsApp() {
  const [state, setState] = useAtom(appStateAtom);
  const [updateCheck] = useAtom(updateCheckAtom);
  const loadState = useSetAtom(loadStateAtom);
  const loadUpdateCheck = useSetAtom(loadUpdateCheckAtom);
  const checkForUpdates = useSetAtom(checkForUpdatesAtom);
  const clearCache = useSetAtom(clearCacheAtom);
  const exportConfig = useSetAtom(exportConfigAtom);
  const identifyCurrentAccount = useSetAtom(identifyCurrentAccountAtom);
  const importConfig = useSetAtom(importConfigAtom);
  const observeUpdateCheck = useSetAtom(observeUpdateCheckAtom);
  const resetExtension = useSetAtom(resetExtensionAtom);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadState();
    void loadUpdateCheck();
    void checkForUpdates();
    const cleanupUpdateCheck = observeUpdateCheck();
    const interval = window.setInterval(() => setRelativeNow(Date.now()), 30_000);
    return () => {
      cleanupUpdateCheck?.();
      window.clearInterval(interval);
    };
  }, [checkForUpdates, loadState, loadUpdateCheck, observeUpdateCheck]);

  async function updateSettings(patch: Partial<typeof state.settings>) {
    const response = await sendCommand<typeof state>({ type: "updateSettings", settings: patch });
    if (response.ok) setState(response.data);
  }

  async function handleIdentifyAccount() {
    await identifyCurrentAccount(false);
  }

  async function handleClearCache() {
    await clearCache();
  }

  async function handleResetExtension() {
    if (!window.confirm("确认全量重置佬朋友？这会清空佬朋友、设置、账号和所有缓存。")) return;
    await resetExtension();
  }

  async function handleExportConfig() {
    const response = await exportConfig();
    if (!response.ok) {
      setConfigMessage(response.error);
      return;
    }
    downloadJson(response.data, configFileName(response.data.exportedAt));
    setConfigMessage(`已导出 ${Object.keys(response.data.friends).length} 位佬朋友配置。`);
  }

  async function handleImportConfig(file: File | undefined) {
    if (!file) return;
    try {
      const json = await file.text();
      if (!window.confirm("确认导入配置？这会替换当前佬朋友和刷新设置，并清空本地缓存。")) return;
      const response = await importConfig(json);
      if (response.ok) {
        setState(response.data);
        setConfigMessage(response.data.lastSync?.message ?? "已导入配置。");
      } else {
        setConfigMessage(response.error);
      }
    } catch {
      setConfigMessage("读取配置文件失败。");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <main className="options-shell">
      <header className="header">
        <div>
          <p className="eyebrow">LinuxDo Friends</p>
          <h1>佬朋友设置</h1>
        </div>
        <div className="header-status">
          <VersionBadge state={updateCheck} />
        </div>
      </header>

      <VersionDiagnostics now={relativeNow} onCheck={() => void checkForUpdates(true)} state={updateCheck} />

      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>账号识别</h2>
            <p className="panel-subtitle">
              {state.currentAccount
                ? `当前识别为 @${state.currentAccount.username}`
                : "尚未识别 linux.do 登录账号。"}
            </p>
          </div>
          <button className="small-action" type="button" onClick={() => void handleIdentifyAccount()}>
            重新识别账号
          </button>
        </div>
        {state.currentAccount?.verifiedAt ? (
          <p className="settings-meta">上次识别：{new Date(state.currentAccount.verifiedAt).toLocaleString()}</p>
        ) : (
          <p className="settings-meta">打开已登录的 linux.do 页面后，插件会优先通过页面脚本识别账号。</p>
        )}
      </section>

      <section className="panel">
        <h2>刷新策略</h2>
        <label className="toggle">
          <input type="checkbox" checked={false} disabled />
          <span>低频自动刷新（后续版本）</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={false} disabled />
          <span>后台非激活标签页 fallback（后续版本）</span>
        </label>
        <label className="field">
          <span>刷新间隔（分钟）</span>
          <input
            type="number"
            min={30}
            max={720}
            value={state.settings.refreshIntervalMinutes}
            onChange={(event) => void updateSettings({ refreshIntervalMinutes: Number(event.target.value) })}
          />
        </label>
      </section>

      <section className="panel">
        <h2>边界</h2>
        <ul className="rules">
          <li>已关注列表只是快捷添加来源，也可以手动验证用户名后添加。</li>
          <li>主动刷新优先；状态和动态分开刷新，遇到验证、拒绝或限流会停止本轮刷新。</li>
          <li>不生成精确在线时间线，不做连续在线监控。</li>
          <li>不读取或导出 Cookie，不使用远程服务器代请求。</li>
        </ul>
      </section>

      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>配置迁移</h2>
            <p className="panel-subtitle">只导入导出佬朋友和刷新设置，不包含账号、动态、头像缓存、页面现场或 Cookie。</p>
          </div>
          <div className="maintenance-actions">
            <button className="small-action" type="button" onClick={() => void handleExportConfig()}>
              导出配置
            </button>
            <button className="small-action" type="button" onClick={() => importInputRef.current?.click()}>
              导入配置
            </button>
            <input
              ref={importInputRef}
              className="visually-hidden-file"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void handleImportConfig(event.currentTarget.files?.[0])}
            />
          </div>
        </div>
        {configMessage ? <p className="settings-meta">{configMessage}</p> : null}
      </section>

      <section className="panel danger-panel">
        <div className="panel-title-row">
          <div>
            <h2>维护</h2>
            <p className="panel-subtitle">清理缓存会保留佬朋友、设置和当前账号；全量重置会恢复到刚安装状态。</p>
          </div>
          <div className="maintenance-actions">
            <button className="small-action" type="button" onClick={() => void handleClearCache()}>
              清理缓存
            </button>
            <button className="small-action danger-action" type="button" onClick={() => void handleResetExtension()}>
              全量重置
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function configFileName(exportedAt: string) {
  return `linuxdo-friends-config-${exportedAt.replace(/[:.]/g, "-")}.json`;
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<OptionsApp />);
}
