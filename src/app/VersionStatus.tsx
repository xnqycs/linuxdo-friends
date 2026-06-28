import React from "react";
import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { GITHUB_LATEST_RELEASE_URL } from "../domain/versionCheck";
import { formatRelativeTime } from "../shared/time";
import type { UpdateCheckState } from "../shared/types";

export function VersionBadge({ state }: { state: UpdateCheckState }) {
  const latestVersion = state.status === "update-available" && state.latestVersion ? state.latestVersion : null;
  return (
    <div className="version-badge" aria-label="插件版本">
      <span className="version-current">v{state.installedVersion}</span>
      {latestVersion ? (
        <a className="version-update-link" href={GITHUB_LATEST_RELEASE_URL} target="_blank" rel="noreferrer">
          新 v{latestVersion}
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

export function VersionDiagnostics({
  now,
  onCheck,
  state
}: {
  now: number;
  onCheck: () => void;
  state: UpdateCheckState;
}) {
  const latestVersion = state.latestVersion ? `v${state.latestVersion}` : "暂无";
  const checkedAt = state.checkedAt ? `${formatRelativeTime(state.checkedAt, now)}检查` : "尚未检查";
  const message = diagnosticMessage(state);
  return (
    <section className="panel version-panel">
      <div className="section-title">
        <h2>版本更新</h2>
        <button className="small-action" type="button" onClick={onCheck} disabled={state.status === "checking"}>
          {state.status === "checking" ? (
            <LoaderCircle className="spin-icon" size={13} aria-hidden="true" />
          ) : (
            <RefreshCw size={13} aria-hidden="true" />
          )}
          检查更新
        </button>
      </div>
      <div className="version-diagnostic-grid">
        <span>当前版本</span>
        <strong>v{state.installedVersion}</strong>
        <span>最新版本</span>
        {state.status === "update-available" ? (
          <a className="version-diagnostic-link" href={GITHUB_LATEST_RELEASE_URL} target="_blank" rel="noreferrer">
            {latestVersion}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        ) : (
          <strong>{latestVersion}</strong>
        )}
        <span>检查状态</span>
        <strong>{message}</strong>
        <span>检查时间</span>
        <strong>{checkedAt}</strong>
      </div>
      {state.status === "error" || state.status === "no-release" ? <p className="version-diagnostic-error">{state.error}</p> : null}
    </section>
  );
}

function diagnosticMessage(state: UpdateCheckState): string {
  switch (state.status) {
    case "checking":
      return "正在检查";
    case "update-available":
      return "发现新版本";
    case "up-to-date":
      return "已是最新";
    case "no-release":
      return "暂无 Release";
    case "error":
      return "检查失败";
    case "idle":
      return "待检查";
  }
}
