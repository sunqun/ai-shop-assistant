export function AuthorizationPanel({
  authLoading,
  user,
  consent,
  saving,
  onConsentChange,
  onSave,
}: {
  authLoading: boolean;
  user: { isAuthorized: boolean } | null;
  consent: boolean;
  saving: boolean;
  onConsentChange: (checked: boolean) => void;
  onSave: () => void;
}) {
  return (
    <section className="orders-auth">
      <div>
        <h2>AI 自助下单授权</h2>
        <p className="muted">授权后，AI 助手可代为创建订单记录。</p>
      </div>
      {authLoading ? (
        <p className="muted">正在读取授权状态…</p>
      ) : !user ? (
        <p className="muted">登录后可管理授权。</p>
      ) : user.isAuthorized ? (
        <span className="orders-auth__status tag tag--success">已授权</span>
      ) : (
        <div className="orders-auth__actions">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => onConsentChange(event.target.checked)}
            />{" "}
            <span>同意 AI 助手代为创建订单记录</span>
          </label>
          <button
            className="button button--primary"
            type="button"
            disabled={!consent || saving}
            onClick={onSave}
          >
            {saving ? "保存中…" : "保存授权"}
          </button>
        </div>
      )}
    </section>
  );
}
