import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useAtom, useSetAtom } from "jotai";
import { Cloud, Send } from "lucide-react";
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
import type {
  CloudConfigBackupResult,
  CloudConfigBindResult,
  CloudConfigClearBindingResult,
  CloudConfigRestoreResult,
  CloudConfigStatus,
  CloudConfigStatusResult,
  CloudConfigViewState
} from "../shared/types";
import { CLOUD_AUTH_STORAGE_KEY } from "../storage/cloudAuthStorage";
import "../styles/app.css";

const LDC_SPONSOR_20_URL = "https://credit.linux.do/paying/online?token=3b78efe60d34a77c55d52e84d60e33270b5cc69f7aa8979bbab4d1b41b6f95b7";
const LDC_SPONSOR_200_URL = "https://credit.linux.do/paying/online?token=276b84998e7864428f277f6d7260f7e65e8c531cda5413cb061ff4a91cc3caa4";

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
  const [cloudState, setCloudState] = useState<CloudConfigViewState | null>(null);
  const [cloudBusy, setCloudBusy] = useState<"bind" | "status" | "backup" | "restore" | "clear" | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState<string | null>(null);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramMessage, setTelegramMessage] = useState<string | null>(null);
  const [telegramBusy, setTelegramBusy] = useState<"save" | "test" | null>(null);
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

  useEffect(() => {
    setTelegramToken(state.settings.telegramBotToken ?? "");
    setTelegramChatId(state.settings.telegramChatId ?? "");
  }, [state.settings.telegramBotToken, state.settings.telegramChatId]);

  const refreshCloudStatus = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setCloudBusy("status");
    const response = await sendCommand<CloudConfigStatusResult>({ type: "getCloudConfigStatus" });
    if (response.ok) {
      setCloudState(response.data);
      if (!options.silent) setCloudMessage(response.data.message);
    } else if (!options.silent) {
      setCloudMessage(response.error);
    }
    if (!options.silent) setCloudBusy(null);
  }, []);

  useEffect(() => {
    void refreshCloudStatus({ silent: true });
  }, [refreshCloudStatus]);

  useEffect(() => {
    if (window.location.hash !== "#cloud-backup") return;
    const scrollToCloudBackup = () => document.getElementById("cloud-backup")?.scrollIntoView?.({ block: "start" });
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(scrollToCloudBackup);
      return;
    }
    window.setTimeout(scrollToCloudBackup, 0);
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return undefined;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local" || !cloudAuthBindingChanged(changes)) return;
      void refreshCloudStatus({ silent: true });
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener?.(listener);
    };
  }, [refreshCloudStatus]);

  async function updateSettings(patch: Partial<typeof state.settings>) {
    const response = await sendCommand<typeof state>({ type: "updateSettings", settings: patch });
    if (response.ok) setState(response.data);
  }

  async function handleSaveTelegram() {
    setTelegramBusy("save");
    setTelegramMessage(null);
    try {
      const response = await sendCommand<typeof state>({
        type: "updateSettings",
        settings: { telegramBotToken: telegramToken.trim(), telegramChatId: telegramChatId.trim() }
      });
      if (response.ok) {
        setState(response.data);
        setTelegramMessage(telegramToken.trim() ? "Telegram 配置已保存。" : "已清除 Telegram 配置。");
      } else {
        setTelegramMessage(response.error);
      }
    } finally {
      setTelegramBusy(null);
    }
  }

  async function handleTestTelegram() {
    setTelegramBusy("test");
    setTelegramMessage(null);
    try {
      const response = await sendCommand<unknown>({ type: "testTelegramNotification" });
      setTelegramMessage(response.ok ? "测试消息已发送，请检查 Telegram。" : response.error);
    } finally {
      setTelegramBusy(null);
    }
  }

  async function handleIdentifyAccount() {
    setAccountBusy(true);
    try {
      await identifyCurrentAccount(false);
    } finally {
      setAccountBusy(false);
    }
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

  async function handleBindCloudSave() {
    setCloudBusy("bind");
    const response = await sendCommand<CloudConfigBindResult>({ type: "bindCloudSave" });
    if (response.ok) {
      setCloudState(response.data);
      setCloudMessage(response.data.message);
    } else {
      setCloudMessage(response.error);
    }
    setCloudBusy(null);
  }

  async function handleBackupCloudConfig() {
    setCloudBusy("backup");
    const response = await sendCommand<CloudConfigBackupResult>({ type: "backupCloudConfig" });
    if (response.ok) {
      setCloudState(response.data);
      setCloudMessage(response.data.message);
    } else {
      setCloudMessage(response.error);
    }
    setCloudBusy(null);
  }

  async function handleRestoreCloudConfig() {
    if (!window.confirm("确认从云端恢复配置？这会替换当前佬朋友和刷新设置，并清空本地缓存。")) return;
    setCloudBusy("restore");
    const response = await sendCommand<CloudConfigRestoreResult>({ type: "restoreCloudConfig" });
    if (response.ok) {
      setCloudState(response.data);
      if (response.data.state) setState(response.data.state);
      setCloudMessage(response.data.message);
    } else {
      setCloudMessage(response.error);
    }
    setCloudBusy(null);
  }

  async function handleClearCloudBinding() {
    setCloudBusy("clear");
    const response = await sendCommand<CloudConfigClearBindingResult>({ type: "clearCloudBinding" });
    if (response.ok) {
      setCloudState(response.data);
      setCloudMessage(response.data.message);
    } else {
      setCloudMessage(response.error);
    }
    setCloudBusy(null);
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
            <h2>本地账号探测</h2>
            <p className="panel-subtitle">
              {state.currentAccount
                ? `当前探测为 @${state.currentAccount.username}`
                : "尚未探测到 linux.do 登录账号。"}
            </p>
          </div>
          <button className="small-action" type="button" disabled={accountBusy} onClick={() => void handleIdentifyAccount()}>
            {accountBusy ? "探测中" : "重新探测"}
          </button>
        </div>
        {state.currentAccount?.verifiedAt ? (
          <p className="settings-meta">上次探测：{new Date(state.currentAccount.verifiedAt).toLocaleString()}</p>
        ) : (
          <p className="settings-meta">打开已登录的 linux.do 页面后可探测当前账号。</p>
        )}
      </section>

      <section className="panel">
        <h2>偏好设置</h2>
        <div className="settings-placeholder" style={{ marginTop: 12 }}>
          <h3>动态跳转</h3>
          <div className="segmented-control" role="radiogroup" aria-label="动态跳转">
            <button
              className={`segmented-option${state.settings.openActivityLinksInPage ? " active" : ""}`}
              type="button"
              aria-pressed={state.settings.openActivityLinksInPage}
              onClick={() => void updateSettings({ openActivityLinksInPage: true })}
            >
              页内跳转
            </button>
            <button
              className={`segmented-option${!state.settings.openActivityLinksInPage ? " active" : ""}`}
              type="button"
              aria-pressed={!state.settings.openActivityLinksInPage}
              onClick={() => void updateSettings({ openActivityLinksInPage: false })}
            >
              新标签页
            </button>
          </div>
          <p className="settings-meta">页内跳转会优先使用当前 linux.do 标签页；不可用时仍打开新标签。</p>
        </div>
        <div className="settings-placeholder" style={{ marginTop: 12 }}>
          <h3>
            <Send size={13} aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
            Telegram 通知
          </h3>
          <div>
            <label className="settings-meta" htmlFor="tg-bot-token" style={{ display: "block", marginBottom: 4 }}>
              Bot Token
            </label>
            <input
              id="tg-bot-token"
              type="password"
              placeholder="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.currentTarget.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="settings-meta" htmlFor="tg-chat-id" style={{ display: "block", marginBottom: 4 }}>
              Chat ID
            </label>
            <input
              id="tg-chat-id"
              type="text"
              placeholder="123456789"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.currentTarget.value)}
              autoComplete="off"
            />
          </div>
          <div className="maintenance-actions">
            <button className="small-action" type="button" disabled={telegramBusy != null} onClick={() => void handleSaveTelegram()}>
              {telegramBusy === "save" ? "保存中" : "保存"}
            </button>
            <button className="small-action" type="button" disabled={telegramBusy != null} onClick={() => void handleTestTelegram()}>
              {telegramBusy === "test" ? "发送中" : "发送测试消息"}
            </button>
          </div>
          {telegramMessage ? <p className="settings-meta">{telegramMessage}</p> : null}
          <p className="settings-meta">
            刷新到新动态时自动推送 Telegram 消息。需自行创建 Bot（向 @BotFather 发送 /newbot）并使用 @userinfobot 获取自己的 Chat ID。
          </p>
        </div>
        <div className="settings-construction-card" aria-label="后台刷新设置正在施工">
          <div>
            <h3>后台刷新</h3>
            <p>正在施工</p>
          </div>
          <span className="construction-badge">WIP</span>
        </div>
      </section>

      <section className="panel">
        <div className="settings-group">
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
        </div>

        <div className="settings-section-divider" />

        <div className="settings-group" id="cloud-backup">
          <div className="panel-title-row">
            <div>
              <h2 className="settings-title-with-icon">
                <Cloud size={16} aria-hidden="true" />
                <span>云端备份</span>
              </h2>
              <p className="panel-subtitle">{cloudBindingText(cloudState)}</p>
            </div>
            <div className="maintenance-actions">
              <button className="small-action" type="button" disabled={cloudBusy != null} onClick={() => void handleBindCloudSave()}>
                {cloudBusy === "bind" ? "绑定中" : cloudState?.binding.bound ? "重新绑定" : "绑定"}
              </button>
              <button className="small-action" type="button" disabled={cloudBusy != null} onClick={() => void refreshCloudStatus()}>
                {cloudBusy === "status" ? "检查中" : "检查云端"}
              </button>
              <button
                className="small-action"
                type="button"
                disabled={cloudBusy != null || cloudState?.binding.bound !== true}
                onClick={() => void handleBackupCloudConfig()}
              >
                {cloudBusy === "backup" ? "备份中" : "备份到云端"}
              </button>
              <button
                className="small-action"
                type="button"
                disabled={cloudBusy != null || cloudState?.binding.bound !== true}
                onClick={() => void handleRestoreCloudConfig()}
              >
                {cloudBusy === "restore" ? "恢复中" : "从云端恢复"}
              </button>
              <button
                className="small-action danger-action"
                type="button"
                disabled={cloudBusy != null || cloudState?.binding.bound !== true}
                onClick={() => void handleClearCloudBinding()}
              >
                断开绑定
              </button>
            </div>
          </div>
          <p className="settings-meta">{cloudStatusText(cloudState?.status)}</p>
          {cloudState?.binding.bound ? (
            <p className="settings-meta">
              绑定账号 ID：{cloudState.binding.linuxDoId}；绑定时间：{new Date(cloudState.binding.boundAt).toLocaleString()}
            </p>
          ) : null}
          {cloudState?.binding.bound && cloudState.binding.lastBackupAt ? (
            <p className="settings-meta">上次备份：{new Date(cloudState.binding.lastBackupAt).toLocaleString()}</p>
          ) : null}
          {cloudState?.binding.bound && cloudState.binding.lastRestoreAt ? (
            <p className="settings-meta">上次恢复：{new Date(cloudState.binding.lastRestoreAt).toLocaleString()}</p>
          ) : null}
          {cloudMessage ? <p className="settings-meta">{cloudMessage}</p> : null}
        </div>
      </section>

      <section className="panel danger-panel">
        <div className="panel-title-row">
          <div>
            <h2>数据维护</h2>
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

      <section className="panel sponsor-panel">
        <div className="panel-title-row">
          <div>
            <h2>赞助本项目</h2>
            <p className="panel-subtitle">给佬朋友续一口 LDC。</p>
          </div>
          <div className="maintenance-actions sponsor-actions">
            <a className="small-action sponsor-action" href={LDC_SPONSOR_20_URL} target="_blank" rel="noreferrer">
              20 LDC
            </a>
            <a className="small-action sponsor-action" href={LDC_SPONSOR_200_URL} target="_blank" rel="noreferrer">
              200 LDC
            </a>
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

function cloudBindingText(state: CloudConfigViewState | null): string {
  if (!state) return "正在检查 linuxdo-cloud-save 绑定状态。";
  if (!state.binding.bound) return "尚未绑定 linuxdo-cloud-save。";
  return "已绑定 linuxdo-cloud-save。";
}

function cloudStatusText(status: CloudConfigStatus | undefined): string {
  if (!status || status.state === "unchecked") return "云端配置尚未检查。";
  if (status.state === "remote_config") {
    const exportedAt = status.exportedAt ? new Date(status.exportedAt).toLocaleString() : "未知时间";
    return `云端配置：${status.friendCount ?? 0} 位佬朋友，导出于 ${exportedAt}。`;
  }
  return status.message ?? "云端配置状态未知。";
}

function cloudAuthBindingChanged(changes: Record<string, chrome.storage.StorageChange>): boolean {
  const change = changes[CLOUD_AUTH_STORAGE_KEY];
  if (!change) return false;
  return cloudAuthBindingSignature(change.oldValue) !== cloudAuthBindingSignature(change.newValue);
}

function cloudAuthBindingSignature(value: unknown): string {
  if (!isRecord(value)) return "unbound";
  if (
    value.app !== "linuxdo-friends" ||
    value.tokenType !== "Bearer" ||
    value.tokenKind !== "jwt" ||
    typeof value.linuxDoId !== "string" ||
    !value.linuxDoId.trim() ||
    typeof value.boundAt !== "string" ||
    !value.boundAt.trim()
  ) {
    return "unbound";
  }
  return `${value.app}:${value.linuxDoId}:${value.boundAt}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<OptionsApp />);
}
