# 名刺手帖のSupabase同期

PCとスマートフォンを同じGoogleアカウントで使うための設定です。

## 訪問記録を同期できている場合

1. 今使っているSupabaseプロジェクトを開きます。
2. **SQL Editor → New query** で [card-sync.sql](./card-sync.sql) の全体を貼り付け、**Run** を押します。**Table Editor** に `meishi_cards` が表示されれば完了です。
3. 名刺手帖を更新し、**設定 → Supabase同期 → 名刺を同期** を押します。もう一方の端末でも同じ操作をします。すでに保存したプロジェクトURL・公開用キーとGoogleログインを使えます。

## Supabase同期を初めて設定する場合

1. Supabaseプロジェクトを作り、SQL Editorで同期したい項目のSQLを実行します。訪問記録は [visit-sync.sql](./visit-sync.sql)、名刺は [card-sync.sql](./card-sync.sql) です。ログインした利用者は自身の行だけ読み書きできます。
2. [Supabaseの手順](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)に沿ってGoogleのOAuthクライアントを作ります。Google側の承認済みリダイレクトURIには、SupabaseのGoogleプロバイダー画面に表示されるCallback URLを使います。GoogleのクライアントIDとシークレットはSupabaseのGoogleプロバイダー画面に登録します。
3. Supabase AuthenticationのURL Configurationで、Site URLとRedirect URLsに `https://kyounosukeoka.github.io/meishi/` を設定します。
4. PCとスマートフォンの **設定 → Supabase同期** で、同じプロジェクトURLと `sb_publishable_` で始まる公開用キーを保存します。**Googleでログイン** から同じGoogleアカウントを選び、同期する項目のボタンを押します。

## 同期する情報

名刺は氏名、社名、部署・役職、連絡先、住所、受領日、メモなどの文字情報を同期します。写真は端末に保存され、文字情報を受信しても既存の写真は残ります。写真だけを登録した名刺は、文字情報を入力すると同期対象になります。訪問記録の同期には顧客情報、メモ、取得した位置情報が含まれます。

同じIDの記録を両方の端末で編集すると競合が保留されます。**設定 → Supabase同期** で反映する側を選び、該当する同期ボタンを押します。別々に登録した名刺は別のIDを持ちます。端末での削除はSupabaseや他の端末に反映されません。訪問を取りやめた場合は「訪問を中止」を使います。名刺写真も含めて復元する場合は、パスワード付きバックアップを使います。
