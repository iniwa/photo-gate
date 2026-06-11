# ログイン・セッションポリシーと PBKDF2 iteration 数の決定

## 1. Status and Date

- **Status:** Accepted
- **Date:** 2026-06-11
- **Scope:** Phase 3 route非依存のログイン/セッションポリシーヘルパーと、本番PBKDF2 iteration数の確定

## 2. Context

`docs/fable/autonomy-contract.md` の Approved Defaults に基づき、route実装前に
ポリシー値とヘルパーの責務を確定する。既存基盤は以下のとおり。

- `auth-crypto.ts`: PBKDF2-SHA256(iterationは呼び出し側が明示、許容範囲
  100,000〜10,000,000)、32バイトセッショントークン、SHA-256 digest。
- `auth-repository.ts`: `fail_count` 加算と `fail_count`/`locked_until` リセット。
  ロック適用ロジックは未実装。
- `session-repository.ts`: `expires_at > now` でのみ有効セッションを返す。

## 3. Decisions

### 3.1 セッション有効期間: 固定7日間

- `SESSION_LIFETIME_SECONDS = 604_800`(7日)。sliding refreshは初期実装では
  行わない(Approved Default)。
- 有効期限は作成時刻(canonical UTC `Date.toISOString()` 形式)から純関数で
  計算し、`sessions.expires_at` に保存する。比較は既存どおり
  `expires_at > now`。

### 3.2 ログインロックアウト: 5回失敗で15分

- `MAX_LOGIN_FAILURES = 5`、`LOCKOUT_DURATION_SECONDS = 900`(15分)。
- 5回目の失敗で `locked_until = now + 15分` を設定する。
- 適用は単一のparameterized `UPDATE` 文内の `CASE` で原子的に行う
  (read-modify-writeの競合でロックが漏れることを防ぐ)。閾値と
  ロック解除時刻はパラメータとして渡し、repositoryはポリシー値を
  持たない。
- ロック判定は `locked_until > now`(canonical UTC文字列の辞書順比較。
  `Date.toISOString()` は固定幅のため安全)。
- **Fail closed:** D1行の `locked_until` が非nullかつcanonical形式でない場合は
  「ロック中」として扱う。認証の不確実性は常に拒否側に倒す。
- ログイン成功時は既存 `resetLoginFailure` で `fail_count = 0`、
  `locked_until = NULL` に戻す。

### 3.3 PBKDF2 iteration数: 100,000(プラットフォーム上限)

- `PBKDF2_PRODUCTION_ITERATIONS = 100_000`。
- **Verified fact:** Cloudflare Workersランタイム(workerd)はDoS対策として
  PBKDF2のiteration数を100,000に制限しており、超過は
  `NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
  supported` で失敗する(workerd issue #1346、Cloudflare Web Crypto docs)。
  したがって「Workers制限内で実用可能な最大の安全値」は100,000である。
- OWASP(2023)はPBKDF2-SHA-256に600,000回を推奨しており、100,000回は
  これを下回る。本プロジェクトでは以下の補償統制を前提に受容する:
  - 5回失敗/15分ロックアウト(本ADR 3.2)によるオンライン総当たり抑止;
  - 公開登録なし。利用者は運用者が作成する少数の共有ユーザーのみで、
    運用者が十分に強いパスワードを設定する;
  - セッションは32バイトランダムトークンで、パスワードは毎リクエストでは
    使われない;
  - ハッシュ形式にはiteration数がエンコード済み(最大10,000,000まで検証
    可能)のため、将来プラットフォーム上限が引き上げられた場合は新規
    ハッシュから段階的に強化できる。
- デプロイ時に実環境で `hashPassword(password, 100_000)` が成功することを
  スモークテストで確認する。上限変更を検知した場合は本ADRを更新する。

## 4. Consequences

- route非依存の純関数ポリシーヘルパー `login-policy.ts` を追加し、
  route実装(roadmap item 2)はこれらの定数・関数のみを参照する。
- `auth-repository.ts` の失敗記録はロックアウト適用込みの原子的UPDATEに
  置き換える(現状、有効routeはないため互換性影響なし)。
- 100,000回はOWASP推奨未達のため、Workersの上限引き上げ時には
  iteration数の引き上げを再検討する。

## 5. References

- Cloudflare Workers Web Crypto documentation:
  https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- workerd issue #1346 "crypto: 100,000 iterations of PBKDF2 is insecure":
  https://github.com/cloudflare/workerd/issues/1346
- OWASP Password Storage Cheat Sheet (PBKDF2 iteration guidance).
- `docs/fable/autonomy-contract.md` Approved Defaults.
