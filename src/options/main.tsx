import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useAtom, useSetAtom } from "jotai";
import { appStateAtom, loadStateAtom } from "../state/atoms";
import { sendCommand } from "../messages/client";
import "../styles/app.css";

function OptionsApp() {
  const [state, setState] = useAtom(appStateAtom);
  const loadState = useSetAtom(loadStateAtom);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  async function updateSettings(patch: Partial<typeof state.settings>) {
    const response = await sendCommand<typeof state>({ type: "updateSettings", settings: patch });
    if (response.ok) setState(response.data);
  }

  return (
    <main className="options-shell">
      <header className="header">
        <div>
          <p className="eyebrow">LinuxDo Friends</p>
          <h1>佬朋友设置</h1>
        </div>
      </header>

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
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<OptionsApp />);
