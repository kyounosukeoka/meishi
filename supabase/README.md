# 名刺手帖の訪問記録を同期する

同じ Google アカウントで使う PC とスマートフォン向けの設定です。名刺手帖の訪問記録には顧客情報、メモ、取得した位置情報が含まれます。業務利用の範囲を確認し、接続テストには架空の訪問先を使います。

1. Supabase でプロジェクトを作り、SQL Editor で [visit-sync.sql](./visit-sync.sql) を実行します。Data API の公開対象に `public.meishi_visits` が含まれていることを確認します。ログインした利用者は自身の行だけ読み書きできます。
2. [Supabase の手順](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)に沿って Google の OAuth クライアントを設定します。Google 側の承認済みリダイレクト URI は Supabase の Google プロバイダー画面に出るコールバック URL を使います。Google のクライアントシークレットは Supabase のダッシュボードに登録します。
3. Supabase Authentication の URL Configuration で、サイト URL とリダイレクト先に `https://kyounosukeoka.github.io/meishi/` を設定します。
4. PC とスマートフォンの名刺手帖で「設定 → Supabaseで訪問記録を同期」を開き、同じプロジェクト URL と `sb_publishable_` で始まる公開用キーを保存します。「Googleでログイン」で同じ Google アカウントを選びます。
5. PC で顧客 CSV を読み込んで訪問予定を作ったら「訪問記録を同期」を押し、スマートフォンでも「訪問記録を同期」を押します。帰社時はスマートフォンで同期してから、PC で同期します。

訪問記録の追加・変更・中止を送受信します。双方で変更した記録は保留され、設定で反映する側を選べます。端末からの削除はクラウドに伝わらないため、訪問を取りやめた場合は「訪問を中止」を使います。名刺そのものは同期対象外です。名刺と訪問記録をまとめて復元するためのパスワード付きバックアップは引き続き利用できます。
